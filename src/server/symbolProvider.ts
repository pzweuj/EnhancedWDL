import { DocumentAnalyzer, DocumentInfo } from './documentAnalyzer';
import { TaskInfo, ParameterInfo } from './taskAnalyzer';
import { PersistentCacheManager } from './persistentCacheManager';
import * as AST from './ast';

export interface TaskSource {
    type: 'local' | 'imported';
    sourceFile: string;
    importAlias?: string;
    importPath?: string;
}

export interface EnhancedTaskSymbol extends TaskSymbol {
    // Task source information
    source: TaskSource;
    
    // Import alias (if applicable)
    importAlias?: string;
    
    // Original task name (without alias prefix)
    originalName: string;
    
    // Fully qualified name (including alias)
    fullyQualifiedName: string;
    
    // Import path (if imported task)
    importPath?: string;
    
    // Cache timestamp
    cacheTimestamp: number;
}

export interface TaskSymbol {
    name: string;
    inputs: ParameterInfo[];
    outputs: ParameterInfo[];
    description?: string;
    sourceFile: string;
    range: AST.Range;
    qualifiedName?: string; // For imported tasks with alias
}

export interface WorkflowSymbol {
    name: string;
    inputs: ParameterInfo[];
    outputs: ParameterInfo[];
    sourceFile: string;
    range: AST.Range;
}

export interface SymbolTable {
    tasks: Map<string, TaskSymbol>;
    workflows: Map<string, WorkflowSymbol>;
    lastModified: Map<string, number>;
}

export class SymbolProvider {
    private documentAnalyzer: DocumentAnalyzer;
    private symbolTable: SymbolTable;
    private persistentCache: PersistentCacheManager;
    private isInitialized: boolean = false;
    
    constructor() {
        this.documentAnalyzer = new DocumentAnalyzer();
        this.symbolTable = {
            tasks: new Map(),
            workflows: new Map(),
            lastModified: new Map()
        };
        this.persistentCache = new PersistentCacheManager({
            cacheDir: '.wdl-cache/symbols',
            compressionEnabled: true,
            checksumValidation: true,
            autoSave: true,
            saveInterval: 2 * 60 * 1000 // 2 minutes
        });
        
        this.setupCacheEventHandlers();
    }
    
    /**
     * Initialize the symbol provider with persistent cache
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }
        
        try {
            await this.persistentCache.initialize();
            await this.loadSymbolTableFromCache();
            this.isInitialized = true;
        } catch (error) {
            console.warn('Failed to initialize persistent cache, continuing without cache:', error);
            this.isInitialized = true;
        }
    }
    
    /**
     * Setup event handlers for cache events
     */
    private setupCacheEventHandlers(): void {
        this.persistentCache.on('error', (event) => {
            console.warn('Persistent cache error:', event);
        });
        
        this.persistentCache.on('saved', (event) => {
            console.log('Symbol cache saved:', event);
        });
        
        this.persistentCache.on('migrationStarted', (event) => {
            console.log('Cache migration started:', event);
        });
    }
    
    /**
     * Load symbol table from persistent cache
     */
    private async loadSymbolTableFromCache(): Promise<void> {
        try {
            // Try to load from cache for each known document
            const cachedSymbols = await this.persistentCache.loadSymbolTable('global');
            if (cachedSymbols) {
                this.symbolTable = cachedSymbols;
                console.log(`Loaded ${cachedSymbols.tasks.size} tasks and ${cachedSymbols.workflows.size} workflows from cache`);
            }
        } catch (error) {
            console.warn('Failed to load symbol table from cache:', error);
        }
    }
    
    /**
     * Save symbol table to persistent cache
     */
    private async saveSymbolTableToCache(): Promise<void> {
        if (!this.isInitialized) {
            return;
        }
        
        try {
            await this.persistentCache.saveSymbolTable(this.symbolTable, 'global');
        } catch (error) {
            console.warn('Failed to save symbol table to cache:', error);
        }
    }
    
