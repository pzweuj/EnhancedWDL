import { EventEmitter } from 'events';

export interface ErrorContext {
    operation: string;
    uri?: string;
    timestamp: number;
    stackTrace?: string;
    metadata?: Record<string, any>;
    performanceMetrics?: PerformanceMetrics;
}

export interface PerformanceMetrics {
    startTime: number;
    endTime?: number;
    duration?: number;
    memoryUsage?: NodeJS.MemoryUsage;
    cpuUsage?: NodeJS.CpuUsage;
}

export interface ErrorReport {
    id: string;
    error: Error;
    context: ErrorContext;
    severity: 'low' | 'medium' | 'high' | 'critical';
    recovered: boolean;
    recoveryAction?: string;
    timestamp: number;
}

export interface TimeoutConfig {
    operation: string;
    timeout: number;
    retries: number;
    backoffMultiplier: number;
}

export interface CircuitBreakerConfig {
    failureThreshold: number;
    resetTimeout: number;
    monitoringPeriod: number;
}

export class ErrorHandler extends EventEmitter {
    private errorReports: ErrorReport[] = [];
    private timeoutConfigs: Map<string, TimeoutConfig> = new Map();
    private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
    private performanceMonitor: PerformanceMonitor = new PerformanceMonitor();
    private readonly MAX_ERROR_REPORTS = 1000;
    
    constructor() {
        super();
        this.initializeDefaultTimeouts();
        this.startCleanupTimer();
        this.startPerformanceMonitoring();
    }
    
    /**
     * Initialize default timeout configurations
     */
    private initializeDefaultTimeouts(): void {
        const defaultTimeouts: TimeoutConfig[] = [
            {
                operation: 'import-resolution',
                timeout: 10000, // 10 seconds
                retries: 3,
                backoffMultiplier: 1.5
            },
            {
                operation: 'document-analysis',
                timeout: 5000, // 5 seconds
                retries: 2,
                backoffMultiplier: 2.0
            },
            {
                operation: 'completion-request',
                timeout: 2000, // 2 seconds
                retries: 1,
                backoffMultiplier: 1.0
            },
            {
                operation: 'symbol-resolution',
                timeout: 3000, // 3 seconds
                retries: 2,
                backoffMultiplier: 1.5
            }
        ];
        
        for (const config of defaultTimeouts) {
            this.timeoutConfigs.set(config.operation, config);
        }
    }
    
    /**
     * Execute operation with timeout and retry logic
     */
    async executeWithTimeout<T>(
        operation: string,
        fn: () => Promise<T>,
        context?: Partial<ErrorContext>
    ): Promise<T> {
        const config = this.timeoutConfigs.get(operation);
        if (!config) {
            throw new Error(`No timeout configuration found for operation: ${operation}`);
        }
        
        // Check circuit breaker
        if (this.isCircuitBreakerOpen(operation)) {
            throw new Error(`Circuit breaker is open for operation: ${operation}`);
        }
        
        let lastError: Error | null = null;
        let attempt = 0;
        
        while (attempt <= config.retries) {
            try {
                const result = await this.executeWithTimeoutInternal(fn, config.timeout);
                
                // Reset circuit breaker on success
                this.recordSuccess(operation);
                
                return result;
            } catch (error) {
                lastError = error as Error;
                attempt++;
                
                // Record failure
                this.recordFailure(operation, lastError, {
                    operation,
                    timestamp: Date.now(),
                    ...context
                });
                
                // If not the last attempt, wait before retrying
                if (attempt <= config.retries) {
                    const delay = this.calculateBackoffDelay(attempt, config.backoffMultiplier);
                    await this.sleep(delay);
                }
            }
        }
        
        // All retries exhausted
        throw lastError || new Error(`Operation ${operation} failed after ${config.retries} retries`);
    }
    
