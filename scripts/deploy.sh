#!/usr/bin/env bash
#
# Deploy the Worker to a specific Cloudflare account.
#
# This repo may be deployed to more than one Cloudflare account, so this script
# loads the API token + account id for a chosen "profile" and exports them before
# running wrangler. With CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID set,
# wrangler targets exactly that account non-interactively (no OAuth, no guessing
# which login happens to be active).
#
# Credentials resolve (see scripts/lib/cloudflare-env.sh):
#   1. CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID already exported in your shell.
#   2. .cloudflare/<profile>.env  (default profile: "default"; git-ignored).
#   3. .dev.vars  (default profile only; single-account convenience).
#
# Usage:
#   scripts/deploy.sh [profile] [-y] [extra wrangler args...]
#
# Examples:
#   scripts/deploy.sh                    # profile "default" (or shell env vars)
#   scripts/deploy.sh personal           # .cloudflare/personal.env
#   scripts/deploy.sh work --dry-run     # pass extra flags through to wrangler
#   scripts/deploy.sh personal -y        # skip the confirmation prompt
#
set -euo pipefail

# Always run from the repo root so wrangler finds wrangler.toml / worker.js.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck source=scripts/lib/cloudflare-env.sh
. "$ROOT/scripts/lib/cloudflare-env.sh"

# Parse args: the first non-flag arg is the profile; -y/--yes skips the prompt;
# everything else is passed straight through to `wrangler deploy`.
PROFILE="default"
ASSUME_YES=0
PROFILE_SET=0
WRANGLER_ARGS=()
for arg in "$@"; do
    case "$arg" in
        -y|--yes) ASSUME_YES=1 ;;
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

# Show which account the token maps to, so a wrong account is caught before deploy.
info "Verifying token with Cloudflare (wrangler whoami)…"
npx wrangler whoami || die "wrangler whoami failed — check the token for profile '$PROFILE'"
info "Target account id: ${CLOUDFLARE_ACCOUNT_ID}  (profile: ${PROFILE})"

# Confirm before deploying, unless -y was passed or there's no terminal attached.
if [ "$ASSUME_YES" -eq 0 ] && [ -t 0 ]; then
    printf '%sDeploy to this account? [y/N]%s ' "$YELLOW" "$NC"
    read -r reply
    case "$reply" in
        [Yy]*) ;;
        *) die "Aborted." ;;
    esac
fi

info "Deploying…"
npx wrangler deploy worker.js ${WRANGLER_ARGS[@]+"${WRANGLER_ARGS[@]}"}
info "${GREEN}Deploy complete.${NC}"
