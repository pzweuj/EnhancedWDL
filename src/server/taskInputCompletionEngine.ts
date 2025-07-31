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
import { TaskInputContext } from './contextAnalyzer';

export interface TaskInputCompletionOptions {
    showRequired: boolean;
    showOptional: boolean;
    includeTypeInfo: boolean;
    includeDefaultValues: boolean;
    prioritizeRequired: boolean;
    includeSnippets: boolean;
    showSourceInfo: boolean;
    includeDescriptions: boolean;
}

export interface InputParameterCompletionItem extends CompletionItem {
    wdlInfo: {
        category: 'task-input';
        taskName: string;
        parameterType: string;
        isRequired: boolean;
        hasDefault: boolean;
        sourceFile?: string;
        importAlias?: string;
    };
    sortPriority: number;
    filterTags: string[];
}

/**
 * Specialized engine for handling task input parameter completions
 * Provides intelligent completion for task call input blocks with type information,
 * required/optional parameter distinction, and smart filtering of already used inputs
 */
export class TaskInputCompletionEngine {
    private taskAnalyzer: TaskAnalyzer;
    private defaultOptions: TaskInputCompletionOptions;

    constructor(options: Partial<TaskInputCompletionOptions> = {}) {
        this.taskAnalyzer = new TaskAnalyzer();
        this.defaultOptions = {
            showRequired: true,
            showOptional: true,
            includeTypeInfo: true,
            includeDefaultValues: true,
            prioritizeRequired: true,
            includeSnippets: true,
            showSourceInfo: true,
            includeDescriptions: true,
            ...options
        };
    }

    /**
     * Generate input parameter completion items for a task
     * Filters out already used inputs and provides intelligent sorting
     * Enhanced to handle complex syntax structures like scatter blocks and conditionals
     */
    generateInputCompletions(
        taskSymbol: TaskSymbol | EnhancedTaskSymbol,
        context: TaskInputContext,
        options?: Partial<TaskInputCompletionOptions>
    ): InputParameterCompletionItem[] {
        const opts = { ...this.defaultOptions, ...options };
        const completions: InputParameterCompletionItem[] = [];

        // Get available inputs (excluding already used ones)
        const availableInputs = this.getAvailableInputParameters(taskSymbol, context.usedInputs);

        // Filter inputs based on options and complex syntax context
        const filteredInputs = availableInputs.filter(input => {
            if (!input.optional && !opts.showRequired) return false;
            if (input.optional && !opts.showOptional) return false;
            
            // Enhanced filtering for complex syntax structures
            return this.isInputValidInComplexContext(input, context);
        });

        // Generate completion items with enhanced context awareness
        for (const input of filteredInputs) {
            const completion = this.createInputCompletionItemWithComplexContext(
                input,
                taskSymbol,
                !input.optional,
                context,
                opts
            );
            completions.push(completion);
        }

        // Apply intelligent sorting with complex context consideration
        return this.applySortingStrategyWithComplexContext(completions, context, opts);
    }

