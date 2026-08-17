/**
 * UNIT TESTS for the canonical site-URL resolver (lib/site-url.ts).
 *
 * The resolver decides which origin canonicals, og:url, sitemap URLs, JSON-LD and
 * /api/random redirects point at. It must follow the request host (so a custom domain
 * attached in Cloudflare works with zero config), force https for real hosts, keep
 * local dev hosts on http, honor a SITE_URL env override, and fall back to the
 * pages.dev default only when the host is unusable.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SITE_URL, resolveSiteUrl } from "../lib/site-url.ts";

const req = (host: string, proto = "https:") =>
  new Request(`${proto}//${host}/movie/it-1927?smoke=1`);

test("SITE_URL env override wins over everything", () => {
  assert.equal(
    resolveSiteUrl(req("347movies.pages.dev"), { SITE_URL: "https://movies.example.com/" }),
    "https://movies.example.com",
  );
  // Override also wins on a dev host and strips trailing slashes.
  assert.equal(
    resolveSiteUrl(req("127.0.0.1:8787", "http:"), { SITE_URL: "https://movies.example.com" }),
    "https://movies.example.com",
  );
});

test("real hosts resolve from the request origin (custom-domain ready)", () => {
  assert.equal(resolveSiteUrl(req("347movies.pages.dev"), {}), "https://347movies.pages.dev");
  assert.equal(resolveSiteUrl(req("movies.example.com"), {}), "https://movies.example.com");
  // A port is preserved.
  assert.equal(resolveSiteUrl(req("movies.example.com:8443"), {}), "https://movies.example.com:8443");
});

test("local dev hosts keep their own (http) scheme", () => {
  assert.equal(resolveSiteUrl(req("127.0.0.1:8787", "http:"), {}), "http://127.0.0.1:8787");
  assert.equal(resolveSiteUrl(req("localhost:8787", "http:"), {}), "http://localhost:8787");
  // IPv6 loopback is bracketed in hostname and host — must stay a valid URL.
  assert.equal(resolveSiteUrl(req("[::1]:8787", "http:"), {}), "http://[::1]:8787");
});

test("unusable hosts fall back to the pages.dev default — never injected", () => {
  // No dot (can't be a public host) and double dots (invalid DNS) fall back. Hostile
  // values outside the conservative charset can't even reach the resolver: the URL
  // constructor (and Cloudflare's edge, which rejects malformed Host headers with 400)
  // refuses them before we see a Request.
  assert.equal(resolveSiteUrl(req("localhost-xyz"), {}), DEFAULT_SITE_URL);
  assert.equal(resolveSiteUrl(req("a..b"), {}), DEFAULT_SITE_URL);
  assert.throws(() => req('evil.com" onmouseover="x'), TypeError);
  assert.throws(() => req("evil<script>.com"), TypeError);
});
