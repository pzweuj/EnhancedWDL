import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

export enum LogLevel {
    TRACE = 0,
    DEBUG = 1,
    INFO = 2,
    WARN = 3,
    ERROR = 4,
    FATAL = 5
}

export interface LogEntry {
    timestamp: number;
    level: LogLevel;
    message: string;
    category: string;
    metadata?: Record<string, any>;
    stackTrace?: string;
    correlationId?: string;
}

export interface LoggerConfig {
    level: LogLevel;
    enableConsole: boolean;
    enableFile: boolean;
    logDirectory?: string;
    maxFileSize: number;
    maxFiles: number;
    enableStructuredLogging: boolean;
    enableCorrelationId: boolean;
}

export class Logger extends EventEmitter {
    private config: LoggerConfig;
    private logBuffer: LogEntry[] = [];
    private currentLogFile?: string;
    private fileWriteStream?: fs.WriteStream;
    private correlationIdCounter = 0;
    
    private readonly BUFFER_SIZE = 100;
    private readonly FLUSH_INTERVAL = 5000; // 5 seconds
    
    constructor(config: Partial<LoggerConfig> = {}) {
        super();
        
        this.config = {
            level: LogLevel.INFO,
            enableConsole: true,
            enableFile: false,
            logDirectory: './logs',
            maxFileSize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5,
            enableStructuredLogging: true,
            enableCorrelationId: false,
            ...config
        };
        
        this.initializeFileLogging();
        this.startFlushTimer();
    }
    
    /**
     * Initialize file logging
     */
    private initializeFileLogging(): void {
        if (!this.config.enableFile || !this.config.logDirectory) {
            return;
        }
        
        try {
            // Ensure log directory exists
            if (!fs.existsSync(this.config.logDirectory)) {
                fs.mkdirSync(this.config.logDirectory, { recursive: true });
            }
            
            // Create log file name with timestamp
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            this.currentLogFile = path.join(this.config.logDirectory, `wdl-enhanced-${timestamp}.log`);
            
            // Create write stream
            this.fileWriteStream = fs.createWriteStream(this.currentLogFile, { flags: 'a' });
            
            this.fileWriteStream.on('error', (error) => {
                console.error('Log file write error:', error);
                this.emit('file-error', error);
            });
            
        } catch (error) {
            console.error('Failed to initialize file logging:', error);
            this.config.enableFile = false;
        }
    }
    
    /**
     * Log trace message
     */
    trace(message: string, category: string = 'general', metadata?: Record<string, any>): void {
        this.log(LogLevel.TRACE, message, category, metadata);
    }
    
    /**
     * Log debug message
     */
    debug(message: string, category: string = 'general', metadata?: Record<string, any>): void {
        this.log(LogLevel.DEBUG, message, category, metadata);
    }
    
    /**
     * Log info message
     */
    info(message: string, category: string = 'general', metadata?: Record<string, any>): void {
        this.log(LogLevel.INFO, message, category, metadata);
    }
    
    /**
     * Log warning message
     */
    warn(message: string, category: string = 'general', metadata?: Record<string, any>): void {
        this.log(LogLevel.WARN, message, category, metadata);
    }
    
    /**
     * Log error message
     */
    error(message: string, category: string = 'general', metadata?: Record<string, any>, error?: Error): void {
        const logMetadata = { ...metadata };
        if (error) {
            logMetadata.error = {
                name: error.name,
                message: error.message,
                stack: error.stack
            };
        }
        
        this.log(LogLevel.ERROR, message, category, logMetadata, error?.stack);
    }
    
    /**
     * Log fatal message
     */
    fatal(message: string, category: string = 'general', metadata?: Record<string, any>, error?: Error): void {
        const logMetadata = { ...metadata };
        if (error) {
            logMetadata.error = {
                name: error.name,
                message: error.message,
                stack: error.stack
            };
        }
        
        this.log(LogLevel.FATAL, message, category, logMetadata, error?.stack);
    }
    
