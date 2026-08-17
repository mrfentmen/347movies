import type { PagesFunction } from "@cloudflare/workers-types";
import { randomFilmIdentifier } from "../../lib/catalog-index.ts";
import type { Env } from "../../lib/env.ts";
import { isNonFilmTitle } from "../../lib/film-policy.ts";
import { resolveSiteUrl } from "../../lib/site-url.ts";
import { headHandler } from "../_head.ts";

/**
 * GET /api/random — 302 redirect to a random catalog film page ("Surprise me").
 *
 * Uniform over the films-only catalog (15,917 films, verified live 2026-08-16)
 * via the shared deep query seam (lib/catalog-index.ts `randomFilmIdentifier`): the same
 * edge-cached index /api/browse reads, no upstream call. The films-only policy is catalog
 * policy: "Surprise me" lands on a feature film, never "Episode 18" or a trailer. If the
 * index is unavailable (fully cold + upstream down), falls back to parsing our own
 * edge-cached sitemap for the movie URLs — still applying the same films-only matcher, so
 * even the degraded path honors the policy. Rate-limited like every /api/* route; noindex
 * via middleware.
 */
export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  // Request-host resolution so a custom domain redirects to itself, not pages.dev.
  const site = resolveSiteUrl(request, env);

  try {
    const chosen = await randomFilmIdentifier();
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
      // Same films-only policy as the primary path: drop trailer/episode titles even on the
      // degraded path (the sitemap lists the full legal union, which includes them).
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
