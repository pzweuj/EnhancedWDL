import * as AST from './ast';

export interface ParameterInfo {
    name: string;
    type: TypeInfo;
    optional: boolean;
    defaultValue?: any;
    description?: string;
}

export interface TypeInfo {
    name: string;
    optional: boolean;
    arrayElementType?: TypeInfo;
    mapKeyType?: TypeInfo;
    mapValueType?: TypeInfo;
    pairLeftType?: TypeInfo;
    pairRightType?: TypeInfo;
}

export interface TaskInfo {
    name: string;
    inputs: ParameterInfo[];
    outputs: ParameterInfo[];
    description?: string;
    sourceFile: string;
    range: AST.Range;
}

export class TaskAnalyzer {
    
    /**
     * Analyze a task declaration and extract parameter information
     */
    analyzeTask(task: AST.TaskDeclaration, sourceFile: string): TaskInfo {
        const taskInfo: TaskInfo = {
            name: task.name,
            inputs: [],
            outputs: [],
            sourceFile,
            range: task.range
        };
        
        // Extract input parameters
        for (const input of task.inputs) {
            taskInfo.inputs.push(this.analyzeParameter(input, task));
        }
        
        // Extract output parameters
        for (const output of task.outputs) {
            taskInfo.outputs.push(this.analyzeParameter(output, task));
        }
        
        // Extract description from meta block
        if (task.meta) {
            taskInfo.description = this.extractDescription(task.meta);
        }
        
        return taskInfo;
    }
    
    /**
     * Analyze a parameter declaration
     */
    private analyzeParameter(param: AST.ParameterDeclaration, task: AST.TaskDeclaration): ParameterInfo {
        const paramInfo: ParameterInfo = {
            name: param.name,
            type: this.analyzeType(param.type),
            optional: param.type.optional || param.defaultValue !== undefined,
            defaultValue: this.extractDefaultValue(param.defaultValue)
        };
        
        // Extract description from parameter_meta block
        if (task.parameterMeta) {
            paramInfo.description = this.extractParameterDescription(param.name, task.parameterMeta);
        }
        
        return paramInfo;
    }
    
    /**
     * Analyze a WDL type and convert to TypeInfo
     */
    private analyzeType(type: AST.WDLType): TypeInfo {
        const typeInfo: TypeInfo = {
            name: '',
            optional: type.optional
        };
        
        if (type instanceof AST.PrimitiveType) {
            typeInfo.name = type.typeName;
        } else if (type instanceof AST.ArrayType) {
            typeInfo.name = 'Array';
            typeInfo.arrayElementType = this.analyzeType(type.elementType);
        } else if (type instanceof AST.MapType) {
            typeInfo.name = 'Map';
            typeInfo.mapKeyType = this.analyzeType(type.keyType);
            typeInfo.mapValueType = this.analyzeType(type.valueType);
        } else if (type instanceof AST.PairType) {
            typeInfo.name = 'Pair';
            typeInfo.pairLeftType = this.analyzeType(type.leftType);
            typeInfo.pairRightType = this.analyzeType(type.rightType);
        } else if (type instanceof AST.CustomType) {
            typeInfo.name = type.typeName;
        }
        
        return typeInfo;
    }
    
    /**
     * Extract default value from expression
     */
    private extractDefaultValue(expr?: AST.Expression): any {
        if (!expr) return undefined;
        
        if (expr instanceof AST.LiteralExpression) {
            return expr.value;
        } else if (expr instanceof AST.ArrayExpression) {
            return expr.elements.map(el => this.extractDefaultValue(el));
        } else if (expr instanceof AST.IdentifierExpression) {
            return expr.name;
        }
        
        // For complex expressions, return a string representation
        return this.expressionToString(expr);
    }
    
    /**
     * Convert expression to string representation
     */
    private expressionToString(expr: AST.Expression): string {
        if (expr instanceof AST.LiteralExpression) {
            if (expr.literalType === 'string') {
                return `"${expr.value}"`;
            }
            return String(expr.value);
        } else if (expr instanceof AST.IdentifierExpression) {
            return expr.name;
        } else if (expr instanceof AST.MemberExpression) {
            return `${this.expressionToString(expr.object)}.${expr.property}`;
        } else if (expr instanceof AST.BinaryExpression) {
            return `${this.expressionToString(expr.left)} ${expr.operator} ${this.expressionToString(expr.right)}`;
        } else if (expr instanceof AST.UnaryExpression) {
            return `${expr.operator}${this.expressionToString(expr.operand)}`;
        } else if (expr instanceof AST.FunctionCallExpression) {
            const args = expr.arguments.map(arg => this.expressionToString(arg)).join(', ');
            return `${expr.functionName}(${args})`;
        } else if (expr instanceof AST.ArrayExpression) {
            const elements = expr.elements.map(el => this.expressionToString(el)).join(', ');
            return `[${elements}]`;
        }
        
        return '<complex expression>';
    }
    
