import {
    CompletionItem,
    CompletionItemKind,
    InsertTextFormat,
    MarkupContent,
    MarkupKind,
    CompletionItemTag
} from 'vscode-languageserver/node';
import { TaskSymbol, EnhancedTaskSymbol, TaskSource } from './symbolProvider';
import { TaskAnalyzer, ParameterInfo, TypeInfo } from './taskAnalyzer';

export interface CompletionItemOptions {
    showSourceInfo?: boolean;
    includeSnippets?: boolean;
    prioritizeRequired?: boolean;
    showTypeDetails?: boolean;
    includeExamples?: boolean;
    showIcons?: boolean;
    enableSmartSorting?: boolean;
    includeDeprecationInfo?: boolean;
    showParameterHints?: boolean;
    enableContextualInserts?: boolean;
}

export interface CompletionItemCategory {
    name: string;
    priority: number;
    icon?: string;
    description?: string;
}

export interface SmartInsertContext {
    currentLine: string;
    previousLine?: string;
    indentLevel: number;
    isInBlock: boolean;
    blockType?: 'task' | 'workflow' | 'command' | 'input' | 'output';
}

export class CompletionItemBuilder {
    private taskAnalyzer: TaskAnalyzer;
    private defaultOptions: CompletionItemOptions;
    private categories: Map<string, CompletionItemCategory> = new Map();
    
    constructor(options: CompletionItemOptions = {}) {
        this.taskAnalyzer = new TaskAnalyzer();
        this.defaultOptions = {
            showSourceInfo: true,
            includeSnippets: true,
            prioritizeRequired: true,
            showTypeDetails: true,
            includeExamples: false,
            showIcons: true,
            enableSmartSorting: true,
            includeDeprecationInfo: true,
            showParameterHints: true,
            enableContextualInserts: true,
            ...options
        };
        
        this.initializeCategories();
    }
    
    /**
     * Initialize completion item categories
     */
    private initializeCategories(): void {
        this.categories = new Map([
            ['required-input', { name: 'Required Inputs', priority: 1, icon: '🔴', description: 'Required task parameters' }],
            ['optional-input', { name: 'Optional Inputs', priority: 2, icon: '🟡', description: 'Optional task parameters' }],
            ['local-task', { name: 'Local Tasks', priority: 3, icon: '🏠', description: 'Tasks defined in current file' }],
            ['imported-task', { name: 'Imported Tasks', priority: 4, icon: '📦', description: 'Tasks from imported files' }],
            ['output', { name: 'Outputs', priority: 5, icon: '📤', description: 'Task output values' }],
            ['builtin-function', { name: 'Built-in Functions', priority: 6, icon: '⚙️', description: 'WDL built-in functions' }],
            ['keyword', { name: 'Keywords', priority: 7, icon: '🔤', description: 'WDL language keywords' }],
            ['type', { name: 'Types', priority: 8, icon: '🏷️', description: 'WDL data types' }]
        ]);
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
    
    /**
     * Build an enhanced completion item with advanced features
     */
    buildEnhancedCompletionItem(
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
            tags?: CompletionItemTag[];
            category?: string;
            priority?: number;
            deprecated?: boolean;
        }
    ): CompletionItem {
        const item: CompletionItem = {
            label,
            kind,
            detail,
            documentation,
            insertText,
            insertTextFormat: options?.insertTextFormat || InsertTextFormat.PlainText,
            sortText,
            filterText: options?.filterText,
            additionalTextEdits: options?.additionalTextEdits,
            command: options?.command,
            tags: options?.tags
        };
        
        // Add custom data for enhanced features
        if (options?.category || options?.priority !== undefined) {
            item.data = {
                category: options.category,
                priority: options.priority,
                deprecated: options.deprecated
            };
        }
        
        return item;
    }
    
