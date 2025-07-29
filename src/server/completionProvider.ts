import {
    CompletionItem,
    CompletionItemKind,
    InsertTextFormat,
    MarkupContent,
    MarkupKind
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SymbolProvider, TaskSymbol } from './symbolProvider';
import { TaskAnalyzer, ParameterInfo } from './taskAnalyzer';

export class CompletionProvider {
    private symbolProvider: SymbolProvider;
    private taskAnalyzer: TaskAnalyzer;
    
    constructor(symbolProvider: SymbolProvider) {
        this.symbolProvider = symbolProvider;
        this.taskAnalyzer = new TaskAnalyzer();
    }
    
    /**
     * Provide completion items for a position in a document
     */
    provideCompletionItems(document: TextDocument, line: number, character: number): CompletionItem[] {
        const text = document.getText();
        const offset = document.offsetAt({ line, character });
        
        // Determine completion context
        const context = this.getCompletionContext(text, offset);
        
        switch (context.type) {
            case 'task-call':
                return this.getTaskCompletions(document.uri);
            
            case 'task-input':
                return this.getTaskInputCompletions(context.taskName!, document.uri);
            
            case 'task-output':
                return this.getTaskOutputCompletions(context.taskName!, document.uri);
            
            case 'assignment-value':
                return this.getValueCompletions(document.uri);
            
            default:
                return this.getGeneralCompletions(document.uri);
        }
    }
    
    /**
     * Get completion context based on cursor position
     */
    private getCompletionContext(text: string, offset: number): CompletionContext {
        // Look backward from cursor to understand context
        let pos = offset - 1;
        let braceDepth = 0;
        let parenDepth = 0;
        
        // Skip whitespace
        while (pos >= 0 && /\s/.test(text[pos])) {
            pos--;
        }
        
        if (pos < 0) {
            return { type: 'general' };
        }
        
        // Check for task output reference (after dot)
        if (text[pos] === '.') {
            const taskName = this.getWordBefore(text, pos);
            if (taskName) {
                return { type: 'task-output', taskName };
            }
        }
        
        // Check for assignment context
        if (text[pos] === '=') {
            return { type: 'assignment-value' };
        }
        
        // Look for call context
        const callContext = this.findCallContext(text, offset);
        if (callContext) {
            if (callContext.inInputBlock) {
                return { type: 'task-input', taskName: callContext.taskName };
            } else {
                return { type: 'task-call' };
            }
        }
        
        // Check if we're after 'call' keyword
        const beforeCall = this.getWordBefore(text, pos + 1);
        if (beforeCall === 'call') {
            return { type: 'task-call' };
        }
        
        return { type: 'general' };
    }
    
    /**
     * Get task name completions
     */
    private getTaskCompletions(uri: string): CompletionItem[] {
        const tasks = this.symbolProvider.getTaskSymbolsInContext(uri);
        const completions: CompletionItem[] = [];
        
        for (const task of tasks) {
            const displayName = task.qualifiedName || task.name;
            const completion: CompletionItem = {
                label: displayName,
                kind: CompletionItemKind.Function,
                detail: `Task: ${displayName}`,
                documentation: this.createTaskDocumentation(task),
                insertText: displayName,
                sortText: `1_${displayName}` // Prioritize tasks
            };
            
            completions.push(completion);
        }
        
        return completions;
    }
    
    /**
     * Get task input parameter completions
     */
    private getTaskInputCompletions(taskName: string, uri: string): CompletionItem[] {
        const task = this.symbolProvider.getTaskSymbol(taskName, uri);
        if (!task) {
            return [];
        }
        
        const completions: CompletionItem[] = [];
        
        for (const input of task.inputs) {
            const completion: CompletionItem = {
                label: input.name,
                kind: CompletionItemKind.Property,
                detail: `${this.taskAnalyzer.formatType(input.type)} ${input.name}${input.optional ? ' (optional)' : ' (required)'}`,
                documentation: this.createParameterDocumentation(input),
                insertText: `${input.name} = `,
                insertTextFormat: InsertTextFormat.PlainText,
                sortText: input.optional ? `2_${input.name}` : `1_${input.name}` // Required first
            };
            
            completions.push(completion);
        }
        
        return completions;
    }
    
    /**
     * Get task output parameter completions
     */
    private getTaskOutputCompletions(taskName: string, uri: string): CompletionItem[] {
        const task = this.symbolProvider.getTaskSymbol(taskName, uri);
        if (!task) {
            return [];
        }
        
        const completions: CompletionItem[] = [];
        
        for (const output of task.outputs) {
            const completion: CompletionItem = {
                label: output.name,
                kind: CompletionItemKind.Property,
                detail: `${this.taskAnalyzer.formatType(output.type)} ${output.name}`,
                documentation: this.createParameterDocumentation(output),
                insertText: output.name,
                insertTextFormat: InsertTextFormat.PlainText,
                sortText: `1_${output.name}`
            };
            
            completions.push(completion);
        }
        
        return completions;
    }
    
