import type { PagesFunction } from "@cloudflare/workers-types";
import { randomCatalogIdentifier } from "../../lib/catalog-index.ts";
import type { Env } from "../../lib/env.ts";
import { isNonFilmTitle } from "../../lib/film-policy.ts";
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
 * sitemap — which lists only the films union, so the degraded path is a films-only subset
 * (still legal, never guessed). Rate-limited like every /api/* route; noindex via
 * middleware.
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
    // Fallback: parse our own edge-cached sitemap (never hits archive.org when warm).
    try {
      const sitemapRes = await fetch(`${site}/sitemap.xml`, { signal: AbortSignal.timeout(15000) });
      if (!sitemapRes.ok) {
        return new Response(null, { status: 502, headers: { "Cache-Control": "no-store" } });
      }
      const xml = await sitemapRes.text();
      const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
        .map((m) => m[1] as string)
        .filter((u) => u.includes("/movie/"));
      // The sitemap lists only the films union (not the newer pools), so the degraded path
      // is a films-only subset — still legal, still never "Episode 18" or a trailer.
      const films = locs.filter((u) => !isNonFilmTitle(decodeURIComponent(u.split("/").pop() ?? "")));
      if (films.length === 0) {
        return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
      }
      // Normalize the sitemap URL to the resolved origin: the sitemap may be an
      // edge-cached copy from before a SITE_URL change, and every redirect must honor
      // the pinned origin (lib/site-url.ts), not a stale host.
      const chosen = (films[Math.floor(Math.random() * films.length)] as string).replace(
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
