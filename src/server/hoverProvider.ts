import { Hover, MarkupContent, MarkupKind, Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SymbolProvider, TaskSymbol } from './symbolProvider';
import { ContextAnalyzer } from './contextAnalyzer';
import { TaskAnalyzer, ParameterInfo } from './taskAnalyzer';

export interface HoverContext {
    word: string;
    line: number;
    character: number;
    document: TextDocument;
    range: Range;
}

export class HoverProvider {
    private symbolProvider: SymbolProvider;
    private contextAnalyzer: ContextAnalyzer;
    private taskAnalyzer: TaskAnalyzer;
    
    constructor(symbolProvider: SymbolProvider) {
        this.symbolProvider = symbolProvider;
        this.contextAnalyzer = new ContextAnalyzer();
        this.taskAnalyzer = new TaskAnalyzer();
    }
    
    /**
     * Provide hover information for a position in a document
     */
    async provideHover(document: TextDocument, line: number, character: number): Promise<Hover | null> {
        try {
            const position = { line, character };
            const hoverContext = this.extractHoverContext(document, position);
            
            if (!hoverContext) {
                return null;
            }
            
            // Determine what kind of symbol we're hovering over
            const hoverInfo = await this.analyzeHoverTarget(hoverContext);
            
            if (!hoverInfo) {
                return null;
            }
            
            return {
                contents: hoverInfo.content,
                range: hoverContext.range
            };
            
        } catch (error) {
            console.error('Error in provideHover:', error);
            return null;
        }
    }
    
    /**
     * Extract hover context from document position
     */
    private extractHoverContext(document: TextDocument, position: { line: number; character: number }): HoverContext | null {
        const line = document.getText({
            start: { line: position.line, character: 0 },
            end: { line: position.line + 1, character: 0 }
        });
        
        // Find word boundaries
        const wordMatch = this.findWordAtPosition(line, position.character);
        if (!wordMatch) {
            return null;
        }
        
        return {
            word: wordMatch.word,
            line: position.line,
            character: position.character,
            document,
            range: {
                start: { line: position.line, character: wordMatch.start },
                end: { line: position.line, character: wordMatch.end }
            }
        };
    }
    
    /**
     * Find word at specific character position
     */
    private findWordAtPosition(line: string, character: number): { word: string; start: number; end: number } | null {
        // WDL identifier pattern: letters, numbers, underscores, dots (for qualified names)
        const wordPattern = /[a-zA-Z_][a-zA-Z0-9_.]*|[a-zA-Z0-9_]+/g;
        let match;
        
        while ((match = wordPattern.exec(line)) !== null) {
            const start = match.index;
            const end = start + match[0].length;
            
            if (character >= start && character <= end) {
                return {
                    word: match[0],
                    start,
                    end
                };
            }
        }
        
        return null;
    }
    
    /**
     * Analyze what the user is hovering over and provide appropriate information
     */
    private async analyzeHoverTarget(context: HoverContext): Promise<{ content: MarkupContent } | null> {
        const { word, document } = context;
        
        // Check if it's a task name
        const taskHover = await this.getTaskHover(word, document.uri);
        if (taskHover) {
            return taskHover;
        }
        
        // Check if it's a task input/output reference
        const parameterHover = await this.getParameterHover(word, document.uri);
        if (parameterHover) {
            return parameterHover;
        }
        
        // Check if it's a WDL keyword
        const keywordHover = this.getKeywordHover(word);
        if (keywordHover) {
            return keywordHover;
        }
        
        // Check if it's a WDL type
        const typeHover = this.getTypeHover(word);
        if (typeHover) {
            return typeHover;
        }
        
        // Check if it's a builtin function
        const functionHover = this.getBuiltinFunctionHover(word);
        if (functionHover) {
            return functionHover;
        }
        
        return null;
    }
    
    /**
     * Get hover information for tasks
     */
    private async getTaskHover(word: string, uri: string): Promise<{ content: MarkupContent } | null> {
        // Try to find the task
        let task = this.symbolProvider.resolveTaskByAlias(word, uri);
        
        if (!task) {
            // Try without alias resolution
            task = this.symbolProvider.getTaskSymbol(word, uri);
        }
        
        if (!task) {
            return null;
        }
        
        const content = this.createTaskHoverContent(task);
        return { content };
    }
    
