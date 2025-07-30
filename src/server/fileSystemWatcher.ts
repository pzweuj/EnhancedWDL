import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

export interface FileChangeEvent {
    uri: string;
    type: 'created' | 'modified' | 'deleted';
    timestamp: number;
}

export interface WatcherOptions {
    recursive?: boolean;
    ignored?: RegExp[];
    debounceMs?: number;
}

export class FileSystemWatcher extends EventEmitter {
    private watchers: Map<string, fs.FSWatcher> = new Map();
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
    private readonly options: WatcherOptions;
    
    constructor(options: WatcherOptions = {}) {
        super();
        this.options = {
            recursive: true,
            ignored: [/node_modules/, /\.git/, /\.vscode/],
            debounceMs: 100,
            ...options
        };
    }
    
    /**
     * Watch a file or directory for changes
     */
    watch(filePath: string): void {
        if (this.watchers.has(filePath)) {
            return; // Already watching
        }
        
        try {
            const stats = fs.statSync(filePath);
            
            if (stats.isDirectory()) {
                this.watchDirectory(filePath);
            } else {
                this.watchFile(filePath);
            }
        } catch (error) {
            this.emit('error', new Error(`Failed to watch ${filePath}: ${error}`));
        }
    }
    
    /**
     * Stop watching a file or directory
     */
    unwatch(filePath: string): void {
        const watcher = this.watchers.get(filePath);
        if (watcher) {
            watcher.close();
            this.watchers.delete(filePath);
        }
        
        // Clear any pending debounce timer
        const timer = this.debounceTimers.get(filePath);
        if (timer) {
            clearTimeout(timer);
            this.debounceTimers.delete(filePath);
        }
    }
    
    /**
     * Stop watching all files and directories
     */
    unwatchAll(): void {
        for (const [filePath] of this.watchers) {
            this.unwatch(filePath);
        }
    }
    
    /**
     * Get list of currently watched paths
     */
    getWatchedPaths(): string[] {
        return Array.from(this.watchers.keys());
    }
    
    /**
     * Check if a path is currently being watched
     */
    isWatching(filePath: string): boolean {
        return this.watchers.has(filePath);
    }
    
    // Private methods
    
    private watchFile(filePath: string): void {
        try {
            const watcher = fs.watch(filePath, (eventType, filename) => {
                this.handleFileChange(filePath, eventType);
            });
            
            watcher.on('error', (error) => {
                this.emit('error', new Error(`File watcher error for ${filePath}: ${error}`));
                this.watchers.delete(filePath);
            });
            
            this.watchers.set(filePath, watcher);
        } catch (error) {
            this.emit('error', new Error(`Failed to watch file ${filePath}: ${error}`));
        }
    }
    
    private watchDirectory(dirPath: string): void {
        try {
            const watcher = fs.watch(dirPath, { recursive: this.options.recursive }, (eventType, filename) => {
                if (filename) {
                    const fullPath = path.join(dirPath, filename);
                    
                    // Check if file should be ignored
                    if (this.shouldIgnore(fullPath)) {
                        return;
                    }
                    
                    // Only watch .wdl files
                    if (!fullPath.endsWith('.wdl')) {
                        return;
                    }
                    
                    this.handleFileChange(fullPath, eventType);
                }
            });
            
            watcher.on('error', (error) => {
                this.emit('error', new Error(`Directory watcher error for ${dirPath}: ${error}`));
                this.watchers.delete(dirPath);
            });
            
            this.watchers.set(dirPath, watcher);
        } catch (error) {
            this.emit('error', new Error(`Failed to watch directory ${dirPath}: ${error}`));
        }
    }
    
    private handleFileChange(filePath: string, eventType: string): void {
        // Debounce file changes to avoid excessive events
        const existingTimer = this.debounceTimers.get(filePath);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }
        
        const timer = setTimeout(() => {
            this.debounceTimers.delete(filePath);
            this.emitFileChange(filePath, eventType);
        }, this.options.debounceMs);
        
        this.debounceTimers.set(filePath, timer);
    }
    
    private emitFileChange(filePath: string, eventType: string): void {
        let changeType: 'created' | 'modified' | 'deleted';
        
        try {
            const exists = fs.existsSync(filePath);
            
            if (!exists) {
                changeType = 'deleted';
            } else if (eventType === 'rename') {
                changeType = 'created';
            } else {
                changeType = 'modified';
            }
        } catch (error) {
            changeType = 'deleted';
        }
        
        const event: FileChangeEvent = {
            uri: filePath,
            type: changeType,
            timestamp: Date.now()
        };
        
        this.emit('change', event);
    }
    
    private shouldIgnore(filePath: string): boolean {
        if (!this.options.ignored) {
            return false;
        }
        
        return this.options.ignored.some(pattern => pattern.test(filePath));
    }
}