import assert from "node:assert/strict";
import { test } from "node:test";
import { ArchiveError } from "../lib/archive.ts";
import { routeError } from "../lib/route-error.ts";
import { ApiError } from "../lib/validate.ts";

test("routeError: ApiError maps to its own status/code/message", async () => {
  const res = routeError(new ApiError(400, "invalid_genre", "Unknown genre."));
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string; message: string };
  assert.equal(body.error, "invalid_genre");
  assert.equal(body.message, "Unknown genre.");
});

test("routeError: ArchiveError maps to 502 upstream_error", async () => {
  const res = routeError(new ArchiveError(502, "archive.org request failed"));
  assert.equal(res.status, 502);
  const body = (await res.json()) as { error: string; message: string };
  assert.equal(body.error, "upstream_error");
});

test("routeError: unexpected error maps to 500 internal_error", async () => {
  const res = routeError(new Error("boom"));
  assert.equal(res.status, 500);
  const body = (await res.json()) as { error: string; message: string };
  assert.equal(body.error, "internal_error");
});
