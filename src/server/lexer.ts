export enum TokenType {
    // Keywords
    VERSION = 'VERSION',
    IMPORT = 'IMPORT',
    AS = 'AS',
    TASK = 'TASK',
    WORKFLOW = 'WORKFLOW',
    STRUCT = 'STRUCT',
    INPUT = 'INPUT',
    OUTPUT = 'OUTPUT',
    COMMAND = 'COMMAND',
    RUNTIME = 'RUNTIME',
    META = 'META',
    PARAMETER_META = 'PARAMETER_META',
    CALL = 'CALL',
    IF = 'IF',
    ELSE = 'ELSE',
    SCATTER = 'SCATTER',
    IN = 'IN',
    
    // Types
    STRING = 'STRING',
    INT = 'INT',
    FLOAT = 'FLOAT',
    BOOLEAN = 'BOOLEAN',
    FILE = 'FILE',
    ARRAY = 'ARRAY',
    MAP = 'MAP',
    PAIR = 'PAIR',
    OBJECT = 'OBJECT',
    
    // Literals
    STRING_LITERAL = 'STRING_LITERAL',
    INT_LITERAL = 'INT_LITERAL',
    FLOAT_LITERAL = 'FLOAT_LITERAL',
    BOOLEAN_LITERAL = 'BOOLEAN_LITERAL',
    
    // Identifiers
    IDENTIFIER = 'IDENTIFIER',
    
    // Operators
    ASSIGN = 'ASSIGN',
    EQUALS = 'EQUALS',
    NOT_EQUALS = 'NOT_EQUALS',
    LESS_THAN = 'LESS_THAN',
    LESS_EQUAL = 'LESS_EQUAL',
    GREATER_THAN = 'GREATER_THAN',
    GREATER_EQUAL = 'GREATER_EQUAL',
    LOGICAL_AND = 'LOGICAL_AND',
    LOGICAL_OR = 'LOGICAL_OR',
    LOGICAL_NOT = 'LOGICAL_NOT',
    PLUS = 'PLUS',
    MINUS = 'MINUS',
    MULTIPLY = 'MULTIPLY',
    DIVIDE = 'DIVIDE',
    MODULO = 'MODULO',
    
    // Punctuation
    LEFT_BRACE = 'LEFT_BRACE',
    RIGHT_BRACE = 'RIGHT_BRACE',
    LEFT_BRACKET = 'LEFT_BRACKET',
    RIGHT_BRACKET = 'RIGHT_BRACKET',
    LEFT_PAREN = 'LEFT_PAREN',
    RIGHT_PAREN = 'RIGHT_PAREN',
    COMMA = 'COMMA',
    SEMICOLON = 'SEMICOLON',
    COLON = 'COLON',
    DOT = 'DOT',
    QUESTION = 'QUESTION',
    
    // Special
    COMMAND_START = 'COMMAND_START', // <<<
    COMMAND_END = 'COMMAND_END',     // >>>
    INTERPOLATION_START = 'INTERPOLATION_START', // ~{ or ${
    INTERPOLATION_END = 'INTERPOLATION_END',     // }
    
    // Whitespace and comments
    WHITESPACE = 'WHITESPACE',
    COMMENT = 'COMMENT',
    NEWLINE = 'NEWLINE',
    
    // End of file
    EOF = 'EOF'
}

export interface Token {
    type: TokenType;
    value: string;
    line: number;
    column: number;
    start: number;
    end: number;
}

export class WDLLexer {
    private input: string;
    private position: number = 0;
    private line: number = 1;
    private column: number = 1;
    
    private keywords: Map<string, TokenType> = new Map([
        ['version', TokenType.VERSION],
        ['import', TokenType.IMPORT],
        ['as', TokenType.AS],
        ['task', TokenType.TASK],
        ['workflow', TokenType.WORKFLOW],
        ['struct', TokenType.STRUCT],
        ['input', TokenType.INPUT],
        ['output', TokenType.OUTPUT],
        ['command', TokenType.COMMAND],
        ['runtime', TokenType.RUNTIME],
        ['meta', TokenType.META],
        ['parameter_meta', TokenType.PARAMETER_META],
        ['call', TokenType.CALL],
        ['if', TokenType.IF],
        ['else', TokenType.ELSE],
        ['scatter', TokenType.SCATTER],
        ['in', TokenType.IN],
        ['String', TokenType.STRING],
        ['Int', TokenType.INT],
        ['Float', TokenType.FLOAT],
        ['Boolean', TokenType.BOOLEAN],
        ['File', TokenType.FILE],
        ['Array', TokenType.ARRAY],
        ['Map', TokenType.MAP],
        ['Pair', TokenType.PAIR],
        ['Object', TokenType.OBJECT],
        ['true', TokenType.BOOLEAN_LITERAL],
        ['false', TokenType.BOOLEAN_LITERAL]
    ]);
    
