#!/bin/sh
# Typecheck zonder node_modules (in een sandbox waar npm install niet kan).
# Gebruikt stubs voor react/react-native/expo; de echte check draait in CI (job "checks").
cd "$(dirname "$0")/.." || exit 1
npx tsc --ignoreConfig --noEmit --strict --jsx react-jsx --target es2022 --module esnext \
  --moduleResolution bundler --skipLibCheck --resolveJsonModule --allowImportingTsExtensions --lib es2022,dom \
  scripts/typecheck-stubs.d.ts App.tsx index.ts \
  $(find src -name "*.ts*" ! -name "*.test.ts") 2>&1 | grep -v "TS7031.*pressed"
exit 0
