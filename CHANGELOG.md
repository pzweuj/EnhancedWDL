# Changelog

All notable changes to the "WDL Syntax Pro" extension will be documented in this file.

## [1.0.0] - 2024-01-XX

### Added
- 🎉 Initial release of WDL Syntax Pro
- ✨ Complete syntax highlighting for WDL (Workflow Description Language)
- 🏗️ Support for WDL 2.0 struct definitions
- 🔧 Built-in function highlighting (30+ functions including select_first, select_all, defined, length, etc.)
- 📝 String interpolation support with `~{variable}` and `${expression}` syntax
- 💬 Comment highlighting for `#` style comments
- 🖥️ Command block highlighting with embedded shell script support
- 🎨 Complex type system support including nested generics like `Array[Map[String, File]]`
- 🔗 Proper bracket matching and auto-closing pairs
- 📁 Automatic file association for `.wdl` files

### Features
- **Version Declarations**: `version 2.0` syntax highlighting
- **Import Statements**: Support for import with aliases (`import "file.wdl" as alias`)
- **Workflow & Task Definitions**: Complete block structure highlighting
- **Data Types**: All WDL primitive and collection types
- **Control Flow**: if/else statements and scatter blocks
- **Runtime Specifications**: Container, CPU, memory configurations
- **Custom Types**: User-defined struct types
- **Operators**: Arithmetic, comparison, and logical operators
- **Editor Integration**: Comment toggling, bracket matching, word selection

### Technical Details
- Based on TextMate grammar for fast, lightweight syntax highlighting
- Comprehensive test suite with edge cases and complex scenarios
- Optimized for performance with minimal startup overhead
- Compatible with VS Code, Kiro IDE, and other TextMate-compatible editors

### Testing
- ✅ Basic syntax elements test suite
- ✅ Edge cases and complex nested structures
- ✅ String interpolation in various contexts
- ✅ Command block with shell script embedding
- ✅ All WDL 2.0 features including structs

---

## Future Releases

### Planned for v1.1.0
- Code snippets for common WDL patterns
- Additional built-in functions
- Improved error recovery in malformed syntax

### Planned for v1.2.0
- Basic syntax validation
- Hover documentation for built-in functions
- Code folding support for blocks