# fluxer-bot

Fluxer is a Discord-compatible community platform. This repo contains a small bot that connects to Fluxer's REST + Gateway APIs.

## Current Commands implemented
-  !help — Show this help message. Can be used in a server channel or DM.
-  !ping — Check if the bot is online. Can be used in a server channel or DM.
-  !poll — Start creating a poll. Send this command via DM to the bot, or use it in a server channel and the bot will DM you to walk through the setup.
-  !remindme <time> <message> — Set a reminder. The <time> field accepts units like s (seconds), m (minutes), h (hours), d (days), and w (weeks). You can combine them together.
-  !remindme list — View your active reminders.
-  !remindme cancel <id> — Cancel a reminder by its ID (shown when created or in !remindme list).
-  !insult — Generate a random insult. Can be used in a server channel or DM.
-  !pasta — Post a random copypasta from Reddit. Can be used in a server channel or DM.
-  !purge <number> — Delete the specified number of messages from the channel (max 100). Server only.

## Architecture

- Runtime: Bun + TypeScript (ESM). Commands live in `src/commands/` and are loaded dynamically.
- Data layer (intended): PostgreSQL as the primary database with Prisma as the ORM. Keep DB access in a dedicated layer separate from command logic.
- Docker: local development and production are Docker-based (Compose + Dockerfile).

## Setup

1. Create a Fluxer application and bot token via the [Fluxer dashboard](https://fluxer.app).
2. Invite/authorize the bot to your Fluxer community.
3. Set the token in your environment:

```bash
cp .env.example .env
# edit .env and set FLUXER_BOT_TOKEN
```

## Environment Variables

Create a `.env` file based on `.env.example`.

| Variable | Required | Description |
|---|---|---|
| `FLUXER_BOT_TOKEN` | Yes | Your bot token from the Fluxer dashboard |
| `DATABASE_URL` | Yes | PostgreSQL connection string used by Prisma and the bot |
| `NODE_ENV` | No | Defaults to development behavior if not set |
| `COMMAND_PREFIX` | No | Default command prefix when a guild override is not set |
| `PREFIX_CACHE_TTL_SECONDS` | No | Cache TTL (seconds) for per-guild prefixes (default 300) |

## Self Hosting

You must edit config.ts and fluxerClient.ts with the correct endpoints of your self hosted fluxer instance
1. config.ts:5 — API base URL
- Replace http://localhost:49319/api with public facing endpoint if you are not running the bot from the same place as the server
- Changed from the production API to your local instance:
```diff
- export const API_BASE_URL = "https://api.fluxer.app";
+ export const API_BASE_URL = "http://localhost:49319/api";
```
2. fluxerClient.ts:14 — Added X-Forwarded-For header
Added a header to the REST client so your local instance accepts the requests:
```diff
  const rest = new REST({
    version: API_VERSION,
    api: API_BASE_URL,
+   headers: { "X-Forwarded-For": "127.0.0.1" },
  }).setToken(token);
```
3. .env — Updated credentials
```
FLUXER_BOT_TOKEN — set to a token from your self-hosted instance's developer portal
DATABASE_URL / POSTGRES_USER / POSTGRES_PASSWORD — pointed at your local Postgres with different credentials (fluxer-bot user instead of fluxer)
```

## Running Locally

```bash
bun install
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
bun run db:migrate
bun run dev
```

## Running with Docker

### Development

Uses `docker-compose.yml` + `docker-compose.dev.yml`. Set `DATABASE_URL` to use host `postgres` when running the bot in Docker.

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

Detached mode:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

### Production

Builds the Dockerfile, installs production dependencies, runs migrations, and starts `bun src/index.ts` inside the container.

```bash
docker compose up -d --build
```

Stop either environment with:

```bash
docker compose down
```

## Adding Commands

Create a new file under `src/commands/` that exports `name` and `execute(client, message, args)`. The file should be ESM/TypeScript and use `.js` extensions for relative imports. Commands are loaded dynamically at startup — no manual registration needed.

## Prefix Commands

- Use `setprefix <prefix>` (admin only) to store a per-guild prefix.
- Use `resetprefix` (admin only) to return to the default prefix.
- Use `getprefix` to view the effective prefix.
- You can also mention the bot as a prefix, e.g. `@Bot getprefix`.

## Database

```bash
bun run db:migrate  # dev migrations
bun run db:deploy   # production deploy
bun run db:generate # regenerate Prisma client
bun run db:reset    # DEV ONLY: drops and recreates the database
```

## Type Checking & Build

The bot runs TypeScript directly with Bun, so a build step is not required for normal usage. The `build` script exists primarily for CI or artifact generation.

```bash
bun run typecheck
bun run build
```

## Testing

```bash
bun run test
```

## Lint & Format

```bash
bun run lint
bun run format
```

### Pre-commit Hooks

This project uses [Husky](https://typicode.github.io/husky/) and [lint-staged](https://github.com/lint-staged/lint-staged) to automatically run Biome formatting and lint checks before every commit. If any staged files have issues, the commit will be blocked until they're resolved. You can auto-fix most issues with:

```bash
biome check --fix --unsafe .
```

## Troubleshooting

- Verify `FLUXER_BOT_TOKEN` is set and correct.
- Confirm the bot is authorized in the target community.
- Make sure the bot has permission to read and send messages in the channel.
