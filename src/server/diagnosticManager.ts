import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentInfo, ImportError } from './documentAnalyzer';

export interface DiagnosticRule {
    id: string;
    name: string;
    description: string;
    severity: DiagnosticSeverity;
    enabled: boolean;
    category: 'import' | 'syntax' | 'semantic' | 'performance' | 'style';
}

export interface DiagnosticContext {
    document: TextDocument;
    documentInfo?: DocumentInfo;
    imports?: any[];
    tasks?: any[];
    workflows?: any[];
}

export interface DiagnosticReport {
    uri: string;
    diagnostics: Diagnostic[];
    timestamp: number;
    processingTime: number;
    rulesApplied: string[];
    errors: string[];
}

export class DiagnosticManager {
    private rules: Map<string, DiagnosticRule> = new Map();
    private diagnosticCache: Map<string, DiagnosticReport> = new Map();
    private readonly CACHE_TTL = 30 * 1000; // 30 seconds
    
    constructor() {
        this.initializeDefaultRules();
    }
    
    /**
     * Initialize default diagnostic rules
     */
    private initializeDefaultRules(): void {
        const defaultRules: DiagnosticRule[] = [
            {
                id: 'import-not-found',
                name: 'Import File Not Found',
                description: 'Imported file does not exist',
                severity: DiagnosticSeverity.Error,
                enabled: true,
                category: 'import'
            },
            {
                id: 'import-circular-dependency',
                name: 'Circular Import Dependency',
                description: 'Circular dependency detected in imports',
                severity: DiagnosticSeverity.Warning,
                enabled: true,
                category: 'import'
            },
            {
                id: 'import-syntax-error',
                name: 'Import Syntax Error',
                description: 'Syntax error in imported file',
                severity: DiagnosticSeverity.Error,
                enabled: true,
                category: 'import'
            },
            {
                id: 'import-timeout',
                name: 'Import Resolution Timeout',
                description: 'Import resolution exceeded timeout limit',
                severity: DiagnosticSeverity.Warning,
                enabled: true,
                category: 'performance'
            },
            {
                id: 'task-not-found',
                name: 'Task Not Found',
                description: 'Referenced task does not exist',
                severity: DiagnosticSeverity.Error,
                enabled: true,
                category: 'semantic'
            },
            {
                id: 'task-input-missing',
                name: 'Required Task Input Missing',
                description: 'Required task input parameter is missing',
                severity: DiagnosticSeverity.Error,
                enabled: true,
                category: 'semantic'
            },
            {
                id: 'task-input-unknown',
                name: 'Unknown Task Input',
                description: 'Task input parameter is not defined',
                severity: DiagnosticSeverity.Warning,
                enabled: true,
                category: 'semantic'
            },
            {
                id: 'task-output-not-found',
                name: 'Task Output Not Found',
                description: 'Referenced task output does not exist',
                severity: DiagnosticSeverity.Error,
                enabled: true,
                category: 'semantic'
            },
            {
                id: 'alias-conflict',
                name: 'Import Alias Conflict',
                description: 'Import alias conflicts with existing name',
                severity: DiagnosticSeverity.Warning,
                enabled: true,
                category: 'import'
            },
            {
                id: 'resource-limit-exceeded',
                name: 'Resource Limit Exceeded',
                description: 'Processing exceeded resource limits',
                severity: DiagnosticSeverity.Warning,
                enabled: true,
                category: 'performance'
            }
        ];
        
        for (const rule of defaultRules) {
            this.rules.set(rule.id, rule);
        }
    }
    
