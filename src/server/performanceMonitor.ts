import { EventEmitter } from 'events';

export interface PerformanceReport {
    timestamp: number;
    memoryUsage: {
        heapUsed: number;
        heapTotal: number;
        external: number;
        rss: number;
    };
    completionMetrics: {
        totalRequests: number;
        averageResponseTime: number;
        cacheHitRate: number;
        activeRequests: number;
        queuedRequests: number;
    };
    systemMetrics: {
        cpuUsage: number;
        uptime: number;
    };
    warnings: string[];
}

export interface PerformanceThresholds {
    maxMemoryUsage: number; // bytes
    maxResponseTime: number; // milliseconds
    minCacheHitRate: number; // percentage (0-1)
    maxActiveRequests: number;
    maxQueuedRequests: number;
}

export class PerformanceMonitor extends EventEmitter {
    private reports: PerformanceReport[] = [];
    private thresholds: PerformanceThresholds;
    private monitoringInterval?: NodeJS.Timeout;
    private readonly MAX_REPORTS = 100;
    private readonly DEFAULT_INTERVAL = 30000; // 30 seconds
    
    constructor(thresholds?: Partial<PerformanceThresholds>) {
        super();
        
        this.thresholds = {
            maxMemoryUsage: 200 * 1024 * 1024, // 200MB
            maxResponseTime: 1000, // 1 second
            minCacheHitRate: 0.7, // 70%
            maxActiveRequests: 10,
            maxQueuedRequests: 20,
            ...thresholds
        };
    }
    
    /**
     * Start performance monitoring
     */
    start(interval: number = this.DEFAULT_INTERVAL): void {
        if (this.monitoringInterval) {
            this.stop();
        }
        
        this.monitoringInterval = setInterval(() => {
            this.collectMetrics();
        }, interval);
        
        this.emit('started', { interval });
    }
    
