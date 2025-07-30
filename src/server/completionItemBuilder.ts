import {
    CompletionItem,
    CompletionItemKind,
    InsertTextFormat,
    MarkupContent,
    MarkupKind
} from 'vscode-languageserver/node';
import { TaskSymbol, EnhancedTaskSymbol, TaskSource } from './symbolProvider';
import { TaskAnalyzer, ParameterInfo, TypeInfo } from './taskAnalyzer';

export interface CompletionItemOptions {
    showSourceInfo?: boolean;
    includeSnippets?: boolean;
    prioritizeRequired?: boolean;
    showTypeDetails?: boolean;
    includeExamples?: boolean;
}

export class CompletionItemBuilder {
    private taskAnalyzer: TaskAnalyzer;
    private defaultOptions: CompletionItemOptions;
    
    constructor(options: CompletionItemOptions = {}) {
        this.taskAnalyzer = new TaskAnalyzer();
        this.defaultOptions = {
            showSourceInfo: true,
            includeSnippets: true,
            prioritizeRequired: true,
            showTypeDetails: true,
            includeExamples: false,
            ...options
        };
    }
    
    /**
     * Build task input parameter completion items
     */
    buildTaskInputCompletions(task: TaskSymbol, options?: CompletionItemOptions): CompletionItem[] {
        const opts = { ...this.defaultOptions, ...options };
        const completions: CompletionItem[] = [];
        
        for (const input of task.inputs) {
            const completion = this.buildInputParameterItem(input, task, opts);
            completions.push(completion);
        }
        
        // Sort by priority: required first, then alphabetical
        return this.sortCompletionItems(completions, opts);
    }
    
    /**
     * Build task output parameter completion items
     */
    buildTaskOutputCompletions(task: TaskSymbol, options?: CompletionItemOptions): CompletionItem[] {
        const opts = { ...this.defaultOptions, ...options };
        const completions: CompletionItem[] = [];
        
        for (const output of task.outputs) {
            const completion = this.buildOutputParameterItem(output, task, opts);
            completions.push(completion);
        }
        
        return this.sortCompletionItems(completions, opts);
    }
    
    /**
     * Build task call completion items
     */
    buildTaskCallCompletions(tasks: TaskSymbol[], options?: CompletionItemOptions): CompletionItem[] {
        const opts = { ...this.defaultOptions, ...options };
        const completions: CompletionItem[] = [];
        
        for (const task of tasks) {
            const completion = this.buildTaskCallItem(task, opts);
            completions.push(completion);
        }
        
        return this.sortCompletionItems(completions, opts);
    }
    
    /**
     * Build enhanced task call completion items with full metadata
     */
    buildEnhancedTaskCallCompletions(tasks: EnhancedTaskSymbol[], options?: CompletionItemOptions): CompletionItem[] {
        const opts = { ...this.defaultOptions, ...options };
        const completions: CompletionItem[] = [];
        
        for (const task of tasks) {
            const completion = this.buildEnhancedTaskCallItem(task, opts);
            completions.push(completion);
        }
        
        return this.sortCompletionItems(completions, opts);
    }
    
    /**
     * Build task output reference completion items
     */
    buildTaskOutputReferenceCompletions(tasks: TaskSymbol[], options?: CompletionItemOptions): CompletionItem[] {
        const opts = { ...this.defaultOptions, ...options };
        const completions: CompletionItem[] = [];
        
        for (const task of tasks) {
            for (const output of task.outputs) {
                const completion = this.buildOutputReferenceItem(task, output, opts);
                completions.push(completion);
            }
        }
        
        return this.sortCompletionItems(completions, opts);
    }
    
    /**
     * Build WDL builtin function completion items
     */
    buildBuiltinFunctionCompletions(options?: CompletionItemOptions): CompletionItem[] {
        const opts = { ...this.defaultOptions, ...options };
        const completions: CompletionItem[] = [];
        
        const functions = this.getBuiltinFunctions();
        
        for (const func of functions) {
            const completion = this.buildBuiltinFunctionItem(func, opts);
            completions.push(completion);
        }
        
        return completions;
    }
    
