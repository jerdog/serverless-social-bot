#!/usr/bin/env bash
#
# Run `wrangler dev` against a specific Cloudflare account.
#
# The Worker uses a Workers AI binding, which authenticates against your real
# Cloudflare account even in local dev — so wrangler needs credentials. Wrangler
# reads them from the environment (NOT from .dev.vars, which only feeds the
# Worker's own runtime bindings), so this script exports the right account's
# token + id before starting the dev server, avoiding the interactive OAuth login.
#
# Credentials resolve the same way as scripts/deploy.sh (see
# scripts/lib/cloudflare-env.sh):
#   1. CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID from your shell.
#   2. .cloudflare/<profile>.env  (default profile: "default").
#   3. .dev.vars  (default profile only).
#
# Usage:
#   scripts/dev.sh [profile] [extra wrangler dev args...]
#
# Examples:
#   scripts/dev.sh                       # profile "default"
#   scripts/dev.sh personal              # .cloudflare/personal.env
#   scripts/dev.sh --port 8788           # pass flags through to wrangler dev
#
set -euo pipefail

# Always run from the repo root so wrangler finds wrangler.toml / worker.js.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck source=scripts/lib/cloudflare-env.sh
. "$ROOT/scripts/lib/cloudflare-env.sh"

# Parse args: the first non-flag arg is the profile; everything else passes
# through to `wrangler dev`.
PROFILE="default"
PROFILE_SET=0
WRANGLER_ARGS=()
for arg in "$@"; do
    case "$arg" in
        -*) WRANGLER_ARGS+=("$arg") ;;
        *)
            if [ "$PROFILE_SET" -eq 0 ]; then
                PROFILE="$arg"; PROFILE_SET=1
            else
                WRANGLER_ARGS+=("$arg")
            fi
            ;;
    esac
done

load_cloudflare_creds "$PROFILE"

info "Starting wrangler dev (account ${CLOUDFLARE_ACCOUNT_ID}, profile ${PROFILE})…"
npx wrangler dev worker.js ${WRANGLER_ARGS[@]+"${WRANGLER_ARGS[@]}"}
