import { describe, expect, it } from "vitest";
import { shoppingItemDeleteHandler } from "./shopping-item-delete.js";

type Captured = { path: string; query?: Record<string, unknown> | undefined };

function fakeClient(captured: Captured[]) {
  return {
    async delete<T>(path: string, query?: Record<string, unknown>): Promise<T> {
      captured.push({ path, query });
      return undefined as T;
    },
  };
}

describe("shoppingItemDeleteHandler", () => {
  it("refuses without confirm:true and does not call the client", async () => {
    const captured: Captured[] = [];

    const result = await shoppingItemDeleteHandler(fakeClient(captured), { itemId: "i1" });

    expect(result.isError).toBe(true);
    expect(captured).toHaveLength(0);
  });

  it("single: deletes via the item path", async () => {
    const captured: Captured[] = [];

    const result = await shoppingItemDeleteHandler(fakeClient(captured), { itemId: "i1", confirm: true });

    expect(captured[0]?.path).toBe("/api/households/shopping/items/i1");
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toEqual({ deleted: ["i1"] });
  });

  it("bulk: deletes via the ids query array", async () => {
    const captured: Captured[] = [];

    const result = await shoppingItemDeleteHandler(fakeClient(captured), {
      itemIds: ["i1", "i2"],
      confirm: true,
    });

    expect(captured[0]?.path).toBe("/api/households/shopping/items");
    expect(captured[0]?.query).toEqual({ ids: ["i1", "i2"] });
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toEqual({ deleted: ["i1", "i2"] });
  });

  it("errors when neither itemId nor itemIds is provided (but confirmed)", async () => {
    const result = await shoppingItemDeleteHandler(fakeClient([]), { confirm: true });

    expect(result.isError).toBe(true);
  });
});
