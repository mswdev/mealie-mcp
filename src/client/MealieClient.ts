import { logger } from "../logger.js";
import type { paths } from "../types/mealie.js";

/** The response shape from GET /api/app/about */
export type AppAbout =
  paths["/api/app/about"]["get"]["responses"][200]["content"]["application/json"];

/**
 * Typed HTTP client for the Mealie REST API.
 * All methods correspond 1:1 to a single Mealie API endpoint.
 */
export class MealieClient {
  readonly #baseUrl: string;
  readonly #headers: Record<string, string>;

  /**
   * Creates a client bound to a single Mealie instance.
   *
   * @param baseUrl - Base URL of the Mealie instance; a trailing slash is stripped
   * @param apiToken - Mealie API token, sent as a Bearer credential and never logged
   */
  constructor(baseUrl: string, apiToken: string) {
    this.#baseUrl = baseUrl.replace(/\/$/, "");
    this.#headers = {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  /**
   * Fetches a resource from the Mealie API.
   *
   * @param path - The API path (e.g. "/api/app/about")
   * @returns The parsed JSON response body
   * @throws {MealieApiError} when the API returns a non-2xx status
   */
  async get<T>(path: string): Promise<T> {
    const url = `${this.#baseUrl}${path}`;
    logger.debug({ url }, "GET request");

    const response = await fetch(url, { headers: this.#headers });

    if (!response.ok) {
      throw new MealieApiError(response.status, response.statusText, path);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Returns information about the connected Mealie instance.
   *
   * @see GET /api/app/about
   */
  async getAbout(): Promise<AppAbout> {
    return this.get<AppAbout>("/api/app/about");
  }
}

/** Thrown when the Mealie API responds with a non-2xx status code. */
export class MealieApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly statusText: string,
    readonly path: string,
  ) {
    super(`Mealie API error ${statusCode} (${statusText}) at ${path}`);
    this.name = "MealieApiError";
  }
}