    constructor(input: string) {
        this.input = input;
    }
    
    tokenize(): Token[] {
        const tokens: Token[] = [];
        
        while (!this.isAtEnd()) {
            const token = this.nextToken();
            if (token) {
                tokens.push(token);
            }
        }
        
        tokens.push({
            type: TokenType.EOF,
            value: '',
            line: this.line,
            column: this.column,
            start: this.position,
            end: this.position
        });
        
        return tokens;
    }
    
    private nextToken(): Token | null {
        this.skipWhitespace();
        
        if (this.isAtEnd()) {
            return null;
        }
        
        const start = this.position;
        const startLine = this.line;
        const startColumn = this.column;
        
        const char = this.advance();
        
        // Comments
        if (char === '#') {
            return this.comment(start, startLine, startColumn);
        }
        
        // String literals
        if (char === '"') {
            return this.stringLiteral(start, startLine, startColumn);
        }
        
        // Command blocks
        if (char === '<' && this.peek() === '<' && this.peekNext() === '<') {
            this.advance(); // second <
            this.advance(); // third <
            return this.createToken(TokenType.COMMAND_START, '<<<', start, startLine, startColumn);
        }
        
        if (char === '>' && this.peek() === '>' && this.peekNext() === '>') {
            this.advance(); // second >
            this.advance(); // third >
            return this.createToken(TokenType.COMMAND_END, '>>>', start, startLine, startColumn);
        }
        
        // Interpolation
        if (char === '~' && this.peek() === '{') {
            this.advance(); // {
            return this.createToken(TokenType.INTERPOLATION_START, '~{', start, startLine, startColumn);
        }
        
        if (char === '$' && this.peek() === '{') {
            this.advance(); // {
            return this.createToken(TokenType.INTERPOLATION_START, '${', start, startLine, startColumn);
        }
        
        // Two-character operators
        if (char === '=' && this.peek() === '=') {
            this.advance();
            return this.createToken(TokenType.EQUALS, '==', start, startLine, startColumn);
        }
        
        if (char === '!' && this.peek() === '=') {
            this.advance();
            return this.createToken(TokenType.NOT_EQUALS, '!=', start, startLine, startColumn);
        }
        
        if (char === '<' && this.peek() === '=') {
            this.advance();
            return this.createToken(TokenType.LESS_EQUAL, '<=', start, startLine, startColumn);
        }
        
        if (char === '>' && this.peek() === '=') {
            this.advance();
            return this.createToken(TokenType.GREATER_EQUAL, '>=', start, startLine, startColumn);
        }
        
        if (char === '&' && this.peek() === '&') {
            this.advance();
            return this.createToken(TokenType.LOGICAL_AND, '&&', start, startLine, startColumn);
        }
        
        if (char === '|' && this.peek() === '|') {
            this.advance();
            return this.createToken(TokenType.LOGICAL_OR, '||', start, startLine, startColumn);
        }
        
        // Single-character tokens
        switch (char) {
            case '=': return this.createToken(TokenType.ASSIGN, '=', start, startLine, startColumn);
            case '<': return this.createToken(TokenType.LESS_THAN, '<', start, startLine, startColumn);
            case '>': return this.createToken(TokenType.GREATER_THAN, '>', start, startLine, startColumn);
            case '!': return this.createToken(TokenType.LOGICAL_NOT, '!', start, startLine, startColumn);
            case '+': return this.createToken(TokenType.PLUS, '+', start, startLine, startColumn);
            case '-': return this.createToken(TokenType.MINUS, '-', start, startLine, startColumn);
            case '*': return this.createToken(TokenType.MULTIPLY, '*', start, startLine, startColumn);
            case '/': return this.createToken(TokenType.DIVIDE, '/', start, startLine, startColumn);
            case '%': return this.createToken(TokenType.MODULO, '%', start, startLine, startColumn);
            case '{': return this.createToken(TokenType.LEFT_BRACE, '{', start, startLine, startColumn);
            case '}': return this.createToken(TokenType.RIGHT_BRACE, '}', start, startLine, startColumn);
            case '[': return this.createToken(TokenType.LEFT_BRACKET, '[', start, startLine, startColumn);
            case ']': return this.createToken(TokenType.RIGHT_BRACKET, ']', start, startLine, startColumn);
            case '(': return this.createToken(TokenType.LEFT_PAREN, '(', start, startLine, startColumn);
            case ')': return this.createToken(TokenType.RIGHT_PAREN, ')', start, startLine, startColumn);
            case ',': return this.createToken(TokenType.COMMA, ',', start, startLine, startColumn);
            case ';': return this.createToken(TokenType.SEMICOLON, ';', start, startLine, startColumn);
            case ':': return this.createToken(TokenType.COLON, ':', start, startLine, startColumn);
            case '.': return this.createToken(TokenType.DOT, '.', start, startLine, startColumn);
            case '?': return this.createToken(TokenType.QUESTION, '?', start, startLine, startColumn);
        }
        
        // Numbers
        if (this.isDigit(char)) {
            this.position--; // Back up to re-read the digit
            this.column--;
            return this.number(start, startLine, startColumn);
        }
        
        // Identifiers and keywords
        if (this.isAlpha(char)) {
            this.position--; // Back up to re-read the character
            this.column--;
            return this.identifier(start, startLine, startColumn);
        }
        
        // Unknown character - create an error token or skip
        return this.createToken(TokenType.IDENTIFIER, char, start, startLine, startColumn);
    }
    
