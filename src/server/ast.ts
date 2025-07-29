export interface Position {
    line: number;
    column: number;
    offset: number;
}

export interface Range {
    start: Position;
    end: Position;
}

export abstract class ASTNode {
    public range: Range;
    
    constructor(range: Range) {
        this.range = range;
    }
}

export class WDLDocument extends ASTNode {
    public version?: VersionDeclaration;
    public imports: ImportDeclaration[] = [];
    public tasks: TaskDeclaration[] = [];
    public workflows: WorkflowDeclaration[] = [];
    public structs: StructDeclaration[] = [];
    
    constructor(range: Range) {
        super(range);
    }
}

export class VersionDeclaration extends ASTNode {
    public version: string;
    
    constructor(range: Range, version: string) {
        super(range);
        this.version = version;
    }
}

export class ImportDeclaration extends ASTNode {
    public path: string;
    public alias?: string;
    
    constructor(range: Range, path: string, alias?: string) {
        super(range);
        this.path = path;
        this.alias = alias;
    }
}

export class TaskDeclaration extends ASTNode {
    public name: string;
    public inputs: ParameterDeclaration[] = [];
    public outputs: ParameterDeclaration[] = [];
    public command?: CommandBlock;
    public runtime?: RuntimeBlock;
    public meta?: MetaBlock;
    public parameterMeta?: ParameterMetaBlock;
    
    constructor(range: Range, name: string) {
        super(range);
        this.name = name;
    }
}

export class WorkflowDeclaration extends ASTNode {
    public name: string;
    public inputs: ParameterDeclaration[] = [];
    public outputs: ParameterDeclaration[] = [];
    public body: Statement[] = [];
    
    constructor(range: Range, name: string) {
        super(range);
        this.name = name;
    }
}

export class StructDeclaration extends ASTNode {
    public name: string;
    public members: ParameterDeclaration[] = [];
    
    constructor(range: Range, name: string) {
        super(range);
        this.name = name;
    }
}

export class ParameterDeclaration extends ASTNode {
    public name: string;
    public type: WDLType;
    public defaultValue?: Expression;
    public description?: string;
    
    constructor(range: Range, name: string, type: WDLType) {
        super(range);
        this.name = name;
        this.type = type;
    }
}

export abstract class WDLType extends ASTNode {
    public optional: boolean = false;
    
    constructor(range: Range, optional: boolean = false) {
        super(range);
        this.optional = optional;
    }
}

export class PrimitiveType extends WDLType {
    public typeName: 'String' | 'Int' | 'Float' | 'Boolean' | 'File';
    
    constructor(range: Range, typeName: 'String' | 'Int' | 'Float' | 'Boolean' | 'File', optional: boolean = false) {
        super(range, optional);
        this.typeName = typeName;
    }
}

export class ArrayType extends WDLType {
    public elementType: WDLType;
    
    constructor(range: Range, elementType: WDLType, optional: boolean = false) {
        super(range, optional);
        this.elementType = elementType;
    }
}

export class MapType extends WDLType {
    public keyType: WDLType;
    public valueType: WDLType;
    
    constructor(range: Range, keyType: WDLType, valueType: WDLType, optional: boolean = false) {
        super(range, optional);
        this.keyType = keyType;
        this.valueType = valueType;
    }
}

export class PairType extends WDLType {
    public leftType: WDLType;
    public rightType: WDLType;
    
    constructor(range: Range, leftType: WDLType, rightType: WDLType, optional: boolean = false) {
        super(range, optional);
        this.leftType = leftType;
        this.rightType = rightType;
    }
}

export class CustomType extends WDLType {
    public typeName: string;
    
    constructor(range: Range, typeName: string, optional: boolean = false) {
        super(range, optional);
        this.typeName = typeName;
    }
}

export abstract class Statement extends ASTNode {}

export class CallStatement extends Statement {
    public taskName: string;
    public alias?: string;
    public inputs: CallInput[] = [];
    
    constructor(range: Range, taskName: string, alias?: string) {
        super(range);
        this.taskName = taskName;
        this.alias = alias;
    }
}

export class CallInput extends ASTNode {
    public name: string;
    public value: Expression;
    
    constructor(range: Range, name: string, value: Expression) {
        super(range);
        this.name = name;
        this.value = value;
    }
}

