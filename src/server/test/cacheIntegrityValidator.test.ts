import * as fs from 'fs';
import * as path from 'path';
import { CacheIntegrityValidator } from '../cacheIntegrityValidator';
import { SymbolProvider } from '../symbolProvider';
import { ImportResolver } from '../importResolver';

// Mock the dependencies
jest.mock('../symbolProvider');
jest.mock('../importResolver');

describe('CacheIntegrityValidator', () => {
    let validator: CacheIntegrityValidator;
    let mockSymbolProvider: jest.Mocked<SymbolProvider>;
    let mockImportResolver: jest.Mocked<ImportResolver>;
    let testCacheDir: string;
    
    beforeEach(() => {
        testCacheDir = path.join(__dirname, 'test-cache-validation');
        if (fs.existsSync(testCacheDir)) {
            fs.rmSync(testCacheDir, { recursive: true });
        }
        fs.mkdirSync(testCacheDir, { recursive: true });
        
        // Create mock instances
        mockSymbolProvider = new SymbolProvider() as jest.Mocked<SymbolProvider>;
        mockImportResolver = new ImportResolver() as jest.Mocked<ImportResolver>;
        
        // Mock the getPersistentCache methods
        const mockPersistentCache = {
            verifyCacheIntegrity: jest.fn().mockResolvedValue({ isValid: true, errors: [] }),
            getStats: jest.fn().mockReturnValue({
                totalEntries: 10,
                totalSize: 1024,
                compressionRatio: 0.7,
                lastSave: Date.now(),
                lastLoad: Date.now(),
                saveCount: 5,
                loadCount: 3,
                errorCount: 0
            }),
            invalidateOlderThan: jest.fn().mockReturnValue(2),
            save: jest.fn().mockResolvedValue(undefined)
        };
        
        mockSymbolProvider.getPersistentCache = jest.fn().mockReturnValue(mockPersistentCache);
        mockImportResolver.getPersistentCache = jest.fn().mockReturnValue(mockPersistentCache);
        
        validator = new CacheIntegrityValidator(mockSymbolProvider, mockImportResolver);
    });
    
    afterEach(() => {
        if (fs.existsSync(testCacheDir)) {
            fs.rmSync(testCacheDir, { recursive: true });
        }
    });
    
    describe('Cache Validation', () => {
        test('should validate cache successfully', async () => {
            const result = await validator.validateCache();
            
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
            expect(result.stats.totalEntries).toBe(20); // 10 from each cache
        });
        
        test('should detect cache corruption', async () => {
            // Mock corrupted cache
            const mockCorruptedCache = {
                verifyCacheIntegrity: jest.fn().mockResolvedValue({
                    isValid: false,
                    errors: ['Checksum mismatch in entry xyz']
                }),
                getStats: jest.fn().mockReturnValue({
                    totalEntries: 5,
                    totalSize: 512,
                    compressionRatio: 0.8,
                    lastSave: Date.now(),
                    lastLoad: Date.now(),
                    saveCount: 2,
                    loadCount: 1,
                    errorCount: 1
                })
            };
            
            mockSymbolProvider.getPersistentCache = jest.fn().mockReturnValue(mockCorruptedCache);
            
            const result = await validator.validateCache();
            
            expect(result.isValid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.stats.corruptedEntries).toBeGreaterThan(0);
        });
        
        test('should validate with custom options', async () => {
            const result = await validator.validateCache({
                checkFileIntegrity: true,
                checkChecksums: true,
                checkTimestamps: false,
                verbose: true
            });
            
            expect(result).toHaveProperty('isValid');
            expect(result).toHaveProperty('stats');
        });
    });
    
    describe('Cache Repair', () => {
        test('should repair corrupted cache entries', async () => {
            const mockRepairableCache = {
                verifyCacheIntegrity: jest.fn().mockResolvedValue({
                    isValid: false,
                    errors: ['Corrupted entry']
                }),
                getStats: jest.fn().mockReturnValue({
                    totalEntries: 5,
                    totalSize: 512,
                    compressionRatio: 0.8,
                    lastSave: Date.now(),
                    lastLoad: Date.now(),
                    saveCount: 2,
                    loadCount: 1,
                    errorCount: 1
                }),
                invalidateEntries: jest.fn().mockReturnValue(2),
                save: jest.fn().mockResolvedValue(undefined)
            };
            
            mockSymbolProvider.getPersistentCache = jest.fn().mockReturnValue(mockRepairableCache);
            mockImportResolver.getPersistentCache = jest.fn().mockReturnValue(mockRepairableCache);
            
            const result = await validator.repairCache();
            
            expect(result.removed).toBe(4); // 2 from each cache
            expect(result.errors).toHaveLength(0);
        });
        
        test('should handle repair errors gracefully', async () => {
            const mockFailingCache = {
                invalidateEntries: jest.fn().mockImplementation(() => {
                    throw new Error('Repair failed');
                }),
                save: jest.fn().mockRejectedValue(new Error('Save failed'))
            };
            
            mockSymbolProvider.getPersistentCache = jest.fn().mockReturnValue(mockFailingCache);
            mockImportResolver.getPersistentCache = jest.fn().mockReturnValue(mockFailingCache);
            
            const result = await validator.repairCache();
            
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors[0]).toContain('failed');
        });
    });
    
    describe('Health Report', () => {
        test('should generate healthy cache report', async () => {
            const report = await validator.generateHealthReport();
            
            expect(report.overall).toBe('healthy');
            expect(report.validation.isValid).toBe(true);
            expect(report.performance).toHaveProperty('totalCacheSize');
            expect(report.performance).toHaveProperty('compressionRatio');
            expect(Array.isArray(report.recommendations)).toBe(true);
        });
        
        test('should detect warning conditions', async () => {
            // Mock cache with high invalid entry count
            const mockWarningCache = {
                verifyCacheIntegrity: jest.fn().mockResolvedValue({
                    isValid: true,
                    errors: []
                }),
                getStats: jest.fn().mockReturnValue({
                    totalEntries: 100,
                    totalSize: 600 * 1024 * 1024, // 600MB - large cache
                    compressionRatio: 0.9, // Poor compression
                    lastSave: Date.now(),
                    lastLoad: Date.now(),
                    saveCount: 5,
                    loadCount: 3,
                    errorCount: 0
                })
            };
            
            mockSymbolProvider.getPersistentCache = jest.fn().mockReturnValue(mockWarningCache);
            mockImportResolver.getPersistentCache = jest.fn().mockReturnValue(mockWarningCache);
            
            // Mock validation result with many invalid entries
            jest.spyOn(validator, 'validateCache').mockResolvedValue({
                isValid: true,
                errors: [],
                warnings: ['Some warning'],
                stats: {
                    totalEntries: 100,
                    validEntries: 80,
                    invalidEntries: 20, // 20% invalid
                    corruptedEntries: 0,
                    missingFiles: 0
                }
            });
            
            const report = await validator.generateHealthReport();
            
            expect(report.overall).toBe('warning');
            expect(report.recommendations.length).toBeGreaterThan(0);
        });
        
        test('should detect critical conditions', async () => {
            // Mock validation with corrupted entries
            jest.spyOn(validator, 'validateCache').mockResolvedValue({
                isValid: false,
                errors: ['Corruption detected'],
                warnings: [],
                stats: {
                    totalEntries: 50,
                    validEntries: 45,
                    invalidEntries: 0,
                    corruptedEntries: 5,
                    missingFiles: 0
                }
            });
            
            const report = await validator.generateHealthReport();
            
            expect(report.overall).toBe('critical');
            expect(report.recommendations).toContain('Run cache repair to fix corrupted entries');
        });
    });
    
    describe('Cache Optimization', () => {
        test('should optimize cache successfully', async () => {
            const result = await validator.optimizeCache();
            
            expect(result).toHaveProperty('optimized');
            expect(result).toHaveProperty('actions');
            expect(result).toHaveProperty('sizeBefore');
            expect(result).toHaveProperty('sizeAfter');
            expect(Array.isArray(result.actions)).toBe(true);
        });
        
        test('should handle optimization errors', async () => {
            const mockFailingCache = {
                getStats: jest.fn().mockReturnValue({
                    totalEntries: 10,
                    totalSize: 1024,
                    compressionRatio: 0.7,
                    lastSave: Date.now(),
                    lastLoad: Date.now(),
                    saveCount: 5,
                    loadCount: 3,
                    errorCount: 0
                }),
                invalidateOlderThan: jest.fn().mockImplementation(() => {
                    throw new Error('Optimization failed');
                }),
                save: jest.fn().mockRejectedValue(new Error('Save failed'))
            };
            
            mockSymbolProvider.getPersistentCache = jest.fn().mockReturnValue(mockFailingCache);
            mockImportResolver.getPersistentCache = jest.fn().mockReturnValue(mockFailingCache);
            
            const result = await validator.optimizeCache();
            
            expect(result.actions.some(action => action.includes('failed'))).toBe(true);
        });
    });
});