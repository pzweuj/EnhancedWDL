import { Token, TokenType, WDLLexer } from './lexer';
import * as AST from './ast';

export class ParseError extends Error {
    public token: Token;
    
    constructor(message: string, token: Token) {
        super(message);
        this.token = token;
        this.name = 'ParseError';
    }
}

export class WDLParser {
    private tokens: Token[];
    private current: number = 0;
    
    constructor(input: string) {
        const lexer = new WDLLexer(input);
        this.tokens = lexer.tokenize();
    }
    
    parse(): AST.WDLDocument {
        const start = this.getCurrentPosition();
        const document = new AST.WDLDocument(this.createRange(start, start));
        
        try {
            // Parse version declaration (optional)
            if (this.check(TokenType.VERSION)) {
                document.version = this.parseVersionDeclaration();
            }
            
            // Parse imports, tasks, workflows, and structs
            while (!this.isAtEnd()) {
                if (this.check(TokenType.IMPORT)) {
                    document.imports.push(this.parseImportDeclaration());
                } else if (this.check(TokenType.TASK)) {
                    document.tasks.push(this.parseTaskDeclaration());
                } else if (this.check(TokenType.WORKFLOW)) {
                    document.workflows.push(this.parseWorkflowDeclaration());
                } else if (this.check(TokenType.STRUCT)) {
                    document.structs.push(this.parseStructDeclaration());
                } else {
                    // Skip unknown tokens or handle errors
                    this.advance();
                }
            }
            
            document.range.end = this.getCurrentPosition();
            return document;
        } catch (error) {
            // Return partial document even on error
            document.range.end = this.getCurrentPosition();
            return document;
        }
    }
    
    private parseVersionDeclaration(): AST.VersionDeclaration {
        const start = this.getCurrentPosition();
        this.consume(TokenType.VERSION, "Expected 'version'");
        
        const versionToken = this.consume(TokenType.FLOAT_LITERAL, "Expected version number");
        const end = this.getCurrentPosition();
        
        return new AST.VersionDeclaration(
            this.createRange(start, end),
            versionToken.value
        );
    }
    
    private parseImportDeclaration(): AST.ImportDeclaration {
        const start = this.getCurrentPosition();
        this.consume(TokenType.IMPORT, "Expected 'import'");
        
        const pathToken = this.consume(TokenType.STRING_LITERAL, "Expected import path");
        const path = pathToken.value.slice(1, -1); // Remove quotes
        
        let alias: string | undefined;
        if (this.match(TokenType.AS)) {
            const aliasToken = this.consume(TokenType.IDENTIFIER, "Expected alias name");
            alias = aliasToken.value;
        }
        
        const end = this.getCurrentPosition();
        return new AST.ImportDeclaration(this.createRange(start, end), path, alias);
    }
    
    private parseTaskDeclaration(): AST.TaskDeclaration {
        const start = this.getCurrentPosition();
        this.consume(TokenType.TASK, "Expected 'task'");
        
        const nameToken = this.consume(TokenType.IDENTIFIER, "Expected task name");
        const task = new AST.TaskDeclaration(this.createRange(start, start), nameToken.value);
        
        this.consume(TokenType.LEFT_BRACE, "Expected '{'");
        
        while (!this.check(TokenType.RIGHT_BRACE) && !this.isAtEnd()) {
            if (this.check(TokenType.INPUT)) {
                this.advance(); // consume 'input'
                this.consume(TokenType.LEFT_BRACE, "Expected '{'");
                
                while (!this.check(TokenType.RIGHT_BRACE) && !this.isAtEnd()) {
                    task.inputs.push(this.parseParameterDeclaration());
                }
                
                this.consume(TokenType.RIGHT_BRACE, "Expected '}'");
            } else if (this.check(TokenType.OUTPUT)) {
                this.advance(); // consume 'output'
                this.consume(TokenType.LEFT_BRACE, "Expected '{'");
                
                while (!this.check(TokenType.RIGHT_BRACE) && !this.isAtEnd()) {
                    task.outputs.push(this.parseParameterDeclaration());
                }
                
                this.consume(TokenType.RIGHT_BRACE, "Expected '}'");
            } else if (this.check(TokenType.COMMAND)) {
                task.command = this.parseCommandBlock();
            } else if (this.check(TokenType.RUNTIME)) {
                task.runtime = this.parseRuntimeBlock();
            } else if (this.check(TokenType.META)) {
                task.meta = this.parseMetaBlock();
            } else if (this.check(TokenType.PARAMETER_META)) {
                task.parameterMeta = this.parseParameterMetaBlock();
            } else {
                // Skip unknown tokens
                this.advance();
            }
        }
        
        this.consume(TokenType.RIGHT_BRACE, "Expected '}'");
        const end = this.getCurrentPosition();
        task.range.end = end;
        
        return task;
    }
    
