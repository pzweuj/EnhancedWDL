import * as AST from './ast';
import { WDLParser } from './parser';
import { TaskAnalyzer, TaskInfo } from './taskAnalyzer';
import * as path from 'path';
import * as fs from 'fs';

export interface DocumentInfo {
    uri: string;
    version?: string;
    imports: ImportInfo[];
    tasks: TaskInfo[];
    workflows: WorkflowInfo[];
    structs: StructInfo[];
}

export interface ImportInfo {
    path: string;
    alias?: string;
    resolvedPath?: string;
    tasks?: TaskInfo[];
}

export interface WorkflowInfo {
    name: string;
    inputs: any[];
    outputs: any[];
    range: AST.Range;
}

export interface StructInfo {
    name: string;
    members: any[];
    range: AST.Range;
}

export class DocumentAnalyzer {
    private taskAnalyzer: TaskAnalyzer;
    private documentCache: Map<string, DocumentInfo> = new Map();
    
    constructor() {
        this.taskAnalyzer = new TaskAnalyzer();
    }
    
    /**
     * Analyze a WDL document and extract all relevant information
     */
    analyzeDocument(content: string, uri: string): DocumentInfo {
        try {
            const parser = new WDLParser(content);
            const ast = parser.parse();
            
            const docInfo: DocumentInfo = {
                uri,
                version: ast.version?.version,
                imports: [],
                tasks: [],
                workflows: [],
                structs: []
            };
            
            // Analyze imports
            for (const importDecl of ast.imports) {
                docInfo.imports.push(this.analyzeImport(importDecl, uri));
            }
            
            // Analyze tasks
            for (const task of ast.tasks) {
                docInfo.tasks.push(this.taskAnalyzer.analyzeTask(task, uri));
            }
            
            // Analyze workflows
            for (const workflow of ast.workflows) {
                docInfo.workflows.push(this.analyzeWorkflow(workflow));
            }
            
            // Analyze structs
            for (const struct of ast.structs) {
                docInfo.structs.push(this.analyzeStruct(struct));
            }
            
            // Cache the document info
            this.documentCache.set(uri, docInfo);
            
            return docInfo;
        } catch (error) {
            // Return empty document info on parse error
            const docInfo: DocumentInfo = {
                uri,
                imports: [],
                tasks: [],
                workflows: [],
                structs: []
            };
            
            this.documentCache.set(uri, docInfo);
            return docInfo;
        }
    }
    
    /**
     * Get cached document info
     */
    getCachedDocument(uri: string): DocumentInfo | undefined {
        return this.documentCache.get(uri);
    }
    
    /**
     * Clear document cache
     */
    clearCache(uri?: string): void {
        if (uri) {
            this.documentCache.delete(uri);
        } else {
            this.documentCache.clear();
        }
    }
    
    /**
     * Find all tasks available in a document (including imported tasks)
     */
    async getAllAvailableTasks(docInfo: DocumentInfo): Promise<TaskInfo[]> {
        const allTasks: TaskInfo[] = [...docInfo.tasks];
        
        // Add tasks from imports
        for (const importInfo of docInfo.imports) {
            if (importInfo.tasks) {
                allTasks.push(...importInfo.tasks);
            } else {
                // Try to resolve import and get tasks
                const importedTasks = await this.resolveImportTasks(importInfo, docInfo.uri);
                allTasks.push(...importedTasks);
            }
        }
        
        return allTasks;
    }
    
    /**
     * Find a specific task by name
     */
    async findTask(taskName: string, docInfo: DocumentInfo): Promise<TaskInfo | undefined> {
        // First check local tasks
        for (const task of docInfo.tasks) {
            if (task.name === taskName) {
                return task;
            }
        }
        
        // Then check imported tasks
        for (const importInfo of docInfo.imports) {
            const qualifiedName = importInfo.alias ? `${importInfo.alias}.${taskName}` : taskName;
            
            if (importInfo.tasks) {
                for (const task of importInfo.tasks) {
                    if (task.name === taskName || task.name === qualifiedName) {
                        return task;
                    }
                }
            } else {
                // Try to resolve import and find task
                const importedTasks = await this.resolveImportTasks(importInfo, docInfo.uri);
                for (const task of importedTasks) {
                    if (task.name === taskName) {
                        return task;
                    }
                }
            }
        }
        
        return undefined;
    }
    
