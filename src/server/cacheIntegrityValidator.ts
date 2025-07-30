import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { PersistentCacheManager } from './persistentCacheManager';
import { SymbolProvider } from './symbolProvider';
import { ImportResolver } from './importResolver';

export interface ValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    stats: {
        totalEntries: number;
        validEntries: number;
        invalidEntries: number;
        corruptedEntries: number;
        missingFiles: number;
    };
}

export interface ValidationOptions {
    checkFileIntegrity?: boolean;
    checkChecksums?: boolean;
    checkTimestamps?: boolean;
    repairCorrupted?: boolean;
    verbose?: boolean;
}

/**
 * Utility class for validating cache integrity and performing repairs
 */
export class CacheIntegrityValidator {
    private symbolProvider: SymbolProvider;
    private importResolver: ImportResolver;
    
    constructor(symbolProvider: SymbolProvider, importResolver: ImportResolver) {
        this.symbolProvider = symbolProvider;
        this.importResolver = importResolver;
    }
    
    /**
     * Validate the integrity of all cache data
     */
    async validateCache(options: ValidationOptions = {}): Promise<ValidationResult> {
        const opts = {
            checkFileIntegrity: true,
            checkChecksums: true,
            checkTimestamps: true,
            repairCorrupted: false,
            verbose: false,
            ...options
        };
        
        const result: ValidationResult = {
            isValid: true,
            errors: [],
            warnings: [],
            stats: {
                totalEntries: 0,
                validEntries: 0,
                invalidEntries: 0,
                corruptedEntries: 0,
                missingFiles: 0
            }
        };
        
        try {
            // Validate symbol cache
            const symbolCacheResult = await this.validateSymbolCache(opts);
            this.mergeValidationResults(result, symbolCacheResult);
            
            // Validate import cache
            const importCacheResult = await this.validateImportCache(opts);
            this.mergeValidationResults(result, importCacheResult);
            
            // Validate cache files on disk
            const fileCacheResult = await this.validateCacheFiles(opts);
            this.mergeValidationResults(result, fileCacheResult);
            
            // Overall validation status
            result.isValid = result.errors.length === 0 && result.stats.corruptedEntries === 0;
            
            if (opts.verbose) {
                console.log('Cache validation completed:', result);
            }
            
        } catch (error) {
            result.isValid = false;
            result.errors.push(`Cache validation failed: ${error}`);
        }
        
        return result;
    }
    
    /**
     * Repair corrupted cache entries
     */
    async repairCache(validationResult?: ValidationResult): Promise<{
        repaired: number;
        removed: number;
        errors: string[];
    }> {
        const result = {
            repaired: 0,
            removed: 0,
            errors: [] as string[]
        };
        
        try {
            // If no validation result provided, run validation first
            if (!validationResult) {
                validationResult = await this.validateCache({ repairCorrupted: false });
            }
            
            // Get persistent cache managers
            const symbolPersistentCache = this.symbolProvider.getPersistentCache();
            const importPersistentCache = this.importResolver.getPersistentCache();
            
            // Repair symbol cache
            const symbolRepairResult = await this.repairSymbolCache(symbolPersistentCache);
            result.repaired += symbolRepairResult.repaired;
            result.removed += symbolRepairResult.removed;
            result.errors.push(...symbolRepairResult.errors);
            
            // Repair import cache
            const importRepairResult = await this.repairImportCache(importPersistentCache);
            result.repaired += importRepairResult.repaired;
            result.removed += importRepairResult.removed;
            result.errors.push(...importRepairResult.errors);
            
        } catch (error) {
            result.errors.push(`Cache repair failed: ${error}`);
        }
        
        return result;
    }
    