    /**
     * Core logging method
     */
    private log(
        level: LogLevel,
        message: string,
        category: string,
        metadata?: Record<string, any>,
        stackTrace?: string
    ): void {
        // Check if log level is enabled
        if (level < this.config.level) {
            return;
        }
        
        const entry: LogEntry = {
            timestamp: Date.now(),
            level,
            message,
            category,
            metadata,
            stackTrace,
            correlationId: this.config.enableCorrelationId ? this.generateCorrelationId() : undefined
        };
        
        // Add to buffer
        this.logBuffer.push(entry);
        
        // Console logging
        if (this.config.enableConsole) {
            this.writeToConsole(entry);
        }
        
        // Emit log event
        this.emit('log', entry);
        
        // Flush buffer if needed
        if (this.logBuffer.length >= this.BUFFER_SIZE) {
            this.flushBuffer();
        }
    }
    
    /**
     * Write log entry to console
     */
    private writeToConsole(entry: LogEntry): void {
        const timestamp = new Date(entry.timestamp).toISOString();
        const levelName = LogLevel[entry.level];
        const prefix = `[${timestamp}] [${levelName}] [${entry.category}]`;
        
        let output = `${prefix} ${entry.message}`;
        
        if (entry.metadata && Object.keys(entry.metadata).length > 0) {
            if (this.config.enableStructuredLogging) {
                output += ` ${JSON.stringify(entry.metadata)}`;
            } else {
                const metadataStr = Object.entries(entry.metadata)
                    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
                    .join(' ');
                output += ` {${metadataStr}}`;
            }
        }
        
        if (entry.correlationId) {
            output += ` [${entry.correlationId}]`;
        }
        
        // Use appropriate console method based on log level
        switch (entry.level) {
            case LogLevel.TRACE:
            case LogLevel.DEBUG:
                console.debug(output);
                break;
            case LogLevel.INFO:
                console.info(output);
                break;
            case LogLevel.WARN:
                console.warn(output);
                break;
            case LogLevel.ERROR:
            case LogLevel.FATAL:
                console.error(output);
                if (entry.stackTrace) {
                    console.error(entry.stackTrace);
                }
                break;
        }
    }
    
    /**
     * Write log entry to file
     */
    private writeToFile(entry: LogEntry): void {
        if (!this.fileWriteStream || !this.config.enableFile) {
            return;
        }
        
        try {
            let logLine: string;
            
            if (this.config.enableStructuredLogging) {
                // JSON format
                logLine = JSON.stringify({
                    timestamp: new Date(entry.timestamp).toISOString(),
                    level: LogLevel[entry.level],
                    category: entry.category,
                    message: entry.message,
                    metadata: entry.metadata,
                    stackTrace: entry.stackTrace,
                    correlationId: entry.correlationId
                }) + '\n';
            } else {
                // Plain text format
                const timestamp = new Date(entry.timestamp).toISOString();
                const levelName = LogLevel[entry.level];
                logLine = `[${timestamp}] [${levelName}] [${entry.category}] ${entry.message}`;
                
                if (entry.metadata) {
                    logLine += ` ${JSON.stringify(entry.metadata)}`;
                }
                
                if (entry.correlationId) {
                    logLine += ` [${entry.correlationId}]`;
                }
                
                if (entry.stackTrace) {
                    logLine += `\n${entry.stackTrace}`;
                }
                
                logLine += '\n';
            }
            
            this.fileWriteStream.write(logLine);
            
            // Check file size and rotate if needed
            this.checkFileRotation();
            
        } catch (error) {
            console.error('Failed to write to log file:', error);
            this.emit('file-error', error);
        }
    }
    
    /**
     * Flush log buffer to file
     */
    private flushBuffer(): void {
        if (this.logBuffer.length === 0) {
            return;
        }
        
        // Write all buffered entries to file
        for (const entry of this.logBuffer) {
            this.writeToFile(entry);
        }
        
        // Clear buffer
        this.logBuffer = [];
        
        this.emit('buffer-flushed', { entriesWritten: this.logBuffer.length });
    }
    