    /**
     * Create a completion item for an input parameter
     * Includes type information, requirement status, and smart snippets
     */
    createInputCompletionItem(
        input: ParameterInfo,
        taskSymbol: TaskSymbol | EnhancedTaskSymbol,
        isRequired: boolean,
        options: TaskInputCompletionOptions
    ): InputParameterCompletionItem {
        const typeStr = this.taskAnalyzer.formatType(input.type);
        
        // Build label with requirement indicator
        let label = input.name;
        if (options.prioritizeRequired) {
            label = isRequired ? `🔴 ${input.name}` : `🟡 ${input.name}`;
        }

        // Build detail string with type and requirement info
        let detail = '';
        if (options.includeTypeInfo) {
            detail = typeStr;
        }
        
        if (isRequired) {
            detail += detail ? ' • Required' : 'Required';
        } else {
            detail += detail ? ' • Optional' : 'Optional';
            if (options.includeDefaultValues && input.defaultValue !== undefined) {
                detail += ` • Default: ${input.defaultValue}`;
            }
        }

        // Add source information for imported tasks
        if (options.showSourceInfo && this.isEnhancedTaskSymbol(taskSymbol)) {
            const enhanced = taskSymbol as EnhancedTaskSymbol;
            if (enhanced.source.type === 'imported' && enhanced.source.importAlias) {
                detail += ` • from ${enhanced.source.importAlias}`;
            }
        }

        // Generate insert text with smart snippets
        const insertText = this.generateInputInsertText(input, options);

        // Create documentation
        const documentation = this.createInputDocumentation(input, taskSymbol, options);

        // Calculate sort priority (required parameters first)
        const sortPriority = this.calculateSortPriority(input, isRequired);

        // Build completion item
        const completion: InputParameterCompletionItem = {
            label,
            kind: CompletionItemKind.Property,
            detail,
            documentation,
            insertText,
            insertTextFormat: options.includeSnippets ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
            sortText: this.generateSortText(input.name, sortPriority),
            filterText: input.name,
            wdlInfo: {
                category: 'task-input',
                taskName: taskSymbol.name,
                parameterType: typeStr,
                isRequired,
                hasDefault: input.defaultValue !== undefined,
                sourceFile: taskSymbol.sourceFile,
                importAlias: this.isEnhancedTaskSymbol(taskSymbol) ? 
                    (taskSymbol as EnhancedTaskSymbol).source.importAlias : undefined
            },
            sortPriority,
            filterTags: this.generateFilterTags(input, isRequired)
        };

        return completion;
    }

    /**
     * Detect already used input parameters in a call statement
     * Analyzes the document text to find existing input assignments
     */
    detectUsedInputs(document: TextDocument, callPosition: Position): string[] {
        const text = document.getText();
        const offset = document.offsetAt(callPosition);
        
        // Find the call statement containing this position
        const callInfo = this.findCallStatementAtPosition(text, offset);
        if (!callInfo) {
            return [];
        }

        return callInfo.usedInputs;
    }

    /**
     * Get available input parameters excluding already used ones
     */
    private getAvailableInputParameters(
        taskSymbol: TaskSymbol | EnhancedTaskSymbol,
        usedInputs: string[]
    ): ParameterInfo[] {
        return taskSymbol.inputs.filter(input => !usedInputs.includes(input.name));
    }

    /**
     * Generate smart insert text for input parameter
     * Creates snippets with type-appropriate placeholders
     */
    private generateInputInsertText(
        input: ParameterInfo,
        options: TaskInputCompletionOptions
    ): string {
        if (!options.includeSnippets) {
            return `${input.name} = `;
        }

        // Generate type-appropriate placeholder
        const placeholder = this.generateTypePlaceholder(input.type, input);
        
        // Add description hint if available and enabled
        if (options.includeDescriptions && input.description) {
            const hint = input.description.length > 50 
                ? input.description.substring(0, 47) + '...' 
                : input.description;
            return `${input.name} = ${placeholder}$0 // ${hint}`;
        }

        return `${input.name} = ${placeholder}$0`;
    }

