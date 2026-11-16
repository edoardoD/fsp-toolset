#!/usr/bin/env bash
set -euo pipefail

# Spostati nella directory dello script
cd "$(dirname "$0")"

echo "=== 1. Compilazione Java Bridge e Bundle Estensione ==="
npm run build:java
npm run build

echo "=== 2. Esecuzione Suite di Test ==="
npm test

echo "=== 3. Creazione Pacchetto VSIX ==="
VERSION=$(node -p "require('./package.json').version")
VSIX_FILE="fsp-toolset-modern-${VERSION}.vsix"
npx @vscode/vsce package --no-dependencies

echo "=== 4. Pubblicazione su Visual Studio Marketplace ==="
npx @vscode/vsce publish --packagePath "${VSIX_FILE}"

echo "✅ Pubblicazione completata per la versione ${VERSION}!"
