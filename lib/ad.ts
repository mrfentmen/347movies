/**
 * Ad network loader — config gate (Decision 001, task T4.3).
 *
 * Follows the T4.2 affiliate precedent: the mechanism is real and tested, but dormant until
 * a real network is configured. Nothing renders while the allowlist below is empty.
 *
 * Fail-closed: any anomaly (missing/blank value, non-URL, non-https, host not allowlisted)
 * yields `null` — the caller reports "disabled" and the reserved slots keep their note.
 *
 * Enablement is deliberately a REVIEWED CODE CHANGE (T4.5), not a lone env var: adding the
 * network's host here, setting AD_NETWORK_SCRIPT, AND relaxing `script-src` in
 * functions/_middleware.ts + public/_headers all happen in the same reviewed diff, checked
 * against constitution §4 (ads never interrupt the movie) before shipping. The empty
 * allowlist makes "dormant until configured" structural rather than a convention.
 *
 * The "hard timeout" from the decision is satisfied structurally: the client injects an
 * async script (never blocks parsing), and a failed or hanging load leaves the slot's
 * reserved note in place — the fail-closed UI. A removal watchdog is deliberately absent:
 * removing an already-inert tag would only risk layout shift for zero user benefit.
 */
export const AD_NETWORK_ALLOWLIST: readonly string[] = [];

export interface AdConfig {
  scriptUrl: string;
}

/**
 * Validate the AD_NETWORK_SCRIPT env value. `allowlist` is parameterized for tests; the
 * production default is the (currently empty) AD_NETWORK_ALLOWLIST.
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
