# WDL Task Input Hints Feature

## Overview

This feature provides intelligent input parameter hints when you reference tasks in WDL (Workflow Description Language) scripts. It includes:

1. **Task Input Parameter Hints**: See required input parameters when calling tasks
2. **Task Output Completion**: Get autocomplete for task output references
3. **Hover Information**: Detailed parameter information on hover
4. **Validation**: Real-time error checking for task calls

## Features Implemented

### 1. Hover Information
- Hover over task names to see input/output parameters
- Hover over parameter names to see type and description information
- Hover over task.output references to see output details

### 2. Autocomplete
- Type `call ` to get task name suggestions
- Inside task call input blocks, get parameter name suggestions
- When referencing task outputs, get completion for `TaskName.outputName`
- Context-aware completions based on cursor position

### 3. Validation
- Parse errors are highlighted with clear error messages
- Basic syntax validation for WDL files

### 4. Symbol Resolution
- Supports both local task definitions and imported tasks
- Handles import aliases correctly
- Caches symbols for performance

## How to Use

### 1. Task Input Hints
When you write a task call, you'll get autocomplete suggestions for input parameters:

```wdl
call ProcessSample {
    input:
        sample_name = "test",  // Autocomplete will suggest available inputs
        input_file = some_file,
        // Type here to see more input suggestions
}
```

### 2. Task Output References
When referencing task outputs, you'll get autocomplete:

```wdl
call ProcessSample { ... }

call QualityCheck {
    input:
        input_file = ProcessSample.  // Autocomplete will show available outputs
}
```

### 3. Hover Information
Hover over:
- Task names to see their input/output signature
- Parameter names to see type and description
- Task.output references to see output details

## Architecture

The implementation uses a Language Server Protocol (LSP) architecture:

1. **Lexer**: Tokenizes WDL syntax
2. **Parser**: Generates Abstract Syntax Tree (AST)
3. **Symbol Provider**: Manages task and workflow symbols
4. **Completion Provider**: Provides autocomplete suggestions
5. **Hover Provider**: Provides hover information
6. **Diagnostic Provider**: Validates WDL syntax

## Files Created

### Core Language Server
- `src/server/server.ts` - Main language server
- `src/extension.ts` - VS Code extension client

### Parsing and Analysis
- `src/server/lexer.ts` - WDL lexical analyzer
- `src/server/parser.ts` - WDL parser
- `src/server/ast.ts` - Abstract Syntax Tree definitions
- `src/server/taskAnalyzer.ts` - Task definition analyzer
- `src/server/documentAnalyzer.ts` - Document-level analysis

### Language Features
- `src/server/symbolProvider.ts` - Symbol management
- `src/server/hoverProvider.ts` - Hover information
- `src/server/completionProvider.ts` - Autocomplete
- `src/server/diagnosticProvider.ts` - Validation and diagnostics

### Configuration
- `package.json` - Extension configuration
- `tsconfig.json` - TypeScript configuration

## Testing

A test WDL file `test-wdl-features.wdl` is provided to test the functionality. Open this file in VS Code to see:

1. Hover over task names like `ProcessSample` or `QualityCheck`
2. In the workflow, hover over `ProcessSample.output_file`
3. Try autocomplete in task call input blocks
4. Try autocomplete when referencing task outputs

## VS Code Compatibility

This implementation follows the Language Server Protocol standard and should work in:
- VS Code
- VS Code-based editors (Cursor, Code-OSS, etc.)
- Any editor that supports LSP

## Future Enhancements

Potential improvements could include:
- More sophisticated type checking
- Import resolution from remote URLs
- Workflow-level validation
- Performance optimizations for large files
- Integration with WDL execution engines

## Installation

1. Compile the TypeScript code: `npm run compile`
2. Install the extension in VS Code
3. Open WDL files to see the features in action

The language server will automatically start when you open a `.wdl` file and provide intelligent assistance for WDL development.