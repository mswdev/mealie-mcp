# mealie-mcp

An MCP (Model Context Protocol) server for [Mealie](https://mealie.io) — the self-hosted recipe manager. Connect any MCP-compatible AI assistant to your Mealie instance.

> **Status: early, growing fast.** The server ships the full **Recipes** domain — search, read, create, update, import (URL/HTML/zip/image), bulk actions, images & assets, comments, timeline, sharing, exports, and the ingredient parser — plus `get_about`. The goal is full coverage of the Mealie REST API — other Mealie MCPs stall at a handful of endpoints, and this one is built to go the distance.

## Installation

No install required — run directly via `npx`:

```bash
npx mealie-mcp
```

## Configuration

Set these environment variables before running:

| Variable | Required | Description |
|----------|----------|-------------|
| `MEALIE_URL` | Yes | Your Mealie instance URL (e.g. `https://mealie.example.com`) |
| `MEALIE_API_TOKEN` | Yes | API token from **Mealie → Profile → API Tokens** |
| `TRANSPORT` | No | `stdio` (default) or `http` |
| `PORT` | No | HTTP port when using `TRANSPORT=http` (default: `3000`) |
| `MEALIE_READ_ONLY` | No | When `true`/`1`/`yes`/`on`, every mutating tool (create, update, delete, import, bulk actions, etc.) is **not registered** — the server exposes reads only. Default: `false`. |

## Recipe Tools

The recipes domain is exposed as ~23 tools (reads always available; writes hidden when `MEALIE_READ_ONLY` is set):

- **Read:** `recipe_search`, `recipe_get`, `recipe_suggestions`, `recipe_comments`, `recipe_timeline`, `recipe_share`, `recipe_export`, `recipe_media`, `recipe_parse_ingredients`
- **Write:** `recipe_create`, `recipe_update`, `recipe_delete`, `recipe_update_many`, `recipe_duplicate`, `recipe_mark_made`, `recipe_import`, `recipe_image`, `recipe_assets`, `recipe_bulk_actions`, `recipe_export_run`, `recipe_comment_write`, `recipe_timeline_write`, `recipe_share_write`

A few things worth knowing:

- **Destructive actions require confirmation.** Delete/purge/revoke tools refuse to run unless you pass `confirm: true`. This is enforced server-side, in addition to the `MEALIE_READ_ONLY` switch.
- **URL imports run on your Mealie server.** `recipe_import` with a URL forwards the URL to Mealie, which fetches it server-side — this MCP server never fetches the URL itself. Mealie blocks private/internal addresses via its `AsyncSafeTransport` SSRF guard (the CVE-2024-31991…31994 fix). **That protection requires Mealie ≥ 1.4.0**; on older instances URL import is unprotected and the MCP layer cannot compensate.
- **File uploads are stdio/local only.** Image/asset/zip uploads take a *file path on the machine running the MCP server*. This works for the default `stdio` transport (the server shares your filesystem); it does not work over remote `http` transport. Prefer `recipe_image` with `action: set_url` (Mealie fetches the image) when a path isn't available.
- **Media is returned as URLs, never raw bytes.** `recipe_media` and file/zip exports return reference URLs.

## Meal Plan Tools

The meal-plans domain (8 tools) covers meal-plan entries and the rules that drive random meals:

- **Read:** `mealplan_search` (date-range + pagination), `mealplan_get`, `mealplan_today`, `mealplan_rules`
- **Write:** `mealplan_create` (`mode: entry` for a specific recipe, `mode: random` to let Mealie pick per the household's rules), `mealplan_update`, `mealplan_delete`, `mealplan_rule_write`

> Meal-plan entry ids are **integers** (rule ids are UUIDs). `mealplan_today` returns the meals planned for the current day.

## Shopping List Tools

The shopping-lists domain (11 tools) covers lists and their items:

- **Read:** `shopping_list_search`, `shopping_list_get` (bundles items, recipe references, and label settings), `shopping_item_get`
- **Write:** `shopping_list_create`, `shopping_list_update`, `shopping_list_delete`, `shopping_list_label_settings`, `shopping_list_recipe_references` (add a recipe's ingredients to a list, or remove them), `shopping_item_create`, `shopping_item_update`, `shopping_item_delete`

> Item create/update/delete accept a single item or a bulk array. `shopping_item_create` items require `shoppingListId` and `display`.

## Cookbook Tools

The cookbooks domain (5 tools). A cookbook is a saved filter over recipes:

- **Read:** `cookbook_search`, `cookbook_get`
- **Write:** `cookbook_create`, `cookbook_update` (single or bulk), `cookbook_delete`

> All three domains are **default-enabled**. In Mealie they live under `/api/households/`; this server groups them by semantic domain (`mealplan_*`, `shopping_*`, `cookbook_*`). Their write tools are hidden when `MEALIE_READ_ONLY` is set, and every delete requires `confirm: true`.

## Organizer Tools

The organizers domain (5 tools) covers the three parallel recipe taxonomies — **categories, tags, and tools** — behind a single `type: category | tag | tool` discriminator:

- **Read:** `organizer_search` (paginated; `empty_only: true` lists those with no recipes — categories/tags only), `organizer_get` (by id, or by slug with `by_slug: true`)
- **Write:** `organizer_create`, `organizer_update`, `organizer_delete`

> To list the recipes carrying an organizer, use `recipe_search` with `categories` / `tags` / `tools`. Organizers are the shared taxonomy recipes reference, so these reads resolve a name to the id those filters expect.

## Food & Unit Tools

The foods/units domain (12 tools) covers the ingredient catalog primitives — **foods** and **units** — as separate namespaces:

- **Read:** `food_search`, `food_get`, `unit_search`, `unit_get`
- **Write:** `food_create`, `food_update`, `food_merge`, `food_delete`, `unit_create`, `unit_update`, `unit_merge`, `unit_delete`

> `food_search` / `unit_search` resolve an ingredient or unit name to the id that recipe ingredients and shopping items reference. `food_merge` / `unit_merge` combine one entry into another (the source is removed) — destructive, so they require `confirm: true`, as do the deletes. Both domains are **default-enabled**; updates are full-replace PUTs done as fetch-merge so untouched fields are preserved.

## Usage with MCP Clients

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mealie": {
      "command": "npx",
      "args": ["-y", "mealie-mcp"],
      "env": {
        "MEALIE_URL": "https://your-mealie-instance.com",
        "MEALIE_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

### Claude Code

Add the server with the CLI (stored in your user config):

```bash
claude mcp add mealie \
  --env MEALIE_URL=https://your-mealie-instance.com \
  --env MEALIE_API_TOKEN=your-token-here \
  -- npx -y mealie-mcp
```

Or, to share it with a project via version control, create a `.mcp.json` file in the project root:

```json
{
  "mcpServers": {
    "mealie": {
      "command": "npx",
      "args": ["-y", "mealie-mcp"],
      "env": {
        "MEALIE_URL": "https://your-mealie-instance.com",
        "MEALIE_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "mealie": {
      "command": "npx",
      "args": ["-y", "mealie-mcp"],
      "env": {
        "MEALIE_URL": "https://your-mealie-instance.com",
        "MEALIE_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

### ChatGPT / Remote HTTP Mode

Run the server in HTTP mode and point ChatGPT's MCP connector at it:

```bash
TRANSPORT=http PORT=3000 \
MEALIE_URL=https://your-mealie-instance.com \
MEALIE_API_TOKEN=your-token-here \
npx mealie-mcp
```

Then point the connector at `http://<your-host>:3000/mcp` — the server serves MCP only on the `/mcp` path (POST).

> **⚠️ Security:** HTTP mode binds to `0.0.0.0` and is **unauthenticated** — anyone who can reach the port can invoke tools using your Mealie token. Run it only on a trusted network and **behind an authenticating reverse proxy** (or a tunnel that enforces auth). Inbound authentication and host allow-listing are planned for a future release. For local single-user setups, prefer the default `stdio` transport.

## Development

```bash
git clone https://github.com/mswdev/mealie-mcp.git
cd mealie-mcp
npm install

# Generate types from your Mealie instance (or the demo instance)
MEALIE_URL=https://your-mealie-instance.com npm run generate

# Run tests
npm test

# Build
npm run build

# Run locally (build first, then start the server)
MEALIE_URL=https://your-mealie.com MEALIE_API_TOKEN=your-token npm start

# Or watch + rebuild + auto-restart while developing
MEALIE_URL=https://your-mealie.com MEALIE_API_TOKEN=your-token npm run dev
```

## Regenerating Types

Types are pre-generated from Mealie's OpenAPI spec and committed to the repo. If Mealie releases a new version:

```bash
MEALIE_URL=https://your-mealie-instance.com npm run generate
git add src/types/mealie.ts
git commit -m "chore: regenerate Mealie types for vX.Y.Z"
```

## License

MIT
