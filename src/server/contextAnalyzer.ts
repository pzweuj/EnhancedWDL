import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position } from 'vscode-languageserver/node';
import { ImportInfo } from './documentAnalyzer';

export interface CompletionContext {
    type: 'task-call' | 'task-input' | 'task-output' | 'assignment-value' | 'general';
    taskName?: string;
    resolvedTaskName?: string;
    inInputBlock?: boolean;
    position: Position;
    confidence: number; // 0-1, how confident we are about the context
}

export interface CallInputContext {
    taskName: string;
    resolvedTaskName: string;
    inputBlockStart: Position;
    currentInputName?: string;
    isInInputValue?: boolean;
}

export interface TaskOutputContext {
    taskName: string;
    resolvedTaskName: string;
    dotPosition: Position;
    isComplete: boolean; // whether the reference is complete (e.g., "task.output" vs "task.")
}

export interface ParsedCallStatement {
    taskName: string;
    alias?: string;
    inputBlockRange?: {
        start: Position;
        end: Position;
    };
    inputs: Array<{
        name: string;
        valueRange?: {
            start: Position;
            end: Position;
        };
    }>;
}

export class ContextAnalyzer {
    
    /**
     * Analyze the context at a specific position in a document
     */
    analyzeContext(document: TextDocument, position: Position): CompletionContext {
        const text = document.getText();
        const offset = document.offsetAt(position);
        
        // Try different context analysis methods in order of specificity
        const contexts = [
            this.analyzeTaskOutputContext(text, offset, position),
            this.analyzeCallInputContext(text, offset, position),
            this.analyzeTaskCallContext(text, offset, position),
            this.analyzeAssignmentContext(text, offset, position),
            this.analyzeGeneralContext(text, offset, position)
        ];
        
        // Return the context with highest confidence
        return contexts.reduce((best, current) => 
            current.confidence > best.confidence ? current : best
        );
    }
    
    /**
     * Check if position is in a call statement's input block
     */
    isInCallInputBlock(text: string, offset: number): CallInputContext | null {
        const callInfo = this.findEnclosingCallStatement(text, offset);
        if (!callInfo) {
            return null;
        }
        
        // Check if we're inside the input block
        if (callInfo.inputBlockRange) {
            const inputBlockStart = this.positionFromOffset(text, 
                this.offsetFromPosition(text, callInfo.inputBlockRange.start));
            
            return {
                taskName: callInfo.taskName,
                resolvedTaskName: callInfo.taskName, // Will be resolved later
                inputBlockStart,
                currentInputName: this.getCurrentInputName(text, offset, callInfo),
                isInInputValue: this.isInInputValue(text, offset, callInfo)
            };
        }
        
        return null;
    }
    
    /**
     * Check if position is a task output reference
     */
    isTaskOutputReference(text: string, offset: number): TaskOutputContext | null {
        // Look for pattern: TaskName.
        let pos = offset - 1;
        
        // Skip whitespace
        while (pos >= 0 && /\s/.test(text[pos])) {
            pos--;
        }
        
        if (pos < 0 || text[pos] !== '.') {
            return null;
        }
        
        const dotPos = pos;
        const taskName = this.getWordBefore(text, pos);
        
        if (!taskName) {
            return null;
        }
        
        // Check if this is actually a task output reference
        if (this.isValidTaskOutputContext(text, dotPos)) {
            return {
                taskName,
                resolvedTaskName: taskName, // Will be resolved later
                dotPosition: this.positionFromOffset(text, dotPos),
                isComplete: this.isOutputReferenceComplete(text, offset)
            };
        }
        
        return null;
    }
    
    /**
     * Resolve task name considering aliases
     */
    resolveTaskName(taskName: string, imports: ImportInfo[]): string {
        // If task name contains dot, it might be aliased
        if (taskName.includes('.')) {
            const parts = taskName.split('.');
            const alias = parts[0];
            const actualTaskName = parts.slice(1).join('.');
            
            // Find the import with this alias
            const importInfo = imports.find(imp => imp.alias === alias);
            if (importInfo && importInfo.tasks) {
                // Check if the task exists in the imported file
                const task = importInfo.tasks.find(t => 
                    t.name === actualTaskName || t.name === taskName
                );
                if (task) {
                    return task.name;
                }
            }
        }
        
        return taskName;
    }
    
    // Private helper methods
    
    /**
     * Analyze task output context (TaskName.output)
     */
    private analyzeTaskOutputContext(text: string, offset: number, position: Position): CompletionContext {
        const outputContext = this.isTaskOutputReference(text, offset);
        
        if (outputContext) {
            return {
                type: 'task-output',
                taskName: outputContext.taskName,
                resolvedTaskName: outputContext.resolvedTaskName,
                position,
                confidence: 0.9
            };
        }
        
        return { type: 'general', position, confidence: 0.0 };
    }
    
