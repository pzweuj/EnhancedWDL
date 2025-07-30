import * as path from 'path';
import * as fs from 'fs';
import { TaskInfo } from './taskAnalyzer';
import { WDLParser } from './parser';
import { TaskAnalyzer } from './taskAnalyzer';
import * as AST from './ast';
import { FileSystemWatcher, FileChangeEvent } from './fileSystemWatcher';
import { CacheManager } from './cacheManager';

export interface ImportResult {
    success: boolean;
    tasks: TaskInfo[];
    errors: string[];
    lastModified: number;
    dependencies: string[];
}

export interface CachedImport {
    uri: string;
    path: string;
    alias?: string;
    tasks: TaskInfo[];
    lastModified: number;
    dependencies: string[];
    errors: string[];
    cacheTimestamp: number;
}

export interface ImportCache {
    imports: Map<string, CachedImport>;
    lastCleanup: number;
}

export interface CacheStatistics {
    size: number;
    hitRate: number;
    lastCleanup: number;
    memoryUsage: number;
    evictionCount: number;
    watchedFiles: number;
}

export class ImportResolver {
    private taskAnalyzer: TaskAnalyzer;
    private cacheManager: CacheManager<CachedImport>;
    private fileWatcher: FileSystemWatcher;
    private watchedDirectories: Set<string> = new Set();
    private readonly MAX_RECURSION_DEPTH = 10;
    
    constructor() {
        this.taskAnalyzer = new TaskAnalyzer();
        
        // Initialize cache manager with optimized settings
        this.cacheManager = new CacheManager<CachedImport>({
            maxSize: 200,
            ttl: 10 * 60 * 1000, // 10 minutes
            maxMemoryUsage: 100 * 1024 * 1024, // 100MB
            cleanupInterval: 2 * 60 * 1000, // 2 minutes
            enableStats: true
        });
        
        // Initialize file system watcher
        this.fileWatcher = new FileSystemWatcher({
            recursive: true,
            ignored: [/node_modules/, /\.git/, /\.vscode/, /out/, /build/],
            debounceMs: 200
        });
        
        this.setupEventHandlers();
    }
    
    /**
     * Resolve an import and return all tasks from the imported file
     */
    async resolveImport(importPath: string, baseUri: string, alias?: string): Promise<ImportResult> {
        const resolvedPath = this.resolveImportPath(importPath, baseUri);
        if (!resolvedPath) {
            return {
                success: false,
                tasks: [],
                errors: [`Cannot resolve import path: ${importPath}`],
                lastModified: 0,
                dependencies: []
            };
        }
        
        // Check cache first
        const cacheKey = this.getCacheKey(resolvedPath, alias);
        const cached = this.getCachedImport(cacheKey, resolvedPath);
        if (cached) {
            return {
                success: true,
                tasks: cached.tasks,
                errors: cached.errors,
                lastModified: cached.lastModified,
                dependencies: cached.dependencies
            };
        }
        
        // Resolve import from file system
        const result = await this.resolveImportFromFile(resolvedPath, alias, new Set(), 0);
        
        // Cache the result
        this.cacheImport(cacheKey, {
            uri: resolvedPath,
            path: importPath,
            alias,
            tasks: result.tasks,
            lastModified: result.lastModified,
            dependencies: result.dependencies,
            errors: result.errors,
            cacheTimestamp: Date.now()
        });
        
        return result;
    }
    
    /**
     * Get all imported tasks for a specific document URI
     */
    getImportedTasks(uri: string): TaskInfo[] {
        const tasks: TaskInfo[] = [];
        
        for (const cached of this.cache.imports.values()) {
            if (cached.dependencies.includes(uri)) {
                tasks.push(...cached.tasks);
            }
        }
        
        return tasks;
    }
    
    /**
     * Handle import file change by invalidating related cache entries
     */
    handleImportFileChange(importUri: string): void {
        const toInvalidate: string[] = [];
        
        for (const [key, cached] of this.cache.imports) {
            if (cached.uri === importUri || cached.dependencies.includes(importUri)) {
                toInvalidate.push(key);
            }
        }
        
        for (const key of toInvalidate) {
            this.cache.imports.delete(key);
        }
    }
    
    /**
     * Clean up expired cache entries
     */
    cleanupCache(): void {
        const now = Date.now();
        const toDelete: string[] = [];
        
        for (const [key, cached] of this.cache.imports) {
            if (now - cached.cacheTimestamp > this.CACHE_TTL) {
                toDelete.push(key);
            }
        }
        
        for (const key of toDelete) {
            this.cache.imports.delete(key);
        }
        
        // If cache is still too large, remove oldest entries
        if (this.cache.imports.size > this.MAX_CACHE_SIZE) {
            const entries = Array.from(this.cache.imports.entries())
                .sort((a, b) => a[1].cacheTimestamp - b[1].cacheTimestamp);
            
            const toRemove = entries.slice(0, entries.length - this.MAX_CACHE_SIZE);
            for (const [key] of toRemove) {
                this.cache.imports.delete(key);
            }
        }
        
        this.cache.lastCleanup = now;
    }
    
    /**
     * Get cache statistics
     */
    getCacheStats(): { size: number; hitRate: number; lastCleanup: number } {
        return {
            size: this.cache.imports.size,
            hitRate: 0, // TODO: Implement hit rate tracking
            lastCleanup: this.cache.lastCleanup
        };
    }
    
    /**
     * Clear all cache entries
     */
    clearCache(): void {
        this.cache.imports.clear();
        this.cache.lastCleanup = Date.now();
    }
    
    // Private methods
    
