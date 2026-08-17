/**
 * Affiliate links (constitution §10, vow 8). Amazon Associates-style links are built only from
 * an env-bound tag (AMAZON_TAG); with no tag configured nothing is generated. Links are always
 * disclosed, always rel="sponsored noopener", and only ever shown for films that are NOT freely
 * watchable — the free watch always comes first. The current catalog policy (legal license
 * required for every film) means no catalog film ever triggers the affiliate slot.
 */
export interface AffiliateLink {
  url: string;
  rel: string;
  disclosure: string;
}

export const AMAZON_TAG_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;
export const AFFILIATE_DISCLOSURE =
  "As an Amazon Associate, 347movies earns from qualifying purchases made through this link.";

export function amazonSearchUrl(title: string, tag: string): string | null {
  const cleanTag = tag.trim();
  if (!AMAZON_TAG_PATTERN.test(cleanTag)) return null;
  const params = new URLSearchParams({ k: title.trim(), tag: cleanTag });
  return `https://www.amazon.com/s?${params.toString()}`;
}

export function affiliateLink(title: string, tag: string | undefined): AffiliateLink | null {
  if (!tag) return null;
  const url = amazonSearchUrl(title, tag);
  if (!url) return null;
  return {
    url,
    rel: "sponsored noopener",
    disclosure: AFFILIATE_DISCLOSURE,
  };
}
