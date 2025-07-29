import { DocumentAnalyzer, DocumentInfo } from './documentAnalyzer';
import { TaskInfo, ParameterInfo } from './taskAnalyzer';
import * as AST from './ast';

export interface TaskSymbol {
    name: string;
    inputs: ParameterInfo[];
    outputs: ParameterInfo[];
    description?: string;
    sourceFile: string;
    range: AST.Range;
    qualifiedName?: string; // For imported tasks with alias
}

export interface WorkflowSymbol {
    name: string;
    inputs: ParameterInfo[];
    outputs: ParameterInfo[];
    sourceFile: string;
    range: AST.Range;
}

export interface SymbolTable {
    tasks: Map<string, TaskSymbol>;
    workflows: Map<string, WorkflowSymbol>;
    lastModified: Map<string, number>;
}

export class SymbolProvider {
    private documentAnalyzer: DocumentAnalyzer;
    private symbolTable: SymbolTable;
    
    constructor() {
        this.documentAnalyzer = new DocumentAnalyzer();
        this.symbolTable = {
            tasks: new Map(),
            workflows: new Map(),
            lastModified: new Map()
        };
    }
    
    /**
     * Update symbols for a document
     */
    async updateDocument(content: string, uri: string): Promise<void> {
        const docInfo = this.documentAnalyzer.analyzeDocument(content, uri);
        
        // Remove old symbols from this document
        this.removeDocumentSymbols(uri);
        
        // Add new symbols
        await this.addDocumentSymbols(docInfo);
        
        // Update last modified time
        this.symbolTable.lastModified.set(uri, Date.now());
    }
    
    /**
     * Remove document from symbol table
     */
    removeDocument(uri: string): void {
        this.removeDocumentSymbols(uri);
        this.symbolTable.lastModified.delete(uri);
        this.documentAnalyzer.clearCache(uri);
    }
    
    /**
     * Get task symbol by name
     */
    getTaskSymbol(taskName: string, contextUri?: string): TaskSymbol | undefined {
        // First try exact match
        let symbol = this.symbolTable.tasks.get(taskName);
        if (symbol) {
            return symbol;
        }
        
        // If we have context, try to resolve with imports
        if (contextUri) {
            const docInfo = this.documentAnalyzer.getCachedDocument(contextUri);
            if (docInfo) {
                return this.resolveTaskInContext(taskName, docInfo);
            }
        }
        
        // Try partial matches (for qualified names)
        for (const [key, value] of this.symbolTable.tasks) {
            if (key.endsWith(`.${taskName}`) || value.qualifiedName === taskName) {
                return value;
            }
        }
        
        return undefined;
    }
    
    /**
     * Get all task symbols
     */
    getAllTaskSymbols(): TaskSymbol[] {
        return Array.from(this.symbolTable.tasks.values());
    }
    
    /**
     * Get task symbols available in a specific document context
     */
    getTaskSymbolsInContext(uri: string): TaskSymbol[] {
        const docInfo = this.documentAnalyzer.getCachedDocument(uri);
        if (!docInfo) {
            return [];
        }
        
        const symbols: TaskSymbol[] = [];
        
        // Add local tasks
        for (const task of docInfo.tasks) {
            const symbol = this.taskInfoToSymbol(task);
            symbols.push(symbol);
        }
        
        // Add imported tasks
        for (const importInfo of docInfo.imports) {
            if (importInfo.tasks) {
                for (const task of importInfo.tasks) {
                    const symbol = this.taskInfoToSymbol(task);
                    if (importInfo.alias) {
                        symbol.qualifiedName = `${importInfo.alias}.${task.name}`;
                    }
                    symbols.push(symbol);
                }
            }
        }
        
        return symbols;
    }
    
    /**
     * Get workflow symbol by name
     */
    getWorkflowSymbol(workflowName: string): WorkflowSymbol | undefined {
        return this.symbolTable.workflows.get(workflowName);
    }
    
    /**
     * Get all workflow symbols
     */
    getAllWorkflowSymbols(): WorkflowSymbol[] {
        return Array.from(this.symbolTable.workflows.values());
    }
    
    /**
     * Find symbols by prefix (for autocomplete)
     */
    findTaskSymbolsByPrefix(prefix: string, contextUri?: string): TaskSymbol[] {
        const symbols: TaskSymbol[] = [];
        
        if (contextUri) {
            // Get context-specific symbols first
            const contextSymbols = this.getTaskSymbolsInContext(contextUri);
            for (const symbol of contextSymbols) {
                if (symbol.name.startsWith(prefix) || 
                    (symbol.qualifiedName && symbol.qualifiedName.startsWith(prefix))) {
                    symbols.push(symbol);
                }
            }
        } else {
            // Search all symbols
            for (const symbol of this.symbolTable.tasks.values()) {
                if (symbol.name.startsWith(prefix) || 
                    (symbol.qualifiedName && symbol.qualifiedName.startsWith(prefix))) {
                    symbols.push(symbol);
                }
            }
        }
        
        return symbols;
    }
    
    /**
     * Get symbol at a specific position
     */
    getSymbolAtPosition(uri: string, line: number, column: number): TaskSymbol | WorkflowSymbol | undefined {
        // Check tasks
        for (const symbol of this.symbolTable.tasks.values()) {
            if (symbol.sourceFile === uri && this.isPositionInRange(line, column, symbol.range)) {
                return symbol;
            }
        }
        
        // Check workflows
        for (const symbol of this.symbolTable.workflows.values()) {
            if (symbol.sourceFile === uri && this.isPositionInRange(line, column, symbol.range)) {
                return symbol;
            }
        }
        
        return undefined;
    }
    
