import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { TaskSymbol, WorkflowSymbol, SymbolTable } from './symbolProvider';
import { CachedImport } from './importResolver';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export interface CacheMetadata {
    version: string;
    timestamp: number;
    checksum: string;
    compressionType: 'none' | 'gzip';
    entryCount: number;
    totalSize: number;
}

export interface PersistentCacheEntry {
    key: string;
    data: any;
    timestamp: number;
    checksum: string;
    metadata?: Record<string, any>;
}

export interface CacheFile {
    metadata: CacheMetadata;
    entries: PersistentCacheEntry[];
}

export interface PersistentCacheOptions {
    cacheDir?: string;
    maxCacheSize?: number;
    compressionEnabled?: boolean;
    checksumValidation?: boolean;
    autoSave?: boolean;
    saveInterval?: number;
    maxBackups?: number;
}

export interface CacheStats {
    totalEntries: number;
    totalSize: number;
    compressionRatio: number;
    lastSave: number;
    lastLoad: number;
    saveCount: number;
    loadCount: number;
    errorCount: number;
}

/**
 * Persistent cache manager for WDL symbol tables and import data
 */
export class PersistentCacheManager extends EventEmitter {
    private static readonly CACHE_VERSION = '1.0.0';
    private static readonly SYMBOL_CACHE_FILE = 'symbols.cache';
    private static readonly IMPORT_CACHE_FILE = 'imports.cache';
    private static readonly METADATA_FILE = 'cache.meta';
    
    private options: Required<PersistentCacheOptions>;
    private cacheDir: string;
    private stats: CacheStats;
    private autoSaveTimer?: NodeJS.Timeout;
    private isDirty: boolean = false;
    
    // In-memory cache data
    private symbolCache: Map<string, PersistentCacheEntry> = new Map();
    private importCache: Map<string, PersistentCacheEntry> = new Map();
    
    constructor(options: PersistentCacheOptions = {}) {
        super();
        
        this.options = {
            cacheDir: options.cacheDir ?? path.join(process.cwd(), '.wdl-cache'),
            maxCacheSize: options.maxCacheSize ?? 100 * 1024 * 1024, // 100MB
            compressionEnabled: options.compressionEnabled ?? true,
            checksumValidation: options.checksumValidation ?? true,
            autoSave: options.autoSave ?? true,
            saveInterval: options.saveInterval ?? 5 * 60 * 1000, // 5 minutes
            maxBackups: options.maxBackups ?? 3
        };
        
        this.cacheDir = this.options.cacheDir;
        
        this.stats = {
            totalEntries: 0,
            totalSize: 0,
            compressionRatio: 1.0,
            lastSave: 0,
            lastLoad: 0,
            saveCount: 0,
            loadCount: 0,
            errorCount: 0
        };
        
        this.ensureCacheDirectory();
        
        if (this.options.autoSave) {
            this.startAutoSave();
        }
    }
    
    /**
     * Initialize the cache by loading existing data
     */
    async initialize(): Promise<void> {
        try {
            await this.loadCache();
            this.emit('initialized', { entriesLoaded: this.stats.totalEntries });
        } catch (error) {
            this.stats.errorCount++;
            this.emit('error', { type: 'initialization', error });
            throw error;
        }
    }
    
    /**
     * Save symbol table to persistent cache
     */
    async saveSymbolTable(symbolTable: SymbolTable, uri: string): Promise<void> {
        const key = `symbols:${uri}`;
        const data = {
            tasks: Array.from(symbolTable.tasks.entries()),
            workflows: Array.from(symbolTable.workflows.entries()),
            lastModified: Array.from(symbolTable.lastModified.entries())
        };
        
        const entry = await this.createCacheEntry(key, data);
        this.symbolCache.set(key, entry);
        this.isDirty = true;
        
        this.emit('symbolTableSaved', { uri, entryCount: entry.data.tasks.length });
    }
    
    /**
     * Load symbol table from persistent cache
     */
    async loadSymbolTable(uri: string): Promise<SymbolTable | null> {
        const key = `symbols:${uri}`;
        const entry = this.symbolCache.get(key);
        
        if (!entry) {
            return null;
        }
        
        if (!await this.validateCacheEntry(entry)) {
            this.symbolCache.delete(key);
            this.isDirty = true;
            return null;
        }
        
        try {
            const symbolTable: SymbolTable = {
                tasks: new Map(entry.data.tasks),
                workflows: new Map(entry.data.workflows),
                lastModified: new Map(entry.data.lastModified)
            };
            
            this.emit('symbolTableLoaded', { uri, entryCount: symbolTable.tasks.size });
            return symbolTable;
        } catch (error) {
            this.stats.errorCount++;
            this.emit('error', { type: 'symbolTableLoad', uri, error });
            return null;
        }
    }
    