    /**
     * Execute function with timeout
     */
    private async executeWithTimeoutInternal<T>(
        fn: () => Promise<T>,
        timeout: number
    ): Promise<T> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Operation timed out after ${timeout}ms`));
            }, timeout);
            
            fn()
                .then(result => {
                    clearTimeout(timer);
                    resolve(result);
                })
                .catch(error => {
                    clearTimeout(timer);
                    reject(error);
                });
        });
    }
    
    /**
     * Handle and report error with recovery attempt
     */
    async handleError(
        error: Error,
        context: ErrorContext,
        recoveryFn?: () => Promise<any>
    ): Promise<ErrorReport> {
        const errorId = this.generateErrorId();
        const severity = this.determineSeverity(error, context);
        
        let recovered = false;
        let recoveryAction: string | undefined;
        
        // Attempt recovery if function provided
        if (recoveryFn) {
            try {
                await recoveryFn();
                recovered = true;
                recoveryAction = 'Custom recovery function executed';
            } catch (recoveryError) {
                recoveryAction = `Recovery failed: ${(recoveryError as Error).message}`;
            }
        } else {
            // Try built-in recovery strategies
            const builtInRecovery = await this.attemptBuiltInRecovery(error, context);
            recovered = builtInRecovery.success;
            recoveryAction = builtInRecovery.action;
        }
        
        const report: ErrorReport = {
            id: errorId,
            error,
            context,
            severity,
            recovered,
            recoveryAction,
            timestamp: Date.now()
        };
        
        // Store error report
        this.storeErrorReport(report);
        
        // Emit error event
        this.emit('error', report);
        
        // Emit severity-specific events
        this.emit(`error-${severity}`, report);
        
        return report;
    }
    
    /**
     * Attempt built-in recovery strategies
     */
    private async attemptBuiltInRecovery(
        error: Error,
        context: ErrorContext
    ): Promise<{ success: boolean; action: string }> {
        const errorMessage = error.message.toLowerCase();
        
        // File not found recovery
        if (errorMessage.includes('not found') || errorMessage.includes('enoent')) {
            return {
                success: false,
                action: 'File not found - no automatic recovery available'
            };
        }
        
        // Memory pressure recovery
        if (errorMessage.includes('memory') || errorMessage.includes('heap')) {
            try {
                // Force garbage collection if available
                if (global.gc) {
                    global.gc();
                    return {
                        success: true,
                        action: 'Forced garbage collection'
                    };
                }
            } catch (gcError) {
                // Ignore GC errors
            }
            
            return {
                success: false,
                action: 'Memory pressure detected - consider restarting'
            };
        }
        
        // Timeout recovery
        if (errorMessage.includes('timeout')) {
            return {
                success: false,
                action: 'Operation timed out - retry with exponential backoff'
            };
        }
        
        // Parse error recovery - Enhanced for best-effort completion
        if (errorMessage.includes('parse') || errorMessage.includes('syntax')) {
            // For completion requests, we can still provide basic completions
            if (context.operation === 'completion-request') {
                return {
                    success: true,
                    action: 'Parse error - providing best-effort completions'
                };
            }
            return {
                success: false,
                action: 'Syntax error - manual correction required'
            };
        }
        
        // Task not found recovery - Enhanced with suggestions
        if (errorMessage.includes('task not found') || errorMessage.includes('symbol not found')) {
            return {
                success: true,
                action: 'Task not found - providing similar task suggestions'
            };
        }
        
        // Network/IO error recovery
        if (errorMessage.includes('network') || errorMessage.includes('connection')) {
            return {
                success: false,
                action: 'Network error - retry after delay'
            };
        }
        
        // Completion-specific error recovery
        if (context.operation === 'completion-request') {
            return {
                success: true,
                action: 'Completion error - providing fallback completions'
            };
        }
        
        return {
            success: false,
            action: 'No specific recovery strategy available'
        };
    }
    
    /**
     * Determine error severity
     */
    private determineSeverity(error: Error, context: ErrorContext): 'low' | 'medium' | 'high' | 'critical' {
        const errorMessage = error.message.toLowerCase();
        
        // Critical errors
        if (errorMessage.includes('out of memory') || 
            errorMessage.includes('stack overflow') ||
            errorMessage.includes('segmentation fault')) {
            return 'critical';
        }
        
        // High severity errors
        if (errorMessage.includes('cannot resolve') ||
            errorMessage.includes('file not found') ||
            errorMessage.includes('permission denied')) {
            return 'high';
        }
        
        // Medium severity errors
        if (errorMessage.includes('timeout') ||
            errorMessage.includes('parse error') ||
            errorMessage.includes('syntax error')) {
            return 'medium';
        }
        
        // Default to low severity
        return 'low';
    }
    
    /**
     * Circuit breaker implementation
     */
    private recordFailure(operation: string, error: Error, context: ErrorContext): void {
        let state = this.circuitBreakers.get(operation);
        if (!state) {
            state = {
                failures: 0,
                successes: 0,
                lastFailureTime: 0,
                state: 'closed',
                config: {
                    failureThreshold: 5,
                    resetTimeout: 60000, // 1 minute
                    monitoringPeriod: 300000 // 5 minutes
                }
            };
            this.circuitBreakers.set(operation, state);
        }
        
        state.failures++;
        state.lastFailureTime = Date.now();
        
        // Check if we should open the circuit breaker
        if (state.failures >= state.config.failureThreshold && state.state === 'closed') {
            state.state = 'open';
            this.emit('circuit-breaker-opened', { operation, failures: state.failures });
        }
    }
    
    private recordSuccess(operation: string): void {
        let state = this.circuitBreakers.get(operation);
        if (!state) {
            return;
        }
        
        state.successes++;
        
        // Reset circuit breaker if it was half-open
        if (state.state === 'half-open') {
            state.state = 'closed';
            state.failures = 0;
            this.emit('circuit-breaker-closed', { operation });
        }
    }
    
    private isCircuitBreakerOpen(operation: string): boolean {
        const state = this.circuitBreakers.get(operation);
        if (!state) {
            return false;
        }
        
        const now = Date.now();
        
        // Check if we should transition from open to half-open
        if (state.state === 'open' && 
            now - state.lastFailureTime > state.config.resetTimeout) {
            state.state = 'half-open';
            this.emit('circuit-breaker-half-open', { operation });
        }
        
        return state.state === 'open';
    }
    
    /**
     * Calculate exponential backoff delay
     */
    private calculateBackoffDelay(attempt: number, multiplier: number): number {
        const baseDelay = 100; // 100ms base delay
        return Math.min(baseDelay * Math.pow(multiplier, attempt - 1), 10000); // Max 10 seconds
    }
    
    /**
     * Sleep for specified milliseconds
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * Generate unique error ID
     */
    private generateErrorId(): string {
        return `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Store error report
     */
    private storeErrorReport(report: ErrorReport): void {
        this.errorReports.push(report);
        
        // Keep only recent error reports
        if (this.errorReports.length > this.MAX_ERROR_REPORTS) {
            this.errorReports = this.errorReports.slice(-this.MAX_ERROR_REPORTS);
        }
    }
    
