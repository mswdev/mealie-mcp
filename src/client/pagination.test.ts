import { describe, expect, it } from "vitest";
import { buildQueryString, normalizePagination } from "./pagination.js";

describe("buildQueryString", () => {
  it("omits undefined/null and serializes scalars", () => {
    const qs = buildQueryString({ page: 2, search: "soup", missing: undefined, gone: null });

    expect(qs).toBe("page=2&search=soup");
  });

  it("repeats the key for array values", () => {
    const qs = buildQueryString({ tags: ["a", "b"], page: 1 });

    expect(qs).toBe("tags=a&tags=b&page=1");
  });

  it("returns an empty string for no usable params", () => {
    expect(buildQueryString({ a: undefined })).toBe("");
  });
});

describe("normalizePagination", () => {
  it("maps Mealie's snake_case envelope to a normalized result", () => {
    const result = normalizePagination({
      items: [{ id: "x" }],
      total: 5,
      page: 1,
      per_page: 20,
      total_pages: 1,
    });

    expect(result).toEqual({ items: [{ id: "x" }], total: 5, page: 1, perPage: 20, totalPages: 1 });
  });

  it("defaults missing numeric fields to 0", () => {
    const result = normalizePagination({ items: [] });

    expect(result).toEqual({ items: [], total: 0, page: 0, perPage: 0, totalPages: 0 });
  });
});
