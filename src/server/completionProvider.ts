import {
    CompletionItem
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SymbolProvider, TaskSymbol } from './symbolProvider';
import { TaskAnalyzer } from './taskAnalyzer';
import { ContextAnalyzer, CompletionContext } from './contextAnalyzer';
import { CompletionItemBuilder, CompletionItemOptions } from './completionItemBuilder';

// Performance optimization interfaces
interface CompletionRequest {
    id: string;
    document: TextDocument;
    line: number;
    character: number;
    timestamp: number;
    priority: number;
}

interface CompletionCache {
    key: string;
    items: CompletionItem[];
    timestamp: number;
    contextHash: string;
}

interface PerformanceMetrics {
    totalRequests: number;
    averageResponseTime: number;
    cacheHitRate: number;
    memoryUsage: number;
    activeRequests: number;
    queuedRequests: number;
}

interface DebounceConfig {
    delay: number;
    maxDelay: number;
    immediate: boolean;
}

export class CompletionProvider {
    private symbolProvider: SymbolProvider;
    private contextAnalyzer: ContextAnalyzer;
    private completionItemBuilder: CompletionItemBuilder;
    
    // Performance optimization properties
    private completionCache: Map<string, CompletionCache> = new Map();
    private requestQueue: Map<string, CompletionRequest> = new Map();
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
    private activeRequests: Set<string> = new Set();
    private performanceMetrics: PerformanceMetrics;
    
    // Configuration
    private readonly CACHE_TTL = 30 * 1000; // 30 seconds
    private readonly MAX_CACHE_SIZE = 100;
    private readonly MAX_CONCURRENT_REQUESTS = 5;
    private readonly DEFAULT_DEBOUNCE_DELAY = 150; // milliseconds
    private readonly MAX_DEBOUNCE_DELAY = 500; // milliseconds
    private readonly MEMORY_CLEANUP_INTERVAL = 60 * 1000; // 1 minute
    
    private memoryCleanupTimer?: NodeJS.Timeout;
    
    constructor(symbolProvider: SymbolProvider) {
        this.symbolProvider = symbolProvider;
        this.contextAnalyzer = new ContextAnalyzer();
        this.completionItemBuilder = new CompletionItemBuilder({
            showSourceInfo: true,
            includeSnippets: true,
            prioritizeRequired: true,
            showTypeDetails: true,
            includeExamples: false
        });
        
        // Initialize performance metrics
        this.performanceMetrics = {
            totalRequests: 0,
            averageResponseTime: 0,
            cacheHitRate: 0,
            memoryUsage: 0,
            activeRequests: 0,
            queuedRequests: 0
        };
        
        // Start memory cleanup timer
        this.startMemoryCleanup();
    }
    
    /**
     * Provide completion items for a position in a document with performance optimizations
     */
    async provideCompletionItems(document: TextDocument, line: number, character: number): Promise<CompletionItem[]> {
        const startTime = Date.now();
        const requestId = this.generateRequestId(document.uri, line, character);
        
        try {
            // Update metrics
            this.performanceMetrics.totalRequests++;
            this.performanceMetrics.activeRequests++;
            
            // Check cache first
            const cacheKey = this.generateCacheKey(document, line, character);
            const cached = this.getCachedCompletion(cacheKey);
            if (cached) {
                this.updateCacheHitRate(true);
                this.performanceMetrics.activeRequests--;
                return cached.items;
            }
            
            this.updateCacheHitRate(false);
            
            // Use debounced completion with priority queue
            return await this.debouncedCompletion(document, line, character, requestId);
            
        } catch (error) {
            console.error('Error in provideCompletionItems:', error);
            this.performanceMetrics.activeRequests--;
            return this.getGeneralCompletions(document.uri);
        } finally {
            // Update performance metrics
            const responseTime = Date.now() - startTime;
            this.updateAverageResponseTime(responseTime);
        }
    }
    
