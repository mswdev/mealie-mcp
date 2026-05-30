# mealie-mcp

A full-featured MCP (Model Context Protocol) server for [Mealie](https://mealie.io) — the self-hosted recipe manager. Connect any MCP-compatible AI assistant to your Mealie instance.

> **Why this one?** Other Mealie MCPs cover a handful of endpoints. This one targets the full Mealie REST API.

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

Add to `.claude/settings.json` in your project, or `~/.claude/settings.json` globally:

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

# Run locally
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
