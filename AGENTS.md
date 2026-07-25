# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository.

## Project overview

A serverless social media bot that generates original posts with **Markov chain**
text generation and posts them to **Mastodon** and **Bluesky**. It can also
generate **AI-powered replies** (via Cloudflare Workers AI — Gemma 4) to mentions/replies it
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
| `kv.js` | KV helpers for storing/retrieving batched **source tweets** (the Markov training corpus). |
| `assets/tweets.txt` | Local sample corpus used by tests. |
| `tests/` | Jest tests (`bot.test.js`, `markov.test.js`) + `setup.js`. |
| `scripts/release.sh` | Version-bump + push release helper (must run on `main`). |
| `.github/workflows/` | `ci.yml` (lint + test on every push/PR) and `publish.yml` (npm publish + Cloudflare deploy on GitHub release). |
| `wrangler.toml` | Worker config: cron trigger, `[vars]`, and two KV namespace bindings. |

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
  `DEBUG_MODE`, so the `/dashboard` list is populated even during dry runs. Votes
  are a single label per item (`1`/`0`/`-1`), not a running tally — set via
  `/api/vote`. When adding a new place the bot emits content, record it there too.
- **Config object:** `loadConfig()` in `bot.js` validates required env vars and
  builds the module-global `CONFIG`. Call it before anything that reads `CONFIG`.
- **Posting flow:** `main()` → 30% random gate → `fetchTextContent()` (source
  tweets + live timeline posts) → `generatePost()` (Markov) → `postToSocialMedia()`.
- **Reply flow:** `checkNotifications()` (in `worker.js`) polls Mastodon/Bluesky
  notifications → `handleMastodonReply` / `handleBlueskyReply` in `replies.js` →
  `generateReply()` (Workers AI via the `AI` binding) → post + mark handled in KV.

## HTTP endpoints (see `worker.js`)

- `POST /run` — run the bot once (still subject to the 30% gate).
- `POST /upload-tweets` — append (or replace with `X-Append: false`) source corpus.
- `GET /upload-tweets` — return the stored corpus count.
- `POST /test-reply` — generate a reply for a given `postUrl`/`replyContent` without posting.
- `POST /check-replies` — poll and process notifications.
- `GET /dashboard` — HTML feedback dashboard (upvote/downvote generated content).
- `GET /api/feedback` — JSON list of recorded items + stats (optional `?type=post|reply`).
- `POST /api/vote` — set a vote: `{ type, platform, id, vote }`, `vote` ∈ `{1,0,-1}`.

## Commands

```bash
npm install          # install deps
npm test             # run Jest tests (required before release)
npm run lint         # eslint .
npm run lint:fix     # eslint . --fix
npm run dev          # wrangler dev worker.js  (local Worker)
npm run deploy       # wrangler deploy worker.js
```

Tests use `NODE_OPTIONS=--experimental-vm-modules` (set by the npm script) because
of ESM + Jest. Run individual tests with, e.g.,
`NODE_OPTIONS=--experimental-vm-modules npx jest tests/markov.test.js`.

## Conventions

- **ESLint is authoritative.** Note the two configs differ: `.eslintrc.yml` (used by
  `npm run lint`) enforces **4-space indentation**, **single quotes**, and
  **semicolons**, and ignores unused vars/args prefixed with `_`. Match the
  surrounding style; run `npm run lint` before committing.
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
  bare token string. Use `auth.accessJwt` in `Authorization` headers.
- `process.env` is populated at request/cron time by `setupEnvironment`; it is not
  reliably available at module load. Read env inside handlers/functions.
- Bluesky post URIs vs. web URLs differ; reply threading uses AT-URIs
  (`notification.reasonSubject`, `notification.uri`).

## Working agreement for agents

- Make the smallest change that satisfies the request; match existing style.
- Run `npm run lint` and `npm test` before finishing; both must pass.
- Do not introduce a build step, a framework, or new heavy dependencies without
  being asked — this is intentionally a small, dependency-light Worker.
- Never post to live social accounts from tests or local runs; rely on `DEBUG_MODE`.