    /**
     * Debounced completion with priority queue
     */
    private async debouncedCompletion(
        document: TextDocument, 
        line: number, 
        character: number, 
        requestId: string
    ): Promise<CompletionItem[]> {
        return new Promise((resolve, reject) => {
            // Clear existing timer for this document
            const existingTimer = this.debounceTimers.get(document.uri);
            if (existingTimer) {
                clearTimeout(existingTimer);
            }
            
            // Create completion request
            const request: CompletionRequest = {
                id: requestId,
                document,
                line,
                character,
                timestamp: Date.now(),
                priority: this.calculateRequestPriority(document, line, character)
            };
            
            // Add to queue
            this.requestQueue.set(requestId, request);
            this.performanceMetrics.queuedRequests = this.requestQueue.size;
            
            // Set debounce timer
            const debounceDelay = this.calculateDebounceDelay(document.uri);
            const timer = setTimeout(async () => {
                try {
                    this.debounceTimers.delete(document.uri);
                    
                    // Process highest priority request for this document
                    const result = await this.processCompletionRequest(request);
                    
                    // Remove from queue
                    this.requestQueue.delete(requestId);
                    this.performanceMetrics.queuedRequests = this.requestQueue.size;
                    this.performanceMetrics.activeRequests--;
                    
                    resolve(result);
                } catch (error) {
                    this.requestQueue.delete(requestId);
                    this.performanceMetrics.queuedRequests = this.requestQueue.size;
                    this.performanceMetrics.activeRequests--;
                    reject(error);
                }
            }, debounceDelay);
            
            this.debounceTimers.set(document.uri, timer);
        });
    }
    
    /**
     * Process completion request with async handling
     */
    private async processCompletionRequest(request: CompletionRequest): Promise<CompletionItem[]> {
        const { document, line, character } = request;
        
        // Check if we're over the concurrent request limit
        if (this.activeRequests.size >= this.MAX_CONCURRENT_REQUESTS) {
            // Queue the request or return cached result
            const cacheKey = this.generateCacheKey(document, line, character);
            const cached = this.getCachedCompletion(cacheKey);
            if (cached) {
                return cached.items;
            }
            
            // Wait for a slot to become available
            await this.waitForAvailableSlot();
        }
        
        this.activeRequests.add(request.id);
        
        try {
            const position = { line, character };
            
            // Use ContextAnalyzer to determine completion context
            const context = await this.getCompletionContextAsync(document, position);
            
            let completions: CompletionItem[];
            
            // Handle different completion contexts with enhanced logic
            switch (context.type) {
                case 'task-call':
                    completions = await this.getTaskCompletionsAsync(document.uri);
                    break;
                
                case 'task-input':
                    completions = await this.getTaskInputCompletionsAsync(
                        context.resolvedTaskName || context.taskName!, 
                        document.uri
                    );
                    break;
                
                case 'task-output':
                    completions = await this.getTaskOutputCompletionsAsync(
                        context.resolvedTaskName || context.taskName!, 
                        document.uri
                    );
                    break;
                
                case 'assignment-value':
                    completions = await this.getValueCompletionsAsync(document.uri);
                    break;
                
                default:
                    completions = await this.getGeneralCompletionsAsync(document.uri);
                    break;
            }
            
            // Cache the result
            const cacheKey = this.generateCacheKey(document, line, character);
            this.cacheCompletion(cacheKey, completions, context);
            
            return completions;
            
        } finally {
            this.activeRequests.delete(request.id);
        }
    }
    
    /**
     * Enhanced completion context analysis using ContextAnalyzer (async version)
     */
    private async getCompletionContextAsync(document: TextDocument, position: { line: number, character: number }): Promise<CompletionContext> {
        try {
            // Use ContextAnalyzer to determine completion context
            const context = this.contextAnalyzer.analyzeContext(document, position);
            
            // Resolve task name if needed using enhanced alias handling
            if (context.taskName && !context.resolvedTaskName) {
                const docInfo = this.symbolProvider.getDocumentAnalyzer().getCachedDocument(document.uri);
                if (docInfo) {
                    context.resolvedTaskName = this.contextAnalyzer.resolveTaskName(context.taskName, docInfo.imports);
                    
                    // Additional validation using SymbolProvider's enhanced methods
                    const resolvedTask = this.symbolProvider.resolveTaskByAlias(context.taskName, document.uri);
                    if (resolvedTask) {
                        context.resolvedTaskName = resolvedTask.name;
                    }
                }
            }
            
            return context;
        } catch (error) {
            console.error('Error in getCompletionContextAsync:', error);
            // Return fallback context
            return {
                type: 'general',
                position,
                confidence: 0.0
            };
        }
    }
    