    /**
     * Save import cache data
     */
    async saveImportCache(importData: Map<string, CachedImport>): Promise<void> {
        const key = 'imports:global';
        const data = Array.from(importData.entries());
        
        const entry = await this.createCacheEntry(key, data);
        this.importCache.set(key, entry);
        this.isDirty = true;
        
        this.emit('importCacheSaved', { entryCount: data.length });
    }
    
    /**
     * Load import cache data
     */
    async loadImportCache(): Promise<Map<string, CachedImport> | null> {
        const key = 'imports:global';
        const entry = this.importCache.get(key);
        
        if (!entry) {
            return null;
        }
        
        if (!await this.validateCacheEntry(entry)) {
            this.importCache.delete(key);
            this.isDirty = true;
            return null;
        }
        
        try {
            const importCache = new Map<string, CachedImport>(entry.data);
            this.emit('importCacheLoaded', { entryCount: importCache.size });
            return importCache;
        } catch (error) {
            this.stats.errorCount++;
            this.emit('error', { type: 'importCacheLoad', error });
            return null;
        }
    }
    
    /**
     * Save specific cached import
     */
    async saveCachedImport(key: string, cachedImport: CachedImport): Promise<void> {
        const cacheKey = `import:${key}`;
        const entry = await this.createCacheEntry(cacheKey, cachedImport);
        this.importCache.set(cacheKey, entry);
        this.isDirty = true;
        
        this.emit('cachedImportSaved', { key, uri: cachedImport.uri });
    }
    
    /**
     * Load specific cached import
     */
    async loadCachedImport(key: string): Promise<CachedImport | null> {
        const cacheKey = `import:${key}`;
        const entry = this.importCache.get(cacheKey);
        
        if (!entry) {
            return null;
        }
        
        if (!await this.validateCacheEntry(entry)) {
            this.importCache.delete(cacheKey);
            this.isDirty = true;
            return null;
        }
        
        try {
            return entry.data as CachedImport;
        } catch (error) {
            this.stats.errorCount++;
            this.emit('error', { type: 'cachedImportLoad', key, error });
            return null;
        }
    }
    
    /**
     * Invalidate cache entries based on predicate
     */
    invalidateEntries(predicate: (key: string, entry: PersistentCacheEntry) => boolean): number {
        let invalidatedCount = 0;
        
        // Check symbol cache
        for (const [key, entry] of this.symbolCache) {
            if (predicate(key, entry)) {
                this.symbolCache.delete(key);
                invalidatedCount++;
            }
        }
        
        // Check import cache
        for (const [key, entry] of this.importCache) {
            if (predicate(key, entry)) {
                this.importCache.delete(key);
                invalidatedCount++;
            }
        }
        
        if (invalidatedCount > 0) {
            this.isDirty = true;
            this.emit('entriesInvalidated', { count: invalidatedCount });
        }
        
        return invalidatedCount;
    }
    
    /**
     * Invalidate entries older than specified timestamp
     */
    invalidateOlderThan(timestamp: number): number {
        return this.invalidateEntries((key, entry) => entry.timestamp < timestamp);
    }
    
    /**
     * Invalidate entries for specific URI
     */
    invalidateByUri(uri: string): number {
        return this.invalidateEntries((key, entry) => {
            if (key.startsWith('symbols:')) {
                return key === `symbols:${uri}`;
            }
            if (key.startsWith('import:')) {
                const importData = entry.data as CachedImport;
                return importData.uri === uri;
            }
            return false;
        });
    }
    
    /**
     * Force save all cache data to disk
     */
    async save(): Promise<void> {
        if (!this.isDirty) {
            return;
        }
        
        try {
            await this.saveCacheFiles();
            this.isDirty = false;
            this.stats.saveCount++;
            this.stats.lastSave = Date.now();
            this.emit('saved', { entriesCount: this.stats.totalEntries });
        } catch (error) {
            this.stats.errorCount++;
            this.emit('error', { type: 'save', error });
            throw error;
        }
    }
    
    /**
     * Load cache data from disk
     */
    async loadCache(): Promise<void> {
        try {
            await this.loadCacheFiles();
            this.stats.loadCount++;
            this.stats.lastLoad = Date.now();
            this.updateStats();
        } catch (error) {
            this.stats.errorCount++;
            this.emit('error', { type: 'load', error });
            throw error;
        }
    }
    