    /**
     * Stop performance monitoring
     */
    stop(): void {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = undefined;
            this.emit('stopped');
        }
    }
    
    /**
     * Collect current performance metrics
     */
    collectMetrics(completionMetrics?: any): PerformanceReport {
        const memoryUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        const uptime = process.uptime();
        
        const report: PerformanceReport = {
            timestamp: Date.now(),
            memoryUsage: {
                heapUsed: memoryUsage.heapUsed,
                heapTotal: memoryUsage.heapTotal,
                external: memoryUsage.external,
                rss: memoryUsage.rss
            },
            completionMetrics: completionMetrics || {
                totalRequests: 0,
                averageResponseTime: 0,
                cacheHitRate: 0,
                activeRequests: 0,
                queuedRequests: 0
            },
            systemMetrics: {
                cpuUsage: (cpuUsage.user + cpuUsage.system) / 1000, // Convert to milliseconds
                uptime
            },
            warnings: this.checkThresholds(memoryUsage, completionMetrics)
        };
        
        // Store report
        this.reports.push(report);
        
        // Keep only recent reports
        if (this.reports.length > this.MAX_REPORTS) {
            this.reports = this.reports.slice(-this.MAX_REPORTS);
        }
        
        // Emit events for warnings
        if (report.warnings.length > 0) {
            this.emit('warning', report.warnings);
        }
        
        this.emit('report', report);
        
        return report;
    }
    
    /**
     * Check performance thresholds and generate warnings
     */
    private checkThresholds(memoryUsage: NodeJS.MemoryUsage, completionMetrics?: any): string[] {
        const warnings: string[] = [];
        
        // Memory usage check
        if (memoryUsage.heapUsed > this.thresholds.maxMemoryUsage) {
            warnings.push(`High memory usage: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`);
        }
        
        if (completionMetrics) {
            // Response time check
            if (completionMetrics.averageResponseTime > this.thresholds.maxResponseTime) {
                warnings.push(`Slow response time: ${completionMetrics.averageResponseTime}ms`);
            }
            
            // Cache hit rate check
            if (completionMetrics.cacheHitRate < this.thresholds.minCacheHitRate) {
                warnings.push(`Low cache hit rate: ${Math.round(completionMetrics.cacheHitRate * 100)}%`);
            }
            
            // Active requests check
            if (completionMetrics.activeRequests > this.thresholds.maxActiveRequests) {
                warnings.push(`Too many active requests: ${completionMetrics.activeRequests}`);
            }
            
            // Queued requests check
            if (completionMetrics.queuedRequests > this.thresholds.maxQueuedRequests) {
                warnings.push(`Too many queued requests: ${completionMetrics.queuedRequests}`);
            }
        }
        
        return warnings;
    }
    
    /**
     * Get recent performance reports
     */
    getReports(count?: number): PerformanceReport[] {
        if (count) {
            return this.reports.slice(-count);
        }
        return [...this.reports];
    }
    
    /**
     * Get latest performance report
     */
    getLatestReport(): PerformanceReport | undefined {
        return this.reports[this.reports.length - 1];
    }
    
    /**
     * Get performance summary over a time period
     */
    getSummary(timeWindowMs: number = 300000): { // 5 minutes default
        averageMemoryUsage: number;
        peakMemoryUsage: number;
        averageResponseTime: number;
        peakResponseTime: number;
        averageCacheHitRate: number;
        totalWarnings: number;
        reportCount: number;
    } {
        const cutoffTime = Date.now() - timeWindowMs;
        const recentReports = this.reports.filter(report => report.timestamp > cutoffTime);
        
        if (recentReports.length === 0) {
            return {
                averageMemoryUsage: 0,
                peakMemoryUsage: 0,
                averageResponseTime: 0,
                peakResponseTime: 0,
                averageCacheHitRate: 0,
                totalWarnings: 0,
                reportCount: 0
            };
        }
        
        const memoryUsages = recentReports.map(r => r.memoryUsage.heapUsed);
        const responseTimes = recentReports.map(r => r.completionMetrics.averageResponseTime);
        const cacheHitRates = recentReports.map(r => r.completionMetrics.cacheHitRate);
        const totalWarnings = recentReports.reduce((sum, r) => sum + r.warnings.length, 0);
        
        return {
            averageMemoryUsage: memoryUsages.reduce((sum, val) => sum + val, 0) / memoryUsages.length,
            peakMemoryUsage: Math.max(...memoryUsages),
            averageResponseTime: responseTimes.reduce((sum, val) => sum + val, 0) / responseTimes.length,
            peakResponseTime: Math.max(...responseTimes),
            averageCacheHitRate: cacheHitRates.reduce((sum, val) => sum + val, 0) / cacheHitRates.length,
            totalWarnings,
            reportCount: recentReports.length
        };
    }
    
    /**
     * Clear all stored reports
     */
    clearReports(): void {
        this.reports = [];
        this.emit('cleared');
    }
    
    /**
     * Update performance thresholds
     */
    updateThresholds(newThresholds: Partial<PerformanceThresholds>): void {
        this.thresholds = { ...this.thresholds, ...newThresholds };
        this.emit('thresholds-updated', this.thresholds);
    }
    
    /**
     * Get current thresholds
     */
    getThresholds(): PerformanceThresholds {
        return { ...this.thresholds };
    }
    
    /**
     * Check if monitoring is active
     */
    isMonitoring(): boolean {
        return this.monitoringInterval !== undefined;
    }
    
    /**
     * Get monitoring statistics
     */
    getMonitoringStats(): {
        isActive: boolean;
        reportCount: number;
        oldestReportAge: number;
        newestReportAge: number;
    } {
        const now = Date.now();
        const oldestReport = this.reports[0];
        const newestReport = this.reports[this.reports.length - 1];
        
        return {
            isActive: this.isMonitoring(),
            reportCount: this.reports.length,
            oldestReportAge: oldestReport ? now - oldestReport.timestamp : 0,
            newestReportAge: newestReport ? now - newestReport.timestamp : 0
        };
    }
    
    /**
     * Force garbage collection if available (for testing)
     */
    forceGarbageCollection(): boolean {
        if (global.gc) {
            global.gc();
            return true;
        }
        return false;
    }
    
    /**
     * Destroy the performance monitor
     */
    destroy(): void {
        this.stop();
        this.clearReports();
        this.removeAllListeners();
    }
}