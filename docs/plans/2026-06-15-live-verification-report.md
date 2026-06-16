# PR #12 — Live Verification Report

**Image:** `ghcr.io/mealie-recipes/mealie:v3.19.2` · **Running version:** `v3.19.2`
**Image digest:** `ghcr.io/mealie-recipes/mealie@sha256:f68e959bf66f4f458893ea58facac71690fe6f2ac7a31466b5cecb41b4e99c02`
**Spec parity:** MATCH (live 259 ops = committed 259)
**Tally:** 50 pass · 0 fail · 0 diverge · 0 skip

Most checks re-fetch and assert the named owed behavior; the success-mapping checks (C-SEED, C-MAINT-CLEAN, C-EMAIL-TEST, C-AVATAR, C-MIGRATION) assert the synthesized error-on-200 / success mapping rather than re-fetched state. Either way, a pass would FAIL if the guarded bug were present.

| | ID | Owed PR | Check | Evidence / detail |
|---|---|---|---|---|
| ✅ | C-SMOKE-TOOLS | #7-#11 | all six toolsets expose 121 tools | listTools returned 121 tools |
| ✅ | C-SMOKE-SEARCH | #2 | recipe_search reaches the live API authed | total=0, items=0 |
| ✅ | C-RECIPE-RW | #2 | recipe_get concise/detailed/include projection | search hit; concise trimmed; detailed full; include added nutrition |
| ✅ | C-RECIPE-CREATE | #3 | recipe_create re-fetches bare slug into full object | created object id=74cea444-68c6-4415-bcc1-7e49a5bac86d slug=verifycreaterecipe; re-fetch matched |
| ✅ | C-RECIPE-UPDATE | #3 | recipe_update fetch-merge preserves recipeYield across rename | recipeYield survived rename (write-response + re-fetch); put+patch both live; slug verifyupdrecipe -> verifyupdrenamed |
| ✅ | C-RECIPE-DELETE | #3 | recipe_delete confirm gate + {deleted:slug} + gone | confirm gate held; deleted verifydelrecipe; re-fetch 404'd |
| ✅ | C-RECIPE-IMAGE | #3 | recipe_image multipart upload attaches image | image attached: 249 |
| ✅ | C-RECIPE-ASSET | #3 | recipe_assets multipart upload retrievable via recipe_media (round-trip) | multipart asset uploaded and retrieved 200 via recipe_media: verifynote.txt |
| ✅ | C-RECIPE-ZIP | #3 | recipe export -> zip download (REST bridge) -> delete -> recipe_import zip restores it | export -> token-bridge download -> delete -> zip import restored verifyzipsource |
| ✅ | C-RECIPE-IMPORT | #3 | recipe_import html_or_json (hermetic) creates a recipe | imported recipe slug=verifyimportrecipe |
| ✅ | C-FOOD-MERGE | #5 | food_update preserves aliases across rename | seeded aliases survived rename: [{"name":"scallion-ish"}] |
| ✅ | C-FOOD-DELETE | #5 | food_delete confirm gate + {deleted:id} + gone | confirm gate held; deleted 2be59e18-fe5a-4450-98d8-8adbf0064bd0; re-fetch 404'd |
| ✅ | C-ORG-MERGE | #5 | organizer_update full-replace PUT accepted (rename) | rename applied; full-replace PUT accepted (householdsWithTool not Mealie-settable — see report note) |
| ✅ | C-ORG-EMPTY | #5 | organizer_search empty_only un-enveloped + tool guard | empty_only un-enveloped (count=1); tool guard fired |
| ✅ | C-UNIT-MERGE | #5 | unit_update preserves fraction; unit_merge removes source | fraction survived rename; merge removed source 30d61507-a02b-4691-b6bf-ed1125533a05 |
| ✅ | C-MEALPLAN | #4 | mealplan_update preserves text across rename (integer id) | integer id=1; text survived rename |
| ✅ | C-SHOPLIST-UPDATE | #4 | shopping_list_update round-trips listItems (no 422) + rename | rename applied; 1 item survived the Output->Input PUT |
| ✅ | C-SHOPITEM | #4 | shopping_item create/update fetch-merge preserves note+quantity | single+bulk created; note/quantity survived; checked applied |
| ✅ | C-COOKBOOK | #4 | cookbook_update preserves queryFilterString across rename | rename applied; queryFilterString survived: tags.name CONTAINS ALL ["quick"] |
| ✅ | C-HH-PREFS | #7 | household_self_update preferences preserves untouched fields | recipeShowNutrition applied; privateHousehold (false) preserved |
| ✅ | C-HH-PERMS | #7 | household permissions no-downgrade + member-not-found guard | canInvite elevated on a real member; canManage preserved (no downgrade); unknown member rejected |
| ✅ | C-WEBHOOK | #7 | webhook_write fetch-merge + synth delete | fields survived single-field update; synth {deleted}; gone |
| ✅ | C-NOTIFY | #7 | event_notification_write preserves options block + synth delete | options block (27 toggles) survived; synth {deleted} from 204 |
| ✅ | C-INVITE | #7 | invite token shape + bare-array list + EmailInitationResponse | ReadInviteToken ok; list bare-array wrapped; send_email -> success-shape |
| ✅ | C-GROUP-SELF | #8 | group_self_update preserves privateGroup across a prefs change | showAnnouncements toggled; privateGroup (false) preserved |
| ✅ | C-LABEL | #8 | label_write preserves color across rename | color survived rename; detailed has all 4 fields |
| ✅ | C-AIPROVIDER | #8 | AI provider apiKey never echoed + settings fetch-merge | apiKey never echoed (create+update); seeded audioProviderId survived a defaultProviderId-only update |
| ✅ | C-SEED | #8 | group_seed maps SuccessResponse to a non-error result | seed labels mapped error:false -> success: {"seeded":"labels","message":"Seeding Successful"} |
| ✅ | C-MIGRATION | #8 | group_start_migration confirm gate + multipart archive | confirm gate held; multipart archive uploaded; reportId=67092bc9-cfcf-494d-8784-0fbc70bdd61a |
| ✅ | C-REPORT | #8 | group_report list {items,count} + confirm-gated synth delete | list un-enveloped (count=1); confirm gate; synth {deleted}; gone |
| ✅ | C-USER-ME | #9 | user_me concise enumerates tokens (no raw value) | tokens enumerated (1); no raw values |
| ✅ | C-USER-UPDATE | #9 | user_self_update preserves untouched whitelist fields | fullName changed; username/email survived |
| ✅ | C-USER-TOKEN | #9 | api token shown-once + confirm-gated delete (integer id) | raw token shown once; absent after; confirm-gated delete -> {deleted:2} |
| ✅ | C-USER-RATINGS | #9 | user_ratings_write favorite round-trips into user_me | favorite by slug round-tripped to favorites by recipeId |
| ✅ | C-USER-PW | #9 | user_password_write error leaks no secret (secretSafeErrorResult) | error surfaced status-only; no secret leak |
| ✅ | C-USER-REG | #9 | user_register (public) creates an account via invite token | account created via invite token; password not echoed |
| ✅ | C-AVATAR | #9 | user_avatar_upload multipart (profile field) | avatar multipart accepted: {"uploaded":true,"userId":"91056a3a-d0ae-410e-b31c-6bf60741e433"} |
| ✅ | C-EXPLORE-LIST | #11 | explore_list food branch {id,name,labelId} + explore_get by id | food branch projected {id,name,labelId}; explore_get by id returned the food |
| ✅ | C-EXPLORE-RECIPE | #11 | explore recipe search/get/suggestions on the public surface | public search hit; concise/detailed/include correct; suggestions returned items |
| ✅ | C-EXPLORE-HH-GUARD | #11 | explore_list household+search guard (search-specific) | household+search rejected; household (no search) allowed |
| ✅ | C-EXPLORE-404 | #11 | private vs nonexistent group both 404 (indistinguishable) | nonexistent -> 404; private -> 404 (indistinguishable, no enumeration leak) |
| ✅ | C-ADMIN-RW | #10 | admin user/household/group round-trip + cacheKey redaction | user email survived rename; cacheKey redacted; household+group round-tripped; cleaned up |
| ✅ | C-ADMIN-ABOUT | #10 | admin_about redacts dbUrl + statistics include | about populated; dbUrl redacted; statistics included |
| ✅ | C-ADMIN-ACTIONS | #10 | admin reset-token shown-once + validation guard + unlock | reset token shown-once; missing-email guarded; unlock returned a count |
| ✅ | C-ADMIN-AIKEY | #10 | admin AI provider apiKey never echoed | apiKey absent from create/update/read; re-supply accepted |
| ✅ | C-BACKUP-RESTORE | #10 | backup create->delete-marker->restore brings the marker back (double gate) | double gate held; restore brought the deleted marker back (state moved) |
| ✅ | C-BACKUP-DELETE | #10 | admin_backup_write delete confirm gate + gone | confirm gate held; backup mealie_2026.06.16.05.17.22.zip deleted and gone |
| ✅ | C-MAINT-CLEAN | #10 | admin_maintenance_clean confirm gate + SuccessResponse mapping | confirm gate held; SuccessResponse error:false -> {cleaned:temp} |
| ✅ | C-EMAIL-TEST | #10 | admin_email_test no-SMTP maps success:false -> isError | no-SMTP success:false correctly mapped to isError |
| ✅ | C-DEBUG-OPENAI | #10 | admin_debug_openai bogus provider -> clean isError | bogus provider -> clean isError (no crash) |

