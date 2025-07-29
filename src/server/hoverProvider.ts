import { Hover, MarkupContent, MarkupKind } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SymbolProvider, TaskSymbol } from './symbolProvider';
import { TaskAnalyzer, ParameterInfo } from './taskAnalyzer';

export class HoverProvider {
    private symbolProvider: SymbolProvider;
    private taskAnalyzer: TaskAnalyzer;
    
    constructor(symbolProvider: SymbolProvider) {
        this.symbolProvider = symbolProvider;
        this.taskAnalyzer = new TaskAnalyzer();
    }
    
    /**
     * Provide hover information for a position in a document
     */
    provideHover(document: TextDocument, line: number, character: number): Hover | undefined {
        const text = document.getText();
        const offset = document.offsetAt({ line, character });
        
        // Get the word at the current position
        const wordRange = this.getWordRangeAtPosition(text, offset);
        if (!wordRange) {
            return undefined;
        }
        
        const word = text.substring(wordRange.start, wordRange.end);
        
        // Try to find task symbol
        const taskSymbol = this.symbolProvider.getTaskSymbol(word, document.uri);
        if (taskSymbol) {
            return this.createTaskHover(taskSymbol, wordRange);
        }
        
        // Try to find task.output pattern
        const dotIndex = word.indexOf('.');
        if (dotIndex > 0) {
            const taskName = word.substring(0, dotIndex);
            const outputName = word.substring(dotIndex + 1);
            
            const task = this.symbolProvider.getTaskSymbol(taskName, document.uri);
            if (task) {
                const output = this.symbolProvider.getTaskOutputParameter(taskName, outputName, document.uri);
                if (output) {
                    return this.createParameterHover(output, `${taskName}.${outputName}`, 'output', wordRange);
                }
            }
        }
        
        // Check if it's a parameter in a task call context
        const taskContext = this.findTaskCallContext(text, offset);
        if (taskContext) {
            const input = this.symbolProvider.getTaskInputParameter(taskContext.taskName, word, document.uri);
            if (input) {
                return this.createParameterHover(input, word, 'input', wordRange);
            }
        }
        
        return undefined;
    }
    
    /**
     * Create hover content for a task
     */
    private createTaskHover(task: TaskSymbol, wordRange: {start: number, end: number}): Hover {
        const content: string[] = [];
        
        // Task signature
        content.push(`**Task:** \`${task.name}\``);
        
        if (task.description) {
            content.push('', task.description);
        }
        
        // Input parameters
        if (task.inputs.length > 0) {
            content.push('', '**Inputs:**');
            for (const input of task.inputs) {
                const typeStr = this.taskAnalyzer.formatType(input.type);
                const optional = input.optional ? ' *(optional)*' : ' *(required)*';
                let line = `- \`${typeStr} ${input.name}\`${optional}`;
                
                if (input.defaultValue !== undefined) {
                    line += ` = \`${input.defaultValue}\``;
                }
                
                if (input.description) {
                    line += ` - ${input.description}`;
                }
                
                content.push(line);
            }
        }
        
        // Output parameters
        if (task.outputs.length > 0) {
            content.push('', '**Outputs:**');
            for (const output of task.outputs) {
                const typeStr = this.taskAnalyzer.formatType(output.type);
                let line = `- \`${typeStr} ${output.name}\``;
                
                if (output.description) {
                    line += ` - ${output.description}`;
                }
                
                content.push(line);
            }
        }
        
        // Source file info
        if (task.sourceFile) {
            content.push('', `*Source: ${task.sourceFile}*`);
        }
        
        const markupContent: MarkupContent = {
            kind: MarkupKind.Markdown,
            value: content.join('\n')
        };
        
        return {
            contents: markupContent,
            range: {
                start: { line: 0, character: wordRange.start },
                end: { line: 0, character: wordRange.end }
            }
        };
    }
    