    /**
     * Get hover information for parameters (inputs/outputs)
     */
    private async getParameterHover(word: string, uri: string): Promise<{ content: MarkupContent } | null> {
        // Check if it's a task.parameter reference
        if (word.includes('.')) {
            const parts = word.split('.');
            if (parts.length === 2) {
                const [taskName, paramName] = parts;
                
                const task = this.symbolProvider.resolveTaskByAlias(taskName, uri);
                if (task) {
                    // Look for output parameter
                    const output = task.outputs.find(o => o.name === paramName);
                    if (output) {
                        const content = this.createParameterHoverContent(output, task, 'output');
                        return { content };
                    }
                    
                    // Look for input parameter
                    const input = task.inputs.find(i => i.name === paramName);
                    if (input) {
                        const content = this.createParameterHoverContent(input, task, 'input');
                        return { content };
                    }
                }
            }
        }
        
        return null;
    }
    
    /**
     * Get hover information for WDL keywords
     */
    private getKeywordHover(word: string): { content: MarkupContent } | null {
        const keywordInfo = this.getKeywordInfo(word);
        if (!keywordInfo) {
            return null;
        }
        
        const content: MarkupContent = {
            kind: MarkupKind.Markdown,
            value: this.createKeywordHoverContent(word, keywordInfo)
        };
        
        return { content };
    }
    
    /**
     * Get hover information for WDL types
     */
    private getTypeHover(word: string): { content: MarkupContent } | null {
        const typeInfo = this.getTypeInfo(word);
        if (!typeInfo) {
            return null;
        }
        
        const content: MarkupContent = {
            kind: MarkupKind.Markdown,
            value: this.createTypeHoverContent(word, typeInfo)
        };
        
        return { content };
    }
    
    /**
     * Get hover information for builtin functions
     */
    private getBuiltinFunctionHover(word: string): { content: MarkupContent } | null {
        const functionInfo = this.getBuiltinFunctionInfo(word);
        if (!functionInfo) {
            return null;
        }
        
        const content: MarkupContent = {
            kind: MarkupKind.Markdown,
            value: this.createFunctionHoverContent(functionInfo)
        };
        
        return { content };
    }
    
    /**
     * Create hover content for tasks
     */
    private createTaskHoverContent(task: TaskSymbol): MarkupContent {
        const content: string[] = [];
        
        // Task header
        const taskName = task.qualifiedName || task.name;
        content.push(`# 🔧 Task: ${taskName}`, '');
        
        // Description
        if (task.description) {
            content.push(task.description, '');
        }
        
        // Source information
        const isImported = task.qualifiedName && task.qualifiedName.includes('.');
        if (isImported) {
            content.push(`📦 **Source:** Imported task`);
            // Import path would be available in enhanced task symbol
            // if (task.importPath) {
            //     content.push(`📁 **Path:** \`${task.importPath}\``);
            // }
        } else {
            content.push(`🏠 **Source:** Local task`);
        }
        content.push('');
        
        // Input summary
        const requiredInputs = task.inputs.filter(input => !input.optional);
        const optionalInputs = task.inputs.filter(input => input.optional);
        
        if (requiredInputs.length > 0) {
            content.push(`## 🔴 Required Inputs (${requiredInputs.length})`);
            for (const input of requiredInputs.slice(0, 5)) { // Limit to first 5
                const typeStr = this.taskAnalyzer.formatType(input.type);
                content.push(`- **\`${input.name}\`** (\`${typeStr}\`)`);
            }
            if (requiredInputs.length > 5) {
                content.push(`- *... and ${requiredInputs.length - 5} more*`);
            }
            content.push('');
        }
        
        if (optionalInputs.length > 0) {
            content.push(`## 🟡 Optional Inputs (${optionalInputs.length})`);
            for (const input of optionalInputs.slice(0, 3)) { // Limit to first 3
                const typeStr = this.taskAnalyzer.formatType(input.type);
                content.push(`- **\`${input.name}\`** (\`${typeStr}\`)`);
            }
            if (optionalInputs.length > 3) {
                content.push(`- *... and ${optionalInputs.length - 3} more*`);
            }
            content.push('');
        }
        
        // Output summary
        if (task.outputs.length > 0) {
            content.push(`## 📤 Outputs (${task.outputs.length})`);
            for (const output of task.outputs.slice(0, 5)) { // Limit to first 5
                const typeStr = this.taskAnalyzer.formatType(output.type);
                content.push(`- **\`${output.name}\`** (\`${typeStr}\`)`);
            }
            if (task.outputs.length > 5) {
                content.push(`- *... and ${task.outputs.length - 5} more*`);
            }
        }
        
        return {
            kind: MarkupKind.Markdown,
            value: content.join('\n')
        };
    }
    
