import { describe, expect, it } from "vitest";
import { mealplanDeleteHandler } from "./mealplan-delete.js";

describe("mealplanDeleteHandler", () => {
  it("refuses without confirm:true and does not call the client", async () => {
    let called = false;
    const client = {
      async delete<T>(): Promise<T> {
        called = true;
        return undefined as T;
      },
    };

    const result = await mealplanDeleteHandler(client, { planId: 7 });

    expect(result.isError).toBe(true);
    expect(called).toBe(false);
  });

  it("deletes and confirms when confirm is true", async () => {
    const captured: string[] = [];
    const client = {
      async delete<T>(path: string): Promise<T> {
        captured.push(path);
        return undefined as T;
      },
    };

    const result = await mealplanDeleteHandler(client, { planId: 7, confirm: true });

    expect(captured[0]).toBe("/api/households/mealplans/7");
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toEqual({ deleted: 7 });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async delete<T>(): Promise<T> {
        throw new Error("boom");
      },
    };

    const result = await mealplanDeleteHandler(client, { planId: 7, confirm: true });

    expect(result.isError).toBe(true);
  });
});
