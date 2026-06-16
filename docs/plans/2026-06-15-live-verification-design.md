# PR #12 Design — Live Verification Pass (paying the owed-testing debt)

**Status:** Approved (Matt, 2026-06-15)
**Branch:** `feature/live-verification` → draft PR into `develop`
**Roadmap:** No new coverage (259/259 already mapped through PR #11). This PR retires the "OWED real-instance testing" note every PR since #2 carries, by running the owed checklist live against a **disposable local Mealie** through the **real stdio MCP server**.

Decisions settled in brainstorm (2026-06-15):

- **Deliverable:** a committed, repeatable harness (`docker-compose.yml` + `npm run verify:live`) + a verification report doc + TDD fix commits. Reruns before every release.
- **Doc scope:** PR #12 also updates the roadmap doc's Status header + adds a README "live-verified against vX.Y.Z" note (owner chose to break the never-edit-per-PR convention here, knowingly).
- **Admin destructive subset:** full, including backup create→restore round-trip, sequenced **last**; `email_test`/`debug_openai` verified as clean-failure paths only (no SMTP/provider configured).
- **PR #11 drift-guard leftover:** add the cross-import drift-guard test with a documented **test-only** sibling-cross-import exemption.

---

## 1. Goal

One pass that converts "covered by unit fakes only" into "exercised against a real Mealie." The unit suite already proves *we re-send / re-shape* a field; only a live instance proves *Mealie keeps it* (superset-body acceptance), that *secrets show exactly once*, that *fetch-merge survives a rename*, that *restore moves state*, and that *error-on-200 maps to `isError`*. The container is **disposable** — that disposability is the entire safety boundary.

## 2. The verification discipline (non-negotiable)

A check passes **only if it would FAIL with the bug it guards present.** "Tool returned 200 / `isError` false" is never, by itself, a pass. Every check captures the **actual response snippet** into the report doc — a report that only says "PASS" is not evidence of verification.

Recurring assertion shapes (each owed item maps onto one of these):

| Shape | Proof | Owed items it covers |
|---|---|---|
| **fetch-merge survival** | create w/ distinctive *secondary* field → update *only a primary* field (rename) → re-fetch detailed → **secondary field unchanged** | `recipe_update`, `mealplan_update`, `shopping_list_update`, `shopping_item_update`, `cookbook_update`, `organizer_update` (`tool.householdsWithTool`), `food_update` (`aliases`/`labelId`), `unit_update` (`standardQuantity`/`standardUnit`), `household_self_update` (prefs), `group_self_update`, `label_write`, `group_ai_provider_settings_update` (3 pointers), `user_self_update` (whitelist), admin user/household/group updates |
| **superset-body acceptance** | PUT a body carrying Output-only / read-only fields → **no 422** + correct re-fetch | `shopping_list_update` (Output-variant `listItems` into Input body); all fetch-merge PUTs re-sending `id`/`groupId`/`householdId`/`recipe`/`label`/`createdAt`/`updatedAt` |
| **secret shown-once** | token present in create result → read it back → **absent** | `user_api_token_write`, `admin_user_actions` (`password_reset_token`) |
| **apiKey re-supply (write-only)** | update *with* re-supply works + apiKey never in any read; (cheap) update *without* → blanks | `group_ai_provider_write`, `admin_ai_provider_write` |
| **error-on-200** | handler maps `error:true` / `success:false` → **`isError`** | `group_seed`, `admin_backup_*`, `admin_maintenance_clean`, `admin_backup_restore` (`SuccessResponse{error}`); `admin_email_test` (`EmailSuccess{success}` — no-SMTP *is* the error path) |
| **restore moves state** | create uniquely-named marker → backup → delete marker → restore → re-fetch → **marker returns** | `admin_backup_restore` |
| **secretSafeErrorResult** | trigger a real 422 carrying a submitted secret → result + logs surface **status only** | `user_password_write`, `user_register`, `admin_user_write`, `admin_user_actions`, `admin_ai_provider_write` |
| **bare-slug create re-fetch** | create returns bare slug → tool re-fetches → full object echoed | `recipe_create` and the catalog creates that re-fetch |
| **explore public round-trip** | make group public → all 5 explore tools read unauthenticated-surface → flip private → **identical 404** for private vs nonexistent | `explore_*` (first-ever live run) |

## 3. Harness architecture

```
docker-compose.yml          repo root; Mealie pinned to a specific stable tag
                            (verified during execution, recorded exactly);
                            ephemeral (down -v / no named volume); 127.0.0.1:<nonstandard>;
                            healthcheck.
scripts/verify-live.ts      tsx orchestrator (see §3.1)
fixtures/ (or scripts/fixtures/)  real on-disk files for multipart checks
package.json                "verify:live": "tsx scripts/verify-live.ts"  (NOT in the gate)
```

### 3.1 Orchestrator control flow

```
try {
  docker compose up -d --wait
  specParityPreflight()            // §4
  bootstrap()                      // §5 — REST mint first token; prep fixtures + entities
  runNonDestructiveChecks()        // reads + creates + fetch-merge survival + secrets + apiKey
  runExploreChecks()               // make-public → read → flip-private (§2 last row)
  runDestructiveChecksLast()       // backup create→restore, backup delete, maintenance cleans,
                                   //   email_test/debug_openai clean-failure
  writeReport()                    // fill the pre-written skeleton with snippets + verdicts
} finally {
  docker compose down -v           // UNCONDITIONAL — a restore leaves the container weird
}
```

- Runs against the **built `dist/`** (`node dist/index.js`), spawned as a real stdio subprocess with `MEALIE_URL`/`MEALIE_API_TOKEN` + the relevant `MEALIE_TOOLSETS` for each domain, via the MCP SDK `Client` + `StdioClientTransport`.
- **Safety boundary:** the orchestrator **hardcodes** its target to its own compose project on the local non-standard port. It never reads an ambient `MEALIE_URL`, so it cannot be aimed at a real instance. `--keep` skips teardown (debug only).
- Multipart checks need real files on disk (recipe image/asset/zip, avatar `profile` field, group-migration `archive`, admin backup upload) — prepared in `bootstrap()`.

## 4. Spec-parity pre-flight

The committed `src/types/mealie.ts` is generated from `demo.mealie.io/openapi.json` (a *nightly* demo). A pinned stable release may differ. Before any tool check: fetch the container's `/openapi.json`, compare operation count / key operationIds against the committed provenance (259 ops). Report skew **up front** so a later check failure reads correctly as *real bug* vs *version drift*. A genuine spec move → **regenerate via `npm run generate`** pointed at the container (a release-time decision surfaced to the owner), **never** a hand-edit to `mealie.ts`.

## 5. Bootstrap facts — verify, don't guess

Resolved via context7/web **before scripting** (the same rigor as the version pin):

- Default admin credentials + **whether first login forces a password change**.
- The token-mint endpoint (first token via REST; chicken-and-egg before the MCP client connects). Then **dogfood `user_api_token_write` through MCP** as its own check.
- The public-explore gating model: group-level `privateGroup`, recipe-level public flag, or both (check the explore design notes + group-preferences schema) — do not assume "make the group public" is one switch.

Throwaway entity creates go **through the MCP tools** (that *is* the test). Only pure setup with no MCP tool equivalent uses REST.

## 6. Fix workflow + divergences-as-findings

Every bug found live → **failing unit test first** (a hand-written fake mimicking the real response that broke) → fix → re-run live to confirm. Sequential TDD in the main loop. The quirks ledger (bare-slug create, error-on-200, integer mealplan ids, `EmailInitationResponse` typo, `secretSafeErrorResult` on real 422s) each gets an explicit **confirm-or-diverge** line in the report. A divergence is a **finding** to surface, never a silent retype.

## 7. Doc updates (precise)

- **Roadmap doc** (`2026-05-31-...-roadmap.md`): update the **Status header** (line 5) + add a live-verification completion note. (§3 is a coverage map — no per-row "verified" column exists to flip; the actionable edit is the Status line + a note.)
- **README**: add a "live-verified against Mealie **vX.Y.Z**" note — exact pinned tag, never `nightly`/`latest`.
- **Drift-guard test**: a test importing the recipe concise-field list from both `recipes/` and `explore/`, asserting they stay in sync. Document the narrow **test-only** sibling-cross-import exemption in `.claude/rules/file-organization.md` (no linter enforces the ban — it is convention-only).

## 8. Report doc mechanics

`docs/plans/2026-06-15-live-verification-report.md`. Write the **checklist skeleton first** (durable against mid-run session death), then fill each row with **status + actual response snippet + verdict**, organized by owed-PR. Record exact Mealie version + container image digest + the spec-parity result.

## 9. Quality gate & teardown

Standard gate unchanged and run before every commit: `npm run build && npm run typecheck && npm run test && npm run lint`. The live harness is separate (needs Docker; excluded from the gate and `prepublishOnly`). Teardown (`docker compose down -v`) is unconditional and documented in the report. The container is disposable — never aimed at a real instance.

## 10. Process

Brainstorm (done) → writing-plans → execute (research bootstrap facts → harness → live run → sequential TDD fixes in the main loop) → adversarial review workflow → draft PR into `develop`. Matt reviews + runs `/requesting-code-review` before merge.

## 11. Sources

- Per-PR owed notes: `gh pr view 2..11` bodies (extracted 2026-06-15).
- Project memory ledger (per-PR gotchas + owed items).
- `docs/plans/2026-06-06-explore-{design,plan}.md` (process archetype; explore public-group gating).
- Mealie docs (container tag, default creds, token endpoint, public gating) — resolved during execution via context7/web.