    /**
     * Build WDL keyword completion items
     */
    buildKeywordCompletions(options?: CompletionItemOptions): CompletionItem[] {
        const opts = { ...this.defaultOptions, ...options };
        const completions: CompletionItem[] = [];
        
        const keywords = [
            'version', 'import', 'as', 'task', 'workflow', 'struct',
            'input', 'output', 'command', 'runtime', 'meta', 'parameter_meta',
            'call', 'if', 'else', 'scatter', 'in'
        ];
        
        for (const keyword of keywords) {
            const completion = this.buildKeywordItem(keyword, opts);
            completions.push(completion);
        }
        
        return completions;
    }
    
    /**
     * Build WDL type completion items
     */
    buildTypeCompletions(options?: CompletionItemOptions): CompletionItem[] {
        const opts = { ...this.defaultOptions, ...options };
        const completions: CompletionItem[] = [];
        
        const types = ['String', 'Int', 'Float', 'Boolean', 'File', 'Array', 'Map', 'Pair', 'Object'];
        
        for (const type of types) {
            const completion = this.buildTypeItem(type, opts);
            completions.push(completion);
        }
        
        return completions;
    }
    
    /**
     * Build a rich completion item with all metadata
     */
    buildRichCompletionItem(
        label: string,
        kind: CompletionItemKind,
        detail: string,
        documentation: MarkupContent,
        insertText: string,
        sortText: string,
        options?: {
            insertTextFormat?: InsertTextFormat;
            filterText?: string;
            additionalTextEdits?: any[];
            command?: any;
        }
    ): CompletionItem {
        return {
            label,
            kind,
            detail,
            documentation,
            insertText,
            insertTextFormat: options?.insertTextFormat || InsertTextFormat.PlainText,
            sortText,
            filterText: options?.filterText,
            additionalTextEdits: options?.additionalTextEdits,
            command: options?.command
        };
    }
    
    // Private helper methods
    
    /**
     * Build input parameter completion item
     */
    private buildInputParameterItem(input: ParameterInfo, task: TaskSymbol, options: CompletionItemOptions): CompletionItem {
        const typeStr = this.taskAnalyzer.formatType(input.type);
        const isRequired = !input.optional;
        const requiredText = isRequired ? ' (required)' : ' (optional)';
        
        let detail = `${typeStr} ${input.name}${requiredText}`;
        if (options.showSourceInfo && task.qualifiedName) {
            detail += ` - from ${task.qualifiedName}`;
        }
        
        let insertText = `${input.name} = `;
        if (options.includeSnippets) {
            insertText = this.generateInputSnippet(input);
        }
        
        const documentation = this.createParameterDocumentation(input, options);
        const sortText = this.generateSortText(input.name, isRequired ? 1 : 2, options);
        
        return this.buildRichCompletionItem(
            input.name,
            CompletionItemKind.Property,
            detail,
            documentation,
            insertText,
            sortText,
            {
                insertTextFormat: options.includeSnippets ? InsertTextFormat.Snippet : InsertTextFormat.PlainText
            }
        );
    }
    
    /**
     * Build output parameter completion item
     */
    private buildOutputParameterItem(output: ParameterInfo, task: TaskSymbol, options: CompletionItemOptions): CompletionItem {
        const typeStr = this.taskAnalyzer.formatType(output.type);
        
        let detail = `${typeStr} ${output.name}`;
        if (options.showSourceInfo && task.qualifiedName) {
            detail += ` - from ${task.qualifiedName}`;
        }
        
        const documentation = this.createParameterDocumentation(output, options);
        const sortText = this.generateSortText(output.name, 1, options);
        
        return this.buildRichCompletionItem(
            output.name,
            CompletionItemKind.Property,
            detail,
            documentation,
            output.name,
            sortText
        );
    }
    