    /**
     * Analyze document and generate diagnostics
     */
    async analyzeDiagnostics(context: DiagnosticContext): Promise<DiagnosticReport> {
        const startTime = Date.now();
        const diagnostics: Diagnostic[] = [];
        const rulesApplied: string[] = [];
        const errors: string[] = [];
        
        try {
            // Check cache first
            const cached = this.getCachedDiagnostics(context.document.uri);
            if (cached) {
                return cached;
            }
            
            // Apply import-related diagnostics
            if (context.documentInfo) {
                diagnostics.push(...await this.analyzeImportDiagnostics(context));
                rulesApplied.push('import-analysis');
            }
            
            // Apply task-related diagnostics
            if (context.tasks) {
                diagnostics.push(...await this.analyzeTaskDiagnostics(context));
                rulesApplied.push('task-analysis');
            }
            
            // Apply workflow-related diagnostics
            if (context.workflows) {
                diagnostics.push(...await this.analyzeWorkflowDiagnostics(context));
                rulesApplied.push('workflow-analysis');
            }
            
            // Apply performance diagnostics
            diagnostics.push(...await this.analyzePerformanceDiagnostics(context));
            rulesApplied.push('performance-analysis');
            
        } catch (error) {
            errors.push(`Diagnostic analysis failed: ${error}`);
            console.error('Diagnostic analysis error:', error);
        }
        
        const report: DiagnosticReport = {
            uri: context.document.uri,
            diagnostics,
            timestamp: Date.now(),
            processingTime: Date.now() - startTime,
            rulesApplied,
            errors
        };
        
        // Cache the report
        this.cacheDiagnostics(context.document.uri, report);
        
        return report;
    }
    
