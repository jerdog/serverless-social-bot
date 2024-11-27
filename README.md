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

3. Create a `.env` file with your configuration:
   ```env
   # Bluesky Credentials
   BLUESKY_USERNAME="your.username.bsky.social"
   BLUESKY_PASSWORD="your-password"
   BLUESKY_API_URL="https://bsky.social"
   BLUESKY_SOURCE_ACCOUNTS=["@user1.bsky.social","@user2.bsky.social"]

   # Mastodon Credentials
   MASTODON_ACCESS_TOKEN="your-access-token"
   MASTODON_API_URL="https://your-instance.social"
   MASTODON_SOURCE_ACCOUNTS=["@user1@instance.social","@user2@instance.social"]

   # Markov Chain Configuration
   MARKOV_STATE_SIZE=2
   MARKOV_MAX_TRIES=100
   MARKOV_MIN_CHARS=100
   MARKOV_MAX_CHARS=280

   # Content Filtering
   EXCLUDED_WORDS=["word1","word2","word3"]

   # Debug Settings
   DEBUG_MODE=true
   DEBUG_LEVEL='verbose'
   ```

## Usage

1. Add your source content to `tweets.txt` (one entry per line)

2. Run in debug mode to test generation:
   ```bash
   DEBUG_MODE=true node bot.js
   ```

3. Run in production mode to post to social media:
   ```bash
   DEBUG_MODE=false node bot.js
   ```

Note: The bot has a 30% chance of generating and posting content each time it runs. This randomness helps create a more natural posting pattern and prevents overwhelming your social media feeds. When the script runs but doesn't post, it will log a message indicating the random check failed.

## Deployment

### Local Development
1. Install dependencies:
   ```bash
   npm install
   ```

2. Run in debug mode to test generation:
   ```bash
   npm start
   ```

### Cloudflare Workers Deployment

The bot can be deployed as a Cloudflare Worker that runs automatically every 2 hours.

1. Install Cloudflare Workers CLI:
   ```bash
   npm install
   ```

2. Authenticate with Cloudflare:
   ```bash
   npx wrangler login
   ```

3. Add your environment variables to Cloudflare:
   ```bash
   npx wrangler secret put BLUESKY_USERNAME
   npx wrangler secret put BLUESKY_PASSWORD
   npx wrangler secret put MASTODON_ACCESS_TOKEN
   # Repeat for other environment variables
   ```

4. Deploy to Cloudflare Workers:
   ```bash
   npm run deploy
   ```

The worker will automatically run every 2 hours. You can monitor its execution in the Cloudflare Dashboard under Workers & Pages > your-worker > Logs.

Note: The 30% random posting chance is still active in the worker, so it will only actually post about once every 6-7 hours on average.

## Configuration

### Environment Variables (.env)

Only sensitive information and user-specific settings should be stored in `.env`:

#### Authentication
- `BLUESKY_USERNAME`: Your Bluesky handle
- `BLUESKY_PASSWORD`: Your Bluesky app password
- `BLUESKY_SOURCE_ACCOUNTS`: Array of Bluesky accounts to learn from

- `MASTODON_ACCESS_TOKEN`: Your Mastodon access token
- `MASTODON_SOURCE_ACCOUNTS`: Array of Mastodon accounts to learn from

#### Content Filtering
- `EXCLUDED_WORDS`: Array of words to exclude from generated posts

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

### Deployment

When deploying to Cloudflare Workers, only add sensitive variables as secrets:

```bash
# Add sensitive variables as secrets
npx wrangler secret put BLUESKY_USERNAME
npx wrangler secret put BLUESKY_PASSWORD
npx wrangler secret put MASTODON_ACCESS_TOKEN
npx wrangler secret put BLUESKY_SOURCE_ACCOUNTS
npx wrangler secret put MASTODON_SOURCE_ACCOUNTS
npx wrangler secret put EXCLUDED_WORDS

# Other configuration is already in wrangler.toml
npm run deploy
```

## Security

- Store credentials in `.env` file (not in version control)
- Use environment variables for sensitive data
- Implement API rate limiting
- Follow platform-specific security guidelines
- Use app-specific passwords when available

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT License - see LICENSE file for details