    /**
     * Generate smart input snippet with context awareness
     */
    private generateSmartInputSnippet(input: ParameterInfo, options: CompletionItemOptions): string {
        const placeholder = this.generateEnhancedTypePlaceholder(input.type, 1, input);
        
        // Add parameter hints if enabled
        if (options.showParameterHints && input.description) {
            const hint = input.description.length > 50 
                ? input.description.substring(0, 47) + '...' 
                : input.description;
            return `${input.name} = ${placeholder} $0 // ${hint}`;
        }
        
        return `${input.name} = ${placeholder}$0`;
    }
    
    /**
     * Generate enhanced type placeholder with better defaults
     */
    private generateEnhancedTypePlaceholder(type: TypeInfo, tabstop: number, parameter?: ParameterInfo): string {
        const baseType = type.name.toLowerCase();
        
        // Use parameter-specific defaults if available
        if (parameter?.defaultValue !== undefined) {
            return `\${${tabstop}:${parameter.defaultValue}}`;
        }
        
        // Enhanced type-specific placeholders
        switch (baseType) {
            case 'string':
                if (parameter?.name.toLowerCase().includes('path') || 
                    parameter?.name.toLowerCase().includes('file')) {
                    return `\${${tabstop}:"path/to/file"}`;
                }
                if (parameter?.name.toLowerCase().includes('name')) {
                    return `\${${tabstop}:"sample_name"}`;
                }
                return `\${${tabstop}:"value"}`;
                
            case 'int':
                if (parameter?.name.toLowerCase().includes('thread') || 
                    parameter?.name.toLowerCase().includes('cpu')) {
                    return `\${${tabstop}:4}`;
                }
                if (parameter?.name.toLowerCase().includes('memory') || 
                    parameter?.name.toLowerCase().includes('mem')) {
                    return `\${${tabstop}:8}`;
                }
                return `\${${tabstop}:1}`;
                
            case 'float':
                if (parameter?.name.toLowerCase().includes('threshold')) {
                    return `\${${tabstop}:0.05}`;
                }
                return `\${${tabstop}:1.0}`;
                
            case 'boolean':
                return `\${${tabstop}|true,false|}`;
                
            case 'file':
                if (parameter?.name.toLowerCase().includes('input')) {
                    return `\${${tabstop}:input_file}`;
                }
                if (parameter?.name.toLowerCase().includes('reference') || 
                    parameter?.name.toLowerCase().includes('ref')) {
                    return `\${${tabstop}:reference.fa}`;
                }
                return `\${${tabstop}:file_path}`;
                
            case 'array':
                // For arrays, provide a simple placeholder
                return `\${${tabstop}:[]}`;
                return `\${${tabstop}:[]}`;
                
            case 'map':
                return `\${${tabstop}:{"key": "value"}}`;
                
            default:
                return `\${${tabstop}:value}`;
        }
    }
    
    /**
     * Generate smart sort text with category-based sorting
     */
    private generateSmartSortText(label: string, category: string, options: CompletionItemOptions): string {
        if (!options.enableSmartSorting) {
            return label;
        }
        
        const categoryInfo = this.categories.get(category);
        const priority = categoryInfo?.priority || 99;
        
        // Format: priority_category_label
        return `${priority.toString().padStart(2, '0')}_${category}_${label}`;
    }
    
