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
- Smart reply behavior:
  - Always replies to first interaction in a thread
  - 30% chance to reply to subsequent interactions
  - Skips replies containing excluded words
  - Won't reply to posts older than 24 hours
  - Avoids replying to its own posts
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
- `EXCLUDED_WORDS` - Words to exclude from generated content and replies
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
- `POST /check-replies` - Check for and process new replies

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

## Reply Behavior
The bot uses the following criteria to determine when to reply:

1. **First Interactions**
   - Always replies to the first interaction in a thread
   - Helps establish initial engagement

2. **Subsequent Interactions**
   - 30% chance to reply to follow-up messages
   - Prevents excessive back-and-forth conversations

3. **Content Filtering**
   - Skips replies containing words from `EXCLUDED_WORDS`
   - Won't reply to its own posts
   - Ignores posts older than 24 hours

4. **Debug Mode**
   - Set `DEBUG_MODE=true` to see detailed decision logging
   - Helpful for understanding reply behavior

## Testing Guide

### Testing Reply Generation
There are several ways to test the reply functionality:

1. **Using the Test Endpoint**
   ```bash
   # Create test-payload.json with your test data
   {
     "postUrl": "https://bsky.app/profile/username.bsky.social/post/postid",
     "replyContent": "Your test reply content here"
   }

   # Test reply generation
   curl -X POST http://127.0.0.1:8787/test-reply \
     -H "Content-Type: application/json" \
     --data-binary "@test-payload.json"
   ```

2. **Testing Live Reply Behavior**
   ```bash
   # First, make the bot post something
   curl -X POST http://127.0.0.1:8787/run

   # Then reply to that post from another account
   
   # Finally, trigger reply checking
   curl -X POST http://127.0.0.1:8787/check-replies
   ```

3. **Debug Mode Testing**
   ```bash
   # Enable debug mode in .dev.vars
   DEBUG_MODE=true
   DEBUG_LEVEL=verbose

   # Run the reply checker to see detailed logs
   curl -X POST http://127.0.0.1:8787/check-replies
   ```

### Testing Different Scenarios

1. **First Reply Testing**
   - Post something from the bot
   - Reply to it from another account
   - Run `/check-replies` - bot should always respond

2. **Subsequent Reply Testing**
   - Continue the conversation
   - Run `/check-replies` multiple times
   - Bot should respond ~30% of the time

3. **Content Filter Testing**
   ```bash
   # Add test words to .dev.vars
   EXCLUDED_WORDS=test,spam,ignore

   # Reply to bot with these words
   # Bot should skip these replies
   ```

4. **Age Limit Testing**
   - Reply to an old post (>24h)
   - Bot should skip these replies

5. **Self-Reply Testing**
   - Reply to the bot's post using the bot's account
   - Bot should skip these replies

### Troubleshooting

1. **Check Logs**
   - Enable verbose logging:
     ```
     DEBUG_MODE=true
     DEBUG_LEVEL=verbose
     ```
   - Look for "Processing notification" and "Reply decision" messages

2. **Common Issues**
   - API authentication errors: Check credentials in `.dev.vars`
   - Missing replies: Verify notification fetching is working
   - Unexpected behavior: Check debug logs for decision reasoning

3. **Testing Environment**
   - Use `wrangler dev` for local testing
   - Create test accounts on both platforms
   - Keep test-payload.json in .gitignore

## License

MIT License - See LICENSE file for details
