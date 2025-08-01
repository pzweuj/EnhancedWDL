import {
    createConnection,
    TextDocuments,
    Diagnostic,
    DiagnosticSeverity,
    ProposedFeatures,
    InitializeParams,
    DidChangeConfigurationNotification,
    CompletionItem,
    CompletionItemKind,
    TextDocumentPositionParams,
    TextDocumentSyncKind,
    InitializeResult,
    Hover,
    HoverParams
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { SymbolProvider } from './symbolProvider';
import { HoverProvider } from './hoverProvider';
import { CompletionProvider } from './completionProvider';
import { DiagnosticProvider } from './diagnosticProvider';
import { CacheIntegrityValidator } from './cacheIntegrityValidator';
import { CacheMigrationManager } from './cacheMigrationManager';

// Create a connection for the server, using Node's IPC as a transport.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Create providers
const symbolProvider = new SymbolProvider();
const hoverProvider = new HoverProvider(symbolProvider);
const completionProvider = new CompletionProvider(symbolProvider);
const diagnosticProvider = new DiagnosticProvider(symbolProvider);

// Performance monitoring for trigger characters
interface TriggerPerformanceStats {
    character: string;
    totalRequests: number;
    totalTime: number;
    averageTime: number;
    maxTime: number;
    minTime: number;
    slowRequests: number; // requests > 500ms
}

const triggerStats = new Map<string, TriggerPerformanceStats>();

function updateTriggerStats(triggerCharacter: string | undefined, responseTime: number) {
    const key = triggerCharacter || 'manual';
    const stats = triggerStats.get(key) || {
        character: key,
        totalRequests: 0,
        totalTime: 0,
        averageTime: 0,
        maxTime: 0,
        minTime: Infinity,
        slowRequests: 0
    };
    
    stats.totalRequests++;
    stats.totalTime += responseTime;
    stats.averageTime = stats.totalTime / stats.totalRequests;
    stats.maxTime = Math.max(stats.maxTime, responseTime);
    stats.minTime = Math.min(stats.minTime, responseTime);
    
    if (responseTime > 500) {
        stats.slowRequests++;
    }
    
    triggerStats.set(key, stats);
    
    // Log performance summary every 50 requests for dot trigger
    if (key === '.' && stats.totalRequests % 50 === 0) {
        connection.console.log(`Dot trigger performance: avg=${stats.averageTime.toFixed(2)}ms, max=${stats.maxTime}ms, slow=${stats.slowRequests}/${stats.totalRequests}`);
    }
}

// Initialize cache systems
let cacheIntegrityValidator: CacheIntegrityValidator;
let cacheMigrationManager: CacheMigrationManager;

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

connection.onInitialize((params: InitializeParams) => {
    const capabilities = params.capabilities;

    // Does the client support the `workspace/configuration` request?
    hasConfigurationCapability = !!(
        capabilities.workspace && !!capabilities.workspace.configuration
    );
    hasWorkspaceFolderCapability = !!(
        capabilities.workspace && !!capabilities.workspace.workspaceFolders
    );
    hasDiagnosticRelatedInformationCapability = !!(
        capabilities.textDocument &&
        capabilities.textDocument.publishDiagnostics &&
        capabilities.textDocument.publishDiagnostics.relatedInformation
    );

    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            // Tell the client that this server supports code completion.
            completionProvider: {
                resolveProvider: true,
                // Enhanced trigger characters for WDL completion
                // '.' - Task output completion (TaskName.outputParam)
                // ':' - Type annotations and parameter definitions
                // '=' - Input parameter assignments
                // ' ' - General context-aware completion
                // '{' - Block start completion (input/output blocks)
                // '(' - Function call parameter completion
                triggerCharacters: ['.', ':', '=', ' ', '{', '(']
            },
            // Tell the client that this server supports hover information.
            hoverProvider: true
        }
    };
    
    if (hasWorkspaceFolderCapability) {
        result.capabilities.workspace = {
            workspaceFolders: {
                supported: true
            }
        };
    }
    
    return result;
});

