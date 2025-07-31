#!/bin/bash

echo "Building EnhancedWDL VSCode Extension..."
echo

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_error() {
    echo -e "${RED}Error: $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}$1${NC}"
}

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    print_error "npm is not installed or not in PATH"
    exit 1
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    print_info "Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        print_error "Failed to install dependencies"
        exit 1
    fi
    echo
fi

# Clean previous build
print_info "Cleaning previous build..."
rm -rf out/
rm -f *.vsix
echo

# Compile TypeScript
print_info "Compiling TypeScript..."
npm run compile
if [ $? -ne 0 ]; then
    print_error "TypeScript compilation failed"
    exit 1
fi
echo

# Check if vsce is installed, install if not
print_info "Checking for vsce..."
if ! command -v vsce &> /dev/null; then
    print_info "Installing vsce globally..."
    npm install -g @vscode/vsce
    if [ $? -ne 0 ]; then
        print_error "Failed to install vsce"
        exit 1
    fi
fi
echo

# Package the extension
print_info "Packaging extension..."
vsce package
if [ $? -ne 0 ]; then
    print_error "Failed to package extension"
    exit 1
fi

echo
print_success "Build completed successfully!"
echo

echo "Generated files:"
for file in *.vsix; do
    if [ -f "$file" ]; then
        echo "  - $file"
    fi
done

echo
echo "To install the extension:"
echo "  1. Open VS Code"
echo "  2. Go to Extensions view (Ctrl+Shift+X)"
echo "  3. Click \"...\" menu and select \"Install from VSIX...\""
echo "  4. Select the generated .vsix file"
echo