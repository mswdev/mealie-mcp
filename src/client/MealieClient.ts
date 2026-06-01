import { logger } from "../logger.js";
import type { paths } from "../types/mealie.js";
import { MealieApiError } from "./MealieApiError.js";
import { buildQueryString, normalizePagination } from "./pagination.js";
import type { MealiePage, PaginatedResult, QueryParams } from "./pagination.js";

/** The response shape from GET /api/app/about */
export type AppAbout =
  paths["/api/app/about"]["get"]["responses"][200]["content"]["application/json"];

/**
 * Typed HTTP client for the Mealie REST API.
 * All methods correspond 1:1 to a single Mealie API endpoint, except the generic
 * verb primitives (get/post/put/patch/delete/postMultipart) that tools call with a
 * path. Consolidation of endpoints into tools happens above this layer.
 */
export class MealieClient {
  readonly #baseUrl: string;
  readonly #authHeader: string;

  /**
   * Creates a client bound to a single Mealie instance.
   *
   * @param baseUrl - Base URL of the Mealie instance; a trailing slash is stripped
   * @param apiToken - Mealie API token, sent as a Bearer credential and never logged
   */
  constructor(baseUrl: string, apiToken: string) {
    this.#baseUrl = baseUrl.replace(/\/$/, "");
    this.#authHeader = `Bearer ${apiToken}`;
  }

  /** Base URL of the connected Mealie instance (no trailing slash). */
  get baseUrl(): string {
    return this.#baseUrl;
  }

  /** Headers for JSON requests: auth + JSON content negotiation. */
  #jsonHeaders(): Record<string, string> {
    return {
      Authorization: this.#authHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  /** Builds the "?..." URL suffix from query params (empty when none usable). */
  #querySuffix(query?: QueryParams): string {
    if (!query) return "";
    const queryString = buildQueryString(query);
    return queryString ? `?${queryString}` : "";
  }