    /**
     * Get value completions (for assignment right-hand side)
     */
    private getValueCompletions(uri: string): CompletionItem[] {
        const completions: CompletionItem[] = [];
        
        // Add task output references
        const tasks = this.symbolProvider.getTaskSymbolsInContext(uri);
        for (const task of tasks) {
            for (const output of task.outputs) {
                const displayName = task.qualifiedName || task.name;
                const completion: CompletionItem = {
                    label: `${displayName}.${output.name}`,
                    kind: CompletionItemKind.Reference,
                    detail: `${this.taskAnalyzer.formatType(output.type)} - Output from ${displayName}`,
                    documentation: this.createParameterDocumentation(output),
                    insertText: `${displayName}.${output.name}`,
                    sortText: `1_${displayName}_${output.name}`
                };
                
                completions.push(completion);
            }
        }
        
        // Add common WDL functions
        const functions = [
            'select_first', 'select_all', 'defined', 'length', 'basename', 'size',
            'glob', 'read_string', 'read_int', 'read_float', 'read_boolean',
            'read_json', 'write_json', 'stdout', 'stderr', 'floor', 'ceil',
            'round', 'min', 'max', 'sep', 'quote', 'squote', 'sub', 'range',
            'transpose', 'zip', 'cross', 'unzip', 'flatten'
        ];
        
        for (const func of functions) {
            completions.push({
                label: func,
                kind: CompletionItemKind.Function,
                detail: `WDL builtin function`,
                insertText: `${func}()`,
                insertTextFormat: InsertTextFormat.PlainText,
                sortText: `2_${func}`
            });
        }
        
        return completions;
    }
    
    /**
     * Get general completions (keywords, etc.)
     */
    private getGeneralCompletions(uri: string): CompletionItem[] {
        const completions: CompletionItem[] = [];
        
        // WDL keywords
        const keywords = [
            'version', 'import', 'as', 'task', 'workflow', 'struct',
            'input', 'output', 'command', 'runtime', 'meta', 'parameter_meta',
            'call', 'if', 'else', 'scatter', 'in'
        ];
        
        for (const keyword of keywords) {
            completions.push({
                label: keyword,
                kind: CompletionItemKind.Keyword,
                detail: `WDL keyword`,
                insertText: keyword,
                sortText: `3_${keyword}`
            });
        }
        
        // WDL types
        const types = ['String', 'Int', 'Float', 'Boolean', 'File', 'Array', 'Map', 'Pair', 'Object'];
        
        for (const type of types) {
            completions.push({
                label: type,
                kind: CompletionItemKind.TypeParameter,
                detail: `WDL type`,
                insertText: type,
                sortText: `4_${type}`
            });
        }
        
        return completions;
    }
    
    /**
     * Create documentation for a task
     */
    private createTaskDocumentation(task: TaskSymbol): MarkupContent {
        const content: string[] = [];
        
        if (task.description) {
            content.push(task.description, '');
        }
        
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
        
        return {
            kind: MarkupKind.Markdown,
            value: content.join('\n')
        };
    }
    
    /**
     * Create documentation for a parameter
     */
    private createParameterDocumentation(parameter: ParameterInfo): MarkupContent {
        const content: string[] = [];
        
        if (parameter.description) {
            content.push(parameter.description, '');
        }
        
        const typeStr = this.taskAnalyzer.formatType(parameter.type);
        content.push(`**Type:** \`${typeStr}\``);
        
        if (parameter.defaultValue !== undefined) {
            content.push(`**Default:** \`${parameter.defaultValue}\``);
        }
        
        return {
            kind: MarkupKind.Markdown,
            value: content.join('\n')
        };
    }
    
    /**
     * Find call context around a position
     */
    private findCallContext(text: string, offset: number): CallContext | undefined {
        let pos = offset;
        let braceDepth = 0;
        let inCall = false;
        let taskName = '';
        let inInputBlock = false;
        
        // Look backward to find call statement
        while (pos > 0) {
            const char = text[pos];
            
            if (char === '}') {
                braceDepth++;
            } else if (char === '{') {
                braceDepth--;
                if (braceDepth < 0) {
                    // Found opening brace, look for call statement
                    const callMatch = this.findCallStatement(text, pos);
                    if (callMatch) {
                        taskName = callMatch.taskName;
                        inCall = true;
                        
                        // Check if we're in input block
                        const inputMatch = text.substring(pos, offset).match(/input\s*:/);
                        inInputBlock = !!inputMatch;
                        
                        break;
                    }
                }
            }
            
            pos--;
        }
        
        if (inCall) {
            return { taskName, inInputBlock };
        }
        
        return undefined;
    }
    
    /**
     * Find call statement before a position
     */
    private findCallStatement(text: string, pos: number): {taskName: string} | undefined {
        // Look backward for "call TaskName"
        let searchPos = pos - 1;
        
        // Skip whitespace
        while (searchPos > 0 && /\s/.test(text[searchPos])) {
            searchPos--;
        }
        
        // Extract task name
        let nameEnd = searchPos + 1;
        while (searchPos > 0 && /[a-zA-Z0-9_.]/.test(text[searchPos])) {
            searchPos--;
        }
        
        if (searchPos >= 0) {
            const taskName = text.substring(searchPos + 1, nameEnd);
            
            // Skip whitespace before task name
            while (searchPos > 0 && /\s/.test(text[searchPos])) {
                searchPos--;
            }
            
            // Look for "call" keyword
            let keywordEnd = searchPos + 1;
            while (searchPos > 0 && /[a-zA-Z]/.test(text[searchPos])) {
                searchPos--;
            }
            
            const keyword = text.substring(searchPos + 1, keywordEnd);
            if (keyword === 'call') {
                return { taskName };
            }
        }
        
        return undefined;
    }
    
    /**
     * Get word before a position
     */
    private getWordBefore(text: string, pos: number): string | undefined {
        let end = pos;
        
        // Skip whitespace
        while (end > 0 && /\s/.test(text[end - 1])) {
            end--;
        }
        
        let start = end;
        while (start > 0 && /[a-zA-Z0-9_]/.test(text[start - 1])) {
            start--;
        }
        
        if (start < end) {
            return text.substring(start, end);
        }
        
        return undefined;
    }
}

interface CompletionContext {
    type: 'general' | 'task-call' | 'task-input' | 'task-output' | 'assignment-value';
    taskName?: string;
}

interface CallContext {
    taskName: string;
    inInputBlock: boolean;
}