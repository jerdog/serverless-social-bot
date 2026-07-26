# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository.

## Project overview

A serverless social media bot that generates original posts with **Markov chain**
text generation and posts them to **Mastodon** and **Bluesky**. It can also
generate **AI-powered replies** (via Cloudflare Workers AI — Llama 3.3 70B) to mentions/replies it
receives. It runs on **Cloudflare Workers**, triggered on a cron schedule and via
HTTP endpoints, and persists state in **Cloudflare KV**.

- Runtime: Cloudflare Workers (`nodejs_compat_v2`), Node.js `>=20.5.0` for tooling.
- Module system: ES modules (`"type": "module"`). Use `import`/`export`, never `require`.
- No build step — the Worker runs the source directly.

## Repository layout

| Path | Purpose |
| --- | --- |
| `worker.js` | Cloudflare Worker entry point. Defines `fetch` (HTTP routes) and `scheduled` (cron) handlers, sets up `process.env` from Worker bindings, and orchestrates the bot. |
| `bot.js` | Core logic: config loading, text cleaning, the `MarkovChain` class, source fetching, and posting to Mastodon/Bluesky. |
| `replies.js` | Reply handling: fetch original posts, generate replies via the Workers AI binding, post replies, and track already-answered notifications in KV. Also holds the in-memory `recentPosts` cache and the reusable `LocalStorage` fallback. |
| `feedback.js` | Records every generated post/reply into `POSTS_KV` under a `feedback:` prefix and stores per-item up/down votes for model tuning. |
| `dashboard.js` | Returns the self-contained HTML feedback dashboard served at `/dashboard`. |
| `kv.js` | KV helpers for storing/retrieving batched **source tweets** (the Markov training corpus), plus the reusable `LocalStorage` in-memory KV shim. |
| `log.js` | Leaf logging module (`debug`, `LOG_LEVELS`); dependency-free so any module can import it without cycles. |
| `social.js` | Thin Mastodon/Bluesky request helpers (`postMastodonStatus`, `getMastodonStatus`, `createBlueskyRecord`) — centralizes host + auth headers. |
| `text.js` | Small composable text helpers (`stripHtml`, `stripMentions`, `normalizeWhitespace`). |
| `assets/tweets.txt` | Local sample corpus used by tests. |
| `tests/` | Jest tests: `bot.test.js`, `markov.test.js`, `replies.test.js`, `feedback.test.js`, `text.test.js`, plus `setup.js`. |
| `scripts/deploy.sh` / `scripts/dev.sh` | Deploy / run `wrangler dev` against a specific Cloudflare account. |
| `scripts/lib/cloudflare-env.sh` | Shared credential resolver sourced by both scripts (not executable on its own). |
| `scripts/release.sh` | Version-bump + push release helper (must run on `main`). |
| `eslint.config.js` | ESLint 9 flat config (replaces the old `.eslintrc.yml`). |
| `.npmrc` | `include=optional` — keeps optional deps installed (jest's resolver needs them). |
| `.github/workflows/` | `ci.yml` (lint + test on every push/PR) and `publish.yml` (npm publish + Cloudflare deploy on GitHub release). |
| `wrangler.toml` | Worker config: cron trigger, `[ai]` binding, `[vars]`, and two KV namespace bindings. |

## Architecture & data flow

- **Environment bridging:** the Worker receives config through the `env` binding.
  `setupEnvironment(env)` in `worker.js` copies those values into a global
  `process.env` so the rest of the code (written in a Node style) can read them.
  When adding a new config value, add it in **three** places: `wrangler.toml`
  (`[vars]` or as a documented secret), the `process.env = { ... }` block in
  `worker.js`, and wherever it is consumed.
- **Two KV namespaces** (see `wrangler.toml`):
  - `SOURCE_TWEETS` — the Markov training corpus, written by `/upload-tweets`,
    read by `kv.js`.
  - `POSTS_KV` — the bot's own recent posts and `replied:*` dedupe markers
    (managed by `replies.js`), plus `feedback:*` records (managed by `feedback.js`).
- **Feedback recording:** `bot.js` (posts) and `replies.js` (replies) call
  `recordContent()` from `feedback.js` on every generated item, including in
  `DEBUG_MODE`, so the `/dashboard` list is populated even during dry runs. **Posts
  dedupe by content** (keyed by a content hash, with a `platforms` array), so the
  same text sent to both platforms is one record; replies are keyed per
  `platform:id`. Each record carries a `model` label (`markov` for posts, the
  Workers AI model id for replies via `getReplyModel()`) so votes stay comparable
  across model swaps. Votes are a single label per item (`1`/`0`/`-1`) set via
  `/api/vote` (posts vote by `id`=hash; replies also need `platform`). `listFeedback`
  paginates KV so newest items aren't dropped. When adding a new place the bot emits
  content, record it there too (with its `model`).
- **Config object:** `loadConfig()` in `bot.js` validates required env vars and
  builds the module-global `CONFIG`. Call it before anything that reads `CONFIG`.
- **Posting flow:** `main()` → random gate (`POST_PROBABILITY`, default 0.3) →
  `fetchTextContent()` (source tweets + live timeline posts) → `generatePost()`
  (Markov) → `postToSocialMedia()`.
- **Reply flow:** `checkNotifications()` (in `worker.js`) polls Mastodon/Bluesky
  notifications → `handleMastodonReply` / `handleBlueskyReply` in `replies.js` →
  `generateReply()` (Workers AI via the `AI` binding) → post + mark handled in KV.
  There is **no probability gate, age cutoff, or excluded-words filter on replies**;
  the real gate on Bluesky is that `notification.reasonSubject` must match a post
  the bot stored in `POSTS_KV`. Each handled notification is deduped by a
  `replied:<platform>:<id>` KV key.

## HTTP endpoints (see `worker.js`)

- `POST /run` — run the bot once (subject to the `POST_PROBABILITY` gate).
- `POST /upload-tweets` — append (or replace with `X-Append: false`) source corpus.
- `GET /upload-tweets` — return the stored corpus count.
- `POST /test-reply` — generate a reply for a given `postUrl`/`replyContent` without posting.
- `POST /check-replies` — poll and process notifications.
- `GET /dashboard` — HTML feedback dashboard (upvote/downvote generated content).
- `GET /api/feedback` — JSON list of recorded items + stats (optional `?type=post|reply`).
- `POST /api/vote` — set a vote: `{ type, id, vote }` (replies also need `platform`), `vote` ∈ `{1,0,-1}`.
- `POST /api/feedback/clear` — delete all feedback records.

All endpoints are unauthenticated; production is expected to sit behind Cloudflare Access.

## Commands

```bash
npm install            # install deps
npm test               # run Jest tests (required before release)
npm run lint           # eslint .
npm run lint:fix       # eslint . --fix
npm run dev            # scripts/dev.sh: loads CF creds, then wrangler dev
npm run dev:raw        # plain wrangler dev (uses your OAuth login)
npm run deploy         # wrangler deploy worker.js (OAuth login / active account)
npm run deploy:account # scripts/deploy.sh [profile]: deploy to a specific account
```

`scripts/dev.sh` and `scripts/deploy.sh` share `scripts/lib/cloudflare-env.sh`,
which resolves `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (shell env →
`.cloudflare/<profile>.env` → `.dev.vars`) and exports them so wrangler
authenticates to a specific account without an interactive login. This matters
because the Worker's Workers AI binding requires account auth even under
`wrangler dev`, and wrangler reads these from the environment — **not** from
`.dev.vars` (which only feeds the Worker's runtime bindings).

Tests use `NODE_OPTIONS=--experimental-vm-modules` (set by the npm script) because
of ESM + Jest. Run individual tests with, e.g.,
`NODE_OPTIONS=--experimental-vm-modules npx jest tests/markov.test.js`.

## Conventions

- **ESLint is authoritative.** Config is `eslint.config.js` (ESLint 9 flat config):
  **4-space indentation**, **single quotes**, **semicolons**, unix linebreaks, and
  it ignores unused vars/args prefixed with `_`. Match the surrounding style; run
  `npm run lint` before committing.
- Prefix intentionally-unused variables/params with `_` (e.g. `_env`, `_rateLimitState`).
- Use the `debug(message, level, data)` helper for logging rather than raw
  `console.*`. Levels seen in code: `info`, `warn`, `error`, `verbose`, `essential`.
- Keep external API calls wrapped in `try/catch`; the codebase favors returning
  `null`/`false` and logging over throwing across async boundaries.
- **DEBUG_MODE=true short-circuits all outbound posting** — every `postTo*` /
  reply function checks it and only logs what it *would* post. Preserve this guard
  when adding any new outbound action so debug runs never touch a live account.

## Secrets & configuration

- Never commit real credentials. Secrets are provided via `wrangler secret put ...`
  in production and `.dev.vars` locally (git-ignored; see `.dev.vars.example`).
- Required: `MASTODON_API_URL`, `MASTODON_ACCESS_TOKEN`, `BLUESKY_API_URL`,
  `BLUESKY_USERNAME`, `BLUESKY_PASSWORD`. Replies use the Workers AI `AI` binding
  (declared in `wrangler.toml`) — no reply API key. `initAI(env.AI)` runs in
  `setupEnvironment`; model/params come from `WORKERS_AI_MODEL` / `AI_MAX_TOKENS`
  / `AI_TEMPERATURE` (plain vars, read via `process.env`).
- Optional tuning: `MARKOV_STATE_SIZE`, `MARKOV_MIN_CHARS`, `MARKOV_MAX_CHARS`,
  `MARKOV_MAX_TRIES`, `MASTODON_SOURCE_ACCOUNTS`, `BLUESKY_SOURCE_ACCOUNTS`,
  `EXCLUDED_WORDS`, `DEBUG_MODE`, `DEBUG_LEVEL`.
- List env vars are parsed with `.split(',')` (comma-separated, **not** JSON arrays)
  despite what some examples show — keep that in mind when documenting/using them.
- Be careful not to log secrets: config and auth objects can contain tokens and
  passwords, so avoid dumping whole objects at `info` level.

## Testing notes

- Jest is configured in `package.json` (`testMatch: **/tests/**/*.test.js`).
- Tests set a fixed `TEST_ENV` and use `assets/tweets.txt` as the corpus. Some
  tests fall back to inline sample data if a corpus file is missing, so a passing
  test does not always prove file loading works — assert explicitly when it matters.
- There is no network mocking layer; tests avoid real API calls by exercising pure
  functions (`cleanText`, `MarkovChain`, `generatePost`). Keep new unit tests
  network-free, or add mocking, rather than hitting live services.

## Gotchas

- `getBlueskyAuth()` returns an **object** `{ did, accessJwt, refreshJwt }`, not a
  bare token string. Use `auth.accessJwt` in `Authorization` headers. Successful
  sessions are memoized for 50 minutes, keyed by identifier.
- `process.env` is populated at request/cron time by `setupEnvironment`; it is not
  reliably available at module load. Read env inside handlers/functions.
- Bluesky post URIs vs. web URLs differ; reply threading uses AT-URIs
  (`notification.reasonSubject`, `notification.uri`). **AT URIs contain colons**
  (`at://did:plc:…`), so never `split(':')` a `platform:id` key — slice off the
  prefix instead, or Bluesky ids collapse to `bluesky:at` and collide.
- **Workers AI response shapes differ by model.** Classic text-generation models
  return `{ response }`; others (Gemma 4, anything reporting `…-external`) return an
  OpenAI-style `{ choices: [{ message: { content } }] }`. `extractReplyText()` handles
  both — keep it that way when swapping models, or replies silently vanish.
- **Thinking-mode models** (e.g. Gemma 4) spend the token budget reasoning before
  answering: with a low `AI_MAX_TOKENS` they hit the cap mid-thought and return empty
  content. The default model is deliberately a non-reasoning instruct model.
- `wrangler dev` binds the **preview** KV namespaces, which are separate from
  production. Local posts/corpus are invisible to the deployed Worker and vice versa.
- Wrangler authenticates from **shell env vars**, not `.dev.vars` (which only feeds
  the Worker's runtime bindings). Use `npm run dev` / `scripts/deploy.sh`.
- The lockfile must stay complete for `npm ci` on Linux (CI + Cloudflare build); a
  macOS `npm install` can prune platform-optional deps. See README
  "Updating dependencies".

## Working agreement for agents

- Make the smallest change that satisfies the request; match existing style.
- Run `npm run lint` and `npm test` before finishing; both must pass.
- Do not introduce a build step, a framework, or new heavy dependencies without
  being asked — this is intentionally a small, dependency-light Worker.
- Never post to live social accounts from tests or local runs; rely on `DEBUG_MODE`.
