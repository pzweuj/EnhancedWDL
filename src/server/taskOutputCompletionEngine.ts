import {
    CompletionItem,
    CompletionItemKind,
    InsertTextFormat,
    MarkupContent,
    MarkupKind
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position } from 'vscode-languageserver/node';
import { TaskSymbol, EnhancedTaskSymbol } from './symbolProvider';
import { ParameterInfo, TaskAnalyzer } from './taskAnalyzer';
import { EnhancedTaskOutputContext } from './contextAnalyzer';

export interface TaskOutputCompletionOptions {
    showTypeInfo: boolean;
    includeDescription: boolean;
    filterByContext: boolean;
    includeSnippets: boolean;
    showSourceInfo: boolean;
    includeUsageExamples: boolean;
}

export interface OutputParameterCompletionItem extends CompletionItem {
    wdlInfo: {
        category: 'task-output';
        taskName: string;
        parameterType: string;
        sourceFile?: string;
        importAlias?: string;
        outputName: string;
    };
    sortPriority: number;
    filterTags: string[];
}

/**
 * Specialized engine for handling task output reference completions
 * Provides intelligent completion for TaskName.output patterns with type information,
 * alias resolution, and context-aware filtering
 */
export class TaskOutputCompletionEngine {
    private taskAnalyzer: TaskAnalyzer;
    private defaultOptions: TaskOutputCompletionOptions;

    constructor(options: Partial<TaskOutputCompletionOptions> = {}) {
        this.taskAnalyzer = new TaskAnalyzer();
        this.defaultOptions = {
            showTypeInfo: true,
            includeDescription: true,
            filterByContext: true,
            includeSnippets: false, // Output references typically don't need snippets
            showSourceInfo: true,
            includeUsageExamples: true,
            ...options
        };
    }

    /**
     * Generate output parameter completion items for a task
     * Provides all available outputs with type information and smart filtering
     * Enhanced to handle complex syntax structures like scatter blocks and conditionals
     */
    generateOutputCompletions(
        taskSymbol: TaskSymbol | EnhancedTaskSymbol,
        context: EnhancedTaskOutputContext,
        options?: Partial<TaskOutputCompletionOptions>
    ): OutputParameterCompletionItem[] {
        const opts = { ...this.defaultOptions, ...options };
        const completions: OutputParameterCompletionItem[] = [];

        // Get available outputs
        const availableOutputs = this.getAvailableOutputParameters(taskSymbol);

        // Enhanced filtering for complex syntax structures
        const filteredOutputs = this.filterOutputsByComplexContext(availableOutputs, context, opts);

        // Generate completion items with enhanced context awareness
        for (const output of filteredOutputs) {
            const completion = this.createOutputCompletionItemWithComplexContext(
                output,
                taskSymbol,
                context.taskName,
                context,
                opts
            );
            completions.push(completion);
        }

        // Apply intelligent sorting with complex context consideration
        return this.applySortingStrategyWithComplexContext(completions, context, opts);
    }

    /**
     * Create a completion item for an output parameter
     * Includes type information, source details, and usage examples
     */
    createOutputCompletionItem(
        output: ParameterInfo,
        taskSymbol: TaskSymbol | EnhancedTaskSymbol,
        taskName: string,
        options: TaskOutputCompletionOptions
    ): OutputParameterCompletionItem {
        const typeStr = this.taskAnalyzer.formatType(output.type);
        
        // Build label
        let label = output.name;

        // Build detail string with type information
        let detail = '';
        if (options.showTypeInfo) {
            detail = typeStr;
        }

        // Add source information for imported tasks
        if (options.showSourceInfo && this.isEnhancedTaskSymbol(taskSymbol)) {
            const enhanced = taskSymbol as EnhancedTaskSymbol;
            if (enhanced.source.type === 'imported' && enhanced.source.importAlias) {
                detail += detail ? ` • from ${enhanced.source.importAlias}` : `from ${enhanced.source.importAlias}`;
            }
        }

        // Generate insert text
        const insertText = this.generateOutputInsertText(output, options);

        // Create documentation
        const documentation = this.createOutputDocumentation(output, taskSymbol, taskName, options);

        // Calculate sort priority
        const sortPriority = this.calculateSortPriority(output);

        // Build completion item
        const completion: OutputParameterCompletionItem = {
            label,
            kind: CompletionItemKind.Property,
            detail,
            documentation,
            insertText,
            insertTextFormat: options.includeSnippets ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
            sortText: this.generateSortText(output.name, sortPriority),
            filterText: output.name,
            wdlInfo: {
                category: 'task-output',
                taskName,
                parameterType: typeStr,
                sourceFile: taskSymbol.sourceFile,
                importAlias: this.isEnhancedTaskSymbol(taskSymbol) ? 
                    (taskSymbol as EnhancedTaskSymbol).source.importAlias : undefined,
                outputName: output.name
            },
            sortPriority,
            filterTags: this.generateFilterTags(output)
        };

        return completion;
    }