    /**
     * Extract description from meta block
     */
    private extractDescription(meta: AST.MetaBlock): string | undefined {
        for (const attr of meta.attributes) {
            if (attr.name === 'description' && attr.value instanceof AST.LiteralExpression) {
                return String(attr.value.value);
            }
        }
        return undefined;
    }
    
    /**
     * Extract parameter description from parameter_meta block
     */
    private extractParameterDescription(paramName: string, paramMeta: AST.ParameterMetaBlock): string | undefined {
        for (const attr of paramMeta.attributes) {
            if (attr.parameterName === paramName && attr.value instanceof AST.LiteralExpression) {
                return String(attr.value.value);
            }
        }
        return undefined;
    }
    
    /**
     * Format type information as a readable string
     */
    formatType(type: TypeInfo): string {
        let typeStr = type.name;
        
        if (type.name === 'Array' && type.arrayElementType) {
            typeStr = `Array[${this.formatType(type.arrayElementType)}]`;
        } else if (type.name === 'Map' && type.mapKeyType && type.mapValueType) {
            typeStr = `Map[${this.formatType(type.mapKeyType)}, ${this.formatType(type.mapValueType)}]`;
        } else if (type.name === 'Pair' && type.pairLeftType && type.pairRightType) {
            typeStr = `Pair[${this.formatType(type.pairLeftType)}, ${this.formatType(type.pairRightType)}]`;
        }
        
        if (type.optional) {
            typeStr += '?';
        }
        
        return typeStr;
    }
    
    /**
     * Format parameter information as a readable string
     */
    formatParameter(param: ParameterInfo): string {
        let paramStr = `${this.formatType(param.type)} ${param.name}`;
        
        if (param.defaultValue !== undefined) {
            paramStr += ` = ${param.defaultValue}`;
        }
        
        if (param.description) {
            paramStr += ` // ${param.description}`;
        }
        
        return paramStr;
    }
    
    /**
     * Check if a type is compatible with another type
     */
    isTypeCompatible(sourceType: TypeInfo, targetType: TypeInfo): boolean {
        // Exact match
        if (this.formatType(sourceType) === this.formatType(targetType)) {
            return true;
        }
        
        // Optional compatibility
        if (targetType.optional && sourceType.name === targetType.name) {
            return true;
        }
        
        // Array compatibility
        if (sourceType.name === 'Array' && targetType.name === 'Array' &&
            sourceType.arrayElementType && targetType.arrayElementType) {
            return this.isTypeCompatible(sourceType.arrayElementType, targetType.arrayElementType);
        }
        
        // Map compatibility
        if (sourceType.name === 'Map' && targetType.name === 'Map' &&
            sourceType.mapKeyType && sourceType.mapValueType &&
            targetType.mapKeyType && targetType.mapValueType) {
            return this.isTypeCompatible(sourceType.mapKeyType, targetType.mapKeyType) &&
                   this.isTypeCompatible(sourceType.mapValueType, targetType.mapValueType);
        }
        
        // Pair compatibility
        if (sourceType.name === 'Pair' && targetType.name === 'Pair' &&
            sourceType.pairLeftType && sourceType.pairRightType &&
            targetType.pairLeftType && targetType.pairRightType) {
            return this.isTypeCompatible(sourceType.pairLeftType, targetType.pairLeftType) &&
                   this.isTypeCompatible(sourceType.pairRightType, targetType.pairRightType);
        }
        
        // Basic type coercion rules
        if (sourceType.name === 'Int' && targetType.name === 'Float') {
            return true;
        }
        
        if (sourceType.name === 'String' && targetType.name === 'File') {
            return true;
        }
        
        return false;
    }
    
    /**
     * Validate that all required parameters are provided
     */
    validateRequiredParameters(taskInfo: TaskInfo, providedInputs: string[]): string[] {
        const errors: string[] = [];
        
        for (const input of taskInfo.inputs) {
            if (!input.optional && !providedInputs.includes(input.name)) {
                errors.push(`Missing required input parameter: ${input.name}`);
            }
        }
        
        return errors;
    }
    
    /**
     * Validate that provided parameters exist in task definition
     */
    validateProvidedParameters(taskInfo: TaskInfo, providedInputs: string[]): string[] {
        const errors: string[] = [];
        const validInputNames = taskInfo.inputs.map(input => input.name);
        
        for (const providedInput of providedInputs) {
            if (!validInputNames.includes(providedInput)) {
                errors.push(`Unknown input parameter: ${providedInput}`);
            }
        }
        
        return errors;
    }
}