    /**
     * Clear all cache data
     */
    async clearCache(): Promise<void> {
        this.symbolCache.clear();
        this.importCache.clear();
        this.isDirty = true;
        
        try {
            await this.deleteCacheFiles();
            this.updateStats();
            this.emit('cleared');
        } catch (error) {
            this.stats.errorCount++;
            this.emit('error', { type: 'clear', error });
            throw error;
        }
    }
    
    /**
     * Get cache statistics
     */
    getStats(): CacheStats {
        this.updateStats();
        return { ...this.stats };
    }
    
    /**
     * Verify cache integrity
     */
    async verifyCacheIntegrity(): Promise<{ isValid: boolean; errors: string[] }> {
        const errors: string[] = [];
        let isValid = true;
        
        // Check symbol cache entries
        for (const [key, entry] of this.symbolCache) {
            if (!await this.validateCacheEntry(entry)) {
                errors.push(`Invalid symbol cache entry: ${key}`);
                isValid = false;
            }
        }
        
        // Check import cache entries
        for (const [key, entry] of this.importCache) {
            if (!await this.validateCacheEntry(entry)) {
                errors.push(`Invalid import cache entry: ${key}`);
                isValid = false;
            }
        }
        
        // Check cache files exist and are readable
        const symbolCacheFile = path.join(this.cacheDir, PersistentCacheManager.SYMBOL_CACHE_FILE);
        const importCacheFile = path.join(this.cacheDir, PersistentCacheManager.IMPORT_CACHE_FILE);
        
        if (fs.existsSync(symbolCacheFile)) {
            try {
                await fs.promises.access(symbolCacheFile, fs.constants.R_OK);
            } catch (error) {
                errors.push(`Symbol cache file not readable: ${error}`);
                isValid = false;
            }
        }
        
        if (fs.existsSync(importCacheFile)) {
            try {
                await fs.promises.access(importCacheFile, fs.constants.R_OK);
            } catch (error) {
                errors.push(`Import cache file not readable: ${error}`);
                isValid = false;
            }
        }
        
        return { isValid, errors };
    }
    
    /**
     * Migrate cache from older version
     */
    async migrateCacheVersion(fromVersion: string, toVersion: string): Promise<void> {
        this.emit('migrationStarted', { fromVersion, toVersion });
        
        try {
            // Create backup before migration
            await this.createBackup(`pre-migration-${fromVersion}-to-${toVersion}`);
            
            // Perform version-specific migrations
            if (fromVersion === '0.9.0' && toVersion === '1.0.0') {
                await this.migrateFrom090To100();
            }
            
            this.emit('migrationCompleted', { fromVersion, toVersion });
        } catch (error) {
            this.stats.errorCount++;
            this.emit('error', { type: 'migration', fromVersion, toVersion, error });
            throw error;
        }
    }
    
    /**
     * Create backup of current cache
     */
    async createBackup(backupName?: string): Promise<string> {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupDir = path.join(this.cacheDir, 'backups', backupName || `backup-${timestamp}`);
        
        await fs.promises.mkdir(backupDir, { recursive: true });
        
        // Copy cache files to backup directory
        const files = [
            PersistentCacheManager.SYMBOL_CACHE_FILE,
            PersistentCacheManager.IMPORT_CACHE_FILE,
            PersistentCacheManager.METADATA_FILE
        ];
        
        for (const file of files) {
            const sourcePath = path.join(this.cacheDir, file);
            const backupPath = path.join(backupDir, file);
            
            if (fs.existsSync(sourcePath)) {
                await fs.promises.copyFile(sourcePath, backupPath);
            }
        }
        
        // Clean up old backups
        await this.cleanupOldBackups();
        
        this.emit('backupCreated', { backupDir });
        return backupDir;
    }
    
    /**
     * Restore from backup
     */
    async restoreFromBackup(backupDir: string): Promise<void> {
        if (!fs.existsSync(backupDir)) {
            throw new Error(`Backup directory does not exist: ${backupDir}`);
        }
        
        // Clear current cache
        await this.clearCache();
        
        // Copy backup files to cache directory
        const files = [
            PersistentCacheManager.SYMBOL_CACHE_FILE,
            PersistentCacheManager.IMPORT_CACHE_FILE,
            PersistentCacheManager.METADATA_FILE
        ];
        
        for (const file of files) {
            const backupPath = path.join(backupDir, file);
            const targetPath = path.join(this.cacheDir, file);
            
            if (fs.existsSync(backupPath)) {
                await fs.promises.copyFile(backupPath, targetPath);
            }
        }
        
        // Reload cache
        await this.loadCache();
        
        this.emit('backupRestored', { backupDir });
    }
    
    /**
     * Destroy the cache manager
     */
    async destroy(): Promise<void> {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
            this.autoSaveTimer = undefined;
        }
        
