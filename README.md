# Serverless Social Media Bot

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jerdog/serverless-social-bot)
[![Node Version](https://img.shields.io/node/v/serverless-social-bot)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Last Commit](https://img.shields.io/github/last-commit/jerdog/serverless-social-bot)](https://github.com/jerdog/serverless-social-bot/commits/main)
[![Issues](https://img.shields.io/github/issues/jerdog/serverless-social-bot)](https://github.com/jerdog/serverless-social-bot/issues)
<!-- [![Dependencies Status](https://img.shields.io/librariesio/github/jerdog/serverless-social-bot)](https://libraries.io/github/jerdog/serverless-social-bot) -->

A Node.js-based serverless bot that generates and posts content to multiple social media platforms using Markov chains. The bot creates natural-sounding posts by learning from existing content while maintaining platform-specific constraints.

Inspired by the now archived https://github.com/tommeagher/heroku_ebooks

## Features

- **Markov Chain Text Generation**
  - Custom implementation for natural language generation
  - Configurable state size and generation parameters
  - Character length constraints (100-280 characters)
  - Maintains context and readability

- **Multi-Platform Support**
  - Mastodon integration with home timeline access
  - Bluesky integration with proper session-based auth
  - Parallel posting capabilities
  - Platform-specific API handling

- **Content Processing**
  - Removes URLs and @mentions
  - Preserves hashtags
  - Advanced HTML processing:
    - Intelligent HTML tag handling
    - Block element preservation (p, div, headers, lists)
    - Comprehensive HTML entity conversion
    - Special character normalization
  - Filters empty or invalid content
  - Maintains natural text flow and spacing
  - Content filtering with excluded words

- **Content Management**
  - Cloudflare KV storage for source tweets
  - Append or replace source content via API
  - Batch processing for large datasets
  - Content monitoring and statistics
  - Local file fallback for development

- **Smart Posting**
  - 30% random chance of posting on each run
  - Prevents timeline flooding
  - Creates natural posting patterns

- **Debug System**
  - Configurable debug levels (info/verbose)
  - Detailed logging with timestamps
  - Generation attempt tracking
  - API response monitoring
  - Per-platform post processing stats

## Status
[![CI](https://github.com/jerdog/serverless-social-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/jerdog/serverless-social-bot/actions/workflows/ci.yml)
[![Publish Package](https://github.com/jerdog/serverless-social-bot/actions/workflows/publish.yml/badge.svg)](https://github.com/jerdog/serverless-social-bot/actions/workflows/publish.yml)

## Requirements

- Node.js v18 or higher
- npm or yarn
- Mastodon account with API access
- [Bluesky](https://bsky.app) account with API access
- [Cloudflare](https://developers.cloudflare.com) account (for deployment)

## Setup

### Training Data

The bot requires a `tweets.txt` file in the `assets` directory to generate content. This file should contain one tweet per line, with each tweet being the raw text content. URLs, mentions (@username), and hashtags will be preserved in the generated content.

Example `assets/tweets.txt` format:
```text
Just finished a great coding session! #javascript #webdev
@friend Check out this amazing article https://example.com/article
The weather is perfect for a walk in the park today
```

Create the `assets` directory and `tweets.txt` file:
```bash
mkdir -p assets
touch assets/tweets.txt
```

Then add your training data to the file. The more tweets you add, the better the generated content will be. A minimum of 1,000 tweets is recommended for good results.

### Environment Variables

Store sensitive information and user-specific settings in `.dev.vars`:

- `BLUESKY_USERNAME`: Your Bluesky handle (format: username.bsky.social)
- `BLUESKY_PASSWORD`: Your Bluesky app password
- `MASTODON_ACCESS_TOKEN`: Your Mastodon access token
- `BLUESKY_SOURCE_ACCOUNTS`: JSON array of Bluesky accounts to learn from
- `MASTODON_SOURCE_ACCOUNTS`: JSON array of Mastodon accounts to learn from
- `EXCLUDED_WORDS`: JSON array of words to exclude from generated posts

For local development, you can use the provided `.dev.vars.example` as a template:

```env
# Bluesky Configuration
BLUESKY_USERNAME=mybot.bsky.social  # Recommend setting up a special account
BLUESKY_PASSWORD=xxxx-xxxx-xxxx-xxxx  # ONLY use an App Password, https://bsky.app/settings/app-passwords

# Mastodon Configuration
MASTODON_ACCESS_TOKEN=your_mastodon_access_token_here  # Recommend setting up a special account and getting that access token
MASTODON_API_URL=https://mastodon.social  # Optional, defaults to mastodon.social

# Source Accounts Configuration
BLUESKY_SOURCE_ACCOUNTS=["@example.bsky.social", "@another.bsky.social"]  # Accounts you want to grab some posts from to use with Markov Chain
MASTODON_SOURCE_ACCOUNTS=["@user@mastodon.social", "@another@instance.social"] # Accounts you want to grab some posts from to use with Markov Chain

# Content Filtering
EXCLUDED_WORDS=["word1", "word2", "word3"]

# Debug Configuration (Optional)
DEBUG_MODE=true
DEBUG_LEVEL=verbose  # or "info"
```

## Installation

1. [Fork](https://github.com/jerdog/serverless-social-bot/fork) and Clone the repository:
   ```bash
   git clone https://github.com/<yourusername>/serverless-social-bot.git
   cd serverless-social-bot
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy the example environment file:
   ```bash
   cp .dev.vars.example .dev.vars
   ```

4. Edit `.dev.vars` with your configuration:

## Usage

### Local Development

1. Start the development server:
   ```bash
   npm run dev
   ```

2. Test the bot by sending a POST request:
   ```bash
   curl -X POST http://127.0.0.1:8787
   ```

### Production Deployment

1. Install Cloudflare Workers CLI (if not already installed):
   ```bash
   npm install -g wrangler
   ```

2. Authenticate with Cloudflare:
   ```bash
   wrangler login
   ```

3. Add your secrets to Cloudflare:
   ```bash
   wrangler secret put BLUESKY_USERNAME
   wrangler secret put BLUESKY_PASSWORD
   wrangler secret put MASTODON_ACCESS_TOKEN
   wrangler secret put BLUESKY_SOURCE_ACCOUNTS
   wrangler secret put MASTODON_SOURCE_ACCOUNTS
   wrangler secret put EXCLUDED_WORDS
   ```

4. Deploy to Cloudflare Workers:
   ```bash
   npm run deploy
   ```

The worker will automatically run every 2 hours. You can monitor its execution in the Cloudflare Dashboard under Workers & Pages > your-worker > Logs.

Note: The 30% random posting chance is still active in the worker, so it will only actually post about once every 6-7 hours on average.

## Configuration

### Development Variables (.dev.vars)

Store sensitive information and user-specific settings in `.dev.vars`:

- `BLUESKY_USERNAME`: Your Bluesky handle (format: username.bsky.social)
- `BLUESKY_PASSWORD`: Your Bluesky app password
- `MASTODON_ACCESS_TOKEN`: Your Mastodon access token
- `BLUESKY_SOURCE_ACCOUNTS`: JSON array of Bluesky accounts to learn from
- `MASTODON_SOURCE_ACCOUNTS`: JSON array of Mastodon accounts to learn from
- `EXCLUDED_WORDS`: JSON array of words to exclude from generated posts

For local development, you can use the provided `.dev.vars.example` as a template:

```env
# Bluesky Configuration
BLUESKY_USERNAME=mybot.bsky.social  # Recommend setting up a special account
BLUESKY_PASSWORD=xxxx-xxxx-xxxx-xxxx  # ONLY use an App Password, https://bsky.app/settings/app-passwords

# Mastodon Configuration
MASTODON_ACCESS_TOKEN=your_mastodon_access_token_here  # Recommend setting up a special account and getting that access token
MASTODON_API_URL=https://mastodon.social  # Optional, defaults to mastodon.social

# Source Accounts Configuration
BLUESKY_SOURCE_ACCOUNTS=["@example.bsky.social", "@another.bsky.social"]  # Accounts you want to grab some posts from to use with Markov Chain
MASTODON_SOURCE_ACCOUNTS=["@user@mastodon.social", "@another@instance.social"] # Accounts you want to grab some posts from to use with Markov Chain

# Content Filtering
EXCLUDED_WORDS=["word1", "word2", "word3"]

# Debug Configuration (Optional)
DEBUG_MODE=true
DEBUG_LEVEL=verbose  # or "info"
```

### Cloudflare Workers Configuration

1. Copy the example configuration file:
```bash
cp wrangler.toml.example wrangler.toml
```

2. Update the following variables in your `wrangler.toml`:
- `MASTODON_URL`: Your Mastodon instance URL
- `MASTODON_ACCESS_TOKEN`: Your Mastodon API access token
- `BLUESKY_SERVICE`: Bluesky API service URL (default: https://bsky.social)
- `BLUESKY_IDENTIFIER`: Your Bluesky handle
- `BLUESKY_APP_PASSWORD`: Your Bluesky app password
- `DEBUG_MODE`: Set to "true" for verbose logging

The configuration includes separate environments for development and production. Use the following commands:

- Development: `npx wrangler dev`
- Production: `npx wrangler deploy --env production`

### Worker Configuration (wrangler.toml)

Non-sensitive configuration is stored in `wrangler.toml`:

```toml
name = "serverless-social-bot"
main = "worker.js"
compatibility_date = "2023-01-01"

[triggers]
crons = ["0 */2 * * *"]  # Run every 2 hours

[vars]
# API Endpoints
BLUESKY_API_URL = "https://bsky.social"
MASTODON_API_URL = "https://mastodon.social"  # Optional, defaults to mastodon.social

# Markov Chain Settings
MARKOV_STATE_SIZE = 2
MARKOV_MAX_TRIES = 100
MARKOV_MIN_CHARS = 100
MARKOV_MAX_CHARS = 280

# Debug Settings
DEBUG_MODE = false
DEBUG_LEVEL = "info"
```

## Source Tweet Management

The bot now uses Cloudflare KV for storing source tweets, making it easy to manage your training data. You can:

1. **Add New Content** (default behavior):
```bash
curl -X POST https://your-worker.workers.dev/upload-tweets --data-binary @new-tweets.txt
```

2. **Replace Existing Content**:
```bash
curl -X POST https://your-worker.workers.dev/upload-tweets \
  -H "X-Append: false" \
  --data-binary @new-tweets.txt
```

3. **Check Content Statistics**:
```bash
curl https://your-worker.workers.dev/upload-tweets
```

The system automatically:
- Stores tweets in batches to handle KV size limits
- Tracks the total number of stored tweets
- Uses all available content when generating posts
- Falls back to local file in development environment

For local development, you can still use the `assets/tweets.txt` file. The bot will automatically detect the environment and use the appropriate storage method.

## Cloudflare Setup

1. Create a KV namespace for source tweets:
```bash
npx wrangler kv:namespace create source_tweets
npx wrangler kv:namespace create source_tweets_preview --preview
```

2. Add the namespace IDs to your `wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "SOURCE_TWEETS"
id = "your-namespace-id"
preview_id = "your-preview-namespace-id"
```

3. Upload your initial source tweets:
```bash
curl -X POST https://your-worker.workers.dev/upload-tweets --data-binary @assets/tweets.txt
```

## Security Best Practices

- _**Never commit `.dev.vars` to version control**_
- **Use app-specific passwords for Bluesky**
- Store all sensitive data as Cloudflare secrets in production
- Keep your `wrangler.toml` configuration clean of sensitive data
- Regularly rotate your API tokens and passwords

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## TODO

- Add better Markov Chain generation
- Add other deployments than Cloudflare Workers
- 

## License

MIT License - see LICENSE file for details