    /**
     * Parse task output reference from text
     * Identifies TaskName.output patterns and extracts components
     */
    parseTaskOutputReference(
        text: string,
        position: Position
    ): {taskName: string, outputName?: string} | null {
        const offset = this.positionToOffset(text, position);
        
        // Look backwards from position to find the pattern
        let pos = offset;
        
        // Skip whitespace
        while (pos > 0 && /\s/.test(text[pos - 1])) {
            pos--;
        }
        
        // If we're at a dot, we're looking for the task name before it
        if (pos > 0 && text[pos - 1] === '.') {
            pos--; // Move to the dot
            const dotPos = pos;
            
            // Extract task name before the dot
            let taskNameEnd = pos;
            while (pos > 0 && /[a-zA-Z0-9_.]/.test(text[pos - 1])) {
                pos--;
            }
            
            const taskName = text.substring(pos, taskNameEnd);
            
            // Check if there's an output name after the dot
            let outputName: string | undefined;
            const afterDot = text.substring(dotPos + 1, offset + 20);
            const outputMatch = afterDot.match(/^(\w+)/);
            if (outputMatch) {
                outputName = outputMatch[1];
            }
            
            if (this.isValidTaskName(taskName)) {
                return { taskName, outputName };
            }
        } else {
            // We might be in the middle of typing an output name
            // Look backwards for the pattern TaskName.partialOutput
            const beforeCursor = text.substring(Math.max(0, offset - 50), offset);
            const outputRefMatch = beforeCursor.match(/(\w+(?:\.\w+)*)\.\s*(\w*)$/);
            
            if (outputRefMatch) {
                const taskName = outputRefMatch[1];
                const partialOutput = outputRefMatch[2];
                
                if (this.isValidTaskName(taskName)) {
                    return { taskName, outputName: partialOutput || undefined };
                }
            }
        }
        
        return null;
    }

    /**
     * Resolve task name considering aliases
     * Handles both local tasks and imported tasks with aliases
     */
    resolveTaskNameWithAlias(
        taskName: string,
        imports: any[],
        contextUri: string
    ): string {
        // If task name contains dot, it might be aliased
        if (taskName.includes('.')) {
            const parts = taskName.split('.');
            const alias = parts[0];
            const actualTaskName = parts.slice(1).join('.');
            
            // Find the import with this alias
            const importInfo = imports.find(imp => imp.alias === alias);
            if (importInfo && importInfo.tasks) {
                // Check if the task exists in the imported file
                const task = importInfo.tasks.find((t: any) => 
                    t.name === actualTaskName || 
                    t.name.endsWith(`.${actualTaskName}`) ||
                    this.extractOriginalTaskName(t.name) === actualTaskName
                );
                if (task) {
                    return task.name;
                }
            }
            
            // Return the original name if not found in imports
            return taskName;
        }
        
        // For non-aliased names, check if it exists in local tasks first
        // If not found locally, check imports without alias
        for (const importInfo of imports) {
            if (!importInfo.alias && importInfo.tasks) {
                const task = importInfo.tasks.find((t: any) => 
                    t.name === taskName || 
                    this.extractOriginalTaskName(t.name) === taskName
                );
                if (task) {
                    return task.name;
                }
            }
        }
        
        return taskName;
    }

