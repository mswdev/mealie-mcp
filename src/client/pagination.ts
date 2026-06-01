/** A query-string value; `undefined`/`null` are dropped, arrays repeat the key. */
export type QueryValue = string | number | boolean | undefined | null | Array<string | number>;

/** Map of query parameters passed to a list/search endpoint. */
export type QueryParams = Record<string, QueryValue>;

/** A normalized, camelCase pagination envelope returned to tools. */
export type PaginatedResult<T> = {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
};

/** Mealie's raw pagination envelope (snake_case, fields may be null). */
type MealiePage<T> = {
  items: T[];
  total?: number | null;
  page?: number | null;
  per_page?: number | null;
  total_pages?: number | null;
};

/**
 * Builds a URL query string from params, dropping `undefined`/`null` and
 * repeating the key once per element for array values.
 *
 * @param params - The query parameters to serialize
 * @returns An encoded query string without the leading "?" (empty if no usable params)
 */
export function buildQueryString(params: QueryParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item));
      continue;
    }
    search.append(key, String(value));
  }
  return search.toString();
}

/**
 * Normalizes Mealie's snake_case pagination envelope to the camelCase shape tools use.
 *
 * @param page - The raw Mealie pagination envelope
 * @returns The normalized result with numeric fields defaulted to 0
 */
export function normalizePagination<T>(page: MealiePage<T>): PaginatedResult<T> {
  return {
    items: page.items,
    total: page.total ?? 0,
    page: page.page ?? 0,
    perPage: page.per_page ?? 0,
    totalPages: page.total_pages ?? 0,
  };
}