    /**
     * Get error reports
     */
    getErrorReports(filter?: {
        severity?: string;
        operation?: string;
        timeRange?: { start: number; end: number };
        recovered?: boolean;
    }): ErrorReport[] {
        let reports = [...this.errorReports];
        
        if (filter) {
            if (filter.severity) {
                reports = reports.filter(r => r.severity === filter.severity);
            }
            
            if (filter.operation) {
                reports = reports.filter(r => r.context.operation === filter.operation);
            }
            
            if (filter.timeRange) {
                reports = reports.filter(r => 
                    r.timestamp >= filter.timeRange!.start && 
                    r.timestamp <= filter.timeRange!.end
                );
            }
            
            if (filter.recovered !== undefined) {
                reports = reports.filter(r => r.recovered === filter.recovered);
            }
        }
        
        return reports.sort((a, b) => b.timestamp - a.timestamp);
    }
    
    /**
     * Get error statistics
     */
    getStatistics(): {
        totalErrors: number;
        errorsBySeverity: Record<string, number>;
        errorsByOperation: Record<string, number>;
        recoveryRate: number;
        circuitBreakerStates: Record<string, string>;
    } {
        const errorsBySeverity: Record<string, number> = {};
        const errorsByOperation: Record<string, number> = {};
        let recoveredCount = 0;
        
        for (const report of this.errorReports) {
            // Count by severity
            errorsBySeverity[report.severity] = (errorsBySeverity[report.severity] || 0) + 1;
            
            // Count by operation
            errorsByOperation[report.context.operation] = 
                (errorsByOperation[report.context.operation] || 0) + 1;
            
            // Count recovered errors
            if (report.recovered) {
                recoveredCount++;
            }
        }
        
        const circuitBreakerStates: Record<string, string> = {};
        for (const [operation, state] of this.circuitBreakers) {
            circuitBreakerStates[operation] = state.state;
        }
        
        return {
            totalErrors: this.errorReports.length,
            errorsBySeverity,
            errorsByOperation,
            recoveryRate: this.errorReports.length > 0 ? recoveredCount / this.errorReports.length : 0,
            circuitBreakerStates
        };
    }
    
