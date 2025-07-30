import { EventEmitter } from 'events';

export interface ErrorContext {
    operation: string;
    uri?: string;
    timestamp: number;
    stackTrace?: string;
    metadata?: Record<string, any>;
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
    private readonly MAX_ERROR_REPORTS = 1000;
    
    constructor() {
        super();
        this.initializeDefaultTimeouts();
        this.startCleanupTimer();
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
        
        // Parse error recovery
        if (errorMessage.includes('parse') || errorMessage.includes('syntax')) {
            return {
                success: false,
                action: 'Syntax error - manual correction required'
            };
        }
        
        // Network/IO error recovery
        if (errorMessage.includes('network') || errorMessage.includes('connection')) {
            return {
                success: false,
                action: 'Network error - retry after delay'
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
}

interface CircuitBreakerState {
    failures: number;
    successes: number;
    lastFailureTime: number;
    state: 'closed' | 'open' | 'half-open';
    config: CircuitBreakerConfig;
}