    private parseWorkflowDeclaration(): AST.WorkflowDeclaration {
        const start = this.getCurrentPosition();
        this.consume(TokenType.WORKFLOW, "Expected 'workflow'");
        
        const nameToken = this.consume(TokenType.IDENTIFIER, "Expected workflow name");
        const workflow = new AST.WorkflowDeclaration(this.createRange(start, start), nameToken.value);
        
        this.consume(TokenType.LEFT_BRACE, "Expected '{'");
        
        while (!this.check(TokenType.RIGHT_BRACE) && !this.isAtEnd()) {
            if (this.check(TokenType.INPUT)) {
                this.advance(); // consume 'input'
                this.consume(TokenType.LEFT_BRACE, "Expected '{'");
                
                while (!this.check(TokenType.RIGHT_BRACE) && !this.isAtEnd()) {
                    workflow.inputs.push(this.parseParameterDeclaration());
                }
                
                this.consume(TokenType.RIGHT_BRACE, "Expected '}'");
            } else if (this.check(TokenType.OUTPUT)) {
                this.advance(); // consume 'output'
                this.consume(TokenType.LEFT_BRACE, "Expected '{'");
                
                while (!this.check(TokenType.RIGHT_BRACE) && !this.isAtEnd()) {
                    workflow.outputs.push(this.parseParameterDeclaration());
                }
                
                this.consume(TokenType.RIGHT_BRACE, "Expected '}'");
            } else {
                // Parse workflow body statements
                const statement = this.parseStatement();
                if (statement) {
                    workflow.body.push(statement);
                }
            }
        }
        
        this.consume(TokenType.RIGHT_BRACE, "Expected '}'");
        const end = this.getCurrentPosition();
        workflow.range.end = end;
        
        return workflow;
    }
    
    private parseStructDeclaration(): AST.StructDeclaration {
        const start = this.getCurrentPosition();
        this.consume(TokenType.STRUCT, "Expected 'struct'");
        
        const nameToken = this.consume(TokenType.IDENTIFIER, "Expected struct name");
        const struct = new AST.StructDeclaration(this.createRange(start, start), nameToken.value);
        
        this.consume(TokenType.LEFT_BRACE, "Expected '{'");
        
        while (!this.check(TokenType.RIGHT_BRACE) && !this.isAtEnd()) {
            struct.members.push(this.parseParameterDeclaration());
        }
        
        this.consume(TokenType.RIGHT_BRACE, "Expected '}'");
        const end = this.getCurrentPosition();
        struct.range.end = end;
        
        return struct;
    }
    
    private parseParameterDeclaration(): AST.ParameterDeclaration {
        const start = this.getCurrentPosition();
        const type = this.parseType();
        const nameToken = this.consume(TokenType.IDENTIFIER, "Expected parameter name");
        
        const param = new AST.ParameterDeclaration(
            this.createRange(start, this.getCurrentPosition()),
            nameToken.value,
            type
        );
        
        // Check for default value
        if (this.match(TokenType.ASSIGN)) {
            param.defaultValue = this.parseExpression();
        }
        
        return param;
    }
    
