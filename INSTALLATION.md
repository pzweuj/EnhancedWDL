# WDL Language Support Installation Guide

## Integration with Kiro

This WDL language support extension is designed to integrate with Kiro's language system to provide syntax highlighting for `.wdl` files.

## Installation Steps

### 1. Extension Placement
Place the `wdl-language-support` directory in Kiro's extensions folder:
```
<kiro-extensions-directory>/wdl-language-support/
```

### 2. Extension Registration
The extension should be automatically detected by Kiro through the `package.json` contribution points:

```json
{
  "contributes": {
    "languages": [
      {
        "id": "wdl",
        "aliases": ["WDL", "Workflow Description Language"],
        "extensions": [".wdl"],
        "configuration": "./language-configuration.json"
      }
    ],
    "grammars": [
      {
        "language": "wdl",
        "scopeName": "source.wdl",
        "path": "./syntaxes/wdl.tmLanguage.json"
      }
    ]
  }
}
```

### 3. File Association
Once installed, Kiro should automatically:
- Recognize `.wdl` files as WDL language files
- Apply the WDL syntax highlighting grammar
- Enable WDL-specific editor features (comment toggling, bracket matching, etc.)

### 4. Verification
To verify the installation:

1. Open a `.wdl` file in Kiro
2. Check that the language mode shows "WDL" in the status bar
3. Verify that syntax highlighting is applied:
   - Keywords should be highlighted (workflow, task, input, output, etc.)
   - Strings should be highlighted with interpolation support
   - Comments should be highlighted
   - Command blocks should have embedded shell highlighting

### 5. Testing
Use the provided test files to verify functionality:
- `test/test-samples.wdl` - Basic syntax elements
- `test/edge-cases.wdl` - Complex and edge case scenarios

## Troubleshooting

### Extension Not Loading
- Verify the extension is in the correct directory
- Check that `package.json` is valid JSON
- Restart Kiro to reload extensions

### Syntax Highlighting Not Working
- Verify the `.tmLanguage.json` file is valid JSON
- Check that the `scopeName` matches between `package.json` and the grammar file
- Ensure the file has the `.wdl` extension

### Editor Features Not Working
- Check that `language-configuration.json` is properly formatted
- Verify bracket pairs and comment patterns are correctly defined

## Theme Integration

The WDL grammar uses standard TextMate scope names that should work with most themes:
- `keyword.control.wdl` - Maps to theme's keyword color
- `string.quoted.double.wdl` - Maps to theme's string color
- `comment.line.number-sign.wdl` - Maps to theme's comment color
- `storage.type.wdl` - Maps to theme's type color

If specific WDL colors are desired, theme authors can add rules for these scopes.