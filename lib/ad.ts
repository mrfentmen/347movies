/**
 * Ad network loader — config gate (Decision 001, task T4.3, enabled per T4.5).
 *
 * Follows the T4.2 affiliate precedent: the mechanism is real and tested, and the chosen
 * network is Google AdSense (the reviewed T4.5 change). It stays dormant until the site
 * owner sets the AD_NETWORK_SCRIPT env binding (the AdSense loader URL with ?client=ca-pub-…)
 * AND AD_SLOT_IDS (the per-slot AdSense unit IDs) — until then the gate yields null, the
 * reserved slots keep their note, and zero third-party code runs.
 *
 * Fail-closed: any anomaly (missing/blank value, non-URL, non-https, host not allowlisted,
 * missing/invalid client id, missing/blank/invalid slot ids) yields `null` — the caller
 * reports "disabled" and the reserved slots keep their note.
 *
 * The client ID is parsed from the loader URL's `client` query param (AdSense format
 * `ca-pub-…`), never taken from a separate env var — one less secret-shaped value to manage,
 * and the public URL would appear in the HTML anyway once enabled.
 *
 * The CSP relaxation that lets the network's script actually run is gated on this same
 * config in functions/_middleware.ts (dynamic) and public/_headers (static, documented
 * tradeoff: the header merely permits the hosts; the client never injects while disabled).
 */
export const AD_NETWORK_ALLOWLIST: readonly string[] = ["pagead2.googlesyndication.com"];

/** The reserved slot names across the site (public/*.html + lib/layout.ts). */
export const AD_SLOT_NAMES = ["sidebar", "sidebar-2", "leaderboard", "leaderboard-2"] as const;
export type AdSlotName = (typeof AD_SLOT_NAMES)[number];

/**
 * The CSP host additions the AdSense loader + ad iframes + creative assets need. Applied
 * only when the ad gate is enabled (middleware) — or statically for static pages (_headers,
 * which cannot be conditional; the client still injects nothing while disabled).
 */
export const AD_CSP_HOSTS = {
  script: ["https://pagead2.googlesyndication.com"],
  frame: [
    "https://googleads.g.doubleclick.net",
    "https://tpc.googlesyndication.com",
    "https://*.googlesyndication.com",
  ],
  img: ["https://*.googlesyndication.com", "https://*.gstatic.com"],
  connect: [
    "https://pagead2.googlesyndication.com",
    "https://googleads.g.doubleclick.net",
    "https://*.googlesyndication.com",
  ],
} as const;

export interface AdConfig {
  scriptUrl: string;
}

export interface AdSenseConfig extends AdConfig {
  /** AdSense publisher id, parsed from the loader URL's `client` param (ca-pub-…). */
  clientId: string;
  /** Reserved slot name -> AdSense unit id (from the AD_SLOT_IDS env binding). */
  slots: Partial<Record<AdSlotName, string>>;
}

/**
 * Validate the AD_NETWORK_SCRIPT env value. `allowlist` is parameterized for tests; the
 * production default is AD_NETWORK_ALLOWLIST (the chosen network's host).
 */
export function adConfig(
  raw: string | null | undefined,
  allowlist: readonly string[] = AD_NETWORK_ALLOWLIST,
): AdConfig | null {
  const value = (raw ?? "").trim();
  if (!value) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (!allowlist.includes(url.host)) return null;

  return { scriptUrl: url.toString() };
}

/**
 * AdSense-specific gate: everything `adConfig` requires, plus a `client` id in the loader
 * URL and at least one valid slot id from AD_SLOT_IDS (`name=id,name=id`). Only the four
 * reserved slot names are accepted; ids are numeric-only (AdSense unit ids). Anything else
 * fails closed to null.
 */
export function adsenseConfig(
  raw: string | null | undefined,
  slotIdsRaw: string | null | undefined,
  allowlist: readonly string[] = AD_NETWORK_ALLOWLIST,
): AdSenseConfig | null {
  const base = adConfig(raw, allowlist);
  if (!base) return null;

  const clientId = new URL(base.scriptUrl).searchParams.get("client") ?? "";
  if (!/^[A-Za-z0-9-]+$/.test(clientId)) return null;

  const slots = parseSlotIds(slotIdsRaw);
  if (Object.keys(slots).length === 0) return null;

  return { ...base, clientId, slots };
}

function parseSlotIds(raw: string | null | undefined): Partial<Record<AdSlotName, string>> {
  const out: Partial<Record<AdSlotName, string>> = {};
  if (!raw) return out;
  for (const part of raw.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const id = part.slice(eq + 1).trim();
    if ((AD_SLOT_NAMES as readonly string[]).includes(name) && /^[0-9]+$/.test(id)) {
      out[name as AdSlotName] = id;
    }
  }
  return out;
}