    /**
     * Get available output parameters from task symbol
     */
    private getAvailableOutputParameters(taskSymbol: TaskSymbol | EnhancedTaskSymbol): ParameterInfo[] {
        return taskSymbol.outputs || [];
    }

    /**
     * Filter outputs based on context (e.g., expected type, usage pattern)
     */
    private filterOutputsByContext(
        outputs: ParameterInfo[],
        context: EnhancedTaskOutputContext
    ): ParameterInfo[] {
        // For now, return all outputs
        // In the future, this could filter based on expected type or usage context
        return outputs;
    }

    /**
     * Generate insert text for output parameter
     */
    private generateOutputInsertText(
        output: ParameterInfo,
        options: TaskOutputCompletionOptions
    ): string {
        // For output references, we typically just insert the output name
        return output.name;
    }

    /**
     * Create rich documentation for output parameter
     */
    private createOutputDocumentation(
        output: ParameterInfo,
        taskSymbol: TaskSymbol | EnhancedTaskSymbol,
        taskName: string,
        options: TaskOutputCompletionOptions
    ): MarkupContent {
        const content: string[] = [];
        
        // Output header
        content.push(`**${taskName}.${output.name}**`, '');
        
        // Description
        if (options.includeDescription && output.description) {
            content.push(output.description, '');
        }
        
        // Type information
        if (options.showTypeInfo) {
            const typeStr = this.taskAnalyzer.formatType(output.type);
            content.push(`📋 **Type:** \`${typeStr}\``);
            
            // Optional indicator
            if (output.optional) {
                content.push(`🟡 **Optional output**`);
            } else {
                content.push(`🔴 **Required output**`);
            }
            content.push('');
        }
        
        // Source information
        if (options.showSourceInfo) {
            if (this.isEnhancedTaskSymbol(taskSymbol)) {
                const enhanced = taskSymbol as EnhancedTaskSymbol;
                if (enhanced.source.type === 'imported') {
                    content.push(`📦 **Source:** Imported from ${enhanced.source.importAlias || 'external file'}`);
                    if (enhanced.source.importPath) {
                        content.push(`📁 **Import Path:** \`${enhanced.source.importPath}\``);
                    }
                } else {
                    content.push(`🏠 **Source:** Local task`);
                }
            } else {
                content.push(`📄 **Source:** \`${taskSymbol.sourceFile}\``);
            }
            content.push('');
        }
        
        // Usage example
        if (options.includeUsageExamples) {
            const example = this.generateOutputUsageExample(output, taskName);
            if (example) {
                content.push(`💡 **Usage Example:**`, '```wdl', example, '```');
            }
        }
        
        return {
            kind: MarkupKind.Markdown,
            value: content.join('\n')
        };
    }

    /**
     * Generate usage example for output parameter
     */
    private generateOutputUsageExample(output: ParameterInfo, taskName: string): string {
        const outputRef = `${taskName}.${output.name}`;
        const baseType = output.type.name.toLowerCase();
        const outputName = output.name.toLowerCase();
        
        // Context-aware examples based on output name and type
        if (outputName.includes('file') || baseType === 'file') {
            return `File result_file = ${outputRef}`;
        }
        
        if (outputName.includes('count') || outputName.includes('number')) {
            return `Int count = ${outputRef}`;
        }
        
        if (outputName.includes('result') || outputName.includes('output')) {
            if (baseType === 'array') {
                return `Array[String] results = ${outputRef}`;
            }
            return `String result = ${outputRef}`;
        }
        
        if (outputName.includes('log') || outputName.includes('report')) {
            return `File log_file = ${outputRef}`;
        }
        
        // Default examples by type
        switch (baseType) {
            case 'string':
                return `String value = ${outputRef}`;
            case 'int':
                return `Int number = ${outputRef}`;
            case 'float':
                return `Float value = ${outputRef}`;
            case 'boolean':
                return `Boolean flag = ${outputRef}`;
            case 'file':
                return `File output_file = ${outputRef}`;
            case 'array':
                return `Array[String] items = ${outputRef}`;
            case 'map':
                return `Map[String, String] mapping = ${outputRef}`;
            default:
                return `${this.capitalizeFirst(baseType)} value = ${outputRef}`;
        }
    }