    /**
     * Enhanced completion context analysis using ContextAnalyzer (sync version for backward compatibility)
     */
    private getCompletionContext(document: TextDocument, position: { line: number, character: number }): CompletionContext {
        try {
            // Use ContextAnalyzer to determine completion context
            const context = this.contextAnalyzer.analyzeContext(document, position);
            
            // Resolve task name if needed using enhanced alias handling
            if (context.taskName && !context.resolvedTaskName) {
                const docInfo = this.symbolProvider.getDocumentAnalyzer().getCachedDocument(document.uri);
                if (docInfo) {
                    context.resolvedTaskName = this.contextAnalyzer.resolveTaskName(context.taskName, docInfo.imports);
                    
                    // Additional validation using SymbolProvider's enhanced methods
                    const resolvedTask = this.symbolProvider.resolveTaskByAlias(context.taskName, document.uri);
                    if (resolvedTask) {
                        context.resolvedTaskName = resolvedTask.name;
                    }
                }
            }
            
            return context;
        } catch (error) {
            console.error('Error in getCompletionContext:', error);
            // Return fallback context
            return {
                type: 'general',
                position,
                confidence: 0.0
            };
        }
    }
    

    
    /**
     * Enhanced task name completions with import and alias support
     */
    private getTaskCompletions(uri: string): CompletionItem[] {
        try {
            // Get all available tasks including imported ones
            const tasks = this.symbolProvider.getAllAvailableTasksInContext(uri);
            
            if (tasks.length === 0) {
                console.warn(`No tasks found in context: ${uri}`);
                return this.getFallbackTaskCompletions(uri);
            }
            
            // Try to get enhanced task symbols if available
            const enhancedTasks = this.symbolProvider.getEnhancedTaskSymbolsInContext(uri);
            if (enhancedTasks.length > 0) {
                return this.completionItemBuilder.buildEnhancedTaskCallCompletions(enhancedTasks);
            }
            
            // Fallback to regular task completions
            return this.completionItemBuilder.buildTaskCallCompletions(tasks);
        } catch (error) {
            console.error(`Error getting task completions for ${uri}:`, error);
            return this.getFallbackTaskCompletions(uri);
        }
    }
    
    /**
     * Enhanced task input parameter completions with import support
     */
    private getTaskInputCompletions(taskName: string, uri: string): CompletionItem[] {
        try {
            // First try to get task using enhanced alias resolution
            let task = this.symbolProvider.resolveTaskByAlias(taskName, uri);
            
            // Fallback to regular symbol lookup
            if (!task) {
                task = this.symbolProvider.getTaskSymbol(taskName, uri);
            }
            
            if (!task) {
                // Additional fallback: try to find by partial name match
                const partialMatches = this.symbolProvider.findTasksByPartialName(taskName, uri);
                if (partialMatches.length > 0) {
                    task = partialMatches[0]; // Use the first match
                }
            }
            
            if (!task) {
                console.warn(`Task not found for input completions: ${taskName} in ${uri}`);
                return this.getFallbackInputCompletions(taskName, uri);
            }
            
            // Build completions with enhanced options for imported tasks
            const options: CompletionItemOptions = {
                showSourceInfo: true,
                includeSnippets: true,
                prioritizeRequired: true,
                showTypeDetails: true,
                includeExamples: false
            };
            
            // Check if this is an imported task to adjust display
            const isImported = this.symbolProvider.isImportedTask(taskName, uri);
            if (isImported) {
                const taskSource = this.symbolProvider.getTaskSource(taskName, uri);
                if (taskSource) {
                    // Add source information to the completion items
                    options.showSourceInfo = true;
                }
            }
            
            return this.completionItemBuilder.buildTaskInputCompletions(task, options);
        } catch (error) {
            console.error(`Error getting task input completions for ${taskName}:`, error);
            return this.getFallbackInputCompletions(taskName, uri);
        }
    }
    