  /**
   * Validates the response and parses its JSON body, tolerating an empty body.
   * Mealie's DELETE and several write endpoints return 200/204 with no content;
   * response.json() would throw SyntaxError on the empty string, so read text
   * first and only parse when non-empty.
   *
   * @param response - The fetch Response
   * @param path - API path (for error context)
   * @returns The parsed body, or undefined when the body is empty
   * @throws {MealieApiError} when the API returns a non-2xx status
   */
  async #readJson<T>(response: Response, path: string): Promise<T> {
    const text = await response.text();
    if (!response.ok) {
      throw new MealieApiError(response.status, response.statusText, path, text);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /**
   * Fetches a resource from the Mealie API.
   *
   * @param path - The API path (e.g. "/api/app/about")
   * @param query - Optional query parameters appended to the URL
   * @returns The parsed JSON response body
   * @throws {MealieApiError} when the API returns a non-2xx status
   */
  async get<T>(path: string, query?: QueryParams): Promise<T> {
    const url = `${this.#baseUrl}${path}${this.#querySuffix(query)}`;
    logger.debug({ url }, "GET request");
    const response = await fetch(url, { headers: this.#jsonHeaders() });
    return this.#readJson<T>(response, path);
  }

  /**
   * Fetches a paginated list and normalizes Mealie's envelope.
   *
   * @param path - The list endpoint path (e.g. "/api/recipes")
   * @param query - Optional pagination/filter query parameters
   * @returns A normalized paginated result
   * @throws {MealieApiError} when the API returns a non-2xx status
   */
  async getPaginated<T>(path: string, query?: QueryParams): Promise<PaginatedResult<T>> {
    const page = await this.get<MealiePage<T>>(path, query);
    return normalizePagination(page);
  }

  /**
   * Sends a JSON request body with the given method and returns the parsed response.
   *
   * @param method - HTTP method ("POST" | "PUT" | "PATCH")
   * @param path - API path (e.g. "/api/recipes")
   * @param body - JSON-serializable request body
   * @param query - Optional query parameters appended to the URL
   * @returns The parsed JSON response body (undefined when the API returns no content)
   * @throws {MealieApiError} when the API returns a non-2xx status
   */
  async #send<T>(method: string, path: string, body: unknown, query?: QueryParams): Promise<T> {
    const url = `${this.#baseUrl}${path}${this.#querySuffix(query)}`;
    logger.debug({ url, method }, "write request");
    const response = await fetch(url, {
      method,
      headers: this.#jsonHeaders(),
      body: JSON.stringify(body),
    });
    return this.#readJson<T>(response, path);
  }

  /**
   * Sends a POST request with a JSON body.
   *
   * @param path - API path of the endpoint
   * @param body - JSON-serializable request body
   * @param query - Optional query parameters
   * @returns The parsed JSON response body
   * @throws {MealieApiError} when the API returns a non-2xx status
   */
  async post<T>(path: string, body: unknown, query?: QueryParams): Promise<T> {
    return this.#send<T>("POST", path, body, query);
  }

  /**
   * Sends a PUT request with a JSON body.
   *
   * @param path - API path of the endpoint
   * @param body - JSON-serializable request body
   * @param query - Optional query parameters
   * @returns The parsed JSON response body
   * @throws {MealieApiError} when the API returns a non-2xx status
   */
  async put<T>(path: string, body: unknown, query?: QueryParams): Promise<T> {
    return this.#send<T>("PUT", path, body, query);
  }

  /**
   * Sends a PATCH request with a JSON body.
   *
   * @param path - API path of the endpoint
   * @param body - JSON-serializable request body
   * @param query - Optional query parameters
   * @returns The parsed JSON response body
   * @throws {MealieApiError} when the API returns a non-2xx status
   */
  async patch<T>(path: string, body: unknown, query?: QueryParams): Promise<T> {
    return this.#send<T>("PATCH", path, body, query);
  }

  /**
   * Sends a DELETE request (no body) and returns the parsed response.
   *
   * @param path - API path of the resource to delete
   * @param query - Optional query parameters
   * @returns The parsed JSON response body (undefined when the API returns no content)
   * @throws {MealieApiError} when the API returns a non-2xx status
   */
  async delete<T>(path: string, query?: QueryParams): Promise<T> {
    const url = `${this.#baseUrl}${path}${this.#querySuffix(query)}`;
    logger.debug({ url, method: "DELETE" }, "write request");
    const response = await fetch(url, { method: "DELETE", headers: this.#jsonHeaders() });
    return this.#readJson<T>(response, path);
  }

  /**
   * Sends a multipart/form-data upload. The Content-Type header is deliberately
   * omitted so fetch derives "multipart/form-data; boundary=..." from the FormData.
   *
   * @param path - API path of the upload endpoint
   * @param formData - The pre-assembled multipart body
   * @param query - Optional query parameters (e.g. translateLanguage)
   * @param method - HTTP method, defaulting to "POST" (some uploads use "PUT")
   * @returns The parsed JSON response body
   * @throws {MealieApiError} when the API returns a non-2xx status
   */
  async postMultipart<T>(
    path: string,
    formData: FormData,
    query?: QueryParams,
    method = "POST",
  ): Promise<T> {
    const url = `${this.#baseUrl}${path}${this.#querySuffix(query)}`;
    logger.debug({ url, method }, "multipart upload");
    const response = await fetch(url, {
      method,
      headers: { Authorization: this.#authHeader, Accept: "application/json" },
      body: formData,
    });
    return this.#readJson<T>(response, path);
  }

  /**
   * Returns information about the connected Mealie instance.
   *
   * @returns The connected Mealie instance's about info (version, config, feature flags)
   * @see GET /api/app/about
   */
  async getAbout(): Promise<AppAbout> {
    return this.get<AppAbout>("/api/app/about");
  }
}
