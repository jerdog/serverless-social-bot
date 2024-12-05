# Serverless Social Media Markov Bot

A serverless bot that generates and posts content using Markov chain text generation across multiple social media platforms (Mastodon, Bluesky). Built using Cloudflare Workers.

## Features

### Content Generation
- Generates unique social media content using Markov chains
- Configurable parameters for content generation
- Filters out excluded words and phrases
- 30% random posting probability

### Multi-Platform Support
- Posts to Mastodon
- Posts to Bluesky
- Extensible for additional platforms

### AI-Powered Reply Generation
- Generates witty, contextual replies using ChatGPT
- Supports both Mastodon and Bluesky post URLs
- Test endpoint for trying replies before posting
- Configurable response style and tone

## Configuration

### Required Environment Variables

- `MASTODON_API_URL` - Your Mastodon instance URL
- `MASTODON_ACCESS_TOKEN` - Mastodon API access token
- `BLUESKY_API_URL` - Bluesky API URL (default: https://bsky.social)
- `BLUESKY_USERNAME` - Your Bluesky username
- `BLUESKY_PASSWORD` - Your Bluesky app password
- `OPENAI_API_KEY` - Your OpenAI API key (required for reply generation)

### Optional Environment Variables

- `MASTODON_SOURCE_ACCOUNTS` - Mastodon accounts to source content from
- `BLUESKY_SOURCE_ACCOUNTS` - Bluesky accounts to source content from
- `EXCLUDED_WORDS` - Words to exclude from generated content
- `DEBUG_MODE` - Enable detailed logging (true/false)
- `DEBUG_LEVEL` - Debug log level (verbose/info/error)
- `MARKOV_STATE_SIZE` - Markov chain state size (default: 2)
- `MARKOV_MIN_CHARS` - Minimum characters in generated post (default: 100)
- `MARKOV_MAX_CHARS` - Maximum characters in generated post (default: 280)
- `MARKOV_MAX_TRIES` - Maximum attempts to generate valid post (default: 100)

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.dev.vars` file with your environment variables:
   ```ini
   MASTODON_API_URL=https://your.mastodon.instance
   MASTODON_ACCESS_TOKEN=your_token
   BLUESKY_API_URL=https://bsky.social
   BLUESKY_USERNAME=your.username
   BLUESKY_PASSWORD=your_app_password
   MASTODON_SOURCE_ACCOUNTS=@user@instance
   BLUESKY_SOURCE_ACCOUNTS=@user.bsky.social
   DEBUG_MODE=true
   DEBUG_LEVEL=verbose
   OPENAI_API_KEY=your_openai_api_key
   ```

3. Start the development server:
   ```bash
   wrangler dev
   ```

## API Endpoints

- `POST /run` - Execute the bot (30% chance to post)
- `POST /upload-tweets` - Upload source content
- `GET /upload-tweets` - Get source content count
- `POST /test-reply` - Test AI-powered reply generation

## Deployment

1. Configure your environment variables in Cloudflare:
   ```bash
   wrangler secret put MASTODON_ACCESS_TOKEN
   # Repeat for other secrets
   ```

2. Deploy to Cloudflare Workers:
   ```bash
   wrangler deploy
   ```

## Behavior

- The bot has a 30% chance of posting each time it runs
- When posting, it will attempt to post to both Mastodon and Bluesky
- Generated content is based on source content from specified accounts
- Content is filtered to remove excluded words
- Debug logs show the random percentage and whether a post was attempted

## Development

- Written in JavaScript
- Uses Cloudflare Workers for serverless execution
- Stores source content in Cloudflare KV
- Implements Markov chain text generation
- Supports multiple social media platforms

## License

MIT License - See LICENSE file for details