    private parseType(): AST.WDLType {
        const start = this.getCurrentPosition();
        
        if (this.check(TokenType.STRING, TokenType.INT, TokenType.FLOAT, TokenType.BOOLEAN, TokenType.FILE)) {
            const typeToken = this.advance();
            const optional = this.match(TokenType.QUESTION);
            return new AST.PrimitiveType(
                this.createRange(start, this.getCurrentPosition()),
                typeToken.value as any,
                optional
            );
        } else if (this.check(TokenType.ARRAY)) {
            this.advance(); // consume 'Array'
            this.consume(TokenType.LEFT_BRACKET, "Expected '['");
            const elementType = this.parseType();
            this.consume(TokenType.RIGHT_BRACKET, "Expected ']'");
            const optional = this.match(TokenType.QUESTION);
            return new AST.ArrayType(
                this.createRange(start, this.getCurrentPosition()),
                elementType,
                optional
            );
        } else if (this.check(TokenType.MAP)) {
            this.advance(); // consume 'Map'
            this.consume(TokenType.LEFT_BRACKET, "Expected '['");
            const keyType = this.parseType();
            this.consume(TokenType.COMMA, "Expected ','");
            const valueType = this.parseType();
            this.consume(TokenType.RIGHT_BRACKET, "Expected ']'");
            const optional = this.match(TokenType.QUESTION);
            return new AST.MapType(
                this.createRange(start, this.getCurrentPosition()),
                keyType,
                valueType,
                optional
            );
        } else if (this.check(TokenType.PAIR)) {
            this.advance(); // consume 'Pair'
            this.consume(TokenType.LEFT_BRACKET, "Expected '['");
            const leftType = this.parseType();
            this.consume(TokenType.COMMA, "Expected ','");
            const rightType = this.parseType();
            this.consume(TokenType.RIGHT_BRACKET, "Expected ']'");
            const optional = this.match(TokenType.QUESTION);
            return new AST.PairType(
                this.createRange(start, this.getCurrentPosition()),
                leftType,
                rightType,
                optional
            );
        } else if (this.check(TokenType.IDENTIFIER)) {
            const typeToken = this.advance();
            const optional = this.match(TokenType.QUESTION);
            return new AST.CustomType(
                this.createRange(start, this.getCurrentPosition()),
                typeToken.value,
                optional
            );
        } else {
            throw new ParseError("Expected type", this.peek());
        }
    }
    
    private parseStatement(): AST.Statement | null {
        try {
            if (this.check(TokenType.CALL)) {
                return this.parseCallStatement();
            } else if (this.check(TokenType.IF)) {
                return this.parseIfStatement();
            } else if (this.check(TokenType.SCATTER)) {
                return this.parseScatterStatement();
            } else if (this.check(TokenType.IDENTIFIER)) {
                // Could be assignment or type declaration
                return this.parseAssignmentOrDeclaration();
            } else {
                // Skip unknown tokens
                this.advance();
                return null;
            }
        } catch (error) {
            // Skip to next statement on error
            this.synchronize();
            return null;
        }
    }
    
