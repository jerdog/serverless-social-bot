# Shared helpers for the Cloudflare deploy/dev scripts. Source this file; it is
# not meant to be executed directly.
#
# Provides: info, die, read_dotenv_var, load_cloudflare_creds.

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; NC=$'\033[0m'
info() { printf '%s==>%s %s\n' "$YELLOW" "$NC" "$1"; }
die()  { printf '%sError:%s %s\n' "$RED" "$NC" "$1" >&2; exit 1; }

# Read a KEY=value from a dotenv-style file, stripping quotes and inline comments.
# Always exits 0 (empty output when the key is absent).
read_dotenv_var() {
    grep -E "^[[:space:]]*$1[[:space:]]*=" "$2" 2>/dev/null | head -n1 \
        | sed -E "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//; s/[[:space:]]+#.*\$//; s/^\"(.*)\"\$/\1/; s/^'(.*)'\$/\1/" \
        || true
}

# Resolve and export CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID for a profile.
# Order: existing env vars -> .cloudflare/<profile>.env -> .dev.vars (default only).
# Wrangler authenticates from these environment variables (NOT from .dev.vars,
# which only feeds the Worker's own runtime bindings).
load_cloudflare_creds() {
    profile="${1:-default}"

    if [ -n "${CLOUDFLARE_API_TOKEN:-}" ] && [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
        info "Using CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID from the environment"
    elif [ -f ".cloudflare/${profile}.env" ]; then
        info "Loading credentials from .cloudflare/${profile}.env"
        set -a
        # shellcheck disable=SC1090
        . "./.cloudflare/${profile}.env"
        set +a
    elif [ "$profile" = "default" ] && [ -f ".dev.vars" ] && grep -qE "^[[:space:]]*CLOUDFLARE_API_TOKEN[[:space:]]*=" .dev.vars; then
        # Single-account convenience: pick the two CF vars out of .dev.vars.
        info "Loading Cloudflare credentials from .dev.vars"
        CLOUDFLARE_API_TOKEN="$(read_dotenv_var CLOUDFLARE_API_TOKEN .dev.vars)"
        CLOUDFLARE_ACCOUNT_ID="$(read_dotenv_var CLOUDFLARE_ACCOUNT_ID .dev.vars)"
    else
        die "No Cloudflare credentials found.
Provide them in one of these ways:
  - export CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, or
  - create .cloudflare/${profile}.env (see .cloudflare.env.example):
        mkdir -p .cloudflare
        cp .cloudflare.env.example .cloudflare/${profile}.env
  - or set CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID in .dev.vars (default profile only)"
    fi

    [ -n "${CLOUDFLARE_API_TOKEN:-}" ]  || die "CLOUDFLARE_API_TOKEN is not set"
    [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] || die "CLOUDFLARE_ACCOUNT_ID is not set"
    export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
}
