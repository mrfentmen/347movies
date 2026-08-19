/**
 * Shared page shell and the server-rendered movie detail page (functions/movie/[identifier].ts).
 * All interpolated values are HTML-escaped (constitution §6). No inline scripts or styles are
 * emitted, so the strict CSP (script-src/style-src 'self') holds on this page too.
 */
import type { IndexVariant } from "./archive.ts";
import { affiliateLink } from "./affiliate.ts";
import { escapeHtml } from "./html.ts";
import type { MovieRecord } from "./normalize.ts";

const HEADER = `<header class="site-header">
  <div class="container header-inner">
    <a class="brand" href="/"><span class="brand-347">347</span><span class="brand-movies">movies</span></a>
    <nav class="site-nav" aria-label="Main">
      <details class="nav-collections">
        <summary>Collections</summary>
        <div class="nav-collections__menu">
          <a href="/collections">All collections</a>
          <a href="/browse">Browse</a>
          <a href="/tv">TV</a>
          <a href="/anime">Anime</a>
          <a href="/cartoons">Cartoons</a>
          <a href="/otr">Radio</a>
          <a href="/music">Music</a>
          <a href="/documentaries">Documentaries</a>
          <a href="/sports">Sports</a>
          <a href="/shorts">Shorts</a>
          <a href="/silents">Silents</a>
          <a href="/publictv">Public Broadcasting</a>
          <a href="/science">Science</a>
          <a href="/govfilms">Government Films</a>
          <a href="/audiobooks">Audiobooks</a>
          <a href="/records">Vintage Records</a>
          <a href="/ephemera">Ephemeral Films</a>
        </div>
      </details>
      <a href="/watchlist">Watchlist</a>
      <a href="/about">About</a>
    </nav>
    <form class="header-search" action="/search" method="get" role="search">
      <label class="visually-hidden" for="search-input">Search films</label>
      <input id="search-input" name="q" type="search" placeholder="Search free films…" maxlength="80" autocomplete="off" required>
      <button type="submit">Search</button>
    </form>
    <button class="theme-toggle" id="theme-toggle" type="button" aria-pressed="false" aria-label="Switch to day mode">
      <svg class="theme-toggle__icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <path class="theme-toggle__moon" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" fill="currentColor"/>
        <g class="theme-toggle__sun" fill="currentColor">
          <circle cx="12" cy="12" r="4.2"/>
          <path d="M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22M4.7 4.7l1.7 1.7M17.6 17.6l1.7 1.7M19.3 4.7l-1.7 1.7M6.4 17.6l-1.7 1.7" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
        </g>
      </svg>
    </button>
  </div>
</header>`;

const FOOTER = `<footer class="site-footer">
  <div class="container footer-inner">
    <p class="footer-tag">Free movies. No interruptions. Ever.</p>
    <nav aria-label="Footer">
      <a href="/about">About</a>
      <a href="/collections">Collections</a>
      <a href="/watchlist">Watchlist</a>
      <a href="/advertise">Advertise</a>
      <a class="footer-coffee" href="https://buymeacoffee.com/347movies" target="_blank" rel="noopener">Buy me a coffee</a>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
    </nav>
    <p class="footer-note">347movies streams public domain and Creative Commons films embedded from the Internet Archive — we never host or store video. Ads appear only in marked sidebar and leaderboard slots and never interrupt a film. Affiliate links, when shown, are always disclosed.</p>
  </div>
</footer>`;

/** Pool landing pages for the "More from this pool" strip on movie detail pages. */
const POOL_LANDING: Record<IndexVariant, { path: string; label: string }> = {
  films: { path: "/browse", label: "Films" },
  tv: { path: "/tv", label: "Classic TV" },
  anime: { path: "/anime", label: "Anime" },
  cartoons: { path: "/cartoons", label: "Cartoons" },
  otr: { path: "/otr", label: "Old Time Radio" },
  music: { path: "/music", label: "Music & Concerts" },
  documentaries: { path: "/documentaries", label: "Documentaries & Learning" },
  sports: { path: "/sports", label: "Sports" },
  shorts: { path: "/shorts", label: "Shorts" },
  silents: { path: "/silents", label: "Silent Films" },
  publictv: { path: "/publictv", label: "Public Broadcasting" },
  science: { path: "/science", label: "Science & Medicine" },
  govfilms: { path: "/govfilms", label: "Government Films" },
  audiobooks: { path: "/audiobooks", label: "Audiobooks" },
  records: { path: "/records", label: "Vintage Records" },
  ephemera: { path: "/ephemera", label: "Ephemeral Films" },
};

