import {
    CompletionItem
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SymbolProvider, TaskSymbol } from './symbolProvider';
import { TaskAnalyzer } from './taskAnalyzer';
import { ContextAnalyzer, CompletionContext } from './contextAnalyzer';
import { CompletionItemBuilder, CompletionItemOptions } from './completionItemBuilder';

export class CompletionProvider {
    private symbolProvider: SymbolProvider;
    private contextAnalyzer: ContextAnalyzer;
    private completionItemBuilder: CompletionItemBuilder;
    
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
    }
    
    /**
     * Provide completion items for a position in a document
     */
    provideCompletionItems(document: TextDocument, line: number, character: number): CompletionItem[] {
        try {
            const position = { line, character };
            
            // Use ContextAnalyzer to determine completion context
            const context = this.getCompletionContext(document, position);
            
            // Handle different completion contexts with enhanced logic
            switch (context.type) {
                case 'task-call':
                    return this.getTaskCompletions(document.uri);
                
                case 'task-input':
                    return this.getTaskInputCompletions(context.resolvedTaskName || context.taskName!, document.uri);
                
                case 'task-output':
                    return this.getTaskOutputCompletions(context.resolvedTaskName || context.taskName!, document.uri);
                
                case 'assignment-value':
                    return this.getValueCompletions(document.uri);
                
                default:
                    return this.getGeneralCompletions(document.uri);
            }
        } catch (error) {
            // Fallback to general completions on error
            console.error('Error in provideCompletionItems:', error);
            return this.getGeneralCompletions(document.uri);
        }
    }
    
    /**
     * Enhanced completion context analysis using ContextAnalyzer
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
    } {
        return {
            symbolProviderStats: this.symbolProvider.getStatistics(),
            isReady: this.isReady()
        };
    }

}