## Findings

**Bug found & fixed (TDD):**

- `recipe_update` reported failure on a rename. Mealie regenerates a recipe's slug when `name` changes, so the handler's post-update re-fetch by the *original* slug 404'd. Fixed to return the PUT/PATCH response (the updated recipe, with the new slug). Regression test in `recipe-update.test.ts`.

**Quirks-ledger confirmed against the live instance:**

- **Bare-slug create** — `POST /api/recipes` returns a bare quoted slug string; `recipe_create` re-fetches into a full object (C-RECIPE-CREATE).
- **Error-on-200** — `SuccessResponse{error}` (group_seed, backups, maintenance) and `EmailSuccess{success}` (email test) both map to `isError` (C-SEED, C-MAINT-CLEAN, C-EMAIL-TEST).
- **Integer meal-plan ids** — `ReadPlanEntry.id` is a number, not a uuid (C-MEALPLAN).
- **`EmailInitationResponse`** (verbatim upstream typo) — surfaced with its `{success}` shape (C-INVITE).
- **`secretSafeErrorResult`** — a real 422 carrying a submitted password surfaces status-only, no secret leak (C-USER-PW); write-only `apiKey` never echoed (C-AIPROVIDER, C-ADMIN-AIKEY); reset/api tokens shown exactly once (C-ADMIN-ACTIONS, C-USER-TOKEN).

