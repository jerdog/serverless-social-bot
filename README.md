# Serverless Social Media Markov Bot

A serverless bot that generates and posts content using Markov chain text generation across multiple social media platforms (Mastodon, Bluesky). Built using Cloudflare Workers.

## Features

- Generates unique content using Markov chain text generation
- Posts to multiple platforms (Mastodon, Bluesky)
- Configurable posting frequency (30% chance to post)
- Source content management through KV storage
- Configurable excluded words and content parameters
- Debug mode for detailed logging

## Configuration

### Required Environment Variables

- `MASTODON_API_URL` - Your Mastodon instance URL
- `MASTODON_ACCESS_TOKEN` - Mastodon API access token
- `BLUESKY_API_URL` - Bluesky API URL (default: https://bsky.social)
- `BLUESKY_USERNAME` - Your Bluesky username
- `BLUESKY_PASSWORD` - Your Bluesky app password

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
   ```

3. Start the development server:
   ```bash
   wrangler dev
   ```

## API Endpoints

- `POST /run` - Execute the bot (30% chance to post)
- `POST /upload-tweets` - Upload source content
- `GET /upload-tweets` - Get source content count

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
