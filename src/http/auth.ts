import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { jsonRpcError } from "./json-rpc.js";

/** HTTP status returned when a request fails bearer authentication. */
const HTTP_UNAUTHORIZED = 401;
/** Prefix of an RFC 6750 bearer Authorization header. */
const BEARER_PREFIX = "Bearer ";

/**
 * Hashes a value to a fixed-width SHA-256 digest. Comparing digests keeps the
 * constant-time check safe: timingSafeEqual throws a RangeError on length mismatch,
 * which would otherwise leak the secret's length via the error path.
 *
 * @param value - The string to hash
 * @returns A 32-byte SHA-256 digest buffer
 */
function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * Constant-time string equality via fixed-width SHA-256 digests.
 *
 * @param provided - The candidate value supplied by the caller
 * @param expected - The secret to compare against
 * @returns true when the two strings are byte-for-byte equal
 */
function constantTimeEquals(provided: string, expected: string): boolean {
  return timingSafeEqual(digest(provided), digest(expected));
}

/**
 * Extracts the token from a bearer Authorization header.
 *
 * @param header - The raw Authorization header value (or undefined when absent)
 * @returns The token, or null when the header is missing/malformed/empty
 */
function extractBearerToken(header: string | undefined): string | null {
  if (header === undefined || !header.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length);
  return token.length > 0 ? token : null;
}

/**
 * Builds Express middleware that rejects any request lacking a matching
 * `Authorization: Bearer <token>` header with a 401 JSON-RPC error. The token is
 * compared in constant time and never logged or echoed.
 *
 * @param expectedToken - The shared secret required on every request
 * @returns Express middleware enforcing bearer authentication
 */
export function createBearerAuthMiddleware(
  expectedToken: string,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const provided = extractBearerToken(req.headers.authorization);
    if (provided === null || !constantTimeEquals(provided, expectedToken)) {
      res.status(HTTP_UNAUTHORIZED).json(jsonRpcError("Unauthorized"));
      return;
    }
    next();
  };
}