**Mealie behaviors to be aware of (not bugs in this server):**

- Uploaded recipe assets do not appear in `recipe.recipeAssets` on a GET; the asset POST returns the descriptor (read assets via `recipe_media`).
- `householdsWithTool` is not settable via the organizer/tool endpoints (create and PUT both return `[]`); it is managed per-household.
- `GET /api/groups/reports` returns rows only when `report_type` is supplied; unfiltered it is empty.
- Mealie normalizes a webhook `scheduledTime` from `HH:MM` to `HH:MM:SS`.
- A backup restore can momentarily restart the instance; the harness waits for `/api/app/about` to return before continuing.
- A recipe zip import (`/api/recipes/create/zip`) returns **500** when the recipe's slug already exists (it does not suffix/409); the round-trip deletes the original first.

**Deferred (named in the task, not exercised live):**

- `admin_backup_write(action:"upload")` — uploading a backup archive. It needs a valid Mealie backup zip on disk (obtainable only via a create -> download-token bridge, and re-uploading risks the same slug-conflict quirk as zip import). The underlying `postMultipart` mechanism is already proven five ways (recipe image/asset/zip, avatar, group migration), so this is low-value; the safe `action:"create"` and `action:"delete"` paths ARE covered (C-BACKUP-RESTORE/DELETE).

## Teardown

`docker compose down -v` runs automatically in the harness `finally`. The container is disposable — never aimed at a real instance.
