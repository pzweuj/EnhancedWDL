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

// Enhanced context interfaces for improved detection
export interface TaskInputContext extends CompletionContext {
    type: 'task-input';
    taskName: string;
    resolvedTaskName: string;
    inputBlockPosition: Position;
    currentInputName?: string;
    isInInputValue: boolean;
    availableInputs: string[];
    requiredInputs: string[];
    usedInputs: string[];
    // Enhanced context for complex syntax structures
    isInScatterBlock?: boolean;
    isInConditionalBlock?: boolean;
    isInNestedExpression?: boolean;
    scatterVariable?: string;
    conditionalContext?: 'if' | 'else';
    nestingLevel?: number;
}

export interface EnhancedTaskOutputContext extends CompletionContext {
    type: 'task-output';
    taskName: string;
    resolvedTaskName: string;
    dotPosition: Position;
    isAfterDot: boolean;
    availableOutputs: string[];
    outputTypes: Map<string, string>;
    // Enhanced context for complex syntax structures
    isInScatterBlock?: boolean;
    isInConditionalBlock?: boolean;
    isInNestedExpression?: boolean;
    scatterVariable?: string;
    conditionalContext?: 'if' | 'else';
    arrayTypeContext?: boolean; // For scatter block array outputs
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
            this.analyzeTaskOutputContextLegacy(text, offset, position),
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
     * Enhanced task input context detection - identifies call statement input blocks precisely
     */
    analyzeTaskInputContext(document: TextDocument, position: Position): TaskInputContext | null {
        const text = document.getText();
        const offset = document.offsetAt(position);
        
        const callInfo = this.findEnclosingCallStatement(text, offset);
        if (!callInfo || !callInfo.inputBlockRange) {
            return null;
        }
        
        // Check if we're actually inside the input block
        const inputBlockStartOffset = this.offsetFromPosition(text, callInfo.inputBlockRange.start);
        const inputBlockEndOffset = this.offsetFromPosition(text, callInfo.inputBlockRange.end);
        
        if (offset < inputBlockStartOffset || offset > inputBlockEndOffset) {
            return null;
        }
        
        // Detect used inputs
        const usedInputs = this.detectUsedInputs(text, callInfo);
        
        // Get current input name being edited
        const currentInputName = this.getCurrentInputName(text, offset, callInfo);
        
        // Check if cursor is in input value position
        const isInInputValue = this.isInInputValue(text, offset, callInfo);
        
        // Enhanced: Detect complex syntax structures
        const complexContext = this.analyzeComplexSyntaxContext(text, offset);
        
        return {
            type: 'task-input',
            taskName: callInfo.taskName,
            resolvedTaskName: callInfo.taskName, // Will be resolved by caller with imports
            inputBlockPosition: callInfo.inputBlockRange.start,
            currentInputName,
            isInInputValue,
            availableInputs: [], // Will be populated by caller with task info
            requiredInputs: [], // Will be populated by caller with task info
            usedInputs,
            position,
            confidence: 0.9,
            // Enhanced context information
            isInScatterBlock: complexContext.isInScatterBlock,
            isInConditionalBlock: complexContext.isInConditionalBlock,
            isInNestedExpression: complexContext.isInNestedExpression,
            scatterVariable: complexContext.scatterVariable,
            conditionalContext: complexContext.conditionalContext,
            nestingLevel: complexContext.nestingLevel
        };
    }

    /**
     * Enhanced task output context detection - identifies TaskName. patterns precisely
     */
    analyzeTaskOutputContext(document: TextDocument, position: Position): EnhancedTaskOutputContext | null {
        const text = document.getText();
        const offset = document.offsetAt(position);
        
        const outputContext = this.isTaskOutputReference(text, offset);
        if (!outputContext) {
            return null;
        }
        
        // Check if we're immediately after the dot
        const isAfterDot = offset > 0 && text[offset - 1] === '.';
        
        // Enhanced: Detect complex syntax structures
        const complexContext = this.analyzeComplexSyntaxContext(text, offset);
        
        return {
            type: 'task-output',
            taskName: outputContext.taskName,
            resolvedTaskName: outputContext.resolvedTaskName,
            dotPosition: outputContext.dotPosition,
            isAfterDot,
            availableOutputs: [], // Will be populated by caller with task info
            outputTypes: new Map(), // Will be populated by caller with task info
            position,
            confidence: 0.9,
            // Enhanced context information
            isInScatterBlock: complexContext.isInScatterBlock,
            isInConditionalBlock: complexContext.isInConditionalBlock,
            isInNestedExpression: complexContext.isInNestedExpression,
            scatterVariable: complexContext.scatterVariable,
            conditionalContext: complexContext.conditionalContext,
            arrayTypeContext: complexContext.isInScatterBlock // In scatter blocks, outputs are arrays
        };
    }

