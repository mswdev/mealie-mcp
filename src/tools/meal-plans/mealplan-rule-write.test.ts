import { describe, expect, it } from "vitest";
import { mealplanRuleWriteHandler } from "./mealplan-rule-write.js";

type Call = { method: string; path: string; body?: unknown };

function fakeClient() {
  const calls: Call[] = [];
  return {
    calls,
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
  it("create posts a PlanRulesCreate body with defaults for unset fields", async () => {
    const client = fakeClient();

    await mealplanRuleWriteHandler(client, { action: "create", day: "monday", entryType: "dinner" });

    expect(client.calls[0]).toMatchObject({ method: "POST", path: "/api/households/mealplans/rules" });
    expect(client.calls[0]?.body).toEqual({ day: "monday", entryType: "dinner", queryFilterString: "" });
  });

  it("update puts to the rule path", async () => {
    const client = fakeClient();

    await mealplanRuleWriteHandler(client, { action: "update", ruleId: "rule-1", day: "friday" });

    expect(client.calls[0]).toMatchObject({ method: "PUT", path: "/api/households/mealplans/rules/rule-1" });
  });

  it("update without ruleId errors", async () => {
    const result = await mealplanRuleWriteHandler(fakeClient(), { action: "update" });

    expect(result.isError).toBe(true);
  });

  it("delete refuses without confirm and deletes with confirm", async () => {
    const noConfirm = await mealplanRuleWriteHandler(fakeClient(), { action: "delete", ruleId: "rule-1" });
    expect(noConfirm.isError).toBe(true);

    const client = fakeClient();
    const result = await mealplanRuleWriteHandler(client, {
      action: "delete",
      ruleId: "rule-1",
      confirm: true,
    });

    expect(client.calls[0]).toMatchObject({ method: "DELETE", path: "/api/households/mealplans/rules/rule-1" });
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toEqual({ deleted: "rule-1" });
  });
});
