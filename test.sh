#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Base URL
BASE_URL="http://127.0.0.1:8787"

echo -e "${BLUE}Testing Serverless Social Bot${NC}"
echo "------------------------"

# Function to make POST requests
make_request() {
    local endpoint=$1
    local data=$2
    if [ -z "$data" ]; then
        curl -X POST "${BASE_URL}${endpoint}"
    else
        curl -X POST "${BASE_URL}${endpoint}" \
            -H "Content-Type: application/json" \
            -d "$data"
    fi
}

# Test basic reply functionality
echo -e "${GREEN}Testing reply functionality...${NC}"
make_request "/test/replies"
echo -e "\n"

# Wait a moment
sleep 2

# Test post generation
echo -e "${GREEN}Testing post generation...${NC}"
make_request "/test/post"
echo -e "\n"

# Test simulated replies
echo -e "${GREEN}Testing simulated replies...${NC}"
make_request "/test/simulate/reply"
echo -e "\n"

sleep 2

# Test custom interactions
echo -e "${GREEN}Testing custom interactions...${NC}"

# Mastodon interaction
echo -e "${YELLOW}Simulating Mastodon interaction...${NC}"
make_request "/test/simulate/interaction" '{
    "platform": "mastodon",
    "content": "What are your thoughts on artificial intelligence?",
    "author": "tester@mastodon.social",
    "replyTo": "original-post-123"
}'
echo -e "\n"

sleep 2

# Bluesky interaction
echo -e "${YELLOW}Simulating Bluesky interaction...${NC}"
make_request "/test/simulate/interaction" '{
    "platform": "bluesky",
    "content": "How do you handle context in your responses?",
    "author": "tester.bsky.social",
    "replyTo": "at://did:plc:original/post/123"
}'
echo -e "\n"

echo "------------------------"
echo -e "${BLUE}Testing completed${NC}"
