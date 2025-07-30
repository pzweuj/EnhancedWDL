import { EventEmitter } from 'events';

export interface CacheEntry<T> {
    key: string;
    value: T;
    timestamp: number;
    lastAccessed: number;
    accessCount: number;
    size: number; // Estimated size in bytes
}

export interface CacheStats {
    size: number;
    maxSize: number;
    hitCount: number;
    missCount: number;
    hitRate: number;
    totalMemoryUsage: number;
    lastCleanup: number;
    evictionCount: number;
}

export interface CacheOptions {
    maxSize?: number;
    ttl?: number; // Time to live in milliseconds
    maxMemoryUsage?: number; // Maximum memory usage in bytes
    cleanupInterval?: number; // Cleanup interval in milliseconds
    enableStats?: boolean;
}

export class CacheManager<T> extends EventEmitter {
    private cache: Map<string, CacheEntry<T>> = new Map();
    private stats: CacheStats;
    private options: Required<CacheOptions>;
    private cleanupTimer?: NodeJS.Timeout;
    
    constructor(options: CacheOptions = {}) {
        super();
        
        this.options = {
            maxSize: options.maxSize ?? 100,
            ttl: options.ttl ?? 5 * 60 * 1000, // 5 minutes
            maxMemoryUsage: options.maxMemoryUsage ?? 50 * 1024 * 1024, // 50MB
            cleanupInterval: options.cleanupInterval ?? 60 * 1000, // 1 minute
            enableStats: options.enableStats ?? true
        };
        
        this.stats = {
            size: 0,
            maxSize: this.options.maxSize,
            hitCount: 0,
            missCount: 0,
            hitRate: 0,
            totalMemoryUsage: 0,
            lastCleanup: Date.now(),
            evictionCount: 0
        };
        
        // Start periodic cleanup
        this.startCleanupTimer();
    }
    
    /**
     * Get value from cache
     */
    get(key: string): T | undefined {
        const entry = this.cache.get(key);
        
        if (!entry) {
            this.updateStats('miss');
            return undefined;
        }
        
        // Check if entry is expired
        const now = Date.now();
        if (now - entry.timestamp > this.options.ttl) {
            this.cache.delete(key);
            this.updateStats('miss');
            this.updateMemoryUsage();
            return undefined;
        }
        
        // Update access information
        entry.lastAccessed = now;
        entry.accessCount++;
        
        this.updateStats('hit');
        return entry.value;
    }
    
    /**
     * Set value in cache
     */
    set(key: string, value: T, estimatedSize?: number): void {
        const now = Date.now();
        const size = estimatedSize ?? this.estimateSize(value);
        
        // Check if we need to make room
        this.ensureCapacity(size);
        
        const entry: CacheEntry<T> = {
            key,
            value,
            timestamp: now,
            lastAccessed: now,
            accessCount: 1,
            size
        };
        
        // Remove existing entry if it exists
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }
        
        this.cache.set(key, entry);
        this.updateMemoryUsage();
        