    /**
     * Create enhanced parameter documentation with better formatting
     */
    private createEnhancedParameterDocumentation(
        parameter: ParameterInfo, 
        task: TaskSymbol, 
        options: CompletionItemOptions
    ): MarkupContent {
        const content: string[] = [];
        
        // Parameter description
        if (parameter.description) {
            content.push(`**${parameter.name}**`, '', parameter.description, '');
        } else {
            content.push(`**${parameter.name}**`, '');
        }
        
        // Type information with enhanced formatting
        if (options.showTypeDetails) {
            const typeStr = this.taskAnalyzer.formatType(parameter.type);
            content.push(`📋 **Type:** \`${typeStr}\``);
            
            // Requirement status with icons
            if (parameter.optional) {
                content.push(`🟡 **Optional parameter**`);
                if (parameter.defaultValue !== undefined) {
                    content.push(`⚙️ **Default:** \`${parameter.defaultValue}\``);
                }
            } else {
                content.push(`🔴 **Required parameter**`);
            }
            
            // Deprecation warning (if supported in future)
            // if (options.includeDeprecationInfo && parameter.deprecated) {
            //     content.push(`⚠️ **Deprecated:** ${parameter.deprecationMessage || 'This parameter is deprecated'}`);
            // }
        }
        
        // Source information
        if (options.showSourceInfo && task.qualifiedName) {
            content.push(`📦 **Source:** ${task.qualifiedName}`);
        }
        
        // Usage examples
        if (options.includeExamples) {
            const example = this.generateEnhancedParameterExample(parameter);
            if (example) {
                content.push('', `💡 **Example:**`, '```wdl', example, '```');
            }
        }
        
        // Validation rules if available (future feature)
        // if (parameter.validation) {
        //     content.push('', `✅ **Validation:** ${parameter.validation}`);
        // }
        
        return {
            kind: MarkupKind.Markdown,
            value: content.join('\n')
        };
    }
    
    /**
     * Generate enhanced parameter example with context
     */
    private generateEnhancedParameterExample(parameter: ParameterInfo): string | undefined {
        const baseType = parameter.type.name.toLowerCase();
        const paramName = parameter.name.toLowerCase();
        
        // Context-aware examples
        if (paramName.includes('input') && baseType === 'file') {
            return `${parameter.name} = input_file`;
        }
        
        if (paramName.includes('output') && baseType === 'string') {
            return `${parameter.name} = "output_prefix"`;
        }
        
        if (paramName.includes('thread') && baseType === 'int') {
            return `${parameter.name} = 4`;
        }
        
        if (paramName.includes('memory') && baseType === 'int') {
            return `${parameter.name} = 8`;
        }
        
        // Default examples by type
        switch (baseType) {
            case 'string':
                return `${parameter.name} = "example_value"`;
            case 'int':
                return `${parameter.name} = 42`;
            case 'float':
                return `${parameter.name} = 3.14`;
            case 'boolean':
                return `${parameter.name} = true`;
            case 'file':
                return `${parameter.name} = input_file`;
            case 'array':
                return `${parameter.name} = ["item1", "item2"]`;
            case 'map':
                return `${parameter.name} = {"key": "value"}`;
            default:
                return undefined;
        }
    }
    
    // Private helper methods
    
