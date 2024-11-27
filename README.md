# Serverless Social Media Bot

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
  - Converts HTML entities to actual characters (e.g., &amp; → &)
  - Filters empty or invalid content
  - Maintains natural text flow

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

## Requirements

- Node.js v18 or higher
- npm or yarn
- Mastodon account with API access
- Bluesky account with API access
- Cloudflare account (for deployment)

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/serverless-social-bot.git
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
   ```env
   # Bluesky Configuration
   BLUESKY_USERNAME=mybot.bsky.social
   BLUESKY_PASSWORD=xxxx-xxxx-xxxx-xxxx

   # Mastodon Configuration
   MASTODON_ACCESS_TOKEN=your_mastodon_access_token_here

   # Source Accounts Configuration
   BLUESKY_SOURCE_ACCOUNTS=["@example.bsky.social", "@another.bsky.social"]
   MASTODON_SOURCE_ACCOUNTS=["@user@mastodon.social", "@another@instance.social"]

   # Content Filtering
   EXCLUDED_WORDS=["word1", "word2", "word3"]
   ```

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

### Worker Configuration (wrangler.toml)

Non-sensitive configuration is stored in `wrangler.toml`:

#### API Endpoints
- `BLUESKY_API_URL`: Bluesky API URL (default: "https://bsky.social")
- `MASTODON_API_URL`: Mastodon instance API URL

#### Markov Chain Settings
- `MARKOV_STATE_SIZE`: Word context size (default: 2)
- `MARKOV_MAX_TRIES`: Generation attempts (default: 100)
- `MARKOV_MIN_CHARS`: Minimum post length (default: 100)
- `MARKOV_MAX_CHARS`: Maximum post length (default: 280)

#### Debug Settings
- `DEBUG_MODE`: Enable debug output (default: false)
- `DEBUG_LEVEL`: Debug verbosity level (default: "info")

## Security Best Practices

- Never commit `.dev.vars` to version control
- Use app-specific passwords for Bluesky
- Store all sensitive data as Cloudflare secrets in production
- Keep your `wrangler.toml` configuration clean of sensitive data
- Regularly rotate your API tokens and passwords

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT License - see LICENSE file for details