    /**
     * Generate type-appropriate placeholder for snippets
     */
    private generateTypePlaceholder(type: ParameterInfo['type'], parameter: ParameterInfo): string {
        const baseType = type.name.toLowerCase();
        
        // Use default value if available
        if (parameter.defaultValue !== undefined) {
            return `\${1:${parameter.defaultValue}}`;
        }

        // Context-aware placeholders based on parameter name
        const paramName = parameter.name.toLowerCase();
        
        switch (baseType) {
            case 'string':
                if (paramName.includes('path') || paramName.includes('file')) {
                    return `\${1:"path/to/file"}`;
                }
                if (paramName.includes('name') || paramName.includes('prefix')) {
                    return `\${1:"sample_name"}`;
                }
                if (paramName.includes('output')) {
                    return `\${1:"output_prefix"}`;
                }
                return `\${1:"value"}`;
                
            case 'int':
                if (paramName.includes('thread') || paramName.includes('cpu')) {
                    return `\${1:4}`;
                }
                if (paramName.includes('memory') || paramName.includes('mem')) {
                    return `\${1:8}`;
                }
                if (paramName.includes('timeout')) {
                    return `\${1:3600}`;
                }
                return `\${1:1}`;
                
            case 'float':
                if (paramName.includes('threshold')) {
                    return `\${1:0.05}`;
                }
                if (paramName.includes('ratio') || paramName.includes('rate')) {
                    return `\${1:0.5}`;
                }
                return `\${1:1.0}`;
                
            case 'boolean':
                return `\${1|true,false|}`;
                
            case 'file':
                if (paramName.includes('input')) {
                    return `\${1:input_file}`;
                }
                if (paramName.includes('reference') || paramName.includes('ref')) {
                    return `\${1:reference.fa}`;
                }
                if (paramName.includes('index')) {
                    return `\${1:index_file}`;
                }
                return `\${1:file_path}`;
                
            case 'array':
                if (type.arrayElementType?.name.toLowerCase() === 'file') {
                    return `\${1:[input_file1, input_file2]}`;
                }
                if (type.arrayElementType?.name.toLowerCase() === 'string') {
                    return `\${1:["item1", "item2"]}`;
                }
                return `\${1:[]}`;
                
            case 'map':
                return `\${1:{"key": "value"}}`;
                
            case 'pair':
                return `\${1:(left, right)}`;
                
            default:
                return `\${1:value}`;
        }
    }

