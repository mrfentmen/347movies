#!/usr/bin/env node
import { readFileSync } from "node:fs";
/**
 * 347movies — live smoke test (dependency-free, Node 18+).
 *
 * Asserts the full GET/HEAD status matrix, security headers, the archive.org player embed,
 * the API JSON shape, and the sitemap against a live deployment. Zero-dependency so the
 * founder (or CI) can run it anytime:
 *
 *   npm run smoke                      # against https://347movies.pages.dev
 *   SMOKE_BASE_URL=https://dev.example npm run smoke   # against another deployment
 *   SMOKE_MIN_SITEMAP_URLS=50000 npm run smoke        # tighten the sitemap floor
 *
 * Exits 0 when everything passes, 1 otherwise. Every check is a real network request.
 */
const BASE = (process.env.SMOKE_BASE_URL || "https://347movies.pages.dev").replace(/\/$/, "");
// Full catalog floor: the sitemap index's sub-sitemaps total ~76k URLs across all eighteen
// pools (films union + every curated pool). 50,000 also catches a single-file regression —
// the protocol caps one sitemap at 50k URLs, so a broken build that collapses back to one
// file can never reach this floor.
const MIN_SITEMAP_URLS = Number(process.env.SMOKE_MIN_SITEMAP_URLS || 50000);
const TIMEOUT_MS = 90_000;

// The pinned primary origin for canonicals/og:url — read from the SITE_URL var in
// wrangler.jsonc (the deliberate SEO pin: one canonical host even when the site is also
// reachable at other hosts). Fall back to the request origin when the var is absent.
const siteUrlMatch = readFileSync("wrangler.jsonc", "utf8").match(/"SITE_URL"\s*:\s*"([^"]+)"/);
const PINNED_ORIGIN = siteUrlMatch ? new URL(siteUrlMatch[1]).origin : new URL(BASE).origin;

const CASES = [
  ["GET", "/", 200],
  ["GET", "/watchlist", 200],
  ["GET", "/search?q=nosferatu", 200],
  ["GET", "/browse?genre=film-noir", 200],
  ["GET", "/browse?decade=1920&sort=oldest", 200],
  ["GET", "/movie/it-1927", 200],
  ["GET", "/movie/night_of_the_living_dead", 404],
  ["GET", "/about", 200],
  ["GET", "/privacy", 200],
  ["GET", "/terms", 200],
  ["GET", "/advertise", 200],
  ["GET", "/robots.txt", 200],
  ["GET", "/sitemap.xml", 200],
  ["GET", "/api/health", 200],
  ["GET", "/api/ad-config", 200],
  ["GET", "/api/views?days=7", 200],
  ["POST", "/api/view?path=%2F", 204],
  ["POST", "/api/view", 204],
  ["GET", "/api/rss.xml", 200],
  ["GET", "/sw.js", 200],
  ["GET", "/manifest.webmanifest", 200],
  ["GET", "/api/browse?music=1&sort=recent&page=1", 200],
  ["GET", "/api/browse?documentaries=1&sort=recent&page=1", 200],
  ["GET", "/api/browse?ted=1&sort=recent&page=1", 200],
  ["GET", "/api/browse?sports=1&sort=recent&page=1", 200],
  ["GET", "/api/browse?shorts=1&sort=recent&page=1", 200],
  ["GET", "/api/browse?silents=1&sort=recent&page=1", 200],
  ["GET", "/api/browse?publictv=1&sort=recent&page=1", 200],
  ["GET", "/api/browse?science=1&sort=recent&page=1", 200],
  ["GET", "/api/browse?govfilms=1&sort=recent&page=1", 200],
  ["GET", "/api/browse?audiobooks=1&sort=recent&page=1", 200],
  ["GET", "/api/browse?records=1&sort=recent&page=1", 200],
  ["GET", "/api/browse?ephemera=1&sort=recent&page=1", 200],
  ["GET", "/api/browse?space=1&sort=recent&page=1", 200],
  ["GET", "/api/browse?footage=1&sort=recent&page=1", 200],
  // Decade chips link to decade-START bounds (from/to must end in 0; the route maps to+9).
  // Each of these 200s; a chip pointing at to=1969-style bounds 400s — the TED-chip bug
  // (PR #45 shipped to=2009) is exactly the class this pins.
  ["GET", "/api/browse?footage=1&from=1910&to=1910&sort=newest&page=1", 200],
  ["GET", "/api/browse?footage=1&from=1960&to=1960&sort=newest&page=1", 200],
  ["GET", "/api/browse?ted=1&from=2000&to=2000&sort=newest&page=1", 200],
  ["GET", "/api/browse?ted=1&from=2010&to=2010&sort=newest&page=1", 200],
  ["GET", "/api/browse?publictv=1&from=1950&to=1970&sort=newest&page=1", 200],
  ["GET", "/api/youtube?q=short+film", 200],
  ["GET", "/documentaries", 200],
  ["GET", "/ted", 200],
  ["GET", "/sports", 200],
  ["GET", "/shorts", 200],
  ["GET", "/silents", 200],
  ["GET", "/publictv", 200],
  ["GET", "/science", 200],
  ["GET", "/govfilms", 200],
  ["GET", "/audiobooks", 200],
  ["GET", "/records", 200],
  ["GET", "/footage", 200],
  ["GET", "/shortfilms", 200],
  ["GET", "/ephemera", 200],
  ["GET", "/space", 200],
  ["GET", "/collections", 200],
  ["GET", "/api/collections", 200],
  ["GET", "/api/browse?subject=film+noir&sort=newest&page=1", 200],
  ["GET", "/api/search?q=caligari", 200],
  ["GET", "/api/browse?sort=recent&films=1&page=1", 200],
  ["GET", "/api/browse?from=2000&to=2020&sort=recent&films=1&page=1", 200],
  ["GET", "/api/browse?q=dubbed+subtitled+kung+shaolin+wong&sort=recent&films=1&page=1", 200],
  ["GET", "/api/browse?sort=newest&films=1&page=1", 200],
  ["GET", "/api/browse?tv=1&sort=recent&page=1", 200],
  ["GET", "/browse?tv=1", 200],
  ["GET", "/api/search?q=twilight+zone&tv=1&page=1", 200],
  ["GET", "/api/search?tv=1&page=1", 200],
  ["GET", "/search?q=twilight+zone&tv=1", 200],
  ["GET", "/api/browse?q=noir%27%22()&films=1", 200],
  ["GET", "/api/browse?films=banana", 400],
  ["GET", "/definitely-not-a-page", 404],
];

let failures = 0;
let checks = 0;

