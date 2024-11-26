# Serverless Social Media Bot

A Node.js-based serverless bot that generates and posts content to multiple social media platforms using Markov chains. The bot creates natural-sounding posts by learning from existing content while maintaining platform-specific constraints.

## Features

- **Markov Chain Text Generation**
  - Custom implementation for natural language generation
  - Configurable state size and generation parameters
  - Character length constraints (100-280 characters)
  - Maintains context and readability

- **Multi-Platform Support**
  - Mastodon integration
  - Bluesky integration
  - Parallel posting capabilities
  - Platform-specific API handling

- **Content Processing**
  - Removes URLs and @mentions
  - Preserves hashtags
  - Filters empty or invalid content
  - Maintains natural text flow

- **Debug System**
  - Configurable debug levels (info/verbose)
  - Detailed logging with timestamps
  - Generation attempt tracking
  - API response monitoring

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

   # Mastodon Credentials
   MASTODON_ACCESS_TOKEN="your-access-token"
   MASTODON_API_URL="https://your-instance.social"

   # Markov Chain Configuration
   MARKOV_STATE_SIZE=2
   MARKOV_MAX_TRIES=100
   MARKOV_MIN_CHARS=100
   MARKOV_MAX_CHARS=280

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

## Configuration

### Markov Chain Settings

The Markov chain generator can be fine-tuned using these parameters:

- `MARKOV_STATE_SIZE`: Controls how many words the generator looks at to determine the next word. 
  - Default: 2 (looks at pairs of words)
  - Higher values (3+) create more coherent but less creative text
  - Lower values (1) create more random, less coherent text
  - Example: With state size 2, in "the quick brown fox", to predict the next word after "brown", it looks at "quick brown"

- `MARKOV_MAX_TRIES`: Maximum number of attempts to generate a valid post.
  - Default: 100
  - Higher values give better chances of meeting length requirements
  - Lower values make the generation process faster but might fail more often
  - The generator will stop either when it creates a valid post or hits this limit

- `MARKOV_MIN_CHARS`: Minimum number of characters for a generated post.
  - Default: 100
  - Ensures posts have sufficient content
  - Posts shorter than this will be rejected and the generator will try again
  - Should be set based on your content style and platform requirements

- `MARKOV_MAX_CHARS`: Maximum number of characters for a generated post.
  - Default: 280 (Twitter/X/Bluesky limit)
  - Ensures posts fit platform constraints
  - Generator will stop adding words when approaching this limit
  - Should match the lowest character limit of your target platforms

### Debug Settings

- `DEBUG_MODE`: Enable/disable debug output (true/false)
  - When true: Shows generation process and skips posting
  - When false: Posts to social media platforms

- `DEBUG_LEVEL`: Logging detail level
  - 'info': Basic operation logging
  - 'verbose': Detailed generation attempts and API responses

## Security

- Store credentials in `.env` file (not in version control)
- Use environment variables for sensitive data
- Implement API rate limiting
- Follow platform-specific security guidelines

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT License - see LICENSE file for details