    /**
     * Apply intelligent sorting strategy
     * Common outputs first, then alphabetical
     */
    private applySortingStrategy(
        completions: OutputParameterCompletionItem[],
        options: TaskOutputCompletionOptions
    ): OutputParameterCompletionItem[] {
        return completions.sort((a, b) => {
            // First by priority (lower number = higher priority)
            if (a.sortPriority !== b.sortPriority) {
                return a.sortPriority - b.sortPriority;
            }
            
            // Then alphabetically by output name
            return a.wdlInfo.outputName.localeCompare(b.wdlInfo.outputName);
        });
    }

    /**
     * Calculate sort priority for output parameter
     */
    private calculateSortPriority(output: ParameterInfo): number {
        let priority = 2; // Default priority
        
        const outputName = output.name.toLowerCase();
        
        // Boost priority for common output names
        if (outputName.includes('output') || outputName.includes('result')) {
            priority = 1;
        } else if (outputName.includes('file') || outputName.includes('log')) {
            priority = 1.5;
        } else if (outputName.includes('count') || outputName.includes('summary')) {
            priority = 1.8;
        }
        
        return priority;
    }

    /**
     * Generate sort text for consistent ordering
     */
    private generateSortText(outputName: string, priority: number): string {
        // Format: priority_outputName (e.g., "1_output_file", "2_log_file")
        return `${priority.toFixed(2)}_${outputName}`;
    }

    /**
     * Generate filter tags for enhanced filtering
     */
    private generateFilterTags(output: ParameterInfo): string[] {
        const tags: string[] = [];
        
        // Type tags
        tags.push(output.type.name.toLowerCase());
        
        // Output name based tags
        const outputName = output.name.toLowerCase();
        if (outputName.includes('output')) tags.push('output');
        if (outputName.includes('result')) tags.push('result');
        if (outputName.includes('file')) tags.push('file');
        if (outputName.includes('log')) tags.push('log');
        if (outputName.includes('report')) tags.push('report');
        if (outputName.includes('count')) tags.push('count');
        if (outputName.includes('summary')) tags.push('summary');
        
        // Optional/required tags
        tags.push(output.optional ? 'optional' : 'required');
        
        return tags;
    }