    /**
     * Analyze an import declaration
     */
    private analyzeImport(importDecl: AST.ImportDeclaration, baseUri: string): ImportInfo {
        const importInfo: ImportInfo = {
            path: importDecl.path,
            alias: importDecl.alias
        };
        
        // Try to resolve the import path
        try {
            const basePath = path.dirname(baseUri);
            const resolvedPath = path.resolve(basePath, importDecl.path);
            importInfo.resolvedPath = resolvedPath;
        } catch (error) {
            // Path resolution failed
        }
        
        return importInfo;
    }
    
    /**
     * Analyze a workflow declaration
     */
    private analyzeWorkflow(workflow: AST.WorkflowDeclaration): WorkflowInfo {
        return {
            name: workflow.name,
            inputs: [], // TODO: Implement workflow input analysis
            outputs: [], // TODO: Implement workflow output analysis
            range: workflow.range
        };
    }
    
    /**
     * Analyze a struct declaration
     */
    private analyzeStruct(struct: AST.StructDeclaration): StructInfo {
        return {
            name: struct.name,
            members: [], // TODO: Implement struct member analysis
            range: struct.range
        };
    }
    
    /**
     * Resolve tasks from an imported file
     */
    private async resolveImportTasks(importInfo: ImportInfo, baseUri: string): Promise<TaskInfo[]> {
        if (!importInfo.resolvedPath) {
            return [];
        }
        
        try {
            // Check if we already have this document cached
            const cachedDoc = this.documentCache.get(importInfo.resolvedPath);
            if (cachedDoc) {
                return cachedDoc.tasks;
            }
            
            // Try to read and parse the imported file
            if (fs.existsSync(importInfo.resolvedPath)) {
                const content = fs.readFileSync(importInfo.resolvedPath, 'utf-8');
                const importedDoc = this.analyzeDocument(content, importInfo.resolvedPath);
                importInfo.tasks = importedDoc.tasks;
                return importedDoc.tasks;
            }
        } catch (error) {
            // Failed to read or parse imported file
        }
        
        return [];
    }
    
    /**
     * Get task completion items for a specific context
     */
    getTaskCompletionItems(docInfo: DocumentInfo): Array<{name: string, task: TaskInfo}> {
        const items: Array<{name: string, task: TaskInfo}> = [];
        
        // Add local tasks
        for (const task of docInfo.tasks) {
            items.push({ name: task.name, task });
        }
        
        // Add imported tasks
        for (const importInfo of docInfo.imports) {
            if (importInfo.tasks) {
                for (const task of importInfo.tasks) {
                    const name = importInfo.alias ? `${importInfo.alias}.${task.name}` : task.name;
                    items.push({ name, task });
                }
            }
        }
        
        return items;
    }
    
    /**
     * Get input parameter completion items for a specific task
     */
    getInputCompletionItems(task: TaskInfo): Array<{name: string, parameter: any}> {
        return task.inputs.map(input => ({
            name: input.name,
            parameter: input
        }));
    }
    
    /**
     * Get output parameter completion items for a specific task
     */
    getOutputCompletionItems(task: TaskInfo): Array<{name: string, parameter: any}> {
        return task.outputs.map(output => ({
            name: output.name,
            parameter: output
        }));
    }
    
    /**
     * Validate a task call
     */
    validateTaskCall(taskName: string, providedInputs: string[], docInfo: DocumentInfo): Promise<string[]> {
        return this.findTask(taskName, docInfo).then(task => {
            if (!task) {
                return [`Task '${taskName}' not found`];
            }
            
            const errors: string[] = [];
            
            // Check required parameters
            errors.push(...this.taskAnalyzer.validateRequiredParameters(task, providedInputs));
            
            // Check unknown parameters
            errors.push(...this.taskAnalyzer.validateProvidedParameters(task, providedInputs));
            
            return errors;
        });
    }
}