    /**
     * Analyze call input context
     */
    private analyzeCallInputContext(text: string, offset: number, position: Position): CompletionContext {
        const inputContext = this.isInCallInputBlock(text, offset);
        
        if (inputContext) {
            return {
                type: 'task-input',
                taskName: inputContext.taskName,
                resolvedTaskName: inputContext.resolvedTaskName,
                inInputBlock: true,
                position,
                confidence: 0.8
            };
        }
        
        return { type: 'general', position, confidence: 0.0 };
    }
    
    /**
     * Analyze task call context
     */
    private analyzeTaskCallContext(text: string, offset: number, position: Position): CompletionContext {
        // Look for "call " keyword before current position
        const beforeCall = this.getTextBefore(text, offset, 30);
        const callMatch = beforeCall.match(/\bcall\s+(\w*\.?\w*)$/);
        
        if (callMatch) {
            // Check if this is actually a task call and not a task output reference
            // If there's a dot at the end, it might be task output reference in call context
            const taskNamePart = callMatch[1];
            if (taskNamePart.endsWith('.') && offset > 0 && text[offset - 1] === '.') {
                // This is likely a task output reference, let that handler take precedence
                return { type: 'general', position, confidence: 0.0 };
            }
            
            return {
                type: 'task-call',
                position,
                confidence: 0.7
            };
        }
        
        return { type: 'general', position, confidence: 0.0 };
    }
    
    /**
     * Analyze assignment context
     */
    private analyzeAssignmentContext(text: string, offset: number, position: Position): CompletionContext {
        // Look for assignment pattern: identifier = 
        const beforeAssign = this.getTextBefore(text, offset, 50);
        const assignMatch = beforeAssign.match(/\w+\s*=\s*$/);
        
        if (assignMatch) {
            return {
                type: 'assignment-value',
                position,
                confidence: 0.6
            };
        }
        
        return { type: 'general', position, confidence: 0.0 };
    }
    
    /**
     * Analyze general context
     */
    private analyzeGeneralContext(text: string, offset: number, position: Position): CompletionContext {
        return {
            type: 'general',
            position,
            confidence: 0.1
        };
    }
    
    /**
     * Find the enclosing call statement
     */
    private findEnclosingCallStatement(text: string, offset: number): ParsedCallStatement | null {
        let pos = offset - 1; // Start from before current position
        let braceDepth = 0;
        
        // Search backwards for call statement
        while (pos >= 0) {
            const char = text[pos];
            
            if (char === '}') {
                braceDepth++;
            } else if (char === '{') {
                braceDepth--;
                if (braceDepth <= 0) {
                    // Found opening brace, look for call statement
                    const callInfo = this.parseCallStatement(text, pos);
                    if (callInfo) {
                        // Check if current position is within this call statement
                        const callEnd = this.findMatchingCloseBrace(text, pos);
                        if (callEnd >= offset) {
                            return callInfo;
                        }
                    }
                }
            }
            
            pos--;
        }
        
        return null;
    }
    
    /**
     * Find matching closing brace
     */
    private findMatchingCloseBrace(text: string, openBracePos: number): number {
        let pos = openBracePos + 1;
        let braceDepth = 1;
        
        while (pos < text.length && braceDepth > 0) {
            if (text[pos] === '{') {
                braceDepth++;
            } else if (text[pos] === '}') {
                braceDepth--;
            }
            pos++;
        }
        
        // If we reached end of text without finding closing brace, 
        // return the end position (for incomplete statements)
        return braceDepth === 0 ? pos - 1 : text.length;
    }
    
    /**
     * Parse a call statement starting from opening brace
     */
    private parseCallStatement(text: string, bracePos: number): ParsedCallStatement | null {
        // Look backwards from brace to find "call TaskName"
        let pos = bracePos - 1;
        
        // Skip whitespace
        while (pos >= 0 && /\s/.test(text[pos])) {
            pos--;
        }
        
        if (pos < 0) return null;
        
        // Extract task name
        let nameEnd = pos + 1;
        while (pos >= 0 && /[a-zA-Z0-9_.]/.test(text[pos])) {
            pos--;
        }
        
        const taskName = text.substring(pos + 1, nameEnd);
        if (!taskName) return null;
        
        // Skip whitespace before task name
        while (pos >= 0 && /\s/.test(text[pos])) {
            pos--;
        }
        
        if (pos < 0) return null;
        
        // Look for "call" keyword
        let keywordEnd = pos + 1;
        while (pos >= 0 && /[a-zA-Z]/.test(text[pos])) {
            pos--;
        }
        
        const keyword = text.substring(pos + 1, keywordEnd);
        if (keyword === 'call') {
            // Parse the call statement content
            return this.parseCallStatementContent(text, bracePos, taskName);
        }
        
        return null;
    }
    