    /**
     * Validate task name format
     */
    private isValidTaskName(taskName: string): boolean {
        // Task name should be either "TaskName" or "alias.TaskName"
        return /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(taskName);
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
     * Type guard to check if task symbol is enhanced
     */
    private isEnhancedTaskSymbol(taskSymbol: TaskSymbol | EnhancedTaskSymbol): taskSymbol is EnhancedTaskSymbol {
        return 'source' in taskSymbol;
    }

    /**
     * Convert position to offset in text
     */
    private positionToOffset(text: string, position: Position): number {
        const lines = text.split('\n');
        let offset = 0;
        
        for (let i = 0; i < position.line && i < lines.length; i++) {
            offset += lines[i].length + 1; // +1 for newline
        }
        
        offset += Math.min(position.character, lines[position.line]?.length || 0);
        return offset;
    }

    /**
     * Enhanced filtering for complex syntax structures
     */
    private filterOutputsByComplexContext(
        outputs: ParameterInfo[],
        context: EnhancedTaskOutputContext,
        options: TaskOutputCompletionOptions
    ): ParameterInfo[] {
        let filteredOutputs = outputs;
        
        // Apply base context filtering first
        if (options.filterByContext) {
            filteredOutputs = this.filterOutputsByContext(outputs, context);
        }
        
        // Enhanced filtering for scatter blocks
        if (context.isInScatterBlock) {
            // In scatter blocks, all outputs become arrays
            // No need to filter, but we'll modify the type information later
            return filteredOutputs;
        }
        
        // Enhanced filtering for conditional blocks
        if (context.isInConditionalBlock) {
            // In conditional blocks, optional outputs might be more relevant
            // But we don't filter them out, just adjust priority later
            return filteredOutputs;
        }
        
        // Enhanced filtering for nested expressions
        if (context.isInNestedExpression) {
            // In nested expressions, prefer simpler output types
            const primitiveTypes = ['string', 'int', 'float', 'boolean', 'file'];
            return filteredOutputs.filter(output => 
                primitiveTypes.includes(output.type.name.toLowerCase()) ||
                output.type.name.toLowerCase() === 'array'
            );
        }
        
        return filteredOutputs;
    }

    /**
     * Create output completion item with enhanced complex context awareness
     */
    private createOutputCompletionItemWithComplexContext(
        output: ParameterInfo,
        taskSymbol: TaskSymbol | EnhancedTaskSymbol,
        taskName: string,
        context: EnhancedTaskOutputContext,
        options: TaskOutputCompletionOptions
    ): OutputParameterCompletionItem {
        // Start with the base completion item
        const baseItem = this.createOutputCompletionItem(output, taskSymbol, taskName, options);
        
        // Enhance with complex context information
        if (context.isInScatterBlock) {
            // In scatter blocks, outputs become arrays
            const originalType = baseItem.wdlInfo.parameterType;
            baseItem.wdlInfo.parameterType = `Array[${originalType}]`;
            baseItem.detail = `Array[${originalType}] • From scatter block`;
            
            if (context.scatterVariable) {
                baseItem.detail += ` (${context.scatterVariable})`;
            }
            
            // Update documentation to reflect array nature
            baseItem.documentation = this.createScatterOutputDocumentation(
                output, taskSymbol, taskName, context, options
            );
        }
        
        if (context.isInConditionalBlock) {
            // Add conditional context information
            baseItem.detail += ` • In ${context.conditionalContext || 'conditional'} block`;
            
            // In conditional blocks, outputs might be optional
            if (!output.optional) {
                baseItem.detail += ' • May be undefined in some branches';
            }
        }
        
        if (context.isInNestedExpression) {
            // Add nesting information
            baseItem.detail += ' • In nested expression';
            
            // Suggest simpler usage patterns
            baseItem.insertText = this.generateNestedExpressionOutputInsertText(output);
        }
        
        return baseItem;
    }

    /**
     * Create documentation for scatter block outputs
     */
    private createScatterOutputDocumentation(
        output: ParameterInfo,
        taskSymbol: TaskSymbol | EnhancedTaskSymbol,
        taskName: string,
        context: EnhancedTaskOutputContext,
        options: TaskOutputCompletionOptions
    ): MarkupContent {
        const content: string[] = [];
        
        // Output header with array type
        const originalType = this.taskAnalyzer.formatType(output.type);
        content.push(`**${taskName}.${output.name}** (Scatter Output)`, '');
        
        // Scatter context explanation
        content.push(`🔄 **Scatter Context:** This output is collected from multiple task executions`);
        if (context.scatterVariable) {
            content.push(`📊 **Scatter Variable:** \`${context.scatterVariable}\``);
        }
        content.push('');
        
        // Type information
        content.push(`📋 **Original Type:** \`${originalType}\``);
        content.push(`📋 **Scatter Type:** \`Array[${originalType}]\``);
        content.push('');
        
        // Description
        if (options.includeDescription && output.description) {
            content.push('**Description:**');
            content.push(output.description);
            content.push('');
        }
        
        // Usage example for scatter outputs
        const example = this.generateScatterOutputUsageExample(output, taskName, originalType);
        if (example) {
            content.push(`💡 **Scatter Usage Example:**`, '```wdl', example, '```');
        }
        
        return {
            kind: MarkupKind.Markdown,
            value: content.join('\n')
        };
    }

    /**
     * Generate usage example for scatter block outputs
     */
    private generateScatterOutputUsageExample(
        output: ParameterInfo,
        taskName: string,
        originalType: string
    ): string {
        const outputRef = `${taskName}.${output.name}`;
        const arrayType = `Array[${originalType}]`;
        
        // Generate context-aware examples
        const outputName = output.name.toLowerCase();
        
        if (outputName.includes('file') || originalType.toLowerCase() === 'file') {
            return `# Collect all output files from scatter
${arrayType} all_files = ${outputRef}

# Use in another task
call ProcessFiles {
    input: files = ${outputRef}
}`;
        }
        
        if (outputName.includes('result') || outputName.includes('output')) {
            return `# Collect all results from scatter
${arrayType} all_results = ${outputRef}

# Flatten or process results
Array[String] flattened = flatten(${outputRef})`;
        }
        
        if (outputName.includes('count') || originalType.toLowerCase() === 'int') {
            return `# Sum all counts from scatter
${arrayType} all_counts = ${outputRef}
Int total_count = length(${outputRef})`;
        }
        
        // Default example
        return `# Collect all outputs from scatter
${arrayType} collected_outputs = ${outputRef}

# Access individual elements
${originalType} first_output = ${outputRef}[0]`;
    }

    /**
     * Generate insert text optimized for nested expressions
     */
    private generateNestedExpressionOutputInsertText(output: ParameterInfo): string {
        // In nested expressions, just insert the output name without extra formatting
        return output.name;
    }

    /**
     * Apply intelligent sorting with complex context consideration
     */
    private applySortingStrategyWithComplexContext(
        completions: OutputParameterCompletionItem[],
        context: EnhancedTaskOutputContext,
        options: TaskOutputCompletionOptions
    ): OutputParameterCompletionItem[] {
        return completions.sort((a, b) => {
            // First, apply context-specific priority adjustments
            let aPriority = a.sortPriority;
            let bPriority = b.sortPriority;
            
            // In scatter blocks, prioritize array-compatible outputs
            if (context.isInScatterBlock) {
                // File outputs are commonly used in scatter blocks
                if (a.wdlInfo.parameterType.toLowerCase().includes('file')) {
                    aPriority -= 0.2;
                }
                if (b.wdlInfo.parameterType.toLowerCase().includes('file')) {
                    bPriority -= 0.2;
                }
                
                // Result/output parameters are also common
                if (a.wdlInfo.outputName.toLowerCase().includes('output') || 
                    a.wdlInfo.outputName.toLowerCase().includes('result')) {
                    aPriority -= 0.1;
                }
                if (b.wdlInfo.outputName.toLowerCase().includes('output') || 
                    b.wdlInfo.outputName.toLowerCase().includes('result')) {
                    bPriority -= 0.1;
                }
            }
            
            // In conditional blocks, prioritize required outputs
            if (context.isInConditionalBlock) {
                // Required outputs are more likely to be available in all branches
                const aIsRequired = !a.wdlInfo.parameterType.includes('?'); // Simple heuristic
                const bIsRequired = !b.wdlInfo.parameterType.includes('?');
                
                if (aIsRequired && !bIsRequired) {
                    aPriority -= 0.1;
                } else if (!aIsRequired && bIsRequired) {
                    bPriority -= 0.1;
                }
            }
            
            // In nested expressions, prioritize primitive types
            if (context.isInNestedExpression) {
                const primitiveTypes = ['string', 'int', 'float', 'boolean'];
                const aIsPrimitive = primitiveTypes.some(type => 
                    a.wdlInfo.parameterType.toLowerCase().includes(type));
                const bIsPrimitive = primitiveTypes.some(type => 
                    b.wdlInfo.parameterType.toLowerCase().includes(type));
                
                if (aIsPrimitive && !bIsPrimitive) {
                    aPriority -= 0.15;
                } else if (!aIsPrimitive && bIsPrimitive) {
                    bPriority -= 0.15;
                }
            }
            
            // Apply the adjusted priorities
            if (aPriority !== bPriority) {
                return aPriority - bPriority;
            }
            
            // Fall back to alphabetical sorting
            return a.wdlInfo.outputName.localeCompare(b.wdlInfo.outputName);
        });
    }

    /**
     * Capitalize first letter of string
     */
    private capitalizeFirst(str: string): string {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
}