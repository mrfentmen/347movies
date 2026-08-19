import type { PagesFunction } from "@cloudflare/workers-types";
import { randomCatalogIdentifier } from "../../lib/catalog-index.ts";
import type { Env } from "../../lib/env.ts";
import { resolveSiteUrl } from "../../lib/site-url.ts";
import { headHandler } from "../_head.ts";

/**
 * GET /api/random — 302 redirect to a random catalog page ("Surprise me").
 *
 * Uniform over all ten pools (films, tv, anime, cartoons, otr, music, documentaries,
 * sports, shorts, silents) via lib/catalog-index.ts `randomCatalogIdentifier`, which reads
 * the same edge-cached indexes /api/browse reads — no upstream call when warm. The films
 * pool keeps its films-only policy (never "Episode 18" or a trailer); the other pools are
 * drawn as browse presents them (episodes/tracks ARE the content). If the index is
 * unavailable (fully cold + upstream down), falls back to parsing our own edge-cached
 * sitemap — which now lists all ten pools, so the degraded path stays uniform over the whole
 * legal catalog (still legal, never guessed). Rate-limited like every /api/* route; noindex
 * via middleware.
 */
export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  // Request-host resolution so a custom domain redirects to itself, not pages.dev.
  const site = resolveSiteUrl(request, env);

  try {
    const chosen = await randomCatalogIdentifier();
    if (chosen === null) {
      return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${site}/movie/${encodeURIComponent(chosen)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    // Fallback: parse our own edge-cached sitemap INDEX, then each sub-sitemap it points at
    // (never hits archive.org when warm). The index lists /sitemap/<pool>.xml per pool, so
    // the degraded path draws uniformly over every legal catalog item — including episodes
    // and tracks, which ARE the content outside the films pool. Every URL is a license-gated
    // item the detail page still verifies.
    try {
      const sitemapRes = await fetch(`${site}/sitemap.xml`, { signal: AbortSignal.timeout(15000) });
      if (!sitemapRes.ok) {
        return new Response(null, { status: 502, headers: { "Cache-Control": "no-store" } });
      }
      const indexXml = await sitemapRes.text();
      const subSitemaps = [...indexXml.matchAll(/<loc>([^<]+\.xml)<\/loc>/g)].map((m) => m[1] as string);
      if (subSitemaps.length === 0) {
        return new Response(null, { status: 502, headers: { "Cache-Control": "no-store" } });
      }
      const locs: string[] = [];
      // Fetch each sub-sitemap (parallel, bounded). A sub-sitemap that fails is skipped —
      // the degraded path only needs SOME valid catalog URLs to pick from.
      const results = await Promise.allSettled(
        subSitemaps.map((sub) =>
          fetch(sub, { signal: AbortSignal.timeout(15000) }).then((r) => r.text()),
        ),
      );
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        for (const m of result.value.matchAll(/<loc>([^<]+)<\/loc>/g)) {
          const u = m[1] as string;
          if (u.includes("/movie/")) locs.push(u);
        }
      }
      if (locs.length === 0) {
        return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
      }
      // Normalize the sitemap URL to the resolved origin: the sitemap may be an
      // edge-cached copy from before a SITE_URL change, and every redirect must honor
      // the pinned origin (lib/site-url.ts), not a stale host.
      const chosen = (locs[Math.floor(Math.random() * locs.length)] as string).replace(
        /^https?:\/\/[^/]+/,
        site,
      );
      return new Response(null, {
        status: 302,
        headers: { Location: chosen, "Cache-Control": "no-store" },
      });
    } catch {
      return new Response(null, { status: 502, headers: { "Cache-Control": "no-store" } });
    }
  }
};

export const onRequestHead = headHandler(onRequestGet);
