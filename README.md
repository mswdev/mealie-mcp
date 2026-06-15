# mealie-mcp

An MCP (Model Context Protocol) server for [Mealie](https://mealie.io) — the self-hosted recipe manager. Connect any MCP-compatible AI assistant to your Mealie instance.

> **Status: early, growing fast.** The server ships the **entire default surface** — Recipes, Meal Plans, Shopping Lists, Cookbooks, Organizers (categories/tags/tools), Foods & Units, and App info. The goal is full coverage of the Mealie REST API — other Mealie MCPs stall at a handful of endpoints, and this one is built to go the distance.
>
> **Live-verified against Mealie `v3.19.2`.** Every owed behavior from PRs #2–#11 is exercised end-to-end through the real server (49 behavior checks) against a disposable Mealie instance — `npm run verify:live` spins one up with Docker, runs the checklist, and tears it down. See [the verification report](docs/plans/2026-06-15-live-verification-report.md).

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
| `MEALIE_TOOLSETS` | No | Comma-separated list of **opt-in** toolsets to enable, e.g. `households,automation,groups,users,admin,explore`. Recognized tokens: `households`, `automation`, `groups`, `users`, `admin`, `explore`. Unset → only the default tools. Unknown tokens are logged to stderr and ignored. Composes with `MEALIE_READ_ONLY` (enabled toolsets still have their writes stripped in read-only mode; `explore` is all reads and survives intact). |

## App Tools

The app domain (2 read tools) covers instance info and file downloads:

- `app_get_info` — the connected instance's version, configuration, and feature flags. Pass `include: ["startup_info", "theme"]` to also bundle startup diagnostics and the UI theme.
- `app_download_file` — resolves a signed download token (e.g. from a backup/export tool) to the Mealie download URL. Returns a URL reference, not the file bytes.

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

## Opt-in Toolsets

Everything above is **default-enabled**. Domains beyond the core cooking surface are **opt-in**: they register only when named in `MEALIE_TOOLSETS` (e.g. `MEALIE_TOOLSETS=households,automation`). This keeps the default tool list small while letting you turn on more coverage per session. Selection is **static** — there is no runtime tool-discovery meta-tool. `MEALIE_READ_ONLY` still applies: an enabled toolset's write tools are stripped in read-only mode.

### `households` — Household Management (4 tools)

Self-service household administration (Mealie's *Self Service* + *Invitations*):

- **Read:** `household_self_get` (a `view` dispatcher: `household` | `preferences` | `statistics` | `members` | `recipe`), `household_invitations_list`
- **Write:** `household_self_update` (`target: preferences | permissions`), `household_invite` (`action: create | send_email`)

> `household_self_update` does full-replace PUTs as fetch-merge so untouched fields are preserved. `target=permissions` is **privilege-elevating** — it requires `confirm: true` and merges onto the member's current flags so an unspecified flag is never silently downgraded. `household_invite send_email` dispatches an email. `view=recipe` returns a thin `{lastMade, recipeId}` pivot, not full recipe content.

### `automation` — Webhooks, Notifications & Recipe Actions (9 tools)

Event automation (Mealie's *Webhooks* + *Event Notifications* + *Recipe Actions*), three parallel resources each with a read, a write-dispatcher, and a side-effecting action verb:

- **Read:** `webhook_get`, `event_notification_get`, `recipe_action_get` (each lists, or fetches one by `item_id`)
- **Write:** `webhook_write` / `event_notification_write` / `recipe_action_write` (`action: create | update | delete`; update is fetch-merge, delete is `confirm`-gated), plus the action verbs `webhook_action` (`test` | `rerun`), `event_notification_test`, `recipe_action_trigger`

> The action verbs (test / rerun / trigger) are non-destructive but **hit the network / fire side effects** (a test webhook call, a live Apprise message, running a recipe action), so they are registered as writes and are stripped under `MEALIE_READ_ONLY`.

### `groups` — Group Administration (12 tools)

Group-scoped administration (Mealie's *Self Service*, *Households*, *MultiPurpose Labels*, *AI Providers*, *Reports*, *Seeders*, *Migrations*):

- **Read:** `group_self_get` (a `view` dispatcher: `group` | `members` | `preferences` | `storage`), `group_households_list` (the group's household roster, by slug), `label_get`, `group_ai_provider_get` (one provider by id, or — with no id — the AI settings incl. the provider list), `group_report_get`
- **Write:** `group_self_update` (preferences fetch-merge), `label_write` (`action: create | update | delete`), `group_ai_provider_write` (`action: create | update | delete`), `group_ai_provider_settings_update`, `group_seed` (`target: foods | labels | units`), `group_start_migration`, `group_report_delete`

> **Labels** live here (`label_*`) and are the resolution target for shopping-list `labelId` — use `label_get` to map a label name to its id. **AI-provider `apiKey` is a write-only secret**: it's required on create *and* update (it can't be read back, so re-supply it every update) and is never returned by any tool. Updates are full-replace PUTs done as fetch-merge. **`group_start_migration`** uploads an archive (multipart) to import recipes from another app — it's destructive (`confirm: true`) and reads a file on the MCP server (stdio/local only); poll progress with `group_report_get`. `group_seed` is additive (it appends to the catalog). Destructive ops (`*_delete`, migration) require `confirm: true`.

### `users` — Self-Service User Account (8 tools)

The current user's self-service surface (Mealie's *Users: CRUD*, *Ratings*, *Passwords*, *Tokens*, *Registration*, *Images*) — **not** admin user management:

- **Read:** `user_me` (a `view` dispatcher: `profile` | `ratings` | `favorites`, with `recipe_id` for one rating), `user_ratings_get` (another user's ratings/favorites by user id)
- **Write:** `user_self_update` (profile fetch-merge), `user_ratings_write` (`action: rate | favorite | unfavorite`), `user_api_token_write` (`action: create | delete`), `user_password_write` (`action: change | forgot | reset`), `user_register`, `user_avatar_upload`

> **API-token create returns the token value exactly once** — Mealie never exposes it again; list existing tokens (ids/names only) via `user_me`. Passwords and reset tokens are **never echoed** by any tool. `user_register` hits Mealie's **public** registration endpoint (instances may have signup disabled). `user_avatar_upload` is multipart and reads a file on the MCP server (stdio/local only). Rating/favorite writes act on the **current** user (the id is resolved automatically); `unfavorite` and token `delete` require `confirm: true`.

### `admin` — Site Administration (17 tools)

The **site-operator surface** (`/api/admin/*` — Mealie's *Manage Users/Households/Groups*, *Backups*, *Maintenance*, *AI Providers*, *About*, *Email*, *Debug*). This is the **highest-blast-radius toolset** — enable it deliberately, and consider pairing it with `MEALIE_READ_ONLY=true` for a stats/inspection-only mode:

- **Read:** `admin_about` (`include: statistics | check | email_ready`), `admin_user_get`, `admin_household_get`, `admin_group_get` (paginated lists or by-id), `admin_ai_provider_get`, `admin_maintenance_get` (`view: summary | storage`), `admin_backup_get` (list, or a one-time download URL by `file_name`)
- **Write:** `admin_user_write`, `admin_household_write`, `admin_group_write`, `admin_ai_provider_write` (each `action: create | update | delete`, delete `confirm`-gated), `admin_user_actions` (`action: unlock | password_reset_token`), `admin_backup_write` (`action: create | upload | delete`), `admin_backup_restore`, `admin_maintenance_clean` (`target: images | temp | recipe_folders`, `confirm`-gated), `admin_email_test`, `admin_debug_openai`

> **`admin_backup_restore` OVERWRITES the entire instance** (all recipes, users, settings). It is double-gated: `confirm: true` **and** `confirm_file_name` re-typed to exactly match `file_name`. Maintenance cleans delete files irreversibly (Mealie itself has no confirmation flag — the gate here is the only one). **Secrets:** the admin user-create password and AI-provider `apiKey` are never echoed (and error messages for those tools are sanitized to the HTTP status); the password-reset token is returned **exactly once** — deliver it out-of-band; `admin_about` redacts the DB connection string. `admin_email_test` sends a real email; `admin_debug_openai` fires a real (possibly billable) AI-provider request. Updates are full-replace PUTs done as fetch-merge — the user update round-trips the full account object and **cannot change passwords** (use `admin_user_actions`).

### `explore` — Public Recipe Browsing (5 tools)

The **public browse surface** (`/api/explore/groups/{group_slug}/...`) — a read-only window onto a **public** group's recipes, cookbooks, organizers, foods, and households. All five tools are reads, so this is the only toolset that survives `MEALIE_READ_ONLY` intact:

- **Read:** `explore_recipe_search` (recipe_search's filters plus a `cookbook` filter), `explore_recipe_get`, `explore_recipe_suggestions`, `explore_list` / `explore_get` (`type: cookbook | category | tag | tool | food | household`)

> Every tool requires `group_slug` — find it in the instance's public URL (`/g/{slug}`), via `group_self_get` (groups toolset), or `admin_about`'s `defaultGroupSlug` (admin toolset). The target group must have public access enabled: **private and nonexistent groups both return the same 404**. Lookups are id-based except households (by household slug) and recipes (by recipe slug) — the public API offers exactly one lookup per type. Foods have no slug, so their concise items are `{id, name, labelId}`.

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