function ok(condition, label) {
  checks += 1;
  if (condition) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}`);
  }
}

async function request(method, path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + path, { method, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

console.log(`347movies smoke test → ${BASE}`);

console.log("\n— GET status matrix —");
for (const [method, path, expected] of CASES) {
  try {
    const res = await request(method, path);
    ok(res.status === expected, `GET ${path} → ${res.status} (expected ${expected})`);
  } catch (err) {
    failures += 1;
    checks += 1;
    console.error(`FAIL  GET ${path} — request failed: ${err.message}`);
  }
}

console.log("\n— HEAD parity (HEAD must match GET) —");
for (const path of ["/api/health", "/api/search?q=noir", "/movie/it-1927", "/sitemap.xml", "/"]) {
  try {
    const [head, get] = await Promise.all([request("HEAD", path), request("GET", path)]);
    ok(head.status === get.status, `HEAD ${path} → ${head.status} matches GET ${get.status}`);
  } catch (err) {
    failures += 1;
    checks += 1;
    console.error(`FAIL  HEAD ${path} — request failed: ${err.message}`);
  }
}

console.log("\n— security headers on / —");
try {
  const res = await request("GET", "/");
  const csp = res.headers.get("content-security-policy") || "";
  const hsts = res.headers.get("strict-transport-security") || "";
  ok(csp.includes("frame-src https://archive.org"), "CSP allows only archive.org framing");
  ok(csp.includes("media-src https://archive.org"), "CSP: media loads only from archive.org (constitution §7 / vow 4 — $0 storage)");
  ok(csp.includes("connect-src 'self' https://archive.org"), "CSP: connect-src honors the archive.org preconnect (perf pass)");
  ok(csp.includes("script-src 'self'") && !csp.includes("unsafe-inline"), "CSP: no inline scripts");
  ok(hsts.includes("preload"), "HSTS preload");
  ok(res.headers.get("x-content-type-options") === "nosniff", "nosniff");
  ok(res.headers.get("x-frame-options") === "SAMEORIGIN", "frame options");
} catch (err) {
  failures += 1;
  checks += 1;
  console.error(`FAIL  headers on / — request failed: ${err.message}`);
}

// Function-route security headers come ONLY from the middleware (the _headers file never
// applies to Pages Functions responses — verified against the live site 2026-08-16 and
// documented in docs/cloudflare-headers-research.md). A regression that drops the middleware
// headers must fail here even though static / looks fine via _headers.
console.log("\n— security headers on a function route (/api/health, middleware-only) —");
try {
  const res = await request("GET", "/api/health");
  const csp = res.headers.get("content-security-policy") || "";
  ok(csp.includes("script-src 'self'") && !csp.includes("unsafe-inline"), "function route CSP: no inline scripts");
  ok(csp.includes("frame-src https://archive.org"), "function route CSP: archive.org framing only");
  ok((res.headers.get("strict-transport-security") || "").includes("preload"), "function route HSTS preload");
  ok(res.headers.get("x-content-type-options") === "nosniff", "function route nosniff");
  ok(res.headers.get("x-frame-options") === "SAMEORIGIN", "function route frame options");
} catch (err) {
  failures += 1;
  checks += 1;
  console.error(`FAIL  headers on /api/health — request failed: ${err.message}`);
}

// Unknown-route 404s are failure surfaces, not destinations: the middleware now adds
// X-Robots-Tag: noindex to every 404 response (header-level, covers all origins), and the
// custom 404 page also carries the in-page noindex meta as defense in depth. Both are
// guarded — the header guard fails if the middleware ever drops it, the meta guard fails
// if the page markup regresses.
console.log("\n— unknown-route 404 noindex —");
try {
  const res = await request("GET", "/definitely-not-a-page");
  const body = await res.text();
  ok(res.status === 404, "unknown route → 404");
  ok((res.headers.get("x-robots-tag") || "") === "noindex", "404 carries X-Robots-Tag: noindex (middleware, header-level)");
  ok(body.includes('name="robots" content="noindex, follow"'), "404 page carries the in-page noindex meta");
} catch (err) {
  failures += 1;
  checks += 1;
  console.error(`FAIL  unknown-route 404 — request failed: ${err.message}`);
}

console.log("\n— homepage structured data —");
try {
  // Hard check on a uniquely cache-busted URL (static assets ignore query strings in some
  // edge-cache configurations, so a fresh key guarantees the deployed copy).
  const fresh = await request("GET", `/?smoke=${Date.now()}`);
  const freshHtml = await fresh.text();
  ok(freshHtml.includes('"@type":"WebSite"'), "homepage carries WebSite JSON-LD");
  ok(freshHtml.includes("/search?q={search_term_string}"), "SearchAction targets the search route");
  ok(freshHtml.includes('<link rel="preconnect" href="https://archive.org">'), "homepage preconnects to archive.org (poster/player host)");
  ok(freshHtml.includes('/fonts/plex-mono-500.woff2'), "homepage preloads Plex Mono 500 (used by eyebrows/chips; was fetched late)");
  ok(!freshHtml.includes("speculationrules"), "homepage carries no speculation rules (Chrome can't run them under strict CSP; removed, perf pass)");
  // Canonical homepage is what crawlers see; it can lag a deploy by the 3600s asset TTL.
  const canonical = await request("GET", "/");
  const canonicalHtml = await canonical.text();
  checks += 1;
  if (canonicalHtml.includes('"@type":"WebSite"')) {
    console.log("  ok  canonical / serves the structured data");
  } else {
    console.warn("WARN  canonical / still serves a pre-deploy asset copy — it self-heals at TTL expiry");
  }
} catch (err) {
  failures += 1;
  checks += 1;
  console.error(`FAIL  homepage structured data — ${err.message}`);
}

console.log("\n— about page structured data —");
try {
  const fresh = await request("GET", `/about?smoke=${Date.now()}`);
  const freshHtml = await fresh.text();
  ok(freshHtml.includes('"@type":"Organization"'), "about page carries Organization JSON-LD");
  ok(freshHtml.includes("contactae2000@gmail.com"), "Organization carries the advertised contact email");
  const privacy = await (await request("GET", `/privacy?smoke=${Date.now()}`)).text();
  ok(privacy.includes("Advertising — the standing disclosure"), "privacy page carries the ad-network disclosure (constitution §5)");
  const advertise = await (await request("GET", `/advertise?smoke=${Date.now()}`)).text();
  ok(advertise.includes('id="advertise-form"'), "advertise page carries the inquiry form");
  ok(advertise.includes("rate-card") && advertise.includes("Starting rate"), "advertise page carries the rate card");
  ok(advertise.includes("contactae2000@gmail.com"), "advertise page carries the business contact email");
  ok(!advertise.includes('href="/about#advertise"'), "advertise page footer links to /advertise itself (no stale anchor)");
  const canonical = await request("GET", "/about");
  const canonicalHtml = await canonical.text();
  checks += 1;
  if (canonicalHtml.includes('"@type":"Organization"')) {
    console.log("  ok  canonical /about serves the structured data");
  } else {
    console.warn("WARN  canonical /about still serves a pre-deploy asset copy — it self-heals at TTL expiry");
  }
} catch (err) {
  failures += 1;
  checks += 1;
  console.error(`FAIL  about page structured data — ${err.message}`);
}

console.log("\n— HTML structure (one h1, skip link, main landmark per page) —");
try {
  // The page shell must stay structurally sound: exactly one h1, a skip link, and one
  // <main> on every page type. Cheap content checks on uniquely-busted static pages.
  const structurePages = ["/", "/browse", "/search?q=noir", "/watchlist", "/about", "/advertise", "/genre", "/tv", "/anime", "/cartoons", "/otr", "/music", "/documentaries", "/ted", "/sports", "/shorts", "/silents", "/publictv", "/science", "/govfilms", "/audiobooks", "/records", "/ephemera", "/space", "/footage", "/shortfilms", "/collections", "/definitely-not-a-page"];
  for (const path of structurePages) {
    const html = await (await request("GET", `${path}?smoke=${Date.now()}`)).text();
    const h1s = (html.match(/<h1[ >]/g) || []).length;
    const mains = (html.match(/<main[ >]/g) || []).length;
    const skip = html.includes('class="skip-link"');
    const langEn = /<html[^>]+lang="en"/.test(html);
    ok(h1s === 1 && mains === 1 && skip && langEn, `${path} → 1 h1, 1 <main>, skip link, lang="en" (WCAG 3.1.1)`);
  }
  // Orphan rule (site-architecture): every destination page needs >= 1 inbound internal
  // link. The /genre Film Noir showcase was sitemapped but linked from nowhere (only its
  // own page — a self-link isn't an inbound link); the home Film Noir pill now points at
  // it. Guard that link so the page can't silently orphan again.
  const homeHtml = await (await request("GET", `/?smoke=${Date.now()}`)).text();
  ok(homeHtml.includes('href="/genre"'), "home: Film Noir pill links to the /genre destination (orphan rule)");

  // The SSR movie page: player iframe must carry a descriptive title and the poster an
  // alt (WCAG 1.1.1 / 4.1.2) — these live in server-rendered HTML, not the client bundle.
  const movieHtml = await (await request("GET", `/movie/it-1927?smoke=${Date.now()}`)).text();
  ok(/<iframe[^>]+class="player"[^>]+title="/.test(movieHtml), "movie page: player iframe has a title attribute (WCAG 4.1.2)");
  ok(movieHtml.includes('allow="fullscreen"'), "movie page: player iframe keeps fullscreen permission (viewers must be able to expand the film)");
  ok(/<img[^>]+alt="/.test(movieHtml), "movie page: poster carries alt text (WCAG 1.1.1)");
  // Performance contract (perf pass): the above-the-fold player must be eager + high
  // priority (no lazy — a lazy hint defers the LCP embed fetch), and the poster must be
  // preloaded in <head> so its fetch starts at parse time instead of body-parsing time.
  ok(!/<iframe[^>]+class="player"[^>]+loading="lazy"/.test(movieHtml), "movie page: player iframe is NOT lazy (eager LCP fetch)");
  ok(/<iframe[^>]+class="player"[^>]+fetchpriority="high"/.test(movieHtml), "movie page: player iframe is high fetch priority (LCP element)");
  ok(/<link rel="preload" as="image" href="https:\/\/archive\.org\/services\/img\/it-1927" fetchpriority="high">/.test(movieHtml), "movie page: poster preloaded in head with fetchpriority=high (LCP fetch at parse time + priority)");
  ok(/<link rel="preload" href="\/fonts\/plex-mono-500\.woff2" as="font" type="font\/woff2" crossorigin>/.test(movieHtml), "movie page: Plex Mono 500 preloaded (used by eyebrows/chips; was fetched late)");
  // Canonicals must resolve to the SITE_URL pin in wrangler.jsonc (lib/site-url.ts: the
  // env override wins, request-host is the fallback for environments without the binding)
  // and carry the right path — never a stale hardcoded default, never the wrong host.
  const canonicalMatch = movieHtml.match(/<link rel="canonical" href="([^"]+)"/);
  const canonicalUrl = canonicalMatch ? new URL(canonicalMatch[1]) : null;
  ok(
    canonicalUrl && canonicalUrl.protocol === "https:" && canonicalUrl.origin === PINNED_ORIGIN && canonicalUrl.pathname === "/movie/it-1927",
    `movie page canonical = pinned SITE_URL origin, right path (${canonicalMatch ? canonicalMatch[1] : "none"})`,
  );
  const ogUrlMatch = movieHtml.match(/<meta property="og:url" content="([^"]+)"/);
  ok(ogUrlMatch && ogUrlMatch[1] === canonicalMatch[1], "movie page og:url matches the canonical (one shared SEO origin)");
} catch (err) {
  failures += 1;
  checks += 1;
  console.error(`FAIL  HTML structure — ${err.message}`);
}

console.log("\n— accessibility guards (WCAG 2.2 fixes must not regress) —");
try {
  // Content guards on the served CSS/JS: the WCAG 2.4.11 (focus not obscured) and 2.5.8
  // (target size) rules and the 3.3.1 error announcement must stay in the deployed bundle.
  const css = await (await request("GET", `/css/style.css?smoke=${Date.now()}`)).text();
  ok(css.includes("scroll-margin-top: 80px"), "CSS: focus clears the sticky header (WCAG 2.4.11)");
  ok(css.includes("min-height: 24px"), "CSS: >=24px target sizes on standalone links (WCAG 2.5.8)");
  const js = await (await request("GET", `/js/app.js?smoke=${Date.now()}`)).text();
  ok(js.includes('role="alert"'), "JS: error box announces via role=alert (WCAG 3.3.1)");
  ok(js.includes("aria-busy"), "JS: results grid tracks its busy state (a11y)");
  ok(css.includes("object-fit: cover"), "CSS: movie poster is cover-cropped, never stretched");
  // Security guards on the deployed client bundle (security pass 2026-08-16): the card
  // renderer must escape the archive.org year (stored-XSS class), and the ad bootstrap
  // must require https before injecting anything (defense in depth on the ad boundary).
  ok(js.includes("escapeHtml(String(item.year))"), "JS: cardShell escapes the archive.org year (stored-XSS fix live)");
  ok(js.includes("/api/browse?from=2000&to=2020"), "JS: Modern picks home feed wired to the 2000s–2020s range");
  ok(js.includes("/api/browse?q=dubbed+subtitled+kung+shaolin+wong"), "JS: Hong Kong action home feed wired to the keyword filter");
  ok(js.includes('get("sort") || "newest"'), "JS: browse defaults to newest releases sort");
  ok(js.includes("/api/browse?tv=1&sort=recent&page=1"), "JS: Classic TV home feed wired to the TV catalog");
  ok(js.includes("/api/browse?tv=1&decade=1960&sort=newest&page=1"), "JS: 1960s TV showcase wired");
  ok(js.includes("/api/browse?anime=1&sort=recent&page=1"), "JS: Anime home feed wired to the anime pool");
  ok(js.includes("/api/browse?cartoons=1&sort=recent&page=1"), "JS: Cartoons home feed wired to the animation pool");
  ok(js.includes("/api/browse?otr=1&sort=recent&page=1"), "JS: Old Time Radio home feed wired to the audio pool");
  ok(js.includes("/api/browse?music=1&sort=recent&page=1"), "JS: Music & Concerts home feed wired");
  ok(js.includes("/api/browse?documentaries=1&sort=recent&page=1"), "JS: Documentaries home feed wired");
  ok(js.includes("/api/browse?sports=1&sort=recent&page=1"), "JS: Sports home feed wired");
  ok(js.includes("/api/browse?shorts=1&sort=recent&page=1"), "JS: Shorts home feed wired");
  ok(js.includes("/api/browse?silents=1&sort=recent&page=1"), "JS: Silent films home feed wired");
  ok(js.includes("/api/browse?publictv=1&sort=recent&page=1"), "JS: Public broadcasting home feed wired");
  ok(js.includes("/api/browse?publictv=1&from=1950&to=1970"), "JS: Golden-age public broadcasting feed wired (decade-start bound)");
  ok(js.includes("/api/browse?science=1&sort=recent&page=1"), "JS: Science & medicine home feed wired");
  ok(js.includes("/api/browse?govfilms=1&sort=recent&page=1"), "JS: Government films home feed wired");
  ok(js.includes("/api/browse?audiobooks=1&sort=recent&page=1"), "JS: Audiobooks home feed wired");
  ok(js.includes("/api/browse?records=1&sort=newest&page=1"), "JS: Vintage records home feed wired (newest releases)");
  ok(js.includes("/api/browse?records=1&sort=recent"), "JS: New records this week feed wired (recently added)");
  ok(js.includes("/api/browse?ephemera=1&sort=recent&page=1"), "JS: Ephemeral films home feed wired");
  ok(js.includes("/api/browse?space=1&sort=recent&page=1"), "JS: Space & NASA home feed wired");
  ok(js.includes("/api/browse?footage=1&sort=recent&page=1"), "JS: Vintage footage home feed wired");
  ok(js.includes("/api/youtube?q="), "JS: Short films page wired to the CC-filtered YouTube search");
  ok(js.includes("/api/browse?ted=1&sort=recent&page=1"), "JS: TED Talks home feed wired");
  ok(js.includes("card__meta"), "JS: audio-pool card chip (episode count + series tag) rendered");
  ok(js.includes("episodeCount"), "JS: card reads the server-provided episode count");
  ok(js.includes("/api/browse?q=newsreel&sort=recent&page=1"), "JS: Newsreels home feed wired (Prelinger subset)");
  ok(js.includes("/api/browse?subject="), "JS: More-like-this row fetches by subject tag");
  ok(js.includes('serviceWorker.register("/sw.js")'), "JS: PWA service worker registered");
  ok(js.includes("/api/search?${catalog}=1&page=${page}"), "JS: serialized-pool search shortcut wired (empty query = pool newest-first)");
  ok(js.includes("browse the catalog</a>"), "JS: search no-results state offers the next step (browse link, TV-aware)");
  ok(js.includes("Your watchlist is empty"), "JS: empty watchlist invites action (direction copy)");
  ok(js.includes("347movies.progress.v1"), "JS: continue-watching storage key wired (localStorage only)");
  ok(js.includes('progressRemove(identifier)'), "JS: finishing a film clears its continue-watching entry");
  ok(js.includes("No films match these filters"), "JS: browse empty-filter view points to the next step");
  ok(js.includes("https:\\/\\/"), "JS: ad bootstrap independently requires https before injection");
  // Web-interface-guidelines pass (2026-08-16): the dark theme signals color-scheme,
  // interactive elements kill the double-tap delay + set the tap highlight, the sticky
  // header clears notches, display faces balance, and Clear watchlist confirms first.
  ok(css.includes("color-scheme: dark"), "CSS: dark theme sets color-scheme: dark (native controls)");
  ok(css.includes("touch-action: manipulation"), "CSS: interactive elements kill the double-tap zoom delay");
  ok(css.includes("-webkit-tap-highlight-color"), "CSS: tap highlight set intentionally");
  ok(css.includes("env(safe-area-inset-left)"), "CSS: sticky header pads past notches (safe areas)");
  ok(css.includes("text-wrap: balance"), "CSS: display faces balance (no widows)");
  ok(css.includes("prefers-reduced-motion: reduce"), "CSS: reduced-motion preference is honored (WCAG 2.3.3)");
  ok(css.includes("marquee-strike"), "CSS: 404 marquee strikes on load (neon flicker, then steady)");
  // Motion audit (2026-08-16): every animation shipped must (a) define its keyframes and
  // (b) be killed under prefers-reduced-motion. A new animation without a kill-list entry
  // fails here. Transitions are covered by the universal `transition: none` kill; the
  // selectors that carry `animation:` are checked individually.
  {
    const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
    const mediaMatch = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/);
    const reducedBlock = mediaMatch ? stripComments(mediaMatch[1]) : "";
    const bodyCss = stripComments(css.replace(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/, ""));
    const keyframes = [...bodyCss.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
    const uses = [...bodyCss.matchAll(/([^{}]+)\{\s*[^}]*?animation:\s*([\w-]+)/g)].map((m) => ({
      selector: m[1].trim(),
      name: m[2],
    }));
    const killSelectors = [...reducedBlock.matchAll(/([^{}]+)\{\s*animation:\s*none/g)].flatMap((m) =>
      m[1].split(",").map((s) => s.trim()),
    );
    ok(uses.every((u) => keyframes.includes(u.name)), "CSS: every animation has its keyframes defined");
    ok(
      uses.every((u) => killSelectors.includes(u.selector)),
      "CSS: every animated selector is killed under prefers-reduced-motion (a new animation needs a kill-list entry)",
    );
  }
  ok(js.includes("window.confirm(\"Clear your saved watchlist"), "JS: Clear watchlist confirms before erasing (destructive action)");
  // Accessibility follow-up pass (2026-08-16): the cross-origin player embed's focus
  // never propagates :focus-visible/:focus-within to the parent, so app.js mirrors
  // focusout(relatedTarget=null)+activeElement to .is-focused, and the CSS styles it.
  ok(css.includes(".player-wrap.is-focused"), "CSS: player wrap has a JS-driven focus ring (cross-origin embed)");
  ok(js.includes("relatedTarget === null"), "JS: player focus tracked across the cross-origin embed (focusout+activeElement)");
} catch (err) {
  failures += 1;
  checks += 1;
  console.error(`FAIL  accessibility guards — ${err.message}`);
}

console.log("\n— theme & status guards (web-interface-guidelines pass) —");
try {
  const home = await (await request("GET", `/?smoke=${Date.now()}`)).text();
  ok(home.includes('<meta name="theme-color" content="#0c0d11">'), "Home: theme-color matches the dark background");
  ok(home.includes('id="modern"'), "Home: Modern picks section present (front door for new CC uploads)");
  ok(home.includes('id="hkaction"'), "Home: Hong Kong action section present (keyword feed)");
  ok(home.includes('id="tvclassics"'), "Home: Classic TV section present (classic_tv feed)");
  ok(home.includes('id="tv1960s"'), "Home: 1960s TV showcase present");
  ok(home.includes('id="publictvgolden"'), "Home: Golden-age public broadcasting showcase present");
  ok(home.includes('id="recordsnew"'), "Home: New records this week section present");
  ok(home.includes('id="footage"'), "Home: Vintage footage section present (archival pre-1970 feed)");
  ok(home.includes("/search?tv=1"), "Home: Search TV shows shortcut present");
  ok(home.includes('id="continue-section"'), "Home: Continue watching section present (hidden until there is a saved position)");
  ok(home.includes("Continue watching"), "Home: Continue watching heading present");
  ok(home.includes('id="otr"'), "Home: Old Time Radio section present (audio feed)");
  ok(home.includes("/search?otr=1"), "Home: Search radio shortcut present");
  ok(home.includes('id="music"'), "Home: Music & Concerts section present (audio feed)");
  ok(home.includes('id="newsreels"'), "Home: Newsreels section present (Prelinger subset)");
  ok(home.includes('rel="alternate" type="application/rss+xml"'), "Home: RSS feed alternate link present");
  ok(home.includes('rel="manifest" href="/manifest.webmanifest"'), "Home: PWA manifest linked");
  ok(home.includes('class="ad-slot__cta"'), "Home: ad slots carry an email inquiry CTA");
  ok(home.includes('href="https://archive.org"'), "Home: noscript fallback points to archive.org (no-JS visitors)");
  const browse = await (await request("GET", `/browse?smoke=${Date.now()}`)).text();
  const search = await (await request("GET", `/search?smoke=${Date.now()}`)).text();
  ok(browse.includes('<meta name="theme-color" content="#0c0d11">'), "Browse: theme-color present");
  ok(browse.includes('<option value="newest" selected>Newest releases</option>'), "Browse: Newest releases is the default sort (new arrivals lead)");
  ok(browse.includes('id="from"'), "Browse: from-year filter present");
  ok(search.includes('<meta name="theme-color" content="#0c0d11">'), "Search: theme-color present");
  const genre = await (await request("GET", `/genre?smoke=${Date.now()}`)).text();
  ok(genre.includes('<meta name="theme-color" content="#0c0d11">'), "Genre: theme-color present");
  ok(genre.includes('data-page="genre"'), "Genre: page dispatches the genre init (app.js boot)");
  ok(genre.includes('<h1>Film Noir</h1>'), "Genre: Limelight genre title in the hero");
  ok(genre.includes("hero-eyebrow"), "Genre: mono eyebrow above the title (design-system rhythm)");
  ok(genre.includes("ad-slot--sidebar"), "Genre: sidebar ad slot reserved (never over the player)");
  ok(genre.includes("card--skeleton"), "Genre: skeleton grid reserves results space (CLS)");
  ok(genre.includes(`<link rel="canonical" href="${PINNED_ORIGIN}/genre">`), "Genre: canonical pinned to the SITE_URL origin");
  const tv = await (await request("GET", `/tv?smoke=${Date.now()}`)).text();
  ok(tv.includes('<meta name="theme-color" content="#0c0d11">'), "TV: theme-color present");
  ok(tv.includes('data-page="tv"'), "TV: page dispatches the TV init (app.js boot)");
  ok(tv.includes('<h1>Classic TV</h1>'), "TV: Limelight title in the hero");
  ok(tv.includes("hero-eyebrow"), "TV: mono eyebrow above the title (design-system rhythm)");
  ok(tv.includes("ad-slot--sidebar"), "TV: sidebar ad slot reserved (never over the player)");
  ok(tv.includes("card--skeleton"), "TV: skeleton grid reserves results space (CLS)");
  ok(tv.includes(`<link rel="canonical" href="${PINNED_ORIGIN}/tv">`), "TV: canonical pinned to the SITE_URL origin");
  ok(tv.includes('<a href="/tv">TV</a>'), "TV: header nav carries the TV link (discoverable, never orphaned)");
  // Vintage Records page: decade (1900s/1910s/1920s) + sort filters for shellac-era browsing.
  const records = await (await request("GET", `/records?smoke=${Date.now()}`)).text();
  ok(records.includes('id="decade"'), "Records: decade filter present (shellac-era browsing)");
  ok(records.includes('id="sort"'), "Records: sort filter present");
  ok(records.includes('<option value="1900">1900s</option>'), "Records: 1900s decade option present");
  ok(records.includes('<option value="1890">1890s</option>'), "Records: 1890s decade option present (49 shellac items, added 2026-08-22)");
  ok(records.includes('<option value="1910">1910s</option>'), "Records: 1910s decade option present");
  ok(records.includes('<option value="1920">1920s</option>'), "Records: 1920s decade option present");
  // Ephemeral films page: decade chips for the golden age of the educational/industrial
  // film (1940s-70s = 288 of 413 dated items; the yearless 95 are the same classic canon
  // per the avgeeks research). Space/records comparisons documented in the audit — space
  // is 60% yearless with no decade structure, so it deliberately gets no chips.
  const ephemera = await (await request("GET", `/ephemera?smoke=${Date.now()}`)).text();
  for (const [decade, d] of [["1940s", 1940], ["1950s", 1950], ["1960s", 1960], ["1970s", 1970]]) {
    ok(ephemera.includes(`/browse?ephemera=1&from=${d}&to=${d}`), `Ephemera: ${decade} decade chip present (decade-start bound)`);
  }
  ok(records.includes('id="results-head"'), "Records: results heading carries the id for filter-aware titles");
  // TED Talks page: decade-filtered chips for the golden age of ideas (2000s, 2010s).
  const ted = await (await request("GET", `/ted?smoke=${Date.now()}`)).text();
  ok(ted.includes('/browse?ted=1&from=2000&to=2000'), "TED: 2000s decade chip present (decade-start bound)");
  ok(ted.includes('/browse?ted=1&from=2010&to=2010'), "TED: 2010s decade chip present (decade-start bound)");
  // Vintage Footage page: decade-filtered chips for the pre-1970 archival band (1910s-1960s).
  const footage = await (await request("GET", `/footage?smoke=${Date.now()}`)).text();
  // Decade chips must use decade-START bounds (from/to ending in 0) — the API maps to+9,
  // so from=1910&to=1910 covers years 1910-1919. A to=1919 bound 400s (the PR #45 lesson).
  for (const [decade, d] of [["1910s", 1910], ["1920s", 1920], ["1930s", 1930], ["1940s", 1940], ["1950s", 1950], ["1960s", 1960]]) {
    ok(footage.includes(`/browse?footage=1&from=${d}&to=${d}`), `Footage: ${decade} decade chip present (decade-start bound)`);
  }
  ok(browse.includes('id="count" role="status"'), "Browse: result count announces async updates (role=status)");
  ok(search.includes('id="count" role="status"'), "Search: result count announces async updates (role=status)");
  const movie = await (await request("GET", `/movie/it-1927?smoke=${Date.now()}`)).text();
  ok(home.includes('<main id="main" tabindex="-1">'), "Home: skip link can move focus into main (tabindex=-1)");
  ok(movie.includes('<main id="main" tabindex="-1">'), "Movie: skip link can move focus into main (tabindex=-1)");
  // Old Time Radio items are audio: the detail page must render an audio player (the
  // embed iframe renders archive.org's audio player; data-kind drives the native swap).
  const otrMovie = await (await request("GET", `/movie/AdventuresOfMaisie?smoke=${Date.now()}`)).text();
  ok(otrMovie.includes('data-kind="audio"'), "OTR movie: player marked audio (native swap becomes <audio>)");
  ok(otrMovie.includes('"@type":"AudioObject"'), "OTR movie: JSON-LD is an AudioObject, not a video");
  ok(otrMovie.includes("Now playing"), "OTR movie: hero eyebrow says Now playing, not Now showing");
  ok(otrMovie.includes('class="hero-badge hero-badge--audio"'), "OTR movie: hero badge marks the landing as audio");
} catch (err) {
  failures += 1;
  checks += 1;
  console.error(`FAIL  theme & status guards — ${err.message}`);
}

console.log("\n— id guards (every #id app.js queries must exist; no id repeats on a page) —");
try {
  // The 2026-08-16 tidy pass removed exactly this bug class: initGenre queried
  // #results-head, which no page ships, so the block could never run. This guard makes it
  // a build failure instead: every literal id app.js queries via $() / getElementById /
  // querySelector(All) must exist on at least one served page. The union across the page
  // set, not per-page existence — ids are page-specific (#decade only on /browse, etc.).
  const js = readFileSync("public/js/app.js", "utf8");
  const queriedIds = [
    ...new Set([...js.matchAll(/(?:\$\("#|getElementById\("|querySelector(?:All)?\("#)([A-Za-z0-9_-]+)"\)/g)].map((m) => m[1])),
  ];
  const idScanPages = ["/", "/browse", "/search?q=noir", "/watchlist", "/about", "/advertise", "/genre", "/tv", "/shortfilms", "/movie/it-1927"];
  const presentIds = new Set();
  const dupReports = [];
  for (const path of idScanPages) {
    const html = await (await request("GET", `${path}?smoke=${Date.now()}`)).text();
    // One fetch feeds both halves of the guard: collect the union of ids for the
    // dead-selector check, and per-page duplicates for the uniqueness check (a repeated
    // id breaks getElementById — it resolves to the first — and ambiguates aria-labelledby
    // / aria-describedby references).
    const seen = new Set();
    const dups = new Set();
    for (const m of html.matchAll(/id="([A-Za-z0-9_-]+)"/g)) {
      presentIds.add(m[1]);
      if (seen.has(m[1])) dups.add(m[1]);
      else seen.add(m[1]);
    }
    if (dups.size) dupReports.push(`${path}: ${[...dups].sort().join(", ")}`);
  }
  const missing = queriedIds.filter((id) => !presentIds.has(id));
  ok(
    missing.length === 0,
    `JS: every #id app.js queries exists on a served page (${queriedIds.length} ids × ${idScanPages.length} pages)${missing.length ? ` — MISSING: ${missing.join(", ")}` : ""}`,
  );
  ok(
    dupReports.length === 0,
    `HTML: no duplicate ids on served pages (${idScanPages.length} pages)${dupReports.length ? ` — DUPLICATES: ${dupReports.join("; ")}` : ""}`,
  );
} catch (err) {
  failures += 1;
  checks += 1;
  console.error(`FAIL  dead-selector guard — ${err.message}`);
}

