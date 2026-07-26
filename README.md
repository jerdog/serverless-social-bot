# Serverless Social Media Markov Bot

A serverless bot that generates and posts content using Markov chain text generation across multiple social media platforms (Mastodon, Bluesky). Built using Cloudflare Workers.

## Features

### Content Generation
- Generates unique social media content using Markov chains
- Configurable parameters for content generation
- Filters out excluded words and phrases
- Configurable random posting probability (default 30%, via `POST_PROBABILITY`)

### Multi-Platform Support
- Posts to Mastodon
- Posts to Bluesky
- Extensible for additional platforms

### AI-Powered Reply Generation
- Generates witty, contextual replies using Cloudflare Workers AI (Llama 3.3 70B)
- Replies to Mastodon mentions and to Bluesky replies on the bot's own posts
- Replies once per notification (tracked in KV, so re-running is safe)
- Falls back to a short canned line if the model is unavailable
- Test endpoint (`/test-reply`) for trying replies before posting
- Configurable model, token budget, and temperature

## Configuration

### Required Environment Variables

- `MASTODON_API_URL` - Your Mastodon instance URL
- `MASTODON_ACCESS_TOKEN` - Mastodon API access token
- `BLUESKY_API_URL` - Bluesky API URL (default: https://bsky.social)
- `BLUESKY_USERNAME` - Your Bluesky username
- `BLUESKY_PASSWORD` - Your Bluesky app password
- _Reply generation uses the Cloudflare **Workers AI** binding (`AI`) — no API key required. See wrangler.toml._

### Optional Environment Variables

- `MASTODON_SOURCE_ACCOUNTS` - Mastodon accounts to source content from
- `BLUESKY_SOURCE_ACCOUNTS` - Bluesky accounts to source content from
- `EXCLUDED_WORDS` - Words to exclude from generated content and replies
- `DEBUG_MODE` - When set to 'true', prevents actual posting and enables detailed logging
- `DEBUG_LEVEL` - Debug log level (verbose/info/error)
- `MARKOV_STATE_SIZE` - Markov chain state size (default: 2)
- `MARKOV_MIN_CHARS` - Minimum characters in generated post (default: 100)
- `MARKOV_MAX_CHARS` - Maximum characters in generated post (default: 280)
- `MARKOV_MAX_TRIES` - Maximum attempts to generate valid post (default: 100)
- `POST_PROBABILITY` - Chance (0-1) that each run posts (default: 0.3). Set to `1` to always post — handy for testing with `DEBUG_MODE=true`.
- `WORKERS_AI_MODEL` - Workers AI model for replies (default: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`)
- `AI_MAX_TOKENS` - Max tokens per generated reply (default: 200; raise to ~2000 only for thinking-mode models)
- `AI_TEMPERATURE` - Sampling temperature for replies (default: 0.7)

## Reply Generation (Workers AI)

Replies are generated with [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
through the `AI` binding declared in `wrangler.toml` — there is **no external API
key**. The default model is **Llama 3.3 70B**
(`@cf/meta/llama-3.3-70b-instruct-fp8-fast`): a 70B model quantized to fp8 and
optimized for speed, so replies keep large-model quality while staying fast.

A compact system prompt keeps input tokens low, `AI_MAX_TOKENS` is 200 (a quip is
~100 tokens), and `AI_TEMPERATURE` sits at 0.7 for wit without drift. If a call
fails (e.g. capacity limits), the bot backs off exponentially and returns a short
fallback line.

**Why not a reasoning model?** Models with a built-in *thinking mode* (e.g. Gemma 4,
`@cf/google/gemma-4-26b-a4b-it`) spend their token budget reasoning **before**
emitting an answer. For a one-line quip that's wasted: they need ~2000 output
tokens instead of ~100, cost several times more per reply, and return **empty
content** if the cap is hit mid-thought. The code still supports them — swap
`WORKERS_AI_MODEL` and raise `AI_MAX_TOKENS` to ~2000 if you want to compare.

Every reply is tagged on the [dashboard](#feedback-dashboard) with the model that
produced it, so you can upvote/downvote across model swaps and see which one your
audience actually likes.

> Workers AI runs against your Cloudflare account and incurs usage charges even
> during `wrangler dev`.

### Enabling Workers AI

Workers AI has no separate "enable" switch — it is provisioned by the `AI`
binding, and the first inference request activates it automatically. To set it up:

1. Sign up for / log into Cloudflare and authenticate Wrangler:
   ```bash
   npx wrangler login
   ```
2. Make sure the binding exists in `wrangler.toml` (it does by default in this repo):
   ```toml
   [ai]
   binding = "AI"
   ```
   Alternatively, add it from the dashboard: **Workers & Pages → your Worker →
   Settings → Bindings → Add → Workers AI**, with variable name `AI`, then redeploy.
3. Deploy the Worker:
   ```bash
   npm run deploy
   ```

Browse available models and monitor neuron usage under **AI → Workers AI** in the
[Cloudflare dashboard](https://dash.cloudflare.com/?to=/:account/ai/workers-ai).
See the [Workers AI docs](https://developers.cloudflare.com/workers-ai/) for details.

## Debug Mode

The bot includes a comprehensive debug mode that allows you to test functionality without actually posting to social media platforms.

### Enabling Debug Mode

You can enable debug mode in one of three ways:

1. In `.dev.vars` for local development:
   ```ini
   DEBUG_MODE=true
   ```

2. In `wrangler.toml` for development and testing:
   ```toml
   [vars]
   DEBUG_MODE = "true"
   ```

3. In Cloudflare Dashboard for production:
   - Go to Workers & Pages > Your Worker > Settings > Variables
   - Add `DEBUG_MODE` with value `true`

### What Debug Mode Does

When `DEBUG_MODE` is set to 'true':
- No actual posts will be made to any platform
- Detailed logs show what would have been posted
- Reply tracking still works to prevent duplicate debug logs
- All other functionality (notifications, reply generation) works normally

This is useful for:
- Testing reply generation
- Verifying post content before going live
- Debugging notification processing
- Testing rate limit handling

### Debug Logs

With debug mode enabled, you'll see detailed logs like:
```
Debug mode: Would post to Bluesky: [post content]
Debug mode: Would reply to Mastodon post: [reply content]
```

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
   DEBUG_MODE=true    # Start with debug mode enabled for safety
   DEBUG_LEVEL=verbose
   ```
   Reply generation uses the Workers AI `AI` binding (configured in
   `wrangler.toml`), so no OpenAI-style key belongs in `.dev.vars`.

3. Start the development server:
   ```bash
   npm run dev
   ```
   Because the Worker uses a Workers AI binding, `wrangler dev` must
   authenticate to your Cloudflare account. **`wrangler` reads its credentials
   from the environment, not from `.dev.vars`** (that file only feeds the
   Worker's own runtime bindings), so plain `wrangler dev` will prompt for an
   interactive OAuth login. `npm run dev` runs `scripts/dev.sh`, which loads
   `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (from your shell,
   `.cloudflare/<profile>.env`, or `.dev.vars`) and exports them first, so it
   starts without the login prompt. For another account:
   `npm run dev -- personal` (or `./scripts/dev.sh personal`). To bypass the
   loader and use your OAuth login, `npm run dev:raw`.

## API Endpoints

- `POST /run` - Execute the bot (posts with probability `POST_PROBABILITY`, default 30%)
- `POST /upload-tweets` - Upload source content
- `GET /upload-tweets` - Get source content count
- `POST /test-reply` - Test AI-powered reply generation
- `POST /check-replies` - Check for and process new replies
- `GET /dashboard` - Feedback dashboard for upvoting/downvoting generated content
- `GET /api/feedback` - JSON list of recorded posts/replies with votes (optional `?type=post|reply`)
- `POST /api/vote` - Record a vote: `{ "type", "id", "vote" }` (`vote` is `1`, `0`, or `-1`; replies also need `"platform"`)
- `POST /api/feedback/clear` - Delete all feedback records (wipe test/junk data)

## Feedback Dashboard

Every post and reply the bot generates (including in debug mode) is recorded to
the `POSTS_KV` namespace under a `feedback:` prefix. Visit `/dashboard` in a
browser to review that content and **upvote** or **downvote** each item, building
a labeled dataset you can use to tune the model over time:

- **Posts** (Markov output) — downvoted examples flag corpus/source accounts to
  prune; upvoted examples are candidates to promote into the source corpus.
- **Replies** (Workers AI / Gemma output) — upvoted replies make good few-shot
  examples for the reply prompt (or a fine-tuning set); the original post is
  stored as context.

Each item stores a single vote label (`1` up, `0` none, `-1` down); clicking an
active button again clears it. **Posts are deduplicated by content** — the same
generated text sent to both Mastodon and Bluesky shows as **one card** with both
platform badges (replies stay per-platform). Every item is also tagged with the
model that produced it (`markov` for posts, the Workers AI model id for replies)
and shown as a badge, so your votes stay comparable across model swaps. The header
has **Refresh** (reload latest) and **Clear all** (wipe records) buttons. Export
the raw labels any time via `GET /api/feedback`.

> Note: like the other endpoints, the dashboard is currently unauthenticated —
> put it behind Cloudflare Access (or add a token check) before exposing it publicly.

## Updating dependencies

The Linux Cloudflare build and CI run `npm ci`, which requires a **complete**
`package-lock.json`. A local `npm install` on **macOS** can prune the Linux-only
`@img/sharp-wasm32` → `@emnapi/*` subtree (a transitive of wrangler's `sharp`
dependency). Cloudflare's build image falls back to that wasm variant, so if a
pruned lock is committed the build fails with `Missing: @emnapi/... from lock file`.

When changing dependencies, keep the lockfile complete by either:

- **Regenerating the lockfile on Linux** (CI, a container, or `docker run --rm -v "$PWD":/w -w /w node:22 npm install`), or
- Setting **`NPM_CONFIG_OMIT=optional`** as a build environment variable in the
  Cloudflare Workers **Build** settings. The build never runs the test suite, so
  omitting optional native packages there is safe and makes `npm ci` immune to lock
  pruning. **Do not** put `omit=optional` in `.npmrc` — it breaks `npm test`, because
  jest's file resolver uses an optional native binding.

CI (`npm ci` in GitHub Actions) is the guardrail: if a pruned lock is pushed, CI
goes red before the deploy build does.

## Deployment

1. Configure your environment variables in Cloudflare:
   ```bash
   wrangler secret put MASTODON_ACCESS_TOKEN
   # Repeat for other secrets
   ```

2. Deploy to Cloudflare Workers:
   ```bash
   npm run deploy       # deploys with whatever account wrangler is logged into
   ```

### Deploying to a specific Cloudflare account

If you have **multiple Cloudflare accounts**, use the helper script, which exports
that account's API token + account id before running wrangler so it targets the
right account non-interactively:

```bash
# One-time: create a credential file per account (.cloudflare/ is git-ignored)
mkdir -p .cloudflare
cp .cloudflare.env.example .cloudflare/personal.env   # then edit it

# Deploy using that profile
npm run deploy:account personal
# or directly, with pass-through wrangler flags:
./scripts/deploy.sh personal --dry-run
```

Credentials resolve in this order: `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`
from your shell, then `.cloudflare/<profile>.env` (default profile: `default`),
then — for the default profile only — `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`
in `.dev.vars`. The script runs `wrangler whoami` and asks for confirmation before
deploying (skip with `-y`). See `.cloudflare.env.example` for how to create the
token and find the account id.

## Behavior

- The bot posts with probability `POST_PROBABILITY` (default 30%) each time it runs
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

Replies are checked on the cron schedule (every 2 hours) and on demand via
`POST /check-replies`. Unlike posting, replying has **no probability gate** — if a
notification passes the checks below, the bot replies.

**Mastodon** — processes `mention` notifications:
1. Skips if already handled (KV key `replied:mastodon:<notification id>`, 24h TTL).
2. Looks up the post being replied to (memory cache → KV → Mastodon API).
3. Skips if the mention is on one of the bot's own posts (avoids self-conversation).
4. Generates a reply and posts it as `@user <reply>`, threaded to the mention.

**Bluesky** — processes `reply` notifications:
1. **Only replies to threads on the bot's own posts** — the reply target
   (`reasonSubject`) must match a post stored in `POSTS_KV`. Anything else logs
   `Not a reply to our post` and is skipped. This is the most common reason a reply
   doesn't happen: posts made before the bot stored them (or from a different
   environment's KV) aren't recognized.
2. Skips if already handled (KV key `replied:bluesky:<uri>`).
3. Generates a reply and posts it threaded to the notification.

In `DEBUG_MODE=true` both paths generate the reply and log what they *would* post
without sending it, and still record it to the feedback dashboard.

> Not implemented (despite what earlier versions of this README claimed): there is
> no reply probability, no post-age cutoff, and `EXCLUDED_WORDS` is applied to
> generated **posts** only, not replies.

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

1. **Forcing a post** — posting is random by default, so set `POST_PROBABILITY=1`
   (with `DEBUG_MODE=true`) and every `POST /run` will generate and log a post
   without sending it.

2. **Reply round-trip**
   - Post from the bot (so the post is stored in `POSTS_KV`)
   - Reply to that post from another account
   - Run `POST /check-replies` — the bot should reply

3. **Self-reply (Mastodon)** — mention the bot from the bot's own account; the log
   should show `Skipping reply to our own post`.

4. **Duplicate protection** — run `/check-replies` twice; the second run should log
   `Already replied to this notification` and do nothing.

### Troubleshooting

Set `DEBUG_MODE=true` and `DEBUG_LEVEL=verbose`, then match the log line:

| Log line | Meaning / fix |
| --- | --- |
| `Environment setup complete { debugMode: 'true' … }` | Nothing will actually be posted — expected in debug mode |
| `Skipping post based on random chance` | Normal; posting is gated by `POST_PROBABILITY` |
| `Not a reply to our post` | The Bluesky reply target isn't a post the bot stored (wrong environment's KV, or posted before storage existed) |
| `Already replied to this notification` | Deduped via KV; delete the `replied:*` key to retry |
| `Bluesky auth failed` (with `body`) | Credentials — use a handle (lowercase) or email plus an **App Password** |
| `No reply generated from Workers AI` | The log reports `finishReason` and content lengths; `finish_reason: 'length'` means the model hit `AI_MAX_TOKENS` before answering |
| `No tweets found in KV storage` | Harmless — the Markov corpus is empty in *that* environment; the bot falls back to live timelines |

**Environment gotcha:** `wrangler dev` uses the *preview* KV namespaces, which are
separate from production. Posts made locally aren't visible to the deployed Worker
(and vice versa), which affects both the source corpus and reply matching.

## License

MIT License - See LICENSE file for details