    /**
     * Create hover content for a parameter
     */
    private createParameterHover(
        parameter: ParameterInfo, 
        parameterName: string, 
        parameterType: 'input' | 'output',
        wordRange: {start: number, end: number}
    ): Hover {
        const content: string[] = [];
        
        // Parameter signature
        const typeStr = this.taskAnalyzer.formatType(parameter.type);
        const optional = parameter.optional ? ' *(optional)*' : ' *(required)*';
        content.push(`**${parameterType === 'input' ? 'Input' : 'Output'} Parameter:** \`${typeStr} ${parameterName}\`${optional}`);
        
        if (parameter.defaultValue !== undefined) {
            content.push('', `**Default Value:** \`${parameter.defaultValue}\``);
        }
        
        if (parameter.description) {
            content.push('', parameter.description);
        }
        
        // Type information
        content.push('', `**Type:** \`${typeStr}\``);
        
        const markupContent: MarkupContent = {
            kind: MarkupKind.Markdown,
            value: content.join('\n')
        };
        
        return {
            contents: markupContent,
            range: {
                start: { line: 0, character: wordRange.start },
                end: { line: 0, character: wordRange.end }
            }
        };
    }
    
    /**
     * Get word range at a specific position
     */
    private getWordRangeAtPosition(text: string, offset: number): {start: number, end: number} | undefined {
        if (offset < 0 || offset >= text.length) {
            return undefined;
        }
        
        // Find word boundaries
        let start = offset;
        let end = offset;
        
        // Move start backward to find word start
        while (start > 0 && this.isWordCharacter(text[start - 1])) {
            start--;
        }
        
        // Move end forward to find word end
        while (end < text.length && this.isWordCharacter(text[end])) {
            end++;
        }
        
        // Check for qualified names (task.output)
        if (end < text.length && text[end] === '.') {
            end++; // Include the dot
            while (end < text.length && this.isWordCharacter(text[end])) {
                end++;
            }
        } else if (start > 0 && text[start - 1] === '.') {
            start--; // Include the dot
            while (start > 0 && this.isWordCharacter(text[start - 1])) {
                start--;
            }
        }
        
        if (start === end) {
            return undefined;
        }
        
        return { start, end };
    }
    
    /**
     * Check if a character is part of a word
     */
    private isWordCharacter(char: string): boolean {
        return /[a-zA-Z0-9_]/.test(char);
    }
    
    /**
     * Find task call context for a given position
     */
    private findTaskCallContext(text: string, offset: number): {taskName: string} | undefined {
        // Look backward from the current position to find a call statement
        let pos = offset;
        let braceCount = 0;
        let inCall = false;
        let taskName = '';
        
        // Simple heuristic: look for "call TaskName {" pattern
        while (pos > 0) {
            const char = text[pos];
            
            if (char === '}') {
                braceCount++;
            } else if (char === '{') {
                braceCount--;
                if (braceCount < 0 && inCall) {
                    // Found the opening brace of a call
                    break;
                }
            }
            
            pos--;
        }
        
        if (braceCount < 0) {
            // Look for "call TaskName" before the opening brace
            let callPos = pos;
            while (callPos > 0 && /\s/.test(text[callPos])) {
                callPos--;
            }
            
            // Extract task name
            let nameEnd = callPos + 1;
            while (callPos > 0 && this.isWordCharacter(text[callPos])) {
                callPos--;
            }
            
            if (callPos > 0) {
                taskName = text.substring(callPos + 1, nameEnd);
                
                // Look for "call" keyword before task name
                while (callPos > 0 && /\s/.test(text[callPos])) {
                    callPos--;
                }
                
                let keywordEnd = callPos + 1;
                while (callPos > 0 && this.isWordCharacter(text[callPos])) {
                    callPos--;
                }
                
                const keyword = text.substring(callPos + 1, keywordEnd);
                if (keyword === 'call') {
                    return { taskName };
                }
            }
        }
        
        return undefined;
    }
}