    /**
     * Enhanced task output parameter completions with alias handling
     */
    private getTaskOutputCompletions(taskName: string, uri: string): CompletionItem[] {
        try {
            // Enhanced task resolution with alias support
            let task = this.symbolProvider.resolveTaskByAlias(taskName, uri);
            
            // Fallback to regular symbol lookup
            if (!task) {
                task = this.symbolProvider.getTaskSymbol(taskName, uri);
            }
            
            if (!task) {
                // Try qualified name lookup
                const qualifiedName = this.symbolProvider.getQualifiedTaskName(taskName, uri);
                if (qualifiedName) {
                    task = this.symbolProvider.getTaskSymbol(qualifiedName, uri);
                }
            }
            
            if (!task) {
                // Additional fallback: search by partial name
                const partialMatches = this.symbolProvider.findTasksByPartialName(taskName, uri);
                if (partialMatches.length > 0) {
                    task = partialMatches[0];
                }
            }
            
            if (!task) {
                console.warn(`Task not found for output completions: ${taskName} in ${uri}`);
                return this.getFallbackOutputCompletions(taskName, uri);
            }
            
            // Enhanced completion options for alias tasks
            const options: CompletionItemOptions = {
                showSourceInfo: true,
                includeSnippets: false, // Output completions don't need snippets
                prioritizeRequired: false, // All outputs are equally important
                showTypeDetails: true,
                includeExamples: false
            };
            
            // Add alias information if applicable
            const taskSource = this.symbolProvider.getTaskSource(taskName, uri);
            if (taskSource && taskSource.type === 'imported') {
                options.showSourceInfo = true;
            }
            
            return this.completionItemBuilder.buildTaskOutputCompletions(task, options);
        } catch (error) {
            console.error(`Error getting task output completions for ${taskName}:`, error);
            return this.getFallbackOutputCompletions(taskName, uri);
        }
    }
    
    /**
     * Enhanced value completions with import support
     */
    private getValueCompletions(uri: string): CompletionItem[] {
        try {
            const completions: CompletionItem[] = [];
            
            // Add task output references with enhanced alias support
            const tasks = this.symbolProvider.getAllAvailableTasksInContext(uri);
            if (tasks.length > 0) {
                const outputCompletions = this.completionItemBuilder.buildTaskOutputReferenceCompletions(tasks);
                completions.push(...outputCompletions);
            }
            
            // Add builtin functions
            const functionCompletions = this.completionItemBuilder.buildBuiltinFunctionCompletions();
            completions.push(...functionCompletions);
            
            // Add WDL types for type annotations
            const typeCompletions = this.completionItemBuilder.buildTypeCompletions();
            completions.push(...typeCompletions);
            
            return completions;
        } catch (error) {
            console.error('Error getting value completions:', error);
            // Fallback to basic function completions
            return this.completionItemBuilder.buildBuiltinFunctionCompletions();
        }
    }
    
    /**
     * Enhanced general completions with context awareness
     */
    private getGeneralCompletions(uri: string): CompletionItem[] {
        try {
            const completions: CompletionItem[] = [];
            
            // Add WDL keywords
            const keywordCompletions = this.completionItemBuilder.buildKeywordCompletions();
            completions.push(...keywordCompletions);
            
            // Add WDL types
            const typeCompletions = this.completionItemBuilder.buildTypeCompletions();
            completions.push(...typeCompletions);
            
            // Add available tasks for general context
            const tasks = this.symbolProvider.getAllAvailableTasksInContext(uri);
            if (tasks.length > 0) {
                const taskCompletions = this.completionItemBuilder.buildTaskCallCompletions(tasks);
                completions.push(...taskCompletions);
            }
            
            // Add builtin functions
            const functionCompletions = this.completionItemBuilder.buildBuiltinFunctionCompletions();
            completions.push(...functionCompletions);
            
            return completions;
        } catch (error) {
            console.error('Error getting general completions:', error);
            // Fallback to basic keyword completions
            return this.completionItemBuilder.buildKeywordCompletions();
        }
    }
    
    /**
     * Get completion item builder for external use
     */
    getCompletionItemBuilder(): CompletionItemBuilder {
        return this.completionItemBuilder;
    }
    
