/**
 * Middleware for every request that hits a Pages Function (and, by pass-through, every static
 * asset). Applies the hardened security headers (constitution §6) and per-IP rate limiting on
 * every route that can hit the origin/upstream on a cache miss — /api/*, SSR /movie/*, and
 * /sitemap.xml (specs.md §5). Static assets are served from the CDN and are not throttled.
 * Fail closed: unknown failures become a 500 JSON, never a leak or a crash.
 */
import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../lib/env.ts";
import { AD_CSP_HOSTS, adsenseConfig } from "../lib/ad.ts";
import { jsonResponse } from "../lib/http.ts";
import { isRateLimitedPath, MemoryRateLimiter, rateLimitConfig } from "../lib/ratelimit.ts";

/**
 * The base CSP is strict: only self, plus archive.org for the player/poster/media. When the
 * ad gate is enabled (AD_NETWORK_SCRIPT is the allowlisted AdSense loader with client id
 * and AD_SLOT_IDS is set), the CSP gains exactly the AdSense hosts the loader, ad iframes,
 * and creative assets need (AD_CSP_HOSTS). Dormant = strict, unchanged; enabled = the
 * minimal, documented relaxation (T4.5) — fail-closed on every other host.
 */
function contentSecurityPolicy(env: Env): string {
  let csp =
    "default-src 'self'; script-src 'self'; style-src 'self'; " +
    "img-src 'self' data: https://archive.org https://*.archive.org; " +
    // media-src gains 'self' ONLY for the native player's caption track: /api/subtitle is
    // a same-origin text proxy (archive.org sends no CORS headers, so a cross-origin track
    // can't render). It is archive.org-derived caption text — never stored media — so the
    // constitution §7 / vow 4 "$0 storage" rule still holds. No self-hosted video/audio.
    "media-src 'self' https://archive.org https://*.archive.org; " +
    "frame-src https://archive.org https://*.archive.org; " +
    // connect-src gains archive.org so the <link rel=preconnect> hint to the poster/player
    // host is honored (preconnect is subject to connect-src). The page's own JS never
    // fetches archive.org — all upstream calls are server-side — so this only enables the
    // connection hint, never a data path. Deliberate, documented relaxation (perf pass).
    "connect-src 'self' https://archive.org https://*.archive.org; " +
    "object-src 'none'; base-uri 'self'; form-action 'self'; " +
    "frame-ancestors 'self'; upgrade-insecure-requests";
  if (adsenseConfig(env.AD_NETWORK_SCRIPT, env.AD_SLOT_IDS) !== null) {
    csp = csp
      .replace("script-src 'self'", `script-src 'self' ${AD_CSP_HOSTS.script.join(" ")}`)
      .replace(
        "img-src 'self' data: https://archive.org https://*.archive.org",
        `img-src 'self' data: https://archive.org https://*.archive.org ${AD_CSP_HOSTS.img.join(" ")}`,
      )
      .replace(
        "frame-src https://archive.org https://*.archive.org",
        `frame-src https://archive.org https://*.archive.org ${AD_CSP_HOSTS.frame.join(" ")}`,
      )
      .replace(
        "connect-src 'self' https://archive.org https://*.archive.org",
        `connect-src 'self' https://archive.org https://*.archive.org ${AD_CSP_HOSTS.connect.join(" ")}`,
      );
  }
  // YouTube short-film embeds (/shortfilms): only when YOUTUBE_API_KEY is configured does
  // the page render embeds, and only then do the privacy-enhanced player (youtube-nocookie)
  // and its thumbnails (i.ytimg.com) need CSP allowance. Dormant = strict, unchanged —
  // same pattern as the ad relaxation above.
  if (env.YOUTUBE_API_KEY) {
    csp = csp
      .replace(
        "img-src 'self' data: https://archive.org https://*.archive.org",
        "img-src 'self' data: https://archive.org https://*.archive.org https://i.ytimg.com",
      )
      .replace(
        "frame-src https://archive.org https://*.archive.org",
        "frame-src https://archive.org https://*.archive.org https://www.youtube-nocookie.com https://www.youtube.com",
      );
  }
  return csp;
}

function securityHeaders(env: Env): Record<string, string> {
  return {
    "Content-Security-Policy": contentSecurityPolicy(env),
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    // COOP same-origin: isolates this site's top-level browsing context from any
    // cross-origin opener (no popup flows exist — all target=_blank links carry
    // rel=noopener; the archive.org player is an iframe, unaffected). Hardens
    // against cross-origin window tampering / Spectre-style side channels from a
    // malicious opener and keeps window.name from being shared across origins.
    "Cross-Origin-Opener-Policy": "same-origin",
};
}

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

  for (const [name, value] of Object.entries(securityHeaders(context.env))) {
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