    private parseCallStatement(): AST.CallStatement {
        const start = this.getCurrentPosition();
        this.consume(TokenType.CALL, "Expected 'call'");
        
        const taskNameToken = this.consume(TokenType.IDENTIFIER, "Expected task name");
        
        let alias: string | undefined;
        if (this.match(TokenType.AS)) {
            const aliasToken = this.consume(TokenType.IDENTIFIER, "Expected alias");
            alias = aliasToken.value;
        }
        
        const call = new AST.CallStatement(
            this.createRange(start, this.getCurrentPosition()),
            taskNameToken.value,
            alias
        );
        
        if (this.match(TokenType.LEFT_BRACE)) {
            if (this.match(TokenType.INPUT)) {
                this.consume(TokenType.COLON, "Expected ':'");
                
                while (!this.check(TokenType.RIGHT_BRACE) && !this.isAtEnd()) {
                    const inputStart = this.getCurrentPosition();
                    const nameToken = this.consume(TokenType.IDENTIFIER, "Expected input name");
                    this.consume(TokenType.ASSIGN, "Expected '='");
                    const value = this.parseExpression();
                    
                    call.inputs.push(new AST.CallInput(
                        this.createRange(inputStart, this.getCurrentPosition()),
                        nameToken.value,
                        value
                    ));
                    
                    if (!this.check(TokenType.RIGHT_BRACE)) {
                        this.consume(TokenType.COMMA, "Expected ',' or '}'");
                    }
                }
            }
            
            this.consume(TokenType.RIGHT_BRACE, "Expected '}'");
        }
        
        call.range.end = this.getCurrentPosition();
        return call;
    }
    
    private parseIfStatement(): AST.IfStatement {
        const start = this.getCurrentPosition();
        this.consume(TokenType.IF, "Expected 'if'");
        
        this.consume(TokenType.LEFT_PAREN, "Expected '('");
        const condition = this.parseExpression();
        this.consume(TokenType.RIGHT_PAREN, "Expected ')'");
        
        const ifStmt = new AST.IfStatement(this.createRange(start, start), condition);
        
        this.consume(TokenType.LEFT_BRACE, "Expected '{'");
        
        while (!this.check(TokenType.RIGHT_BRACE) && !this.isAtEnd()) {
            const statement = this.parseStatement();
            if (statement) {
                ifStmt.body.push(statement);
            }
        }
        
        this.consume(TokenType.RIGHT_BRACE, "Expected '}'");
        ifStmt.range.end = this.getCurrentPosition();
        
        return ifStmt;
    }
    
    private parseScatterStatement(): AST.ScatterStatement {
        const start = this.getCurrentPosition();
        this.consume(TokenType.SCATTER, "Expected 'scatter'");
        
        this.consume(TokenType.LEFT_PAREN, "Expected '('");
        const variableToken = this.consume(TokenType.IDENTIFIER, "Expected variable name");
        this.consume(TokenType.IN, "Expected 'in'");
        const collection = this.parseExpression();
        this.consume(TokenType.RIGHT_PAREN, "Expected ')'");
        
        const scatter = new AST.ScatterStatement(
            this.createRange(start, start),
            variableToken.value,
            collection
        );
        
        this.consume(TokenType.LEFT_BRACE, "Expected '{'");
        
        while (!this.check(TokenType.RIGHT_BRACE) && !this.isAtEnd()) {
            const statement = this.parseStatement();
            if (statement) {
                scatter.body.push(statement);
            }
        }
        
        this.consume(TokenType.RIGHT_BRACE, "Expected '}'");
        scatter.range.end = this.getCurrentPosition();
        
        return scatter;
    }
    
    private parseAssignmentOrDeclaration(): AST.Statement {
        const start = this.getCurrentPosition();
        
        // Try to parse as type declaration first
        const checkpoint = this.current;
        try {
            const type = this.parseType();
            if (this.check(TokenType.IDENTIFIER)) {
                const nameToken = this.advance();
                this.consume(TokenType.ASSIGN, "Expected '='");
                const value = this.parseExpression();
                
                return new AST.AssignmentStatement(
                    this.createRange(start, this.getCurrentPosition()),
                    nameToken.value,
                    value
                );
            }
        } catch (error) {
            // Reset and try as simple assignment
            this.current = checkpoint;
        }
        
        // Parse as simple assignment
        const nameToken = this.consume(TokenType.IDENTIFIER, "Expected identifier");
        this.consume(TokenType.ASSIGN, "Expected '='");
        const value = this.parseExpression();
        
        return new AST.AssignmentStatement(
            this.createRange(start, this.getCurrentPosition()),
            nameToken.value,
            value
        );
    }
    