    /**
     * Fallback input completions when task is not found
     */
    private getFallbackInputCompletions(taskName: string, uri: string): CompletionItem[] {
        try {
            // Try to find similar task names
            const allTasks = this.symbolProvider.getAllAvailableTasksInContext(uri);
            const similarTasks = allTasks.filter(task => {
                const originalName = this.extractOriginalTaskName(task.name);
                return originalName.toLowerCase().includes(taskName.toLowerCase()) ||
                       taskName.toLowerCase().includes(originalName.toLowerCase());
            });
            
            if (similarTasks.length > 0) {
                // Return completions for the most similar task
                const bestMatch = similarTasks[0];
                return this.completionItemBuilder.buildTaskInputCompletions(bestMatch);
            }
            
            // Return empty array if no similar tasks found
            return [];
        } catch (error) {
            console.error('Error in getFallbackInputCompletions:', error);
            return [];
        }
    }
    
    /**
     * Fallback output completions when task is not found
     */
    private getFallbackOutputCompletions(taskName: string, uri: string): CompletionItem[] {
        try {
            // Try to find similar task names
            const allTasks = this.symbolProvider.getAllAvailableTasksInContext(uri);
            const similarTasks = allTasks.filter(task => {
                const originalName = this.extractOriginalTaskName(task.name);
                return originalName.toLowerCase().includes(taskName.toLowerCase()) ||
                       taskName.toLowerCase().includes(originalName.toLowerCase());
            });
            
            if (similarTasks.length > 0) {
                // Return completions for the most similar task
                const bestMatch = similarTasks[0];
                return this.completionItemBuilder.buildTaskOutputCompletions(bestMatch);
            }
            
            // Return empty array if no similar tasks found
            return [];
        } catch (error) {
            console.error('Error in getFallbackOutputCompletions:', error);
            return [];
        }
    }
    
    /**
     * Fallback task completions when no tasks are found
     */
    private getFallbackTaskCompletions(uri: string): CompletionItem[] {
        try {
            // Try to get all task symbols from the symbol table
            const allTasks = this.symbolProvider.getAllTaskSymbols();
            
            if (allTasks.length > 0) {
                return this.completionItemBuilder.buildTaskCallCompletions(allTasks);
            }
            
            // Return basic WDL keywords as last resort
            return this.completionItemBuilder.buildKeywordCompletions();
        } catch (error) {
            console.error('Error in getFallbackTaskCompletions:', error);
            return [];
        }
    }
    
    /**
     * Extract original task name without alias prefix
     */
    private extractOriginalTaskName(taskName: string): string {
        if (taskName.includes('.')) {
            const parts = taskName.split('.');
            return parts[parts.length - 1]; // Return the last part
        }
        return taskName;
    }
    
    /**
     * Validate task reference with detailed error information
     */
    validateTaskReference(taskName: string, contextUri: string): {
        isValid: boolean;
        error?: string;
        suggestions?: string[];
    } {
        try {
            return this.symbolProvider.validateTaskReferenceDetailed(taskName, contextUri);
        } catch (error) {
            console.error('Error validating task reference:', error);
            return {
                isValid: false,
                error: 'Internal error during validation',
                suggestions: []
            };
        }
    }
    
    /**
     * Get available import aliases in context
     */
    getAvailableAliases(contextUri: string): string[] {
        try {
            return this.symbolProvider.getAvailableAliases(contextUri);
        } catch (error) {
            console.error('Error getting available aliases:', error);
            return [];
        }
    }
    
    /**
     * Get tasks for a specific alias
     */
    getTasksForAlias(alias: string, contextUri: string): TaskSymbol[] {
        try {
            return this.symbolProvider.getTasksForAlias(alias, contextUri);
        } catch (error) {
            console.error('Error getting tasks for alias:', error);
            return [];
        }
    }
    
    /**
     * Check if completion provider is ready
     */
    isReady(): boolean {
        return this.symbolProvider !== undefined && 
               this.contextAnalyzer !== undefined && 
               this.completionItemBuilder !== undefined;
    }
    
    /**
     * Get completion statistics for debugging
     */
    getStatistics(): {
        symbolProviderStats: any;
        isReady: boolean;
        performanceMetrics: PerformanceMetrics;
    } {
        this.updateMemoryUsage();
        return {
            symbolProviderStats: this.symbolProvider.getStatistics(),
            isReady: this.isReady(),
            performanceMetrics: { ...this.performanceMetrics }
        };
    }
    
    // Performance optimization methods
    
