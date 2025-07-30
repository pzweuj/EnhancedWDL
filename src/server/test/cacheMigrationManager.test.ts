import * as fs from 'fs';
import * as path from 'path';
import { CacheMigrationManager } from '../cacheMigrationManager';

describe('CacheMigrationManager', () => {
    let migrationManager: CacheMigrationManager;
    let testCacheDir: string;
    
    beforeEach(() => {
        testCacheDir = path.join(__dirname, 'test-cache-migration');
        if (fs.existsSync(testCacheDir)) {
            fs.rmSync(testCacheDir, { recursive: true });
        }
        fs.mkdirSync(testCacheDir, { recursive: true });
        
        migrationManager = new CacheMigrationManager(testCacheDir);
    });
    
    afterEach(() => {
        if (fs.existsSync(testCacheDir)) {
            fs.rmSync(testCacheDir, { recursive: true });
        }
    });
    
    describe('Migration Detection', () => {
        test('should detect when migration is needed', async () => {
            const needsMigration = await migrationManager.needsMigration('0.9.0', '1.0.0');
            expect(needsMigration).toBe(true);
        });
        
        test('should detect when no migration is needed', async () => {
            const needsMigration = await migrationManager.needsMigration('1.0.0', '1.0.0');
            expect(needsMigration).toBe(false);
        });
        
        test('should get correct migration steps', () => {
            const steps = migrationManager.getMigrationSteps('0.9.0', '1.1.0');
            expect(steps.length).toBeGreaterThan(0);
            expect(steps[0].fromVersion).toBe('0.9.0');
            expect(steps[0].toVersion).toBe('1.0.0');
        });
    });
    
    describe('Migration Validation', () => {
        test('should validate migration compatibility', async () => {
            const validation = await migrationManager.validateMigration('1.0.0', '1.1.0');
            
            expect(validation.isValid).toBe(true);
            expect(Array.isArray(validation.issues)).toBe(true);
            expect(Array.isArray(validation.recommendations)).toBe(true);
        });
        
        test('should detect invalid version formats', async () => {
            const validation = await migrationManager.validateMigration('invalid', '1.0.0');
            
            expect(validation.isValid).toBe(false);
            expect(validation.issues.some(issue => issue.includes('Invalid source version'))).toBe(true);
        });
        
        test('should detect downgrade attempts', async () => {
            const validation = await migrationManager.validateMigration('2.0.0', '1.0.0');
            
            expect(validation.isValid).toBe(false);
            expect(validation.issues.some(issue => issue.includes('Downgrade'))).toBe(true);
        });
    });
    
    describe('Migration Execution', () => {
        test('should execute migration successfully', async () => {
            // Create mock cache files
            const symbolCacheData = {
                metadata: {
                    version: '0.9.0',
                    timestamp: Date.now(),
                    checksum: 'test-checksum',
                    compressionType: 'none',
                    entryCount: 1,
                    totalSize: 100
                },
                entries: [{
                    key: 'symbols:test.wdl',
                    data: {
                        tasks: [['task1', { name: 'TestTask', sourceFile: 'test.wdl' }]]
                    },
                    timestamp: Date.now(),
                    checksum: 'entry-checksum'
                }]
            };
            
            const symbolCachePath = path.join(testCacheDir, 'symbols.cache');
            fs.writeFileSync(symbolCachePath, JSON.stringify(symbolCacheData));
            
            const result = await migrationManager.migrate('0.9.0', '1.0.0');
            
            expect(result.success).toBe(true);
            expect(result.stepsExecuted).toBe(1);
            expect(result.errors).toHaveLength(0);
            expect(result.backupPath).toBeDefined();
        });
        
        test('should handle migration with no steps required', async () => {
            const result = await migrationManager.migrate('1.0.0', '1.0.0');
            
            expect(result.success).toBe(true);
            expect(result.stepsExecuted).toBe(0);
            expect(result.warnings.some(w => w.includes('No migration steps'))).toBe(true);
        });
        
        test('should handle migration errors and restore backup', async () => {
            // Create invalid cache file that will cause migration to fail
            const invalidCachePath = path.join(testCacheDir, 'symbols.cache');
            fs.writeFileSync(invalidCachePath, 'invalid json');
            
            const result = await migrationManager.migrate('0.9.0', '1.0.0');
            
            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });
    });
    
    describe('Migration History', () => {
        test('should record migration history', async () => {
            const mockResult = {
                success: true,
                fromVersion: '0.9.0',
                toVersion: '1.0.0',
                stepsExecuted: 1,
                errors: [],
                warnings: [],
                backupPath: '/test/backup'
            };
            
            await migrationManager.recordMigration(mockResult);
            
            const history = await migrationManager.getMigrationHistory();
            expect(history).toHaveLength(1);
            expect(history[0].fromVersion).toBe('0.9.0');
            expect(history[0].toVersion).toBe('1.0.0');
            expect(history[0].success).toBe(true);
        });
        
        test('should limit migration history to 10 entries', async () => {
            // Add 15 migration records
            for (let i = 0; i < 15; i++) {
                const mockResult = {
                    success: true,
                    fromVersion: `1.${i}.0`,
                    toVersion: `1.${i + 1}.0`,
                    stepsExecuted: 1,
                    errors: [],
                    warnings: []
                };
                
                await migrationManager.recordMigration(mockResult);
            }
            
            const history = await migrationManager.getMigrationHistory();
            expect(history).toHaveLength(10);
            expect(history[0].fromVersion).toBe('1.5.0'); // Should start from the 6th entry
        });
        
        test('should handle missing migration history file', async () => {
            const history = await migrationManager.getMigrationHistory();
            expect(history).toHaveLength(0);
        });
    });
    
    describe('Backup Management', () => {
        test('should create migration backup', async () => {
            // Create some cache files
            fs.writeFileSync(path.join(testCacheDir, 'symbols.cache'), 'test data');
            fs.writeFileSync(path.join(testCacheDir, 'imports.cache'), 'test data');
            
            // Execute migration which should create backup
            const result = await migrationManager.migrate('1.0.0', '1.1.0');
            
            if (result.backupPath) {
                expect(fs.existsSync(result.backupPath)).toBe(true);
                
                const backupFiles = fs.readdirSync(result.backupPath);
                expect(backupFiles).toContain('symbols.cache');
                expect(backupFiles).toContain('imports.cache');
            }
        });
    });
    
    describe('Version Comparison', () => {
        test('should handle version comparison correctly', () => {
            const steps = migrationManager.getMigrationSteps('0.9.0', '1.1.0');
            
            // Should include both 0.9.0->1.0.0 and 1.0.0->1.1.0 steps
            expect(steps.length).toBe(2);
            expect(steps[0].fromVersion).toBe('0.9.0');
            expect(steps[1].fromVersion).toBe('1.0.0');
        });
        
        test('should handle same version migration', () => {
            const steps = migrationManager.getMigrationSteps('1.0.0', '1.0.0');
            expect(steps).toHaveLength(0);
        });
    });
});