/** Maximum length of the upstream error body included in the error message. */
const MAX_DETAIL_LENGTH = 500;

/** Thrown when the Mealie API responds with a non-2xx status code. */
export class MealieApiError extends Error {
  /**
   * @param statusCode - HTTP status code returned by the Mealie API
   * @param statusText - HTTP status text returned by the Mealie API
   * @param path - API path that produced the error (e.g. "/api/app/about")
   * @param detail - Raw response body from Mealie (e.g. its `{"detail": ...}` JSON), if any
   */
  constructor(
    readonly statusCode: number,
    readonly statusText: string,
    readonly path: string,
    readonly detail?: string,
  ) {
    super(MealieApiError.buildMessage(statusCode, statusText, path, detail));
    this.name = "MealieApiError";
  }

  /**
   * Builds the error message, appending a trimmed upstream detail when present so
   * the agent sees Mealie's actual reason (422 field errors, 409 slug-exists, the
   * SSRF InvalidDomainError) instead of a bare status code.
   *
   * @param statusCode - HTTP status code
   * @param statusText - HTTP status text
   * @param path - API path that produced the error
   * @param detail - Raw upstream response body, if any
   * @returns The composed error message
   */
  private static buildMessage(
    statusCode: number,
    statusText: string,
    path: string,
    detail?: string,
  ): string {
    const base = `Mealie API error ${statusCode} (${statusText}) at ${path}`;
    const trimmed = detail?.trim();
    if (!trimmed) return base;
    const clipped =
      trimmed.length > MAX_DETAIL_LENGTH ? `${trimmed.slice(0, MAX_DETAIL_LENGTH)}…` : trimmed;
    return `${base}: ${clipped}`;
  }
}