    /**
     * Build task call completion item
     */
    private buildTaskCallItem(task: TaskSymbol, options: CompletionItemOptions): CompletionItem {
        const displayName = task.qualifiedName || task.name;
        let detail = `Task: ${displayName}`;
        
        if (options.showSourceInfo) {
            if (task.qualifiedName && task.qualifiedName.includes('.')) {
                detail += ' (imported)';
            } else {
                detail += ' (local)';
            }
        }
        
        let insertText = displayName;
        if (options.includeSnippets && task.inputs.length > 0) {
            insertText = this.generateTaskCallSnippet(task);
        }
        
        const documentation = this.createTaskDocumentation(task, options);
        const sortText = this.generateSortText(displayName, 1, options);
        
        return this.buildRichCompletionItem(
            displayName,
            CompletionItemKind.Function,
            detail,
            documentation,
            insertText,
            sortText,
            {
                insertTextFormat: options.includeSnippets ? InsertTextFormat.Snippet : InsertTextFormat.PlainText
            }
        );
    }
    
    /**
     * Build enhanced task call completion item
     */
    private buildEnhancedTaskCallItem(task: EnhancedTaskSymbol, options: CompletionItemOptions): CompletionItem {
        const displayName = task.fullyQualifiedName;
        let detail = `Task: ${displayName}`;
        
        if (options.showSourceInfo) {
            detail += ` (${task.source.type})`;
            if (task.source.importAlias) {
                detail += ` - alias: ${task.source.importAlias}`;
            }
        }
        
        let insertText = displayName;
        if (options.includeSnippets && task.inputs.length > 0) {
            insertText = this.generateTaskCallSnippet(task);
        }
        
        const documentation = this.createEnhancedTaskDocumentation(task, options);
        const sortText = this.generateSortText(displayName, task.source.type === 'local' ? 1 : 2, options);
        
        return this.buildRichCompletionItem(
            displayName,
            CompletionItemKind.Function,
            detail,
            documentation,
            insertText,
            sortText,
            {
                insertTextFormat: options.includeSnippets ? InsertTextFormat.Snippet : InsertTextFormat.PlainText
            }
        );
    }
    
    /**
     * Build output reference completion item
     */
    private buildOutputReferenceItem(task: TaskSymbol, output: ParameterInfo, options: CompletionItemOptions): CompletionItem {
        const taskName = task.qualifiedName || task.name;
        const label = `${taskName}.${output.name}`;
        const typeStr = this.taskAnalyzer.formatType(output.type);
        
        let detail = `${typeStr} - Output from ${taskName}`;
        
        const documentation = this.createOutputReferenceDocumentation(task, output, options);
        const sortText = this.generateSortText(label, 1, options);
        
        return this.buildRichCompletionItem(
            label,
            CompletionItemKind.Reference,
            detail,
            documentation,
            label,
            sortText
        );
    }
    
    /**
     * Build builtin function completion item
     */
    private buildBuiltinFunctionItem(func: BuiltinFunction, options: CompletionItemOptions): CompletionItem {
        let insertText = func.name;
        if (options.includeSnippets) {
            insertText = this.generateFunctionSnippet(func);
        } else {
            insertText = `${func.name}()`;
        }
        
        const documentation = this.createFunctionDocumentation(func, options);
        const sortText = this.generateSortText(func.name, 2, options);
        
        return this.buildRichCompletionItem(
            func.name,
            CompletionItemKind.Function,
            `WDL builtin function - ${func.description}`,
            documentation,
            insertText,
            sortText,
            {
                insertTextFormat: options.includeSnippets ? InsertTextFormat.Snippet : InsertTextFormat.PlainText
            }
        );
    }
    
    /**
     * Build keyword completion item
     */
    private buildKeywordItem(keyword: string, options: CompletionItemOptions): CompletionItem {
        const documentation = this.createKeywordDocumentation(keyword, options);
        const sortText = this.generateSortText(keyword, 3, options);
        
        return this.buildRichCompletionItem(
            keyword,
            CompletionItemKind.Keyword,
            'WDL keyword',
            documentation,
            keyword,
            sortText
        );
    }
    
    /**
     * Build type completion item
     */
    private buildTypeItem(type: string, options: CompletionItemOptions): CompletionItem {
        const documentation = this.createTypeDocumentation(type, options);
        const sortText = this.generateSortText(type, 4, options);
        
        return this.buildRichCompletionItem(
            type,
            CompletionItemKind.TypeParameter,
            'WDL type',
            documentation,
            type,
            sortText
        );
    }
    
