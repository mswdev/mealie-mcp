/** Thrown when the Mealie API responds with a non-2xx status code. */
export class MealieApiError extends Error {
  /**
   * @param statusCode - HTTP status code returned by the Mealie API
   * @param statusText - HTTP status text returned by the Mealie API
   * @param path - API path that produced the error (e.g. "/api/app/about")
   */
  constructor(
    readonly statusCode: number,
    readonly statusText: string,
    readonly path: string,
  ) {
    super(`Mealie API error ${statusCode} (${statusText}) at ${path}`);
    this.name = "MealieApiError";
  }
}