    private comment(start: number, startLine: number, startColumn: number): Token {
        while (this.peek() !== '\n' && !this.isAtEnd()) {
            this.advance();
        }
        
        const value = this.input.substring(start, this.position);
        return this.createToken(TokenType.COMMENT, value, start, startLine, startColumn);
    }
    
    private stringLiteral(start: number, startLine: number, startColumn: number): Token {
        while (this.peek() !== '"' && !this.isAtEnd()) {
            if (this.peek() === '\n') {
                this.line++;
                this.column = 0;
            }
            this.advance();
        }
        
        if (this.isAtEnd()) {
            // Unterminated string
            const value = this.input.substring(start, this.position);
            return this.createToken(TokenType.STRING_LITERAL, value, start, startLine, startColumn);
        }
        
        // Closing "
        this.advance();
        
        const value = this.input.substring(start, this.position);
        return this.createToken(TokenType.STRING_LITERAL, value, start, startLine, startColumn);
    }
    
    private number(start: number, startLine: number, startColumn: number): Token {
        while (this.isDigit(this.peek())) {
            this.advance();
        }
        
        // Look for decimal part
        if (this.peek() === '.' && this.isDigit(this.peekNext())) {
            this.advance(); // consume '.'
            while (this.isDigit(this.peek())) {
                this.advance();
            }
            
            const value = this.input.substring(start, this.position);
            return this.createToken(TokenType.FLOAT_LITERAL, value, start, startLine, startColumn);
        }
        
        const value = this.input.substring(start, this.position);
        return this.createToken(TokenType.INT_LITERAL, value, start, startLine, startColumn);
    }
    
    private identifier(start: number, startLine: number, startColumn: number): Token {
        while (this.isAlphaNumeric(this.peek())) {
            this.advance();
        }
        
        const value = this.input.substring(start, this.position);
        const tokenType = this.keywords.get(value) || TokenType.IDENTIFIER;
        
        return this.createToken(tokenType, value, start, startLine, startColumn);
    }
    
    private skipWhitespace(): void {
        while (true) {
            const char = this.peek();
            if (char === ' ' || char === '\r' || char === '\t') {
                this.advance();
            } else if (char === '\n') {
                this.line++;
                this.column = 0;
                this.advance();
            } else {
                break;
            }
        }
    }
    
    private isAtEnd(): boolean {
        return this.position >= this.input.length;
    }
    
    private advance(): string {
        if (this.isAtEnd()) return '\0';
        this.column++;
        return this.input.charAt(this.position++);
    }
    
    private peek(): string {
        if (this.isAtEnd()) return '\0';
        return this.input.charAt(this.position);
    }
    
    private peekNext(): string {
        if (this.position + 1 >= this.input.length) return '\0';
        return this.input.charAt(this.position + 1);
    }
    
    private isDigit(char: string): boolean {
        return char >= '0' && char <= '9';
    }
    
    private isAlpha(char: string): boolean {
        return (char >= 'a' && char <= 'z') ||
               (char >= 'A' && char <= 'Z') ||
               char === '_';
    }
    
    private isAlphaNumeric(char: string): boolean {
        return this.isAlpha(char) || this.isDigit(char);
    }
    
    private createToken(type: TokenType, value: string, start: number, line: number, column: number): Token {
        return {
            type,
            value,
            line,
            column,
            start,
            end: this.position
        };
    }
}