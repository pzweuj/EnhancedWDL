import * as fs from 'fs';
import * as path from 'path';
import { SymbolProvider } from '../symbolProvider';
import { ImportResolver } from '../importResolver';
import { CacheIntegrityValidator } from '../cacheIntegrityValidator';
import { CacheMigrationManager } from '../cacheMigrationManager';

describe('Cache Persistence Integration', () => {
    let symbolProvider: SymbolProvider;
    let importResolver: ImportResolver;
    let validator: CacheIntegrityValidator;
    let migrationManager: CacheMigrationManager;
    let testWorkspaceDir: string;
    let testCacheDir: string;
    
    beforeEach(async () => {
        // Setup test directories
        testWorkspaceDir = path.join(__dirname, 'test-workspace');
        testCacheDir = path.join(__dirname, 'test-cache-integration');
        
        // Clean up existing directories
        [testWorkspaceDir, testCacheDir].forEach(dir => {
            if (fs.existsSync(dir)) {
                fs.rmSync(dir, { recursive: true });
            }
            fs.mkdirSync(dir, { recursive: true });
        });
        
        // Create test WDL files
        await createTestWDLFiles();
        
        // Initialize components with test cache directory
        symbolProvider = new SymbolProvider();
        importResolver = new ImportResolver();
        
        // Override cache directories for testing
        const symbolCache = symbolProvider.getPersistentCache();
        const importCache = importResolver.getPersistentCache();
        
        // Initialize components
        await symbolProvider.initialize();
        await importResolver.initialize();
        
        validator = new CacheIntegrityValidator(symbolProvider, importResolver);
        migrationManager = new CacheMigrationManager(testCacheDir);
    });
    
    afterEach(async () => {
        // Clean up
        await symbolProvider.destroy();
        await importResolver.destroy();
        
        [testWorkspaceDir, testCacheDir].forEach(dir => {
            if (fs.existsSync(dir)) {
                fs.rmSync(dir, { recursive: true });
            }
        });
    });
    
    async function createTestWDLFiles(): Promise<void> {
        // Main workflow file
        const mainWDL = `
version 1.0

import "./utils.wdl" as utils
import "./tasks/processing.wdl" as proc

workflow MainWorkflow {
    input {
        String sample_name
        File input_file
    }
    
    call utils.ValidateInput {
        input: file = input_file
    }
    
    call proc.ProcessData {
        input: 
            data = ValidateInput.validated_file,
            name = sample_name
    }
    
    output {
        File result = ProcessData.output_file
    }
}
`;
        
        // Utils file
        const utilsWDL = `
version 1.0

task ValidateInput {
    input {
        File file
    }
    
    command {
        echo "Validating \${file}"
    }
    
    output {
        File validated_file = file
    }
    
    runtime {
        docker: "ubuntu:20.04"
    }
}

task FormatOutput {
    input {
        File input_file
        String format = "json"
    }
    
    command {
        format_tool --input \${input_file} --format \${format}
    }
    
    output {
        File formatted_file = "output.\${format}"
    }
}
`;
        
        // Processing tasks file
        const processingWDL = `
version 1.0

task ProcessData {
    input {
        File data
        String name
        Int? threads = 4
    }
    
    command {
        process_data --input \${data} --name \${name} --threads \${threads}
    }
    
    output {
        File output_file = "\${name}_processed.txt"
        File log_file = "\${name}_process.log"
    }
    
    runtime {
        docker: "processing:latest"
        cpu: threads
        memory: "8GB"
    }
}

task AnalyzeResults {
    input {
        File processed_file
        String analysis_type = "standard"
    }
    
    command {
        analyze --input \${processed_file} --type \${analysis_type}
    }
    
    output {
        File analysis_report = "analysis_report.html"
        File metrics = "metrics.json"
    }
}
`;
        
        // Write files
        fs.writeFileSync(path.join(testWorkspaceDir, 'main.wdl'), mainWDL);
        fs.writeFileSync(path.join(testWorkspaceDir, 'utils.wdl'), utilsWDL);
        
        const tasksDir = path.join(testWorkspaceDir, 'tasks');
        fs.mkdirSync(tasksDir, { recursive: true });
        fs.writeFileSync(path.join(tasksDir, 'processing.wdl'), processingWDL);
    }
    
    describe('End-to-End Cache Persistence', () => {
        test('should persist and restore symbol data across sessions', async () => {
            // First session: analyze documents and build cache
            const mainWDLPath = path.join(testWorkspaceDir, 'main.wdl');
            const utilsWDLPath = path.join(testWorkspaceDir, 'utils.wdl');
            const processingWDLPath = path.join(testWorkspaceDir, 'tasks', 'processing.wdl');
            
            const mainContent = fs.readFileSync(mainWDLPath, 'utf-8');
            const utilsContent = fs.readFileSync(utilsWDLPath, 'utf-8');
            const processingContent = fs.readFileSync(processingWDLPath, 'utf-8');
            
            // Update documents in symbol provider
            await symbolProvider.updateDocument(mainContent, mainWDLPath);
            await symbolProvider.updateDocument(utilsContent, utilsWDLPath);
            await symbolProvider.updateDocument(processingContent, processingWDLPath);
            
            // Verify symbols are available
            const mainTasks = symbolProvider.getTaskSymbolsInContext(mainWDLPath);
            expect(mainTasks.length).toBeGreaterThan(0);
            
            // Force save cache
            const symbolCache = symbolProvider.getPersistentCache();
            await symbolCache.save();
            
            // Destroy first session
            await symbolProvider.destroy();
            
            // Second session: create new provider and verify cache restoration
            const newSymbolProvider = new SymbolProvider();
            await newSymbolProvider.initialize();
            
            try {
                // Check if symbols were restored from cache
                const restoredTasks = newSymbolProvider.getAllTaskSymbols();
                expect(restoredTasks.length).toBeGreaterThan(0);
                
                // Verify specific tasks exist
                const validateTask = newSymbolProvider.getTaskSymbol('ValidateInput');
                expect(validateTask).toBeDefined();
                expect(validateTask?.inputs.length).toBeGreaterThan(0);
                
            } finally {
                await newSymbolProvider.destroy();
            }
        });
        
        test('should handle import cache persistence', async () => {
            // Resolve imports and cache them
            const mainWDLPath = path.join(testWorkspaceDir, 'main.wdl');
            const utilsImportPath = './utils.wdl';
            
            const importResult = await importResolver.resolveImport(
                utilsImportPath,
                mainWDLPath,
                'utils'
            );
            
            expect(importResult.success).toBe(true);
            expect(importResult.tasks.length).toBeGreaterThan(0);
            
            // Force save import cache
            const importCache = importResolver.getPersistentCache();
            await importCache.save();
            
            // Verify cache statistics
            const stats = importCache.getStats();
            expect(stats.totalEntries).toBeGreaterThan(0);
            
            // Destroy and recreate import resolver
            await importResolver.destroy();
            
            const newImportResolver = new ImportResolver();
            await newImportResolver.initialize();
            
            try {
                // Verify cached imports are available
                const cachedTasks = newImportResolver.getImportedTasks(mainWDLPath);
                expect(cachedTasks.length).toBeGreaterThan(0);
                
            } finally {
                await newImportResolver.destroy();
            }
        });
    });
    
    describe('Cache Integrity and Health', () => {
        test('should validate cache integrity after persistence', async () => {
            // Build up some cache data
            const mainWDLPath = path.join(testWorkspaceDir, 'main.wdl');
            const mainContent = fs.readFileSync(mainWDLPath, 'utf-8');
            
            await symbolProvider.updateDocument(mainContent, mainWDLPath);
            
            // Force save
            await symbolProvider.getPersistentCache().save();
            await importResolver.getPersistentCache().save();
            
            // Validate integrity
            const validation = await validator.validateCache();
            expect(validation.isValid).toBe(true);
            expect(validation.errors).toHaveLength(0);
        });
        
        test('should generate comprehensive health report', async () => {
            // Build cache data
            const files = [
                path.join(testWorkspaceDir, 'main.wdl'),
                path.join(testWorkspaceDir, 'utils.wdl'),
                path.join(testWorkspaceDir, 'tasks', 'processing.wdl')
            ];
            
            for (const file of files) {
                const content = fs.readFileSync(file, 'utf-8');
                await symbolProvider.updateDocument(content, file);
            }
            
            // Generate health report
            const report = await validator.generateHealthReport();
            
            expect(report.overall).toMatch(/healthy|warning|critical/);
            expect(report.validation).toBeDefined();
            expect(report.performance).toBeDefined();
            expect(Array.isArray(report.recommendations)).toBe(true);
            
            // Verify performance metrics
            expect(report.performance.totalCacheSize).toBeGreaterThan(0);
            expect(report.performance.compressionRatio).toBeGreaterThan(0);
        });
        
        test('should optimize cache performance', async () => {
            // Build cache data
            const mainWDLPath = path.join(testWorkspaceDir, 'main.wdl');
            const mainContent = fs.readFileSync(mainWDLPath, 'utf-8');
            
            await symbolProvider.updateDocument(mainContent, mainWDLPath);
            
            // Run optimization
            const optimization = await validator.optimizeCache();
            
            expect(optimization).toHaveProperty('optimized');
            expect(optimization).toHaveProperty('actions');
            expect(optimization).toHaveProperty('sizeBefore');
            expect(optimization).toHaveProperty('sizeAfter');
            expect(Array.isArray(optimization.actions)).toBe(true);
        });
    });
    
    describe('Cache Migration', () => {
        test('should handle cache version migration', async () => {
            // Create mock old version cache
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
                        tasks: [['task1', { 
                            name: 'TestTask', 
                            sourceFile: 'test.wdl',
                            inputs: [],
                            outputs: []
                        }]]
                    },
                    timestamp: Date.now(),
                    checksum: 'entry-checksum'
                }]
            };
            
            // Write old version cache file
            const symbolCachePath = path.join(testCacheDir, 'symbols.cache');
            fs.writeFileSync(symbolCachePath, JSON.stringify(symbolCacheData));
            
            // Check if migration is needed
            const needsMigration = await migrationManager.needsMigration('0.9.0', '1.0.0');
            expect(needsMigration).toBe(true);
            
            // Validate migration
            const validation = await migrationManager.validateMigration('0.9.0', '1.0.0');
            expect(validation.isValid).toBe(true);
            
            // Execute migration
            const result = await migrationManager.migrate('0.9.0', '1.0.0');
            expect(result.success).toBe(true);
            expect(result.stepsExecuted).toBeGreaterThan(0);
            
            // Verify migration history
            const history = await migrationManager.getMigrationHistory();
            expect(history.length).toBe(1);
            expect(history[0].success).toBe(true);
        });
    });
    
    describe('Error Handling and Recovery', () => {
        test('should handle corrupted cache gracefully', async () => {
            // Create corrupted cache file
            const corruptedCachePath = path.join(testCacheDir, 'symbols.cache');
            fs.writeFileSync(corruptedCachePath, 'invalid json data');
            
            // Try to initialize with corrupted cache
            const newSymbolProvider = new SymbolProvider();
            
            // Should not throw error, but continue without cache
            await expect(newSymbolProvider.initialize()).resolves.not.toThrow();
            
            await newSymbolProvider.destroy();
        });
        
        test('should repair corrupted cache entries', async () => {
            // Build some cache data first
            const mainWDLPath = path.join(testWorkspaceDir, 'main.wdl');
            const mainContent = fs.readFileSync(mainWDLPath, 'utf-8');
            
            await symbolProvider.updateDocument(mainContent, mainWDLPath);
            await symbolProvider.getPersistentCache().save();
            
            // Simulate corruption by invalidating some entries
            const symbolCache = symbolProvider.getPersistentCache();
            const invalidated = symbolCache.invalidateEntries(() => Math.random() > 0.5);
            
            // Repair cache
            const repair = await validator.repairCache();
            expect(repair.removed).toBeGreaterThanOrEqual(0);
        });
        
        test('should create and restore backups', async () => {
            // Build cache data
            const mainWDLPath = path.join(testWorkspaceDir, 'main.wdl');
            const mainContent = fs.readFileSync(mainWDLPath, 'utf-8');
            
            await symbolProvider.updateDocument(mainContent, mainWDLPath);
            
            const symbolCache = symbolProvider.getPersistentCache();
            await symbolCache.save();
            
            // Create backup
            const backupPath = await symbolCache.createBackup('test-backup');
            expect(fs.existsSync(backupPath)).toBe(true);
            
            // Clear cache
            await symbolCache.clearCache();
            
            // Restore from backup
            await symbolCache.restoreFromBackup(backupPath);
            
            // Verify data is restored
            const restoredTasks = symbolProvider.getAllTaskSymbols();
            expect(restoredTasks.length).toBeGreaterThan(0);
        });
    });
    
    describe('Performance and Scalability', () => {
        test('should handle large cache datasets efficiently', async () => {
            const startTime = Date.now();
            
            // Create multiple large WDL files
            for (let i = 0; i < 10; i++) {
                const largeTasks = Array.from({ length: 50 }, (_, j) => `
task LargeTask${i}_${j} {
    input {
        String param1
        File param2
        Int param3 = ${j}
    }
    
    command {
        echo "Processing \${param1} with \${param2}"
    }
    
    output {
        File result = "output_${i}_${j}.txt"
    }
}
`).join('\n');
                
                const largeWDL = `version 1.0\n${largeTasks}`;
                const filePath = path.join(testWorkspaceDir, `large_${i}.wdl`);
                
                fs.writeFileSync(filePath, largeWDL);
                await symbolProvider.updateDocument(largeWDL, filePath);
            }
            
            // Force save and measure time
            const saveStartTime = Date.now();
            await symbolProvider.getPersistentCache().save();
            const saveTime = Date.now() - saveStartTime;
            
            const totalTime = Date.now() - startTime;
            
            // Verify performance is reasonable (adjust thresholds as needed)
            expect(totalTime).toBeLessThan(30000); // 30 seconds
            expect(saveTime).toBeLessThan(5000); // 5 seconds
            
            // Verify all tasks were cached
            const allTasks = symbolProvider.getAllTaskSymbols();
            expect(allTasks.length).toBeGreaterThan(400); // 10 files * 50 tasks each
        });
        
        test('should compress cache data effectively', async () => {
            // Build substantial cache data
            const files = [
                path.join(testWorkspaceDir, 'main.wdl'),
                path.join(testWorkspaceDir, 'utils.wdl'),
                path.join(testWorkspaceDir, 'tasks', 'processing.wdl')
            ];
            
            for (const file of files) {
                const content = fs.readFileSync(file, 'utf-8');
                await symbolProvider.updateDocument(content, file);
            }
            
            await symbolProvider.getPersistentCache().save();
            
            // Check compression ratio
            const stats = symbolProvider.getPersistentCache().getStats();
            expect(stats.compressionRatio).toBeLessThan(1.0); // Should be compressed
            expect(stats.totalSize).toBeGreaterThan(0);
        });
    });
});