    private parseExpression(): AST.Expression {
        return this.parseLogicalOr();
    }
    
    private parseLogicalOr(): AST.Expression {
        let expr = this.parseLogicalAnd();
        
        while (this.match(TokenType.LOGICAL_OR)) {
            const operator = this.previous().value;
            const right = this.parseLogicalAnd();
            expr = new AST.BinaryExpression(
                this.createRange(expr.range.start, this.getCurrentPosition()),
                expr,
                operator,
                right
            );
        }
        
        return expr;
    }
    
    private parseLogicalAnd(): AST.Expression {
        let expr = this.parseEquality();
        
        while (this.match(TokenType.LOGICAL_AND)) {
            const operator = this.previous().value;
            const right = this.parseEquality();
            expr = new AST.BinaryExpression(
                this.createRange(expr.range.start, this.getCurrentPosition()),
                expr,
                operator,
                right
            );
        }
        
        return expr;
    }
    
    private parseEquality(): AST.Expression {
        let expr = this.parseComparison();
        
        while (this.match(TokenType.EQUALS, TokenType.NOT_EQUALS)) {
            const operator = this.previous().value;
            const right = this.parseComparison();
            expr = new AST.BinaryExpression(
                this.createRange(expr.range.start, this.getCurrentPosition()),
                expr,
                operator,
                right
            );
        }
        
        return expr;
    }
    
    private parseComparison(): AST.Expression {
        let expr = this.parseTerm();
        
        while (this.match(TokenType.GREATER_THAN, TokenType.GREATER_EQUAL, TokenType.LESS_THAN, TokenType.LESS_EQUAL)) {
            const operator = this.previous().value;
            const right = this.parseTerm();
            expr = new AST.BinaryExpression(
                this.createRange(expr.range.start, this.getCurrentPosition()),
                expr,
                operator,
                right
            );
        }
        
        return expr;
    }
    
    private parseTerm(): AST.Expression {
        let expr = this.parseFactor();
        
        while (this.match(TokenType.MINUS, TokenType.PLUS)) {
            const operator = this.previous().value;
            const right = this.parseFactor();
            expr = new AST.BinaryExpression(
                this.createRange(expr.range.start, this.getCurrentPosition()),
                expr,
                operator,
                right
            );
        }
        
        return expr;
    }
    
    private parseFactor(): AST.Expression {
        let expr = this.parseUnary();
        
        while (this.match(TokenType.DIVIDE, TokenType.MULTIPLY, TokenType.MODULO)) {
            const operator = this.previous().value;
            const right = this.parseUnary();
            expr = new AST.BinaryExpression(
                this.createRange(expr.range.start, this.getCurrentPosition()),
                expr,
                operator,
                right
            );
        }
        
        return expr;
    }
    
    private parseUnary(): AST.Expression {
        if (this.match(TokenType.LOGICAL_NOT, TokenType.MINUS)) {
            const operator = this.previous().value;
            const right = this.parseUnary();
            return new AST.UnaryExpression(
                this.createRange(this.getCurrentPosition(), right.range.end),
                operator,
                right
            );
        }
        
        return this.parsePostfix();
    }
    
    private parsePostfix(): AST.Expression {
        let expr = this.parsePrimary();
        
        while (true) {
            if (this.match(TokenType.DOT)) {
                const propertyToken = this.consume(TokenType.IDENTIFIER, "Expected property name");
                expr = new AST.MemberExpression(
                    this.createRange(expr.range.start, this.getCurrentPosition()),
                    expr,
                    propertyToken.value
                );
            } else if (this.match(TokenType.LEFT_PAREN)) {
                // Function call
                if (expr instanceof AST.IdentifierExpression) {
                    const funcCall = new AST.FunctionCallExpression(
                        this.createRange(expr.range.start, this.getCurrentPosition()),
                        expr.name
                    );
                    
                    if (!this.check(TokenType.RIGHT_PAREN)) {
                        do {
                            funcCall.arguments.push(this.parseExpression());
                        } while (this.match(TokenType.COMMA));
                    }
                    
                    this.consume(TokenType.RIGHT_PAREN, "Expected ')'");
                    expr = funcCall;
                } else {
                    throw new ParseError("Invalid function call", this.peek());
                }
            } else {
                break;
            }
        }
        
        return expr;
    }
    