    /**
     * Enhanced task name resolution with import alias support
     */
    resolveTaskNameWithAlias(taskName: string, imports: ImportInfo[], contextUri: string): string {
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
                const task = importInfo.tasks.find(t => 
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
     * Analyze complex syntax context including scatter blocks, conditionals, and nested expressions
     */
    analyzeComplexSyntaxContext(text: string, offset: number): {
        isInScatterBlock: boolean;
        isInConditionalBlock: boolean;
        isInNestedExpression: boolean;
        scatterVariable?: string;
        conditionalContext?: 'if' | 'else';
        nestingLevel: number;
    } {
        const result = {
            isInScatterBlock: false,
            isInConditionalBlock: false,
            isInNestedExpression: false,
            scatterVariable: undefined as string | undefined,
            conditionalContext: undefined as 'if' | 'else' | undefined,
            nestingLevel: 0
        };

        // Analyze the text backwards from the current position
        let pos = offset;
        let braceDepth = 0;
        let parenDepth = 0;
        let inString = false;
        let stringChar = '';
        
        // Track nesting structures
        const structureStack: Array<{
            type: 'scatter' | 'if' | 'else' | 'call' | 'workflow' | 'task';
            startPos: number;
            variable?: string;
        }> = [];

        while (pos >= 0) {
            const char = text[pos];
            
            // Handle string literals
            if ((char === '"' || char === "'") && (pos === 0 || text[pos - 1] !== '\\')) {
                if (!inString) {
                    inString = true;
                    stringChar = char;
                } else if (char === stringChar) {
                    inString = false;
                    stringChar = '';
                }
            }
            
            if (!inString) {
                // Track braces and parentheses
                if (char === '}') {
                    braceDepth++;
                } else if (char === '{') {
                    if (braceDepth === 0) {
                        // Found opening brace, check what structure it belongs to
                        const structure = this.identifyStructureBeforeBrace(text, pos);
                        if (structure) {
                            structureStack.push({
                                type: structure.type,
                                startPos: pos,
                                variable: structure.variable
                            });
                            
                            // Update result based on current structure
                            if (structure.type === 'scatter') {
                                result.isInScatterBlock = true;
                                result.scatterVariable = structure.variable;
                            } else if (structure.type === 'if') {
                                result.isInConditionalBlock = true;
                                result.conditionalContext = 'if';
                            } else if (structure.type === 'else') {
                                result.isInConditionalBlock = true;
                                result.conditionalContext = 'else';
                            }
                        }
                    } else {
                        braceDepth--;
                    }
                } else if (char === ')') {
                    parenDepth++;
                } else if (char === '(') {
                    if (parenDepth > 0) {
                        parenDepth--;
                    }
                }
            }
            
            pos--;
        }

        // Calculate nesting level
        result.nestingLevel = structureStack.length;
        
        // Check for nested expressions (multiple levels of parentheses or complex expressions)
        result.isInNestedExpression = parenDepth > 1 || this.hasNestedExpressions(text, offset);

        return result;
    }

    /**
     * Identify the structure type before an opening brace
     */
    private identifyStructureBeforeBrace(text: string, bracePos: number): {
        type: 'scatter' | 'if' | 'else' | 'call' | 'workflow' | 'task';
        variable?: string;
    } | null {
        // Look backwards from brace to find the structure keyword
        let pos = bracePos - 1;
        
        // Skip whitespace
        while (pos >= 0 && /\s/.test(text[pos])) {
            pos--;
        }
        
        if (pos < 0) return null;
        
        // For scatter blocks, look for: scatter (variable in collection)
        const scatterMatch = this.matchScatterPattern(text, pos);
        if (scatterMatch) {
            return {
                type: 'scatter',
                variable: scatterMatch.variable
            };
        }
        
        // For conditional blocks, look for: if (condition) or else
        const conditionalMatch = this.matchConditionalPattern(text, pos);
        if (conditionalMatch) {
            return {
                type: conditionalMatch.type as 'if' | 'else'
            };
        }
        
        // For call statements, look for: call TaskName
        const callMatch = this.matchCallPattern(text, pos);
        if (callMatch) {
            return {
                type: 'call'
            };
        }
        
        // For workflow/task definitions
        const workflowMatch = this.matchWorkflowTaskPattern(text, pos);
        if (workflowMatch) {
            return {
                type: workflowMatch.type as 'workflow' | 'task'
            };
        }
        
        return null;
    }

    /**
     * Match scatter pattern: scatter (variable in collection)
     */
    private matchScatterPattern(text: string, endPos: number): { variable: string } | null {
        // Look for closing parenthesis
        if (text[endPos] !== ')') return null;
        
        // Find matching opening parenthesis
        let pos = endPos - 1;
        let parenDepth = 1;
        
        while (pos >= 0 && parenDepth > 0) {
            if (text[pos] === ')') {
                parenDepth++;
            } else if (text[pos] === '(') {
                parenDepth--;
            }
            pos--;
        }
        
        if (parenDepth !== 0) return null;
        
        const openParenPos = pos + 1;
        
        // Extract content inside parentheses
        const parenContent = text.substring(openParenPos + 1, endPos);
        
        // Look for "variable in collection" pattern
        const inMatch = parenContent.match(/^\s*(\w+)\s+in\s+/);
        if (!inMatch) return null;
        
        const variable = inMatch[1];
        
        // Look backwards from opening parenthesis for "scatter" keyword
        pos = openParenPos - 1;
        while (pos >= 0 && /\s/.test(text[pos])) {
            pos--;
        }
        
        const keywordEnd = pos + 1;
        while (pos >= 0 && /[a-zA-Z]/.test(text[pos])) {
            pos--;
        }
        
        const keyword = text.substring(pos + 1, keywordEnd);
        
        if (keyword === 'scatter') {
            return { variable };
        }
        
        return null;
    }

    /**
     * Match conditional pattern: if (condition) or else
     */
    private matchConditionalPattern(text: string, endPos: number): { type: string } | null {
        // Check for else keyword
        if (text[endPos] === 'e') {
            let pos = endPos;
            while (pos >= 0 && /[a-zA-Z]/.test(text[pos])) {
                pos--;
            }
            const keyword = text.substring(pos + 1, endPos + 1);
            if (keyword === 'else') {
                return { type: 'else' };
            }
        }
        
        // Check for if (condition) pattern
        if (text[endPos] === ')') {
            // Find matching opening parenthesis
            let pos = endPos - 1;
            let parenDepth = 1;
            
            while (pos >= 0 && parenDepth > 0) {
                if (text[pos] === ')') {
                    parenDepth++;
                } else if (text[pos] === '(') {
                    parenDepth--;
                }
                pos--;
            }
            
            if (parenDepth !== 0) return null;
            
            const openParenPos = pos + 1;
            
            // Look backwards from opening parenthesis for "if" keyword
            pos = openParenPos - 1;
            while (pos >= 0 && /\s/.test(text[pos])) {
                pos--;
            }
            
            const keywordEnd = pos + 1;
            while (pos >= 0 && /[a-zA-Z]/.test(text[pos])) {
                pos--;
            }
            
            const keyword = text.substring(pos + 1, keywordEnd);
            
            if (keyword === 'if') {
                return { type: 'if' };
            }
        }
        
        return null;
    }

    /**
     * Match call pattern: call TaskName
     */
    private matchCallPattern(text: string, endPos: number): { type: string } | null {
        // This is already handled by existing parseCallStatement method
        // We can reuse that logic here
        const callInfo = this.parseCallStatement(text, endPos + 1);
        return callInfo ? { type: 'call' } : null;
    }

    /**
     * Match workflow/task pattern
     */
    private matchWorkflowTaskPattern(text: string, endPos: number): { type: string } | null {
        // Look backwards for workflow or task keyword followed by name
        let pos = endPos;
        
        // Skip potential name
        while (pos >= 0 && /[a-zA-Z0-9_]/.test(text[pos])) {
            pos--;
        }
        
        // Skip whitespace
        while (pos >= 0 && /\s/.test(text[pos])) {
            pos--;
        }
        
        // Look for keyword
        const keywordEnd = pos + 1;
        while (pos >= 0 && /[a-zA-Z]/.test(text[pos])) {
            pos--;
        }
        
        const keyword = text.substring(pos + 1, keywordEnd);
        
        if (keyword === 'workflow' || keyword === 'task') {
            return { type: keyword };
        }
        
        return null;
    }

    /**
     * Check for nested expressions (complex expressions with multiple levels)
     */
    private hasNestedExpressions(text: string, offset: number): boolean {
        // Look for patterns that indicate nested expressions
        const beforeCursor = this.getTextBefore(text, offset, 100);
        
        // Patterns that indicate nested expressions
        const nestedPatterns = [
            /\(\s*[^)]*\([^)]*\)/,  // Nested parentheses
            /\[\s*[^\]]*\[[^\]]*\]/, // Nested brackets
            /select_first\s*\(\s*\[/, // select_first with array
            /if\s*\([^)]*\?\s*[^:]*:/, // Ternary operator
            /\w+\.\w+\.\w+/, // Chained property access
        ];
        
        return nestedPatterns.some(pattern => pattern.test(beforeCursor));
    }

    /**
     * Detect already used input parameters in a call statement
     */
    detectUsedInputs(text: string, callInfo: ParsedCallStatement): string[] {
        return callInfo.inputs.map(input => input.name);
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
     * Enhanced task output reference detection
     */
    isTaskOutputReference(text: string, offset: number): TaskOutputContext | null {
        // Look for pattern: TaskName. or TaskName.output
        let pos = offset;
        
        // If we're at a dot, start from there
        if (pos < text.length && text[pos] === '.') {
            // We're at the dot position
        } else {
            // Look backwards for a dot
            pos = offset - 1;
            while (pos >= 0 && /\s/.test(text[pos])) {
                pos--;
            }
            
            if (pos < 0 || text[pos] !== '.') {
                // Check if we're in the middle of typing after a dot
                const beforeCursor = this.getTextBefore(text, offset, 50);
                const dotMatch = beforeCursor.match(/(\w+(?:\.\w+)*)\.\s*(\w*)$/);
                if (dotMatch) {
                    const taskName = dotMatch[1];
                    const dotIndex = beforeCursor.lastIndexOf('.');
                    const dotPos = offset - (beforeCursor.length - dotIndex);
                    
                    if (this.isValidTaskOutputContext(text, dotPos)) {
                        return {
                            taskName,
                            resolvedTaskName: taskName,
                            dotPosition: this.positionFromOffset(text, dotPos),
                            isComplete: dotMatch[2].length > 0
                        };
                    }
                }
                return null;
            }
        }
        
        const dotPos = pos;
        const taskName = this.getWordBefore(text, pos);
        
        if (!taskName) {
            return null;
        }
        
        // Enhanced validation for task output context
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
     * Analyze task output context (TaskName.output) - legacy method for compatibility
     */
    private analyzeTaskOutputContextLegacy(text: string, offset: number, position: Position): CompletionContext {
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
     * Enhanced call statement finding with better nested structure handling
     */
    private findEnclosingCallStatement(text: string, offset: number): ParsedCallStatement | null {
        let pos = offset;
        let braceDepth = 0;
        let inString = false;
        let stringChar = '';
        
        // First, find the current brace context
        while (pos >= 0) {
            const char = text[pos];
            
            // Handle string literals
            if ((char === '"' || char === "'") && (pos === 0 || text[pos - 1] !== '\\')) {
                if (!inString) {
                    inString = true;
                    stringChar = char;
                } else if (char === stringChar) {
                    inString = false;
                    stringChar = '';
                }
            }
            
            if (!inString) {
                if (char === '}') {
                    braceDepth++;
                } else if (char === '{') {
                    if (braceDepth === 0) {
                        // Found potential call statement opening brace
                        const callInfo = this.parseCallStatement(text, pos);
                        if (callInfo) {
                            // Verify that current position is within this call statement
                            const callEnd = this.findMatchingCloseBrace(text, pos);
                            if (callEnd >= offset) {
                                return callInfo;
                            }
                        }
                    } else {
                        braceDepth--;
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
     * Enhanced call statement parsing with better alias support
     */
    private parseCallStatement(text: string, bracePos: number): ParsedCallStatement | null {
        // Look backwards from brace to find "call TaskName" or "call alias.TaskName"
        let pos = bracePos - 1;
        
        // Skip whitespace
        while (pos >= 0 && /\s/.test(text[pos])) {
            pos--;
        }
        
        if (pos < 0) return null;
        
        // Extract task name (including potential alias)
        let nameEnd = pos + 1;
        while (pos >= 0 && /[a-zA-Z0-9_.]/.test(text[pos])) {
            pos--;
        }
        
        const taskName = text.substring(pos + 1, nameEnd);
        if (!taskName) return null;
        
        // Validate task name format
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(taskName)) {
            return null;
        }
        
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
            // Check for optional alias after task name
            let alias: string | undefined;
            const afterTaskName = text.substring(bracePos).match(/^\s*as\s+(\w+)/);
            if (afterTaskName) {
                alias = afterTaskName[1];
            }
            
            // Parse the call statement content
            const callInfo = this.parseCallStatementContent(text, bracePos, taskName);
            if (callInfo && alias) {
                callInfo.alias = alias;
            }
            return callInfo;
        }
        
        return null;
    }
    

    
    /**
     * Enhanced validation for task output context
     */
    private isValidTaskOutputContext(text: string, dotPos: number): boolean {
        // Check if we're in a valid context for task output reference
        // (not in a string literal, comment, etc.)
        
        // Check if we're in quotes
        const beforeDot = text.substring(0, dotPos);
        const quoteCount = (beforeDot.match(/"/g) || []).length;
        if (quoteCount % 2 !== 0) {
            return false; // We're inside a string literal
        }
        
        // Check if we're in a comment
        const lineStart = beforeDot.lastIndexOf('\n') + 1;
        const currentLine = text.substring(lineStart, dotPos + 50);
        if (currentLine.includes('#')) {
            const commentPos = currentLine.indexOf('#');
            const dotPosInLine = dotPos - lineStart;
            if (commentPos < dotPosInLine) {
                return false; // We're in a comment
            }
        }
        
        // Check if this looks like a valid task reference context
        // Should be in an expression context, not in a declaration
        const contextBefore = this.getTextBefore(text, dotPos, 100);
        
        // Invalid contexts: inside task/workflow declarations
        if (/\b(task|workflow)\s+\w+\s*{[^}]*$/.test(contextBefore)) {
            return false;
        }
        
        // Valid contexts: assignments, function calls, expressions
        const validContextPatterns = [
            /\w+\s*=\s*[^=]*$/, // Assignment
            /\(\s*[^)]*$/, // Function call parameter
            /,\s*[^,]*$/, // List/array element
            /\[\s*[^\]]*$/, // Array index
            /\{\s*[^}]*$/, // Object/map value
            /\+\s*[^+]*$/, // Concatenation
            /if\s*\(\s*[^)]*$/, // Conditional
            /select_first\s*\(\s*\[[^\]]*$/ // select_first array
        ];
        
        return validContextPatterns.some(pattern => pattern.test(contextBefore));
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
     * Enhanced word extraction that handles aliased task names
     */
    private getWordBefore(text: string, pos: number): string | undefined {
        let end = pos;
        
        // Skip whitespace
        while (end > 0 && /\s/.test(text[end - 1])) {
            end--;
        }
        
        let start = end;
        // Include dots for aliased names (e.g., "utils.ValidateFile")
        while (start > 0 && /[a-zA-Z0-9_.]/.test(text[start - 1])) {
            start--;
        }
        
        if (start < end) {
            const word = text.substring(start, end);
            
            // Validate that it's a proper task name pattern
            // Should be either "TaskName" or "alias.TaskName"
            if (/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(word)) {
                return word;
            }
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
     * Check if task name has alias prefix
     */
    private hasAliasPrefix(taskName: string): boolean {
        return taskName.includes('.');
    }

    /**
     * Extract alias from task name
     */
    private extractAlias(taskName: string): string | undefined {
        if (taskName.includes('.')) {
            const parts = taskName.split('.');
            return parts[0];
        }
        return undefined;
    }

    /**
     * Enhanced call statement parsing with better input detection
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
        
        // Look for input block with enhanced detection
        const inputMatch = callContent.match(/input\s*:\s*/);
        if (inputMatch && inputMatch.index !== undefined) {
            const inputKeywordStart = braceStart + 1 + inputMatch.index;
            const inputStart = braceStart + 1 + inputMatch.index + inputMatch[0].length;
            
            // Find the end of input block (either next section or end of call)
            let inputEnd = closingBrace;
            const outputMatch = callContent.substring(inputMatch.index + inputMatch[0].length).match(/\b(output|runtime|meta|parameter_meta)\s*:/);
            if (outputMatch && outputMatch.index !== undefined) {
                inputEnd = inputStart + outputMatch.index;
            }
            
            result.inputBlockRange = {
                start: this.positionFromOffset(text, inputKeywordStart),
                end: this.positionFromOffset(text, inputEnd)
            };
            
            // Parse individual inputs with enhanced detection
            result.inputs = this.parseInputStatements(text, inputStart, inputEnd);
        }
        
        return result;
    }

    /**
     * Enhanced input statement parsing
     */
    private parseInputStatements(text: string, start: number, end: number): Array<{name: string, valueRange?: {start: Position, end: Position}}> {
        const inputs: Array<{name: string, valueRange?: {start: Position, end: Position}}> = [];
        const inputText = text.substring(start, end);
        
        // Enhanced regex to handle various input patterns including multiline
        const inputRegex = /(\w+)\s*=\s*([^,\n}]+(?:\n[^,\n}]*)*?)(?=\s*,|\s*\n\s*\w+\s*=|\s*$|\s*})/g;
        let match;
        
        while ((match = inputRegex.exec(inputText)) !== null) {
            const name = match[1];
            const valueStart = start + match.index! + match[0].indexOf('=') + 1;
            
            // Skip whitespace after =
            let actualValueStart = valueStart;
            while (actualValueStart < start + end && /\s/.test(text[actualValueStart])) {
                actualValueStart++;
            }
            
            const valueEnd = start + match.index! + match[0].length;
            
            inputs.push({
                name,
                valueRange: {
                    start: this.positionFromOffset(text, actualValueStart),
                    end: this.positionFromOffset(text, valueEnd)
                }
            });
        }
        
        return inputs;
    }

    /**
     * Enhanced current input name detection
     */
    private getCurrentInputName(text: string, offset: number, callInfo: ParsedCallStatement): string | undefined {
        // First check if we're in an existing input's value range
        for (const input of callInfo.inputs) {
            if (input.valueRange) {
                const startOffset = this.offsetFromPosition(text, input.valueRange.start);
                const endOffset = this.offsetFromPosition(text, input.valueRange.end);
                
                if (offset >= startOffset && offset <= endOffset) {
                    return input.name;
                }
            }
        }
        
        // Check if we're starting a new input parameter
        const beforeCursor = this.getTextBefore(text, offset, 100);
        
        // Look for input parameter pattern: word followed by optional whitespace and =
        const inputMatch = beforeCursor.match(/(\w+)\s*=?\s*$/);
        if (inputMatch) {
            const potentialInputName = inputMatch[1];
            
            // Make sure this isn't already a used input
            const isAlreadyUsed = callInfo.inputs.some(input => input.name === potentialInputName);
            if (!isAlreadyUsed) {
                return potentialInputName;
            }
        }
        
        return undefined;
    }

    /**
     * Enhanced input value detection
     */
    private isInInputValue(text: string, offset: number, callInfo: ParsedCallStatement): boolean {
        // Check if we're in any input's value range
        for (const input of callInfo.inputs) {
            if (input.valueRange) {
                const startOffset = this.offsetFromPosition(text, input.valueRange.start);
                const endOffset = this.offsetFromPosition(text, input.valueRange.end);
                
                if (offset >= startOffset && offset <= endOffset) {
                    return true;
                }
            }
        }
        
        // Check if we're immediately after an = sign
        const beforeCursor = this.getTextBefore(text, offset, 20);
        return /=\s*$/.test(beforeCursor);
    }
}