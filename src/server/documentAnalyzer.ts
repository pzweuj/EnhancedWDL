import * as AST from './ast';
import { WDLParser } from './parser';
import { TaskAnalyzer, TaskInfo } from './taskAnalyzer';
import { ImportResolver, ImportResult } from './importResolver';
import * as path from 'path';

export interface DocumentInfo {
    uri: string;
    version?: string;
    imports: ImportInfo[];
    tasks: TaskInfo[];
    workflows: WorkflowInfo[];
    structs: StructInfo[];
    importErrors: ImportError[];
    dependencyGraph: DependencyGraph;
}

export interface ImportInfo {
    path: string;
    alias?: string;
    resolvedPath?: string;
    tasks?: TaskInfo[];
    errors?: string[];
    lastModified?: number;
    dependencies?: string[];
    isResolved: boolean;
    circularDependency?: boolean;
}

export interface ImportError {
    importPath: string;
    error: string;
    severity: 'error' | 'warning';
    range?: AST.Range;
}

export interface DependencyGraph {
    nodes: Map<string, DependencyNode>;
    edges: Map<string, string[]>;
    circularDependencies: string[][];
}

export interface DependencyNode {
    uri: string;
    imports: string[];
    lastModified: number;
    resolved: boolean;
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
    private readonly MAX_IMPORT_DEPTH = 10;
    
    constructor() {
        this.taskAnalyzer = new TaskAnalyzer();
        this.importResolver = new ImportResolver();
    }
    
    /**
     * Analyze a WDL document and extract all relevant information
     * Enhanced with async import processing and dependency graph building
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
                structs: [],
                importErrors: [],
                dependencyGraph: {
                    nodes: new Map(),
                    edges: new Map(),
                    circularDependencies: []
                }
            };
            
            // Initialize dependency graph node for this document
            docInfo.dependencyGraph.nodes.set(uri, {
                uri,
                imports: ast.imports.map(imp => imp.path),
                lastModified: Date.now(),
                resolved: false
            });
            
            // Analyze imports asynchronously with enhanced error handling
            const importPromises = ast.imports.map(importDecl => 
                this.analyzeImportWithErrorHandling(importDecl, uri, docInfo)
            );
            
            const importResults = await Promise.allSettled(importPromises);
            
            // Process import results and collect errors
            importResults.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    docInfo.imports.push(result.value);
                } else {
                    const importDecl = ast.imports[index];
                    docInfo.importErrors.push({
                        importPath: importDecl.path,
                        error: `Failed to analyze import: ${result.reason}`,
                        severity: 'error',
                        range: importDecl.range
                    });
                    
                    // Still add a basic import info for partial functionality
                    docInfo.imports.push({
                        path: importDecl.path,
                        alias: importDecl.alias,
                        isResolved: false,
                        errors: [result.reason?.toString() || 'Unknown error']
                    });
                }
            });
            
            // Build dependency graph and detect circular dependencies
            await this.buildDependencyGraph(docInfo);
            
            // Analyze tasks
            for (const task of ast.tasks) {
                try {
                    docInfo.tasks.push(this.taskAnalyzer.analyzeTask(task, uri));
                } catch (error) {
                    // Log task analysis error but continue
                    console.warn(`Failed to analyze task ${task.name} in ${uri}:`, error);
                }
            }
            
            // Analyze workflows
            for (const workflow of ast.workflows) {
                try {
                    docInfo.workflows.push(this.analyzeWorkflow(workflow));
                } catch (error) {
                    console.warn(`Failed to analyze workflow ${workflow.name} in ${uri}:`, error);
                }
            }
            
            // Analyze structs
            for (const struct of ast.structs) {
                try {
                    docInfo.structs.push(this.analyzeStruct(struct));
                } catch (error) {
                    console.warn(`Failed to analyze struct ${struct.name} in ${uri}:`, error);
                }
            }
            
            // Mark dependency graph node as resolved
            const node = docInfo.dependencyGraph.nodes.get(uri);
            if (node) {
                node.resolved = true;
            }
            
            // Cache the document info
            this.documentCache.set(uri, docInfo);
            
            return docInfo;
        } catch (error) {
            // Return document info with parse error
            const docInfo: DocumentInfo = {
                uri,
                imports: [],
                tasks: [],
                workflows: [],
                structs: [],
                importErrors: [{
                    importPath: uri,
                    error: `Parse error: ${error}`,
                    severity: 'error'
                }],
                dependencyGraph: {
                    nodes: new Map(),
                    edges: new Map(),
                    circularDependencies: []
                }
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
     * Clear document cache with enhanced dependency tracking
     */
    clearCache(uri?: string): void {
        if (uri) {
            const docInfo = this.documentCache.get(uri);
            if (docInfo) {
                // Clear dependency graph references
                docInfo.dependencyGraph.nodes.clear();
                docInfo.dependencyGraph.edges.clear();
                docInfo.dependencyGraph.circularDependencies = [];
            }
            
            this.documentCache.delete(uri);
            
            // Also notify ImportResolver about the change
            this.importResolver.handleImportFileChange(uri);
            
            // Update other documents that might depend on this one
            this.updateDependentDocuments(uri);
        } else {
            // Clear all caches
            for (const docInfo of this.documentCache.values()) {
                docInfo.dependencyGraph.nodes.clear();
                docInfo.dependencyGraph.edges.clear();
                docInfo.dependencyGraph.circularDependencies = [];
            }
            
            this.documentCache.clear();
            this.importResolver.clearCache();
        }
    }
    