    /**
     * Create a cache health report
     */
    async generateHealthReport(): Promise<{
        overall: 'healthy' | 'warning' | 'critical';
        validation: ValidationResult;
        recommendations: string[];
        performance: {
            symbolCacheHitRate: number;
            importCacheHitRate: number;
            totalCacheSize: number;
            compressionRatio: number;
        };
    }> {
        const validation = await this.validateCache({ verbose: true });
        const recommendations: string[] = [];
        
        // Get performance metrics
        const symbolPersistentCache = this.symbolProvider.getPersistentCache();
        const importPersistentCache = this.importResolver.getPersistentCache();
        
        const symbolStats = symbolPersistentCache.getStats();
        const importStats = importPersistentCache.getStats();
        
        const performance = {
            symbolCacheHitRate: 0, // Would need to get from in-memory cache
            importCacheHitRate: 0, // Would need to get from in-memory cache
            totalCacheSize: symbolStats.totalSize + importStats.totalSize,
            compressionRatio: (symbolStats.compressionRatio + importStats.compressionRatio) / 2
        };
        
        // Determine overall health
        let overall: 'healthy' | 'warning' | 'critical' = 'healthy';
        
        if (validation.stats.corruptedEntries > 0) {
            overall = 'critical';
            recommendations.push('Run cache repair to fix corrupted entries');
        } else if (validation.stats.invalidEntries > validation.stats.totalEntries * 0.1) {
            overall = 'warning';
            recommendations.push('Consider clearing and rebuilding cache due to high invalid entry count');
        }
        
        if (performance.totalCacheSize > 500 * 1024 * 1024) { // 500MB
            if (overall === 'healthy') overall = 'warning';
            recommendations.push('Cache size is large, consider cleanup or increasing compression');
        }
        
        if (performance.compressionRatio > 0.8) {
            recommendations.push('Enable compression to reduce cache size');
        }
        
        if (validation.warnings.length > 0) {
            if (overall === 'healthy') overall = 'warning';
            recommendations.push('Address cache warnings to improve performance');
        }
        
        return {
            overall,
            validation,
            recommendations,
            performance
        };
    }
    
    /**
     * Optimize cache performance
     */
    async optimizeCache(): Promise<{
        optimized: boolean;
        actions: string[];
        sizeBefore: number;
        sizeAfter: number;
    }> {
        const result = {
            optimized: false,
            actions: [] as string[],
            sizeBefore: 0,
            sizeAfter: 0
        };
        
        try {
            const symbolPersistentCache = this.symbolProvider.getPersistentCache();
            const importPersistentCache = this.importResolver.getPersistentCache();
            
            // Get initial size
            const initialSymbolStats = symbolPersistentCache.getStats();
            const initialImportStats = importPersistentCache.getStats();
            result.sizeBefore = initialSymbolStats.totalSize + initialImportStats.totalSize;
            
            // Remove old entries (older than 7 days)
            const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
            const symbolInvalidated = symbolPersistentCache.invalidateOlderThan(weekAgo);
            const importInvalidated = importPersistentCache.invalidateOlderThan(weekAgo);
            
            if (symbolInvalidated > 0 || importInvalidated > 0) {
                result.actions.push(`Removed ${symbolInvalidated + importInvalidated} old cache entries`);
            }
            
            // Force save to apply compression
            await symbolPersistentCache.save();
            await importPersistentCache.save();
            result.actions.push('Applied compression to cache files');
            
            // Get final size
            const finalSymbolStats = symbolPersistentCache.getStats();
            const finalImportStats = importPersistentCache.getStats();
            result.sizeAfter = finalSymbolStats.totalSize + finalImportStats.totalSize;
            
            result.optimized = result.sizeAfter < result.sizeBefore || result.actions.length > 0;
            
        } catch (error) {
            result.actions.push(`Optimization failed: ${error}`);
        }
        
        return result;
    }
    
    // Private methods
    
    private async validateSymbolCache(options: ValidationOptions): Promise<ValidationResult> {
        const result: ValidationResult = {
            isValid: true,
            errors: [],
            warnings: [],
            stats: {
                totalEntries: 0,
                validEntries: 0,
                invalidEntries: 0,
                corruptedEntries: 0,
                missingFiles: 0
            }
        };
        
        try {
            const persistentCache = this.symbolProvider.getPersistentCache();
            const integrity = await persistentCache.verifyCacheIntegrity();
            
            if (!integrity.isValid) {
                result.isValid = false;
                result.errors.push(...integrity.errors);
                result.stats.corruptedEntries = integrity.errors.length;
            }
            
            const stats = persistentCache.getStats();
            result.stats.totalEntries += stats.totalEntries;
            result.stats.validEntries += stats.totalEntries - result.stats.corruptedEntries;
            
        } catch (error) {
            result.isValid = false;
            result.errors.push(`Symbol cache validation failed: ${error}`);
        }
        
        return result;
    }
    