export interface PageMeta {
  title: string;
  description: string;
  canonicalPath: string;
  og?: { title: string; description: string; image: string; type: string };
  /** schema.org JSON-LD emitted as a data block (never executed; exempt from script-src CSP). */
  jsonLd?: Record<string, unknown>;
  noindex?: boolean;
  /** URL of the page's LCP image, preloaded in <head> so the fetch starts at parse time (perf pass). */
  preloadImage?: string;
}

/**
 * JSON.stringify for embedding in a <script type="application/ld+json"> data block. Escapes
 * `<`, `>`, and `&` as unicode escapes so the block can never terminate the script element
 * or introduce entities, even if a title/description contains them (constitution §6).
 */
function jsonLdFor(value: Record<string, unknown>): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

export function pageShell(meta: PageMeta, bodyHtml: string, siteUrl: string): string {
  const canonical = siteUrl.replace(/\/$/, "") + meta.canonicalPath;
  const jsonLd = meta.jsonLd
    ? `\n<script type="application/ld+json">${jsonLdFor(meta.jsonLd)}</script>`
    : "";
  const og = meta.og
    ? `<meta property="og:type" content="${escapeHtml(meta.og.type)}">
<meta property="og:site_name" content="347movies">
<meta property="og:title" content="${escapeHtml(meta.og.title)}">
<meta property="og:description" content="${escapeHtml(meta.og.description)}">
<meta property="og:image" content="${escapeHtml(meta.og.image)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta name="twitter:card" content="summary_large_image">`
    : `<meta property="og:type" content="website">
<meta property="og:site_name" content="347movies">
<meta property="og:title" content="${escapeHtml(meta.title)}">
<meta property="og:description" content="${escapeHtml(meta.description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">`;
  const robots = meta.noindex ? `<meta name="robots" content="noindex, follow">` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0c0d11">
<title>${escapeHtml(meta.title)}</title>
<meta name="description" content="${escapeHtml(meta.description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
${og}
${robots}${jsonLd}  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="alternate" type="application/rss+xml" title="347movies — new additions" href="/api/rss.xml">
  <link rel="stylesheet" href="/css/style.css">
<link rel="preconnect" href="https://archive.org">
${meta.preloadImage ? `<link rel="preload" as="image" href="${escapeHtml(meta.preloadImage)}" fetchpriority="high">` : ""}
<link rel="preload" href="/fonts/limelight.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/plex-sans.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/plex-mono-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/plex-mono-500.woff2" as="font" type="font/woff2" crossorigin>
<script src="/js/app.js" defer></script>
</head>
<body data-page="movie">
<a class="skip-link" href="#main">Skip to content</a>
${HEADER}
<main id="main" tabindex="-1">
${bodyHtml}
</main>
${FOOTER}
</body>
</html>`;
}

export function renderMoviePage(
  record: MovieRecord,
  siteUrl: string,
  amazonTag: string | undefined,
  patreonUrl: string | undefined = undefined,
): string {
  const id = record.identifier;
  const title = record.title || "Untitled";
  const licenseLabel =
    record.license === "publicdomain"
      ? "Public Domain"
      : record.license === "creativecommons"
        ? "Creative Commons"
        : "";

  // year is raw archive.org metadata (untrusted third-party input) — must be escaped
  // like every other field; a hostile year value must never reach the page HTML.
  const yearChip = record.year ? `<span class="chip">${escapeHtml(String(record.year))}</span>` : "";
  const runtimeChip = record.runtime ? `<span class="chip">${escapeHtml(record.runtime)}</span>` : "";
  const genreChips = record.genres.map((g) => `<span class="chip">${escapeHtml(g)}</span>`).join("");
  const licenseChip = licenseLabel ? `<span class="chip chip--license">${licenseLabel}</span>` : "";
  // Pool label: tells a random/direct landing which collection it arrived in. Derived from
  // the archive.org `collection` field (normalizeMetadata); absent for old cached records or
  // items outside any curated pool — then no chip/breadcrumb/strip render.
  const poolLanding = record.pool ? POOL_LANDING[record.pool] : undefined;
  const poolChip = poolLanding
    ? `<a class="chip chip--pool" href="${escapeHtml(poolLanding.path)}">${escapeHtml(poolLanding.label)}</a>`
    : "";
  const poolCrumb = poolLanding
    ? `<a href="${escapeHtml(poolLanding.path)}">${escapeHtml(poolLanding.label)}</a> <span aria-hidden="true">/</span> `
    : "";
  const metaChips = poolChip + yearChip + runtimeChip + genreChips + licenseChip;

  const creators = record.creators.length > 0
    ? `<h2>Directors &amp; creators</h2><p>${record.creators.map(escapeHtml).join(", ")}</p>`
    : "";
  const subjects = record.subjects.length > 0
    ? `<h2>Subjects</h2><p>${record.subjects.map(escapeHtml).join(", ")}</p>`
    : "";
  const about = record.description
    ? `<h2>About this film</h2><p class="movie-desc">${escapeHtml(record.description)}</p>`
    : "";

  // Affiliate slot: only rendered when the film is NOT freely watchable. Every catalog film
  // passes the license gate, so this stays empty by design (constitution §10, vow 8).
  const affiliate = affiliateLink(title, amazonTag);
  const affiliateHtml = affiliate
    ? `<div class="affiliate-slot">
  <p class="affiliate-note">${escapeHtml(affiliate.disclosure)}</p>
  <a class="affiliate-link" href="${escapeHtml(affiliate.url)}" target="_blank" rel="${affiliate.rel}">Rent or buy ${escapeHtml(title)}</a>
</div>`
    : "";

  // Patreon: a second support rail, rendered only when PATREON_URL is configured (same
  // config-gated precedent as the affiliate tag — dormant by default, never a placeholder).
  // https + patreon host only, so a misconfigured binding can never inject markup.
  const patreonHref = /^https:\/\/(www\.)?patreon\.com\//.test(patreonUrl ?? "") ? (patreonUrl as string) : null;
  const patreonHtml = patreonHref
    ? `<a class="support-box" href="${escapeHtml(patreonHref)}" target="_blank" rel="noopener">&#127912; Support the booth on Patreon</a>`
    : "";

  // More like this: the first subject tag short enough to be a useful related-search phrase
  // (skip collection-name-ish tags). App.js fetches /api/browse?subject=… client-side.
  const relatedSubject =
    record.subjects.find((s) => s.length > 2 && s.length <= 40 && !/\b(feature|silent|short|documentary) films?\b/i.test(s)) ?? "";

  // "More from this pool" row (bottom): the heading + See-all link are server-rendered and
  // always present (the internal-linking strip), while the item grid is filled client-side
  // from /api/browse?<pool>=1 by app.js (same pattern as "More like this"). data-pool carries
  // the variant key; data-exclude drops the item the visitor is already on. The grid ships
  // hidden and only unhides when it has items (fail closed).
  const poolStrip = poolLanding
    ? `<section class="section" id="pool-section" data-pool="${escapeHtml(record.pool ?? "")}" data-exclude="${escapeHtml(id)}">
  <p class="section-eyebrow">More from this pool</p>
  <div class="section-head">
    <h2>${escapeHtml(poolLanding.label)}</h2>
    <a class="see-all" href="${escapeHtml(poolLanding.path)}">See all &rarr;</a>
  </div>
  <div class="grid" id="pool-more" hidden></div>
</section>`
    : "";

  // Archive titles often already contain the year ("It (1927)"); avoid doubling it.
  const yearSuffix = record.year && !title.includes(String(record.year)) ? ` (${escapeHtml(String(record.year))})` : "";
  const pageTitle = `${title}${yearSuffix}`;

  // The player is the above-the-fold LCP element: eager + high fetch priority (no lazy — a
  // lazy hint defers the embed fetch; the poster below is preloaded in <head> by pageShell).
  // Old Time Radio items are audio-only: the same embed URL renders archive.org's audio
  // player, and the native swap becomes an <audio> element (data-kind drives app.js).
  const kind = record.hasVideo ? "video" : "audio";
  const verb = kind === "audio" ? "Listen to" : "Watch";
  // Audio badge in the hero: a Surprise-me landing on radio/music must be instantly
  // recognizable as audio. The 🎧 + filled accent pill make the media type explicit at the
  // hero level (the "Now playing" eyebrow is subtle); the .chip--pool below still names the
  // specific pool and links it. Video items get no badge (poster + player already say so).
  const audioBadge =
    kind === "audio"
      ? `<span class="hero-badge hero-badge--audio"><span aria-hidden="true">🎧</span> Audio</span>`
      : "";
  const player = `<div class="player-wrap">
  <div id="resume-chip" class="resume-chip" hidden></div>
  <iframe class="player" src="https://archive.org/embed/${encodeURIComponent(id)}" title="${verb} ${escapeHtml(title)}" allow="fullscreen" frameborder="0" fetchpriority="high"></iframe>
</div>`;

  const body = `<div class="container">
  <div class="movie">
    <div class="movie-main">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> <span aria-hidden="true">/</span> ${poolCrumb}<span aria-current="page">${escapeHtml(title)}</span></nav>
      ${player}
      ${playbackTools(record, kind)}
      <div class="movie-head">
        <p class="now-showing">${kind === "audio" ? "Now playing" : "Now showing"}</p>
        ${audioBadge}
        <h1>${escapeHtml(title)}</h1>
        <div class="movie-meta">${metaChips}</div>
        <button type="button" class="watch-btn watch-btn--hero" data-watch-id="${escapeHtml(id)}" data-watch-title="${escapeHtml(title)}" data-watch-year="${escapeHtml(String(record.year ?? ""))}" data-watch-thumb="${escapeHtml(record.thumbnails.small)}" aria-pressed="false">Save</button>
      </div>
      <div class="movie-body">
        <img class="movie-poster" src="${escapeHtml(record.thumbnails.medium)}" alt="Poster for ${escapeHtml(title)}" width="600" height="800" fetchpriority="high">
        <div class="movie-info">
          ${about}
          ${creators}
          ${subjects}
          <p><a class="source-link" href="${escapeHtml(record.source_url)}" target="_blank" rel="noopener">View on archive.org &nearr;</a></p>
        </div>
      </div>
    </div>
    <aside class="movie-side">
      <!-- Ad slot: sidebar, reserved for a compliant ad network. Nothing renders here until one is configured (constitution §4, vow 2: ads never interrupt the movie). -->
      <div class="ad-slot ad-slot--sidebar" data-ad-slot="sidebar" role="complementary" aria-label="Advertisement slot">
        <span class="ad-slot__label">Advertisement</span>
        <span class="ad-slot__note">This reserved slot is never placed over or inside a film. <a class="ad-slot__cta" href="mailto:contactae2000@gmail.com?subject=Advertising%20inquiry">Email us about advertising &rarr;</a></span>
      </div>
      <div class="ad-slot ad-slot--sidebar" data-ad-slot="sidebar-2" role="complementary" aria-label="Advertisement slot 2">
        <span class="ad-slot__label">Advertisement</span>
        <span class="ad-slot__note">This reserved slot is never placed over or inside a film. <a class="ad-slot__cta" href="mailto:contactae2000@gmail.com?subject=Advertising%20inquiry">Email us about advertising &rarr;</a></span>
      </div>
      <a class="support-box" href="https://buymeacoffee.com/347movies" target="_blank" rel="noopener">☕ Buy me a coffee — keep the booth running</a>
      ${affiliateHtml}
      ${patreonHtml}
    </aside>
  </div>
  ${poolStrip}
  <!-- More like this: filled client-side from the first usable subject tag (app.js fetches
       /api/browse?subject=…). Ships hidden until a related row actually renders. -->
  <section class="section" id="related-section" data-subject="${escapeHtml(relatedSubject)}" hidden>
    <p class="section-eyebrow">More from the vault</p>
    <div class="section-head">
      <h2>More like this</h2>
    </div>
    <div class="grid" id="related"></div>
  </section>
</div>`;

  const description = record.description
    ? truncatePlain(record.description, 300)
    : `Watch ${title} free — a public domain or Creative Commons film embedded from the Internet Archive.`;

  const siteBase = siteUrl.replace(/\/$/, "");

  // schema.org structured data in a JSON-LD data block: a BreadcrumbList (Home → Pool → Title) plus
  // the VideoObject shape Google uses for video indexing and rich results — or AudioObject
  // for Old Time Radio items. uploadDate is the real archive.org added date; duration is
  // derived from the real runtime. Both are omitted when unavailable — never fabricated.
  const breadcrumbItems: Array<Record<string, unknown>> = [
    { "@type": "ListItem", position: 1, name: "Home", item: `${siteBase}/` },
  ];
  if (poolLanding) {
    breadcrumbItems.push({
      "@type": "ListItem",
      position: 2,
      name: poolLanding.label,
      item: `${siteBase}${poolLanding.path}`,
    });
  }
  breadcrumbItems.push({
    "@type": "ListItem",
    position: breadcrumbItems.length + 1,
    name: pageTitle,
    item: `${siteBase}/movie/${encodeURIComponent(id)}`,
  });
  const breadcrumb: Record<string, unknown> = {
    "@type": "BreadcrumbList",
    itemListElement: breadcrumbItems,
  };
  const media: Record<string, unknown> = {
    "@type": kind === "audio" ? "AudioObject" : "VideoObject",
    name: `${pageTitle} — ${kind === "audio" ? "listen" : "watch"} free on 347movies`,
    description,
    thumbnailUrl: record.thumbnails.large,
    embedUrl: `https://archive.org/embed/${encodeURIComponent(id)}`,
  };
  if (record.addeddate) media["uploadDate"] = record.addeddate;
  if (record.runtimeSeconds) media["duration"] = isoDuration(record.runtimeSeconds);
  if (record.genres.length > 0) media["genre"] = record.genres;
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@graph": [breadcrumb, media],
  };

  return pageShell(
    {
      title: `${pageTitle} — watch free on 347movies`,
      description,
      canonicalPath: `/movie/${encodeURIComponent(id)}`,
      og: {
        type: "video.movie",
        title: `${pageTitle} — free on 347movies`,
        description,
        image: record.thumbnails.large,
      },
      jsonLd,
      preloadImage: record.thumbnails.medium,
    },
    body,
    siteUrl,
  );
}

