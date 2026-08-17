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