    /**
     * Update documents that depend on the changed document
     */
    private updateDependentDocuments(changedUri: string): void {
        for (const [uri, docInfo] of this.documentCache) {
            if (uri === changedUri) continue;
            
            // Check if this document imports the changed document
            const hasChangedDependency = docInfo.imports.some(importInfo => 
                importInfo.dependencies?.includes(changedUri) ||
                importInfo.resolvedPath === changedUri
            );
            
            if (hasChangedDependency) {
                // Mark imports as needing re-resolution
                docInfo.imports.forEach(importInfo => {
                    if (importInfo.dependencies?.includes(changedUri) || 
                        importInfo.resolvedPath === changedUri) {
                        importInfo.isResolved = false;
                        importInfo.tasks = undefined;
                    }
                });
                
                // Clear import errors that might be stale
                docInfo.importErrors = docInfo.importErrors.filter(error => 
                    !error.importPath.includes(changedUri)
                );
            }
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
     * Analyze an import declaration with enhanced error handling
     */
    private async analyzeImportWithErrorHandling(
        importDecl: AST.ImportDeclaration, 
        baseUri: string, 
        docInfo: DocumentInfo
    ): Promise<ImportInfo> {
        const importInfo: ImportInfo = {
            path: importDecl.path,
            alias: importDecl.alias,
            isResolved: false
        };
        
        try {
            // Use ImportResolver to resolve the import with enhanced error handling
            const result = await this.importResolver.resolveImport(
                importDecl.path, 
                baseUri, 
                importDecl.alias
            );
            
            if (result.success) {
                importInfo.tasks = result.tasks;
                importInfo.dependencies = result.dependencies;
                importInfo.lastModified = result.lastModified;
                importInfo.isResolved = true;
                
                if (result.dependencies.length > 0) {
                    importInfo.resolvedPath = result.dependencies[0]; // First dependency is the main file
                }
                
                // Check for circular dependencies
                if (this.hasCircularDependency(baseUri, result.dependencies)) {
                    importInfo.circularDependency = true;
                    docInfo.importErrors.push({
                        importPath: importDecl.path,
                        error: 'Circular dependency detected',
                        severity: 'warning',
                        range: importDecl.range
                    });
                }
            } else {
                importInfo.isResolved = false;
            }
            
            if (result.errors.length > 0) {
                importInfo.errors = result.errors;
                
                // Add errors to document-level error collection
                result.errors.forEach(error => {
                    docInfo.importErrors.push({
                        importPath: importDecl.path,
                        error,
                        severity: error.includes('not found') ? 'error' : 'warning',
                        range: importDecl.range
                    });
                });
            }
        } catch (error) {
            const errorMessage = `Failed to resolve import: ${error}`;
            importInfo.errors = [errorMessage];
            importInfo.isResolved = false;
            
            docInfo.importErrors.push({
                importPath: importDecl.path,
                error: errorMessage,
                severity: 'error',
                range: importDecl.range
            });
        }
        
        return importInfo;
    }
    
    /**
     * Build dependency graph and detect circular dependencies
     */
    private async buildDependencyGraph(docInfo: DocumentInfo): Promise<void> {
        const visited = new Set<string>();
        const recursionStack = new Set<string>();
        
        // Build edges in dependency graph
        for (const importInfo of docInfo.imports) {
            if (importInfo.dependencies) {
                docInfo.dependencyGraph.edges.set(docInfo.uri, importInfo.dependencies);
                
                // Add nodes for dependencies
                for (const dep of importInfo.dependencies) {
                    if (!docInfo.dependencyGraph.nodes.has(dep)) {
                        docInfo.dependencyGraph.nodes.set(dep, {
                            uri: dep,
                            imports: [],
                            lastModified: importInfo.lastModified || 0,
                            resolved: importInfo.isResolved
                        });
                    }
                }
            }
        }
        
        // Detect circular dependencies using DFS
        const detectCycles = (uri: string, path: string[]): void => {
            if (recursionStack.has(uri)) {
                // Found a cycle
                const cycleStart = path.indexOf(uri);
                const cycle = path.slice(cycleStart).concat([uri]);
                docInfo.dependencyGraph.circularDependencies.push(cycle);
                return;
            }
            
            if (visited.has(uri)) {
                return;
            }
            
            visited.add(uri);
            recursionStack.add(uri);
            
            const dependencies = docInfo.dependencyGraph.edges.get(uri) || [];
            for (const dep of dependencies) {
                detectCycles(dep, [...path, uri]);
            }
            
            recursionStack.delete(uri);
        };
        
        detectCycles(docInfo.uri, []);
    }
    
    /**
     * Check if there's a circular dependency
     */
    private hasCircularDependency(baseUri: string, dependencies: string[]): boolean {
        return dependencies.includes(baseUri);
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
     * Resolve tasks from an imported file with support for nested imports
     */
    async resolveImportTasks(importInfo: ImportInfo, baseUri: string, depth: number = 0): Promise<TaskInfo[]> {
        // Prevent infinite recursion
        if (depth > this.MAX_IMPORT_DEPTH) {
            console.warn(`Maximum import depth exceeded for ${importInfo.path} from ${baseUri}`);
            return [];
        }
        
        // If we already have tasks from the import resolution, return them
        if (importInfo.tasks && importInfo.tasks.length > 0 && importInfo.isResolved) {
            return importInfo.tasks;
        }
        
        // Otherwise, try to resolve using ImportResolver with nested support
        try {
            const result = await this.importResolver.resolveImport(
                importInfo.path, 
                baseUri, 
                importInfo.alias
            );
            
            if (result.success) {
                importInfo.tasks = result.tasks;
                importInfo.dependencies = result.dependencies;
                importInfo.lastModified = result.lastModified;
                importInfo.isResolved = true;
                
                // Process nested imports recursively
                const allTasks = [...result.tasks];
                
                // If there are nested dependencies, try to resolve their tasks too
                if (result.dependencies && result.dependencies.length > 1) {
                    for (let i = 1; i < result.dependencies.length; i++) {
                        const nestedDep = result.dependencies[i];
                        try {
                            const nestedResult = await this.importResolver.resolveImport(
                                nestedDep,
                                baseUri,
                                undefined // No alias for nested dependencies
                            );
                            
                            if (nestedResult.success) {
                                // Add nested tasks with proper prefixing
                                const nestedTasks = nestedResult.tasks.map(task => ({
                                    ...task,
                                    name: importInfo.alias ? `${importInfo.alias}.${task.name}` : task.name
                                }));
                                allTasks.push(...nestedTasks);
                            }
                        } catch (nestedError) {
                            console.warn(`Failed to resolve nested import ${nestedDep}:`, nestedError);
                        }
                    }
                }
                
                importInfo.tasks = allTasks;
                return allTasks;
            } else {
                // Mark as unresolved but store errors
                importInfo.isResolved = false;
                importInfo.errors = result.errors;
            }
        } catch (error) {
            console.warn(`Failed to resolve import ${importInfo.path} from ${baseUri}:`, error);
            importInfo.isResolved = false;
            importInfo.errors = [`Resolution failed: ${error}`];
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
    
    /**
     * Get all import errors for a document
     */
    getImportErrors(uri: string): ImportError[] {
        const docInfo = this.getCachedDocument(uri);
        return docInfo?.importErrors || [];
    }
    
    /**
     * Get dependency graph for a document
     */
    getDependencyGraph(uri: string): DependencyGraph | undefined {
        const docInfo = this.getCachedDocument(uri);
        return docInfo?.dependencyGraph;
    }
    
    /**
     * Check if a document has circular dependencies
     */
    hasCircularDependencies(uri: string): boolean {
        const docInfo = this.getCachedDocument(uri);
        return (docInfo?.dependencyGraph?.circularDependencies?.length ?? 0) > 0;
    }
    
    /**
     * Get all circular dependency chains for a document
     */
    getCircularDependencies(uri: string): string[][] {
        const docInfo = this.getCachedDocument(uri);
        return docInfo?.dependencyGraph.circularDependencies || [];
    }
    
    /**
     * Refresh import resolution for a document
     */
    async refreshImports(uri: string): Promise<void> {
        const docInfo = this.getCachedDocument(uri);
        if (!docInfo) {
            return;
        }
        
        // Clear existing import data
        docInfo.importErrors = [];
        docInfo.dependencyGraph = {
            nodes: new Map(),
            edges: new Map(),
            circularDependencies: []
        };
        
        // Re-analyze imports
        for (const importInfo of docInfo.imports) {
            importInfo.isResolved = false;
            importInfo.tasks = undefined;
            importInfo.errors = undefined;
            importInfo.dependencies = undefined;
            
            try {
                const result = await this.importResolver.resolveImport(
                    importInfo.path,
                    uri,
                    importInfo.alias
                );
                
                if (result.success) {
                    importInfo.tasks = result.tasks;
                    importInfo.dependencies = result.dependencies;
                    importInfo.lastModified = result.lastModified;
                    importInfo.isResolved = true;
                } else {
                    importInfo.errors = result.errors;
                    result.errors.forEach(error => {
                        docInfo.importErrors.push({
                            importPath: importInfo.path,
                            error,
                            severity: 'error'
                        });
                    });
                }
            } catch (error) {
                const errorMessage = `Failed to refresh import: ${error}`;
                importInfo.errors = [errorMessage];
                docInfo.importErrors.push({
                    importPath: importInfo.path,
                    error: errorMessage,
                    severity: 'error'
                });
            }
        }
        
        // Rebuild dependency graph
        await this.buildDependencyGraph(docInfo);
    }
    
    /**
     * Get import statistics for a document
     */
    getImportStatistics(uri: string): {
        totalImports: number;
        resolvedImports: number;
        failedImports: number;
        circularDependencies: number;
        totalTasks: number;
        importedTasks: number;
    } {
        const docInfo = this.getCachedDocument(uri);
        if (!docInfo) {
            return {
                totalImports: 0,
                resolvedImports: 0,
                failedImports: 0,
                circularDependencies: 0,
                totalTasks: 0,
                importedTasks: 0
            };
        }
        
        const resolvedImports = docInfo.imports.filter(imp => imp.isResolved).length;
        const failedImports = docInfo.imports.length - resolvedImports;
        const importedTasks = docInfo.imports.reduce((count, imp) => 
            count + (imp.tasks?.length || 0), 0);
        
        return {
            totalImports: docInfo.imports.length,
            resolvedImports,
            failedImports,
            circularDependencies: docInfo.dependencyGraph.circularDependencies.length,
            totalTasks: docInfo.tasks.length + importedTasks,
            importedTasks
        };
    }
}