/**
 * Playback controls for the movie page: a quality selector (the item's playable video or
 * audio derivatives) and a server selector (embed player vs a direct stream vs the mirror
 * node). `kind` is "video" or "audio" — audio (Old Time Radio) swaps in a native <audio>
 * element via data-kind, video a native <video>. The embed iframe stays the default and
 * no-JS path. Rendered only when the item has at least one playable derivative.
 */
function playbackTools(record: MovieRecord, kind: "video" | "audio"): string {
  const files = kind === "audio" ? record.audioFiles : record.videoFiles;
  if (files.length === 0) return "";
  const id = record.identifier;
  const title = record.title || "film";
  // `server` + `dir` pin the direct node (verified live: 206 on Range requests), giving a
  // real fallback when the canonical download endpoint redirects into an overloaded node.
  const mirrorBase = record.server && record.dir ? `https://${record.server}${record.dir}` : "";

  const qualityOptions = files
    .map((f) => `<option value="${escapeHtml(f.path)}">${escapeHtml(f.label)}</option>`)
    .join("");
  const quality = files.length >= 2
    ? `<div class="player-tools__control">
  <label for="player-quality">Quality</label>
  <select id="player-quality" class="player-quality">${qualityOptions}</select>
</div>`
    : "";

  const mirrorOption = mirrorBase
    ? `<option value="mirror">Mirror node</option>`
    : "";
  const server = `<div class="player-tools__control">
  <label for="player-server">Server</label>
  <select id="player-server" class="player-server" data-mirror="${escapeHtml(mirrorBase)}">
    <option value="embed" selected>Embed player</option>
    <option value="cdn">Direct stream</option>
    ${mirrorOption}
  </select>
</div>`;

  return `<div class="player-tools" role="group" aria-label="Playback options" data-kind="${kind}" data-identifier="${escapeHtml(id)}" data-path="${escapeHtml(files[0]?.path ?? "")}" data-title="${escapeHtml(title)}" data-poster="${escapeHtml(record.thumbnails.medium)}">
  ${quality}
  ${server}
</div>`;
}