    private async validateImportCache(options: ValidationOptions): Promise<ValidationResult> {
        const result: ValidationResult = {
            isValid: true,
            errors: [],
            warnings: [],
            stats: {
                totalEntries: 0,
                validEntries: 0,
                invalidEntries: 0,
                corruptedEntries: 0,
                missingFiles: 0
            }
        };
        
        try {
            const persistentCache = this.importResolver.getPersistentCache();
            const integrity = await persistentCache.verifyCacheIntegrity();
            
            if (!integrity.isValid) {
                result.isValid = false;
                result.errors.push(...integrity.errors);
                result.stats.corruptedEntries = integrity.errors.length;
            }
            
            const stats = persistentCache.getStats();
            result.stats.totalEntries += stats.totalEntries;
            result.stats.validEntries += stats.totalEntries - result.stats.corruptedEntries;
            
        } catch (error) {
            result.isValid = false;
            result.errors.push(`Import cache validation failed: ${error}`);
        }
        
        return result;
    }
    
    private async validateCacheFiles(options: ValidationOptions): Promise<ValidationResult> {
        const result: ValidationResult = {
            isValid: true,
            errors: [],
            warnings: [],
            stats: {
                totalEntries: 0,
                validEntries: 0,
                invalidEntries: 0,
                corruptedEntries: 0,
                missingFiles: 0
            }
        };
        
        // Check if cache directories exist and are accessible
        const cacheDirs = ['.wdl-cache/symbols', '.wdl-cache/imports'];
        
        for (const cacheDir of cacheDirs) {
            if (!fs.existsSync(cacheDir)) {
                result.warnings.push(`Cache directory does not exist: ${cacheDir}`);
                continue;
            }
            
            try {
                await fs.promises.access(cacheDir, fs.constants.R_OK | fs.constants.W_OK);
            } catch (error) {
                result.isValid = false;
                result.errors.push(`Cache directory not accessible: ${cacheDir}`);
            }
        }
        
        return result;
    }
    
    private mergeValidationResults(target: ValidationResult, source: ValidationResult): void {
        target.isValid = target.isValid && source.isValid;
        target.errors.push(...source.errors);
        target.warnings.push(...source.warnings);
        
        target.stats.totalEntries += source.stats.totalEntries;
        target.stats.validEntries += source.stats.validEntries;
        target.stats.invalidEntries += source.stats.invalidEntries;
        target.stats.corruptedEntries += source.stats.corruptedEntries;
        target.stats.missingFiles += source.stats.missingFiles;
    }
    
    private async repairSymbolCache(persistentCache: PersistentCacheManager): Promise<{
        repaired: number;
        removed: number;
        errors: string[];
    }> {
        const result = { repaired: 0, removed: 0, errors: [] as string[] };
        
        try {
            // Remove corrupted entries
            const removed = persistentCache.invalidateEntries((key, entry) => {
                // Simple corruption check - could be enhanced
                try {
                    JSON.stringify(entry.data);
                    return false; // Valid entry
                } catch (error) {
                    return true; // Corrupted entry
                }
            });
            
            result.removed = removed;
            
            // Save cleaned cache
            await persistentCache.save();
            
        } catch (error) {
            result.errors.push(`Symbol cache repair failed: ${error}`);
        }
        
        return result;
    }
    
    private async repairImportCache(persistentCache: PersistentCacheManager): Promise<{
        repaired: number;
        removed: number;
        errors: string[];
    }> {
        const result = { repaired: 0, removed: 0, errors: [] as string[] };
        
        try {
            // Remove corrupted entries
            const removed = persistentCache.invalidateEntries((key, entry) => {
                // Simple corruption check - could be enhanced
                try {
                    JSON.stringify(entry.data);
                    return false; // Valid entry
                } catch (error) {
                    return true; // Corrupted entry
                }
            });
            
            result.removed = removed;
            
            // Save cleaned cache
            await persistentCache.save();
            
        } catch (error) {
            result.errors.push(`Import cache repair failed: ${error}`);
        }
        
        return result;
    }
}