connection.onInitialized(async () => {
    if (hasConfigurationCapability) {
        // Register for all configuration changes.
        connection.client.register(DidChangeConfigurationNotification.type, undefined);
    }
    if (hasWorkspaceFolderCapability) {
        connection.workspace.onDidChangeWorkspaceFolders(_event => {
            connection.console.log('Workspace folder change event received.');
        });
    }
    
    // Initialize persistent cache systems
    try {
        await symbolProvider.initialize();
        
        // Initialize import resolver through document analyzer
        const documentAnalyzer = symbolProvider.getDocumentAnalyzer();
        const importResolver = documentAnalyzer.getImportResolver();
        await importResolver.initialize();
        
        // Initialize cache management utilities
        cacheIntegrityValidator = new CacheIntegrityValidator(symbolProvider, importResolver);
        cacheMigrationManager = new CacheMigrationManager('.wdl-cache');
        
        // Perform cache health check
        const healthReport = await cacheIntegrityValidator.generateHealthReport();
        if (healthReport.overall !== 'healthy') {
            connection.console.log(`Cache health: ${healthReport.overall}`);
            if (healthReport.recommendations.length > 0) {
                connection.console.log(`Cache recommendations: ${healthReport.recommendations.join(', ')}`);
            }
        }
        
        connection.console.log('WDL Language Server initialized with enhanced trigger character support');
        connection.console.log('Supported trigger characters: . : = space { (');
        
    } catch (error) {
        connection.console.log(`Failed to initialize persistent cache: ${error}`);
    }
});

// Add performance statistics command
connection.onRequest('wdl/getTriggerStats', () => {
    const stats = Array.from(triggerStats.values());
    return {
        triggerStats: stats,
        summary: {
            totalTriggers: stats.reduce((sum, s) => sum + s.totalRequests, 0),
            dotTriggerRequests: triggerStats.get('.')?.totalRequests || 0,
            averageDotTriggerTime: triggerStats.get('.')?.averageTime || 0,
            slowDotTriggerRequests: triggerStats.get('.')?.slowRequests || 0
        }
    };
});

