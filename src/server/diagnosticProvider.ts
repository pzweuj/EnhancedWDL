import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SymbolProvider } from './symbolProvider';
import { WDLParser, ParseError } from './parser';

export class DiagnosticProvider {
    private symbolProvider: SymbolProvider;
    
    constructor(symbolProvider: SymbolProvider) {
        this.symbolProvider = symbolProvider;
    }
    
    /**
     * Validate a WDL document and return diagnostics
     */
    validateDocument(document: TextDocument): Diagnostic[] {
        const diagnostics: Diagnostic[] = [];
        
        try {
            // Parse the document
            const parser = new WDLParser(document.getText());
            const ast = parser.parse();
            
            // Basic validation would go here
            // For now, just return empty array if parsing succeeds
            
        } catch (error) {
            if (error instanceof ParseError) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: { line: error.token.line - 1, character: error.token.column - 1 },
                        end: { line: error.token.line - 1, character: error.token.column + error.token.value.length - 1 }
                    },
                    message: error.message,
                    source: 'wdl'
                });
            }
        }
        
        return diagnostics;
    }
}