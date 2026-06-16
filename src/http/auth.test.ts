import type { NextFunction, Request, Response } from "express";
import { describe, expect, it } from "vitest";
import { createBearerAuthMiddleware } from "./auth.js";

const TOKEN = "s3cret-token";

type FakeResponse = Response & { statusCode: number; body: unknown };

function buildFakeResponse(): FakeResponse {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as FakeResponse;
}

function runMiddleware(authorization: string | undefined): {
  res: FakeResponse;
  nextCalled: boolean;
} {
  const req = { headers: { authorization } } as unknown as Request;
  const res = buildFakeResponse();
  let nextCalled = false;
  const next: NextFunction = () => {
    nextCalled = true;
  };

  createBearerAuthMiddleware(TOKEN)(req, res, next);

  return { res, nextCalled };
}

describe("createBearerAuthMiddleware", () => {
  it("rejects a request with no Authorization header (401)", () => {
    const { res, nextCalled } = runMiddleware(undefined);

    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });

  it("rejects a non-bearer Authorization header (401)", () => {
    const { res, nextCalled } = runMiddleware(`Basic ${TOKEN}`);

    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });

  it("rejects an empty bearer token (401)", () => {
    const { res, nextCalled } = runMiddleware("Bearer ");

    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });

  it("rejects a wrong token of the SAME length (401)", () => {
    const wrong = "x".repeat(TOKEN.length);
    const { res, nextCalled } = runMiddleware(`Bearer ${wrong}`);

    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });

  it("rejects a wrong token of a DIFFERENT length without throwing (401)", () => {
    const { res, nextCalled } = runMiddleware("Bearer short");

    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });

  it("accepts the correct token and calls next()", () => {
    const { res, nextCalled } = runMiddleware(`Bearer ${TOKEN}`);

    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(0);
  });

  it("never echoes the expected token in the rejection body", () => {
    const { res } = runMiddleware("Bearer wrong");

    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
  });
});