    /**
     * Configure timeout for operation
     */
    setTimeoutConfig(operation: string, config: TimeoutConfig): void {
        this.timeoutConfigs.set(operation, config);
    }
    
    /**
     * Configure circuit breaker
     */
    setCircuitBreakerConfig(operation: string, config: CircuitBreakerConfig): void {
        let state = this.circuitBreakers.get(operation);
        if (!state) {
            state = {
                failures: 0,
                successes: 0,
                lastFailureTime: 0,
                state: 'closed',
                config
            };
        } else {
            state.config = config;
        }
        this.circuitBreakers.set(operation, state);
    }
    
    /**
     * Clear error reports
     */
    clearErrorReports(): void {
        this.errorReports = [];
    }
    
    /**
     * Reset circuit breaker
     */
    resetCircuitBreaker(operation: string): void {
        const state = this.circuitBreakers.get(operation);
        if (state) {
            state.failures = 0;
            state.successes = 0;
            state.state = 'closed';
            state.lastFailureTime = 0;
        }
    }
    
    /**
     * Start cleanup timer
     */
    private startCleanupTimer(): void {
        setInterval(() => {
            this.cleanupOldReports();
        }, 300000); // 5 minutes
    }
    
    /**
     * Clean up old error reports
     */
    private cleanupOldReports(): void {
        const cutoffTime = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
        this.errorReports = this.errorReports.filter(report => report.timestamp > cutoffTime);
    }
    
    /**
     * Start performance monitoring
     */
    private startPerformanceMonitoring(): void {
        this.performanceMonitor.startMonitoring();
        
        // Listen for performance warnings
        process.on('performance-warning' as any, (warning: any) => {
            this.emit('performance-warning', warning);
        });
    }
    
    /**
     * Create performance metrics for operation
     */
    createPerformanceMetrics(): PerformanceMetrics {
        return {
            startTime: Date.now(),
            memoryUsage: process.memoryUsage(),
            cpuUsage: process.cpuUsage()
        };
    }
    
    /**
     * Complete performance metrics
     */
    completePerformanceMetrics(metrics: PerformanceMetrics): PerformanceMetrics {
        const endTime = Date.now();
        return {
            ...metrics,
            endTime,
            duration: endTime - metrics.startTime,
            memoryUsage: process.memoryUsage(),
            cpuUsage: process.cpuUsage(metrics.cpuUsage)
        };
    }
    
    /**
     * Record operation performance
     */
    recordOperationPerformance(
        operation: string,
        duration: number,
        success: boolean,
        isTimeout: boolean = false,
        memoryUsage?: NodeJS.MemoryUsage
    ): void {
        this.performanceMonitor.recordOperation(operation, duration, success, isTimeout, memoryUsage);
    }
    
    /**
     * Get performance metrics for operation
     */
    getOperationPerformance(operation: string): OperationPerformance | undefined {
        return this.performanceMonitor.getOperationMetrics(operation);
    }
    
    /**
     * Get all performance metrics
     */
    getAllPerformanceMetrics(): OperationPerformance[] {
        return this.performanceMonitor.getAllMetrics();
    }
    