    /**
     * Generate input parameter snippet
     */
    private generateInputSnippet(input: ParameterInfo): string {
        const placeholder = this.generateTypePlaceholder(input.type, 1);
        return `${input.name} = ${placeholder}`;
    }
    
    /**
     * Generate task call snippet
     */
    private generateTaskCallSnippet(task: TaskSymbol): string {
        const taskName = task.qualifiedName || task.name;
        const requiredInputs = task.inputs.filter(input => !input.optional);
        
        if (requiredInputs.length === 0) {
            return taskName;
        }
        
        let snippet = `${taskName} {\n\tinput:\n`;
        requiredInputs.forEach((input, index) => {
            const placeholder = this.generateTypePlaceholder(input.type, index + 1);
            snippet += `\t\t${input.name} = ${placeholder}`;
            if (index < requiredInputs.length - 1) {
                snippet += ',';
            }
            snippet += '\n';
        });
        snippet += '}';
        
        return snippet;
    }
    
    /**
     * Generate function call snippet
     */
    private generateFunctionSnippet(func: BuiltinFunction): string {
        if (func.parameters.length === 0) {
            return `${func.name}()`;
        }
        
        let snippet = `${func.name}(`;
        func.parameters.forEach((param, index) => {
            snippet += `\${${index + 1}:${param.name}}`;
            if (index < func.parameters.length - 1) {
                snippet += ', ';
            }
        });
        snippet += ')';
        
        return snippet;
    }
    
    /**
     * Generate type-appropriate placeholder
     */
    private generateTypePlaceholder(type: TypeInfo, tabstop: number): string {
        const baseType = type.name.toLowerCase();
        
        switch (baseType) {
            case 'string':
                return `\${${tabstop}:"value"}`;
            case 'int':
                return `\${${tabstop}:0}`;
            case 'float':
                return `\${${tabstop}:0.0}`;
            case 'boolean':
                return `\${${tabstop}:true}`;
            case 'file':
                return `\${${tabstop}:file_path}`;
            case 'array':
                return `\${${tabstop}:[]}`;
            case 'map':
                return `\${${tabstop}:{}}`;
            default:
                return `\${${tabstop}:value}`;
        }
    }
    
    /**
     * Generate sort text for completion items
     */
    private generateSortText(label: string, priority: number, options: CompletionItemOptions): string {
        return `${priority}_${label}`;
    }
    
    /**
     * Sort completion items based on options
     */
    private sortCompletionItems(items: CompletionItem[], options: CompletionItemOptions): CompletionItem[] {
        return items.sort((a, b) => {
            // First sort by sortText
            if (a.sortText && b.sortText) {
                return a.sortText.localeCompare(b.sortText);
            }
            
            // Then by label
            return a.label.localeCompare(b.label);
        });
    }
    
    /**
     * Create parameter documentation
     */
    private createParameterDocumentation(parameter: ParameterInfo, options: CompletionItemOptions): MarkupContent {
        const content: string[] = [];
        
        if (parameter.description) {
            content.push(parameter.description, '');
        }
        
        if (options.showTypeDetails) {
            const typeStr = this.taskAnalyzer.formatType(parameter.type);
            content.push(`**Type:** \`${typeStr}\``);
            
            if (parameter.defaultValue !== undefined) {
                content.push(`**Default:** \`${parameter.defaultValue}\``);
            }
            
            if (parameter.optional) {
                content.push('**Optional parameter**');
            } else {
                content.push('**Required parameter**');
            }
        }
        
        if (options.includeExamples) {
            const example = this.generateParameterExample(parameter);
            if (example) {
                content.push('', `**Example:** \`${example}\``);
            }
        }
        
        return {
            kind: MarkupKind.Markdown,
            value: content.join('\n')
        };
    }
    
