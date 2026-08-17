import type { Env } from "./env.ts";

/** Last-resort fallback when no env override exists and the request host is unusable. */
export const DEFAULT_SITE_URL = "https://347movies.pages.dev";

/** Local dev hosts keep their own scheme (http); everything else is forced to https. */
const DEV_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Conservative host charset — a spoofed Host header can never inject weird characters. */
const HOST_RE = /^[a-z0-9.-]+$/i;

/**
 * Resolve the canonical site origin for the current request.
 *
 * Priority:
 * 1. An explicit `SITE_URL` env override (wins over everything — use this to pin a
 *    specific origin regardless of the incoming host).
 * 2. The request's own origin — so a custom domain attached in Cloudflare Pages works
 *    with **zero config**: canonicals, `og:url`, sitemap URLs, JSON-LD and `/api/random`
 *    redirects all follow the host the visitor actually used. Real hosts are forced to
 *    https; local dev hosts keep their own scheme.
 * 3. `DEFAULT_SITE_URL` — only when the host fails validation (no dot, or characters
 *    outside the conservative charset).
 *
 * The value is per-response (never stored), but the host is validated anyway: the
 * constitution's security posture (rule §6) means no untrusted input reaches a
 * canonical link, even transiently.
 */
export function resolveSiteUrl(request: Request, env: Pick<Env, "SITE_URL">): string {
  const explicit = env.SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  // Validate against `hostname` (no port); reconstruct with `host` so the port survives.
  const { host, hostname, protocol } = new URL(request.url);
  const hostLower = host.toLowerCase();
  const hostnameLower = hostname.toLowerCase();
  if (DEV_HOSTS.has(hostnameLower)) return `${protocol}//${host}`;
  if (hostnameLower.includes(".") && !hostnameLower.includes("..") && HOST_RE.test(hostnameLower)) {
    return `https://${hostLower}`;
  }

  return DEFAULT_SITE_URL;
}