    /**
     * Parse call statement content to extract input block and inputs
     */
    private parseCallStatementContent(text: string, braceStart: number, taskName: string): ParsedCallStatement {
        const result: ParsedCallStatement = {
            taskName,
            inputs: []
        };
        
        // Find matching closing brace
        let pos = braceStart + 1;
        let braceDepth = 1;
        let closingBrace = -1;
        
        while (pos < text.length && braceDepth > 0) {
            if (text[pos] === '{') {
                braceDepth++;
            } else if (text[pos] === '}') {
                braceDepth--;
                if (braceDepth === 0) {
                    closingBrace = pos;
                    break;
                }
            }
            pos++;
        }
        
        // If no closing brace found, use end of text (for incomplete statements)
        if (closingBrace === -1) {
            closingBrace = text.length;
        }
        
        const callContent = text.substring(braceStart + 1, closingBrace);
        
        // Look for input block
        const inputMatch = callContent.match(/input\s*:/);
        if (inputMatch && inputMatch.index !== undefined) {
            const inputKeywordStart = braceStart + 1 + inputMatch.index;
            const inputStart = braceStart + 1 + inputMatch.index + inputMatch[0].length;
            result.inputBlockRange = {
                start: this.positionFromOffset(text, inputKeywordStart),
                end: this.positionFromOffset(text, closingBrace)
            };
            
            // Parse individual inputs
            result.inputs = this.parseInputStatements(text, inputStart, closingBrace);
        }
        
        return result;
    }
    
    /**
     * Parse input statements within input block
     */
    private parseInputStatements(text: string, start: number, end: number): Array<{name: string, valueRange?: {start: Position, end: Position}}> {
        const inputs: Array<{name: string, valueRange?: {start: Position, end: Position}}> = [];
        const inputText = text.substring(start, end);
        
        // Match input patterns: name = value
        const inputRegex = /(\w+)\s*=\s*([^,}]+)/g;
        let match;
        
        while ((match = inputRegex.exec(inputText)) !== null) {
            const name = match[1];
            const valueStart = start + match.index! + match[0].indexOf('=') + 1;
            const valueEnd = start + match.index! + match[0].length;
            
            inputs.push({
                name,
                valueRange: {
                    start: this.positionFromOffset(text, valueStart),
                    end: this.positionFromOffset(text, valueEnd)
                }
            });
        }
        
        return inputs;
    }
    
    /**
     * Get current input name being edited
     */
    private getCurrentInputName(text: string, offset: number, callInfo: ParsedCallStatement): string | undefined {
        // Find the input statement that contains the current position
        for (const input of callInfo.inputs) {
            if (input.valueRange) {
                const startOffset = this.offsetFromPosition(text, input.valueRange.start);
                const endOffset = this.offsetFromPosition(text, input.valueRange.end);
                
                if (offset >= startOffset && offset <= endOffset) {
                    return input.name;
                }
            }
        }
        
        // If not in a value, might be starting a new input
        const beforeCursor = this.getTextBefore(text, offset, 50);
        const inputMatch = beforeCursor.match(/(\w+)\s*=?\s*$/);
        if (inputMatch) {
            return inputMatch[1];
        }
        
        return undefined;
    }
    
    /**
     * Check if cursor is in input value (after =)
     */
    private isInInputValue(text: string, offset: number, callInfo: ParsedCallStatement): boolean {
        const beforeCursor = this.getTextBefore(text, offset, 20);
        return /=\s*\w*$/.test(beforeCursor);
    }
    
    /**
     * Check if this is a valid task output context
     */
    private isValidTaskOutputContext(text: string, dotPos: number): boolean {
        // Check if we're in a valid context for task output reference
        // (not in a string literal, comment, etc.)
        
        // Simple check: make sure we're not in quotes
        const beforeDot = text.substring(0, dotPos);
        const quoteCount = (beforeDot.match(/"/g) || []).length;
        return quoteCount % 2 === 0; // Even number of quotes means we're not in a string
    }
    
    /**
     * Check if output reference is complete
     */
    private isOutputReferenceComplete(text: string, offset: number): boolean {
        // Check if there's already an output name after the dot
        const afterDot = text.substring(offset, offset + 20);
        return /^\w+/.test(afterDot);
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
        while (start > 0 && /[a-zA-Z0-9_.]/.test(text[start - 1])) {
            start--;
        }
        
        if (start < end) {
            return text.substring(start, end);
        }
        
        return undefined;
    }
    
    /**
     * Get text before a position with limit
     */
    private getTextBefore(text: string, offset: number, maxLength: number): string {
        const start = Math.max(0, offset - maxLength);
        return text.substring(start, offset);
    }
    
    /**
     * Convert offset to position
     */
    private positionFromOffset(text: string, offset: number): Position {
        const lines = text.substring(0, offset).split('\n');
        return {
            line: lines.length - 1,
            character: lines[lines.length - 1].length
        };
    }
    
    /**
     * Convert position to offset
     */
    private offsetFromPosition(text: string, position: Position): number {
        const lines = text.split('\n');
        let offset = 0;
        
        for (let i = 0; i < position.line && i < lines.length; i++) {
            offset += lines[i].length + 1; // +1 for newline
        }
        
        offset += Math.min(position.character, lines[position.line]?.length || 0);
        return offset;
    }
}