        this.emit('set', { key, size });
    }
    
    /**
     * Delete value from cache
     */
    delete(key: string): boolean {
        const deleted = this.cache.delete(key);
        if (deleted) {
            this.updateMemoryUsage();
            this.emit('delete', { key });
        }
        return deleted;
    }
    
    /**
     * Check if key exists in cache
     */
    has(key: string): boolean {
        const entry = this.cache.get(key);
        if (!entry) {
            return false;
        }
        
        // Check if expired
        const now = Date.now();
        if (now - entry.timestamp > this.options.ttl) {
            this.cache.delete(key);
            this.updateMemoryUsage();
            return false;
        }
        
        return true;
    }
    
    /**
     * Clear all cache entries
     */
    clear(): void {
        const size = this.cache.size;
        this.cache.clear();
        this.updateMemoryUsage();
        this.emit('clear', { entriesCleared: size });
    }
    
    /**
     * Get cache statistics
     */
    getStats(): CacheStats {
        return { ...this.stats };
    }
    
    /**
     * Force cleanup of expired entries
     */
    cleanup(): number {
        const now = Date.now();
        const toDelete: string[] = [];
        
        for (const [key, entry] of this.cache) {
            if (now - entry.timestamp > this.options.ttl) {
                toDelete.push(key);
            }
        }
        
        for (const key of toDelete) {
            this.cache.delete(key);
        }
        
        this.stats.lastCleanup = now;
        this.updateMemoryUsage();
        
        if (toDelete.length > 0) {
            this.emit('cleanup', { expiredEntries: toDelete.length });
        }
        
        return toDelete.length;
    }
    
    /**
     * Get all cache keys
     */
    keys(): string[] {
        return Array.from(this.cache.keys());
    }
    
    /**
     * Get cache size
     */
    size(): number {
        return this.cache.size;
    }
    
    /**
     * Get entries sorted by access patterns
     */
    getEntriesByAccessPattern(): Array<{ key: string; lastAccessed: number; accessCount: number }> {
        return Array.from(this.cache.entries())
            .map(([key, entry]) => ({
                key,
                lastAccessed: entry.lastAccessed,
                accessCount: entry.accessCount
            }))
            .sort((a, b) => {
                // Sort by access count (descending) then by last accessed (descending)
                if (a.accessCount !== b.accessCount) {
                    return b.accessCount - a.accessCount;
                }
                return b.lastAccessed - a.lastAccessed;
            });
    }
    
    /**
     * Invalidate entries matching a predicate
     */
    invalidate(predicate: (key: string, value: T) => boolean): number {
        const toDelete: string[] = [];
        
        for (const [key, entry] of this.cache) {
            if (predicate(key, entry.value)) {
                toDelete.push(key);
            }
        }
        
        for (const key of toDelete) {
            this.cache.delete(key);
        }
        
        this.updateMemoryUsage();
        
        if (toDelete.length > 0) {
            this.emit('invalidate', { invalidatedEntries: toDelete.length });
        }
        
        return toDelete.length;
    }
    
    /**
     * Destroy the cache manager
     */
    destroy(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }
        
        this.clear();
        this.removeAllListeners();
    }
    
    // Private methods
    
    private startCleanupTimer(): void {
        this.cleanupTimer = setInterval(() => {
            this.cleanup();
        }, this.options.cleanupInterval);
    }
    
    private ensureCapacity(newEntrySize: number): void {
        // Check memory usage
        if (this.stats.totalMemoryUsage + newEntrySize > this.options.maxMemoryUsage) {
            this.evictByMemoryPressure(newEntrySize);
        }
        
        // Check size limit
        if (this.cache.size >= this.options.maxSize) {
            this.evictBySize();
        }
    }
    
    private evictByMemoryPressure(requiredSpace: number): void {
        const entries = Array.from(this.cache.entries())
            .sort((a, b) => {
                // Evict least recently used entries first
                return a[1].lastAccessed - b[1].lastAccessed;
            });
        
        let freedSpace = 0;
        const toEvict: string[] = [];
        
        for (const [key, entry] of entries) {
            toEvict.push(key);
            freedSpace += entry.size;
            
            if (this.stats.totalMemoryUsage - freedSpace + requiredSpace <= this.options.maxMemoryUsage) {
                break;
            }
        }
        
        for (const key of toEvict) {
            this.cache.delete(key);
            this.stats.evictionCount++;
        }
        
        this.updateMemoryUsage();
        
        if (toEvict.length > 0) {
            this.emit('eviction', { 
                reason: 'memory_pressure', 
                evictedEntries: toEvict.length,
                freedSpace 
            });
        }
    }
    
    private evictBySize(): void {
        // Evict least recently used entries
        const entries = Array.from(this.cache.entries())
            .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
        
        const toEvict = Math.ceil(this.options.maxSize * 0.1); // Evict 10% of entries
        const evictedKeys: string[] = [];
        
        for (let i = 0; i < toEvict && i < entries.length; i++) {
            const [key] = entries[i];
            this.cache.delete(key);
            this.stats.evictionCount++;
            evictedKeys.push(key);
        }
        
        this.updateMemoryUsage();
        
        if (evictedKeys.length > 0) {
            this.emit('eviction', { 
                reason: 'size_limit', 
                evictedEntries: evictedKeys.length 
            });
        }
    }
    
    private updateStats(type: 'hit' | 'miss'): void {
        if (!this.options.enableStats) {
            return;
        }
        
        if (type === 'hit') {
            this.stats.hitCount++;
        } else {
            this.stats.missCount++;
        }
        
        const total = this.stats.hitCount + this.stats.missCount;
        this.stats.hitRate = total > 0 ? this.stats.hitCount / total : 0;
    }
    
    private updateMemoryUsage(): void {
        this.stats.size = this.cache.size;
        this.stats.totalMemoryUsage = Array.from(this.cache.values())
            .reduce((total, entry) => total + entry.size, 0);
    }
    
    private estimateSize(value: T): number {
        try {
            // Simple estimation based on JSON serialization
            return JSON.stringify(value).length * 2; // Rough estimate for UTF-16
        } catch {
            return 1024; // Default size if estimation fails
        }
    }
}