    /**
     * Update symbols for a document
     */
    async updateDocument(content: string, uri: string): Promise<void> {
        const docInfo = await this.documentAnalyzer.analyzeDocument(content, uri);
        
        // Remove old symbols from this document
        this.removeDocumentSymbols(uri);
        
        // Add new symbols
        await this.addDocumentSymbols(docInfo);
        
        // Update last modified time
        this.symbolTable.lastModified.set(uri, Date.now());
        
        // Save to persistent cache
        await this.saveSymbolTableToCache();
    }
    
    /**
     * Remove document from symbol table
     */
    async removeDocument(uri: string): Promise<void> {
        this.removeDocumentSymbols(uri);
        this.symbolTable.lastModified.delete(uri);
        this.documentAnalyzer.clearCache(uri);
        
        // Invalidate cache entries for this URI
        await this.persistentCache.invalidateByUri(uri);
        
        // Save updated symbol table to cache
        await this.saveSymbolTableToCache();
    }
    
    /**
     * Get task symbol by name with enhanced alias handling
     */
    getTaskSymbol(taskName: string, contextUri?: string): TaskSymbol | undefined {
        // If we have context, use the enhanced alias resolution
        if (contextUri) {
            const resolved = this.resolveTaskByAlias(taskName, contextUri);
            if (resolved) {
                return resolved;
            }
        }
        
        // First try exact match in symbol table
        let symbol = this.symbolTable.tasks.get(taskName);
        if (symbol) {
            return symbol;
        }
        
        // Try partial matches (for qualified names)
        for (const [key, value] of this.symbolTable.tasks) {
            if (key.endsWith(`.${taskName}`) || value.qualifiedName === taskName) {
                return value;
            }
        }
        
        // Try matching by original name
        const originalName = this.extractOriginalTaskName(taskName);
        for (const [key, value] of this.symbolTable.tasks) {
            const symbolOriginalName = this.extractOriginalTaskName(value.name);
            if (symbolOriginalName === originalName) {
                return value;
            }
        }
        
        return undefined;
    }
    
    /**
     * Get all task symbols
     */
    getAllTaskSymbols(): TaskSymbol[] {
        return Array.from(this.symbolTable.tasks.values());
    }
    
    /**
     * Get task symbols available in a specific document context
     */
    getTaskSymbolsInContext(uri: string): TaskSymbol[] {
        const docInfo = this.documentAnalyzer.getCachedDocument(uri);
        if (!docInfo) {
            return [];
        }
        
        const symbols: TaskSymbol[] = [];
        
        // Add local tasks
        for (const task of docInfo.tasks) {
            const symbol = this.taskInfoToSymbol(task);
            symbols.push(symbol);
        }
        
        // Add imported tasks
        for (const importInfo of docInfo.imports) {
            if (importInfo.tasks) {
                for (const task of importInfo.tasks) {
                    const symbol = this.taskInfoToSymbol(task);
                    // The task name already includes the alias from ImportResolver
                    symbol.qualifiedName = task.name;
                    symbols.push(symbol);
                }
            }
        }
        
        return symbols;
    }
    
    /**
     * Get workflow symbol by name
     */
    getWorkflowSymbol(workflowName: string): WorkflowSymbol | undefined {
        return this.symbolTable.workflows.get(workflowName);
    }
    
    /**
     * Get all workflow symbols
     */
    getAllWorkflowSymbols(): WorkflowSymbol[] {
        return Array.from(this.symbolTable.workflows.values());
    }
    