        if (this.isDirty) {
            await this.save();
        }
        
        this.symbolCache.clear();
        this.importCache.clear();
        this.removeAllListeners();
        
        this.emit('destroyed');
    }
    
    // Private methods
    
    private ensureCacheDirectory(): void {
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
    }
    
    private startAutoSave(): void {
        this.autoSaveTimer = setInterval(async () => {
            if (this.isDirty) {
                try {
                    await this.save();
                } catch (error) {
                    this.emit('error', { type: 'autoSave', error });
                }
            }
        }, this.options.saveInterval);
    }
    
    private async createCacheEntry(key: string, data: any): Promise<PersistentCacheEntry> {
        const serialized = JSON.stringify(data);
        const checksum = this.options.checksumValidation ? 
            crypto.createHash('sha256').update(serialized).digest('hex') : '';
        
        return {
            key,
            data,
            timestamp: Date.now(),
            checksum,
            metadata: {
                size: serialized.length,
                compressed: false
            }
        };
    }
    
    private async validateCacheEntry(entry: PersistentCacheEntry): Promise<boolean> {
        if (!this.options.checksumValidation) {
            return true;
        }
        
        try {
            const serialized = JSON.stringify(entry.data);
            const calculatedChecksum = crypto.createHash('sha256').update(serialized).digest('hex');
            return calculatedChecksum === entry.checksum;
        } catch (error) {
            return false;
        }
    }
    
    private async saveCacheFiles(): Promise<void> {
        // Save symbol cache
        if (this.symbolCache.size > 0) {
            const symbolCacheFile: CacheFile = {
                metadata: this.createCacheMetadata(this.symbolCache),
                entries: Array.from(this.symbolCache.values())
            };
            
            await this.writeCacheFile(
                path.join(this.cacheDir, PersistentCacheManager.SYMBOL_CACHE_FILE),
                symbolCacheFile
            );
        }
        
        // Save import cache
        if (this.importCache.size > 0) {
            const importCacheFile: CacheFile = {
                metadata: this.createCacheMetadata(this.importCache),
                entries: Array.from(this.importCache.values())
            };
            
            await this.writeCacheFile(
                path.join(this.cacheDir, PersistentCacheManager.IMPORT_CACHE_FILE),
                importCacheFile
            );
        }
        
        // Save metadata
        await this.saveMetadata();
    }
    
    private async loadCacheFiles(): Promise<void> {
        // Load symbol cache
        const symbolCacheFile = path.join(this.cacheDir, PersistentCacheManager.SYMBOL_CACHE_FILE);
        if (fs.existsSync(symbolCacheFile)) {
            const symbolCache = await this.readCacheFile(symbolCacheFile);
            if (symbolCache && await this.validateCacheFile(symbolCache)) {
                this.symbolCache.clear();
                for (const entry of symbolCache.entries) {
                    this.symbolCache.set(entry.key, entry);
                }
            }
        }
        
        // Load import cache
        const importCacheFile = path.join(this.cacheDir, PersistentCacheManager.IMPORT_CACHE_FILE);
        if (fs.existsSync(importCacheFile)) {
            const importCache = await this.readCacheFile(importCacheFile);
            if (importCache && await this.validateCacheFile(importCache)) {
                this.importCache.clear();
                for (const entry of importCache.entries) {
                    this.importCache.set(entry.key, entry);
                }
            }
        }
    }
    
    private async writeCacheFile(filePath: string, cacheFile: CacheFile): Promise<void> {
        const data = JSON.stringify(cacheFile);
        
        if (this.options.compressionEnabled) {
            const compressed = await gzip(Buffer.from(data));
            await fs.promises.writeFile(filePath + '.gz', compressed);
            cacheFile.metadata.compressionType = 'gzip';
        } else {
            await fs.promises.writeFile(filePath, data);
            cacheFile.metadata.compressionType = 'none';
        }
    }
    
    private async readCacheFile(filePath: string): Promise<CacheFile | null> {
        try {
            let data: string;
            
            // Try compressed file first
            const compressedPath = filePath + '.gz';
            if (fs.existsSync(compressedPath)) {
                const compressed = await fs.promises.readFile(compressedPath);
                const decompressed = await gunzip(compressed);
                data = decompressed.toString();
            } else if (fs.existsSync(filePath)) {
                data = await fs.promises.readFile(filePath, 'utf-8');
            } else {
                return null;
            }
            
            return JSON.parse(data) as CacheFile;
        } catch (error) {
            this.emit('error', { type: 'readCacheFile', filePath, error });
            return null;
        }
    }
    
    private async validateCacheFile(cacheFile: CacheFile): Promise<boolean> {
        // Check version compatibility
        if (!this.isVersionCompatible(cacheFile.metadata.version)) {
            return false;
        }
        
        // Validate entries
        for (const entry of cacheFile.entries) {
            if (!await this.validateCacheEntry(entry)) {
                return false;
            }
        }
        
        return true;
    }
    
    private createCacheMetadata(cache: Map<string, PersistentCacheEntry>): CacheMetadata {
        const entries = Array.from(cache.values());
        const totalSize = entries.reduce((sum, entry) => {
            return sum + (entry.metadata?.size || 0);
        }, 0);
        
        const serialized = JSON.stringify(entries);
        const checksum = crypto.createHash('sha256').update(serialized).digest('hex');
        
        return {
            version: PersistentCacheManager.CACHE_VERSION,
            timestamp: Date.now(),
            checksum,
            compressionType: this.options.compressionEnabled ? 'gzip' : 'none',
            entryCount: entries.length,
            totalSize
        };
    }
    
    private async saveMetadata(): Promise<void> {
        const metadata = {
            version: PersistentCacheManager.CACHE_VERSION,
            timestamp: Date.now(),
            stats: this.stats,
            options: this.options
        };
        
        const metadataPath = path.join(this.cacheDir, PersistentCacheManager.METADATA_FILE);
        await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    }
    
    private isVersionCompatible(version: string): boolean {
        // Simple version compatibility check
        const [major, minor] = version.split('.').map(Number);
        const [currentMajor, currentMinor] = PersistentCacheManager.CACHE_VERSION.split('.').map(Number);
        
        // Compatible if major version matches and minor version is not newer
        return major === currentMajor && minor <= currentMinor;
    }
    
    private async deleteCacheFiles(): Promise<void> {
        const files = [
            PersistentCacheManager.SYMBOL_CACHE_FILE,
            PersistentCacheManager.SYMBOL_CACHE_FILE + '.gz',
            PersistentCacheManager.IMPORT_CACHE_FILE,
            PersistentCacheManager.IMPORT_CACHE_FILE + '.gz',
            PersistentCacheManager.METADATA_FILE
        ];
        
        for (const file of files) {
            const filePath = path.join(this.cacheDir, file);
            if (fs.existsSync(filePath)) {
                await fs.promises.unlink(filePath);
            }
        }
    }
    
    private updateStats(): void {
        this.stats.totalEntries = this.symbolCache.size + this.importCache.size;
        
        let totalSize = 0;
        let compressedSize = 0;
        
        for (const entry of this.symbolCache.values()) {
            const size = entry.metadata?.size || 0;
            totalSize += size;
            compressedSize += size; // Simplified calculation
        }
        
        for (const entry of this.importCache.values()) {
            const size = entry.metadata?.size || 0;
            totalSize += size;
            compressedSize += size; // Simplified calculation
        }
        
        this.stats.totalSize = totalSize;
        this.stats.compressionRatio = totalSize > 0 ? compressedSize / totalSize : 1.0;
    }
    
    private async migrateFrom090To100(): Promise<void> {
        // Example migration logic - would be specific to actual schema changes
        // This is a placeholder for version-specific migration logic
        this.emit('migrationStep', { step: 'Converting symbol format' });
        
        // Migrate symbol cache entries
        for (const [key, entry] of this.symbolCache) {
            // Perform any necessary data transformations
            entry.metadata = entry.metadata || {};
            entry.metadata.migrated = true;
        }
        
        // Migrate import cache entries
        for (const [key, entry] of this.importCache) {
            // Perform any necessary data transformations
            entry.metadata = entry.metadata || {};
            entry.metadata.migrated = true;
        }
        
        this.isDirty = true;
    }
    
    private async cleanupOldBackups(): Promise<void> {
        const backupsDir = path.join(this.cacheDir, 'backups');
        if (!fs.existsSync(backupsDir)) {
            return;
        }
        
        const backups = await fs.promises.readdir(backupsDir);
        if (backups.length <= this.options.maxBackups) {
            return;
        }
        
        // Sort backups by creation time and remove oldest
        const backupStats = await Promise.all(
            backups.map(async (backup) => {
                const backupPath = path.join(backupsDir, backup);
                const stats = await fs.promises.stat(backupPath);
                return { name: backup, path: backupPath, mtime: stats.mtime };
            })
        );
        
        backupStats.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());
        
        const toDelete = backupStats.slice(0, backupStats.length - this.options.maxBackups);
        for (const backup of toDelete) {
            await fs.promises.rmdir(backup.path, { recursive: true });
        }
    }
}