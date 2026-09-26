import { Lexer } from "./lexer";
import {
    ArrayExpression,
    AssignmentStatement,
    BinaryExpression,
    BlockStatement,
    CallExpression,
    DecoratorStatement,
    Expression,
    ExpressionStatement,
    ForStatement,
    FunctionDeclaration,
    IdentifierExpression,
    IfStatement,
    IncrementStatement,
    LiteralExpression,
    LoopStatement,
    MemberExpression,
    Parser,
    Program,
    ReturnStatement,
    Statement,
    UnaryExpression,
    VariableDeclaration,
    WhileStatement,
} from "./parser";

export type ShrimpIRWrapper = { type: string } & Record<string, unknown>;

export const ShrimpIRBuiltins = {
    root: "root",
    numberLiteral: "number_literal",
    stringLiteral: "string_literal",
    booleanLiteral: "boolean_literal",
    readSymbol: "read_symbol",
    writeVariable: "write_variable",
    add: "add",
    if: "if",
    while: "while",
    functionDefinition: "function_definition",
    functionCall: "function_call",
    return: "return",
    memberAccess: "member_access",
};

export const ShrimpIRExtendedTypes = {
    subtract: "subtract",
    multiply: "multiply",
    divide: "divide",
    modulo: "modulo",
    equal: "equal",
    notEqual: "not_equal",
    lessThan: "less_than",
    greaterThan: "greater_than",
    lessEqual: "less_equal",
    greaterEqual: "greater_equal",
    and: "and",
    or: "or",
    not: "not",
    negate: "negate",
    arrayLiteral: "array_literal",
    indexGet: "index_get",
    indexSet: "index_set",
};

const binaryOps: Record<string, string> = {
    "+": ShrimpIRBuiltins.add,
    "..": ShrimpIRBuiltins.add,
    "-": ShrimpIRExtendedTypes.subtract,
    "*": ShrimpIRExtendedTypes.multiply,
    "/": ShrimpIRExtendedTypes.divide,
    "%": ShrimpIRExtendedTypes.modulo,
    "==": ShrimpIRExtendedTypes.equal,
    "!=": ShrimpIRExtendedTypes.notEqual,
    "<": ShrimpIRExtendedTypes.lessThan,
    ">": ShrimpIRExtendedTypes.greaterThan,
    "<=": ShrimpIRExtendedTypes.lessEqual,
    ">=": ShrimpIRExtendedTypes.greaterEqual,
    "&&": ShrimpIRExtendedTypes.and,
    "||": ShrimpIRExtendedTypes.or,
};

const compoundAssignOps: Record<string, string> = {
    "+=": "+",
    "..=": "..",
    "-=": "-",
    "*=": "*",
    "/=": "/",
    "%=": "%",
};

export class ShrimpIRCodegenError extends Error {
    constructor(
        message: string,
        public line: number,
        public column: number,
    ) {
        super(`${message} at ${line}:${column}`);
        this.name = "ShrimpIRCodegenError";
    }
}

export class ShrimpIRCodegen {
    private anonCount = 0;

    compileProgram(program: Program): ShrimpIRWrapper {
        return {
            type: ShrimpIRBuiltins.root,
            body: this.compileStatements(program.body),
        };
    }

    compileStatements(statements: Statement[]): ShrimpIRWrapper[] {
        const result: ShrimpIRWrapper[] = [];
        for (const stmt of statements) {
            result.push(...this.compileStatement(stmt));
        }
        return result;
    }

    private error(message: string, node: { line: number; column: number }): never {
        throw new ShrimpIRCodegenError(message, node.line, node.column);
    }