    /**
     * Create hover content for parameters
     */
    private createParameterHoverContent(
        parameter: ParameterInfo, 
        task: TaskSymbol, 
        parameterType: 'input' | 'output'
    ): MarkupContent {
        const content: string[] = [];
        
        // Parameter header
        const icon = parameterType === 'input' ? '📥' : '📤';
        const typeStr = this.taskAnalyzer.formatType(parameter.type);
        content.push(`# ${icon} ${parameterType.charAt(0).toUpperCase() + parameterType.slice(1)}: ${parameter.name}`, '');
        
        // Type information
        content.push(`**Type:** \`${typeStr}\``);
        
        // Requirement status for inputs
        if (parameterType === 'input') {
            if (parameter.optional) {
                content.push(`**Status:** 🟡 Optional`);
                if (parameter.defaultValue !== undefined) {
                    content.push(`**Default:** \`${parameter.defaultValue}\``);
                }
            } else {
                content.push(`**Status:** 🔴 Required`);
            }
        }
        
        // Source task
        const taskName = task.qualifiedName || task.name;
        content.push(`**From Task:** \`${taskName}\``);
        content.push('');
        
        // Description
        if (parameter.description) {
            content.push(parameter.description, '');
        }
        
        // Usage example
        if (parameterType === 'input') {
            const example = this.generateParameterUsageExample(parameter, task);
            if (example) {
                content.push(`**Usage Example:**`, '```wdl', example, '```');
            }
        } else {
            content.push(`**Usage Example:**`, '```wdl', `output_value = ${taskName}.${parameter.name}`, '```');
        }
        
        return {
            kind: MarkupKind.Markdown,
            value: content.join('\n')
        };
    }
    
    /**
     * Create hover content for keywords
     */
    private createKeywordHoverContent(keyword: string, info: KeywordInfo): string {
        const content: string[] = [];
        
        content.push(`# 🔤 WDL Keyword: \`${keyword}\``, '');
        content.push(info.description, '');
        
        if (info.syntax) {
            content.push(`**Syntax:**`, '```wdl', info.syntax, '```', '');
        }
        
        if (info.example) {
            content.push(`**Example:**`, '```wdl', info.example, '```');
        }
        
        return content.join('\n');
    }
    
    /**
     * Create hover content for types
     */
    private createTypeHoverContent(type: string, info: TypeInfo): string {
        const content: string[] = [];
        
        content.push(`# 🏷️ WDL Type: \`${type}\``, '');
        content.push(info.description, '');
        
        if (info.examples && info.examples.length > 0) {
            content.push(`**Examples:**`);
            for (const example of info.examples) {
                content.push(`- \`${example}\``);
            }
        }
        
        return content.join('\n');
    }
    
    /**
     * Create hover content for functions
     */
    private createFunctionHoverContent(func: BuiltinFunctionInfo): string {
        const content: string[] = [];
        
        content.push(`# ⚙️ Built-in Function: \`${func.name}\``, '');
        content.push(func.description, '');
        
        if (func.parameters.length > 0) {
            content.push(`**Parameters:**`);
            for (const param of func.parameters) {
                const optional = param.optional ? ' *(optional)*' : '';
                content.push(`- \`${param.type} ${param.name}\`${optional}`);
            }
            content.push('');
        }
        
        if (func.returnType) {
            content.push(`**Returns:** \`${func.returnType}\``, '');
        }
        
        if (func.example) {
            content.push(`**Example:**`, '```wdl', func.example, '```');
        }
        
        return content.join('\n');
    }
    
    /**
     * Generate parameter usage example
     */
    private generateParameterUsageExample(parameter: ParameterInfo, task: TaskSymbol): string | null {
        const taskName = task.qualifiedName || task.name;
        const baseType = parameter.type.name.toLowerCase();
        
        let exampleValue: string;
        switch (baseType) {
            case 'string':
                exampleValue = '"example_value"';
                break;
            case 'int':
                exampleValue = '42';
                break;
            case 'float':
                exampleValue = '3.14';
                break;
            case 'boolean':
                exampleValue = 'true';
                break;
            case 'file':
                exampleValue = 'input_file';
                break;
            case 'array':
                exampleValue = '["item1", "item2"]';
                break;
            case 'map':
                exampleValue = '{"key": "value"}';
                break;
            default:
                exampleValue = 'value';
        }
        
        return `call ${taskName} {\n  input:\n    ${parameter.name} = ${exampleValue}\n}`;
    }
    