    /**
     * Build input parameter completion item with enhanced formatting
     */
    private buildInputParameterItem(input: ParameterInfo, task: TaskSymbol, options: CompletionItemOptions): CompletionItem {
        const typeStr = this.taskAnalyzer.formatType(input.type);
        const isRequired = !input.optional;
        const category = isRequired ? 'required-input' : 'optional-input';
        const categoryInfo = this.categories.get(category)!;
        
        // Enhanced label with icon
        let label = input.name;
        if (options.showIcons) {
            label = `${categoryInfo.icon} ${input.name}`;
        }
        
        // Enhanced detail with better formatting
        let detail = `${typeStr}`;
        if (isRequired) {
            detail += ' • Required';
        } else {
            detail += ' • Optional';
            if (input.defaultValue !== undefined) {
                detail += ` • Default: ${input.defaultValue}`;
            }
        }
        
        if (options.showSourceInfo && task.qualifiedName) {
            detail += ` • from ${task.qualifiedName}`;
        }
        
        // Smart insert text generation
        let insertText = `${input.name} = `;
        if (options.includeSnippets) {
            insertText = this.generateSmartInputSnippet(input, options);
        }
        
        const documentation = this.createEnhancedParameterDocumentation(input, task, options);
        const sortText = this.generateSmartSortText(input.name, category, options);
        
        // Add tags for deprecated parameters (future feature)
        const tags: CompletionItemTag[] = [];
        // if (options.includeDeprecationInfo && input.deprecated) {
        //     tags.push(CompletionItemTag.Deprecated);
        // }
        
        return this.buildEnhancedCompletionItem(
            label,
            CompletionItemKind.Property,
            detail,
            documentation,
            insertText,
            sortText,
            {
                insertTextFormat: options.includeSnippets ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
                tags,
                category: categoryInfo.name,
                priority: categoryInfo.priority
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
     * Build enhanced task call completion item
     */
    private buildTaskCallItem(task: TaskSymbol, options: CompletionItemOptions): CompletionItem {
        const displayName = task.qualifiedName || task.name;
        const isImported = task.qualifiedName && task.qualifiedName.includes('.');
        const category = isImported ? 'imported-task' : 'local-task';
        const categoryInfo = this.categories.get(category)!;
        
        // Enhanced label with icon and metadata
        let label = displayName;
        if (options.showIcons) {
            label = `${categoryInfo.icon} ${displayName}`;
        }
        
        // Enhanced detail with input/output summary
        const requiredInputs = task.inputs.filter(input => !input.optional);
        const inputSummary = requiredInputs.length > 0 
            ? `${requiredInputs.length} required input${requiredInputs.length > 1 ? 's' : ''}` 
            : 'No required inputs';
        const outputSummary = task.outputs.length > 0 
            ? `${task.outputs.length} output${task.outputs.length > 1 ? 's' : ''}` 
            : 'No outputs';
        
        let detail = `Task • ${inputSummary} • ${outputSummary}`;
        
        if (options.showSourceInfo) {
            detail += isImported ? ' • Imported' : ' • Local';
        }
        
        // Smart insert text with contextual formatting
        let insertText = displayName;
        if (options.enableContextualInserts) {
            insertText = this.generateContextualTaskCallSnippet(task, options);
        } else if (options.includeSnippets && task.inputs.length > 0) {
            insertText = this.generateTaskCallSnippet(task);
        }
        
        const documentation = this.createEnhancedTaskDocumentation(task, options);
        const sortText = this.generateSmartSortText(displayName, category, options);
        
        return this.buildEnhancedCompletionItem(
            label,
            CompletionItemKind.Function,
            detail,
            documentation,
            insertText,
            sortText,
            {
                insertTextFormat: options.includeSnippets || options.enableContextualInserts 
                    ? InsertTextFormat.Snippet 
                    : InsertTextFormat.PlainText,
                category: categoryInfo.name,
                priority: categoryInfo.priority
            }
        );
    }
    
    /**
     * Generate contextual task call snippet based on usage patterns
     */
    private generateContextualTaskCallSnippet(task: TaskSymbol, options: CompletionItemOptions): string {
        const taskName = task.qualifiedName || task.name;
        const requiredInputs = task.inputs.filter(input => !input.optional);
        const optionalInputs = task.inputs.filter(input => input.optional);
        
        if (requiredInputs.length === 0) {
            return `call ${taskName}$0`;
        }
        
        // Generate smart snippet with grouped parameters
        let snippet = `call ${taskName} {\n\tinput:\n`;
        
        // Required inputs first
        requiredInputs.forEach((input, index) => {
            const placeholder = this.generateEnhancedTypePlaceholder(input.type, index + 1, input);
            snippet += `\t\t${input.name} = ${placeholder}`;
            if (index < requiredInputs.length - 1 || optionalInputs.length > 0) {
                snippet += ',';
            }
            snippet += '\n';
        });
        
        // Optional inputs with choice snippet
        if (optionalInputs.length > 0 && optionalInputs.length <= 3) {
            snippet += `\t\t\${${requiredInputs.length + 1}:// Optional parameters:\n`;
            optionalInputs.forEach((input, index) => {
                const placeholder = this.generateEnhancedTypePlaceholder(
                    input.type, 
                    requiredInputs.length + 2 + index, 
                    input
                );
                snippet += `\t\t// ${input.name} = ${placeholder}`;
                if (index < optionalInputs.length - 1) {
                    snippet += ',';
                }
                snippet += '\n';
            });
            snippet += `\t\t}`;
        }
        
        snippet += `}$0`;
        
        return snippet;
    }
    
    /**
     * Create enhanced task documentation with better structure
     */
    private createEnhancedTaskDocumentation(task: TaskSymbol, options: CompletionItemOptions): MarkupContent {
        const content: string[] = [];
        
        // Task header with icon
        const taskName = task.qualifiedName || task.name;
        content.push(`# 🔧 ${taskName}`, '');
        
        // Task description
        if (task.description) {
            content.push(task.description, '');
        }
        
        // Source information with enhanced formatting
        if (options.showSourceInfo) {
            const isImported = task.qualifiedName && task.qualifiedName.includes('.');
            if (isImported) {
                content.push(`📦 **Source:** Imported task`);
                // Import path information would be available in enhanced version
                // if (task.importPath) {
                //     content.push(`📁 **Import Path:** \`${task.importPath}\``);
                // }
            } else {
                content.push(`🏠 **Source:** Local task`);
            }
            content.push('');
        }
        
        // Enhanced input/output documentation
        if (options.showTypeDetails) {
            // Required inputs
            const requiredInputs = task.inputs.filter(input => !input.optional);
            if (requiredInputs.length > 0) {
                content.push(`## 🔴 Required Inputs`);
                for (const input of requiredInputs) {
                    const typeStr = this.taskAnalyzer.formatType(input.type);
                    content.push(`- **\`${input.name}\`** (\`${typeStr}\`)`);
                    if (input.description) {
                        content.push(`  ${input.description}`);
                    }
                }
                content.push('');
            }
            
            // Optional inputs
            const optionalInputs = task.inputs.filter(input => input.optional);
            if (optionalInputs.length > 0) {
                content.push(`## 🟡 Optional Inputs`);
                for (const input of optionalInputs) {
                    const typeStr = this.taskAnalyzer.formatType(input.type);
                    let line = `- **\`${input.name}\`** (\`${typeStr}\`)`;
                    if (input.defaultValue !== undefined) {
                        line += ` = \`${input.defaultValue}\``;
                    }
                    content.push(line);
                    if (input.description) {
                        content.push(`  ${input.description}`);
                    }
                }
                content.push('');
            }
            
            // Outputs
            if (task.outputs.length > 0) {
                content.push(`## 📤 Outputs`);
                for (const output of task.outputs) {
                    const typeStr = this.taskAnalyzer.formatType(output.type);
                    content.push(`- **\`${output.name}\`** (\`${typeStr}\`)`);
                    if (output.description) {
                        content.push(`  ${output.description}`);
                    }
                }
                content.push('');
            }
        }
        
        // Usage example
        if (options.includeExamples) {
            content.push(`## 💡 Usage Example`);
            content.push('```wdl');
            content.push(this.generateTaskUsageExample(task));
            content.push('```');
        }
        
        return {
            kind: MarkupKind.Markdown,
            value: content.join('\n')
        };
    }
    
    /**
     * Generate task usage example
     */
    private generateTaskUsageExample(task: TaskSymbol): string {
        const taskName = task.qualifiedName || task.name;
        const requiredInputs = task.inputs.filter(input => !input.optional);
        
        if (requiredInputs.length === 0) {
            return `call ${taskName}`;
        }
        
        let example = `call ${taskName} {\n  input:\n`;
        
        for (const input of requiredInputs) {
            const exampleValue = this.generateEnhancedParameterExample(input);
            if (exampleValue) {
                example += `    ${exampleValue}\n`;
            }
        }
        
        example += `}`;
        
        return example;
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
        
        const documentation = this.createEnhancedTaskDocumentationForEnhanced(task, options);
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
     * Create enhanced task documentation for EnhancedTaskSymbol
     */
    private createEnhancedTaskDocumentationForEnhanced(task: EnhancedTaskSymbol, options: CompletionItemOptions): MarkupContent {
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