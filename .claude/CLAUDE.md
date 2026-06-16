# CLAUDE.md

See @README.md for project overview and @package.json for available commands.

> **Owner:** mswdev
> **Product:** mealie-mcp — a TypeScript MCP server for the Mealie recipe manager
> **Repo:** mealie-mcp (single package, src/ at root)

## Quick Reference

**Core Rules:**
- @.claude/rules/code-style.md — Naming, complexity limits, documentation
- @.claude/rules/testing.md — Test structure, what to test, quality gates
- @.claude/rules/security.md — Security requirements
- @.claude/rules/file-organization.md — Directory structure, file caps, dependency direction

**Package Rules:** *(add package-specific rule files as needed)*
<!-- Example:
- @.claude/rules/backend/api.md — API layer rules
- @.claude/rules/frontend/webapp.md — Frontend rules
-->

## How to Use These Instructions

1. **Always follow** the core philosophy and code standards
2. **Consult package-specific rules** when working in individual packages
3. **Package rules extend, not override** shared standards (e.g., a backend package adds validation requirements but doesn't remove the 25-line method limit)

## 1. Project Overview

mealie-mcp is a TypeScript MCP (Model Context Protocol) server that connects MCP-compatible AI assistants to a [Mealie](https://mealie.io) instance — the self-hosted recipe manager. It exposes Mealie's REST API to AI clients (Claude Desktop, Claude Code, Cursor, ChatGPT) as MCP tools.

The server is distributed via `npx` and supports two transports, selected by the `TRANSPORT` env var: `stdio` (default, for desktop/CLI clients) and `http` (via `StreamableHTTPServerTransport`, for remote/ChatGPT use). TypeScript types are generated from Mealie's OpenAPI spec via `openapi-typescript` and committed to the repo.

| Term | Definition |
|------|-----------|
| **MCP** | Model Context Protocol — the standard this server implements to expose tools to AI clients |
| **Tool** | An MCP-exposed operation (e.g. `get_about`) that maps to a Mealie API capability |
| **MealieClient** | The typed HTTP client wrapping the Mealie REST API; one method per endpoint |
| **Transport** | The MCP connection mechanism — `stdio` (default) or `http` |
| **Mealie** | The self-hosted recipe manager this server integrates with |

## 2. Core Engineering Philosophy

1. **KISS** — Keep It Simple, Stupid. The simplest solution that works is the best solution.
2. **Clarity over cleverness** — No tricks, no golf, no "elegant" one-liners that require a comment to explain.
3. **Functional decomposition** — Break problems into small, named, single-purpose functions.
4. **Object-Oriented Design** — Model the domain with clear objects, well-defined boundaries, and explicit contracts.
5. **Test what matters** — Unit tests are not optional. If logic makes a decision, it gets a test. ALWAYS WRITE TESTS.
6. **SOLID Principles** — Follow SOLID programming principles.

## 3. Code Review Checklist

Before approving any PR, verify:
- [ ] **Can I understand every method without reading its callees?** If no, the names need work.
- [ ] **There are NO MAGIC NUMBERS**
- [ ] **Is every method <= 25 lines?** NO EXCEPTIONS.
- [ ] **Is nesting <= 2 levels deep?** Extract if not.
- [ ] **Does each class have a single, obvious responsibility?**
- [ ] **Are there tests for every decision point in the logic?**
- [ ] **Is there any cleverness that should be replaced with clarity?**
- [ ] **Would a new teammate understand this in 5 minutes?**
- [ ] **Do new API endpoints have input validation schemas?**
- [ ] **Do all exported functions/methods/classes have JSDoc documentation?**
- [ ] **Do route handlers and service methods log their outcomes?**
- [ ] **Do all catch blocks capture errors to the error monitoring service?**

## 4. Infrastructure & Services

| Service | Purpose | Status |
|---------|---------|--------|
| Mealie REST API | Upstream recipe-manager API this server proxies | Active |
| @modelcontextprotocol/sdk | MCP server + transports (stdio, StreamableHTTP) | Active |
| pino | Structured logging (stderr only) | Active |
| zod | Config + input validation | Active |
| openapi-typescript | Generates Mealie API types from the OpenAPI spec | Active |
| tsup | Build/bundle (ESM) | Active |
| Biome | Lint + format | Active |
| Vitest | Test runner | Active |

## 5. Git Workflow

**Branch naming:** `feature/{short-description}` (e.g., `feature/recipe-tools`)
**Commit messages:** Use conventional-commit prefixes (e.g., `feat: add recipe tools`, `fix: handle 404 from Mealie`)
**Always use feature branches + PRs.** NEVER commit directly to `main` or `develop`.
**PRs target `develop`, not `main`.** `develop` is the integration branch; `main` is release-only.
**ALWAYS create PRs as drafts** (`gh pr create --draft --base develop`). The author decides when to mark "Ready for review."
**PR description:** Describe what changed and why, list affected files.

## 6. MCP Development Rules

- **Tools live in `src/tools/<domain>/`** — one file per domain (e.g. `recipes.ts`, `meal-plans.ts`)
- **All tools are registered via `registerAboutTools(server, client)` pattern** — each tool file exports a `register<Domain>Tools(server, client)` function
- **Tool handlers are exported separately** for testability — `export async function <toolName>Handler(...)` called by the registered handler
- **`pino` logs to stderr only** — NEVER call `console.log` or write to stdout; use `logger.info()`, `logger.error()`, etc.
- **No tool should throw** — return `{ content: [...], isError: true }` on failure instead
- **`MealieClient` methods map 1:1 to Mealie API endpoints** — one method per endpoint, typed with generated OpenAPI types

## 7. AI-Specific Instructions

- **Read and ingest before you edit.** Always read relevant source files before proposing changes. NEVER speculate about code you haven't inspected.
- **These rules are authoritative over observed codebase patterns.** If existing code violates a rule in this document or `.claude/rules/`, that is technical debt — not a convention to follow. Never justify bad practices because you see them elsewhere in the repo. When in doubt, follow the rules, not the code.
- **Follow existing design patterns that comply with these rules.** Study the relevant package and match the established architecture, file placement, and naming. If a convention exists and does not violate these rules, use it. If you have a clear technical reason to deviate, explain the rationale.
- **Reuse existing utility functions**
- **Reuse existing UI components**
- **Verify schema and queries against source files.** Check your ORM schema for table/column structure before writing code that references them.
- **Check existing types before creating new ones** to avoid duplication. Create new types when genuinely needed for new features.
- **Flag security concerns proactively** (exposed secrets, SQL injection, missing auth, etc.).
- **Use parallel tool calls** for independent operations (e.g., reading multiple files, running lint and test simultaneously).
- **Package context awareness:** When working in a specific package, prioritize that package's rule file.