    /**
     * Get keyword information
     */
    private getKeywordInfo(keyword: string): KeywordInfo | null {
        const keywords: { [key: string]: KeywordInfo } = {
            'version': {
                description: 'Specifies the WDL version for the document',
                syntax: 'version 1.0',
                example: 'version 1.0'
            },
            'import': {
                description: 'Imports tasks and workflows from other WDL files',
                syntax: 'import "path/to/file.wdl" as alias',
                example: 'import "tasks.wdl" as tasks'
            },
            'task': {
                description: 'Defines a computational task with inputs, command, and outputs',
                syntax: 'task name {\n  input { ... }\n  command { ... }\n  output { ... }\n}',
                example: 'task hello {\n  input {\n    String name\n  }\n  command {\n    echo "Hello ${name}"\n  }\n  output {\n    String result = stdout()\n  }\n}'
            },
            'workflow': {
                description: 'Defines a workflow that orchestrates tasks and other workflows',
                syntax: 'workflow name {\n  input { ... }\n  call task_name\n  output { ... }\n}',
                example: 'workflow main {\n  input {\n    String name\n  }\n  call hello { input: name = name }\n  output {\n    String result = hello.result\n  }\n}'
            },
            'call': {
                description: 'Invokes a task or workflow with specified inputs',
                syntax: 'call task_name { input: param = value }',
                example: 'call hello { input: name = "World" }'
            }
        };
        
        return keywords[keyword] || null;
    }
    
    /**
     * Get type information
     */
    private getTypeInfo(type: string): TypeInfo | null {
        const types: { [key: string]: TypeInfo } = {
            'String': {
                description: 'Text data type for storing strings',
                examples: ['"hello"', '"path/to/file"', 'variable_name']
            },
            'Int': {
                description: 'Integer number type for whole numbers',
                examples: ['42', '0', '-10', 'thread_count']
            },
            'Float': {
                description: 'Floating-point number type for decimal numbers',
                examples: ['3.14', '0.0', '-2.5', 'threshold']
            },
            'Boolean': {
                description: 'True/false value type for logical operations',
                examples: ['true', 'false', 'enable_feature']
            },
            'File': {
                description: 'File path type for referencing files',
                examples: ['input_file', '"data.txt"', 'reference_genome']
            },
            'Array': {
                description: 'Collection of values of the same type',
                examples: ['Array[String]', 'Array[File]', '["a", "b", "c"]']
            }
        };
        
        return types[type] || null;
    }
    
    /**
     * Get builtin function information
     */
    private getBuiltinFunctionInfo(name: string): BuiltinFunctionInfo | null {
        const functions: { [key: string]: BuiltinFunctionInfo } = {
            'select_first': {
                name: 'select_first',
                description: 'Returns the first non-null value from an array',
                parameters: [{ name: 'array', type: 'Array[X?]', optional: false }],
                returnType: 'X',
                example: 'select_first([null, "value", "other"])'
            },
            'defined': {
                name: 'defined',
                description: 'Checks if a value is defined (not null)',
                parameters: [{ name: 'value', type: 'X?', optional: false }],
                returnType: 'Boolean',
                example: 'defined(optional_value)'
            },
            'length': {
                name: 'length',
                description: 'Returns the length of an array or string',
                parameters: [{ name: 'value', type: 'Array[X] | String', optional: false }],
                returnType: 'Int',
                example: 'length(["a", "b", "c"])'
            },
            'basename': {
                name: 'basename',
                description: 'Returns the filename from a path',
                parameters: [
                    { name: 'path', type: 'String | File', optional: false },
                    { name: 'suffix', type: 'String', optional: true }
                ],
                returnType: 'String',
                example: 'basename("/path/to/file.txt", ".txt")'
            }
        };
        
        return functions[name] || null;
    }
}

interface KeywordInfo {
    description: string;
    syntax?: string;
    example?: string;
}

interface TypeInfo {
    description: string;
    examples?: string[];
}

interface BuiltinFunctionInfo {
    name: string;
    description: string;
    parameters: { name: string; type: string; optional: boolean }[];
    returnType?: string;
    example?: string;
}