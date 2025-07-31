@echo off
echo Building EnhancedWDL VSCode Extension...
echo.

REM Check if npm is installed
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: npm is not installed or not in PATH
    pause
    exit /b 1
)

REM Install dependencies if node_modules doesn't exist
if not exist "node_modules" (
    echo Installing dependencies...
    npm install
    if %errorlevel% neq 0 (
        echo Error: Failed to install dependencies
        pause
        exit /b 1
    )
    echo.
)

REM Clean previous build
echo Cleaning previous build...
if exist "out" rmdir /s /q "out"
if exist "*.vsix" del /q "*.vsix"
echo.

REM Compile TypeScript
echo Compiling TypeScript...
npm run compile
if %errorlevel% neq 0 (
    echo Error: TypeScript compilation failed
    pause
    exit /b 1
)
echo.

REM Install vsce if not already installed
echo Checking for vsce...
vsce --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing vsce globally...
    npm install -g @vscode/vsce
    if %errorlevel% neq 0 (
        echo Error: Failed to install vsce
        pause
        exit /b 1
    )
)
echo.

REM Package the extension
echo Packaging extension...
vsce package
if %errorlevel% neq 0 (
    echo Error: Failed to package extension
    pause
    exit /b 1
)

echo.
echo ✅ Build completed successfully!
echo.
echo Generated files:
for %%f in (*.vsix) do (
    echo   - %%f
    echo   - Size: 
    dir "%%f" | findstr "%%f"
)

echo.
echo To install the extension:
echo   1. Open VS Code
echo   2. Go to Extensions view (Ctrl+Shift+X)
echo   3. Click "..." menu and select "Install from VSIX..."
echo   4. Select the generated .vsix file
echo.
echo Press any key to exit...
pause >nul