    /**
     * Get system health status
     */
    getSystemHealth(): {
        memoryUsage: NodeJS.MemoryUsage;
        cpuUsage: NodeJS.CpuUsage;
        uptime: number;
        isHealthy: boolean;
        warnings: string[];
    } {
        return this.performanceMonitor.getSystemHealth();
    }
    
    /**
     * Check if system is under memory pressure
     */
    isMemoryPressure(): boolean {
        const health = this.getSystemHealth();
        return health.warnings.some(warning => warning.includes('memory'));
    }
    
    /**
     * Get best-effort completion suggestions when task not found
     */
    getTaskNotFoundSuggestions(
        taskName: string,
        availableTasks: string[]
    ): string[] {
        const suggestions: string[] = [];
        const lowerTaskName = taskName.toLowerCase();
        
        // Exact case-insensitive match
        for (const task of availableTasks) {
            if (task.toLowerCase() === lowerTaskName) {
                suggestions.push(task);
            }
        }
        
        // Partial matches
        for (const task of availableTasks) {
            const lowerTask = task.toLowerCase();
            if (lowerTask.includes(lowerTaskName) || lowerTaskName.includes(lowerTask)) {
                if (!suggestions.includes(task)) {
                    suggestions.push(task);
                }
            }
        }
        
        // Levenshtein distance based suggestions
        const distanceMatches = availableTasks
            .map(task => ({
                task,
                distance: this.calculateLevenshteinDistance(lowerTaskName, task.toLowerCase())
            }))
            .filter(item => item.distance <= 3) // Max 3 character differences
            .sort((a, b) => a.distance - b.distance)
            .map(item => item.task);
        
        for (const task of distanceMatches) {
            if (!suggestions.includes(task)) {
                suggestions.push(task);
            }
        }
        
        // Limit to top 5 suggestions
        return suggestions.slice(0, 5);
    }
    
    /**
     * Calculate Levenshtein distance between two strings
     */
    private calculateLevenshteinDistance(str1: string, str2: string): number {
        const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
        
        for (let i = 0; i <= str1.length; i++) {
            matrix[0][i] = i;
        }
        
        for (let j = 0; j <= str2.length; j++) {
            matrix[j][0] = j;
        }
        
        for (let j = 1; j <= str2.length; j++) {
            for (let i = 1; i <= str1.length; i++) {
                const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
                matrix[j][i] = Math.min(
                    matrix[j][i - 1] + 1, // deletion
                    matrix[j - 1][i] + 1, // insertion
                    matrix[j - 1][i - 1] + indicator // substitution
                );
            }
        }
        
        return matrix[str2.length][str1.length];
    }
    
    /**
     * Provide best-effort completions during parse errors
     */
    getBestEffortCompletions(): Array<{
        label: string;
        kind: number;
        detail: string;
        insertText: string;
    }> {
        return [
            {
                label: 'workflow',
                kind: 14, // CompletionItemKind.Keyword
                detail: 'WDL workflow definition',
                insertText: 'workflow ${1:WorkflowName} {\n\t$0\n}'
            },
            {
                label: 'task',
                kind: 14, // CompletionItemKind.Keyword
                detail: 'WDL task definition',
                insertText: 'task ${1:TaskName} {\n\tinput {\n\t\t$2\n\t}\n\tcommand {\n\t\t$3\n\t}\n\toutput {\n\t\t$4\n\t}\n}'
            },
            {
                label: 'call',
                kind: 14, // CompletionItemKind.Keyword
                detail: 'Call a task',
                insertText: 'call ${1:TaskName} {\n\tinput:\n\t\t$2\n}'
            },
            {
                label: 'import',
                kind: 14, // CompletionItemKind.Keyword
                detail: 'Import external WDL file',
                insertText: 'import "${1:path/to/file.wdl}" as ${2:alias}'
            },
            {
                label: 'scatter',
                kind: 14, // CompletionItemKind.Keyword
                detail: 'Scatter over collection',
                insertText: 'scatter (${1:item} in ${2:collection}) {\n\t$3\n}'
            },
            {
                label: 'if',
                kind: 14, // CompletionItemKind.Keyword
                detail: 'Conditional execution',
                insertText: 'if (${1:condition}) {\n\t$2\n}'
            }
        ];
    }
}