// The WDL settings
interface WDLSettings {
    maxNumberOfProblems: number;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
const defaultSettings: WDLSettings = { maxNumberOfProblems: 1000 };
let globalSettings: WDLSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<WDLSettings>> = new Map();

connection.onDidChangeConfiguration(change => {
    if (hasConfigurationCapability) {
        // Reset all cached document settings
        documentSettings.clear();
    } else {
        globalSettings = <WDLSettings>(
            (change.settings.wdlLanguageServer || defaultSettings)
        );
    }

    // Revalidate all open text documents
    documents.all().forEach(validateTextDocument);
});

function getDocumentSettings(resource: string): Thenable<WDLSettings> {
    if (!hasConfigurationCapability) {
        return Promise.resolve(globalSettings);
    }
    let result = documentSettings.get(resource);
    if (!result) {
        result = connection.workspace.getConfiguration({
            scopeUri: resource,
            section: 'wdlLanguageServer'
        });
        documentSettings.set(resource, result);
    }
    return result;
}

// Only keep settings for open documents
documents.onDidClose(e => {
    documentSettings.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(async change => {
    await symbolProvider.updateDocument(change.document.getText(), change.document.uri);
    validateTextDocument(change.document);
});

// Document opened
documents.onDidOpen(async event => {
    await symbolProvider.updateDocument(event.document.getText(), event.document.uri);
});

// Document closed
documents.onDidClose(event => {
    symbolProvider.removeDocument(event.document.uri);
});

// Handle file system changes for import files
connection.onDidChangeWatchedFiles(async changes => {
    for (const change of changes.changes) {
        if (change.uri.endsWith('.wdl')) {
            // Notify symbol provider about the change
            symbolProvider.removeDocument(change.uri);
            
            // If the file still exists, re-analyze it
            if (change.type !== 2) { // Not deleted
                try {
                    const document = documents.get(change.uri);
                    if (document) {
                        await symbolProvider.updateDocument(document.getText(), change.uri);
                    }
                } catch (error) {
                    connection.console.log(`Error updating changed file ${change.uri}: ${error}`);
                }
            }
        }
    }
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
    // Get diagnostics from the diagnostic provider
    const diagnostics = diagnosticProvider.validateDocument(textDocument);
    
    // Send the computed diagnostics to VSCode.
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles(_change => {
    // Monitored files have a change in VSCode
    connection.console.log('We received an file change event');
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
    async (params: any): Promise<CompletionItem[]> => {
        const startTime = Date.now();
        const document = documents.get(params.textDocument.uri);
        if (!document) {
            return [];
        }
        
        // Extract trigger information if available
        const triggerCharacter = params.context?.triggerCharacter;
        const triggerKind = params.context?.triggerKind;
        
        try {
            // Log trigger character usage for performance monitoring
            if (triggerCharacter) {
                connection.console.log(`Completion triggered by character: '${triggerCharacter}' at ${params.textDocument.uri}:${params.position.line}:${params.position.character}`);
            }
            
            const completionItems = await (completionProvider as any).provideCompletionItemsWithTrigger(
                document,
                params.position.line,
                params.position.character,
                triggerCharacter,
                triggerKind
            );
            
            // Performance monitoring
            const responseTime = Date.now() - startTime;
            updateTriggerStats(triggerCharacter, responseTime);
            
            if (responseTime > 500) {
                connection.console.log(`Slow completion response: ${responseTime}ms for trigger '${triggerCharacter || 'manual'}'`);
            }
            
            // Log completion statistics for dot trigger (output completion)
            if (triggerCharacter === '.') {
                connection.console.log(`Dot trigger completion returned ${completionItems.length} items in ${responseTime}ms`);
            }
            
            return completionItems;
            
        } catch (error) {
            connection.console.log(`Completion error for trigger '${triggerCharacter}': ${error}`);
            return [];
        }
    }
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
    (item: CompletionItem): CompletionItem => {
        try {
            // Enhanced completion resolve with WDL-specific information
            if (item.data === 1) {
                item.detail = 'WDL Task';
                item.documentation = 'Define a task in WDL';
            } else if (item.data === 2) {
                item.detail = 'WDL Workflow';
                item.documentation = 'Define a workflow in WDL';
            } else if (item.data && typeof item.data === 'object') {
                // Handle enhanced completion items with detailed data
                const wdlData = item.data as any;
                
                if (wdlData.category === 'task-input') {
                    item.detail = `Input Parameter: ${wdlData.parameterType || 'Unknown'}`;
                    item.documentation = wdlData.description || `Input parameter for task ${wdlData.taskName}`;
                    if (wdlData.isRequired) {
                        item.detail += ' (Required)';
                    }
                } else if (wdlData.category === 'task-output') {
                    item.detail = `Output: ${wdlData.parameterType || 'Unknown'}`;
                    item.documentation = wdlData.description || `Output from task ${wdlData.taskName}`;
                } else if (wdlData.category === 'task-call') {
                    item.detail = `Task: ${wdlData.taskName}`;
                    item.documentation = wdlData.description || `Call task ${wdlData.taskName}`;
                }
                
                // Add source file information if available
                if (wdlData.sourceFile && wdlData.sourceFile !== item.label) {
                    item.detail += ` (from ${wdlData.sourceFile})`;
                }
            }
            
            return item;
            
        } catch (error) {
            connection.console.log(`Completion resolve error: ${error}`);
            return item;
        }
    }
);

// This handler provides hover information
connection.onHover(
    async (params: HoverParams): Promise<Hover | null> => {
        const document = documents.get(params.textDocument.uri);
        if (!document) {
            return null;
        }
        
        return await hoverProvider.provideHover(
            document,
            params.position.line,
            params.position.character
        );
    }
);

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Handle server shutdown
connection.onShutdown(async () => {
    try {
        // Clean up persistent cache resources
        await symbolProvider.destroy();
        
        const documentAnalyzer = symbolProvider.getDocumentAnalyzer();
        const importResolver = documentAnalyzer.getImportResolver();
        await importResolver.destroy();
        
        connection.console.log('WDL Language Server shutdown complete');
    } catch (error) {
        connection.console.log(`Error during shutdown: ${error}`);
    }
});

// Listen on the connection
connection.listen();