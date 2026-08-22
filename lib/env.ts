/**
 * Shared environment bindings for Pages Functions.
 * Secrets (if ever needed) live only in Cloudflare bindings — never in the browser or the repo.
 */
import type { KVNamespace } from "@cloudflare/workers-types";

export interface Env {
  /** KV namespace caching normalized archive.org results (24h TTL). */
  MOVIES_KV?: KVNamespace;
  /** Optional Amazon Associates tag for disclosed affiliate links. Empty = no affiliate links rendered. */
  AMAZON_TAG?: string;
  /**
   * Optional ad network loader URL (Decision 001, T4.3, enabled per T4.5). Ignored unless
   * it is the allowlisted AdSense loader URL (https://pagead2.googlesyndication.com/…)
   * with a `client=ca-pub-…` param AND AD_SLOT_IDS has at least one valid slot id. Empty =
   * ad loader disabled; the reserved slots keep their note.
   */
  AD_NETWORK_SCRIPT?: string;
  /**
   * Optional AdSense unit ids for the reserved slots, `name=id,name=id` — only the slot
   * names sidebar, sidebar-2, leaderboard, leaderboard-2 are accepted. Empty = disabled.
   */
  AD_SLOT_IDS?: string;
  /**
   * Optional Patreon page URL — renders a second support link on movie pages. Ignored
   * unless it is https on a patreon host (dormant by default, like the affiliate tag).
   */
  PATREON_URL?: string;
  /**
   * Optional YouTube Data API v3 key — enables the CC-filtered short-film search behind
   * /shortfilms (lib/youtube.ts). Dormant until set: /api/youtube returns
   * { enabled: false } and the page shows an honest pending state (same pattern as the
   * ad network). The key is a server-side secret — never rendered to the browser.
   */
  YOUTUBE_API_KEY?: string;
  /** Public site origin used for canonical/OG URLs. */
  SITE_URL?: string;
  /**
   * Optional per-IP rate-limit override (requests per 60s window; positive integer).
   * Absent = the 60/min production default. Dev/CI set it high (e.g. `wrangler pages dev
   * --var RATE_LIMIT:10000`) so the smoke suite — which intentionally issues well over 60
   * rate-limited requests per run — never 429s the very limiter it tests. See
   * lib/ratelimit.ts rateLimitConfig.
   */
  RATE_LIMIT?: string;
}
