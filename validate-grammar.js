#!/usr/bin/env node

/**
 * Grammar validation script for WDL syntax highlighting
 * This script validates the TextMate grammar JSON file
 */

const fs = require('fs');
const path = require('path');

function validateGrammar() {
    const grammarPath = path.join(__dirname, 'syntaxes', 'wdl.tmLanguage.json');
    const configPath = path.join(__dirname, 'language-configuration.json');
    const packagePath = path.join(__dirname, 'package.json');
    
    console.log('Validating WDL Language Support Extension...\n');
    
    // Validate package.json
    try {
        const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        console.log('✓ package.json is valid JSON');
        
        // Check required fields
        const required = ['name', 'contributes'];
        for (const field of required) {
            if (!packageJson[field]) {
                console.error(`✗ Missing required field: ${field}`);
                return false;
            }
        }
        
        // Check language contribution
        if (!packageJson.contributes.languages || !packageJson.contributes.grammars) {
            console.error('✗ Missing language or grammar contributions');
            return false;
        }
        
        console.log('✓ package.json has required contributions');
        
    } catch (error) {
        console.error('✗ package.json is invalid:', error.message);
        return false;
    }
    
    // Validate grammar file
    try {
        const grammar = JSON.parse(fs.readFileSync(grammarPath, 'utf8'));
        console.log('✓ wdl.tmLanguage.json is valid JSON');
        
        // Check required fields
        if (!grammar.scopeName || !grammar.patterns || !grammar.repository) {
            console.error('✗ Grammar missing required fields (scopeName, patterns, repository)');
            return false;
        }
        
        console.log('✓ Grammar has required structure');
        
        // Check for key patterns
        const requiredPatterns = [
            'comments', 'version', 'import', 'workflow', 'task', 
            'keywords', 'types', 'strings', 'operators', 'numbers'
        ];
        
        for (const pattern of requiredPatterns) {
            if (!grammar.repository[pattern]) {
                console.error(`✗ Missing pattern: ${pattern}`);
                return false;
            }
        }
        
        console.log('✓ All required patterns are present');
        
    } catch (error) {
        console.error('✗ wdl.tmLanguage.json is invalid:', error.message);
        return false;
    }
    
    // Validate language configuration
    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        console.log('✓ language-configuration.json is valid JSON');
        
        // Check required fields
        if (!config.comments || !config.brackets || !config.autoClosingPairs) {
            console.error('✗ Language configuration missing required fields');
            return false;
        }
        
        console.log('✓ Language configuration has required structure');
        
    } catch (error) {
        console.error('✗ language-configuration.json is invalid:', error.message);
        return false;
    }
    
    console.log('\n🎉 All validation checks passed!');
    console.log('\nNext steps:');
    console.log('1. Install the extension in Kiro');
    console.log('2. Open a .wdl file to test syntax highlighting');
    console.log('3. Use the test files in the test/ directory for verification');
    
    return true;
}

// Run validation
if (require.main === module) {
    const success = validateGrammar();
    process.exit(success ? 0 : 1);
}

module.exports = { validateGrammar };