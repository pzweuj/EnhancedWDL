# WDL Grammar Test Cases

This document outlines test cases for verifying the WDL syntax highlighting grammar.

## Test Categories

### 1. Version Declaration
- `version 2.0` - Should highlight "version" as keyword and "2.0" as numeric constant
- `version 1.0` - Should work with different version numbers

### 2. Import Statements
- `import "./path/file.wdl"` - Basic import with string path
- `import "./path/file.wdl" as alias` - Import with alias
- Should highlight "import" and "as" as keywords, path as string, alias as identifier

### 3. Workflow Definition
- `workflow WorkflowName { ... }` - Should highlight "workflow" as keyword, name as function name
- Nested input/output blocks should be properly scoped

### 4. Task Definition
- `task TaskName { ... }` - Should highlight "task" as keyword, name as function name
- Command blocks with `<<<` and `>>>` should be highlighted as embedded shell

### 5. Data Types
- Primitive types: `String`, `Int`, `Float`, `Boolean`, `File`
- Collection types: `Array[String]`, `Map[String, Int]`, `Pair[Int, String]`
- Optional types: `String?`, `Int?`

### 6. String Interpolation
- `"~{variable}"` - WDL-style interpolation
- `"${expression}"` - Alternative interpolation syntax
- Mixed strings: `"prefix ~{var} suffix"`

### 7. Comments
- `# Single line comment` - Should be highlighted as comment
- Inline comments: `String var = "value" # comment`

### 8. Command Blocks
- Shell commands within `<<<` and `>>>` delimiters
- Variable interpolation within command blocks: `~{variable}`
- Shell-specific syntax highlighting (if, for, echo, etc.)

### 9. Control Flow
- `if (condition) { ... }` - Conditional blocks
- `scatter (item in array) { ... }` - Scatter blocks
- `else` statements

### 10. Operators and Delimiters
- Comparison: `==`, `!=`, `<`, `>`, `<=`, `>=`
- Logical: `&&`, `||`, `!`
- Arithmetic: `+`, `-`, `*`, `/`, `%`
- Assignment: `=`
- Punctuation: `,`, `;`, `:`, `{`, `}`, `[`, `]`, `(`, `)`

### 11. Keywords
- Block keywords: `input`, `output`, `runtime`, `meta`, `parameter_meta`
- Control keywords: `call`, `if`, `else`, `scatter`, `as`
- Literals: `true`, `false`, `null`

### 12. Numbers
- Integers: `42`, `0`, `123`
- Floats: `3.14`, `0.5`, `2.0`

## Expected Scope Names

The grammar should assign the following scope names:

- `keyword.control.wdl` - WDL control keywords
- `keyword.control.flow.wdl` - Flow control (if, else, scatter)
- `storage.type.primitive.wdl` - Primitive data types
- `storage.type.collection.wdl` - Collection data types
- `string.quoted.double.wdl` - String literals
- `meta.embedded.expression.wdl` - String interpolation
- `comment.line.number-sign.wdl` - Comments
- `meta.embedded.block.shell.wdl` - Command blocks
- `constant.numeric.wdl` - Numbers
- `entity.name.function.workflow.wdl` - Workflow names
- `entity.name.function.task.wdl` - Task names

## Manual Testing Checklist

1. Open test-samples.wdl in Kiro
2. Verify that keywords are highlighted in the theme's keyword color
3. Check that strings are highlighted in the theme's string color
4. Confirm that comments are highlighted in the theme's comment color
5. Verify that command blocks have distinct highlighting
6. Test that string interpolation is visually distinct
7. Check that data types are highlighted appropriately
8. Verify that operators and punctuation are highlighted
9. Test bracket matching and auto-closing functionality
10. Verify that comment toggling works with # character