    /**
     * Create task documentation
     */
    private createTaskDocumentation(task: TaskSymbol, options: CompletionItemOptions): MarkupContent {
        const content: string[] = [];
        
        if (task.description) {
            content.push(task.description, '');
        }
        
        if (options.showTypeDetails) {
            // Input summary
            if (task.inputs.length > 0) {
                content.push('**Inputs:**');
                for (const input of task.inputs) {
                    const typeStr = this.taskAnalyzer.formatType(input.type);
                    const optional = input.optional ? ' *(optional)*' : ' *(required)*';
                    content.push(`- \`${typeStr} ${input.name}\`${optional}`);
                }
                content.push('');
            }
            
            // Output summary
            if (task.outputs.length > 0) {
                content.push('**Outputs:**');
                for (const output of task.outputs) {
                    const typeStr = this.taskAnalyzer.formatType(output.type);
                    content.push(`- \`${typeStr} ${output.name}\``);
                }
            }
        }
        
        return {
            kind: MarkupKind.Markdown,
            value: content.join('\n')
        };
    }
    
    /**
     * Create enhanced task documentation
     */
    private createEnhancedTaskDocumentation(task: EnhancedTaskSymbol, options: CompletionItemOptions): MarkupContent {
        const content: string[] = [];
        
        if (task.description) {
            content.push(task.description, '');
        }
        
        if (options.showSourceInfo) {
            content.push(`**Source:** ${task.source.type}`);
            if (task.source.importPath) {
                content.push(`**Import Path:** ${task.source.importPath}`);
            }
            if (task.source.importAlias) {
                content.push(`**Alias:** ${task.source.importAlias}`);
            }
            content.push('');
        }
        
        if (options.showTypeDetails) {
            // Input summary
            if (task.inputs.length > 0) {
                content.push('**Inputs:**');
                for (const input of task.inputs) {
                    const typeStr = this.taskAnalyzer.formatType(input.type);
                    const optional = input.optional ? ' *(optional)*' : ' *(required)*';
                    content.push(`- \`${typeStr} ${input.name}\`${optional}`);
                }
                content.push('');
            }
            
            // Output summary
            if (task.outputs.length > 0) {
                content.push('**Outputs:**');
                for (const output of task.outputs) {
                    const typeStr = this.taskAnalyzer.formatType(output.type);
                    content.push(`- \`${typeStr} ${output.name}\``);
                }
            }
        }
        
        return {
            kind: MarkupKind.Markdown,
            value: content.join('\n')
        };
    }
    
    /**
     * Create output reference documentation
     */
    private createOutputReferenceDocumentation(task: TaskSymbol, output: ParameterInfo, options: CompletionItemOptions): MarkupContent {
        const content: string[] = [];
        
        const taskName = task.qualifiedName || task.name;
        content.push(`Output **${output.name}** from task **${taskName}**`);
        
        if (output.description) {
            content.push('', output.description);
        }
        
        if (options.showTypeDetails) {
            const typeStr = this.taskAnalyzer.formatType(output.type);
            content.push('', `**Type:** \`${typeStr}\``);
        }
        
        return {
            kind: MarkupKind.Markdown,
            value: content.join('\n')
        };
    }
    
    /**
     * Create function documentation
     */
    private createFunctionDocumentation(func: BuiltinFunction, options: CompletionItemOptions): MarkupContent {
        const content: string[] = [];
        
        content.push(func.description);
        
        if (options.showTypeDetails && func.parameters.length > 0) {
            content.push('', '**Parameters:**');
            for (const param of func.parameters) {
                content.push(`- \`${param.type} ${param.name}\`${param.optional ? ' *(optional)*' : ''}`);
            }
        }
        
        if (func.returnType) {
            content.push('', `**Returns:** \`${func.returnType}\``);
        }
        
        if (options.includeExamples && func.example) {
            content.push('', `**Example:** \`${func.example}\``);
        }
        
        return {
            kind: MarkupKind.Markdown,
            value: content.join('\n')
        };
    }
    
