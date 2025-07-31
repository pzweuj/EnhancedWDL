import {
    CompletionItem,
    CompletionTriggerKind
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SymbolProvider, TaskSymbol } from './symbolProvider';
import { TaskAnalyzer } from './taskAnalyzer';
import { ContextAnalyzer, CompletionContext, TaskInputContext, TaskOutputContext, EnhancedTaskOutputContext } from './contextAnalyzer';
import { CompletionItemBuilder, CompletionItemOptions } from './completionItemBuilder';
import { TaskInputCompletionEngine, TaskInputCompletionOptions } from './taskInputCompletionEngine';
import { TaskOutputCompletionEngine, TaskOutputCompletionOptions } from './taskOutputCompletionEngine';
import { ErrorHandler } from './errorHandler';
import { logger } from './logger';
import { error } from 'console';
import { error } from 'console';
import { error } from 'console';
import { error } from 'console';
import { request } from 'http';
import { type } from 'os';
import { type } from 'os';
import { type } from 'os';
import { type } from 'os';
import { type } from 'os';
import { type } from 'os';
import { type } from 'os';
import { type } from 'os';
import { type } from 'os';
import { type } from 'os';
import { type } from 'os';
import { type } from 'os';
import { type } from 'os';
import { type } from 'os';
import { type } from 'os';
import { type } from 'os';
import { memoryUsage } from 'process';
import { memoryUsage } from 'process';
import { memoryUsage } from 'process';
import { memoryUsage } from 'process';
import { text } from 'stream/consumers';
import { text } from 'stream/consumers';
import { text } from 'stream/consumers';
import { text } from 'stream/consumers';
import { error } from 'console';
import { error } from 'console';
import { type } from 'os';
import { type } from 'os';
import { type } from 'os';
import { type } from 'os';
import { type } from 'os';
import { memoryUsage } from 'process';
import { text } from 'stream/consumers';

// Performance optimization interfaces
interface CompletionRequest {
    id: string;
    document: TextDocument;
    line: number;
    character: number;
    timestamp: number;
    priority: number;
    triggerCharacter?: string;
    triggerKind?: CompletionTriggerKind;
}

interface CompletionCache {
    key: string;
    items: CompletionItem[];
    timestamp: number;
    contextHash: string;
    priority?: number;
    accessCount?: number;
    lastAccessed?: number;
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
    private taskInputEngine: TaskInputCompletionEngine;
    private taskOutputEngine: TaskOutputCompletionEngine;
    private errorHandler: ErrorHandler;
    
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
        
        // Initialize specialized completion engines
        this.taskInputEngine = new TaskInputCompletionEngine({
            showRequired: true,
            showOptional: true,
            includeTypeInfo: true,
            includeDefaultValues: true,
            prioritizeRequired: true,
            includeSnippets: true,
            showSourceInfo: true,
            includeDescriptions: true
        });
        
        this.taskOutputEngine = new TaskOutputCompletionEngine({
            showTypeInfo: true,
            includeDescription: true,
            filterByContext: true,
            includeSnippets: false,
            showSourceInfo: true,
            includeUsageExamples: true
        });
        
        this.errorHandler = new ErrorHandler();
        
        // Initialize performance metrics
        this.performanceMetrics = {
            totalRequests: 0,
            averageResponseTime: 0,
            cacheHitRate: 0,
            memoryUsage: 0,
            activeRequests: 0,
            queuedRequests: 0
        };
        
        // Setup error handler event listeners
        this.setupErrorHandling();
        
