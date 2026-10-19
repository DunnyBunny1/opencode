#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
unset OPENCODE_CUSTOM
export OPENCODE_VERSION="$(bun -p 'require("./package.json").version')-custom.$(git rev-parse --short HEAD).$(date +%Y%m%d%H%M%S)"
export OPENCODE_CLI_DIST="$PWD/packages/cli/dist"
export CSC_IDENTITY_AUTO_DISCOVERY=false
bun install --frozen-lockfile
bun run check
(cd packages/desktop && bun test --timeout 30000)
export OPENCODE_CUSTOM=1 OPENCODE_CHANNEL=dev
bun packages/cli/script/build.ts --single --skip-install
(cd packages/desktop && bun run build && bun run package --mac --arm64 --dir --publish never)
app="$PWD/packages/desktop/dist/mac-arm64/OpenCode Custom.app"
"$app/Contents/Resources/opencode-cli" --version
codesign --force --deep --sign - --entitlements packages/desktop/resources/entitlements.plist "$app"
codesign --verify --deep --strict "$app"
node script/custom-smoke.mjs "$app"
