/**
 * Middleware for every request that hits a Pages Function (and, by pass-through, every static
 * asset). Applies the hardened security headers (constitution §6) and per-IP rate limiting on
 * every route that can hit the origin/upstream on a cache miss — /api/*, SSR /movie/*, and
 * /sitemap.xml (specs.md §5). Static assets are served from the CDN and are not throttled.
 * Fail closed: unknown failures become a 500 JSON, never a leak or a crash.
 */
import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../lib/env.ts";
import { jsonResponse } from "../lib/http.ts";
import { isRateLimitedPath, MemoryRateLimiter, rateLimitConfig } from "../lib/ratelimit.ts";

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; " +
    "img-src 'self' data: https://archive.org https://*.archive.org; " +
    "media-src https://archive.org https://*.archive.org; " +
    "frame-src https://archive.org https://*.archive.org; " +
    // connect-src gains archive.org so the <link rel=preconnect> hint to the poster/player
    // host is honored (preconnect is subject to connect-src). The page's own JS never
    // fetches archive.org — all upstream calls are server-side — so this only enables the
    // connection hint, never a data path. Deliberate, documented relaxation (perf pass).
    "connect-src 'self' https://archive.org https://*.archive.org; " +
    "object-src 'none'; base-uri 'self'; form-action 'self'; " +
    "frame-ancestors 'self'; upgrade-insecure-requests",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};

// Lazy-init: env bindings arrive per-request, so the limiter is built from the first
// request's env. Production has no RATE_LIMIT -> the 60/min default; dev/CI raise it via
// `wrangler pages dev --var RATE_LIMIT:...` so the smoke suite never trips the limiter it
// tests (see lib/ratelimit.ts rateLimitConfig).
let limiter: MemoryRateLimiter | null = null;

export const onRequest: PagesFunction<Env> = async (context) => {
  if (!limiter) limiter = new MemoryRateLimiter(rateLimitConfig(context.env.RATE_LIMIT));
  const url = new URL(context.request.url);

  if (isRateLimitedPath(url.pathname)) {
    const ip = context.request.headers.get("CF-Connecting-IP") ?? "unknown";
    if (!limiter.allow(ip)) {
      return jsonResponse(
        { error: "rate_limited", message: "Too many requests. Please wait a moment and try again." },
        429,
      );
    }
  }

  let response: Response;
  try {
    response = await context.next();
  } catch {
    response = jsonResponse(
      { error: "internal_error", message: "Something went wrong. Please try again." },
      500,
    );
  }

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!response.headers.has(name)) {
      response.headers.set(name, value);
    }
  }
  // API responses are data, not pages: keep search engines away from them.
  if (url.pathname.startsWith("/api/") && !response.headers.has("X-Robots-Tag")) {
    response.headers.set("X-Robots-Tag", "noindex");
  }
  // 404 responses (unknown routes, unavailable films, error pages) are failure surfaces,
  // not destinations: header-level noindex here covers every 404 regardless of origin,
  // because the root middleware wraps all requests — including static-asset 404s that
  // never touch a _headers rule (verified live 2026-08-16, docs/cloudflare-headers-research.md:
  // the /404.html rule only matches the literal URL, which 308s away). The in-page meta on
  // the custom 404 page remains as defense in depth.
  if (response.status === 404 && !response.headers.has("X-Robots-Tag")) {
    response.headers.set("X-Robots-Tag", "noindex");
  }
  return response;
};
