import * as vscode from 'vscode';
import * as path from 'path';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: vscode.ExtensionContext) {
    // The server is implemented in node
    const serverModule = context.asAbsolutePath(path.join('out', 'server', 'server.js'));
    
    // The debug options for the server
    const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };
    
    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: debugOptions
        }
    };
    
    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
        // Register the server for WDL documents
        documentSelector: [{ scheme: 'file', language: 'wdl' }],
        synchronize: {
            // Notify the server about file changes to '.wdl' files contained in the workspace
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.wdl')
        }
    };
    
    // Create the language client and start the client.
    client = new LanguageClient(
        'wdlLanguageServer',
        'WDL Language Server',
        serverOptions,
        clientOptions
    );
    
    // Start the client. This will also launch the server
    client.start();
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}