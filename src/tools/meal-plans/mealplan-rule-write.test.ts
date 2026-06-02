import { describe, expect, it } from "vitest";
import { mealplanRuleWriteHandler } from "./mealplan-rule-write.js";

type Call = { method: string; path: string; body?: unknown };

/** Current rule the fake returns from get() (used by the fetch-merge in update). */
const CURRENT_RULE = {
  id: "rule-1",
  day: "monday",
  entryType: "dinner",
  queryFilterString: "tags.name = quick",
  groupId: "g",
  householdId: "h",
};

function fakeClient() {
  const calls: Call[] = [];
  return {
    calls,
    async get<T>(path: string): Promise<T> {
      calls.push({ method: "GET", path });
      return CURRENT_RULE as T;
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: "POST", path, body });
      return { id: "rule-1" } as T;
    },
    async put<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: "PUT", path, body });
      return { id: "rule-1" } as T;
    },
    async delete<T>(path: string): Promise<T> {
      calls.push({ method: "DELETE", path });
      return undefined as T;
    },
  };
}

describe("mealplanRuleWriteHandler", () => {
  it("create posts a fresh PlanRulesCreate body with defaults for unset fields", async () => {
    const client = fakeClient();

    await mealplanRuleWriteHandler(client, {
      action: "create",
      day: "monday",
      entryType: "dinner",
    });

    expect(client.calls[0]).toMatchObject({
      method: "POST",
      path: "/api/households/mealplans/rules",
    });
    expect(client.calls[0]?.body).toEqual({
      day: "monday",
      entryType: "dinner",
      queryFilterString: "",
    });
  });

  it("update fetch-merges: a partial update preserves the untouched fetched fields", async () => {
    const client = fakeClient();

    await mealplanRuleWriteHandler(client, {
      action: "update",
      ruleId: "rule-1",
      queryFilterString: "tags.name = slow",
    });

    // fetches current before PUT
    expect(client.calls[0]).toMatchObject({
      method: "GET",
      path: "/api/households/mealplans/rules/rule-1",
    });
    const put = client.calls[1];
    expect(put).toMatchObject({ method: "PUT", path: "/api/households/mealplans/rules/rule-1" });
    // only queryFilterString changed; day/entryType retained from the fetched rule (not reset to unset)
    expect(put?.body).toEqual({
      day: "monday",
      entryType: "dinner",
      queryFilterString: "tags.name = slow",
    });
  });

  it("update without ruleId errors", async () => {
    const result = await mealplanRuleWriteHandler(fakeClient(), { action: "update" });

    expect(result.isError).toBe(true);
  });

  it("delete refuses without confirm and does not touch the client", async () => {
    const client = fakeClient();

    const result = await mealplanRuleWriteHandler(client, { action: "delete", ruleId: "rule-1" });

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("delete removes the rule when confirm is true", async () => {
    const client = fakeClient();

    const result = await mealplanRuleWriteHandler(client, {
      action: "delete",
      ruleId: "rule-1",
      confirm: true,
    });

    expect(client.calls[0]).toMatchObject({
      method: "DELETE",
      path: "/api/households/mealplans/rules/rule-1",
    });
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toEqual({ deleted: "rule-1" });
  });
});
