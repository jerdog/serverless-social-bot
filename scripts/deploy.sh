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
# Credentials are resolved in this order:
#   1. CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID already exported in your shell.
#   2. A profile file: .cloudflare/<profile>.env  (default profile: "default").
#      That directory is git-ignored. Format (see .cloudflare.env.example):
#          CLOUDFLARE_API_TOKEN=xxxxxxxx
#          CLOUDFLARE_ACCOUNT_ID=xxxxxxxx
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

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; NC=$'\033[0m'
info() { printf '%s==>%s %s\n' "$YELLOW" "$NC" "$1"; }
die()  { printf '%sError:%s %s\n' "$RED" "$NC" "$1" >&2; exit 1; }

# Always run from the repo root so wrangler finds wrangler.toml / worker.js.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Read a KEY=value from a dotenv-style file, stripping quotes and inline comments.
read_dotenv_var() {
    grep -E "^[[:space:]]*$1[[:space:]]*=" "$2" | head -n1 \
        | sed -E "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//; s/[[:space:]]+#.*$//; s/^\"(.*)\"\$/\1/; s/^'(.*)'\$/\1/"
}

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

# Resolve credentials.
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ] && [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
    info "Using CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID from the environment"
elif [ -f ".cloudflare/${PROFILE}.env" ]; then
    ENV_FILE=".cloudflare/${PROFILE}.env"
    info "Loading credentials from $ENV_FILE"
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
elif [ "$PROFILE" = "default" ] && [ -f ".dev.vars" ] && grep -qE "^[[:space:]]*CLOUDFLARE_API_TOKEN[[:space:]]*=" .dev.vars; then
    # Single-account convenience: pick the two CF vars out of .dev.vars.
    info "Loading Cloudflare credentials from .dev.vars"
    CLOUDFLARE_API_TOKEN="$(read_dotenv_var CLOUDFLARE_API_TOKEN .dev.vars)"
    CLOUDFLARE_ACCOUNT_ID="$(read_dotenv_var CLOUDFLARE_ACCOUNT_ID .dev.vars)"
else
    die "No Cloudflare credentials found.
Provide them in one of these ways:
  - export CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, or
  - create .cloudflare/${PROFILE}.env (see .cloudflare.env.example):
        mkdir -p .cloudflare
        cp .cloudflare.env.example .cloudflare/${PROFILE}.env
  - or set CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID in .dev.vars (default profile only)"
fi

[ -n "${CLOUDFLARE_API_TOKEN:-}" ]  || die "CLOUDFLARE_API_TOKEN is not set"
[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] || die "CLOUDFLARE_ACCOUNT_ID is not set"
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

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
