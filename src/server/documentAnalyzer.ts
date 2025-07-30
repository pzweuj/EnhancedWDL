import * as AST from './ast';
import { WDLParser } from './parser';
import { TaskAnalyzer, TaskInfo } from './taskAnalyzer';
import { ImportResolver } from './importResolver';
import * as path from 'path';

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
    errors?: string[];
    lastModified?: number;
    dependencies?: string[];
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
    private importResolver: ImportResolver;
    private documentCache: Map<string, DocumentInfo> = new Map();
    
    constructor() {
        this.taskAnalyzer = new TaskAnalyzer();
        this.importResolver = new ImportResolver();
    }
    
    /**
     * Analyze a WDL document and extract all relevant information
     */
    async analyzeDocument(content: string, uri: string): Promise<DocumentInfo> {
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
            
            // Analyze imports asynchronously
            for (const importDecl of ast.imports) {
                const importInfo = await this.analyzeImport(importDecl, uri);
                docInfo.imports.push(importInfo);
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
            // Also notify ImportResolver about the change
            this.importResolver.handleImportFileChange(uri);
        } else {
            this.documentCache.clear();
            this.importResolver.clearCache();
        }
    }
    
    /**
     * Get ImportResolver instance for external use
     */
    getImportResolver(): ImportResolver {
        return this.importResolver;
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
     * Analyze an import declaration using ImportResolver
     */
    private async analyzeImport(importDecl: AST.ImportDeclaration, baseUri: string): Promise<ImportInfo> {
        const importInfo: ImportInfo = {
            path: importDecl.path,
            alias: importDecl.alias
        };
        
        try {
            // Use ImportResolver to resolve the import
            const result = await this.importResolver.resolveImport(
                importDecl.path, 
                baseUri, 
                importDecl.alias
            );
            
            if (result.success) {
                importInfo.tasks = result.tasks;
                importInfo.dependencies = result.dependencies;
                importInfo.lastModified = result.lastModified;
                if (result.dependencies.length > 0) {
                    importInfo.resolvedPath = result.dependencies[0]; // First dependency is the main file
                }
            }
            
            if (result.errors.length > 0) {
                importInfo.errors = result.errors;
            }
        } catch (error) {
            importInfo.errors = [`Failed to resolve import: ${error}`];
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
     * Resolve tasks from an imported file using cached results
     */
    private async resolveImportTasks(importInfo: ImportInfo, baseUri: string): Promise<TaskInfo[]> {
        // If we already have tasks from the import resolution, return them
        if (importInfo.tasks && importInfo.tasks.length > 0) {
            return importInfo.tasks;
        }
        
        // Otherwise, try to resolve using ImportResolver
        try {
            const result = await this.importResolver.resolveImport(
                importInfo.path, 
                baseUri, 
                importInfo.alias
            );
            
            if (result.success) {
                importInfo.tasks = result.tasks;
                return result.tasks;
            }
        } catch (error) {
            // Failed to resolve import
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