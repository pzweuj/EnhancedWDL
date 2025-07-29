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

// Create a connection for the server, using Node's IPC as a transport.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Create providers
const symbolProvider = new SymbolProvider();
const hoverProvider = new HoverProvider(symbolProvider);
const completionProvider = new CompletionProvider(symbolProvider);
const diagnosticProvider = new DiagnosticProvider(symbolProvider);

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
                triggerCharacters: ['.', ':', '=']
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

connection.onInitialized(() => {
    if (hasConfigurationCapability) {
        // Register for all configuration changes.
        connection.client.register(DidChangeConfigurationNotification.type, undefined);
    }
    if (hasWorkspaceFolderCapability) {
        connection.workspace.onDidChangeWorkspaceFolders(_event => {
            connection.console.log('Workspace folder change event received.');
        });
    }
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
    (textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
        const document = documents.get(textDocumentPosition.textDocument.uri);
        if (!document) {
            return [];
        }
        
        return completionProvider.provideCompletionItems(
            document,
            textDocumentPosition.position.line,
            textDocumentPosition.position.character
        );
    }
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
    (item: CompletionItem): CompletionItem => {
        if (item.data === 1) {
            item.detail = 'WDL Task';
            item.documentation = 'Define a task in WDL';
        } else if (item.data === 2) {
            item.detail = 'WDL Workflow';
            item.documentation = 'Define a workflow in WDL';
        }
        return item;
    }
);

// This handler provides hover information
connection.onHover(
    (params: HoverParams): Hover | undefined => {
        const document = documents.get(params.textDocument.uri);
        if (!document) {
            return undefined;
        }
        
        return hoverProvider.provideHover(
            document,
            params.position.line,
            params.position.character
        );
    }
);

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();