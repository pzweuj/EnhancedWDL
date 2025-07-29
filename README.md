# WDL Syntax Pro

Professional syntax highlighting and language support for WDL (Workflow Description Language) files with enhanced features for modern code editors.

## Features

- Syntax highlighting for WDL keywords, data types, operators, and constructs
- Support for string interpolation with `~{variable}` and `${expression}` syntax
- Comment highlighting for `#` style comments
- Command block highlighting with embedded shell script support
- Proper bracket matching and auto-closing pairs
- File association for `.wdl` files

## Supported WDL Elements

- Version declarations (`version 2.0`)
- Import statements with aliases
- Workflow and task definitions
- Struct definitions (WDL 2.0)
- Input/output blocks
- Command blocks with `<<<` and `>>>` delimiters
- Runtime specifications
- Data types: String, Int, Float, Boolean, File, Array, Map, Pair, Object
- Generic types with proper nesting: `Array[Map[String, File]]`
- Custom struct types
- Control flow: if/else statements, scatter blocks
- Variable references and string interpolation
- Built-in functions: select_first, select_all, defined, length, basename, size, glob, read_*, write_*, stdout, stderr, floor, ceil, round, min, max, sep, quote, squote, sub, range, transpose, zip, cross, unzip, flatten

## Installation

This extension is designed to be integrated with Kiro's language system for automatic WDL file recognition and highlighting.