    /**
     * Async version of getTaskCompletions
     */
    private async getTaskCompletionsAsync(uri: string): Promise<CompletionItem[]> {
        return new Promise((resolve) => {
            // Use setTimeout to make it async and allow other operations
            setTimeout(() => {
                resolve(this.getTaskCompletions(uri));
            }, 0);
        });
    }
    
    /**
     * Async version of getTaskInputCompletions
     */
    private async getTaskInputCompletionsAsync(taskName: string, uri: string): Promise<CompletionItem[]> {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve(this.getTaskInputCompletions(taskName, uri));
            }, 0);
        });
    }
    
    /**
     * Async version of getTaskOutputCompletions
     */
    private async getTaskOutputCompletionsAsync(taskName: string, uri: string): Promise<CompletionItem[]> {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve(this.getTaskOutputCompletions(taskName, uri));
            }, 0);
        });
    }
    
    /**
     * Async version of getValueCompletions
     */
    private async getValueCompletionsAsync(uri: string): Promise<CompletionItem[]> {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve(this.getValueCompletions(uri));
            }, 0);
        });
    }
    
    /**
     * Async version of getGeneralCompletions
     */
    private async getGeneralCompletionsAsync(uri: string): Promise<CompletionItem[]> {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve(this.getGeneralCompletions(uri));
            }, 0);
        });
    }
    
    /**
     * Generate unique request ID
     */
    private generateRequestId(uri: string, line: number, character: number): string {
        return `${uri}:${line}:${character}:${Date.now()}`;
    }
    
    /**
     * Generate cache key for completion request
     */
    private generateCacheKey(document: TextDocument, line: number, character: number): string {
        const contextHash = this.generateContextHash(document, line, character);
        return `${document.uri}:${line}:${character}:${contextHash}`;
    }
    
    /**
     * Generate context hash for cache invalidation
     */
    private generateContextHash(document: TextDocument, line: number, character: number): string {
        // Get surrounding context (current line and previous line)
        const currentLine = document.getText({
            start: { line, character: 0 },
            end: { line, character: document.offsetAt({ line: line + 1, character: 0 }) }
        });
        
        const prevLine = line > 0 ? document.getText({
            start: { line: line - 1, character: 0 },
            end: { line: line - 1, character: document.offsetAt({ line, character: 0 }) }
        }) : '';
        
        // Simple hash of the context
        const context = prevLine + currentLine;
        let hash = 0;
        for (let i = 0; i < context.length; i++) {
            const char = context.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString();
    }
    
    /**
     * Get cached completion if valid
     */
    private getCachedCompletion(cacheKey: string): CompletionCache | null {
        const cached = this.completionCache.get(cacheKey);
        if (!cached) {
            return null;
        }
        
        // Check if cache is expired
        if (Date.now() - cached.timestamp > this.CACHE_TTL) {
            this.completionCache.delete(cacheKey);
            return null;
        }
        
        return cached;
    }
    
    /**
     * Cache completion result
     */
    private cacheCompletion(cacheKey: string, items: CompletionItem[], context: CompletionContext): void {
        // Clean up cache if it's getting too large
        if (this.completionCache.size >= this.MAX_CACHE_SIZE) {
            this.cleanupCache();
        }
        
        const cached: CompletionCache = {
            key: cacheKey,
            items,
            timestamp: Date.now(),
            contextHash: context.type
        };
        
        this.completionCache.set(cacheKey, cached);
    }
    
    /**
     * Calculate request priority based on context
     */
    private calculateRequestPriority(document: TextDocument, line: number, character: number): number {
        // Higher priority for:
        // 1. Recent requests
        // 2. Requests in active editing areas
        // 3. Requests for task inputs/outputs
        
        let priority = 1;
        
        // Check if this is in a task context (higher priority)
        try {
            const context = this.getCompletionContext(document, { line, character });
            if (context.type === 'task-input' || context.type === 'task-output') {
                priority += 2;
            } else if (context.type === 'task-call') {
                priority += 1;
            }
        } catch (error) {
            // Ignore context analysis errors for priority calculation
        }
        
        return priority;
    }
    
    /**
     * Calculate debounce delay based on request frequency
     */
    private calculateDebounceDelay(uri: string): number {
        const recentRequests = Array.from(this.requestQueue.values())
            .filter(req => req.document.uri === uri && Date.now() - req.timestamp < 1000)
            .length;
        
        // Increase delay for frequent requests
        const baseDelay = this.DEFAULT_DEBOUNCE_DELAY;
        const additionalDelay = Math.min(recentRequests * 50, this.MAX_DEBOUNCE_DELAY - baseDelay);
        
        return baseDelay + additionalDelay;
    }
    
    /**
     * Wait for an available request slot
     */
    private async waitForAvailableSlot(): Promise<void> {
        return new Promise((resolve) => {
            const checkSlot = () => {
                if (this.activeRequests.size < this.MAX_CONCURRENT_REQUESTS) {
                    resolve();
                } else {
                    setTimeout(checkSlot, 10);
                }
            };
            checkSlot();
        });
    }
    
    /**
     * Update cache hit rate metric
     */
    private updateCacheHitRate(hit: boolean): void {
        const totalRequests = this.performanceMetrics.totalRequests;
        const currentHitRate = this.performanceMetrics.cacheHitRate;
        
        if (hit) {
            this.performanceMetrics.cacheHitRate = 
                (currentHitRate * (totalRequests - 1) + 1) / totalRequests;
        } else {
            this.performanceMetrics.cacheHitRate = 
                (currentHitRate * (totalRequests - 1)) / totalRequests;
        }
    }
    
    /**
     * Update average response time metric
     */
    private updateAverageResponseTime(responseTime: number): void {
        const totalRequests = this.performanceMetrics.totalRequests;
        const currentAverage = this.performanceMetrics.averageResponseTime;
        
        this.performanceMetrics.averageResponseTime = 
            (currentAverage * (totalRequests - 1) + responseTime) / totalRequests;
    }
    
    /**
     * Update memory usage metric
     */
    private updateMemoryUsage(): void {
        const cacheSize = this.completionCache.size * 1024; // Rough estimate
        const queueSize = this.requestQueue.size * 512; // Rough estimate
        this.performanceMetrics.memoryUsage = cacheSize + queueSize;
    }
    
    /**
     * Clean up expired cache entries
     */
    private cleanupCache(): void {
        const now = Date.now();
        const toDelete: string[] = [];
        
        for (const [key, cached] of this.completionCache) {
            if (now - cached.timestamp > this.CACHE_TTL) {
                toDelete.push(key);
            }
        }
        
        // Remove expired entries
        for (const key of toDelete) {
            this.completionCache.delete(key);
        }
        
        // If still too large, remove oldest entries
        if (this.completionCache.size > this.MAX_CACHE_SIZE) {
            const entries = Array.from(this.completionCache.entries())
                .sort((a, b) => a[1].timestamp - b[1].timestamp);
            
            const toRemove = entries.slice(0, entries.length - this.MAX_CACHE_SIZE);
            for (const [key] of toRemove) {
                this.completionCache.delete(key);
            }
        }
    }
    
    /**
     * Start memory cleanup timer
     */
    private startMemoryCleanup(): void {
        this.memoryCleanupTimer = setInterval(() => {
            this.cleanupCache();
            this.cleanupExpiredRequests();
        }, this.MEMORY_CLEANUP_INTERVAL);
    }
    
    /**
     * Clean up expired requests from queue
     */
    private cleanupExpiredRequests(): void {
        const now = Date.now();
        const toDelete: string[] = [];
        
        for (const [id, request] of this.requestQueue) {
            if (now - request.timestamp > this.MAX_DEBOUNCE_DELAY * 2) {
                toDelete.push(id);
            }
        }
        
        for (const id of toDelete) {
            this.requestQueue.delete(id);
        }
        
        this.performanceMetrics.queuedRequests = this.requestQueue.size;
    }
    
    /**
     * Destroy completion provider and clean up resources
     */
    destroy(): void {
        // Clear all timers
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();
        
        if (this.memoryCleanupTimer) {
            clearInterval(this.memoryCleanupTimer);
            this.memoryCleanupTimer = undefined;
        }
        
        // Clear caches and queues
        this.completionCache.clear();
        this.requestQueue.clear();
        this.activeRequests.clear();
        
        // Reset metrics
        this.performanceMetrics = {
            totalRequests: 0,
            averageResponseTime: 0,
            cacheHitRate: 0,
            memoryUsage: 0,
            activeRequests: 0,
            queuedRequests: 0
        };
    }

}