    private parsePrimary(): AST.Expression {
        const start = this.getCurrentPosition();
        
        if (this.match(TokenType.BOOLEAN_LITERAL)) {
            const value = this.previous().value === 'true';
            return new AST.LiteralExpression(
                this.createRange(start, this.getCurrentPosition()),
                value,
                'boolean'
            );
        }
        
        if (this.match(TokenType.INT_LITERAL)) {
            const value = parseInt(this.previous().value);
            return new AST.LiteralExpression(
                this.createRange(start, this.getCurrentPosition()),
                value,
                'int'
            );
        }
        
        if (this.match(TokenType.FLOAT_LITERAL)) {
            const value = parseFloat(this.previous().value);
            return new AST.LiteralExpression(
                this.createRange(start, this.getCurrentPosition()),
                value,
                'float'
            );
        }
        
        if (this.match(TokenType.STRING_LITERAL)) {
            const value = this.previous().value.slice(1, -1); // Remove quotes
            return new AST.LiteralExpression(
                this.createRange(start, this.getCurrentPosition()),
                value,
                'string'
            );
        }
        
        if (this.match(TokenType.IDENTIFIER)) {
            const name = this.previous().value;
            return new AST.IdentifierExpression(
                this.createRange(start, this.getCurrentPosition()),
                name
            );
        }
        
        if (this.match(TokenType.LEFT_PAREN)) {
            const expr = this.parseExpression();
            this.consume(TokenType.RIGHT_PAREN, "Expected ')' after expression");
            return expr;
        }
        
        if (this.match(TokenType.LEFT_BRACKET)) {
            const array = new AST.ArrayExpression(this.createRange(start, start));
            
            if (!this.check(TokenType.RIGHT_BRACKET)) {
                do {
                    array.elements.push(this.parseExpression());
                } while (this.match(TokenType.COMMA));
            }
            
            this.consume(TokenType.RIGHT_BRACKET, "Expected ']'");
            array.range.end = this.getCurrentPosition();
            return array;
        }
        
        throw new ParseError("Unexpected token", this.peek());
    }
    
    private parseCommandBlock(): AST.CommandBlock {
        const start = this.getCurrentPosition();
        this.consume(TokenType.COMMAND, "Expected 'command'");
        this.consume(TokenType.COMMAND_START, "Expected '<<<'");
        
        // Collect all tokens until command end
        let content = '';
        while (!this.check(TokenType.COMMAND_END) && !this.isAtEnd()) {
            content += this.advance().value;
        }
        
        this.consume(TokenType.COMMAND_END, "Expected '>>>'");
        
        return new AST.CommandBlock(
            this.createRange(start, this.getCurrentPosition()),
            content
        );
    }
    
    private parseRuntimeBlock(): AST.RuntimeBlock {
        const start = this.getCurrentPosition();
        this.consume(TokenType.RUNTIME, "Expected 'runtime'");
        this.consume(TokenType.LEFT_BRACE, "Expected '{'");
        
        const runtime = new AST.RuntimeBlock(this.createRange(start, start));
        
        while (!this.check(TokenType.RIGHT_BRACE) && !this.isAtEnd()) {
            const attrStart = this.getCurrentPosition();
            const nameToken = this.consume(TokenType.IDENTIFIER, "Expected attribute name");
            this.consume(TokenType.COLON, "Expected ':'");
            const value = this.parseExpression();
            
            runtime.attributes.push(new AST.RuntimeAttribute(
                this.createRange(attrStart, this.getCurrentPosition()),
                nameToken.value,
                value
            ));
        }
        
        this.consume(TokenType.RIGHT_BRACE, "Expected '}'");
        runtime.range.end = this.getCurrentPosition();
        
        return runtime;
    }
    