    /**
     * Find symbols by prefix (for autocomplete) with enhanced alias handling
     */
    findTaskSymbolsByPrefix(prefix: string, contextUri?: string): TaskSymbol[] {
        const symbols: TaskSymbol[] = [];
        
        if (contextUri) {
            // Get context-specific symbols with enhanced handling
            const contextSymbols = this.getAllAvailableTasksInContext(contextUri);
            for (const symbol of contextSymbols) {
                // Check various name formats
                if (symbol.name.startsWith(prefix) || 
                    (symbol.qualifiedName && symbol.qualifiedName.startsWith(prefix))) {
                    symbols.push(symbol);
                    continue;
                }
                
                // Check original name without alias
                const originalName = this.extractOriginalTaskName(symbol.name);
                if (originalName.startsWith(prefix)) {
                    symbols.push(symbol);
                    continue;
                }
                
                // Check if prefix matches alias part
                if (this.hasAliasPrefix(symbol.name)) {
                    const alias = this.extractAlias(symbol.name);
                    if (alias && prefix.startsWith(alias)) {
                        symbols.push(symbol);
                    }
                }
            }
        } else {
            // Search all symbols
            for (const symbol of this.symbolTable.tasks.values()) {
                if (symbol.name.startsWith(prefix) || 
                    (symbol.qualifiedName && symbol.qualifiedName.startsWith(prefix))) {
                    symbols.push(symbol);
                    continue;
                }
                
                // Check original name
                const originalName = this.extractOriginalTaskName(symbol.name);
                if (originalName.startsWith(prefix)) {
                    symbols.push(symbol);
                }
            }
        }
        
        // Remove duplicates based on name
        const uniqueSymbols = symbols.filter((symbol, index, array) => 
            array.findIndex(s => s.name === symbol.name) === index
        );
        
        return uniqueSymbols;
    }
    
    /**
     * Get symbol at a specific position
     */
    getSymbolAtPosition(uri: string, line: number, column: number): TaskSymbol | WorkflowSymbol | undefined {
        // Check tasks
        for (const symbol of this.symbolTable.tasks.values()) {
            if (symbol.sourceFile === uri && this.isPositionInRange(line, column, symbol.range)) {
                return symbol;
            }
        }
        
        // Check workflows
        for (const symbol of this.symbolTable.workflows.values()) {
            if (symbol.sourceFile === uri && this.isPositionInRange(line, column, symbol.range)) {
                return symbol;
            }
        }
        
        return undefined;
    }
    
    /**
     * Validate that a task exists and is accessible
     */
    validateTaskReference(taskName: string, contextUri: string): boolean {
        return this.getTaskSymbol(taskName, contextUri) !== undefined;
    }
    
    /**
     * Get input parameter names for a task
     */
    getTaskInputNames(taskName: string, contextUri?: string): string[] {
        const symbol = this.getTaskSymbol(taskName, contextUri);
        return symbol ? symbol.inputs.map(input => input.name) : [];
    }
    
    /**
     * Get output parameter names for a task
     */
    getTaskOutputNames(taskName: string, contextUri?: string): string[] {
        const symbol = this.getTaskSymbol(taskName, contextUri);
        return symbol ? symbol.outputs.map(output => output.name) : [];
    }
    
    /**
     * Get parameter info for a specific input
     */
    getTaskInputParameter(taskName: string, paramName: string, contextUri?: string): ParameterInfo | undefined {
        const symbol = this.getTaskSymbol(taskName, contextUri);
        if (!symbol) return undefined;
        
        return symbol.inputs.find(input => input.name === paramName);
    }
    
    /**
     * Get parameter info for a specific output
     */
    getTaskOutputParameter(taskName: string, paramName: string, contextUri?: string): ParameterInfo | undefined {
        const symbol = this.getTaskSymbol(taskName, contextUri);
        if (!symbol) return undefined;
        
        return symbol.outputs.find(output => output.name === paramName);
    }
    
    /**
     * Clear all symbols
     */
    clearAll(): void {
        this.symbolTable.tasks.clear();
        this.symbolTable.workflows.clear();
        this.symbolTable.lastModified.clear();
        this.documentAnalyzer.clearCache();
    }
    
    /**
     * Get statistics about the symbol table
     */
    getStatistics(): {taskCount: number, workflowCount: number, documentCount: number} {
        return {
            taskCount: this.symbolTable.tasks.size,
            workflowCount: this.symbolTable.workflows.size,
            documentCount: this.symbolTable.lastModified.size
        };
    }
    
    /**
     * Get document analyzer instance
     */
    getDocumentAnalyzer(): DocumentAnalyzer {
        return this.documentAnalyzer;
    }
    
    /**
     * Get persistent cache manager instance
     */
    getPersistentCache(): PersistentCacheManager {
        return this.persistentCache;
    }
    