    /**
     * Check if log file needs rotation
     */
    private checkFileRotation(): void {
        if (!this.currentLogFile || !this.config.enableFile) {
            return;
        }
        
        try {
            const stats = fs.statSync(this.currentLogFile);
            if (stats.size >= this.config.maxFileSize) {
                this.rotateLogFile();
            }
        } catch (error) {
            console.error('Failed to check log file size:', error);
        }
    }
    
    /**
     * Rotate log file
     */
    private rotateLogFile(): void {
        if (!this.config.logDirectory) {
            return;
        }
        
        try {
            // Close current stream
            if (this.fileWriteStream) {
                this.fileWriteStream.end();
            }
            
            // Clean up old log files
            this.cleanupOldLogFiles();
            
            // Create new log file
            this.initializeFileLogging();
            
            this.emit('file-rotated', { newFile: this.currentLogFile });
            
        } catch (error) {
            console.error('Failed to rotate log file:', error);
            this.emit('file-error', error);
        }
    }
    
    /**
     * Clean up old log files
     */
    private cleanupOldLogFiles(): void {
        if (!this.config.logDirectory) {
            return;
        }
        
        try {
            const files = fs.readdirSync(this.config.logDirectory)
                .filter(file => file.startsWith('wdl-enhanced-') && file.endsWith('.log'))
                .map(file => ({
                    name: file,
                    path: path.join(this.config.logDirectory!, file),
                    stats: fs.statSync(path.join(this.config.logDirectory!, file))
                }))
                .sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime());
            
            // Remove excess files
            if (files.length >= this.config.maxFiles) {
                const filesToRemove = files.slice(this.config.maxFiles - 1);
                for (const file of filesToRemove) {
                    fs.unlinkSync(file.path);
                }
            }
            
        } catch (error) {
            console.error('Failed to cleanup old log files:', error);
        }
    }
    
    /**
     * Generate correlation ID
     */
    private generateCorrelationId(): string {
        return `${Date.now()}-${++this.correlationIdCounter}`;
    }
    
    /**
     * Start flush timer
     */
    private startFlushTimer(): void {
        setInterval(() => {
            this.flushBuffer();
        }, this.FLUSH_INTERVAL);
    }
    
    /**
     * Set log level
     */
    setLevel(level: LogLevel): void {
        this.config.level = level;
        this.emit('level-changed', level);
    }
    
    /**
     * Get current log level
     */
    getLevel(): LogLevel {
        return this.config.level;
    }
    
    /**
     * Enable/disable console logging
     */
    setConsoleEnabled(enabled: boolean): void {
        this.config.enableConsole = enabled;
    }
    
    /**
     * Enable/disable file logging
     */
    setFileEnabled(enabled: boolean): void {
        this.config.enableFile = enabled;
        if (enabled && !this.fileWriteStream) {
            this.initializeFileLogging();
        } else if (!enabled && this.fileWriteStream) {
            this.fileWriteStream.end();
            this.fileWriteStream = undefined;
        }
    }
    
    /**
     * Get logger statistics
     */
    getStatistics(): {
        bufferedEntries: number;
        currentLogFile?: string;
        fileLoggingEnabled: boolean;
        consoleLoggingEnabled: boolean;
        currentLevel: string;
    } {
        return {
            bufferedEntries: this.logBuffer.length,
            currentLogFile: this.currentLogFile,
            fileLoggingEnabled: this.config.enableFile,
            consoleLoggingEnabled: this.config.enableConsole,
            currentLevel: LogLevel[this.config.level]
        };
    }
    
    /**
     * Force flush buffer
     */
    flush(): void {
        this.flushBuffer();
    }
    
    /**
     * Close logger and cleanup resources
     */
    close(): void {
        // Flush remaining buffer
        this.flushBuffer();
        
        // Close file stream
        if (this.fileWriteStream) {
            this.fileWriteStream.end();
            this.fileWriteStream = undefined;
        }
        
        // Remove all listeners
        this.removeAllListeners();
    }
}

// Create default logger instance
export const logger = new Logger({
    level: LogLevel.INFO,
    enableConsole: true,
    enableFile: false,
    enableStructuredLogging: true,
    enableCorrelationId: false
});