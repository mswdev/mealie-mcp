import { DEFAULT_ADMIN, MEALIE_URL, TOKEN_NAME } from "./config.js";

/** Logs in with the default admin and returns a short-lived bearer access token. */
export async function login(): Promise<string> {
  const form = new URLSearchParams({
    username: DEFAULT_ADMIN.username,
    password: DEFAULT_ADMIN.password,
  });
  const res = await fetch(`${MEALIE_URL}/api/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!res.ok) throw new Error(`login failed: HTTP ${res.status}`);
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

/** Mints a long-lived API token (the value the MCP server runs with). */
export async function mintApiToken(bearer: string): Promise<string> {
  const res = await fetch(`${MEALIE_URL}/api/users/api-tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: TOKEN_NAME }),
  });
  if (!res.ok) throw new Error(`token mint failed: HTTP ${res.status}`);
  const body = (await res.json()) as { token: string };
  return body.token;
}

/** PUTs a preferences body to a group/household self-service endpoint. */
async function putPreferences(bearer: string, path: string, body: unknown): Promise<void> {
  const res = await fetch(`${MEALIE_URL}${path}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} failed: HTTP ${res.status}`);
}

/** Makes the caller's group+household publicly explorable (3-tier; recipe flag set per-recipe later). */
export async function makeExplorable(bearer: string): Promise<void> {
  await putPreferences(bearer, "/api/groups/preferences", { privateGroup: false });
  await putPreferences(bearer, "/api/households/preferences", {
    privateHousehold: false,
    recipePublic: true,
  });
}

/** Flips the group private (to confirm the explore 404 path), then back to public. */
export async function setGroupPrivate(bearer: string, isPrivate: boolean): Promise<void> {
  await putPreferences(bearer, "/api/groups/preferences", { privateGroup: isPrivate });
}

/** Reads the caller's group slug (the explore group_slug; no public discovery endpoint exists). */
export async function groupSlug(bearer: string): Promise<string> {
  const res = await fetch(`${MEALIE_URL}/api/groups/self`, {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  const body = (await res.json()) as { slug: string };
  return body.slug;
}