    private parseMetaBlock(): AST.MetaBlock {
        const start = this.getCurrentPosition();
        this.consume(TokenType.META, "Expected 'meta'");
        this.consume(TokenType.LEFT_BRACE, "Expected '{'");
        
        const meta = new AST.MetaBlock(this.createRange(start, start));
        
        while (!this.check(TokenType.RIGHT_BRACE) && !this.isAtEnd()) {
            const attrStart = this.getCurrentPosition();
            const nameToken = this.consume(TokenType.IDENTIFIER, "Expected attribute name");
            this.consume(TokenType.COLON, "Expected ':'");
            const value = this.parseExpression();
            
            meta.attributes.push(new AST.MetaAttribute(
                this.createRange(attrStart, this.getCurrentPosition()),
                nameToken.value,
                value
            ));
        }
        
        this.consume(TokenType.RIGHT_BRACE, "Expected '}'");
        meta.range.end = this.getCurrentPosition();
        
        return meta;
    }
    
    private parseParameterMetaBlock(): AST.ParameterMetaBlock {
        const start = this.getCurrentPosition();
        this.consume(TokenType.PARAMETER_META, "Expected 'parameter_meta'");
        this.consume(TokenType.LEFT_BRACE, "Expected '{'");
        
        const paramMeta = new AST.ParameterMetaBlock(this.createRange(start, start));
        
        while (!this.check(TokenType.RIGHT_BRACE) && !this.isAtEnd()) {
            const attrStart = this.getCurrentPosition();
            const paramNameToken = this.consume(TokenType.IDENTIFIER, "Expected parameter name");
            this.consume(TokenType.COLON, "Expected ':'");
            const value = this.parseExpression();
            
            paramMeta.attributes.push(new AST.ParameterMetaAttribute(
                this.createRange(attrStart, this.getCurrentPosition()),
                paramNameToken.value,
                value
            ));
        }
        
        this.consume(TokenType.RIGHT_BRACE, "Expected '}'");
        paramMeta.range.end = this.getCurrentPosition();
        
        return paramMeta;
    }
    
    // Utility methods
    private match(...types: TokenType[]): boolean {
        for (const type of types) {
            if (this.check(type)) {
                this.advance();
                return true;
            }
        }
        return false;
    }
    
    private check(...types: TokenType[]): boolean {
        if (this.isAtEnd()) return false;
        return types.includes(this.peek().type);
    }
    
    private advance(): Token {
        if (!this.isAtEnd()) this.current++;
        return this.previous();
    }
    
    private isAtEnd(): boolean {
        return this.peek().type === TokenType.EOF;
    }
    
    private peek(): Token {
        return this.tokens[this.current];
    }
    
    private previous(): Token {
        return this.tokens[this.current - 1];
    }
    
    private consume(type: TokenType, message: string): Token {
        if (this.check(type)) return this.advance();
        throw new ParseError(message, this.peek());
    }
    
    private synchronize(): void {
        this.advance();
        
        while (!this.isAtEnd()) {
            if (this.previous().type === TokenType.SEMICOLON) return;
            
            switch (this.peek().type) {
                case TokenType.TASK:
                case TokenType.WORKFLOW:
                case TokenType.STRUCT:
                case TokenType.IF:
                case TokenType.SCATTER:
                case TokenType.CALL:
                    return;
            }
            
            this.advance();
        }
    }
    
    private getCurrentPosition(): AST.Position {
        const token = this.peek();
        return {
            line: token.line,
            column: token.column,
            offset: token.start
        };
    }
    
    private createRange(start: AST.Position, end: AST.Position): AST.Range {
        return { start, end };
    }
}