    /**
     * Destroy the symbol provider and clean up resources
     */
    async destroy(): Promise<void> {
        await this.persistentCache.destroy();
    }
    
    /**
     * Resolve task by alias, handling import aliases correctly
     */
    resolveTaskByAlias(taskName: string, contextUri: string): TaskSymbol | undefined {
        const docInfo = this.documentAnalyzer.getCachedDocument(contextUri);
        if (!docInfo) {
            return undefined;
        }
        
        // Check if taskName contains alias (e.g., "utils.ValidateFile")
        if (taskName.includes('.')) {
            const parts = taskName.split('.');
            const alias = parts[0];
            const originalTaskName = parts.slice(1).join('.');
            
            // Find the import with this alias
            for (const importInfo of docInfo.imports) {
                if (importInfo.alias === alias && importInfo.tasks) {
                    for (const task of importInfo.tasks) {
                        // Check if the task name matches (considering it might already have alias prefix)
                        if (task.name === taskName || task.name.endsWith(originalTaskName)) {
                            return this.taskInfoToSymbol(task);
                        }
                    }
                }
            }
        } else {
            // Check local tasks first
            for (const task of docInfo.tasks) {
                if (task.name === taskName) {
                    return this.taskInfoToSymbol(task);
                }
            }
            
            // Check imported tasks without alias
            for (const importInfo of docInfo.imports) {
                if (!importInfo.alias && importInfo.tasks) {
                    for (const task of importInfo.tasks) {
                        if (task.name === taskName) {
                            return this.taskInfoToSymbol(task);
                        }
                    }
                }
            }
            
            // Check if taskName matches the original name of any imported task
            for (const importInfo of docInfo.imports) {
                if (importInfo.tasks) {
                    for (const task of importInfo.tasks) {
                        const originalName = this.extractOriginalTaskName(task.name);
                        if (originalName === taskName) {
                            return this.taskInfoToSymbol(task);
                        }
                    }
                }
            }
        }
        
        return undefined;
    }
    
    /**
     * Get all available tasks in context, including imported tasks
     */
    getAllAvailableTasksInContext(uri: string): TaskSymbol[] {
        const docInfo = this.documentAnalyzer.getCachedDocument(uri);
        if (!docInfo) {
            return [];
        }
        
        const symbols: TaskSymbol[] = [];
        const seenNames = new Set<string>();
        
        // Add local tasks first
        for (const task of docInfo.tasks) {
            const symbol = this.taskInfoToSymbol(task);
            if (!seenNames.has(symbol.name)) {
                symbols.push(symbol);
                seenNames.add(symbol.name);
            }
        }
        
        // Add imported tasks
        for (const importInfo of docInfo.imports) {
            if (importInfo.tasks) {
                for (const task of importInfo.tasks) {
                    const symbol = this.taskInfoToSymbol(task);
                    symbol.qualifiedName = task.name;
                    
                    if (!seenNames.has(symbol.name)) {
                        symbols.push(symbol);
                        seenNames.add(symbol.name);
                    }
                }
            }
        }
        
        return symbols;
    }
    
    /**
     * Get the qualified task name (with alias if applicable)
     */
    getQualifiedTaskName(taskName: string, contextUri: string): string | undefined {
        const docInfo = this.documentAnalyzer.getCachedDocument(contextUri);
        if (!docInfo) {
            return undefined;
        }
        
        // Check local tasks first
        for (const task of docInfo.tasks) {
            if (task.name === taskName) {
                return task.name; // Local tasks don't need qualification
            }
        }
        
        // Check imported tasks
        for (const importInfo of docInfo.imports) {
            if (importInfo.tasks) {
                for (const task of importInfo.tasks) {
                    // Check both original name and aliased name
                    const originalName = this.extractOriginalTaskName(task.name);
                    if (originalName === taskName || task.name === taskName) {
                        return task.name; // Return the full aliased name
                    }
                }
            }
        }
        
        return undefined;
    }
    