    /**
     * Create keyword documentation
     */
    private createKeywordDocumentation(keyword: string, options: CompletionItemOptions): MarkupContent {
        const descriptions: { [key: string]: string } = {
            'version': 'Specifies the WDL version',
            'import': 'Imports tasks and workflows from other WDL files',
            'as': 'Creates an alias for imported items',
            'task': 'Defines a computational task',
            'workflow': 'Defines a workflow that orchestrates tasks',
            'struct': 'Defines a custom data structure',
            'input': 'Declares input parameters',
            'output': 'Declares output values',
            'command': 'Contains the command to execute',
            'runtime': 'Specifies runtime requirements',
            'meta': 'Contains metadata information',
            'parameter_meta': 'Contains parameter metadata',
            'call': 'Invokes a task or workflow',
            'if': 'Conditional execution',
            'else': 'Alternative branch for conditional',
            'scatter': 'Parallel execution over a collection',
            'in': 'Specifies the collection for scatter'
        };
        
        const description = descriptions[keyword] || 'WDL keyword';
        
        return {
            kind: MarkupKind.Markdown,
            value: description
        };
    }
    
    /**
     * Create type documentation
     */
    private createTypeDocumentation(type: string, options: CompletionItemOptions): MarkupContent {
        const descriptions: { [key: string]: string } = {
            'String': 'Text data type',
            'Int': 'Integer number type',
            'Float': 'Floating-point number type',
            'Boolean': 'True/false value type',
            'File': 'File path type',
            'Array': 'Collection of values of the same type',
            'Map': 'Key-value mapping type',
            'Pair': 'Two-element tuple type',
            'Object': 'Generic object type'
        };
        
        const description = descriptions[type] || 'WDL data type';
        
        return {
            kind: MarkupKind.Markdown,
            value: description
        };
    }
    
    /**
     * Generate parameter example
     */
    private generateParameterExample(parameter: ParameterInfo): string | undefined {
        const baseType = parameter.type.name.toLowerCase();
        
        switch (baseType) {
            case 'string':
                return '"example_value"';
            case 'int':
                return '42';
            case 'float':
                return '3.14';
            case 'boolean':
                return 'true';
            case 'file':
                return '"path/to/file.txt"';
            case 'array':
                return '["item1", "item2"]';
            case 'map':
                return '{"key": "value"}';
            default:
                return undefined;
        }
    }
    
    /**
     * Get builtin functions with metadata
     */
    private getBuiltinFunctions(): BuiltinFunction[] {
        return [
            {
                name: 'select_first',
                description: 'Returns the first non-null value from an array',
                parameters: [{ name: 'array', type: 'Array[X?]', optional: false }],
                returnType: 'X',
                example: 'select_first([null, "value", "other"])'
            },
            {
                name: 'select_all',
                description: 'Returns all non-null values from an array',
                parameters: [{ name: 'array', type: 'Array[X?]', optional: false }],
                returnType: 'Array[X]',
                example: 'select_all([null, "value", null, "other"])'
            },
            {
                name: 'defined',
                description: 'Checks if a value is defined (not null)',
                parameters: [{ name: 'value', type: 'X?', optional: false }],
                returnType: 'Boolean',
                example: 'defined(optional_value)'
            },
            {
                name: 'length',
                description: 'Returns the length of an array or string',
                parameters: [{ name: 'value', type: 'Array[X] | String', optional: false }],
                returnType: 'Int',
                example: 'length(["a", "b", "c"])'
            },
            {
                name: 'basename',
                description: 'Returns the filename from a path',
                parameters: [
                    { name: 'path', type: 'String | File', optional: false },
                    { name: 'suffix', type: 'String', optional: true }
                ],
                returnType: 'String',
                example: 'basename("/path/to/file.txt", ".txt")'
            },
            {
                name: 'size',
                description: 'Returns the size of a file in bytes',
                parameters: [
                    { name: 'file', type: 'File', optional: false },
                    { name: 'unit', type: 'String', optional: true }
                ],
                returnType: 'Float',
                example: 'size(input_file, "GB")'
            }
        ];
    }
}

interface BuiltinFunction {
    name: string;
    description: string;
    parameters: FunctionParameter[];
    returnType?: string;
    example?: string;
}

interface FunctionParameter {
    name: string;
    type: string;
    optional: boolean;
}