        // Start memory cleanup timer
        this.startMemoryCleanup();
    }
    
    /**
     * Provide completion items for a position in a document with performance optimizations and error handling
     */
    async provideCompletionItems(document: TextDocument, line: number, character: number): Promise<CompletionItem[]> {
        return this.provideCompletionItemsWithTrigger(document, line, character);
    }

    /**
     * Enhanced completion provider with trigger character support
     */
    async provideCompletionItemsWithTrigger(
        document: TextDocument, 
        line: number, 
        character: number,
        triggerCharacter?: string,
        triggerKind?: CompletionTriggerKind
    ): Promise<CompletionItem[]> {
        const startTime = Date.now();
        const requestId = this.generateRequestId(document.uri, line, character);
        
        return await this.errorHandler.executeWithTimeout(
            'completion-request',
            async () => {
                try {
                    logger.debug('Starting completion request', 'completion', {
                        uri: document.uri,
                        line,
                        character,
                        requestId
                    });
                    
                    // Update metrics
                    this.performanceMetrics.totalRequests++;
                    this.performanceMetrics.activeRequests++;
                    
                    // Check cache first
                    const cacheKey = this.generateCacheKey(document, line, character, triggerCharacter);
                    const cached = this.getCachedCompletion(cacheKey);
                    if (cached) {
                        logger.trace('Cache hit for completion request', 'completion', { cacheKey });
                        this.updateCacheHitRate(true);
                        this.performanceMetrics.activeRequests--;
                        return cached.items;
                    }
                    
                    this.updateCacheHitRate(false);
                    
                    // Use debounced completion with priority queue
                    const result = await this.debouncedCompletionWithTrigger(
                        document, line, character, requestId, triggerCharacter, triggerKind
                    );
                    
                    logger.debug('Completion request completed', 'completion', {
                        requestId,
                        itemCount: result.length,
                        responseTime: Date.now() - startTime,
                        triggerCharacter,
                        triggerKind
                    });
                    
                    return result;
                    
                } catch (error) {
                    // Handle error with recovery
                    const errorReport = await this.errorHandler.handleError(
                        error as Error,
                        {
                            operation: 'completion-request',
                            uri: document.uri,
                            timestamp: Date.now(),
                            metadata: { line, character, requestId }
                        },
                        async () => {
                            // Recovery function: return basic completions
                            logger.warn('Attempting completion recovery', 'completion', { requestId });
                            return this.getGeneralCompletions(document.uri);
                        }
                    );
                    
                    logger.error('Completion request failed', 'completion', {
                        requestId,
                        error: (error as Error).message,
                        recovered: errorReport.recovered
                    }, error as Error);
                    
                    this.performanceMetrics.activeRequests--;
                    
                    // Return recovery result or empty array
                    return errorReport.recovered ? this.getGeneralCompletions(document.uri) : [];
                    
                } finally {
                    // Update performance metrics
                    const responseTime = Date.now() - startTime;
                    this.updateAverageResponseTime(responseTime);
                }
            },
            {
                operation: 'completion-request',
                uri: document.uri,
                timestamp: Date.now(),
                metadata: { line, character, requestId }
            }
        );
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
        return this.debouncedCompletionWithTrigger(document, line, character, requestId);
    }

    /**
     * Enhanced debounced completion with trigger character support
     */
    private async debouncedCompletionWithTrigger(
        document: TextDocument, 
        line: number, 
        character: number, 
        requestId: string,
        triggerCharacter?: string,
        triggerKind?: CompletionTriggerKind
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
                priority: this.calculateRequestPriority(document, line, character, triggerCharacter),
                triggerCharacter,
                triggerKind
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
        const { document, line, character, triggerCharacter, triggerKind } = request;
        
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
            
            // Handle trigger character specific logic first
            if (triggerCharacter === '.') {
                const completions = await this.handleDotTriggerCompletion(document, position);
                if (completions.length > 0) {
                    // Cache the result
                    const cacheKey = this.generateCacheKey(document, line, character, triggerCharacter);
                    const context = await this.getCompletionContextAsync(document, position);
                    this.cacheCompletion(cacheKey, completions, context);
                    return completions;
                }
            }

            // Use ContextAnalyzer to determine completion context
            const context = await this.getCompletionContextAsync(document, position);
            
            let completions: CompletionItem[];
            
            // Handle different completion contexts with enhanced logic using specialized engines
            switch (context.type) {
                case 'task-call':
                    completions = await this.getTaskCompletionsAsync(document.uri);
                    break;
                
                case 'task-input':
                    completions = await this.getEnhancedTaskInputCompletionsAsync(
                        context as TaskInputContext,
                        document
                    );
                    break;
                
                case 'task-output':
                    completions = await this.getEnhancedTaskOutputCompletionsAsync(
                        context as EnhancedTaskOutputContext,
                        document
                    );
                    break;
                
                case 'assignment-value':
                    completions = await this.getValueCompletionsAsync(document.uri);
                    break;
                
                default:
                    completions = await this.getGeneralCompletionsAsync(document.uri);
                    break;
            }
            
            // Apply intelligent sorting and filtering
            completions = this.applyIntelligentSortingAndFiltering(completions, context, triggerCharacter);

            // Cache the result
            const cacheKey = this.generateCacheKey(document, line, character, triggerCharacter);
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
     * Async version of getTaskCompletions with enhanced error handling
     */
    private async getTaskCompletionsAsync(uri: string): Promise<CompletionItem[]> {
        return await this.errorHandler.executeWithTimeout(
            'task-completions',
            async () => {
                return this.getTaskCompletions(uri);
            },
            {
                operation: 'task-completions',
                uri,
                timestamp: Date.now()
            }
        );
    }
    
    /**
     * Enhanced task input parameter completions with import support and complex syntax handling
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
                
                // Enhanced: Provide task suggestions when not found
                const availableTasks = this.symbolProvider.getAllAvailableTasksInContext(uri)
                    .map(t => t.name);
                const suggestions = this.errorHandler.getTaskNotFoundSuggestions(taskName, availableTasks);
                
                if (suggestions.length > 0) {
                    console.info(`Task suggestions for '${taskName}':`, suggestions);
                    // Could emit an event or show suggestions to user
                    this.errorHandler.emit('task-suggestions', {
                        requestedTask: taskName,
                        suggestions,
                        uri
                    });
                }
                
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
                
                // Enhanced: Provide task suggestions when not found
                const availableTasks = this.symbolProvider.getAllAvailableTasksInContext(uri)
                    .map(t => t.name);
                const suggestions = this.errorHandler.getTaskNotFoundSuggestions(taskName, availableTasks);
                
                if (suggestions.length > 0) {
                    console.info(`Task suggestions for '${taskName}':`, suggestions);
                    this.errorHandler.emit('task-suggestions', {
                        requestedTask: taskName,
                        suggestions,
                        uri
                    });
                }
                
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
     * Enhanced task input completions using specialized engine with error handling
     */
    private async getEnhancedTaskInputCompletionsAsync(
        context: TaskInputContext,
        document: TextDocument
    ): Promise<CompletionItem[]> {
        return await this.errorHandler.executeWithTimeout(
            'task-input-completions',
            async () => {
                try {
                    // Get task symbol with enhanced resolution
                    let taskSymbol = this.symbolProvider.resolveTaskByAlias(context.taskName, document.uri);
                    
                    if (!taskSymbol) {
                        taskSymbol = this.symbolProvider.getTaskSymbol(context.resolvedTaskName || context.taskName, document.uri);
                    }
                    
                    if (!taskSymbol) {
                        // Provide suggestions for task not found
                        const availableTasks = this.symbolProvider.getAllAvailableTasksInContext(document.uri)
                            .map(t => t.name);
                        const suggestions = this.errorHandler.getTaskNotFoundSuggestions(context.taskName, availableTasks);
                        
                        if (suggestions.length > 0) {
                            this.errorHandler.emit('task-suggestions', {
                                requestedTask: context.taskName,
                                suggestions,
                                uri: document.uri
                            });
                        }
                        
                        return this.getFallbackInputCompletions(context.taskName, document.uri);
                    }
                    
                    // Use specialized engine for enhanced completions
                    return this.taskInputEngine.generateInputCompletions(taskSymbol, context);
                } catch (error) {
                    console.error('Error in enhanced task input completions:', error);
                    return this.getFallbackInputCompletions(context.taskName, document.uri);
                }
            },
            {
                operation: 'task-input-completions',
                uri: document.uri,
                timestamp: Date.now(),
                metadata: { taskName: context.taskName }
            }
        );
    }
    
    /**
     * Enhanced task output completions using specialized engine with error handling
     */
    private async getEnhancedTaskOutputCompletionsAsync(
        context: EnhancedTaskOutputContext,
        document: TextDocument
    ): Promise<CompletionItem[]> {
        return await this.errorHandler.executeWithTimeout(
            'task-output-completions',
            async () => {
                try {
                    // Get task symbol with enhanced resolution
                    let taskSymbol = this.symbolProvider.resolveTaskByAlias(context.taskName, document.uri);
                    
                    if (!taskSymbol) {
                        taskSymbol = this.symbolProvider.getTaskSymbol(context.resolvedTaskName || context.taskName, document.uri);
                    }
                    
                    if (!taskSymbol) {
                        // Provide suggestions for task not found
                        const availableTasks = this.symbolProvider.getAllAvailableTasksInContext(document.uri)
                            .map(t => t.name);
                        const suggestions = this.errorHandler.getTaskNotFoundSuggestions(context.taskName, availableTasks);
                        
                        if (suggestions.length > 0) {
                            this.errorHandler.emit('task-suggestions', {
                                requestedTask: context.taskName,
                                suggestions,
                                uri: document.uri
                            });
                        }
                        
                        return this.getFallbackOutputCompletions(context.taskName, document.uri);
                    }
                    
                    // Use specialized engine for enhanced completions
                    return this.taskOutputEngine.generateOutputCompletions(taskSymbol, context);
                } catch (error) {
                    console.error('Error in enhanced task output completions:', error);
                    return this.getFallbackOutputCompletions(context.taskName, document.uri);
                }
            },
            {
                operation: 'task-output-completions',
                uri: document.uri,
                timestamp: Date.now(),
                metadata: { taskName: context.taskName }
            }
        );
    }
    
    /**
     * Async version of getValueCompletions with error handling
     */
    private async getValueCompletionsAsync(uri: string): Promise<CompletionItem[]> {
        return await this.errorHandler.executeWithTimeout(
            'value-completions',
            async () => {
                return this.getValueCompletions(uri);
            },
            {
                operation: 'value-completions',
                uri,
                timestamp: Date.now()
            }
        );
    }
    
    /**
     * Async version of getGeneralCompletions with error handling
     */
    private async getGeneralCompletionsAsync(uri: string): Promise<CompletionItem[]> {
        return await this.errorHandler.executeWithTimeout(
            'general-completions',
            async () => {
                return this.getGeneralCompletions(uri);
            },
            {
                operation: 'general-completions',
                uri,
                timestamp: Date.now()
            }
        );
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
            // Enhanced fallback: provide best-effort completions during parse errors
            const bestEffortCompletions = this.errorHandler.getBestEffortCompletions();
            return bestEffortCompletions.map(item => ({
                label: item.label,
                kind: item.kind,
                detail: item.detail,
                insertText: item.insertText,
                insertTextFormat: 2 // InsertTextFormat.Snippet
            }));
        }
    }
    
    /**
     * Handle dot trigger completion with enhanced error handling
     */
    private async handleDotTriggerCompletion(
        document: TextDocument,
        position: { line: number, character: number }
    ): Promise<CompletionItem[]> {
        return await this.errorHandler.executeWithTimeout(
            'dot-trigger-completion',
            async () => {
                try {
                    // Analyze context for task output reference
                    const outputContext = this.contextAnalyzer.analyzeTaskOutputContext(document, position);
                    
                    if (outputContext) {
                        // Get task symbol and provide output completions
                        let taskSymbol = this.symbolProvider.resolveTaskByAlias(outputContext.taskName, document.uri);
                        
                        if (!taskSymbol) {
                            taskSymbol = this.symbolProvider.getTaskSymbol(
                                outputContext.resolvedTaskName || outputContext.taskName, 
                                document.uri
                            );
                        }
                        
                        if (taskSymbol) {
                            return this.taskOutputEngine.generateOutputCompletions(taskSymbol, outputContext);
                        } else {
                            // Provide task suggestions when not found
                            const availableTasks = this.symbolProvider.getAllAvailableTasksInContext(document.uri)
                                .map(t => t.name);
                            const suggestions = this.errorHandler.getTaskNotFoundSuggestions(
                                outputContext.taskName, 
                                availableTasks
                            );
                            
                            if (suggestions.length > 0) {
                                this.errorHandler.emit('task-suggestions', {
                                    requestedTask: outputContext.taskName,
                                    suggestions,
                                    uri: document.uri
                                });
                            }
                            
                            return this.getFallbackOutputCompletions(outputContext.taskName, document.uri);
                        }
                    }
                    
                    return [];
                } catch (error) {
                    console.error('Error in dot trigger completion:', error);
                    return [];
                }
            },
            {
                operation: 'dot-trigger-completion',
                uri: document.uri,
                timestamp: Date.now(),
                metadata: { position }
            }
        );
    }
    
    /**
     * Setup error handling event listeners
     */
    private setupErrorHandling(): void {
        // Listen for task suggestions
        this.errorHandler.on('task-suggestions', (event: any) => {
            logger.info('Task suggestions provided', 'completion', {
                requestedTask: event.requestedTask,
                suggestions: event.suggestions,
                uri: event.uri
            });
        });
        
        // Listen for performance warnings
        this.errorHandler.on('performance-warning', (warning: any) => {
            logger.warn('Performance warning detected', 'completion', {
                warnings: warning.warnings,
                memoryUsage: warning.memoryUsage,
                timestamp: warning.timestamp
            });
            
            // Emit to client if needed
            this.emit('performance-warning', warning);
        });
        
        // Listen for circuit breaker events
        this.errorHandler.on('circuit-breaker-opened', (event: any) => {
            logger.error('Circuit breaker opened', 'completion', {
                operation: event.operation,
                failures: event.failures
            });
        });
        
        this.errorHandler.on('circuit-breaker-closed', (event: any) => {
            logger.info('Circuit breaker closed', 'completion', {
                operation: event.operation
            });
        });
        
        // Listen for error reports
        this.errorHandler.on('error', (report: any) => {
            logger.error('Error handled', 'completion', {
                errorId: report.id,
                operation: report.context.operation,
                severity: report.severity,
                recovered: report.recovered,
                recoveryAction: report.recoveryAction
            }, report.error);
        });
    }
    
    /**
     * Apply intelligent sorting and filtering to completion items
     */
    private applyIntelligentSortingAndFiltering(
        completions: CompletionItem[],
        context: CompletionContext,
        triggerCharacter?: string
    ): CompletionItem[] {
        // Apply context-specific filtering
        let filtered = this.applyContextFiltering(completions, context, triggerCharacter);
        
        // Apply intelligent sorting
        filtered = this.applyIntelligentSorting(filtered, context, triggerCharacter);
        
        // Limit results to prevent overwhelming the user
        const maxResults = this.getMaxResultsForContext(context, triggerCharacter);
        if (filtered.length > maxResults) {
            filtered = filtered.slice(0, maxResults);
        }
        
        return filtered;
    }

    /**
     * Apply context-specific filtering with enhanced real-time filtering
     */
    private applyContextFiltering(
        completions: CompletionItem[],
        context: CompletionContext,
        triggerCharacter?: string
    ): CompletionItem[] {
        // Apply basic context filtering
        let filtered = this.applyBasicContextFiltering(completions, context, triggerCharacter);
        
        // Apply real-time filtering based on user input
        filtered = this.applyRealTimeFiltering(filtered, context);
        
        // Apply advanced context-specific filtering
        filtered = this.applyAdvancedContextFiltering(filtered, context);
        
        return filtered;
    }

    /**
     * Apply basic context-specific filtering
     */
    private applyBasicContextFiltering(
        completions: CompletionItem[],
        context: CompletionContext,
        triggerCharacter?: string
    ): CompletionItem[] {
        // For dot trigger, only show output completions
        if (triggerCharacter === '.' && context.type === 'task-output') {
            return completions.filter(item => {
                const wdlInfo = (item as any).wdlInfo;
                return wdlInfo && wdlInfo.category === 'task-output';
            });
        }
        
        // For input contexts, prioritize input-related completions
        if (context.type === 'task-input') {
            return completions.filter(item => {
                const wdlInfo = (item as any).wdlInfo;
                return wdlInfo && wdlInfo.category === 'task-input';
            });
        }
        
        // For task call contexts, prioritize task completions
        if (context.type === 'task-call') {
            return completions.filter(item => {
                return item.kind === 6 || // CompletionItemKind.Function for tasks
                       item.kind === 12;   // CompletionItemKind.Keyword for WDL keywords
            });
        }
        
        return completions;
    }

    /**
     * Apply real-time filtering based on user input
     */
    private applyRealTimeFiltering(completions: CompletionItem[], context: CompletionContext): CompletionItem[] {
        // Get the current word being typed
        const currentWord = this.getCurrentWord(context);
        
        if (!currentWord || currentWord.length === 0) {
            return completions;
        }

        // Apply fuzzy matching with scoring
        const scored = completions.map(item => ({
            item,
            score: this.calculateMatchScore(currentWord, item)
        })).filter(scored => scored.score > 0);

        // Sort by score and return items
        return scored
            .sort((a, b) => b.score - a.score)
            .map(scored => scored.item);
    }

    /**
     * Apply advanced context-specific filtering
     */
    private applyAdvancedContextFiltering(completions: CompletionItem[], context: CompletionContext): CompletionItem[] {
        if (context.type === 'task-input') {
            return this.filterTaskInputCompletions(completions, context as TaskInputContext);
        } else if (context.type === 'task-output') {
            return this.filterTaskOutputCompletions(completions, context as EnhancedTaskOutputContext);
        }
        
        return completions;
    }

    /**
     * Filter task input completions based on context
     */
    private filterTaskInputCompletions(completions: CompletionItem[], context: TaskInputContext): CompletionItem[] {
        // Filter out already used inputs
        if (context.usedInputs && context.usedInputs.length > 0) {
            completions = completions.filter(item => 
                !context.usedInputs.includes(item.label as string)
            );
        }

        // In scatter blocks, filter based on scatter variable context
        if (context.isInScatterBlock && context.scatterVariable) {
            completions = completions.filter(item => {
                const itemData = item.data as any;
                if (itemData && itemData.wdlInfo && itemData.wdlInfo.parameterType) {
                    const paramType = itemData.wdlInfo.parameterType;
                    return this.isArrayCompatibleType(paramType) || this.isScatterCompatibleType(paramType);
                }
                return true; // Keep if we can't determine type
            });
        }

        return completions;
    }

    /**
     * Filter task output completions based on context
     */
    private filterTaskOutputCompletions(completions: CompletionItem[], context: EnhancedTaskOutputContext): CompletionItem[] {
        // In scatter blocks, adjust for array type outputs
        if (context.arrayTypeContext) {
            completions = completions.map(item => {
                const enhanced = { ...item };
                if (enhanced.detail && !enhanced.detail.includes('Array[')) {
                    enhanced.detail = `Array[${enhanced.detail}]`;
                }
                if (enhanced.documentation && typeof enhanced.documentation === 'string') {
                    enhanced.documentation = `${enhanced.documentation}\n\n**Note:** This output is an array in scatter context.`;
                }
                return enhanced;
            });
        }

        return completions;
    }

    /**
     * Apply intelligent sorting based on context and relevance with enhanced documentation
     */
    private applyIntelligentSorting(
        completions: CompletionItem[],
        context: CompletionContext,
        triggerCharacter?: string
    ): CompletionItem[] {
        // First enhance documentation display
        const enhanced = this.enhanceDocumentationDisplay(completions, context);
        
        // Then apply smart cursor positioning
        const positioned = this.applySmartCursorPositioning(enhanced, context);
        
        // Finally sort by priority and relevance
        return positioned.sort((a, b) => {
            // Primary sort: by calculated priority
            const aPriority = this.calculateSortPriority(a, context, triggerCharacter);
            const bPriority = this.calculateSortPriority(b, context, triggerCharacter);
            
            if (aPriority !== bPriority) {
                return bPriority - aPriority; // Higher priority first
            }
            
            // Secondary sort: by relevance score
            const aRelevance = this.calculateRelevanceScore(a, context);
            const bRelevance = this.calculateRelevanceScore(b, context);
            
            if (aRelevance !== bRelevance) {
                return bRelevance - aRelevance;
            }
            
            // Tertiary sort: by custom sort priority if available
            const aCustomPriority = (a as any).sortPriority || 999;
            const bCustomPriority = (b as any).sortPriority || 999;
            
            if (aCustomPriority !== bCustomPriority) {
                return aCustomPriority - bCustomPriority;
            }
            
            // Final sort: alphabetically
            return (a.label as string).localeCompare(b.label as string);
        });
    }

    /**
     * Get fallback task completions when main resolution fails
     */
    private getFallbackTaskCompletions(uri: string): CompletionItem[] {
        try {
            // Try to get basic WDL keywords and common task patterns
            const fallbackCompletions: CompletionItem[] = [];
            
            // Add basic WDL keywords
            const keywords = ['call', 'task', 'workflow', 'import', 'scatter', 'if', 'else'];
            for (const keyword of keywords) {
                fallbackCompletions.push({
                    label: keyword,
                    kind: 14, // CompletionItemKind.Keyword
                    detail: `WDL ${keyword} keyword`,
                    insertText: keyword
                });
            }
            
            // Add common task name patterns
            const commonTaskPatterns = ['ProcessFile', 'AnalyzeData', 'FilterResults', 'MergeFiles'];
            for (const pattern of commonTaskPatterns) {
                fallbackCompletions.push({
                    label: pattern,
                    kind: 6, // CompletionItemKind.Function
                    detail: 'Common task pattern',
                    insertText: pattern
                });
            }
            
            return fallbackCompletions;
        } catch (error) {
            console.error('Error in getFallbackTaskCompletions:', error);
            return [];
        }
    }
    
    /**
     * Get fallback input completions when task resolution fails
     */
    private getFallbackInputCompletions(taskName: string, uri: string): CompletionItem[] {
        try {
            // Provide common input parameter patterns
            const commonInputs = [
                { name: 'input_file', type: 'File', detail: 'Input file parameter' },
                { name: 'output_prefix', type: 'String', detail: 'Output prefix parameter' },
                { name: 'threads', type: 'Int', detail: 'Number of threads' },
                { name: 'memory', type: 'Int', detail: 'Memory in GB' },
                { name: 'docker_image', type: 'String', detail: 'Docker container image' }
            ];
            
            return commonInputs.map(input => ({
                label: input.name,
                kind: 10, // CompletionItemKind.Property
                detail: `${input.type} • ${input.detail}`,
                insertText: `${input.name} = `,
                documentation: `Common ${input.type} parameter: ${input.detail}`
            }));
        } catch (error) {
            console.error('Error in getFallbackInputCompletions:', error);
            return [];
        }
    }
    
    /**
     * Get fallback output completions when task resolution fails
     */
    private getFallbackOutputCompletions(taskName: string, uri: string): CompletionItem[] {
        try {
            // Provide common output parameter patterns
            const commonOutputs = [
                { name: 'output_file', type: 'File', detail: 'Output file' },
                { name: 'result', type: 'String', detail: 'Result value' },
                { name: 'log_file', type: 'File', detail: 'Log file' },
                { name: 'stdout', type: 'File', detail: 'Standard output' },
                { name: 'stderr', type: 'File', detail: 'Standard error' }
            ];
            
            return commonOutputs.map(output => ({
                label: output.name,
                kind: 10, // CompletionItemKind.Property
                detail: `${output.type} • ${output.detail}`,
                insertText: output.name,
                documentation: `Common ${output.type} output: ${output.detail}`
            }));
        } catch (error) {
            console.error('Error in getFallbackOutputCompletions:', error);
            return [];
        }
    }
                return aPriority - bPriority;
            }
            
            // Then by completion item kind (more specific types first)
            const kindPriority = this.getKindPriority(a.kind, context);
            const bKindPriority = this.getKindPriority(b.kind, context);
            
            if (kindPriority !== bKindPriority) {
                return kindPriority - bKindPriority;
            }
            
            // Finally, alphabetical by label
            return (a.label || '').localeCompare(b.label || '');
        });
    }

    /**
     * Get priority for completion item kind based on context
     */
    private getKindPriority(kind: number | undefined, context: CompletionContext): number {
        if (!kind) return 999;
        
        // Priority mapping based on context
        const basePriorities: { [key: number]: number } = {
            10: 1,  // Property (for parameters)
            6: 2,   // Function (for tasks)
            14: 3,  // Keyword
            1: 4,   // Text
            12: 5,  // Value
        };
        
        let priority = basePriorities[kind] || 999;
        
        // Adjust based on context
        if (context.type === 'task-input' && kind === 10) {
            priority = 1; // Properties are most important in input context
        } else if (context.type === 'task-output' && kind === 10) {
            priority = 1; // Properties are most important in output context
        } else if (context.type === 'task-call' && kind === 6) {
            priority = 1; // Functions (tasks) are most important in call context
        }
        
        return priority;
    }

    /**
     * Get maximum results based on context
     */
    private getMaxResultsForContext(context: CompletionContext, triggerCharacter?: string): number {
        // For dot trigger (output completion), show fewer results for better UX
        if (triggerCharacter === '.') {
            return 20;
        }
        
        // For input contexts, show more results as there might be many parameters
        if (context.type === 'task-input') {
            return 50;
        }
        
        // For general contexts, use a moderate limit
        return 30;
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
     * Get enhanced task symbols for better completion support
     */
    private getEnhancedTaskSymbol(taskName: string, uri: string): TaskSymbol | null {
        // First try enhanced resolution
        let taskSymbol = this.symbolProvider.resolveTaskByAlias(taskName, uri);
        
        // Fallback to regular symbol lookup
        if (!taskSymbol) {
            taskSymbol = this.symbolProvider.getTaskSymbol(taskName, uri);
        }
        
        // Additional fallback: try qualified name lookup
        if (!taskSymbol) {
            const qualifiedName = this.symbolProvider.getQualifiedTaskName(taskName, uri);
            if (qualifiedName) {
                taskSymbol = this.symbolProvider.getTaskSymbol(qualifiedName, uri);
            }
        }
        
        return taskSymbol || null;
    }

    /**
     * Get completion engines for external access
     */
    getTaskInputEngine(): TaskInputCompletionEngine {
        return this.taskInputEngine;
    }

    getTaskOutputEngine(): TaskOutputCompletionEngine {
        return this.taskOutputEngine;
    }

    /**
     * Get completion statistics for debugging
     */
    getStatistics(): {
        symbolProviderStats: any;
        isReady: boolean;
        performanceMetrics: PerformanceMetrics;
        engineStats: {
            inputEngineReady: boolean;
            outputEngineReady: boolean;
        };
    } {
        this.updateMemoryUsage();
        return {
            symbolProviderStats: this.symbolProvider.getStatistics(),
            isReady: this.isReady(),
            performanceMetrics: { ...this.performanceMetrics },
            engineStats: {
                inputEngineReady: this.taskInputEngine !== undefined,
                outputEngineReady: this.taskOutputEngine !== undefined
            }
        };
    }
    
    // Performance optimization methods
    
    /**
     * Handle dot trigger character completion (for task output references)
     */
    private async handleDotTriggerCompletion(document: TextDocument, position: { line: number, character: number }): Promise<CompletionItem[]> {
        try {
            // Parse the task output reference
            const text = document.getText();
            const outputRef = this.taskOutputEngine.parseTaskOutputReference(text, position);
            
            if (outputRef && outputRef.taskName) {
                // Get the task symbol
                let taskSymbol = this.symbolProvider.resolveTaskByAlias(outputRef.taskName, document.uri);
                if (!taskSymbol) {
                    taskSymbol = this.symbolProvider.getTaskSymbol(outputRef.taskName, document.uri);
                }
                
                if (taskSymbol) {
                    // Create enhanced context for output completion
                    const context: any = {
                        type: 'task-output',
                        position,
                        confidence: 0.9,
                        taskName: outputRef.taskName,
                        resolvedTaskName: taskSymbol.name,
                        dotPosition: position,
                        isAfterDot: true,
                        availableOutputs: taskSymbol.outputs.map(o => o.name),
                        outputTypes: new Map(taskSymbol.outputs.map(o => [o.name, o.type.name]))
                    };
                    
                    // Use the specialized output completion engine
                    return this.taskOutputEngine.generateOutputCompletions(taskSymbol, context);
                }
            }
            
            return [];
        } catch (error) {
            logger.error('Error in handleDotTriggerCompletion', 'completion', {
                error: (error as Error).message
            });
            return [];
        }
    }

    /**
     * Enhanced task input completions using specialized engine
     */
    private async getEnhancedTaskInputCompletionsAsync(
        context: TaskInputContext,
        document: TextDocument
    ): Promise<CompletionItem[]> {
        try {
            const taskName = context.resolvedTaskName || context.taskName;
            if (!taskName) {
                return [];
            }

            // Get the task symbol
            let taskSymbol = this.symbolProvider.resolveTaskByAlias(taskName, document.uri);
            if (!taskSymbol) {
                taskSymbol = this.symbolProvider.getTaskSymbol(taskName, document.uri);
            }

            if (!taskSymbol) {
                logger.warn('Task not found for enhanced input completions', 'completion', {
                    taskName,
                    uri: document.uri
                });
                return this.getFallbackInputCompletions(taskName, document.uri);
            }

            // Detect already used inputs if not provided in context
            if (!context.usedInputs || context.usedInputs.length === 0) {
                context.usedInputs = this.taskInputEngine.detectUsedInputs(document, context.position);
            }

            // Use the specialized input completion engine
            const options: TaskInputCompletionOptions = {
                showRequired: true,
                showOptional: true,
                includeTypeInfo: true,
                includeDefaultValues: true,
                prioritizeRequired: true,
                includeSnippets: true,
                showSourceInfo: true,
                includeDescriptions: true
            };

            return this.taskInputEngine.generateInputCompletions(taskSymbol, context, options);

        } catch (error) {
            logger.error('Error in getEnhancedTaskInputCompletionsAsync', 'completion', {
                error: (error as Error).message,
                taskName: context.taskName
            });
            return this.getFallbackInputCompletions(context.taskName || '', document.uri);
        }
    }

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
    private generateCacheKey(document: TextDocument, line: number, character: number, triggerCharacter?: string): string {
        const contextHash = this.generateContextHash(document, line, character);
        const triggerHash = triggerCharacter ? `:trigger:${triggerCharacter}` : '';
        return `${document.uri}:${line}:${character}:${contextHash}${triggerHash}`;
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
     * Cache completion result with intelligent caching strategy
     */
    private cacheCompletion(cacheKey: string, items: CompletionItem[], context: CompletionContext): void {
        // Clean up cache if it's getting too large
        if (this.completionCache.size >= this.MAX_CACHE_SIZE) {
            this.cleanupCacheIntelligently();
        }
        
        // Calculate cache priority based on context and usage patterns
        const priority = this.calculateCachePriority(context, items);
        
        // Enhanced context hash for better cache invalidation
        const contextHash = this.generateContextHash(context);
        
        const cached: CompletionCache = {
            key: cacheKey,
            items: this.optimizeCompletionItemsForCache(items),
            timestamp: Date.now(),
            contextHash,
            priority,
            accessCount: 1,
            lastAccessed: Date.now()
        };
        
        this.completionCache.set(cacheKey, cached);
        
        // Update cache metrics
        this.updateCacheMetrics();
    }

    /**
     * Get cached completion with intelligent retrieval
     */
    private getCachedCompletion(cacheKey: string): CompletionCache | null {
        const cached = this.completionCache.get(cacheKey);
        if (!cached) {
            return null;
        }
        
        // Check if cache is expired with dynamic TTL
        const dynamicTTL = this.calculateDynamicTTL(cached);
        if (Date.now() - cached.timestamp > dynamicTTL) {
            this.completionCache.delete(cacheKey);
            return null;
        }
        
        // Update access statistics
        cached.accessCount++;
        cached.lastAccessed = Date.now();
        
        return cached;
    }

    /**
     * Calculate cache priority based on context and items
     */
    private calculateCachePriority(context: CompletionContext, items: CompletionItem[]): number {
        let priority = 1;
        
        // Higher priority for specific contexts
        if (context.type === 'task-input' || context.type === 'task-output') {
            priority += 3;
        } else if (context.type === 'task-call') {
            priority += 2;
        }
        
        // Higher priority for larger result sets (more expensive to compute)
        if (items.length > 20) {
            priority += 2;
        } else if (items.length > 10) {
            priority += 1;
        }
        
        // Higher priority for complex completions with documentation
        const hasComplexItems = items.some(item => 
            item.documentation || 
            (item.data as any)?.wdlInfo?.parameterType
        );
        if (hasComplexItems) {
            priority += 1;
        }
        
        return priority;
    }

    /**
     * Generate enhanced context hash for better cache invalidation
     */
    private generateContextHash(context: CompletionContext): string {
        const hashParts = [
            context.type,
            context.taskName || '',
            context.resolvedTaskName || '',
            context.confidence.toString()
        ];
        
        if (context.type === 'task-input') {
            const inputContext = context as TaskInputContext;
            hashParts.push(
                inputContext.isInScatterBlock ? 'scatter' : '',
                inputContext.isInConditionalBlock ? 'conditional' : '',
                inputContext.usedInputs?.join(',') || ''
            );
        }
        
        return hashParts.join('|');
    }

    /**
     * Calculate dynamic TTL based on cache usage patterns
     */
    private calculateDynamicTTL(cached: CompletionCache): number {
        let ttl = this.CACHE_TTL;
        
        // Extend TTL for frequently accessed items
        if (cached.accessCount > 5) {
            ttl *= 2;
        } else if (cached.accessCount > 10) {
            ttl *= 3;
        }
        
        // Extend TTL for high-priority items
        if (cached.priority > 3) {
            ttl *= 1.5;
        }
        
        // Reduce TTL for old items that haven't been accessed recently
        const timeSinceLastAccess = Date.now() - cached.lastAccessed;
        if (timeSinceLastAccess > this.CACHE_TTL) {
            ttl *= 0.5;
        }
        
        return Math.min(ttl, this.CACHE_TTL * 5); // Cap at 5x base TTL
    }

    /**
     * Optimize completion items for caching (reduce memory usage)
     */
    private optimizeCompletionItemsForCache(items: CompletionItem[]): CompletionItem[] {
        return items.map(item => {
            // Create a lightweight copy for caching
            const optimized: CompletionItem = {
                label: item.label,
                kind: item.kind,
                detail: item.detail,
                documentation: item.documentation,
                insertText: item.insertText,
                filterText: item.filterText,
                sortText: item.sortText,
                data: item.data
            };
            
            // Remove large or unnecessary properties for cache
            if (optimized.documentation && typeof optimized.documentation === 'object') {
                // Keep only essential documentation
                if (optimized.documentation.value.length > 500) {
                    optimized.documentation = {
                        kind: optimized.documentation.kind,
                        value: optimized.documentation.value.substring(0, 500) + '...'
                    };
                }
            }
            
            return optimized;
        });
    }

    /**
     * Intelligent cache cleanup based on priority and usage
     */
    private cleanupCacheIntelligently(): void {
        const entries = Array.from(this.completionCache.entries());
        
        // Sort by priority and last access time
        entries.sort((a, b) => {
            const [, cacheA] = a;
            const [, cacheB] = b;
            
            // First by priority (lower priority gets removed first)
            if (cacheA.priority !== cacheB.priority) {
                return cacheA.priority - cacheB.priority;
            }
            
            // Then by last access time (older gets removed first)
            return cacheA.lastAccessed - cacheB.lastAccessed;
        });
        
        // Remove the least important 25% of entries
        const toRemove = Math.floor(entries.length * 0.25);
        for (let i = 0; i < toRemove; i++) {
            this.completionCache.delete(entries[i][0]);
        }
        
        logger.debug('Intelligent cache cleanup completed', 'cache', {
            removed: toRemove,
            remaining: this.completionCache.size
        });
    }

    /**
     * Update cache performance metrics
     */
    private updateCacheMetrics(): void {
        this.performanceMetrics.memoryUsage = this.estimateCacheMemoryUsage();
    }

    /**
     * Estimate cache memory usage
     */
    private estimateCacheMemoryUsage(): number {
        let totalSize = 0;
        
        for (const cached of this.completionCache.values()) {
            // Rough estimation of memory usage
            totalSize += JSON.stringify(cached).length * 2; // Approximate bytes
        }
        
        return totalSize;
    }
    
    /**
     * Calculate request priority based on context and trigger
     */
    private calculateRequestPriority(document: TextDocument, line: number, character: number, triggerCharacter?: string): number {
        // Higher priority for:
        // 1. Trigger character requests (especially dot)
        // 2. Requests in task contexts
        // 3. Recent requests
        
        let priority = 1;
        
        // Boost priority for trigger characters
        if (triggerCharacter === '.') {
            priority += 3; // Highest priority for dot trigger (output completion)
        } else if (triggerCharacter === '=' || triggerCharacter === ':') {
            priority += 2; // High priority for assignment contexts
        } else if (triggerCharacter === ' ') {
            priority += 1; // Medium priority for space trigger
        }
        
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
     * Start memory cleanup timer with enhanced performance monitoring
     */
    private startMemoryCleanup(): void {
        this.memoryCleanupTimer = setInterval(() => {
            this.cleanupCache();
            this.cleanupExpiredRequests();
            this.updatePerformanceMetrics();
            this.optimizeMemoryUsage();
        }, this.MEMORY_CLEANUP_INTERVAL);
    }

    /**
     * Update performance metrics
     */
    private updatePerformanceMetrics(): void {
        this.updateMemoryUsage();
    }

    /**
     * Update memory usage metrics
     */
    private updateMemoryUsage(): void {
        const cacheSize = this.completionCache.size * 1024; // Rough estimate
        const queueSize = this.requestQueue.size * 512; // Rough estimate
        this.performanceMetrics.memoryUsage = cacheSize + queueSize;
    }

    /**
     * Optimize memory usage by cleaning up unused resources
     */
    private optimizeMemoryUsage(): void {
        const memoryUsage = this.estimateCacheMemoryUsage();
        const maxMemoryUsage = 10 * 1024 * 1024; // 10MB limit
        
        if (memoryUsage > maxMemoryUsage) {
            logger.warn('Memory usage exceeds limit, performing aggressive cleanup', 'memory', {
                currentUsage: memoryUsage,
                maxUsage: maxMemoryUsage
            });
            
            // Perform aggressive cache cleanup
            this.performAggressiveCacheCleanup();
        }
        
        // Update memory metrics
        this.performanceMetrics.memoryUsage = memoryUsage;
    }

    /**
     * Perform aggressive cache cleanup when memory usage is high
     */
    private performAggressiveCacheCleanup(): void {
        const entries = Array.from(this.completionCache.entries());
        
        // Remove 50% of cache entries, keeping only the most important ones
        entries.sort((a, b) => {
            const [, cacheA] = a;
            const [, cacheB] = b;
            
            // Sort by priority and access count
            const scoreA = (cacheA.priority || 1) * (cacheA.accessCount || 1);
            const scoreB = (cacheB.priority || 1) * (cacheB.accessCount || 1);
            
            return scoreB - scoreA; // Higher score first
        });
        
        // Keep only the top 50%
        const toKeep = Math.floor(entries.length * 0.5);
        this.completionCache.clear();
        
        for (let i = 0; i < toKeep; i++) {
            const [key, cache] = entries[i];
            this.completionCache.set(key, cache);
        }
        
        logger.info('Aggressive cache cleanup completed', 'memory', {
            removed: entries.length - toKeep,
            remaining: toKeep
        });
    }
    
    /**
     * Get current word being typed based on context
     */
    private getCurrentWord(context: CompletionContext): string {
        // This would need to be implemented based on the document and position
        // For now, return empty string as fallback
        return '';
    }

    /**
     * Calculate match score for fuzzy matching
     */
    private calculateMatchScore(query: string, item: CompletionItem): number {
        const label = (item.label as string).toLowerCase();
        const filterText = (item.filterText || label).toLowerCase();
        const queryLower = query.toLowerCase();
        
        // Exact match gets highest score
        if (label === queryLower || filterText === queryLower) {
            return 1000;
        }
        
        // Prefix match gets high score
        if (label.startsWith(queryLower) || filterText.startsWith(queryLower)) {
            return 800;
        }
        
        // Contains match gets medium score
        if (label.includes(queryLower) || filterText.includes(queryLower)) {
            return 600;
        }
        
        // Fuzzy match gets lower score
        if (this.fuzzyMatch(queryLower, label) || this.fuzzyMatch(queryLower, filterText)) {
            return 400;
        }
        
        return 0;
    }

    /**
     * Simple fuzzy matching algorithm
     */
    private fuzzyMatch(query: string, target: string): boolean {
        let queryIndex = 0;
        let targetIndex = 0;
        
        while (queryIndex < query.length && targetIndex < target.length) {
            if (query[queryIndex] === target[targetIndex]) {
                queryIndex++;
            }
            targetIndex++;
        }
        
        return queryIndex === query.length;
    }

    /**
     * Check if a type is array compatible
     */
    private isArrayCompatibleType(type: string): boolean {
        return type.startsWith('Array[') || type.includes('[]');
    }

    /**
     * Check if a type is scatter compatible
     */
    private isScatterCompatibleType(type: string): boolean {
        // Basic types that can be scattered over
        const scatterCompatibleTypes = ['File', 'String', 'Int', 'Float', 'Boolean'];
        return scatterCompatibleTypes.some(t => type.includes(t));
    }

    /**
     * Calculate sort priority for completion items
     */
    private calculateSortPriority(item: CompletionItem, context: CompletionContext, triggerCharacter?: string): number {
        let priority = 0;
        const itemData = item.data as any;
        
        // Context-specific priorities
        if (context.type === 'task-input' && itemData?.wdlInfo) {
            // Required parameters get higher priority
            if (itemData.wdlInfo.isRequired) {
                priority += 100;
            }
            
            // Parameters with default values get medium priority
            if (itemData.wdlInfo.hasDefault) {
                priority += 50;
            }
        }
        
        // Trigger character specific priorities
        if (triggerCharacter === '.') {
            // For dot trigger, prioritize outputs
            if (context.type === 'task-output') {
                priority += 200;
            }
        }
        
        // Local vs imported task priority
        if (itemData?.wdlInfo?.sourceFile) {
            if (itemData.wdlInfo.sourceFile === 'local') {
                priority += 75;
            } else {
                priority += 25; // Imported tasks get lower priority
            }
        }
        
        // Type compatibility priority
        if (itemData?.wdlInfo?.parameterType) {
            priority += this.calculateTypeCompatibilityScore(itemData.wdlInfo.parameterType, context);
        }
        
        return priority;
    }

    /**
     * Calculate type compatibility score
     */
    private calculateTypeCompatibilityScore(paramType: string, context: CompletionContext): number {
        let score = 0;
        
        // In scatter context, array types get higher score
        if (context.type === 'task-input') {
            const inputContext = context as TaskInputContext;
            if (inputContext.isInScatterBlock) {
                if (this.isArrayCompatibleType(paramType)) {
                    score += 30;
                }
            }
        }
        
        // Common types get medium score
        const commonTypes = ['File', 'String', 'Int', 'Float', 'Boolean'];
        if (commonTypes.some(t => paramType.includes(t))) {
            score += 10;
        }
        
        return score;
    }

    /**
     * Calculate relevance score based on user input and context
     */
    private calculateRelevanceScore(item: CompletionItem, context: CompletionContext): number {
        let score = 0;
        const currentWord = this.getCurrentWord(context);
        const label = item.label as string;
        
        if (currentWord && currentWord.length > 0) {
            // Exact prefix match gets highest score
            if (label.toLowerCase().startsWith(currentWord.toLowerCase())) {
                score += 100;
            }
            
            // Contains match gets medium score
            if (label.toLowerCase().includes(currentWord.toLowerCase())) {
                score += 50;
            }
            
            // Fuzzy match gets lower score
            if (this.fuzzyMatch(currentWord.toLowerCase(), label.toLowerCase())) {
                score += 25;
            }
        }
        
        return score;
    }

    /**
     * Enhance documentation display with rich information
     */
    private enhanceDocumentationDisplay(completions: CompletionItem[], context: CompletionContext): CompletionItem[] {
        return completions.map(item => {
            const enhanced = { ...item };
            const itemData = item.data as any;
            
            if (itemData?.wdlInfo) {
                // Build rich documentation
                const docParts: string[] = [];
                
                // Add type information
                if (itemData.wdlInfo.parameterType) {
                    docParts.push(`**Type:** \`${itemData.wdlInfo.parameterType}\``);
                }
                
                // Add required/optional status
                if (context.type === 'task-input') {
                    if (itemData.wdlInfo.isRequired) {
                        docParts.push('**Required parameter**');
                    } else {
                        docParts.push('**Optional parameter**');
                    }
                    
                    // Add default value if available
                    if (itemData.wdlInfo.hasDefault && itemData.wdlInfo.defaultValue) {
                        docParts.push(`**Default:** \`${itemData.wdlInfo.defaultValue}\``);
                    }
                }
                
                // Add source information
                if (itemData.wdlInfo.sourceFile && itemData.wdlInfo.sourceFile !== 'local') {
                    docParts.push(`**Source:** ${itemData.wdlInfo.sourceFile}`);
                }
                
                // Add import alias information
                if (itemData.wdlInfo.importAlias) {
                    docParts.push(`**Alias:** ${itemData.wdlInfo.importAlias}`);
                }
                
                // Add usage examples for complex types
                if (itemData.wdlInfo.parameterType && this.isComplexType(itemData.wdlInfo.parameterType)) {
                    const example = this.generateUsageExample(itemData.wdlInfo.parameterType, item.label as string);
                    if (example) {
                        docParts.push(`**Example:**\n\`\`\`wdl\n${example}\n\`\`\``);
                    }
                }
                
                // Add context-specific information
                if (context.type === 'task-input') {
                    const inputContext = context as TaskInputContext;
                    if (inputContext.isInScatterBlock) {
                        docParts.push('**Note:** This parameter is being used in a scatter block context.');
                    }
                }
                
                // Combine with existing documentation
                let finalDoc = docParts.join('\n\n');
                if (enhanced.documentation) {
                    if (typeof enhanced.documentation === 'string') {
                        finalDoc = `${enhanced.documentation}\n\n---\n\n${finalDoc}`;
                    } else {
                        finalDoc = `${enhanced.documentation.value}\n\n---\n\n${finalDoc}`;
                    }
                }
                
                enhanced.documentation = {
                    kind: 'markdown',
                    value: finalDoc
                };
            }
            
            return enhanced;
        });
    }

    /**
     * Apply smart cursor positioning and indentation
     */
    private applySmartCursorPositioning(completions: CompletionItem[], context: CompletionContext): CompletionItem[] {
        return completions.map(item => {
            const enhanced = { ...item };
            
            // Apply context-specific cursor positioning
            if (context.type === 'task-input') {
                enhanced.insertText = this.applySmartInputInsertion(item, context as TaskInputContext);
            } else if (context.type === 'task-output') {
                enhanced.insertText = this.applySmartOutputInsertion(item, context as EnhancedTaskOutputContext);
            }
            
            return enhanced;
        });
    }

    /**
     * Apply smart insertion for task input parameters
     */
    private applySmartInputInsertion(item: CompletionItem, context: TaskInputContext): string {
        const label = item.label as string;
        const itemData = item.data as any;
        
        // Determine if we need to add assignment syntax
        if (context.isInInputValue) {
            // Just insert the parameter name
            return label;
        }
        
        // Add assignment syntax with smart cursor positioning
        let insertion = `${label}: `;
        
        // Add placeholder based on parameter type
        if (itemData?.wdlInfo?.parameterType) {
            const placeholder = this.generateTypePlaceholder(itemData.wdlInfo.parameterType);
            insertion += placeholder;
        } else {
            insertion += '$0'; // Default cursor position
        }
        
        return insertion;
    }

    /**
     * Apply smart insertion for task output references
     */
    private applySmartOutputInsertion(item: CompletionItem, context: EnhancedTaskOutputContext): string {
        const label = item.label as string;
        
        // For output references, just insert the output name
        // The task name and dot are already present
        return label;
    }

    /**
     * Check if a type is complex (needs usage examples)
     */
    private isComplexType(type: string): boolean {
        return type.includes('Array[') || type.includes('Map[') || type.includes('Pair[') || type.includes('Object');
    }

    /**
     * Generate usage example for complex types
     */
    private generateUsageExample(type: string, paramName: string): string | null {
        if (type.startsWith('Array[')) {
            return `${paramName}: [item1, item2, item3]`;
        } else if (type.startsWith('Map[')) {
            return `${paramName}: {"key1": "value1", "key2": "value2"}`;
        } else if (type.startsWith('Pair[')) {
            return `${paramName}: (left_value, right_value)`;
        }
        return null;
    }

    /**
     * Generate type placeholder for smart insertion
     */
    private generateTypePlaceholder(type: string): string {
        if (type === 'String') {
            return '"$0"';
        } else if (type === 'Int' || type === 'Float') {
            return '$0';
        } else if (type === 'Boolean') {
            return '${0|true,false|}';
        } else if (type === 'File') {
            return '"${0:path/to/file}"';
        } else if (type.startsWith('Array[')) {
            return '[$0]';
        } else if (type.startsWith('Map[')) {
            return '{$0}';
        } else if (type.startsWith('Pair[')) {
            return '($0)';
        }
        return '$0';
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
        
        // Destroy error handler
        this.errorHandler.removeAllListeners();
    }
    
    /**
     * Setup error handling event listeners
     */
    private setupErrorHandling(): void {
        this.errorHandler.on('error', (errorReport) => {
            logger.error('Error handled by ErrorHandler', 'error-handler', {
                errorId: errorReport.id,
                operation: errorReport.context.operation,
                severity: errorReport.severity,
                recovered: errorReport.recovered
            });
        });
        
        this.errorHandler.on('circuit-breaker-opened', ({ operation, failures }) => {
            logger.warn('Circuit breaker opened', 'circuit-breaker', {
                operation,
                failures
            });
        });
        
        this.errorHandler.on('circuit-breaker-closed', ({ operation }) => {
            logger.info('Circuit breaker closed', 'circuit-breaker', {
                operation
            });
        });
        
        this.errorHandler.on('circuit-breaker-half-open', ({ operation }) => {
            logger.info('Circuit breaker half-open', 'circuit-breaker', {
                operation
            });
        });
    }
    
    /**
     * Get error handler for external access
     */
    getErrorHandler(): ErrorHandler {
        return this.errorHandler;
    }
    
    /**
     * Get error statistics
     */
    getErrorStatistics(): any {
        return this.errorHandler.getStatistics();
    }
    
    /**
     * Handle graceful degradation when imports fail
     */
    private async handleImportFailure(uri: string, error: Error): Promise<CompletionItem[]> {
        logger.warn('Import failure detected, using graceful degradation', 'completion', {
            uri,
            error: error.message
        });
        
        try {
            // Try to get local tasks only
            const localTasks = this.symbolProvider.getAllTaskSymbols();
            if (localTasks.length > 0) {
                return this.completionItemBuilder.buildTaskCallCompletions(localTasks);
            }
            
            // Fallback to basic WDL completions
            return this.completionItemBuilder.buildKeywordCompletions();
            
        } catch (fallbackError) {
            logger.error('Fallback completion also failed', 'completion', {
                uri,
                originalError: error.message,
                fallbackError: (fallbackError as Error).message
            });
            
            return [];
        }
    }
    
    /**
     * Validate completion context and handle errors
     */
    private async validateCompletionContext(
        document: TextDocument,
        line: number,
        character: number
    ): Promise<{ isValid: boolean; errors: string[] }> {
        const errors: string[] = [];
        
        try {
            // Check document bounds
            const lineCount = document.lineCount;
            if (line < 0 || line >= lineCount) {
                errors.push(`Line ${line} is out of bounds (0-${lineCount - 1})`);
            }
            
            // Check character bounds
            if (line >= 0 && line < lineCount) {
                const lineText = document.getText({
                    start: { line, character: 0 },
                    end: { line: line + 1, character: 0 }
                });
                
                if (character < 0 || character > lineText.length) {
                    errors.push(`Character ${character} is out of bounds for line ${line}`);
                }
            }
            
            // Check if document is too large
            const documentSize = document.getText().length;
            if (documentSize > 1024 * 1024) { // 1MB limit
                errors.push(`Document is too large: ${Math.round(documentSize / 1024)}KB`);
            }
            
        } catch (error) {
            errors.push(`Context validation failed: ${(error as Error).message}`);
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }
    
    /**
     * Get max results based on context and trigger
     */
    private getMaxResultsForContext(context: CompletionContext, triggerCharacter?: string): number {
        // For dot trigger (task outputs), limit to reasonable number
        if (triggerCharacter === '.' && context.type === 'task-output') {
            return 20;
        }
        
        // For input completions, show more options
        if (context.type === 'task-input') {
            return 50;
        }
        
        // For general completions, limit to prevent overwhelming
        if (context.type === 'general') {
            return 30;
        }
        
        // Default limit
        return 40;
    }

}

