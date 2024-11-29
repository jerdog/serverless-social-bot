#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print step messages
print_step() {
    echo -e "${YELLOW}==>${NC} $1"
}

# Function to check if command succeeded
check_status() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $1"
    else
        echo -e "${RED}✗${NC} $1"
        exit 1
    fi
}

# Ensure we're on main branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo -e "${RED}Error:${NC} Please checkout main branch before releasing"
    exit 1
fi

# Ensure working directory is clean
if [ -n "$(git status --porcelain)" ]; then
    echo -e "${RED}Error:${NC} Working directory is not clean. Please commit or stash changes."
    git status
    exit 1
fi

# Get the version bump type
if [ -z "$1" ]; then
    echo -e "${RED}Error:${NC} Please specify version bump type: patch, minor, or major"
    echo "Usage: $0 <patch|minor|major>"
    exit 1
fi

VERSION_TYPE=$1

# Run tests
print_step "Running tests..."
npm test
check_status "Tests completed"

# Update version
print_step "Updating version ($VERSION_TYPE)..."
npm version $VERSION_TYPE -m "Release %s"
check_status "Version updated"

# Push changes and tags
print_step "Pushing changes and tags..."
git push && git push --tags
check_status "Changes pushed"

# Get the new version number
NEW_VERSION=$(node -p "require('./package.json').version")

# Print next steps
echo -e "\n${GREEN}✓${NC} Local release steps completed!"
echo -e "\nNext steps:"
echo -e "1. Go to ${YELLOW}https://github.com/jerdog/serverless-social-bot/releases/new?tag=v$NEW_VERSION${NC}"
echo -e "2. Click '${YELLOW}Generate release notes${NC}'"
echo -e "3. Review and click '${YELLOW}Publish release${NC}'"
echo -e "\nThis will trigger the GitHub Action to:"
echo -e "- Run tests"
echo -e "- Publish to npm"
echo -e "- Deploy to Cloudflare Workers"