interface CircuitBreakerState {
    failures: number;
    successes: number;
    lastFailureTime: number;
    state: 'closed' | 'open' | 'half-open';
    config: CircuitBreakerConfig;
}

export interface OperationPerformance {
    operation: string;
    averageResponseTime: number;
    minResponseTime: number;
    maxResponseTime: number;
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    timeoutCount: number;
    lastExecutionTime: number;
    memoryPressureEvents: number;
}

class PerformanceMonitor {
    private operationMetrics: Map<string, OperationPerformance> = new Map();
    private memoryThreshold = 100 * 1024 * 1024; // 100MB
    private cpuThreshold = 80; // 80% CPU usage
    private monitoringInterval?: NodeJS.Timeout;
    
    startMonitoring(): void {
        this.monitoringInterval = setInterval(() => {
            this.checkSystemHealth();
        }, 5000); // Check every 5 seconds
    }
    
    stopMonitoring(): void {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = undefined;
        }
    }
    
    recordOperation(
        operation: string,
        duration: number,
        success: boolean,
        isTimeout: boolean = false,
        memoryUsage?: NodeJS.MemoryUsage
    ): void {
        let metrics = this.operationMetrics.get(operation);
        if (!metrics) {
            metrics = {
                operation,
                averageResponseTime: 0,
                minResponseTime: Infinity,
                maxResponseTime: 0,
                totalRequests: 0,
                successfulRequests: 0,
                failedRequests: 0,
                timeoutCount: 0,
                lastExecutionTime: Date.now(),
                memoryPressureEvents: 0
            };
            this.operationMetrics.set(operation, metrics);
        }
        
        // Update metrics
        metrics.totalRequests++;
        metrics.lastExecutionTime = Date.now();
        
        if (success) {
            metrics.successfulRequests++;
        } else {
            metrics.failedRequests++;
        }
        
        if (isTimeout) {
            metrics.timeoutCount++;
        }
        
        // Update response time metrics
        metrics.minResponseTime = Math.min(metrics.minResponseTime, duration);
        metrics.maxResponseTime = Math.max(metrics.maxResponseTime, duration);
        metrics.averageResponseTime = (
            (metrics.averageResponseTime * (metrics.totalRequests - 1)) + duration
        ) / metrics.totalRequests;
        
        // Check for memory pressure
        if (memoryUsage && memoryUsage.heapUsed > this.memoryThreshold) {
            metrics.memoryPressureEvents++;
        }
    }
    
    getOperationMetrics(operation: string): OperationPerformance | undefined {
        return this.operationMetrics.get(operation);
    }
    
    getAllMetrics(): OperationPerformance[] {
        return Array.from(this.operationMetrics.values());
    }
    
    getSystemHealth(): {
        memoryUsage: NodeJS.MemoryUsage;
        cpuUsage: NodeJS.CpuUsage;
        uptime: number;
        isHealthy: boolean;
        warnings: string[];
    } {
        const memoryUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        const uptime = process.uptime();
        
        const warnings: string[] = [];
        let isHealthy = true;
        
        // Check memory usage
        if (memoryUsage.heapUsed > this.memoryThreshold) {
            warnings.push(`High memory usage: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`);
            isHealthy = false;
        }
        
        // Check for memory leaks (heap growing continuously)
        if (memoryUsage.heapUsed > memoryUsage.heapTotal * 0.9) {
            warnings.push('Potential memory leak detected');
            isHealthy = false;
        }
        
        return {
            memoryUsage,
            cpuUsage,
            uptime,
            isHealthy,
            warnings
        };
    }
    
    private checkSystemHealth(): void {
        const health = this.getSystemHealth();
        if (!health.isHealthy) {
            // Emit health warning event
            process.emit('performance-warning' as any, {
                warnings: health.warnings,
                memoryUsage: health.memoryUsage,
                timestamp: Date.now()
            } as any);
        }
    }
    
    reset(): void {
        this.operationMetrics.clear();
    }
}