    /**
     * Validate that a task exists and is accessible
     */
    validateTaskReference(taskName: string, contextUri: string): boolean {
        return this.getTaskSymbol(taskName, contextUri) !== undefined;
    }
    
    /**
     * Get input parameter names for a task
     */
    getTaskInputNames(taskName: string, contextUri?: string): string[] {
        const symbol = this.getTaskSymbol(taskName, contextUri);
        return symbol ? symbol.inputs.map(input => input.name) : [];
    }
    
    /**
     * Get output parameter names for a task
     */
    getTaskOutputNames(taskName: string, contextUri?: string): string[] {
        const symbol = this.getTaskSymbol(taskName, contextUri);
        return symbol ? symbol.outputs.map(output => output.name) : [];
    }
    
    /**
     * Get parameter info for a specific input
     */
    getTaskInputParameter(taskName: string, paramName: string, contextUri?: string): ParameterInfo | undefined {
        const symbol = this.getTaskSymbol(taskName, contextUri);
        if (!symbol) return undefined;
        
        return symbol.inputs.find(input => input.name === paramName);
    }
    
    /**
     * Get parameter info for a specific output
     */
    getTaskOutputParameter(taskName: string, paramName: string, contextUri?: string): ParameterInfo | undefined {
        const symbol = this.getTaskSymbol(taskName, contextUri);
        if (!symbol) return undefined;
        
        return symbol.outputs.find(output => output.name === paramName);
    }
    
    /**
     * Clear all symbols
     */
    clearAll(): void {
        this.symbolTable.tasks.clear();
        this.symbolTable.workflows.clear();
        this.symbolTable.lastModified.clear();
        this.documentAnalyzer.clearCache();
    }
    
    /**
     * Get statistics about the symbol table
     */
    getStatistics(): {taskCount: number, workflowCount: number, documentCount: number} {
        return {
            taskCount: this.symbolTable.tasks.size,
            workflowCount: this.symbolTable.workflows.size,
            documentCount: this.symbolTable.lastModified.size
        };
    }
    
    // Private helper methods
    
    private async addDocumentSymbols(docInfo: DocumentInfo): Promise<void> {
        // Add task symbols
        for (const task of docInfo.tasks) {
            const symbol = this.taskInfoToSymbol(task);
            this.symbolTable.tasks.set(this.getTaskKey(task.name, docInfo.uri), symbol);
        }
        
        // Add workflow symbols (placeholder implementation)
        for (const workflow of docInfo.workflows) {
            const symbol: WorkflowSymbol = {
                name: workflow.name,
                inputs: [], // TODO: Implement workflow input analysis
                outputs: [], // TODO: Implement workflow output analysis
                sourceFile: docInfo.uri,
                range: workflow.range
            };
            this.symbolTable.workflows.set(this.getWorkflowKey(workflow.name, docInfo.uri), symbol);
        }
        
        // Process imports and add imported symbols
        for (const importInfo of docInfo.imports) {
            if (importInfo.tasks) {
                for (const task of importInfo.tasks) {
                    const symbol = this.taskInfoToSymbol(task);
                    if (importInfo.alias) {
                        symbol.qualifiedName = `${importInfo.alias}.${task.name}`;
                        this.symbolTable.tasks.set(
                            this.getTaskKey(`${importInfo.alias}.${task.name}`, docInfo.uri),
                            symbol
                        );
                    } else {
                        this.symbolTable.tasks.set(
                            this.getTaskKey(task.name, docInfo.uri),
                            symbol
                        );
                    }
                }
            }
        }
    }
    
    private removeDocumentSymbols(uri: string): void {
        // Remove tasks from this document
        const tasksToRemove: string[] = [];
        for (const [key, symbol] of this.symbolTable.tasks) {
            if (symbol.sourceFile === uri) {
                tasksToRemove.push(key);
            }
        }
        for (const key of tasksToRemove) {
            this.symbolTable.tasks.delete(key);
        }
        
        // Remove workflows from this document
        const workflowsToRemove: string[] = [];
        for (const [key, symbol] of this.symbolTable.workflows) {
            if (symbol.sourceFile === uri) {
                workflowsToRemove.push(key);
            }
        }
        for (const key of workflowsToRemove) {
            this.symbolTable.workflows.delete(key);
        }
    }
    
    private taskInfoToSymbol(task: TaskInfo): TaskSymbol {
        return {
            name: task.name,
            inputs: task.inputs,
            outputs: task.outputs,
            description: task.description,
            sourceFile: task.sourceFile,
            range: task.range
        };
    }
    
    private resolveTaskInContext(taskName: string, docInfo: DocumentInfo): TaskSymbol | undefined {
        // Check local tasks first
        for (const task of docInfo.tasks) {
            if (task.name === taskName) {
                return this.taskInfoToSymbol(task);
            }
        }
        
        // Check imported tasks
        for (const importInfo of docInfo.imports) {
            if (importInfo.tasks) {
                for (const task of importInfo.tasks) {
                    if (task.name === taskName) {
                        const symbol = this.taskInfoToSymbol(task);
                        if (importInfo.alias) {
                            symbol.qualifiedName = `${importInfo.alias}.${task.name}`;
                        }
                        return symbol;
                    }
                }
            }
        }
        
        return undefined;
    }
    
    private getTaskKey(taskName: string, uri: string): string {
        return `${uri}#${taskName}`;
    }
    
    private getWorkflowKey(workflowName: string, uri: string): string {
        return `${uri}#${workflowName}`;
    }
    
    private isPositionInRange(line: number, column: number, range: AST.Range): boolean {
        if (line < range.start.line || line > range.end.line) {
            return false;
        }
        
        if (line === range.start.line && column < range.start.column) {
            return false;
        }
        
        if (line === range.end.line && column > range.end.column) {
            return false;
        }
        
        return true;
    }
}