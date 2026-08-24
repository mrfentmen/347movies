#!/usr/bin/env node
/**
 * 347movies — post-deploy warm-up (dependency-free, Node 18+).
 *
 * After a deploy, hits the site's most valuable URLs so the edge cache and the in-isolate
 * catalog/metadata caches are warm before real viewers arrive. Bounded and gentle: a fixed
 * set of pages, a bounded number of real movie pages (identifiers taken from the live
 * catalog, never guessed), and a couple of popular search queries — paced, with a timeout.
 * Fail-soft: warm-up problems are warnings, never a hard failure — the smoke suite is the
 * real gate; this is an optimization and a popular-page probe.
 *
 *   node scripts/warmup.mjs                             # canonical, defaults
 *   node scripts/warmup.mjs --base http://127.0.0.1:8787
 *   node scripts/warmup.mjs --movies 3 --pace 600
 *
 * Exit 0 always (a partial warm is still useful).
 */

const BASE = (process.env.WARMUP_BASE_URL || "https://347movies.pages.dev").replace(/\/$/, "");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith("--") ? fallback : v;
}

const MOVIES = Number(arg("movies", 8));
const PACE_MS = Number(arg("pace", 400));
const TIMEOUT_MS = 60_000;

const PAGES = [
  "/",
  "/browse",
  "/browse?genre=film-noir",
  "/browse?decade=1920",
  "/browse?tv=1",
  "/search?q=noir",
  "/watchlist",
  "/about",
  "/privacy",
  "/terms",
  "/advertise",
  "/sitemap.xml",
  "/api/health",
  "/api/ad-config",
  "/api/browse?films=1&sort=recent&page=1",
  "/api/browse?from=2000&to=2020&films=1&sort=recent&page=1",
  "/api/browse?q=dubbed+subtitled+kung+shaolin+wong&films=1&sort=recent&page=1",
  "/api/browse?tv=1&sort=recent&page=1",
  "/api/browse?tv=1&decade=1960&sort=newest&page=1",
  "/documentaries",
  "/ted",
  "/sports",
  "/shorts",
  "/silents",
  "/publictv",
  "/science",
  "/govfilms",
  "/audiobooks",
  "/records",
  "/ephemera",
  "/space",
  "/footage",
  "/wwii",
  "/newsreels",
  "/shortfilms",
  // Warming page 1 of each new video pool pre-builds its catalog index (one archive.org
  // fetch per pool) so the first real visitor to the home sections or pool pages never
  // pays the cold-index build on the request path.
  "/api/browse?documentaries=1&sort=recent&page=1",
  "/api/browse?ted=1&sort=recent&page=1",
  "/api/browse?sports=1&sort=recent&page=1",
  "/api/browse?shorts=1&sort=recent&page=1",
  "/api/browse?silents=1&sort=recent&page=1",
  "/api/browse?publictv=1&sort=recent&page=1",
  "/api/browse?science=1&sort=recent&page=1",
  "/api/browse?govfilms=1&sort=recent&page=1",
  "/api/browse?audiobooks=1&sort=recent&page=1",
  "/api/browse?records=1&sort=recent&page=1",
  "/api/browse?ephemera=1&sort=recent&page=1",
  "/api/browse?space=1&sort=recent&page=1",
  "/api/browse?footage=1&sort=recent&page=1",
  "/api/browse?wwii=1&sort=recent&page=1",
  "/api/browse?newsreels=1&sort=recent&page=1",
  "/api/youtube?q=short+film",
];

// OTR/music browse warms the audio-card enrichment (per-identifier metadata): without it,
// the first visitor to a cold page pays the per-item fetch cost (measured 14.2s on a
// degraded archive.org day). Pre-fill the first AUDIO_DEPTH pages of each pool — the home
// sections, /otr and /music, and the realistic first few screens of browsing. Fail-soft
// like everything else here: a slow pool just warms fewer pages.
const AUDIO_DEPTH = 5;
const AUDIO_PAGES = [];
for (let page = 1; page <= AUDIO_DEPTH; page++) {
  AUDIO_PAGES.push(`/api/browse?otr=1&sort=recent&page=${page}`, `/api/browse?music=1&sort=recent&page=${page}`, `/api/browse?audiobooks=1&sort=recent&page=${page}`, `/api/browse?records=1&sort=recent&page=${page}`);
}

const SEARCH_PAGES = [
  "/api/search?q=twilight+zone&tv=1&page=1",
  "/api/search?q=noir&films=1&page=1",
  "/api/search?q=caligari&films=1&page=1",
];

PAGES.push(...AUDIO_PAGES, ...SEARCH_PAGES);

async function warm(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(BASE + path, { signal: controller.signal });
    const ms = Date.now() - started;
    console.log(`  ${res.status}  ${path}  (${ms}ms)`);
    return res.ok;
  } catch (err) {
    console.warn(`  WARN  ${path} — ${err.message}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function sleep(ms) {
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(`347movies warm-up → ${BASE} (${MOVIES} movie pages, pace ${PACE_MS}ms)`);

  let ok = 0;
  let failed = 0;

  // 1) Fixed pages + APIs.
  for (const path of PAGES) {
    if (await warm(path)) ok += 1;
    else failed += 1;
    await sleep(PACE_MS);
  }

  // 2) Real movie pages: identifiers come from the live films-only catalog, never guesses.
  let ids = [];
  try {
    const res = await fetch(`${BASE}/api/browse?films=1&sort=recent&page=1`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) {
      const body = await res.json();
      ids = (body.results || []).slice(0, MOVIES).map((r) => r.identifier).filter(Boolean);
    }
  } catch {
    /* the browse call above already reported; movie warming is skipped */
  }
  if (ids.length === 0) {
    console.log("  (no movie identifiers available — movie pages not warmed)");
  }
  for (const id of ids) {
    if (await warm(`/movie/${encodeURIComponent(id)}`)) ok += 1;
    else failed += 1;
    await sleep(PACE_MS);
  }

  console.log(`\ndone: ${ok} warmed, ${failed} failed (fail-soft — check the smoke suite for the real gate).`);
}

main().catch((err) => {
  console.error(`warm-up failed: ${err.message}`);
  process.exit(1);
});