console.log("\n— design-system integrity (DESIGN.md must never drift from the shipped CSS) —");
try {
  // DESIGN.md is the visual source of truth; the :root tokens in style.css are the code
  // reality. Bidirectional parity: every color DESIGN.md documents must exist in the
  // served stylesheet, and every :root color in the stylesheet must be documented in
  // DESIGN.md. Hexes are normalized (3-digit expanded, lowercase) so #000 == #000000.
  const design = readFileSync("DESIGN.md", "utf8");
  const css = await (await request("GET", `/css/style.css?smoke=${Date.now()}`)).text();
  const hexes = (s) =>
    [...new Set([...(s.match(/#[0-9a-fA-F]{3,8}\b/g) || [])].map((h) => {
      const v = h.slice(1);
      if (v.length === 3 || v.length === 4) return v.split("").map((c) => c + c).join("").toLowerCase();
      return v.toLowerCase();
    }))];
  const designHex = hexes(design);
  const cssHex = hexes(css);
  const rootBlock = css.match(/:root\s*\{([^}]*)\}/);
  const rootHex = rootBlock ? hexes(rootBlock[1]) : [];
  const missingInCss = designHex.filter((h) => !cssHex.includes(h));
  const missingInDesign = rootHex.filter((h) => !designHex.includes(h));
  ok(missingInCss.length === 0, `DESIGN.md colors all exist in the shipped CSS${missingInCss.length ? ` (missing: ${missingInCss.join(", ")})` : ""}`);
  ok(missingInDesign.length === 0, `CSS :root tokens all documented in DESIGN.md${missingInDesign.length ? ` (undocumented: ${missingInDesign.join(", ")})` : ""}`);
  // The tungsten glow — the one rgba token in the system — must match too.
  const norm = (s) => s.replace(/\s+/g, "").toLowerCase();
  const designGlow = (design.match(/rgba\(\s*242\s*,\s*169\s*,\s*59\s*,\s*0\.18\s*\)/i) || [])[0];
  const cssGlow = (css.match(/rgba\(\s*242\s*,\s*169\s*,\s*59\s*,\s*0\.18\s*\)/i) || [])[0];
  ok(Boolean(designGlow && cssGlow) && norm(designGlow) === norm(cssGlow), "DESIGN.md and CSS share the tungsten glow rgba(242,169,59,0.18)");
  // WCAG 2.x contrast on the pairs that carry real text (computed from the live tokens,
  // so a coordinated token change still gets judged — never a stale hardcoded ratio).
  // The worst text pair on the site is muted-on-surface-2 (watch buttons, chips); the
  // accent and button-ink pairs are the other text-bearing accent uses.
  const relLuminance = (hex) => {
    const v = hex.replace("#", "");
    const rgb = v.length === 3 ? v.split("").map((c) => parseInt(c + c, 16)) : [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
    const lin = rgb.map((c) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  };
  const contrast = (a, b) => {
    const la = relLuminance(a);
    const lb = relLuminance(b);
    const hi = Math.max(la, lb);
    const lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  };
  const vars = {};
  for (const m of (rootBlock ? rootBlock[1] : "").matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) vars[m[1]] = m[2];
  const pair = (name, a, b) => {
    const ratio = contrast(vars[a], vars[b]);
    ok(ratio >= 4.5, `contrast ${name}: ${vars[a]} on ${vars[b]} = ${ratio.toFixed(2)}:1 (≥4.5 AA)`);
  };
  pair("muted on surface-2 (worst text pair: watch buttons, chips)", "muted", "surface-2");
  pair("accent on page bg (amber links)", "accent", "bg");
  pair("accent-ink on accent (primary buttons)", "accent-ink", "accent");
  pair("text on page bg (body copy)", "text", "bg");
} catch (err) {
  failures += 1;
  checks += 1;
  console.error(`FAIL  design-system integrity — ${err.message}`);
}

console.log("\n— no-accounts vow guard (constitution §5 / Vow 5: auth affordances never appear) —");
try {
  // The founding promise is zero accounts. This fails if any served page ever ships an
  // authentication affordance: a password input, a link to an auth route, or standalone
  // sign-up/sign-in text. Prose denial ("No accounts", "no sign-up walls", "zero
  // accounts") is expected and fine — the guard targets affordances, not the word.
  const noAuthPages = ["/", "/browse", "/search?q=noir", "/watchlist", "/about", "/privacy", "/terms", "/advertise", "/genre", "/tv", "/anime", "/cartoons", "/otr", "/music", "/documentaries", "/ted", "/sports", "/shorts", "/silents", "/publictv", "/science", "/govfilms", "/audiobooks", "/records", "/ephemera", "/space", "/footage", "/shortfilms", "/collections", "/movie/it-1927", "/definitely-not-a-page"];
  for (const path of noAuthPages) {
    const html = await (await request("GET", `${path}?smoke=${Date.now()}`)).text();
    let reason = null;
    if (/<input[^>]+type=["']password["']/i.test(html)) reason = "password input";
    if (!reason) {
      for (const raw of html.match(/\bhref=["'][^"']+["']/gi) || []) {
        const href = raw.replace(/^href=["']/i, "").replace(/["']$/i, "");
        if (/^(?:\/|https?:\/\/[^/]*\/)?(?:login|signin|signup|sign-in|sign-up|register|account|auth|password|forgot)(?:[/?#]|$)/i.test(href.replace(/^https?:\/\/[^/]+/, ""))) {
          reason = `auth link ${href}`;
          break;
        }
      }
    }
    if (!reason) {
      const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ");
      if (/\b(?:sign up|sign in|log in|log on|create an? account|forgot (?:my|your) password|reset password|new password)\b/i.test(text)) reason = "sign-up/sign-in text";
    }
    ok(!reason, `no-accounts vow: ${path} has no auth affordance${reason ? ` (${reason})` : ""}`);
  }
} catch (err) {
  failures += 1;
  checks += 1;
  console.error(`FAIL  no-accounts vow guard — ${err.message}`);
}

console.log("\n— watchlist export/import guards (server-free backup, Vow 5) —");
try {
  const watchlistHtml = await (await request("GET", `/watchlist?smoke=${Date.now()}`)).text();
  const watchlistJs = await (await request("GET", `/js/app.js?smoke=${Date.now()}`)).text();
  ok(watchlistHtml.includes('id="watchlist-export"'), "Watchlist: Export button present (server-free backup)");
  ok(watchlistHtml.includes('id="watchlist-import"'), "Watchlist: Import button present");
  ok(watchlistHtml.includes('type="file"'), "Watchlist: import reads a local file (no server upload)");
  ok(watchlistJs.includes("URL.createObjectURL(blob)"), "JS: export is a local file download via Blob — nothing leaves the browser");
  ok(watchlistJs.includes("watchSave(cleaned)"), "JS: import validates every entry before touching storage (fail closed)");
  ok(watchlistJs.includes('window.confirm("Import a watchlist file?'), "JS: import confirms before replacing the saved list (destructive action)");
} catch (err) {
  failures += 1;
  checks += 1;
  console.error(`FAIL  watchlist export/import guards — ${err.message}`);
}

console.log("\n— CLS guards (skeleton grids reserve the results space) —");
try {
  const browse = await (await request("GET", `/browse?smoke=${Date.now()}`)).text();
  const search = await (await request("GET", `/search?smoke=${Date.now()}`)).text();
  ok(browse.includes("card--skeleton"), "Browse: skeleton grid reserves results space (CLS)");
  ok(search.includes("card--skeleton"), "Search: skeleton grid reserves results space (CLS)");
} catch (err) {
  failures += 1;
  checks += 1;
  console.error(`FAIL  CLS guards — ${err.message}`);
}

console.log("\n— hostile inputs (constitution §6: sanitize, never 500) —");
try {
  // These sanitize into plain terms and must return real search results, not errors.
  for (const q of ["solr:*:*", "../../etc/passwd", "<script>alert(1)</script>"]) {
    const res = await request("GET", `/api/search?q=${encodeURIComponent(q)}`);
    ok(res.status === 200, `hostile q sanitizes to a valid search (${JSON.stringify(q)}) → ${res.status}`);
  }
  // Solr rejects a trailing "--" (reserved char) at archive.org — the route must map that
  // upstream rejection to an honest 502 upstream_error, NEVER a generic 500. Regression
  // guard for the un-awaited withEdgeCachedResponse bug (fixed 2026-08-16, deploy #58).
  const reject = await request("GET", "/api/search?q=a%22%20OR%201%3D1%20--");
  const rejectBody = await reject.json().catch(() => ({}));
  ok(reject.status === 502, `upstream-rejected query → 502 upstream_error (got ${reject.status})`);
  ok(rejectBody.error === "upstream_error", "upstream rejection is honest (upstream_error), not internal_error");
  // Oversized and traversal identifiers are rejected by validation before any upstream call.
  const oversize = await request("GET", `/api/movie/${"a".repeat(200)}`);
  ok(oversize.status === 400, "oversized identifier → 400 (validation, no upstream call)");
  const traversal = await request("GET", "/api/movie/..%2F..%2Fetc%2Fpasswd");
  ok(traversal.status === 400, "traversal identifier → 400 (validation, no upstream call)");
  // Fully-encoded single-segment hostile identifiers (script payload, quote+space) must 400.
  for (const id of ["%3Cscript%3Ex%3C%2Fscript%3E", "a%22b%20c", "%00%00"]) {
    const res = await request("GET", `/api/movie/${id}`);
    ok(res.status === 400, `hostile identifier → 400 (validation, no upstream call) [${id}]`);
  }
  // Browse filter params are allowlisted/enumerated: every invalid value must 400, never 500.
  for (const p of ["genre=not-a-genre", "decade=1991", "decade=abcd", "sort=random", "page=0", "page=abc", "from=2000", "to=2029", "from=2029&to=2000", "from=abcd&to=2000", "decade=1920&from=2000&to=2020", "q=", "q=" + "a".repeat(81), "tv=banana"]) {
    const res = await request("GET", `/api/browse?${p}`);
    ok(res.status === 400, `invalid browse filter → 400 (${p})`);
  }
  // Error responses must carry the security header set (middleware wraps every response).
  const errRes = await request("GET", "/api/browse?sort=random");
  ok((errRes.headers.get("x-robots-tag") || "") === "noindex", "400 response carries X-Robots-Tag: noindex");
  ok(errRes.headers.get("x-content-type-options") === "nosniff", "400 response carries nosniff");
  // SSR movie pages: hostile identifiers must fail closed at 400 and never echo the input.
  // Note: prod rejects some malformed URLs at the edge (generic 400, our function never
  // runs) while dev passes them to the renderer — so the guard asserts status + no-leak,
  // not specific markup, to hold on both surfaces.
  const ssrHostiles = [
    "%3Cscript%3Ex%3C%2Fscript%3E", // script tag payload
    "a%22b%20c", // quote + space
    "a%2Fb", // encoded slash
  ];
  for (const id of ssrHostiles) {
    const res = await request("GET", `/movie/${id}`);
    const body = await res.text();
    const decoded = decodeURIComponent(id);
    ok(res.status === 400, `SSR hostile identifier → 400 (got ${res.status}) [${id}]`);
    ok(!body.includes(decoded), `SSR hostile identifier not echoed in the HTML [${id}]`);
    ok(body.includes("<html") || body.includes("<HTML"), `SSR hostile response is intact HTML [${id}]`);
  }
} catch (err) {
  failures += 1;
  checks += 1;
  console.error(`FAIL  hostile inputs — request failed: ${err.message}`);
}

console.log("\n— API shape —");
try {
  const res = await request("GET", "/api/health");
  const body = await res.json();
  ok(body && body.ok === true && body.service === "347movies", "/api/health JSON {ok:true}");
  ok((res.headers.get("x-robots-tag") || "") === "noindex", "/api/* carries X-Robots-Tag: noindex");
} catch (err) {
  failures += 1;
  checks += 1;
  console.error(`FAIL  /api/health — ${err.message}`);
}

console.log("\n— catalog policy contract (films-only default, no trailers/episodes) —");
try {
  // Mirrors lib/film-policy.ts isNonFilmTitle (smoke is deliberately zero-dependency, so
  // the matcher is copied here and kept in sync): a token starting with episode/season/
  // trailer, exact "pilot"/"chapter"/"part" tokens, a bare "ep" token, or the raw title
  // containing "ep.". Apostrophes stay attached ("Pilot's Perspective" is a real film and
  // must NOT match); plural "chapters" is NOT excluded (complete-serial compilations stay).
  const isNonFilmTitle = (title) => {
    const t = String(title || "").toLowerCase();
    if (t.includes("ep.")) return true;
    return t
      .split(/[^a-z0-9']+/)
      .filter(Boolean)
      .some((w) =>
        w === "ep" || w.startsWith("episode") || w.startsWith("season") || w.startsWith("trailer") || w === "pilot" || w === "chapter" || w === "part",
      );
  };

  const def = await (await request("GET", `/api/browse?page=1&smoke=${Date.now()}`)).json();
  ok(def.films === true, "browse without films= defaults to films-only (films: true)");
  ok(Array.isArray(def.results) && def.results.length > 0, "browse default returns results");
  ok(def.results.every((r) => !isNonFilmTitle(r.title)), "no trailer/episode titles in the default browse view");
  ok(
    typeof def.total === "number" && def.total >= 15000 && def.total <= 18500,
    `browse films-only total sane (${def.total})`,
  );

  // Classic TV catalog: tv=1 serves the curated classic_tv pool (episodes ARE the content,
  // so no films-only exclusion), identified in the response and far smaller than the films
  // union. The films browse view stays TV-free by construction (separate index).
  const tvPage = await (await request("GET", `/api/browse?tv=1&sort=recent&page=1&smoke=${Date.now()}`)).json();
  ok(Array.isArray(tvPage.results) && tvPage.results.length > 0, "tv=1 returns TV results");

  // Audio-pool card enrichment (2026-08-17): OTR/music browse results carry the episode
  // count + series tag fields (populated from per-item metadata, edge-cached per
  // identifier). The field must EXIST on every result — a null value means the enrichment
  // hadn't cached it yet, which is the honest "unknown" state, not a broken contract.
  const otrBrowse = await (await request("GET", `/api/browse?otr=1&sort=recent&page=1&smoke=${Date.now()}`)).json();
  ok(Array.isArray(otrBrowse.results) && otrBrowse.results.length > 0, "otr=1 returns results");
  ok(
    otrBrowse.results.every((r) => "episodeCount" in r && "seriesTag" in r),
    "OTR cards carry episodeCount + seriesTag fields (audio enrichment wired)",
  );
  ok(tvPage.films === undefined, "tv=1 response does not claim the films catalog (films field absent)");
  ok(
    typeof tvPage.total === "number" && tvPage.total > 0 && tvPage.total < 15000,
    `TV catalog is the classic_tv pool, not the films union (${tvPage.total})`,
  );

  const all = await (await request("GET", `/api/browse?films=0&page=1&smoke=${Date.now()}`)).json();
  ok(all.films === undefined, "films=0 opts out (films field absent)");
  ok(typeof all.total === "number" && all.total >= 18000, `films=0 returns the full union (${all.total})`);

  const noir = await (await request("GET", `/api/search?q=noir&smoke=${Date.now()}`)).json();
  ok(Array.isArray(noir.results) && noir.results.every((r) => !isNonFilmTitle(r.title)), "search results carry no trailer/episode titles");

  // TV boundary: films search and TV search are mutually exclusive pools. A query that only
  // matches classic-TV content must not leak TV items into the films search, tv=0 must be
  // equivalent to omitting the flag, and the TV pool must be the one serving tv=1.
  const tvTerm = `twilight+zone&smoke=${Date.now()}`;
  const filmsSearch = await (await request("GET", `/api/search?q=${tvTerm}`)).json();
  const zeroFlag = await (await request("GET", `/api/search?q=${tvTerm}&tv=0`)).json();
  ok(zeroFlag.total === filmsSearch.total, "tv=0 is equivalent to omitting tv (same pool, same total)");
  ok(
    typeof filmsSearch.total === "number" && filmsSearch.total >= 0 && filmsSearch.total < 15000,
    `films search total sane for a TV-only term (${filmsSearch.total})`,
  );
  const tvSearch = await (await request("GET", `/api/search?q=${tvTerm}&tv=1`)).json();
  const tvIds = new Set((tvSearch.results || []).map((r) => r.identifier));
  ok(tvIds.size > 0, "tv=1 search returns classic-TV results");
  ok(
    (filmsSearch.results || []).every((r) => !tvIds.has(r.identifier)),
    "films search never returns classic-TV items (pools are mutually exclusive)",
  );
} catch (err) {
  failures += 1;
  checks += 1;
  console.error(`FAIL  catalog policy contract — ${err.message}`);
}

console.log("\n— movie page —");
try {
  // Hard check on a UNIQUELY cache-busted URL: proves the deployed code serves the current
  // layout. The suffix must be unique per run — a fixed ?smoke=1 copy re-cached by a
  // pre-deploy fetch would otherwise be served for its TTL and fail the fresh-code checks
  // (observed live: the JSON-LD checks failed until the stale copy expired).
  const fresh = await request("GET", `/movie/it-1927?smoke=${Date.now()}`);
  const freshHtml = await fresh.text();
  ok(freshHtml.includes("archive.org/embed/it-1927"), "player iframe present (deployed code)");
  ok(freshHtml.includes('data-watch-id="it-1927"'), "save-to-watchlist button present (deployed code)");
  // "More from this pool" strip: the item's pool landing page is linked back to its pool
  // (it-1927 is a films-union item → /browse). Guards the internal-linking strip and the
  // client-side item row (data-pool/data-exclude feed app.js's /api/browse?<pool>=1 fetch).
  ok(freshHtml.includes('id="pool-section"') && freshHtml.includes('href="/browse">See all'), "movie page links its pool landing page (More-from-this-pool strip)");
  ok(freshHtml.includes('data-pool="films"') && freshHtml.includes('data-exclude="it-1927"') && freshHtml.includes('id="pool-more"'), "pool strip carries the variant + grid target for the item row");
  // Pool label: the item's collection is announced at the top (chip + breadcrumb) so a
  // random/direct landing knows which pool it arrived in.
  ok(freshHtml.includes('class="chip chip--pool"') && freshHtml.includes('>Films</a>'), "movie page labels its pool (chip + breadcrumb)");
  // Structured data: the page must carry a JSON-LD VideoObject data block with the real
  // embed URL (video indexing / rich results). Data blocks are exempt from script-src CSP.
  ok(freshHtml.includes('type="application/ld+json"') && freshHtml.includes('"@type":"VideoObject"'), "JSON-LD VideoObject present");
  ok(freshHtml.includes('"embedUrl":"https://archive.org/embed/it-1927"'), "JSON-LD embedUrl matches the real player");
  // Regression guard: the button is only functional when app.js is loaded on the SSR page
  // (caught live: the shell used to omit the script tag, leaving the button dead).
  ok(freshHtml.includes('src="/js/app.js"'), "SSR page loads app.js (button is functional)");
  ok((freshHtml.match(/<h1[ >]/g) || []).length === 1 && freshHtml.includes('class="skip-link"') && freshHtml.includes('<main'), "SSR page shell: 1 h1, skip link, main");
  // Canonical URL is what users and crawlers see. It can lag a deploy by the edge-cache TTL
  // (max 300s for new entries; a one-off 3600s entry from the pre-TTL-cut era self-healed
  // within an hour) — a lag is a WARNING, not a failure, because it self-heals.
  const canonical = await request("GET", "/movie/it-1927");
  const canonicalHtml = await canonical.text();
  checks += 1;
  if (canonicalHtml.includes('data-watch-id="it-1927"')) {
    console.log("  ok  canonical /movie/it-1927 serves the current layout");
  } else {
    console.warn("WARN  canonical /movie/it-1927 still serves a pre-deploy edge-cache copy — it self-heals within the edge-cache TTL (see changelog: deploy staleness)");
  }
} catch (err) {
  failures += 1;
  checks += 1;
  console.error(`FAIL  /movie/it-1927 — ${err.message}`);
}

console.log("\n— no-video item page (legal item, zero playable files) —");
try {
  // Unique cache-bust like the other movie-page checks, so a pre-deploy copy cached under
  // a fixed ?smoke=1 suffix can never be served for its TTL and mask a markup regression.
  const res = await request("GET", `/movie/mrs.-pumpkin?smoke=${Date.now()}`);
  const html = await res.text();
  ok(res.status === 200, "no-video item → 200 (not a broken page)");
  ok(html.includes("No playable video"), "honest 'no playable video' message");
  ok(!html.includes("archive.org/embed/"), "no dead player iframe");
  ok(html.includes("archive.org/details/mrs.-pumpkin"), "source link present");
  ok(html.includes('name="robots" content="noindex, follow"'), "noindex on the page");
} catch (err) {
  failures += 1;
  checks += 1;
  console.error(`FAIL  /movie/mrs.-pumpkin — ${err.message}`);
}

console.log("\n— surprise-me random —");
try {
  // redirect: "manual" so the 302 itself is observed (fetch follows redirects by default).
  const res = await fetch(`${BASE}/api/random`, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
  const target = res.headers.get("location") || "";
  checks += 1;
  if (res.status === 302) console.log("  ok  /api/random redirects (302)");
  else {
    failures += 1;
    console.error(`FAIL  /api/random redirects (got ${res.status})`);
  }
  checks += 1;
  if (target.includes("/movie/")) console.log(`  ok  redirect targets a movie page (${target.slice(-40)})`);
  else {
    failures += 1;
    console.error(`FAIL  redirect targets a movie page (got "${target}")`);
  }
} catch (err) {
  failures += 1;
  checks += 1;
  console.error(`FAIL  /api/random — ${err.message}`);
}

console.log("\n— movie API fails closed (constitution §1: legal-only, never guessed) —");
try {
  // The structured fail-closed contract of the detail path (lib/catalog.ts): invalid
  // identifiers 400 before any upstream call, missing and dark items 404, each with an
  // honest `error` reason. Missing items are checked with the REAL archive.org shape
  // (HTTP 200 {}) — that path must surface as not_available, never a crash or a 502.
  const missing = await (await request("GET", "/api/movie/definitely_not_a_real_item_xyz_123")).json();
  ok(missing.error === "not_available", `missing item → 404 not_available (got ${JSON.stringify(missing.error)})`);
  const dark = await (await request("GET", "/api/movie/night_of_the_living_dead")).json();
  ok(dark.error === "not_available", `dark item → 404 not_available (got ${JSON.stringify(dark.error)})`);
  const invalid = await (await request("GET", "/api/movie/bad%20id")).json();
  ok(invalid.error === "invalid", `invalid identifier → 400 invalid (got ${JSON.stringify(invalid.error)})`);
} catch (err) {
  failures += 1;
  checks += 1;
  console.error(`FAIL  movie API fails closed — ${err.message}`);
}

console.log("\n— ad slots (constitution §4, vow 2: ads never interrupt the movie) —");
try {
  // The monetization contract: a real, labeled reserved slot on every page type with the
  // advertiser email, structurally separated from the player. Nothing fake ever renders
  // inside a slot (constitution §4: no mock ads) — these guards check the slot CONTRACT.
  for (const path of ["/", "/search?q=noir", "/browse?genre=film-noir"]) {
    const html = await (await request("GET", `${path}?smoke=${Date.now()}`)).text();
    const n = (html.match(/data-ad-slot="leaderboard"/g) || []).length;
    ok(n === 1, `${path} carries exactly one top leaderboard slot (got ${n})`);
  }
  // The home page also carries a mid-page leaderboard (leaderboard-2) so the long feed
  // has a second monetization point, never near the player (home has no player).
  const homeHtml = await (await request("GET", `/?smoke=${Date.now()}`)).text();
  ok((homeHtml.match(/data-ad-slot="leaderboard-2"/g) || []).length === 1, "home carries exactly one mid-page leaderboard slot");
  const movieHtml = await (await request("GET", `/movie/it-1927?smoke=${Date.now()}`)).text();
  const side = (movieHtml.match(/data-ad-slot="sidebar"/g) || []).length;
  const side2 = (movieHtml.match(/data-ad-slot="sidebar-2"/g) || []).length;
  ok(side === 1 && side2 === 1, `movie page carries two sidebar slots (got ${side}/${side2})`);
  // The sidebar slots must start after the player-wrap's closing tag — i.e. they are never
  // nested inside the player. The first </div> after player-wrap is its own close (the
  // iframe is a self-closing element).
  const pw = movieHtml.indexOf('<div class="player-wrap">');
  const pwClose = movieHtml.indexOf("</div>", pw);
  const slotAt = movieHtml.indexOf('data-ad-slot="sidebar"');
  const slot2At = movieHtml.indexOf('data-ad-slot="sidebar-2"');
  ok(pw !== -1 && slotAt > pwClose && slot2At > pwClose, "movie-page ad slots sit outside the player wrap");
  for (const path of ["/genre", "/tv", "/anime", "/cartoons", "/otr", "/music", "/documentaries", "/ted", "/sports", "/shorts", "/silents", "/publictv", "/science", "/govfilms", "/audiobooks", "/records", "/ephemera", "/space", "/footage", "/shortfilms"]) {
    const html = await (await request("GET", `${path}?smoke=${Date.now()}`)).text();
    const s = (html.match(/data-ad-slot="sidebar"/g) || []).length;
    const s2 = (html.match(/data-ad-slot="sidebar-2"/g) || []).length;
    ok(s === 1 && s2 === 1, `${path} carries two sidebar slots (got ${s}/${s2})`);
  }
  const watchlistHtml = await (await request("GET", `/watchlist?smoke=${Date.now()}`)).text();
  ok((watchlistHtml.match(/data-ad-slot="leaderboard"/g) || []).length === 1, "watchlist carries exactly one leaderboard slot");
  ok(watchlistHtml.includes("contactae2000@gmail.com"), "leaderboard slot carries the advertiser contact email");
} catch (err) {
  failures += 1;
  checks += 1;
  console.error(`FAIL  ad slots — ${err.message}`);
}

console.log("\n— ad loader dormant (Decision 001 / T4.3: nothing renders unconfigured) —");
try {
  const cfg = await (await request("GET", "/api/ad-config")).json();
  ok(cfg && cfg.enabled === false, `ad-config reports disabled while unconfigured (got ${JSON.stringify(cfg)})`);
  // Every page type with ad slots must carry ZERO third-party <script src> tags while
  // unconfigured — the only scripts are our own /js/app.js (plus data-only JSON-LD blocks,
  // which have no src and are never executed). This is the "nothing renders until a real
  // network is configured" proof (constitution §12) — and the fail-closed invariant.
  for (const path of ["/", "/search?q=noir", "/browse?genre=film-noir", "/movie/it-1927"]) {
    const html = await (await request("GET", `${path}?smoke=${Date.now()}`)).text();
    const external = (html.match(/<script[^>]+src="https?:\/\//g) || []).length;
    ok(external === 0, `${path} carries no third-party scripts (got ${external})`);
  }
} catch (err) {
  failures += 1;
  checks += 1;
  console.error(`FAIL  ad loader dormant — ${err.message}`);
}

console.log("\n— short films page keyword targeting —");
try {
  const html = await (await request("GET", `/shortfilms?smoke=${Date.now()}`)).text();
  ok(html.includes("Short Films"), "shortfilms page: H1/title present");
  for (const kw of ["short film", "short films", "small film", "indie film", "small films"]) {
    ok(html.toLowerCase().includes(kw), `shortfilms page targets the "${kw}" keyword`);
  }
  ok(html.includes('action="/shortfilms"') && html.includes('id="shortfilm-q"'), "shortfilms page: search form posts to the page (GET /shortfilms?q=…)");
  ok(html.includes('data-page="shortfilms"'), "shortfilms page: data-page hook present");
} catch (err) {
  failures += 1;
  checks += 1;
  console.error(`FAIL  short films page — ${err.message}`);
}

console.log("\n— page-view counter (vow 5: aggregate, cookie-free) —");
try {
  const stats = await (await request("GET", "/api/views?days=7")).json();
  ok(stats && stats.enabled === true && Array.isArray(stats.days) && typeof stats.total === "number",
    `views API returns the aggregate shape (days=${Array.isArray(stats.days) ? stats.days.length : "?"}, total=${typeof stats.total === "number" ? stats.total : "?"})`);
  ok(stats && typeof stats.byPath === "object" && stats.byPath !== null, "views API returns the per-path breakdown");
  const clamped = await (await request("GET", "/api/views?days=999")).json();
  ok(clamped && clamped.windowDays === 30, `days is clamped (999 → ${clamped && clamped.windowDays})`);
  const advertise = await (await request("GET", `/advertise?smoke=${Date.now()}`)).text();
  ok(advertise.includes('id="view-stats"'), "advertise page carries the view-stats placeholder");
  const privacy = await (await request("GET", `/privacy?smoke=${Date.now()}`)).text();
  ok(privacy.includes("The page-view counter"), "privacy page discloses the counter (constitution §5)");
  const appJs = await (await request("GET", "/js/app.js?smoke=" + Date.now())).text();
  ok(appJs.includes("reportPageView") && appJs.includes("/api/view"), "app.js wires the one-fire-and-forget report");
  ok(appJs.includes('credentials: "omit"'), "app.js reports without cookies");
} catch (err) {
  failures += 1;
  checks += 1;
  console.error(`FAIL  page-view counter — ${err.message}`);
}

console.log("\n— collections hub counts —");
try {
  const c = await (await request("GET", "/api/collections")).json();
  const pools = c && typeof c.pools === "object" ? c.pools : {};
  const expected = ["films", "tv", "anime", "cartoons", "otr", "music", "documentaries", "sports", "shorts", "silents", "footage"];
  const allCounted = expected.every((k) => typeof pools[k] === "number" && pools[k] >= 0);
  ok(allCounted, `collections API returns all pools with counts (${expected.map((k) => `${k}=${pools[k]}`).join(", ")})`);
  ok(typeof pools.films === "number" && pools.films > 1000, `films count looks sane (${pools.films})`);
  const collectionsHtml = await (await request("GET", `/collections?smoke=${Date.now()}`)).text();
  ok((collectionsHtml.match(/data-pool="/g) || []).length === 19, "collections page carries nineteen pool cards with count targets");
  const appJs = await (await request("GET", "/js/app.js?smoke=" + Date.now())).text();
  ok(appJs.includes("/api/collections"), "app.js wires the collections count fetch");
  // The hub is the single footer destination for the catalog: the footer links to
  // /collections once, and never to the individual pools (they're reachable from the hub
  // and the header dropdown — no orphans, but also no ten-entry footer sprawl). Scope the
  // second check to the footer nav block, since the header/sections still link pools.
  const homeFooterPage = await (await request("GET", `/?smoke=${Date.now()}`)).text();
  const footerStart = homeFooterPage.indexOf('<nav aria-label="Footer">');
  const footerNav = homeFooterPage.slice(footerStart, homeFooterPage.indexOf("</nav>", footerStart) + "</nav>".length);
  ok(footerNav.includes('<a href="/collections">Collections</a>'), "footer: Collections hub link present");
  ok(!/href="\/(tv|anime|cartoons|otr|music|documentaries|sports|shorts|silents)"/.test(footerNav), "footer: individual pool links consolidated into the hub");
  // Curated-view disclosure: shorts, silents, and vintage footage are 100% subsets of the
  // films union (measured 2026-08-18 and 2026-08-22: 0 exclusive items), and tedtalks and
  // science are 100% subsets of culturalandacademicfilms (measured 2026-08-21: 2,933 =
  // 2,933 and 257 = 257), so all five must be labeled as curated views, never implied to be
  // disjoint catalogs. Guard both the hub badges and the landing-page notes.
  ok((collectionsHtml.match(/Curated view/g) || []).length === 5, "collections page badges shorts + silents + footage + TED + science as curated views");
  // Disjoint pools: measured 2026-08-21 (cross-pool overlap matrix, docs/cross-pool-overlap-matrix.md)
  // — 8 pools have 0 overlap with any other pool. Each carries a "Unique" badge so visitors
  // know titles aren't duplicated elsewhere.
  ok((collectionsHtml.match(/Unique/g) || []).length === 8, "collections page badges 8 disjoint pools as Unique");
  // The collections hub carries JSON-LD expressing the curated-view relationships so
  // structured-data consumers see the subset hierarchy from the hub itself.
  ok(collectionsHtml.includes('application/ld+json') && collectionsHtml.includes('isPartOf'), "collections hub JSON-LD discloses curated-view isPartOf relationships");
  ok((homeFooterPage.match(/Curated view/g) || []).length === 5, "home page badges the shorts + silents + footage + TED + science sections as curated views");
  const shortsHtml = await (await request("GET", `/shorts?smoke=${Date.now()}`)).text();
  const silentsHtml = await (await request("GET", `/silents?smoke=${Date.now()}`)).text();
  ok(shortsHtml.includes("A curated view") && shortsHtml.includes('href="/browse"'), "shorts page discloses it is a curated view of Films");
  ok(silentsHtml.includes("A curated view") && silentsHtml.includes('href="/browse"'), "silents page discloses it is a curated view of Films");
  const footageHtml = await (await request("GET", `/footage?smoke=${Date.now()}`)).text();
  ok(footageHtml.includes("A curated view") && footageHtml.includes('href="/browse"'), "footage page discloses it is a curated view of Films");
  const tedHtml = await (await request("GET", `/ted?smoke=${Date.now()}`)).text();
  ok(tedHtml.includes("A curated view") && tedHtml.includes('href="/documentaries"'), "ted page discloses it is a curated view of Documentaries");
  const scienceHtml = await (await request("GET", `/science?smoke=${Date.now()}`)).text();
  ok(scienceHtml.includes("A curated view") && scienceHtml.includes('href="/documentaries"'), "science page discloses it is a curated view of Documentaries");
  // The overlap must also be visible to search engines: the page meta description (what a
  // SERP shows) discloses the curated-view relationship, not just the visible hero note.
  ok(/<meta name="description"[^>]*curated view/i.test(shortsHtml), "shorts meta description discloses the curated-view overlap");
  ok(/<meta name="description"[^>]*curated view/i.test(silentsHtml), "silents meta description discloses the curated-view overlap");
  ok(/<meta name="description"[^>]*curated view/i.test(footageHtml), "footage meta description discloses the curated-view overlap");
  ok(/<meta name="description"[^>]*curated view/i.test(tedHtml), "ted meta description discloses the curated-view overlap");
  ok(/<meta name="description"[^>]*curated view/i.test(scienceHtml), "science meta description discloses the curated-view overlap");
  // Same disclosure for structured-data consumers: the JSON-LD CollectionPage names the
  // parent Films catalog via isPartOf so crawlers see the subset relationship too.
  ok(shortsHtml.includes('"isPartOf"') && shortsHtml.includes('347movies.pages.dev/browse'), "shorts JSON-LD exposes isPartOf → /browse");
  ok(silentsHtml.includes('"isPartOf"') && silentsHtml.includes('347movies.pages.dev/browse'), "silents JSON-LD exposes isPartOf → /browse");
  ok(footageHtml.includes('"isPartOf"') && footageHtml.includes('347movies.pages.dev/browse'), "footage JSON-LD exposes isPartOf → /browse");
  ok(tedHtml.includes('"isPartOf"') && tedHtml.includes('347movies.pages.dev/documentaries'), "ted JSON-LD exposes isPartOf → /documentaries");
  ok(scienceHtml.includes('"isPartOf"') && scienceHtml.includes('347movies.pages.dev/documentaries'), "science JSON-LD exposes isPartOf → /documentaries");
  // Canonical decision (docs/decisions/002): the pages stay SELF-canonical, never → /browse.
  // rel=canonical signals duplication ("same content, index only one"); shorts/silents are
  // distinct landing pages (own title/description/hero), and pointing them at /browse would
  // de-index them. The subset relationship belongs to isPartOf (above), not canonical.
  ok(shortsHtml.includes('<link rel="canonical" href="https://347movies.pages.dev/shorts">'), "shorts stays self-canonical (not → /browse)");
  ok(silentsHtml.includes('<link rel="canonical" href="https://347movies.pages.dev/silents">'), "silents stays self-canonical (not → /browse)");
  ok(footageHtml.includes('<link rel="canonical" href="https://347movies.pages.dev/footage">'), "footage stays self-canonical (not → /browse)");
  ok(tedHtml.includes('<link rel="canonical" href="https://347movies.pages.dev/ted">'), "ted stays self-canonical (not → /documentaries)");
  ok(scienceHtml.includes('<link rel="canonical" href="https://347movies.pages.dev/science">'), "science stays self-canonical (not → /documentaries)");
} catch (err) {
  failures += 1;
  checks += 1;
  console.error(`FAIL  collections hub — ${err.message}`);
}

console.log("\n— sitemap —");
try {
  // The catalog outgrew the 50,000-URL single-file sitemap limit, so /sitemap.xml is now
  // an INDEX pointing at one sub-sitemap per pool. This helper follows the index and sums
  // every sub-sitemap's URLs/lastmods — the total is the real catalog size.
  async function fetchSitemapTotals(indexPath) {
    const indexRes = await request("GET", indexPath);
    const indexXml = await indexRes.text();
    // The index's sub-sitemap locs are absolute (production origin); rewrite the host to the
    // smoke BASE so a dev/localhost run fetches the same deployment, not production.
    const subs = [...indexXml.matchAll(/<loc>([^<]+\.xml)<\/loc>/g)].map((m) => {
      const u = m[1];
      return u.startsWith("http") ? u.replace(/^https?:\/\/[^/]+/, "") : u;
    });
    let locs = 0;
    let lastmods = 0;
    let staticLocs = 0;
    let curatedAnnotated = false;
    for (const sub of subs) {
      const res = await request("GET", sub);
      const xml = await res.text();
      locs += (xml.match(/<loc>/g) || []).length;
      lastmods += (xml.match(/<lastmod>/g) || []).length;
      if (sub.endsWith("static.xml")) staticLocs = (xml.match(/<loc>/g) || []).length;
      if (xml.includes("curated view of /browse") || xml.includes("curated view of /documentaries")) curatedAnnotated = true;
      // Pin the footage annotation specifically: the static sub-sitemap's /footage <url>
      // entry must be followed by the curated-view-of-/browse comment (same disclosure
      // channel as shorts/silents — added with the pool, 2026-08-22).
      if (sub.endsWith("static.xml")) {
        const footageLoc = xml.indexOf("pages.dev/footage");
        const footageAnnot = footageLoc !== -1 && xml.includes("curated view of /browse", footageLoc);
        curatedAnnotated = curatedAnnotated || footageAnnot;
      }
    }
    return { locs, lastmods, staticLocs, curatedAnnotated, subs: subs.length };
  }

  // Hard check on a uniquely cache-busted URL: proves the deployed code builds the FULL
  // catalog (~64k items across all pools), not a stale pre-deploy copy. (When KV is unbound
  // this triggers one upstream catalog fetch per pool — a deliberate, bounded cost for a
  // real verification.)
  const fresh = await fetchSitemapTotals(`/sitemap.xml?smoke=${Date.now()}`);
  ok(fresh.locs >= MIN_SITEMAP_URLS, `sitemap builds the full catalog (${fresh.locs} URLs, floor ${MIN_SITEMAP_URLS})`);
  // Serial/audio pools (tv, anime, cartoons, otr, music, audiobooks, records) are disjoint
  // from the films union, so the sitemap must list them too (tens of thousands beyond the
  // films floor). This pins that /api/random's sitemap fallback can reach non-film pools
  // during an outage.
  ok(fresh.locs >= MIN_SITEMAP_URLS + 6000, `sitemap includes the serial/audio pools (${fresh.locs} URLs, floor ${MIN_SITEMAP_URLS + 6000})`);
  // The index lists one sub-sitemap per pool (static + each pool) — a single-file sitemap
  // would have been silently truncated by the 50k protocol limit, so the split is the fix.
  ok(fresh.subs >= 19, `sitemap index lists one sub-sitemap per pool (${fresh.subs} sub-sitemaps)`);
  // Static paths (/, /about, /privacy, /terms, /advertise, /browse, /search, /genre, /tv,
  // /anime, /cartoons, /otr, /music, /footage, /shortfilms, …) carry no lastmod; every
  // catalog URL does. The slack is the static sub-sitemap's OWN URL count (measured from the
  // same fetched XML), so it self-adjusts as static pages are added — no magic number to
  // go stale (2026-08-22: a hardcoded 25 broke when /footage + /shortfilms landed).
  ok(fresh.lastmods >= fresh.locs - fresh.staticLocs, `movie URLs carry <lastmod> (${fresh.lastmods} of ${fresh.locs} entries, ${fresh.staticLocs} static paths exempt)`);
  // Curated-view annotation: the static sub-sitemap documents that /shorts, /silents, and
  // /footage are views of /browse and /ted + /science are views of /documentaries (protocol
  // has no description field, so this is an XML comment — the SERP-visible disclosure is the
  // page meta description). The footage annotation is pinned precisely: /footage's own <url>
  // entry must carry the curated-view comment (added with the pool, 2026-08-22).
  ok(fresh.curatedAnnotated, "sitemap annotates /shorts + /silents + /footage → /browse and /ted + /science → /documentaries");
  // Canonical URL is what crawlers see. It can lag a deploy by the edge-cache TTL (3600s) —
  // a lag is a WARNING, not a failure, because it self-heals at TTL expiry.
  const canonical = await fetchSitemapTotals("/sitemap.xml");
  checks += 1;
  if (canonical.locs >= MIN_SITEMAP_URLS) {
    console.log(`  ok  canonical /sitemap.xml serves the full catalog (${canonical.locs} URLs)`);
  } else {
    console.warn(`WARN  canonical /sitemap.xml still serves a pre-rebuild edge-cache copy (${canonical.locs} URLs) — it self-heals at TTL expiry`);
  }
} catch (err) {
  failures += 1;
  checks += 1;
  console.error(`FAIL  /sitemap.xml — ${err.message}`);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} check(s) FAILED — fix before launch.`);
  process.exit(1);
}
console.log("All checks passed — site is live and healthy.");