    private compileStatement(stmt: Statement): ShrimpIRWrapper[] {
        switch (stmt.type) {
            case "NoopStatement":
                return [];

            case "ExpressionStatement":
                return [this.compileExpression((stmt as ExpressionStatement).expression)];

            case "VariableDeclaration": {
                const decl = stmt as VariableDeclaration;
                return [
                    {
                        type: ShrimpIRBuiltins.writeVariable,
                        symbol: decl.name,
                        value: this.compileExpression(decl.initializer),
                    },
                ];
            }

            case "AssignmentStatement": {
                const assign = stmt as AssignmentStatement;
                return [this.compileAssignment(assign)];
            }

            case "IncrementStatement": {
                const inc = stmt as IncrementStatement;
                const op =
                    inc.operator === "++" ? ShrimpIRBuiltins.add : ShrimpIRExtendedTypes.subtract;
                return [
                    this.writeTarget(
                        inc.target,
                        {
                            type: op,
                            a: this.compileReadTarget(inc.target),
                            b: { type: ShrimpIRBuiltins.numberLiteral, content: 1 },
                        },
                        inc,
                    ),
                ];
            }

            case "IfStatement": {
                const ifStmt = stmt as IfStatement;
                return [
                    {
                        type: ShrimpIRBuiltins.if,
                        condition: this.compileExpression(ifStmt.condition),
                        thenBody: this.blockToStatements(ifStmt.then),
                        elseBody: ifStmt.else ? this.blockToStatements(ifStmt.else) : [],
                    },
                ];
            }

            case "WhileStatement": {
                const whileStmt = stmt as WhileStatement;
                return [
                    {
                        type: ShrimpIRBuiltins.while,
                        condition: this.not(this.compileExpression(whileStmt.condition)),
                        body: this.blockToStatements(whileStmt.body),
                    },
                ];
            }

            case "LoopStatement": {
                const loop = stmt as LoopStatement;
                return [
                    {
                        type: ShrimpIRBuiltins.while,
                        condition: this.not({
                            type: ShrimpIRBuiltins.booleanLiteral,
                            content: true,
                        }),
                        body: this.blockToStatements(loop.body),
                    },
                ];
            }

            case "ForStatement": {
                const forStmt = stmt as ForStatement;
                const result: ShrimpIRWrapper[] = [];
                if (forStmt.init) {
                    result.push(...this.compileStatement(forStmt.init));
                }
                const condition = forStmt.condition
                    ? this.not(this.compileExpression(forStmt.condition))
                    : this.not({ type: ShrimpIRBuiltins.booleanLiteral, content: true });
                const body = this.blockToStatements(forStmt.body);
                if (forStmt.increment) {
                    body.push(...this.compileStatement(forStmt.increment));
                }
                result.push({
                    type: ShrimpIRBuiltins.while,
                    condition,
                    body,
                });
                return result;
            }

            case "ReturnStatement": {
                const ret = stmt as ReturnStatement;
                return [
                    {
                        type: ShrimpIRBuiltins.return,
                        data: ret.value
                            ? this.compileExpression(ret.value)
                            : { type: ShrimpIRBuiltins.booleanLiteral, content: false },
                    },
                ];
            }

            case "BlockStatement":
                return this.compileStatements((stmt as BlockStatement).body);

            case "FunctionDeclaration": {
                const fn = stmt as FunctionDeclaration;
                return [
                    {
                        type: ShrimpIRBuiltins.functionDefinition,
                        async: fn.once,
                        generator: false,
                        capture: false,
                        name: fn.name.name,
                        params: fn.parameters.map((p) => p.name.name),
                        body: this.compileStatements(fn.body.body),
                    },
                ];
            }

            case "DecoratorStatement": {
                const decorator = stmt as DecoratorStatement;
                const result = this.compileStatement(decorator.target);
                if (decorator.name.name === "export" && decorator.arguments.length > 0) {
                    const exportValue = decorator.arguments[0].value;
                    for (const wrapper of result) {
                        wrapper.export = exportValue;
                    }
                }
                return result;
            }

            case "ExternDeclaration":
            case "ModuleDeclaration":
            case "ImportStatement":
                this.error(`${stmt.type} cannot be represented in ShrimpIR`, stmt);

            default:
                this.error(`Unsupported statement type: ${stmt.type}`, stmt);
        }
    }

    private compileAssignment(assign: AssignmentStatement): ShrimpIRWrapper {
        const value = this.compileExpression(assign.right);
        const compoundOp = assign.operator === "=" ? null : compoundAssignOps[assign.operator];
        if (!compoundOp && assign.operator !== "=") {
            this.error(`Unsupported assignment operator: ${assign.operator}`, assign);
        }

        const finalValue = compoundOp
            ? this.binaryNode(compoundOp, this.compileReadTarget(assign.left), value, assign)
            : value;
        return this.writeTarget(assign.left, finalValue, assign);
    }

    private writeTarget(
        target: Expression,
        value: ShrimpIRWrapper,
        node: { line: number; column: number },
    ): ShrimpIRWrapper {
        if (target.type === "Identifier") {
            return {
                type: ShrimpIRBuiltins.writeVariable,
                symbol: (target as IdentifierExpression).name,
                value,
            };
        }
        if (target.type === "MemberExpression") {
            const member = target as MemberExpression;
            if (member.computed) {
                return {
                    type: ShrimpIRExtendedTypes.indexSet,
                    object: this.compileExpression(member.object),
                    index: this.compileExpression(member.property),
                    value,
                };
            }
            return {
                type: ShrimpIRBuiltins.memberAccess,
                object: this.compileExpression(member.object),
                key: (member.property as IdentifierExpression).name,
                write: true,
                value,
            };
        }
        this.error("Invalid assignment target", node);
    }

    private compileReadTarget(target: Expression): ShrimpIRWrapper {
        if (target.type === "MemberExpression") {
            const member = target as MemberExpression;
            if (member.computed) {
                return {
                    type: ShrimpIRExtendedTypes.indexGet,
                    object: this.compileExpression(member.object),
                    index: this.compileExpression(member.property),
                };
            }
            return this.memberRead(member);
        }
        return this.compileExpression(target);
    }