    /**
     * Check if a task is imported (vs local)
     */
    isImportedTask(taskName: string, contextUri: string): boolean {
        const docInfo = this.documentAnalyzer.getCachedDocument(contextUri);
        if (!docInfo) {
            return false;
        }
        
        // Check if it's a local task
        for (const task of docInfo.tasks) {
            if (task.name === taskName) {
                return false; // It's local
            }
        }
        
        // Check if it's an imported task
        for (const importInfo of docInfo.imports) {
            if (importInfo.tasks) {
                for (const task of importInfo.tasks) {
                    if (task.name === taskName) {
                        return true; // It's imported
                    }
                }
            }
        }
        
        return false; // Not found
    }
    
    /**
     * Get task source information
     */
    getTaskSource(taskName: string, contextUri: string): TaskSource | undefined {
        const docInfo = this.documentAnalyzer.getCachedDocument(contextUri);
        if (!docInfo) {
            return undefined;
        }
        
        // Check local tasks first
        for (const task of docInfo.tasks) {
            if (task.name === taskName) {
                return {
                    type: 'local',
                    sourceFile: task.sourceFile
                };
            }
        }
        
        // Check imported tasks
        for (const importInfo of docInfo.imports) {
            if (importInfo.tasks) {
                for (const task of importInfo.tasks) {
                    if (task.name === taskName) {
                        return {
                            type: 'imported',
                            sourceFile: task.sourceFile,
                            importAlias: importInfo.alias,
                            importPath: importInfo.path
                        };
                    }
                }
            }
        }
        
        return undefined;
    }
    
    /**
     * Enhanced task symbol creation with source information
     */
    createEnhancedTaskSymbol(task: TaskInfo, source: TaskSource): EnhancedTaskSymbol {
        const originalName = this.extractOriginalTaskName(task.name);
        
        return {
            name: task.name,
            inputs: task.inputs,
            outputs: task.outputs,
            description: task.description,
            sourceFile: task.sourceFile,
            range: task.range,
            qualifiedName: task.name,
            source,
            importAlias: source.importAlias,
            originalName,
            fullyQualifiedName: task.name,
            importPath: source.importPath,
            cacheTimestamp: Date.now()
        };
    }
    
    /**
     * Get enhanced task symbols with full source information
     */
    getEnhancedTaskSymbolsInContext(uri: string): EnhancedTaskSymbol[] {
        const docInfo = this.documentAnalyzer.getCachedDocument(uri);
        if (!docInfo) {
            return [];
        }
        
        const symbols: EnhancedTaskSymbol[] = [];
        
        // Add local tasks
        for (const task of docInfo.tasks) {
            const source: TaskSource = {
                type: 'local',
                sourceFile: task.sourceFile
            };
            symbols.push(this.createEnhancedTaskSymbol(task, source));
        }
        
        // Add imported tasks
        for (const importInfo of docInfo.imports) {
            if (importInfo.tasks) {
                for (const task of importInfo.tasks) {
                    const source: TaskSource = {
                        type: 'imported',
                        sourceFile: task.sourceFile,
                        importAlias: importInfo.alias,
                        importPath: importInfo.path
                    };
                    symbols.push(this.createEnhancedTaskSymbol(task, source));
                }
            }
        }
        
        return symbols;
    }
    
    /**
     * Find tasks by partial name match, considering aliases
     */
    findTasksByPartialName(partialName: string, contextUri: string): TaskSymbol[] {
        const symbols = this.getAllAvailableTasksInContext(contextUri);
        const matches: TaskSymbol[] = [];
        
        for (const symbol of symbols) {
            // Check if the partial name matches the task name or qualified name
            if (symbol.name.includes(partialName) || 
                (symbol.qualifiedName && symbol.qualifiedName.includes(partialName))) {
                matches.push(symbol);
            }
            
            // Also check if it matches the original name (without alias)
            const originalName = this.extractOriginalTaskName(symbol.name);
            if (originalName.includes(partialName)) {
                matches.push(symbol);
            }
        }
        
        // Remove duplicates
        const uniqueMatches = matches.filter((symbol, index, array) => 
            array.findIndex(s => s.name === symbol.name) === index
        );
        
        return uniqueMatches;
    }
    