/** Seconds -> ISO 8601 duration ("PT1H12M"), the format schema.org expects. */
function isoDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  let out = "PT";
  if (h > 0) out += `${h}H`;
  if (m > 0) out += `${m}M`;
  if (s > 0) out += `${s}S`;
  return out;
}

/**
 * Rendered when a catalog item is legal but has no playable video derivative on archive.org
 * (verified: a small but real subset — e.g. `mrs.-pumpkin`, a PD-marked item with zero video
 * files). Showing a dead player would be a broken experience, so instead we explain honestly,
 * link to the source item, and keep the page out of search indexes (noindex).
 */
export function renderMovieNoVideo(record: MovieRecord, siteUrl: string): string {
  const title = record.title || "Untitled";
  const body = `<div class="container">
  <div class="notfound">
    <h1>No playable video</h1>
    <p><strong>${escapeHtml(title)}</strong> is in the catalog, but archive.org currently has no playable video for this item — only non-video files (audio, text, or images).</p>
    <p>You can still view the item on archive.org: <a class="source-link" href="${escapeHtml(record.source_url)}" target="_blank" rel="noopener">${escapeHtml(title)} on archive.org &nearr;</a></p>
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> <span aria-hidden="true">/</span> <span aria-current="page">${escapeHtml(title)}</span></nav>
  </div>
</div>`;
  return pageShell(
    { title: `${title} — no playable video · 347movies`, description: `${title} is not playable here because archive.org has no video for it.`, canonicalPath: `/movie/${encodeURIComponent(record.identifier)}`, noindex: true },
    body,
    siteUrl,
  );
}