export class IfStatement extends Statement {
    public condition: Expression;
    public body: Statement[] = [];
    
    constructor(range: Range, condition: Expression) {
        super(range);
        this.condition = condition;
    }
}

export class ScatterStatement extends Statement {
    public variable: string;
    public collection: Expression;
    public body: Statement[] = [];
    
    constructor(range: Range, variable: string, collection: Expression) {
        super(range);
        this.variable = variable;
        this.collection = collection;
    }
}

export class AssignmentStatement extends Statement {
    public name: string;
    public value: Expression;
    
    constructor(range: Range, name: string, value: Expression) {
        super(range);
        this.name = name;
        this.value = value;
    }
}

export abstract class Expression extends ASTNode {}

export class IdentifierExpression extends Expression {
    public name: string;
    
    constructor(range: Range, name: string) {
        super(range);
        this.name = name;
    }
}

export class MemberExpression extends Expression {
    public object: Expression;
    public property: string;
    
    constructor(range: Range, object: Expression, property: string) {
        super(range);
        this.object = object;
        this.property = property;
    }
}

export class LiteralExpression extends Expression {
    public value: string | number | boolean;
    public literalType: 'string' | 'int' | 'float' | 'boolean';
    
    constructor(range: Range, value: string | number | boolean, literalType: 'string' | 'int' | 'float' | 'boolean') {
        super(range);
        this.value = value;
        this.literalType = literalType;
    }
}

export class ArrayExpression extends Expression {
    public elements: Expression[] = [];
    
    constructor(range: Range) {
        super(range);
    }
}

export class MapExpression extends Expression {
    public entries: MapEntry[] = [];
    
    constructor(range: Range) {
        super(range);
    }
}

export class MapEntry extends ASTNode {
    public key: Expression;
    public value: Expression;
    
    constructor(range: Range, key: Expression, value: Expression) {
        super(range);
        this.key = key;
        this.value = value;
    }
}

export class BinaryExpression extends Expression {
    public left: Expression;
    public operator: string;
    public right: Expression;
    
    constructor(range: Range, left: Expression, operator: string, right: Expression) {
        super(range);
        this.left = left;
        this.operator = operator;
        this.right = right;
    }
}

export class UnaryExpression extends Expression {
    public operator: string;
    public operand: Expression;
    
    constructor(range: Range, operator: string, operand: Expression) {
        super(range);
        this.operator = operator;
        this.operand = operand;
    }
}

export class FunctionCallExpression extends Expression {
    public functionName: string;
    public arguments: Expression[] = [];
    
    constructor(range: Range, functionName: string) {
        super(range);
        this.functionName = functionName;
    }
}

export class CommandBlock extends ASTNode {
    public content: string;
    public interpolations: InterpolationExpression[] = [];
    
    constructor(range: Range, content: string) {
        super(range);
        this.content = content;
    }
}

export class InterpolationExpression extends Expression {
    public expression: Expression;
    public startDelimiter: '~{' | '${';
    
    constructor(range: Range, expression: Expression, startDelimiter: '~{' | '${') {
        super(range);
        this.expression = expression;
        this.startDelimiter = startDelimiter;
    }
}

export class RuntimeBlock extends ASTNode {
    public attributes: RuntimeAttribute[] = [];
    
    constructor(range: Range) {
        super(range);
    }
}

export class RuntimeAttribute extends ASTNode {
    public name: string;
    public value: Expression;
    
    constructor(range: Range, name: string, value: Expression) {
        super(range);
        this.name = name;
        this.value = value;
    }
}

export class MetaBlock extends ASTNode {
    public attributes: MetaAttribute[] = [];
    
    constructor(range: Range) {
        super(range);
    }
}

export class MetaAttribute extends ASTNode {
    public name: string;
    public value: Expression;
    
    constructor(range: Range, name: string, value: Expression) {
        super(range);
        this.name = name;
        this.value = value;
    }
}

export class ParameterMetaBlock extends ASTNode {
    public attributes: ParameterMetaAttribute[] = [];
    
    constructor(range: Range) {
        super(range);
    }
}

export class ParameterMetaAttribute extends ASTNode {
    public parameterName: string;
    public value: Expression;
    
    constructor(range: Range, parameterName: string, value: Expression) {
        super(range);
        this.parameterName = parameterName;
        this.value = value;
    }
}