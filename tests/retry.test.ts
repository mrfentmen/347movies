/**
 * Unit tests for the archive client's retry policy (lib/archive.ts). These use a mock fetch,
 * so they are fast and deterministic — unlike tests/archive.test.ts which is live integration.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { searchArchive } from "../lib/archive.ts";

const OK_BODY = JSON.stringify({ response: { numFound: 1, docs: [{ identifier: "x", title: "X" }] } });

test("searchArchive retries once on a transient 5xx and succeeds", async () => {
  let calls = 0;
  const mockFetch = async (): Promise<Response> => {
    calls++;
    if (calls === 1) return new Response("Server Error", { status: 503 });
    return new Response(OK_BODY, { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const result = await searchArchive({ page: 1, rows: 1 }, mockFetch as unknown as typeof fetch);
  assert.equal(calls, 2, "exactly one retry");
  assert.equal(result.numFound, 1);
});

test("searchArchive retries once on a network error and succeeds", async () => {
  let calls = 0;
  const mockFetch = async (): Promise<Response> => {
    calls++;
    if (calls === 1) throw new TypeError("socket hang up");
    return new Response(OK_BODY, { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const result = await searchArchive({ page: 1, rows: 1 }, mockFetch as unknown as typeof fetch);
  assert.equal(calls, 2, "exactly one retry");
  assert.equal(result.numFound, 1);
});

test("searchArchive does not retry on 4xx (permanent)", async () => {
  let calls = 0;
  const mockFetch = async (): Promise<Response> => {
    calls++;
    return new Response("Not Found", { status: 404 });
  };
  await assert.rejects(() => searchArchive({ page: 1, rows: 1 }, mockFetch as unknown as typeof fetch));
  assert.equal(calls, 1, "no retry on 404");
});

test("searchArchive fails closed after two 5xx attempts", async () => {
  let calls = 0;
  const mockFetch = async (): Promise<Response> => {
    calls++;
    return new Response("Server Error", { status: 503 });
  };
  await assert.rejects(
    () => searchArchive({ page: 1, rows: 1 }, mockFetch as unknown as typeof fetch),
    /archive.org returned 503/,
  );
  assert.equal(calls, 2, "one retry, then give up");
});

test("searchArchive surfaces invalid JSON as upstream error", async () => {
  const mockFetch = async (): Promise<Response> =>
    new Response("<html>not json</html>", { status: 200, headers: { "Content-Type": "text/html" } });
  await assert.rejects(
    () => searchArchive({ page: 1, rows: 1 }, mockFetch as unknown as typeof fetch),
    /invalid JSON/,
  );
});