/**
 * Fail-closed page for non-200 movie lookups. The message is honest per failure class:
 * a 5xx is an upstream archive.org outage (with the source link as a way out — verified live:
 * items like `chevrolet` hang at archive.org's metadata endpoint for 30s+), while a 404 is
 * a genuinely unavailable/unverifiable film. Never claims a legality problem for an outage.
 */
export function renderMovieUnavailable(status: number, siteUrl: string, identifier?: string): string {
  const sourceLink = identifier
    ? `<p>You can still try the item directly on archive.org: <a class="source-link" href="https://archive.org/details/${encodeURIComponent(identifier)}" target="_blank" rel="noopener">view on archive.org &nearr;</a></p>`
    : "";
  const isUpstream = status >= 500;
  const body = `<div class="container">
  <div class="notfound">
    <h1>${status}</h1>
    ${isUpstream
      ? `<p>The Internet Archive did not respond in time, so we could not load this film right now. This is an upstream outage, not a licensing problem — please try again in a moment.</p>`
      : `<p>This film is not available in the 347movies catalog. It may have been removed from the Internet Archive, or we could not verify that it is legally free to watch.</p>`}
    ${sourceLink}
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> <span aria-hidden="true">/</span> <span aria-current="page">${isUpstream ? "Temporarily unavailable" : "Film unavailable"}</span></nav>
  </div>
</div>`;
  const title = isUpstream ? "Temporarily unavailable — 347movies" : "Film unavailable — 347movies";
  const description = isUpstream
    ? "The Internet Archive did not respond in time. Please try again shortly."
    : "This film is not available in the 347movies catalog.";
  return pageShell(
    { title, description, canonicalPath: "/", noindex: true },
    body,
    siteUrl,
  );
}

function truncatePlain(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "…";
}
