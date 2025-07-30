import * as fs from 'fs';
import * as path from 'path';
import { PersistentCacheManager } from './persistentCacheManager';

export interface MigrationStep {
    fromVersion: string;
    toVersion: string;
    description: string;
    migrate: (data: any) => Promise<any>;
}

export interface MigrationResult {
    success: boolean;
    fromVersion: string;
    toVersion: string;
    stepsExecuted: number;
    errors: string[];
    warnings: string[];
    backupPath?: string;
}

/**
 * Manages cache migrations between different versions
 */
export class CacheMigrationManager {
    private static readonly MIGRATION_STEPS: MigrationStep[] = [
        {
            fromVersion: '0.9.0',
            toVersion: '1.0.0',
            description: 'Add metadata fields and compression support',
            migrate: async (data: any) => {
                // Add new metadata fields
                if (data.entries) {
                    for (const entry of data.entries) {
                        if (!entry.metadata) {
                            entry.metadata = {
                                size: JSON.stringify(entry.data).length,
                                compressed: false,
                                migrated: true
                            };
                        }
                    }
                }
                
                // Update metadata structure
                if (data.metadata) {
                    data.metadata.compressionType = data.metadata.compressionType || 'none';
                    data.metadata.entryCount = data.entries ? data.entries.length : 0;
                }
                
                return data;
            }
        },
        {
            fromVersion: '1.0.0',
            toVersion: '1.1.0',
            description: 'Add enhanced task symbol fields',
            migrate: async (data: any) => {
                // Migrate task symbols to enhanced format
                if (data.entries) {
                    for (const entry of data.entries) {
                        if (entry.key.startsWith('symbols:') && entry.data.tasks) {
                            for (const [taskKey, taskData] of entry.data.tasks) {
                                if (!taskData.source) {
                                    taskData.source = {
                                        type: 'local',
                                        sourceFile: taskData.sourceFile
                                    };
                                }
                                
                                if (!taskData.originalName) {
                                    taskData.originalName = taskData.name;
                                }
                                
                                if (!taskData.fullyQualifiedName) {
                                    taskData.fullyQualifiedName = taskData.qualifiedName || taskData.name;
                                }
                                
                                if (!taskData.cacheTimestamp) {
                                    taskData.cacheTimestamp = Date.now();
                                }
                            }
                        }
                    }
                }
                
                return data;
            }
        }
    ];
    
    private cacheDir: string;
    
    constructor(cacheDir: string) {
        this.cacheDir = cacheDir;
    }
    
    /**
     * Check if migration is needed
     */
    async needsMigration(currentVersion: string, targetVersion: string): Promise<boolean> {
        const steps = this.getMigrationSteps(currentVersion, targetVersion);
        return steps.length > 0;
    }
    
    /**
     * Get required migration steps
     */
    getMigrationSteps(fromVersion: string, toVersion: string): MigrationStep[] {
        const steps: MigrationStep[] = [];
        
        for (const step of CacheMigrationManager.MIGRATION_STEPS) {
            if (this.isVersionInRange(step.fromVersion, fromVersion, toVersion)) {
                steps.push(step);
            }
        }
        
        // Sort steps by version order
        steps.sort((a, b) => this.compareVersions(a.fromVersion, b.fromVersion));
        
        return steps;
    }
    
    /**
     * Execute migration from one version to another
     */
    async migrate(fromVersion: string, toVersion: string): Promise<MigrationResult> {
        const result: MigrationResult = {
            success: false,
            fromVersion,
            toVersion,
            stepsExecuted: 0,
            errors: [],
            warnings: []
        };
        
        try {
            // Get migration steps
            const steps = this.getMigrationSteps(fromVersion, toVersion);
            
            if (steps.length === 0) {
                result.success = true;
                result.warnings.push('No migration steps required');
                return result;
            }
            
            // Create backup before migration
            result.backupPath = await this.createMigrationBackup(fromVersion, toVersion);
            
            // Execute migration steps
            for (const step of steps) {
                try {
                    await this.executeMigrationStep(step);
                    result.stepsExecuted++;
                } catch (error) {
                    result.errors.push(`Migration step ${step.fromVersion} -> ${step.toVersion} failed: ${error}`);
                    throw error;
                }
            }
            
            result.success = true;
            
        } catch (error) {
            result.errors.push(`Migration failed: ${error}`);
            
            // Attempt to restore from backup
            if (result.backupPath) {
                try {
                    await this.restoreFromBackup(result.backupPath);
                    result.warnings.push('Restored from backup due to migration failure');
                } catch (restoreError) {
                    result.errors.push(`Failed to restore from backup: ${restoreError}`);
                }
            }
        }
        
        return result;
    }
    
    /**
     * Validate migration compatibility
     */
    async validateMigration(fromVersion: string, toVersion: string): Promise<{
        isValid: boolean;
        issues: string[];
        recommendations: string[];
    }> {
        const issues: string[] = [];
        const recommendations: string[] = [];
        
        // Check version format
        if (!this.isValidVersion(fromVersion)) {
            issues.push(`Invalid source version format: ${fromVersion}`);
        }
        
        if (!this.isValidVersion(toVersion)) {
            issues.push(`Invalid target version format: ${toVersion}`);
        }
        
        // Check if downgrade
        if (this.compareVersions(fromVersion, toVersion) > 0) {
            issues.push('Downgrade migrations are not supported');
        }
        
        // Check if cache files exist
        const cacheFiles = ['symbols.cache', 'imports.cache'];
        for (const file of cacheFiles) {
            const filePath = path.join(this.cacheDir, file);
            if (!fs.existsSync(filePath) && !fs.existsSync(filePath + '.gz')) {
                recommendations.push(`Cache file ${file} not found - migration may not be necessary`);
            }
        }
        
        // Check available disk space for backup
        try {
            const stats = await fs.promises.stat(this.cacheDir);
            // Simple check - in real implementation would check actual disk space
            recommendations.push('Ensure sufficient disk space for backup creation');
        } catch (error) {
            issues.push(`Cannot access cache directory: ${error}`);
        }
        
        return {
            isValid: issues.length === 0,
            issues,
            recommendations
        };
    }
    