    /**
     * Analyze import-related diagnostics
     */
    private async analyzeImportDiagnostics(context: DiagnosticContext): Promise<Diagnostic[]> {
        const diagnostics: Diagnostic[] = [];
        const docInfo = context.documentInfo!;
        
        // Check import errors
        for (const importError of docInfo.importErrors || []) {
            if (this.isRuleEnabled('import-not-found') && importError.error.includes('not found')) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: this.convertRange(importError.range) || this.createDefaultRange(),
                    message: `Import file not found: ${importError.importPath}`,
                    source: 'wdl-enhanced',
                    code: 'import-not-found'
                });
            }
            
            if (this.isRuleEnabled('import-syntax-error') && importError.error.includes('syntax')) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: this.convertRange(importError.range) || this.createDefaultRange(),
                    message: `Syntax error in import: ${importError.error}`,
                    source: 'wdl-enhanced',
                    code: 'import-syntax-error'
                });
            }
            
            if (this.isRuleEnabled('import-timeout') && importError.error.includes('timeout')) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Warning,
                    range: this.convertRange(importError.range) || this.createDefaultRange(),
                    message: `Import resolution timeout: ${importError.importPath}`,
                    source: 'wdl-enhanced',
                    code: 'import-timeout'
                });
            }
        }
        
        // Check circular dependencies
        if (this.isRuleEnabled('import-circular-dependency')) {
            const circularDeps = docInfo.dependencyGraph?.circularDependencies || [];
            for (const cycle of circularDeps) {
                if (cycle.length > 1) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Warning,
                        range: this.createDefaultRange(),
                        message: `Circular dependency detected: ${cycle.join(' -> ')}`,
                        source: 'wdl-enhanced',
                        code: 'import-circular-dependency'
                    });
                }
            }
        }
        
        // Check alias conflicts
        if (this.isRuleEnabled('alias-conflict')) {
            const aliases = new Set<string>();
            const taskNames = new Set(docInfo.tasks.map(t => t.name));
            
            for (const importInfo of docInfo.imports) {
                if (importInfo.alias) {
                    if (aliases.has(importInfo.alias) || taskNames.has(importInfo.alias)) {
                        diagnostics.push({
                            severity: DiagnosticSeverity.Warning,
                            range: this.createDefaultRange(),
                            message: `Import alias '${importInfo.alias}' conflicts with existing name`,
                            source: 'wdl-enhanced',
                            code: 'alias-conflict'
                        });
                    }
                    aliases.add(importInfo.alias);
                }
            }
        }
        
        return diagnostics;
    }
    
    /**
     * Analyze task-related diagnostics
     */
    private async analyzeTaskDiagnostics(context: DiagnosticContext): Promise<Diagnostic[]> {
        const diagnostics: Diagnostic[] = [];
        
        // This would be implemented with actual task analysis
        // For now, return empty array as placeholder
        
        return diagnostics;
    }
    
    /**
     * Analyze workflow-related diagnostics
     */
    private async analyzeWorkflowDiagnostics(context: DiagnosticContext): Promise<Diagnostic[]> {
        const diagnostics: Diagnostic[] = [];
        
        // This would be implemented with actual workflow analysis
        // For now, return empty array as placeholder
        
        return diagnostics;
    }
    
    /**
     * Analyze performance-related diagnostics
     */
    private async analyzePerformanceDiagnostics(context: DiagnosticContext): Promise<Diagnostic[]> {
        const diagnostics: Diagnostic[] = [];
        
        if (this.isRuleEnabled('resource-limit-exceeded')) {
            const memoryUsage = process.memoryUsage();
            const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
            
            // Warn if memory usage is high
            if (heapUsedMB > 200) { // 200MB threshold
                diagnostics.push({
                    severity: DiagnosticSeverity.Information,
                    range: this.createDefaultRange(),
                    message: `High memory usage detected: ${Math.round(heapUsedMB)}MB`,
                    source: 'wdl-enhanced',
                    code: 'resource-limit-exceeded'
                });
            }
        }
        
        return diagnostics;
    }
    
    /**
     * Check if a diagnostic rule is enabled
     */
    private isRuleEnabled(ruleId: string): boolean {
        const rule = this.rules.get(ruleId);
        return rule ? rule.enabled : false;
    }
    
    /**
     * Create default range for diagnostics without specific location
     */
    private createDefaultRange(): Range {
        return {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 }
        };
    }
    
    /**
     * Convert AST Range to LSP Range
     */
    private convertRange(astRange?: any): Range | null {
        if (!astRange) {
            return null;
        }
        
        // Convert AST range format to LSP range format
        return {
            start: {
                line: astRange.start?.line || 0,
                character: astRange.start?.character || 0
            },
            end: {
                line: astRange.end?.line || 0,
                character: astRange.end?.character || 0
            }
        };
    }
    
    /**
     * Get cached diagnostics if valid
     */
    private getCachedDiagnostics(uri: string): DiagnosticReport | null {
        const cached = this.diagnosticCache.get(uri);
        if (!cached) {
            return null;
        }
        
        // Check if cache is expired
        if (Date.now() - cached.timestamp > this.CACHE_TTL) {
            this.diagnosticCache.delete(uri);
            return null;
        }
        
        return cached;
    }
    
    /**
     * Cache diagnostic report
     */
    private cacheDiagnostics(uri: string, report: DiagnosticReport): void {
        this.diagnosticCache.set(uri, report);
        
        // Clean up old cache entries
        if (this.diagnosticCache.size > 50) {
            const entries = Array.from(this.diagnosticCache.entries())
                .sort((a, b) => a[1].timestamp - b[1].timestamp);
            
            const toRemove = entries.slice(0, entries.length - 50);
            for (const [key] of toRemove) {
                this.diagnosticCache.delete(key);
            }
        }
    }
    
    /**
     * Enable or disable a diagnostic rule
     */
    setRuleEnabled(ruleId: string, enabled: boolean): void {
        const rule = this.rules.get(ruleId);
        if (rule) {
            rule.enabled = enabled;
        }
    }
    
    /**
     * Get all diagnostic rules
     */
    getRules(): DiagnosticRule[] {
        return Array.from(this.rules.values());
    }
    
    /**
     * Get enabled diagnostic rules
     */
    getEnabledRules(): DiagnosticRule[] {
        return Array.from(this.rules.values()).filter(rule => rule.enabled);
    }
    
    /**
     * Add custom diagnostic rule
     */
    addRule(rule: DiagnosticRule): void {
        this.rules.set(rule.id, rule);
    }
    
    /**
     * Remove diagnostic rule
     */
    removeRule(ruleId: string): boolean {
        return this.rules.delete(ruleId);
    }
    
    /**
     * Clear diagnostic cache
     */
    clearCache(uri?: string): void {
        if (uri) {
            this.diagnosticCache.delete(uri);
        } else {
            this.diagnosticCache.clear();
        }
    }
    
    /**
     * Get diagnostic statistics
     */
    getStatistics(): {
        totalRules: number;
        enabledRules: number;
        cachedReports: number;
        cacheHitRate: number;
    } {
        return {
            totalRules: this.rules.size,
            enabledRules: this.getEnabledRules().length,
            cachedReports: this.diagnosticCache.size,
            cacheHitRate: 0 // Would need to track hits/misses
        };
    }
}