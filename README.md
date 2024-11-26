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

## Environment Variables

Copy `.env-example` to `.env` and configure the following variables:

### Authentication

#### Bluesky
- `BLUESKY_USERNAME`: Your Bluesky handle (e.g., "username.bsky.social")
- `BLUESKY_PASSWORD`: Your Bluesky app password
- `BLUESKY_API_URL`: Bluesky API URL (default: "https://bsky.social")
- `BLUESKY_SOURCE_ACCOUNTS`: Array of Bluesky accounts to learn from (e.g., `["@user1.bsky.social"]`)

#### Mastodon
- `MASTODON_ACCESS_TOKEN`: Your Mastodon access token
- `MASTODON_API_URL`: Your Mastodon instance API URL
- `MASTODON_SOURCE_ACCOUNTS`: Array of Mastodon accounts to learn from (e.g., `["@user@instance.social"]`)

### Content Generation

#### Markov Chain Settings
- `MARKOV_STATE_SIZE`: Number of words to consider for next word prediction (default: 2)
- `MARKOV_MAX_TRIES`: Maximum attempts to generate valid content (default: 100)
- `MARKOV_MIN_CHARS`: Minimum characters in generated post (default: 100)
- `MARKOV_MAX_CHARS`: Maximum characters in generated post (default: 280)

#### Content Filtering
- `EXCLUDED_WORDS`: Array of words to exclude from generated posts (e.g., `["word1","word2"]`)
  - Case-insensitive matching
  - Matches whole words only
  - Optional, defaults to empty array

### Debug Settings
- `DEBUG_MODE`: Enable debug output (true/false)
- `DEBUG_LEVEL`: Debug verbosity level ("info"/"verbose"/"essential")

Example `.env` file:
```env
# Bluesky Credentials
BLUESKY_USERNAME="username.bsky.social"
BLUESKY_PASSWORD="app-password"
BLUESKY_API_URL="https://bsky.social"
BLUESKY_SOURCE_ACCOUNTS=["@user1.bsky.social"]

# Mastodon Credentials
MASTODON_ACCESS_TOKEN="your-access-token"
MASTODON_API_URL="https://instance.social"
MASTODON_SOURCE_ACCOUNTS=["@user@instance.social"]

# Markov Chain Configuration
MARKOV_STATE_SIZE=2
MARKOV_MAX_TRIES=100
MARKOV_MIN_CHARS=100
MARKOV_MAX_CHARS=280

# Content Filtering
EXCLUDED_WORDS=["word1","word2","word3"]

# Debug Settings
DEBUG_MODE=false
DEBUG_LEVEL="info"
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