    /**
     * Get migration history
     */
    async getMigrationHistory(): Promise<Array<{
        fromVersion: string;
        toVersion: string;
        timestamp: number;
        success: boolean;
        backupPath?: string;
    }>> {
        const historyFile = path.join(this.cacheDir, 'migration-history.json');
        
        if (!fs.existsSync(historyFile)) {
            return [];
        }
        
        try {
            const content = await fs.promises.readFile(historyFile, 'utf-8');
            return JSON.parse(content);
        } catch (error) {
            console.warn('Failed to read migration history:', error);
            return [];
        }
    }
    
    /**
     * Record migration in history
     */
    async recordMigration(result: MigrationResult): Promise<void> {
        const historyFile = path.join(this.cacheDir, 'migration-history.json');
        
        try {
            const history = await this.getMigrationHistory();
            
            history.push({
                fromVersion: result.fromVersion,
                toVersion: result.toVersion,
                timestamp: Date.now(),
                success: result.success,
                backupPath: result.backupPath
            });
            
            // Keep only last 10 migration records
            const recentHistory = history.slice(-10);
            
            await fs.promises.writeFile(historyFile, JSON.stringify(recentHistory, null, 2));
        } catch (error) {
            console.warn('Failed to record migration history:', error);
        }
    }
    
    // Private methods
    
    private async executeMigrationStep(step: MigrationStep): Promise<void> {
        console.log(`Executing migration step: ${step.description}`);
        
        // Migrate symbol cache
        await this.migrateCacheFile('symbols.cache', step);
        
        // Migrate import cache
        await this.migrateCacheFile('imports.cache', step);
    }
    
    private async migrateCacheFile(fileName: string, step: MigrationStep): Promise<void> {
        const filePath = path.join(this.cacheDir, fileName);
        const compressedPath = filePath + '.gz';
        
        let data: any = null;
        let isCompressed = false;
        
        // Read cache file
        if (fs.existsSync(compressedPath)) {
            const zlib = require('zlib');
            const compressed = await fs.promises.readFile(compressedPath);
            const decompressed = await zlib.gunzip(compressed);
            data = JSON.parse(decompressed.toString());
            isCompressed = true;
        } else if (fs.existsSync(filePath)) {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            data = JSON.parse(content);
        } else {
            // File doesn't exist, skip migration
            return;
        }
        
        // Apply migration
        const migratedData = await step.migrate(data);
        
        // Write back migrated data
        const serialized = JSON.stringify(migratedData);
        
        if (isCompressed) {
            const zlib = require('zlib');
            const compressed = await zlib.gzip(Buffer.from(serialized));
            await fs.promises.writeFile(compressedPath, compressed);
        } else {
            await fs.promises.writeFile(filePath, serialized);
        }
    }
    
    private async createMigrationBackup(fromVersion: string, toVersion: string): Promise<string> {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupDir = path.join(this.cacheDir, 'backups', `migration-${fromVersion}-to-${toVersion}-${timestamp}`);
        
        await fs.promises.mkdir(backupDir, { recursive: true });
        
        // Copy cache files
        const files = ['symbols.cache', 'symbols.cache.gz', 'imports.cache', 'imports.cache.gz', 'cache.meta'];
        
        for (const file of files) {
            const sourcePath = path.join(this.cacheDir, file);
            const backupPath = path.join(backupDir, file);
            
            if (fs.existsSync(sourcePath)) {
                await fs.promises.copyFile(sourcePath, backupPath);
            }
        }
        
        return backupDir;
    }
    
    private async restoreFromBackup(backupPath: string): Promise<void> {
        if (!fs.existsSync(backupPath)) {
            throw new Error(`Backup path does not exist: ${backupPath}`);
        }
        
        const files = await fs.promises.readdir(backupPath);
        
        for (const file of files) {
            const backupFilePath = path.join(backupPath, file);
            const targetPath = path.join(this.cacheDir, file);
            
            await fs.promises.copyFile(backupFilePath, targetPath);
        }
    }
    
    private isVersionInRange(stepVersion: string, fromVersion: string, toVersion: string): boolean {
        return this.compareVersions(stepVersion, fromVersion) >= 0 && 
               this.compareVersions(stepVersion, toVersion) < 0;
    }
    
    private compareVersions(version1: string, version2: string): number {
        const v1Parts = version1.split('.').map(Number);
        const v2Parts = version2.split('.').map(Number);
        
        for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
            const v1Part = v1Parts[i] || 0;
            const v2Part = v2Parts[i] || 0;
            
            if (v1Part < v2Part) return -1;
            if (v1Part > v2Part) return 1;
        }
        
        return 0;
    }
    
    private isValidVersion(version: string): boolean {
        return /^\d+\.\d+\.\d+$/.test(version);
    }
}