    private memberRead(member: MemberExpression): ShrimpIRWrapper {
        return {
            type: ShrimpIRBuiltins.memberAccess,
            object: this.compileExpression(member.object),
            key: (member.property as IdentifierExpression).name,
            write: false,
            value: { type: ShrimpIRBuiltins.booleanLiteral, content: false },
        };
    }

    private blockToStatements(stmt: Statement): ShrimpIRWrapper[] {
        if (stmt.type === "BlockStatement") {
            return this.compileStatements((stmt as BlockStatement).body);
        }
        return this.compileStatement(stmt);
    }

    private not(operand: ShrimpIRWrapper): ShrimpIRWrapper {
        return { type: ShrimpIRExtendedTypes.not, operand };
    }

    private binaryNode(
        op: string,
        left: ShrimpIRWrapper,
        right: ShrimpIRWrapper,
        node: { line: number; column: number },
    ): ShrimpIRWrapper {
        const type = binaryOps[op];
        if (!type) {
            this.error(`Unsupported operator: ${op}`, node);
        }
        return { type, a: left, b: right };
    }

    compileExpression(expr: Expression): ShrimpIRWrapper {
        switch (expr.type) {
            case "Literal": {
                const lit = expr as LiteralExpression;
                if (typeof lit.value === "number") {
                    if (!Number.isFinite(lit.value)) {
                        this.error(`Number literal ${lit.raw} is not representable in JSON`, lit);
                    }
                    return { type: ShrimpIRBuiltins.numberLiteral, content: lit.value };
                }
                if (typeof lit.value === "boolean") {
                    return { type: ShrimpIRBuiltins.booleanLiteral, content: lit.value };
                }
                return { type: ShrimpIRBuiltins.stringLiteral, content: lit.value };
            }

            case "Identifier":
                return {
                    type: ShrimpIRBuiltins.readSymbol,
                    symbol: (expr as IdentifierExpression).name,
                };

            case "ArrayExpression":
                return {
                    type: ShrimpIRExtendedTypes.arrayLiteral,
                    items: (expr as ArrayExpression).elements.map((e) => this.compileExpression(e)),
                };

            case "BinaryExpression": {
                const bin = expr as BinaryExpression;
                return this.binaryNode(
                    bin.operator,
                    this.compileExpression(bin.left),
                    this.compileExpression(bin.right),
                    bin,
                );
            }

            case "UnaryExpression": {
                const unary = expr as UnaryExpression;
                const operand = this.compileExpression(unary.operand);
                if (unary.operator === "!") {
                    return { type: ShrimpIRExtendedTypes.not, operand };
                }
                if (unary.operator === "-") {
                    return { type: ShrimpIRExtendedTypes.negate, operand };
                }
                return operand;
            }

            case "MemberExpression": {
                const member = expr as MemberExpression;
                if (member.computed) {
                    return {
                        type: ShrimpIRExtendedTypes.indexGet,
                        object: this.compileExpression(member.object),
                        index: this.compileExpression(member.property),
                    };
                }
                return this.memberRead(member);
            }

            case "CallExpression": {
                const call = expr as CallExpression;
                const params = call.arguments.map((arg) => this.compileExpression(arg));
                if (call.then) {
                    this.anonCount++;
                    params.push({
                        type: ShrimpIRBuiltins.functionDefinition,
                        async: false,
                        generator: false,
                        capture: false,
                        name: `$then_${this.anonCount}`,
                        params: [] as string[],
                        body: this.compileStatements(call.then.body),
                    });
                }
                return {
                    type: ShrimpIRBuiltins.functionCall,
                    func: this.compileCallee(call),
                    params,
                };
            }

            default:
                this.error(`Unsupported expression type: ${expr.type}`, expr);
        }
    }

    private compileCallee(call: CallExpression): ShrimpIRWrapper {
        const callee = call.callee;
        if (callee.type === "Identifier") {
            return {
                type: ShrimpIRBuiltins.readSymbol,
                symbol: (callee as IdentifierExpression).name,
            };
        }
        if (callee.type === "MemberExpression") {
            const member = callee as MemberExpression;
            if (!member.computed) {
                return this.memberRead(member);
            }
        }
        return this.compileExpression(callee);
    }
}

export function compileToShrimpIR(source: string | Program): ShrimpIRWrapper {
    const program = typeof source === "string" ? new Parser(new Lexer(source)).parse() : source;
    return new ShrimpIRCodegen().compileProgram(program);
}

export function toShrimpIRJson(source: string | Program, indent = 2): string {
    return JSON.stringify(compileToShrimpIR(source), null, indent);
}