    /**
     * Create rich documentation for input parameter
     */
    private createInputDocumentation(
        input: ParameterInfo,
        taskSymbol: TaskSymbol | EnhancedTaskSymbol,
        options: TaskInputCompletionOptions
    ): MarkupContent {
        const content: string[] = [];
        
        // Parameter header
        content.push(`**${input.name}**`, '');
        
        // Description
        if (options.includeDescriptions && input.description) {
            content.push(input.description, '');
        }
        
        // Type information
        if (options.includeTypeInfo) {
            const typeStr = this.taskAnalyzer.formatType(input.type);
            content.push(`📋 **Type:** \`${typeStr}\``);
            
            // Requirement status
            if (input.optional) {
                content.push(`🟡 **Optional parameter**`);
                if (options.includeDefaultValues && input.defaultValue !== undefined) {
                    content.push(`⚙️ **Default:** \`${input.defaultValue}\``);
                }
            } else {
                content.push(`🔴 **Required parameter**`);
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
        const example = this.generateParameterExample(input);
        if (example) {
            content.push(`💡 **Example:**`, '```wdl', example, '```');
        }
        
        return {
            kind: MarkupKind.Markdown,
            value: content.join('\n')
        };
    }

    /**
     * Generate usage example for parameter
     */
    private generateParameterExample(input: ParameterInfo): string {
        const baseType = input.type.name.toLowerCase();
        const paramName = input.name.toLowerCase();
        
        // Context-aware examples
        if (paramName.includes('input') && baseType === 'file') {
            return `${input.name} = input_file`;
        }
        
        if (paramName.includes('output') && baseType === 'string') {
            return `${input.name} = "output_prefix"`;
        }
        
        if (paramName.includes('thread') && baseType === 'int') {
            return `${input.name} = 4`;
        }
        
        if (paramName.includes('memory') && baseType === 'int') {
            return `${input.name} = 8`;
        }
        
        // Default examples by type
        switch (baseType) {
            case 'string':
                return `${input.name} = "example_value"`;
            case 'int':
                return `${input.name} = 42`;
            case 'float':
                return `${input.name} = 3.14`;
            case 'boolean':
                return `${input.name} = true`;
            case 'file':
                return `${input.name} = input_file`;
            case 'array':
                return `${input.name} = ["item1", "item2"]`;
            case 'map':
                return `${input.name} = {"key": "value"}`;
            default:
                return `${input.name} = value`;
        }
    }

    /**
     * Apply intelligent sorting strategy
     * Required parameters first, then alphabetical within each group
     */
    private applySortingStrategy(
        completions: InputParameterCompletionItem[],
        options: TaskInputCompletionOptions
    ): InputParameterCompletionItem[] {
        if (!options.prioritizeRequired) {
            // Simple alphabetical sort
            return completions.sort((a, b) => a.label.localeCompare(b.label));
        }

        // Sort by priority (required first), then alphabetically
        return completions.sort((a, b) => {
            // First by priority (lower number = higher priority)
            if (a.sortPriority !== b.sortPriority) {
                return a.sortPriority - b.sortPriority;
            }
            
            // Then alphabetically by parameter name
            const aName = a.wdlInfo.isRequired ? a.label.substring(2) : a.label.substring(2); // Remove emoji
            const bName = b.wdlInfo.isRequired ? b.label.substring(2) : b.label.substring(2);
            return aName.localeCompare(bName);
        });
    }

    /**
     * Calculate sort priority for parameter
     */
    private calculateSortPriority(input: ParameterInfo, isRequired: boolean): number {
        // Required parameters get priority 1, optional get priority 2
        let priority = isRequired ? 1 : 2;
        
        // Boost priority for common parameter names
        const paramName = input.name.toLowerCase();
        if (paramName.includes('input') || paramName.includes('file')) {
            priority -= 0.1;
        }
        if (paramName.includes('output') || paramName.includes('prefix')) {
            priority -= 0.05;
        }
        
        return priority;
    }

    /**
     * Generate sort text for consistent ordering
     */
    private generateSortText(paramName: string, priority: number): string {
        // Format: priority_paramName (e.g., "1_input_file", "2_optional_param")
        return `${priority.toFixed(2)}_${paramName}`;
    }

    /**
     * Generate filter tags for enhanced filtering
     */
    private generateFilterTags(input: ParameterInfo, isRequired: boolean): string[] {
        const tags: string[] = [];
        
        // Requirement tags
        tags.push(isRequired ? 'required' : 'optional');
        
        // Type tags
        tags.push(input.type.name.toLowerCase());
        
        // Parameter name based tags
        const paramName = input.name.toLowerCase();
        if (paramName.includes('input')) tags.push('input');
        if (paramName.includes('output')) tags.push('output');
        if (paramName.includes('file')) tags.push('file');
        if (paramName.includes('path')) tags.push('path');
        if (paramName.includes('thread')) tags.push('thread');
        if (paramName.includes('memory')) tags.push('memory');
        
        return tags;
    }

    /**
     * Find call statement at a specific position in text
     */
    private findCallStatementAtPosition(text: string, offset: number): { usedInputs: string[] } | null {
        // This is a simplified implementation
        // In a real implementation, this would parse the call statement more thoroughly
        
        // Look backwards to find the start of the call statement
        let pos = offset;
        let braceDepth = 0;
        
        // Find the opening brace of the current call
        while (pos >= 0) {
            if (text[pos] === '}') {
                braceDepth++;
            } else if (text[pos] === '{') {
                if (braceDepth === 0) {
                    // Found the opening brace, now look for "call" keyword
                    const beforeBrace = text.substring(Math.max(0, pos - 50), pos);
                    const callMatch = beforeBrace.match(/call\s+(\w+(?:\.\w+)*)\s*$/);
                    if (callMatch) {
                        // Parse the call content to find used inputs
                        const callEnd = this.findMatchingCloseBrace(text, pos);
                        const callContent = text.substring(pos + 1, callEnd);
                        return { usedInputs: this.parseUsedInputs(callContent) };
                    }
                    break;
                } else {
                    braceDepth--;
                }
            }
            pos--;
        }
        
        return null;
    }

    /**
     * Find matching closing brace
     */
    private findMatchingCloseBrace(text: string, openPos: number): number {
        let pos = openPos + 1;
        let depth = 1;
        
        while (pos < text.length && depth > 0) {
            if (text[pos] === '{') {
                depth++;
            } else if (text[pos] === '}') {
                depth--;
            }
            pos++;
        }
        
        return depth === 0 ? pos - 1 : text.length;
    }

    /**
     * Parse used inputs from call content
     */
    private parseUsedInputs(callContent: string): string[] {
        const usedInputs: string[] = [];
        
        // Look for input block
        const inputMatch = callContent.match(/input\s*:\s*(.*?)(?=\s*(output|runtime|meta|parameter_meta)\s*:|$)/s);
        if (inputMatch) {
            const inputContent = inputMatch[1];
            
            // Find all input assignments
            const inputRegex = /(\w+)\s*=/g;
            let match;
            while ((match = inputRegex.exec(inputContent)) !== null) {
                usedInputs.push(match[1]);
            }
        }
        
        return usedInputs;
    }

    /**
     * Check if input parameter is valid in complex syntax context
     */
    private isInputValidInComplexContext(input: ParameterInfo, context: TaskInputContext): boolean {
        // In scatter blocks, array inputs might need special handling
        if (context.isInScatterBlock) {
            // If the input type is an array and we're in a scatter block,
            // it might be used differently (e.g., scattered over)
            if (input.type.name.toLowerCase() === 'array') {
                // Array inputs are still valid but might have different semantics
                return true;
            }
        }
        
        // In conditional blocks, all inputs are generally valid
        if (context.isInConditionalBlock) {
            // Optional inputs might be more relevant in conditional contexts
            return true;
        }
        
        // In nested expressions, prefer simpler types
        if (context.isInNestedExpression && context.nestingLevel && context.nestingLevel > 2) {
            // Prefer primitive types in deeply nested expressions
            const primitiveTypes = ['string', 'int', 'float', 'boolean', 'file'];
            return primitiveTypes.includes(input.type.name.toLowerCase());
        }
        
        return true;
    }

    /**
     * Create input completion item with enhanced complex context awareness
     */
    private createInputCompletionItemWithComplexContext(
        input: ParameterInfo,
        taskSymbol: TaskSymbol | EnhancedTaskSymbol,
        isRequired: boolean,
        context: TaskInputContext,
        options: TaskInputCompletionOptions
    ): InputParameterCompletionItem {
        // Start with the base completion item
        const baseItem = this.createInputCompletionItem(input, taskSymbol, isRequired, options);
        
        // Enhance with complex context information
        if (context.isInScatterBlock) {
            // Add scatter context information
            baseItem.detail += ' • In scatter block';
            if (context.scatterVariable) {
                baseItem.detail += ` (${context.scatterVariable})`;
            }
            
            // Modify insert text for scatter context
            if (options.includeSnippets && input.type.name.toLowerCase() === 'array') {
                // In scatter blocks, array inputs might be accessed differently
                baseItem.insertText = this.generateScatterContextInsertText(input, context);
            }
        }
        
        if (context.isInConditionalBlock) {
            // Add conditional context information
            baseItem.detail += ` • In ${context.conditionalContext || 'conditional'} block`;
            
            // Modify insert text for conditional context
            if (options.includeSnippets && input.optional) {
                // Optional inputs in conditionals might use default values
                baseItem.insertText = this.generateConditionalContextInsertText(input, context);
            }
        }
        
        if (context.isInNestedExpression) {
            // Add nesting level information
            baseItem.detail += ` • Nested (level ${context.nestingLevel || 1})`;
            
            // Simplify insert text for nested expressions
            if (options.includeSnippets) {
                baseItem.insertText = this.generateNestedExpressionInsertText(input, context);
            }
        }
        
        return baseItem;
    }

    /**
     * Generate insert text optimized for scatter block context
     */
    private generateScatterContextInsertText(input: ParameterInfo, context: TaskInputContext): string {
        const baseType = input.type.name.toLowerCase();
        
        if (baseType === 'array' && context.scatterVariable) {
            // In scatter blocks, array inputs might reference the scatter variable
            return `${input.name} = ${context.scatterVariable}$0`;
        }
        
        if (baseType === 'file' && context.scatterVariable) {
            // File inputs in scatter might reference scattered files
            return `${input.name} = ${context.scatterVariable}$0`;
        }
        
        // Default to regular insert text
        return `${input.name} = \${1:value}$0`;
    }

    /**
     * Generate insert text optimized for conditional context
     */
    private generateConditionalContextInsertText(input: ParameterInfo, context: TaskInputContext): string {
        const baseType = input.type.name.toLowerCase();
        
        // In conditional contexts, suggest using select_first for optional values
        if (input.optional) {
            switch (baseType) {
                case 'string':
                    return `${input.name} = select_first([\${1:conditional_value}, "\${2:default_value}"])$0`;
                case 'file':
                    return `${input.name} = select_first([\${1:conditional_file}, \${2:default_file}])$0`;
                case 'int':
                    return `${input.name} = select_first([\${1:conditional_value}, \${2:0}])$0`;
                case 'boolean':
                    return `${input.name} = if \${1:condition} then \${2:true} else \${3:false}$0`;
                default:
                    return `${input.name} = select_first([\${1:conditional_value}, \${2:default}])$0`;
            }
        }
        
        // For required parameters, use regular insert text
        return `${input.name} = \${1:value}$0`;
    }

    /**
     * Generate insert text optimized for nested expressions
     */
    private generateNestedExpressionInsertText(input: ParameterInfo, context: TaskInputContext): string {
        // In nested expressions, prefer simpler placeholders
        const baseType = input.type.name.toLowerCase();
        
        switch (baseType) {
            case 'string':
                return `${input.name} = "\${1:value}"$0`;
            case 'int':
                return `${input.name} = \${1:1}$0`;
            case 'float':
                return `${input.name} = \${1:1.0}$0`;
            case 'boolean':
                return `${input.name} = \${1|true,false|}$0`;
            case 'file':
                return `${input.name} = \${1:file}$0`;
            default:
                return `${input.name} = \${1:value}$0`;
        }
    }

    /**
     * Apply intelligent sorting with complex context consideration
     */
    private applySortingStrategyWithComplexContext(
        completions: InputParameterCompletionItem[],
        context: TaskInputContext,
        options: TaskInputCompletionOptions
    ): InputParameterCompletionItem[] {
        return completions.sort((a, b) => {
            // First, apply context-specific priority adjustments
            let aPriority = a.sortPriority;
            let bPriority = b.sortPriority;
            
            // In scatter blocks, prioritize array and file inputs
            if (context.isInScatterBlock) {
                if (a.wdlInfo.parameterType.toLowerCase().includes('array')) {
                    aPriority -= 0.2;
                }
                if (b.wdlInfo.parameterType.toLowerCase().includes('array')) {
                    bPriority -= 0.2;
                }
                if (a.wdlInfo.parameterType.toLowerCase().includes('file')) {
                    aPriority -= 0.1;
                }
                if (b.wdlInfo.parameterType.toLowerCase().includes('file')) {
                    bPriority -= 0.1;
                }
            }
            
            // In conditional blocks, prioritize optional parameters
            if (context.isInConditionalBlock) {
                if (!a.wdlInfo.isRequired) {
                    aPriority -= 0.1;
                }
                if (!b.wdlInfo.isRequired) {
                    bPriority -= 0.1;
                }
            }
            
            // In nested expressions, prioritize primitive types
            if (context.isInNestedExpression) {
                const primitiveTypes = ['string', 'int', 'float', 'boolean'];
                if (primitiveTypes.includes(a.wdlInfo.parameterType.toLowerCase())) {
                    aPriority -= 0.15;
                }
                if (primitiveTypes.includes(b.wdlInfo.parameterType.toLowerCase())) {
                    bPriority -= 0.15;
                }
            }
            
            // Apply the adjusted priorities
            if (aPriority !== bPriority) {
                return aPriority - bPriority;
            }
            
            // Fall back to alphabetical sorting
            return a.label.localeCompare(b.label);
        });
    }

    /**
     * Type guard to check if task symbol is enhanced
     */
    private isEnhancedTaskSymbol(taskSymbol: TaskSymbol | EnhancedTaskSymbol): taskSymbol is EnhancedTaskSymbol {
        return 'source' in taskSymbol;
    }
}