    /**
     * Get all import aliases available in a context
     */
    getAvailableAliases(contextUri: string): string[] {
        const docInfo = this.documentAnalyzer.getCachedDocument(contextUri);
        if (!docInfo) {
            return [];
        }
        
        const aliases: string[] = [];
        for (const importInfo of docInfo.imports) {
            if (importInfo.alias) {
                aliases.push(importInfo.alias);
            }
        }
        
        return aliases;
    }
    
    /**
     * Get tasks for a specific import alias
     */
    getTasksForAlias(alias: string, contextUri: string): TaskSymbol[] {
        const docInfo = this.documentAnalyzer.getCachedDocument(contextUri);
        if (!docInfo) {
            return [];
        }
        
        const tasks: TaskSymbol[] = [];
        for (const importInfo of docInfo.imports) {
            if (importInfo.alias === alias && importInfo.tasks) {
                for (const task of importInfo.tasks) {
                    tasks.push(this.taskInfoToSymbol(task));
                }
            }
        }
        
        return tasks;
    }
    
    /**
     * Check if an alias exists in the context
     */
    hasAlias(alias: string, contextUri: string): boolean {
        const aliases = this.getAvailableAliases(contextUri);
        return aliases.includes(alias);
    }
    
    /**
     * Get import information for a specific alias
     */
    getImportInfoForAlias(alias: string, contextUri: string): any {
        const docInfo = this.documentAnalyzer.getCachedDocument(contextUri);
        if (!docInfo) {
            return undefined;
        }
        
        for (const importInfo of docInfo.imports) {
            if (importInfo.alias === alias) {
                return {
                    path: importInfo.path,
                    alias: importInfo.alias,
                    resolvedPath: importInfo.resolvedPath,
                    taskCount: importInfo.tasks ? importInfo.tasks.length : 0,
                    errors: importInfo.errors || []
                };
            }
        }
        
        return undefined;
    }
    
    /**
     * Validate task reference with detailed error information
     */
    validateTaskReferenceDetailed(taskName: string, contextUri: string): {
        isValid: boolean;
        error?: string;
        suggestions?: string[];
    } {
        const task = this.getTaskSymbol(taskName, contextUri);
        if (task) {
            return { isValid: true };
        }
        
        // Provide helpful error messages and suggestions
        const suggestions: string[] = [];
        
        // Check if it might be a typo in alias
        if (taskName.includes('.')) {
            const parts = taskName.split('.');
            const alias = parts[0];
            const originalName = parts.slice(1).join('.');
            
            const availableAliases = this.getAvailableAliases(contextUri);
            if (!availableAliases.includes(alias)) {
                return {
                    isValid: false,
                    error: `Unknown import alias '${alias}'`,
                    suggestions: availableAliases.length > 0 ? 
                        [`Available aliases: ${availableAliases.join(', ')}`] : 
                        ['No import aliases available']
                };
            }
            
            // Check if task exists in the alias
            const aliasedTasks = this.getTasksForAlias(alias, contextUri);
            const similarTasks = aliasedTasks.filter(t => 
                this.extractOriginalTaskName(t.name).toLowerCase().includes(originalName.toLowerCase())
            );
            
            if (similarTasks.length > 0) {
                suggestions.push(...similarTasks.map(t => t.name));
            }
        } else {
            // Check for similar task names
            const allTasks = this.getAllAvailableTasksInContext(contextUri);
            const similarTasks = allTasks.filter(t => {
                const originalName = this.extractOriginalTaskName(t.name);
                return originalName.toLowerCase().includes(taskName.toLowerCase()) ||
                       taskName.toLowerCase().includes(originalName.toLowerCase());
            });
            
            if (similarTasks.length > 0) {
                suggestions.push(...similarTasks.map(t => t.name));
            }
        }
        
        return {
            isValid: false,
            error: `Task '${taskName}' not found`,
            suggestions: suggestions.length > 0 ? suggestions : undefined
        };
    }
    
    // Private helper methods
    