    /**
     * Resolve import path relative to base URI
     */
    private resolveImportPath(importPath: string, baseUri: string): string | null {
        try {
            // Handle different URI schemes
            let basePath: string;
            if (baseUri.startsWith('file://')) {
                basePath = path.dirname(baseUri.substring(7));
            } else {
                basePath = path.dirname(baseUri);
            }
            
            // Resolve relative path
            const resolved = path.resolve(basePath, importPath);
            
            // Ensure the file exists
            if (fs.existsSync(resolved)) {
                return resolved;
            }
            
            // Try with .wdl extension if not present
            if (!resolved.endsWith('.wdl')) {
                const withExtension = resolved + '.wdl';
                if (fs.existsSync(withExtension)) {
                    return withExtension;
                }
            }
            
            return null;
        } catch (error) {
            return null;
        }
    }
    
    /**
     * Resolve import from file system with recursion handling
     */
    private async resolveImportFromFile(
        filePath: string, 
        alias: string | undefined, 
        visited: Set<string>, 
        depth: number
    ): Promise<ImportResult> {
        // Check for circular dependencies
        if (visited.has(filePath)) {
            return {
                success: false,
                tasks: [],
                errors: [`Circular dependency detected: ${filePath}`],
                lastModified: 0,
                dependencies: Array.from(visited)
            };
        }
        
        // Check recursion depth
        if (depth > this.MAX_RECURSION_DEPTH) {
            return {
                success: false,
                tasks: [],
                errors: [`Maximum recursion depth exceeded: ${filePath}`],
                lastModified: 0,
                dependencies: Array.from(visited)
            };
        }
        
        try {
            // Read file
            const content = fs.readFileSync(filePath, 'utf-8');
            const stats = fs.statSync(filePath);
            
            // Parse WDL content
            const parser = new WDLParser(content);
            const ast = parser.parse();
            
            const tasks: TaskInfo[] = [];
            const errors: string[] = [];
            const dependencies = new Set(visited);
            dependencies.add(filePath);
            
            // Extract tasks from AST
            for (const taskDecl of ast.tasks) {
                try {
                    const taskInfo = this.taskAnalyzer.analyzeTask(taskDecl, filePath);
                    
                    // Apply alias if provided
                    if (alias) {
                        taskInfo.name = `${alias}.${taskInfo.name}`;
                    }
                    
                    tasks.push(taskInfo);
                } catch (error) {
                    errors.push(`Error analyzing task ${taskDecl.name}: ${error}`);
                }
            }
            
            // Recursively resolve nested imports
            for (const importDecl of ast.imports) {
                const nestedPath = this.resolveImportPath(importDecl.path, filePath);
                if (nestedPath) {
                    const nestedResult = await this.resolveImportFromFile(
                        nestedPath, 
                        importDecl.alias, 
                        new Set(dependencies), 
                        depth + 1
                    );
                    
                    if (nestedResult.success) {
                        // Add nested tasks with proper aliasing
                        for (const task of nestedResult.tasks) {
                            const aliasedTask = { ...task };
                            if (importDecl.alias) {
                                // Remove any existing alias prefix and add the current one
                                const originalName = task.name.includes('.') ? 
                                    task.name.split('.').pop() : task.name;
                                aliasedTask.name = alias ? 
                                    `${alias}.${importDecl.alias}.${originalName}` :
                                    `${importDecl.alias}.${originalName}`;
                            } else if (alias) {
                                // Apply parent alias if no nested alias
                                const originalName = task.name.includes('.') ? 
                                    task.name.split('.').pop() : task.name;
                                aliasedTask.name = `${alias}.${originalName}`;
                            }
                            tasks.push(aliasedTask);
                        }
                        
                        // Merge dependencies
                        for (const dep of nestedResult.dependencies) {
                            dependencies.add(dep);
                        }
                    } else {
                        errors.push(...nestedResult.errors);
                    }
                } else {
                    errors.push(`Cannot resolve nested import: ${importDecl.path} from ${filePath}`);
                }
            }
            
            return {
                success: errors.length === 0,
                tasks,
                errors,
                lastModified: stats.mtime.getTime(),
                dependencies: Array.from(dependencies)
            };
            
        } catch (error) {
            return {
                success: false,
                tasks: [],
                errors: [`Error reading or parsing file ${filePath}: ${error}`],
                lastModified: 0,
                dependencies: Array.from(visited)
            };
        }
    }
    
    /**
     * Get cached import if valid
     */
    private getCachedImport(cacheKey: string, filePath: string): CachedImport | null {
        const cached = this.cache.imports.get(cacheKey);
        if (!cached) {
            return null;
        }
        
        // Check if cache is expired
        const now = Date.now();
        if (now - cached.cacheTimestamp > this.CACHE_TTL) {
            this.cache.imports.delete(cacheKey);
            return null;
        }
        
        // Check if file has been modified
        try {
            const stats = fs.statSync(filePath);
            if (stats.mtime.getTime() > cached.lastModified) {
                this.cache.imports.delete(cacheKey);
                return null;
            }
        } catch (error) {
            // File doesn't exist anymore
            this.cache.imports.delete(cacheKey);
            return null;
        }
        
        return cached;
    }
    
    /**
     * Cache import result
     */
    private cacheImport(cacheKey: string, cached: CachedImport): void {
        // Clean up cache if needed
        if (Date.now() - this.cache.lastCleanup > this.CACHE_TTL) {
            this.cleanupCache();
        }
        
        this.cache.imports.set(cacheKey, cached);
    }
    
    /**
     * Generate cache key for import
     */
    private getCacheKey(filePath: string, alias?: string): string {
        return `${filePath}#${alias || ''}`;
    }
}