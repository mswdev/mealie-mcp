import { describe, expect, it } from "vitest";
import { requireConfirmation } from "./confirm.js";

function text(r: { content: { type: string }[] }): string {
  return (r.content[0] as { type: "text"; text: string }).text;
}

describe("requireConfirmation", () => {
  it("returns an isError result when confirm is undefined", () => {
    const r = requireConfirmation(undefined, 'delete recipe "soup"');

    expect(r?.isError).toBe(true);
    expect(text(r as never)).toContain("confirm: true");
    expect(text(r as never)).toContain('delete recipe "soup"');
  });

  it("returns an isError result when confirm is false", () => {
    expect(requireConfirmation(false, "purge exports")?.isError).toBe(true);
  });

  it("returns null when confirm is true", () => {
    expect(requireConfirmation(true, 'delete recipe "soup"')).toBeNull();
  });
});
