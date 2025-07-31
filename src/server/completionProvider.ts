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
            includeSnippets: true,
            showSourceInfo: true,
            includeDescription: true,
            filterByContext: true,
            includeUsageExamples: true
        });
        
        this.errorHandler = new ErrorHandler();
        
        this.performanceMetrics = {
            totalRequests: 0,
            averageResponseTime: 0,
            cacheHitRate: 0,
            memoryUsage: 0,
            activeRequests: 0,
            queuedRequests: 0
        };
        
        this.setupErrorHandling();
        this.startMemoryCleanup();
    }

    /**
     * Main completion entry point with enhanced error handling and performance optimization
     */
    async provideCompletionItems(
        document: TextDocument,
        line: number,
        character: number,
        triggerCharacter?: string,
        triggerKind?: CompletionTriggerKind
    ): Promise<CompletionItem[]> {
        const requestId = this.generateRequestId(document.uri, line, character);
        
        try {
            // Validate input parameters
            const validation = await this.validateCompletionContext(document, line, character);
            if (!validation.isValid) {
                logger.warn('Invalid completion context', 'completion', {
                    uri: document.uri,
                    line,
                    character,
                    errors: validation.errors
                });
                return [];
            }

            // Check cache first
            const cacheKey = this.generateCacheKey(document, line, character, triggerCharacter);
            const cached = this.getCachedCompletion(cacheKey);
            if (cached) {
                this.updateCacheHitRate(true);
                return cached.items;
            }

            // Rate limiting and queue management
            await this.waitForAvailableSlot();
            
            // Calculate request priority
            const priority = this.calculateRequestPriority(document, line, character, triggerCharacter);
            
            // Enhanced context analysis
            const context = this.getCompletionContext(document, { line, character });
            
            logger.debug('Processing completion request', 'completion', {
                uri: document.uri,
                line,
                character,
                triggerCharacter,
                contextType: context.type,
                priority
            });

            const startTime = Date.now();
            let completions: CompletionItem[] = [];

            // Handle different completion contexts
            switch (context.type) {
                case 'task-input':
                    const inputContext = context as TaskInputContext;
                    completions = await this.getEnhancedTaskInputCompletionsAsync(inputContext, document);
                    break;
                    
                case 'task-output':
                    const outputContext = context as EnhancedTaskOutputContext;
                    completions = await this.getEnhancedTaskOutputCompletionsAsync(outputContext, document);
                    break;
                    
                case 'task-call':
                    completions = await this.getTaskCompletionsAsync(document.uri);
                    break;
                    
                case 'assignment-value':
                    completions = await this.getValueCompletionsAsync(document.uri);
                    break;
                    
                case 'general':
                default:
                    completions = await this.getGeneralCompletionsAsync(document.uri);
                    break;
            }

            // Handle dot trigger character (task output completion)
            if (triggerCharacter === '.') {
                const dotCompletions = await this.handleDotTriggerCompletion(document, { line, character });
                if (dotCompletions.length > 0) {
                    completions = dotCompletions;
                }
            }

            // Apply sorting and filtering
            completions = this.sortCompletionsByRelevance(completions, context, triggerCharacter);
            
            // Apply limits based on context
            const maxResults = this.getMaxResultsForContext(context, triggerCharacter);
            if (completions.length > maxResults) {
                completions = completions.slice(0, maxResults);
            }

            // Enhance documentation and presentation
            completions = this.enhanceDocumentationDisplay(completions, context);
            completions = this.applySmartCursorPositioning(completions, context);

            // Cache the results
            this.cacheCompletion(cacheKey, completions, context);
            
            // Update performance metrics
            const responseTime = Date.now() - startTime;
            this.updateAverageResponseTime(responseTime);
            this.updateCacheHitRate(false);
            this.performanceMetrics.totalRequests++;

            logger.debug('Completion request completed', 'completion', {
                uri: document.uri,
                line,
                character,
                itemCount: completions.length,
                responseTime,
                cacheSize: this.completionCache.size
            });

            return completions;

        } catch (error) {
            logger.error('Error in provideCompletionItems', 'completion', {
                error: (error as Error).message,
                uri: document.uri,
                line,
                character,
                triggerCharacter
            });
            
            // Fallback to basic completions on error
            return this.handleImportFailure(document.uri, error as Error);
        } finally {
            // Clean up active request
            this.activeRequests.delete(requestId);
            this.requestQueue.delete(requestId);
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

    /**
     * Get completion item builder for external use
     */
    getCompletionItemBuilder(): CompletionItemBuilder {
        return this.completionItemBuilder;
    }

    /**
     * Sort completions by relevance using multiple criteria
     */
    private sortCompletionsByRelevance(
        completions: CompletionItem[],
        context: CompletionContext,
        triggerCharacter?: string
    ): CompletionItem[] {
        return [...completions].sort((a, b) => {
            // Calculate relevance scores
            const scoreA = this.calculateRelevanceScore(a, context) + this.calculateSortPriority(a, context, triggerCharacter);
            const scoreB = this.calculateRelevanceScore(b, context) + this.calculateSortPriority(b, context, triggerCharacter);
            
            // Sort by score (higher first)
            if (scoreB !== scoreA) {
                return scoreB - scoreA;
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
     * Get completion context for better sorting and filtering
     */
    private getCompletionContext(document: TextDocument, position: { line: number, character: number }): CompletionContext {
        return this.contextAnalyzer.analyzeContext(document, position);
    }

    /**
     * Get task completions with fallback handling
     */
    private getTaskCompletions(uri: string): CompletionItem[] {
        try {
            const tasks = this.symbolProvider.getAllTaskSymbols();
            if (tasks.length === 0) {
                return this.getFallbackTaskCompletions(uri);
            }
            return this.completionItemBuilder.buildTaskCallCompletions(tasks);
        } catch (error) {
            console.error('Error in getTaskCompletions:', error);
            return this.getFallbackTaskCompletions(uri);
        }
    }

    /**
     * Get task input completions
     */
    private getTaskInputCompletions(taskName: string, uri: string): CompletionItem[] {
        try {
            let task = this.symbolProvider.resolveTaskByAlias(taskName, uri);
            if (!task) {
                task = this.symbolProvider.getTaskSymbol(taskName, uri);
            }
            
            if (!task) {
                return this.getFallbackInputCompletions(taskName, uri);
            }
            
            return this.completionItemBuilder.buildTaskInputCompletions(task);
        } catch (error) {
            console.error('Error in getTaskInputCompletions:', error);
            return this.getFallbackInputCompletions(taskName, uri);
        }
    }

    /**
     * Get task output completions
     */
    private getTaskOutputCompletions(taskName: string, uri: string): CompletionItem[] {
        try {
            let task = this.symbolProvider.resolveTaskByAlias(taskName, uri);
            if (!task) {
                task = this.symbolProvider.getTaskSymbol(taskName, uri);
            }
            
            if (!task) {
                return this.getFallbackOutputCompletions(taskName, uri);
            }
            
            return this.completionItemBuilder.buildTaskOutputCompletions(task);
        } catch (error) {
            console.error('Error in getTaskOutputCompletions:', error);
            return this.getFallbackOutputCompletions(taskName, uri);
        }
    }

    /**
     * Get value completions
     */
    private getValueCompletions(uri: string): CompletionItem[] {
        try {
            return this.completionItemBuilder.buildTypeCompletions();
        } catch (error) {
            console.error('Error in getValueCompletions:', error);
            return [];
        }
    }

    /**
     * Get general completions
     */
    private getGeneralCompletions(uri: string): CompletionItem[] {
        try {
            const keywords = this.completionItemBuilder.buildKeywordCompletions();
            return keywords;
        } catch (error) {
            console.error('Error in getGeneralCompletions:', error);
            return this.completionItemBuilder.buildKeywordCompletions();
        }
    }

    /**
     * Get fallback task completions when no tasks are found
     */
    private getFallbackTaskCompletions(uri: string): CompletionItem[] {
        try {
            return this.completionItemBuilder.buildKeywordCompletions();
        } catch (error) {
            console.error('Error in getFallbackTaskCompletions:', error);
            return [];
        }
    }

    /**
     * Async version of getTaskCompletions
     */
    private async getTaskCompletionsAsync(uri: string): Promise<CompletionItem[]> {
        return new Promise((resolve) => {
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

            let taskSymbol = this.symbolProvider.resolveTaskByAlias(taskName, document.uri);
            if (!taskSymbol) {
                taskSymbol = this.symbolProvider.getTaskSymbol(taskName, document.uri);
            }

            if (!taskSymbol) {
                return this.getFallbackInputCompletions(taskName, document.uri);
            }

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
            console.error('Error in getEnhancedTaskInputCompletionsAsync:', error);
            return this.getFallbackInputCompletions(context.taskName || '', document.uri);
        }
    }

    /**
     * Enhanced task output completions using specialized engine
     */
    private async getEnhancedTaskOutputCompletionsAsync(
        context: EnhancedTaskOutputContext,
        document: TextDocument
    ): Promise<CompletionItem[]> {
        try {
            const taskName = context.taskName;
            if (!taskName) {
                return [];
            }

            let taskSymbol = this.symbolProvider.resolveTaskByAlias(taskName, document.uri);
            if (!taskSymbol) {
                taskSymbol = this.symbolProvider.getTaskSymbol(taskName, document.uri);
            }

            if (!taskSymbol) {
                return this.getFallbackOutputCompletions(taskName, document.uri);
            }

            const options: TaskOutputCompletionOptions = {
                showTypeInfo: true,
                includeSnippets: true,
                showSourceInfo: true,
                includeDescription: true,
                filterByContext: true,
                includeUsageExamples: true
            };

            return this.taskOutputEngine.generateOutputCompletions(taskSymbol, context, options);

        } catch (error) {
            console.error('Error in getEnhancedTaskOutputCompletionsAsync:', error);
            return this.getFallbackOutputCompletions(context.taskName || '', document.uri);
        }
    }

    /**
     * Handle dot trigger character completion (for task output references)
     */
    private async handleDotTriggerCompletion(document: TextDocument, position: { line: number, character: number }): Promise<CompletionItem[]> {
        try {
            const text = document.getText();
            const outputRef = this.taskOutputEngine.parseTaskOutputReference(text, position);
            
            if (outputRef && outputRef.taskName) {
                let taskSymbol = this.symbolProvider.resolveTaskByAlias(outputRef.taskName, document.uri);
                if (!taskSymbol) {
                    taskSymbol = this.symbolProvider.getTaskSymbol(outputRef.taskName, document.uri);
                }
                
                if (taskSymbol) {
                    const context: EnhancedTaskOutputContext = {
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
                    
                    return this.taskOutputEngine.generateOutputCompletions(taskSymbol, context);
                }
            }
            
            return [];
        } catch (error) {
            console.error('Error in handleDotTriggerCompletion:', error);
            return [];
        }
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
        }
        
        return score;
    }

    /**
     * Calculate sort priority for completion items
     */
    private calculateSortPriority(item: CompletionItem, context: CompletionContext, triggerCharacter?: string): number {
        let priority = 0;
        const itemData = item.data as any;
        
        if (context.type === 'task-input' && itemData?.wdlInfo) {
            if (itemData.wdlInfo.isRequired) {
                priority += 100;
            }
            if (itemData.wdlInfo.hasDefault) {
                priority += 50;
            }
        }
        
        if (triggerCharacter === '.' && context.type === 'task-output') {
            priority += 200;
        }
        
        return priority;
    }

    /**
     * Get current word being typed based on context
     */
    private getCurrentWord(context: CompletionContext): string {
        return '';
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
        const currentLine = document.getText({
            start: { line, character: 0 },
            end: { line, character: document.offsetAt({ line: line + 1, character: 0 }) }
        });
        
        const prevLine = line > 0 ? document.getText({
            start: { line: line - 1, character: 0 },
            end: { line: line - 1, character: document.offsetAt({ line, character: 0 }) }
        }) : '';
        
        const context = prevLine + currentLine;
        let hash = 0;
        for (let i = 0; i < context.length; i++) {
            const char = context.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
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
        if (this.completionCache.size >= this.MAX_CACHE_SIZE) {
            const entries = Array.from(this.completionCache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp);
            const toRemove = entries.slice(0, entries.length - this.MAX_CACHE_SIZE + 1);
            for (const [key] of toRemove) {
                this.completionCache.delete(key);
            }
        }
        
        const cached: CompletionCache = {
            key: cacheKey,
            items,
            timestamp: Date.now(),
            contextHash: this.generateContextHashFromContext(context)
        };
        
        this.completionCache.set(cacheKey, cached);
    }

    /**
     * Generate context hash from context object
     */
    private generateContextHashFromContext(context: CompletionContext): string {
        const hashParts = [
            context.type,
            context.taskName || '',
            context.resolvedTaskName || '',
            context.confidence.toString()
        ];
        
        return hashParts.join('|');
    }

    /**
     * Calculate request priority
     */
    private calculateRequestPriority(document: TextDocument, line: number, character: number, triggerCharacter?: string): number {
        let priority = 1;
        
        if (triggerCharacter === '.') {
            priority += 3;
        } else if (triggerCharacter === '=' || triggerCharacter === ':') {
            priority += 2;
        } else if (triggerCharacter === ' ') {
            priority += 1;
        }
        
        return priority;
    }

    /**
     * Wait for available request slot
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
     * Update cache hit rate
     */
    private updateCacheHitRate(hit: boolean): void {
        const total = this.performanceMetrics.totalRequests;
        const current = this.performanceMetrics.cacheHitRate;
        
        if (hit) {
            this.performanceMetrics.cacheHitRate = (current * (total - 1) + 1) / total;
        } else {
            this.performanceMetrics.cacheHitRate = (current * (total - 1)) / total;
        }
    }

    /**
     * Update average response time
     */
    private updateAverageResponseTime(responseTime: number): void {
        const total = this.performanceMetrics.totalRequests;
        const current = this.performanceMetrics.averageResponseTime;
        
        this.performanceMetrics.averageResponseTime = (current * (total - 1) + responseTime) / total;
    }

    /**
     * Get max results based on context
     */
    private getMaxResultsForContext(context: CompletionContext, triggerCharacter?: string): number {
        if (triggerCharacter === '.' && context.type === 'task-output') {
            return 20;
        }
        
        if (context.type === 'task-input') {
            return 50;
        }
        
        if (context.type === 'general') {
            return 30;
        }
        
        return 40;
    }

    /**
     * Validate completion context
     */
    private async validateCompletionContext(
        document: TextDocument,
        line: number,
        character: number
    ): Promise<{ isValid: boolean; errors: string[] }> {
        const errors: string[] = [];
        
        try {
            const lineCount = document.lineCount;
            if (line < 0 || line >= lineCount) {
                errors.push(`Line ${line} is out of bounds (0-${lineCount - 1})`);
            }
            
            if (line >= 0 && line < lineCount) {
                const lineText = document.getText({
                    start: { line, character: 0 },
                    end: { line: line + 1, character: 0 }
                });
                
                if (character < 0 || character > lineText.length) {
                    errors.push(`Character ${character} is out of bounds for line ${line}`);
                }
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
     * Handle import failure gracefully
     */
    private async handleImportFailure(uri: string, error: Error): Promise<CompletionItem[]> {
        console.error('Import failure detected:', error.message);
        return this.completionItemBuilder.buildKeywordCompletions();
    }

    /**
     * Enhance documentation display
     */
    private enhanceDocumentationDisplay(completions: CompletionItem[], context: CompletionContext): CompletionItem[] {
        return completions.map(item => {
            const enhanced = { ...item };
            const itemData = item.data as any;
            
            if (itemData?.wdlInfo) {
                const docParts: string[] = [];
                
                if (itemData.wdlInfo.parameterType) {
                    docParts.push(`**Type:** \`${itemData.wdlInfo.parameterType}\``);
                }
                
                if (context.type === 'task-input') {
                    if (itemData.wdlInfo.isRequired) {
                        docParts.push('**Required parameter**');
                    } else {
                        docParts.push('**Optional parameter**');
                    }
                    
                    if (itemData.wdlInfo.hasDefault && itemData.wdlInfo.defaultValue) {
                        docParts.push(`**Default:** \`${itemData.wdlInfo.defaultValue}\``);
                    }
                }
                
                if (docParts.length > 0) {
                    enhanced.documentation = {
                        kind: 'markdown',
                        value: docParts.join('\n\n')
                    };
                }
            }
            
            return enhanced;
        });
    }

    /**
     * Apply smart cursor positioning
     */
    private applySmartCursorPositioning(completions: CompletionItem[], context: CompletionContext): CompletionItem[] {
        return completions.map(item => {
            const enhanced = { ...item };
            
            if (context.type === 'task-input') {
                const label = item.label as string;
                enhanced.insertText = `${label}: $0`;
            }
            
            return enhanced;
        });
    }

    /**
     * Setup error handling
     */
    private setupErrorHandling(): void {
        this.errorHandler.on('error', (errorReport) => {
            logger.error('Error handled by ErrorHandler', 'error-handler', {
                errorId: errorReport.id,
                operation: errorReport.context.operation
            });
        });
    }

    /**
     * Start memory cleanup
     */
    private startMemoryCleanup(): void {
        this.memoryCleanupTimer = setInterval(() => {
            this.cleanupCache();
        }, this.MEMORY_CLEANUP_INTERVAL);
    }

    /**
     * Clean up cache
     */
    private cleanupCache(): void {
        const now = Date.now();
        const toDelete: string[] = [];
        
        for (const [key, cached] of this.completionCache) {
            if (now - cached.timestamp > this.CACHE_TTL) {
                toDelete.push(key);
            }
        }
        
        for (const key of toDelete) {
            this.completionCache.delete(key);
        }
    }

    /**
     * Destroy completion provider
     */
    destroy(): void {
        if (this.memoryCleanupTimer) {
            clearInterval(this.memoryCleanupTimer);
            this.memoryCleanupTimer = undefined;
        }
        
        this.completionCache.clear();
        this.requestQueue.clear();
        this.activeRequests.clear();
        this.debounceTimers.clear();
    }
}