    private async addDocumentSymbols(docInfo: DocumentInfo): Promise<void> {
        // Add task symbols
        for (const task of docInfo.tasks) {
            const symbol = this.taskInfoToSymbol(task);
            this.symbolTable.tasks.set(this.getTaskKey(task.name, docInfo.uri), symbol);
        }
        
        // Add workflow symbols (placeholder implementation)
        for (const workflow of docInfo.workflows) {
            const symbol: WorkflowSymbol = {
                name: workflow.name,
                inputs: [], // TODO: Implement workflow input analysis
                outputs: [], // TODO: Implement workflow output analysis
                sourceFile: docInfo.uri,
                range: workflow.range
            };
            this.symbolTable.workflows.set(this.getWorkflowKey(workflow.name, docInfo.uri), symbol);
        }
        
        // Process imports and add imported symbols
        for (const importInfo of docInfo.imports) {
            if (importInfo.tasks) {
                for (const task of importInfo.tasks) {
                    const symbol = this.taskInfoToSymbol(task);
                    // The task name already includes the alias from ImportResolver
                    symbol.qualifiedName = task.name;
                    this.symbolTable.tasks.set(
                        this.getTaskKey(task.name, docInfo.uri),
                        symbol
                    );
                }
            }
        }
    }
    
    private removeDocumentSymbols(uri: string): void {
        // Remove tasks from this document
        const tasksToRemove: string[] = [];
        for (const [key, symbol] of this.symbolTable.tasks) {
            if (symbol.sourceFile === uri) {
                tasksToRemove.push(key);
            }
        }
        for (const key of tasksToRemove) {
            this.symbolTable.tasks.delete(key);
        }
        
        // Remove workflows from this document
        const workflowsToRemove: string[] = [];
        for (const [key, symbol] of this.symbolTable.workflows) {
            if (symbol.sourceFile === uri) {
                workflowsToRemove.push(key);
            }
        }
        for (const key of workflowsToRemove) {
            this.symbolTable.workflows.delete(key);
        }
    }
    
    private taskInfoToSymbol(task: TaskInfo): TaskSymbol {
        return {
            name: task.name,
            inputs: task.inputs,
            outputs: task.outputs,
            description: task.description,
            sourceFile: task.sourceFile,
            range: task.range
        };
    }
    
    private resolveTaskInContext(taskName: string, docInfo: DocumentInfo): TaskSymbol | undefined {
        // Check local tasks first
        for (const task of docInfo.tasks) {
            if (task.name === taskName) {
                return this.taskInfoToSymbol(task);
            }
        }
        
        // Check imported tasks
        for (const importInfo of docInfo.imports) {
            if (importInfo.tasks) {
                for (const task of importInfo.tasks) {
                    if (task.name === taskName) {
                        const symbol = this.taskInfoToSymbol(task);
                        if (importInfo.alias) {
                            symbol.qualifiedName = `${importInfo.alias}.${task.name}`;
                        }
                        return symbol;
                    }
                }
            }
        }
        
        return undefined;
    }
    
    private getTaskKey(taskName: string, uri: string): string {
        return `${uri}#${taskName}`;
    }
    
    private getWorkflowKey(workflowName: string, uri: string): string {
        return `${uri}#${workflowName}`;
    }
    
    private isPositionInRange(line: number, column: number, range: AST.Range): boolean {
        if (line < range.start.line || line > range.end.line) {
            return false;
        }
        
        if (line === range.start.line && column < range.start.column) {
            return false;
        }
        
        if (line === range.end.line && column > range.end.column) {
            return false;
        }
        
        return true;
    }
    
    /**
     * Extract original task name from potentially aliased name
     */
    private extractOriginalTaskName(taskName: string): string {
        if (taskName.includes('.')) {
            const parts = taskName.split('.');
            return parts[parts.length - 1]; // Return the last part (original task name)
        }
        return taskName;
    }
    
    /**
     * Check if a task name has an alias prefix
     */
    private hasAliasPrefix(taskName: string): boolean {
        return taskName.includes('.');
    }
    
    /**
     * Extract alias from task name
     */
    private extractAlias(taskName: string): string | undefined {
        if (taskName.includes('.')) {
            const parts = taskName.split('.');
            return parts.slice(0, -1).join('.'); // Return all parts except the last one
        }
        return undefined;
    }
}