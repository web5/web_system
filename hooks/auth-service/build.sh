#!/usr/bin/env bash
set -e
cd "${RELEASE_DIR}/servers/${MODULE_DIR}"
rm -rf dist
npx tsc -p tsconfig.json
