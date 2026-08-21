"use strict";

/* 347movies front-end. External only (CSP script-src 'self'); no inline handlers, no innerHTML
   with unescaped data, no unhandled rejections. All catalog data comes from our own /api routes,
   which are the only place that talks to archive.org. */

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => {
      switch (c) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        default:
          return "&#39;";
      }
    });
  }

  /* Transient-failure resilience: the home page (and other grids) fire several /api
     requests at once; on a cold colocation they share a handful of heavy index builds
     that can outlive Cloudflare's per-request budget, aborting the connection (fetch
     throws → status 0). A short backoff lets the in-flight build finish (it is
     single-flighted in lib/catalog-index.ts) so the retry lands on the now-warm response
     instead of surfacing an error. Only status 0 (network) and upstream 5xx retry; 4xx —
     including 429 — are deterministic or rate-limited and must not be hammered. */
  async function apiFetch(path) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(path, { headers: { Accept: "application/json" } });
      } catch {
        const err = Object.assign(new Error("We couldn't reach the film catalog. Check your connection and try again."), { status: 0 });
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        throw err;
      }
      if (!res.ok) {
        let message = "Something went wrong loading films. Please try again.";
        try {
          const body = await res.json();
          if (body && typeof body.message === "string") message = body.message;
        } catch {
          /* keep the default message */
        }
        if (res.status === 429) {
          message = "Too many requests — please wait a moment and try again.";
        }
        const err = Object.assign(new Error(message), { status: res.status });
        if (attempt < 2 && res.status >= 500 && res.status < 600) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        throw err;
      }
      return res.json();
    }
  }

  /* ---------- ad loader (Decision 001, T4.3, enabled per T4.5: fail-closed, dormant
     until the owner configures AD_NETWORK_SCRIPT + AD_SLOT_IDS) ----------
     Fetches the config gate on every page view; when the server reports enabled, renders an
     AdSense unit into each reserved slot that has a configured id (DOM APIs only — never
     innerHTML with config values), then injects the network's async script ONCE into
     <head>, then pushes one `(adsbygoogle=[]).push({})` per unit (the AdSense fill
     protocol: units are filled in DOM order). Any failure — network error, 429, disabled,
     malformed — renders nothing: the reserved slots keep their note, the page is
     untouched. Async injection never blocks parsing; a failed or hanging network leaves
     the note in place (the fail-closed UI). */
  function bootstrapAds() {
    fetch("/api/ad-config", { headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : null))
      .then((cfg) => {
        // Defense in depth: the server already https-validates + allowlists the URL, but
        // the client independently requires https before injecting anything.
        if (!cfg || cfg.enabled !== true || typeof cfg.scriptUrl !== "string") return;
        if (!/^https:\/\//.test(cfg.scriptUrl)) return;
        const clientId = typeof cfg.clientId === "string" ? cfg.clientId : "";
        const slots = cfg.slots && typeof cfg.slots === "object" ? cfg.slots : {};
        if (!clientId) return;
        // 1. Render a unit into every reserved slot that has a configured id.
        document.querySelectorAll("[data-ad-slot]").forEach((container) => {
          const unitId = slots[container.getAttribute("data-ad-slot")];
          if (!unitId) return;
          const ins = document.createElement("ins");
          ins.className = "adsbygoogle";
          ins.style.display = "block";
          ins.dataset.adClient = clientId;
          ins.dataset.adSlot = String(unitId);
          ins.dataset.adFormat = "auto";
          ins.dataset.fullWidthResponsive = "true";
          container.classList.add("is-filled");
          container.replaceChildren(ins);
        });
        // 2. Load the network loader (async, never blocks parsing).
        const tag = document.createElement("script");
        tag.async = true;
        tag.src = cfg.scriptUrl;
        tag.crossOrigin = "anonymous";
        tag.dataset.adNetwork = "true";
        document.head.appendChild(tag);
        // 3. Push once per rendered unit, in DOM order (AdSense fill protocol). Pushes
        // queue on window.adsbygoogle until the loader script arrives, so ordering is
        // safe even when the loader is still fetching.
        try {
          const units = document.querySelectorAll(".ad-slot.is-filled ins.adsbygoogle");
          for (let i = 0; i < units.length; i++) {
            (window.adsbygoogle = window.adsbygoogle || []).push({});
          }
        } catch {
          /* fail closed: units stay empty, slot keeps its reserved size */
        }
      })
      .catch(() => {
        /* fail closed: the reserved note stays, no third-party script is injected */
      });
  }
  bootstrapAds();

  /* ---------- watchlist (privacy by default: localStorage only, never sent to any server) ---------- */
  const WATCH_KEY = "347movies.watchlist.v1";
  const WATCH_MAX = 200;

  function watchLoad() {
    try {
      const raw = localStorage.getItem(WATCH_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter((x) => x && typeof x.id === "string" && x.id) : [];
    } catch {
      return [];
    }
  }

  function watchSave(list) {
    try {
      localStorage.setItem(WATCH_KEY, JSON.stringify(list.slice(0, WATCH_MAX)));
    } catch {
      /* storage unavailable (private mode, quota): the feature degrades silently */
    }
  }

  function watchHas(id) {
    return watchLoad().some((x) => x.id === id);
  }

  function watchToggle(item) {
    const list = watchLoad();
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list.splice(i, 1);
    else list.unshift(item);
    watchSave(list);
    return i < 0;
  }

  function watchItemFromEl(btn) {
    return {
      id: btn.dataset.watchId,
      title: btn.dataset.watchTitle || "Untitled",
      year: btn.dataset.watchYear || "",
      thumb: btn.dataset.watchThumb || "",
    };
  }

  function watchBtnHtml(item, saved) {
    return `<button type="button" class="watch-btn${saved ? " is-saved" : ""}" data-watch-id="${escapeHtml(item.id)}" data-watch-title="${escapeHtml(item.title)}" data-watch-year="${escapeHtml(item.year)}" data-watch-thumb="${escapeHtml(item.thumb)}" aria-pressed="${saved ? "true" : "false"}">${saved ? "Saved" : "Save"}</button>`;
  }

  /* ---------- continue watching (privacy by default: localStorage only, never sent
     anywhere — same vow as the watchlist) ----------
     Playback position is tracked only on the native <video> path (Direct stream / Mirror
     node). The default embed iframe is cross-origin — archive.org's player owns its own
     time and exposes none of it to this page — so embed-only viewers record nothing.
     Entries are {id, title, thumb, pos, dur, at}; most recent first, capped at 20. */
  const PROGRESS_KEY = "347movies.progress.v1";
  const PROGRESS_MAX = 20;

  function progressLoad() {
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr)
        ? arr.filter((x) => x && typeof x.id === "string" && x.id && typeof x.pos === "number" && Number.isFinite(x.pos))
        : [];
    } catch {
      return [];
    }
  }

  function progressSave(list) {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(list.slice(0, PROGRESS_MAX)));
    } catch {
      /* storage unavailable (private mode, quota): the feature degrades silently */
    }
  }

  function progressUpdate(item) {
    const list = progressLoad();
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list.splice(i, 1);
    list.unshift({
      id: item.id,
      title: item.title || "Untitled",
      thumb: item.thumb || "",
      pos: Math.max(0, item.pos),
      dur: item.dur > 0 ? item.dur : 0,
      at: Date.now(),
    });
    progressSave(list);
  }

  function progressRemove(id) {
    const list = progressLoad();
    const next = list.filter((x) => x.id !== id);
    if (next.length !== list.length) progressSave(next);
  }

  function progressGet(id) {
    return progressLoad().find((x) => x.id === id) || null;
  }

  /* The single card builder — every movie card on the site (grids, watchlist, search,
     browse, genre) is this markup. Takes a normalized item {id, title, year, thumb} and
     whether the film is saved (drives the watch button state). */
  function cardShell(item, saved) {
    const title = item.title || "Untitled";
    const year = item.year ? `<span class="card__year">${escapeHtml(String(item.year))}</span>` : "";
    // Audio pools (OTR/music): an episode/track count + series tag chip from the server's
    // per-item enrichment (lib/audio-meta.ts). Only rendered when the server could derive
    // it — a missing chip means the metadata wasn't available, never a dead element.
    let meta = "";
    if (Number.isFinite(item.episodeCount) && item.episodeCount > 0) {
      const n = String(item.episodeCount);
      const label = item.seriesTag && item.seriesTag !== title
        ? `${escapeHtml(item.seriesTag)} · ${n} ep${item.episodeCount === 1 ? "" : "s"}`
        : `${n} ep${item.episodeCount === 1 ? "" : "s"}`;
      meta = `<span class="card__meta">${label}</span>`;
    }
    // The poster sits inside the link whose text is already the title, so it is decorative
    // there: empty alt avoids a duplicated accessible name ("Poster for X X"). data-title
    // keeps the initials fallback working when the image fails to load.
    const img = item.thumb
      ? `<img class="card__poster" src="${escapeHtml(item.thumb)}" alt="" data-title="${escapeHtml(title)}" loading="lazy" decoding="async">`
      : `<div class="card__poster card__poster--empty" aria-hidden="true">${escapeHtml(initialsOf(title))}</div>`;
    return `<div class="card"><a class="card__main" href="/movie/${encodeURIComponent(item.id)}">${img}<span class="card__body"><span class="card__title">${escapeHtml(title)}</span>${year}${meta}</span></a>${watchBtnHtml(item, saved)}</div>`;
  }

  function watchCardHtml(item) {
    return cardShell(item, true);
  }

  function bindWatchButtons(root, onToggle) {
    for (const btn of root.querySelectorAll(".watch-btn")) {
      btn.addEventListener("click", () => {
        const saved = watchToggle(watchItemFromEl(btn));
        if (typeof onToggle === "function") {
          onToggle();
          return;
        }
        btn.textContent = saved ? "Saved" : "Save";
        btn.setAttribute("aria-pressed", saved ? "true" : "false");
        btn.classList.toggle("is-saved", saved);
      });
    }
  }

  function movieCard(m) {
    // Normalize the API shape to the card's item shape; year/thumb are raw archive.org
    // metadata (untrusted third-party input): escape like every other field — a hostile
    // year must never reach the DOM (stored-XSS class fixed 2026-08-16). episodeCount is
    // a validated server number (audio pools only) — also escaped at render via cardShell.
    const item = {
      id: m.identifier,
      title: m && m.title ? String(m.title) : "Untitled",
      year: m.year || "",
      thumb: m && m.thumbnails && m.thumbnails.small ? String(m.thumbnails.small) : "",
      episodeCount: typeof m.episodeCount === "number" ? m.episodeCount : null,
      seriesTag: m && m.seriesTag ? String(m.seriesTag) : "",
    };
    return cardShell(item, watchHas(m.identifier));
  }

  /* Streaming-style title initials for the no-poster placeholder ("The Hands of Orlac" → "HO"). */
  function initialsOf(title) {
    const cleaned = String(title || "").replace(/\([^)]*\)/g, " ").trim();
    const words = cleaned.split(/\s+/).filter(Boolean);
    const meaningful = words.filter((w) => w.length > 1 && !/^(the|a|an|of|and)$/i.test(w));
    const source = meaningful.length >= 2 ? meaningful : words;
    return source.slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  }

  /*
   * Some catalog items have thumbnails that archive.org cannot serve (missing/504 metadata,
   * or the thumbnail fleet is degraded — observed this session: 502s and requests that hang
   * for 25s+). A failed request fires `error`; a hanging one fires nothing, so a poster box
   * would stay empty forever. This does three things:
   *   1. Retries a failed poster up to 2x (archive.org's fleet is intermittently flaky — a
   *      retry often lands on a healthy server), cache-busting so the browser won't replay
   *      the failed response.
   *   2. A loadstart watchdog: if a request starts but neither `load` nor `error` resolves
   *      it within 15s, force the initials placeholder so grids never show empty boxes.
   *   3. Anything still failing swaps to the initials placeholder (existing behavior).
   * Capture-phase delegation keeps this working across re-renders; CSP forbids inline
   * handlers, so this is the external-script way.
   */
  /* Poster-fallback telemetry (console-only, zero network): count how many posters on this
     page load had to fall back to the initials placeholder and log one summary line, so
     archive.org thumbnail degradation is quantifiable from the console. A 3s debounce
     collapses bursty fallbacks into a single line; a late (15s watchdog) hang re-arms and
     logs a follow-up line, so the final count reflects everything that actually fell back. */
  const posterHealth = { total: 0, fellBack: 0, timer: null };
  const emitPosterHealth = () => {
    if (posterHealth.total === 0) return;
    const pct = Math.round((posterHealth.fellBack / posterHealth.total) * 100);
    const msg = `[347movies] posters: ${posterHealth.fellBack}/${posterHealth.total} fell back to initials (${pct}%)`;
    (posterHealth.fellBack > 0 ? console.warn : console.info)(msg);
  };
  const schedulePosterHealth = () => {
    clearTimeout(posterHealth.timer);
    posterHealth.timer = setTimeout(emitPosterHealth, 3000);
  };

  const toPlaceholder = (img) => {
    if (img.dataset.fallbackDone === "1" || !img.isConnected) return;
    img.dataset.fallbackDone = "1";
    posterHealth.fellBack += 1;
    schedulePosterHealth();
    const placeholder = document.createElement("div");
    placeholder.setAttribute("aria-hidden", "true");
    if (img.classList.contains("card__poster")) {
      placeholder.className = "card__poster card__poster--empty";
      // Card posters are alt="" (decorative inside the title link) — the initials come
      // from data-title; the movie-page poster still carries a descriptive alt.
      placeholder.textContent = initialsOf(img.dataset.title || img.alt.replace(/^Poster for /, ""));
    } else {
      placeholder.className = "movie-poster movie-poster--empty";
      placeholder.textContent = initialsOf(img.alt.replace(/^Poster for /, ""));
    }
    img.replaceWith(placeholder);
  };

  const retryPoster = (img) => {
    const tries = parseInt(img.dataset.retry || "0", 10);
    if (tries >= 2) return false;
    img.dataset.retry = String(tries + 1);
    const sep = img.src.includes("?") ? "&" : "?";
    img.src = `${img.src}${sep}retry=${tries + 1}&ts=${Date.now()}`;
    return true;
  };

  // Watchdog: if a poster request starts but neither `load` nor `error` resolves it within
  // 15s, force the initials placeholder so grids never show empty boxes. A hanging request
  // (connection stalls, upstream degrades) fires neither `loadstart` nor `error` — verified
  // live this session — so arming on `loadstart` alone is unreliable. Instead:
  //   * Eager posters (the movie page) arm immediately — they're being fetched right now.
  //   * Lazy grid posters arm when the browser actually starts fetching them, signalled by
  //     the image entering the viewport (IntersectionObserver, 200px pre-margin) or a
  //     `loadstart` event, whichever comes first. Below-the-fold posters therefore never
  //     get timed out before they're even requested.
  const watchdog = (img) => {
    if (img.dataset.watched === "1") return;
    img.dataset.watched = "1";
    posterHealth.total += 1;
    schedulePosterHealth();
    let timer = null;
    let armed = false;
    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const arm = () => {
      if (armed) return;
      armed = true;
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        if (!img.complete && !img.dataset.fallbackDone && img.isConnected) toPlaceholder(img);
      }, 15000);
    };
    img.addEventListener("load", clearTimer);
    img.addEventListener("error", clearTimer); // the error path retries / falls back itself
    if (img.loading !== "lazy") {
      arm();
    } else if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              arm();
              io.disconnect();
            }
          }
        },
        { rootMargin: "200px" },
      );
      io.observe(img);
      img.addEventListener("loadstart", arm); // fallback if IO never fires
    } else {
      img.addEventListener("loadstart", arm);
    }
  };

  // Wire the watchdog onto every poster currently in the root. Called after each render so
  // newly created cards get armed (bindPosterFallbacks alone can't — it runs before the
  // grid's innerHTML is set). Idempotent per image via dataset.watched.
  const watchPosters = (root) => {
    for (const img of root.querySelectorAll("img.card__poster, img.movie-poster")) watchdog(img);
  };

  function bindPosterFallbacks(root) {
    if (root.dataset.posterFallback === "1") return;
    root.dataset.posterFallback = "1";

    // Capture-phase error delegation: retry transient failures, then fall back to initials.
    // The capture phase on a live root also catches errors from children created later, so
    // re-renders stay covered without rebinding.
    root.addEventListener(
      "error",
      (e) => {
        const img = e.target;
        if (!(img instanceof HTMLImageElement)) return;
        if (!img.classList.contains("card__poster") && !img.classList.contains("movie-poster")) return;
        if (img.dataset.fallbackDone === "1") return;
        if (retryPoster(img)) return; // re-request; a later load/error decides
        toPlaceholder(img);
      },
      true,
    );

    watchPosters(root);
  }

  function renderGrid(container, movies) {
    if (!container) return;
    bindPosterFallbacks(container);
    if (!movies || movies.length === 0) {
      // A curated home feed that is temporarily empty — direction, not a dead end.
      container.innerHTML = '<p class="empty">Nothing here yet — check back soon.</p>';
      container.setAttribute("aria-busy", "false");
      return;
    }
    container.innerHTML = movies.map(movieCard).join("");
    container.setAttribute("aria-busy", "false");
    watchPosters(container);
    bindWatchButtons(container);
  }

  function renderError(container, message, retry) {
    if (!container) return;
    const btn = typeof retry === "function" ? '<button type="button" class="retry">Try again</button>' : "";
    // role="alert" announces the failure to screen readers the moment it appears
    // (WCAG 3.3.1/4.1.3): errors are announced, not silently rendered.
    container.innerHTML = `<div class="error-box" role="alert"><p>${escapeHtml(message)}</p>${btn}</div>`;
    container.setAttribute("aria-busy", "false");
    if (typeof retry === "function") {
      const button = container.querySelector(".retry");
      if (button) button.addEventListener("click", retry);
    }
  }

  function paginationHtml(current, pages, makeUrl) {
    if (pages <= 1) return "";
    const prev = current > 1 ? `<a href="${makeUrl(current - 1)}" rel="prev">&larr; Previous</a>` : "<span>&larr; Previous</span>";
    const next = current < pages ? `<a href="${makeUrl(current + 1)}" rel="next">Next &rarr;</a>` : "<span>Next &rarr;</span>";
    return `<nav class="pagination" aria-label="Pagination">${prev}<span class="pagination__current">Page ${current} of ${pages}</span>${next}</nav>`;
  }

  /* Shared results rendering for browse + genre: the count line (honest about the
     100-page paging cap — the catalog is bigger than paging can reach) and the
     pagination nav. */
  function renderResults(grid, count, nav, data, makePageUrl) {
    if (grid) {
      if (data.total === 0) {
        // Empty filter view: point to the next step — the filters sit right above the grid.
        grid.innerHTML = '<p class="empty">No films match these filters — try different filters or a different sort.</p>';
        grid.setAttribute("aria-busy", "false");
      } else {
        renderGrid(grid, data.results);
      }
    }
    if (count) {
      const capped = data.total > data.pages * data.rows;
      count.textContent = capped
        ? `${data.total.toLocaleString()} films · showing the first ${(data.pages * data.rows).toLocaleString()}`
        : `${data.total.toLocaleString()} film${data.total === 1 ? "" : "s"}`;
    }
    if (nav) nav.innerHTML = paginationHtml(data.page, data.pages, makePageUrl);
  }

  /* ---------- home ---------- */
  function loadHomeSection(id, path) {
    const container = $("#" + id);
    if (!container) return;
    container.innerHTML = '<p class="empty">Loading films&hellip;</p>';
    apiFetch(path)
      .then((data) => renderGrid(container, data.results))
      .catch((err) => renderError(container, err.message, () => loadHomeSection(id, path)));
  }

  /* ---------- continue watching row (home) ----------
     The resume card mirrors cardShell's markup (poster, title, save button) plus a
     progress bar and a time-left label instead of the year. The section stays hidden
     (the section itself carries `hidden`) until there is at least one entry, so an
     empty session renders nothing at all. */
  function formatRemaining(entry) {
    const left = entry.dur > 0 ? entry.dur - entry.pos : 0;
    if (left <= 0) return "Continue";
    const mins = Math.max(1, Math.round(left / 60));
    if (mins < 60) return `${mins}m left`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m left`;
  }

  function resumeCard(entry) {
    const title = entry.title || "Untitled";
    const img = entry.thumb
      ? `<img class="card__poster" src="${escapeHtml(entry.thumb)}" alt="" data-title="${escapeHtml(title)}" loading="lazy" decoding="async">`
      : `<div class="card__poster card__poster--empty" aria-hidden="true">${escapeHtml(initialsOf(title))}</div>`;
    const frac = entry.dur > 0 && entry.pos < entry.dur ? Math.min(1, entry.pos / entry.dur) : 0;
    const pct = Math.round(frac * 100);
    const item = { id: entry.id, title, year: "", thumb: entry.thumb };
    return `<div class="card card--resume" data-progress-id="${escapeHtml(entry.id)}"><a class="card__main" href="/movie/${encodeURIComponent(entry.id)}">${img}<span class="card__body"><span class="card__title">${escapeHtml(title)}</span><span class="card__year">${escapeHtml(formatRemaining(entry))}</span></span></a>${watchBtnHtml(item, watchHas(entry.id))}<button type="button" class="resume-dismiss" data-dismiss-id="${escapeHtml(entry.id)}" aria-label="Remove ${escapeHtml(title)} from continue watching">\u00d7</button><span class="card__progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${pct}% watched"><span class="card__progress-bar" style="width:${pct}%"></span></span></div>`;
  }

  function renderContinueWatching() {
    const section = $("#continue-section");
    const grid = $("#continue");
    if (!section || !grid) return;
    const entries = progressLoad();
    if (entries.length === 0) {
      section.hidden = true;
      return;
    }
    grid.innerHTML = entries.map(resumeCard).join("");
    bindPosterFallbacks(grid);
    bindWatchButtons(grid);
    // Dismiss button: removes the entry from continue watching without finishing it.
    grid.addEventListener("click", (e) => {
      const btn = e.target.closest(".resume-dismiss");
      if (!btn) return;
      const id = btn.getAttribute("data-dismiss-id");
      if (!id) return;
      progressRemove(id);
      const card = btn.closest(".card--resume");
      if (card) {
        card.style.opacity = "0";
        card.style.transform = "scale(0.95)";
        setTimeout(() => {
          card.remove();
          // Hide the entire section if no cards remain.
          if (!grid.querySelector(".card--resume")) section.hidden = true;
        }, 200);
      }
    });
    section.hidden = false;
  }

  function initHome() {
    // Continue watching first: it is the visitor's own history, rendered from
    // localStorage before any network feed lands.
    renderContinueWatching();
    // films=1 excludes serial-episode uploads (podcasts etc.) from the curated showcase.
    // Modern picks leads: films released this century (2000–2029), sorted by addeddate so
    // the wave of new CC uploads (HK restorations, indies) lands first — without the
    // newly-uploaded-1950s noise that "Recently added" alone surfaces.
    loadHomeSection("modern", "/api/browse?from=2000&to=2020&sort=recent&films=1&page=1");
    // Hong Kong action: title-keyword feed (dubbed/subtitled/kung/shaolin/wong uploads —
    // the 2026 restoration wave), newest uploads first.
    loadHomeSection("hkaction", "/api/browse?q=dubbed+subtitled+kung+shaolin+wong&sort=recent&films=1&page=1");
    // Classic TV: the curated classic_tv collection under the same license gate — public
    // domain television (Twilight Zone, Bonanza, The Lone Ranger, The Beverly Hillbillies…),
    // newest uploads first. TV episodes ARE the content, so no films=1 here.
    loadHomeSection("tvclassics", "/api/browse?tv=1&sort=recent&page=1");
    // 1960s TV: the golden-age decade showcase, newest release years first (1969 → 1960).
    loadHomeSection("tv1960s", "/api/browse?tv=1&decade=1960&sort=newest&page=1");
    // Anime + cartoons: the licensed subsets of archive.org's anime and animationandcartoons
    // collections (same license gate as TV), newest uploads first.
    loadHomeSection("anime", "/api/browse?anime=1&sort=recent&page=1");
    loadHomeSection("cartoons", "/api/browse?cartoons=1&sort=recent&page=1");
    loadHomeSection("otr", "/api/browse?otr=1&sort=recent&page=1");
    loadHomeSection("music", "/api/browse?music=1&sort=recent&page=1");
    // Golden-age showcases: anime 1950s–70s (measured live 2026-08-17: 42 items) and
    // cartoons 1930s–40s (185 items), newest release years first.
    loadHomeSection("animegolden", "/api/browse?anime=1&from=1950&to=1970&sort=newest&page=1");
    loadHomeSection("cartoonsgolden", "/api/browse?cartoons=1&from=1930&to=1940&sort=newest&page=1");
    // Newsreels: the Prelinger newsreel subset (measured live 2026-08-17: 52 title-matched
    // items) — already inside the legal films pool, surfaced by title keyword.
    loadHomeSection("newsreels", "/api/browse?q=newsreel&sort=recent&page=1");
    loadHomeSection("recent", "/api/browse?sort=recent&films=1&page=1");
    loadHomeSection("noir", "/api/browse?genre=film-noir&sort=recent&page=1");
    loadHomeSection("silents", "/api/browse?decade=1920&sort=recent&page=1");
    // The four 2026-08-18 pools: documentaries/learning, sports, shorts, and the
    // dedicated silent_films collection (newest uploads first, like the other pools).
    loadHomeSection("documentaries", "/api/browse?documentaries=1&sort=recent&page=1");
    loadHomeSection("sports", "/api/browse?sports=1&sort=recent&page=1");
    loadHomeSection("shorts", "/api/browse?shorts=1&sort=recent&page=1");
    loadHomeSection("silentfilms", "/api/browse?silents=1&sort=recent&page=1");
    // 2026-08-18 pools (round 2): public broadcasting (AAPB) and science & medicine (Wellcome).
    loadHomeSection("publictv", "/api/browse?publictv=1&sort=recent&page=1");
    loadHomeSection("science", "/api/browse?science=1&sort=recent&page=1");
    // 2026-08-18 pools (round 3): government films (FedFlix) and audiobooks (LibriVox).
    loadHomeSection("govfilms", "/api/browse?govfilms=1&sort=recent&page=1");
    loadHomeSection("audiobooks", "/api/browse?audiobooks=1&sort=recent&page=1");
    // 2026-08-19: vintage records (Great 78 Project, pre-1927 shellac).
    loadHomeSection("records", "/api/browse?records=1&sort=recent&page=1");
    // 2026-08-19: ephemeral films (AV Geeks archive of sponsored/educational shorts).
    loadHomeSection("ephemera", "/api/browse?ephemera=1&sort=recent&page=1");
    // 2026-08-19: space & NASA (NASA's own public-domain space footage).
    loadHomeSection("space", "/api/browse?space=1&sort=recent&page=1");
    // 2026-08-21: TED Talks — a curated view of Documentaries (TED's real CC-licensed talks).
    loadHomeSection("ted", "/api/browse?ted=1&sort=recent&page=1");
  }

  /* ---------- search ---------- */
  function initSearch() {
    const params = new URLSearchParams(window.location.search);
    const q = (params.get("q") || "").trim();
    const tv = params.get("tv") === "1";
    const anime = params.get("anime") === "1";
    const cartoons = params.get("cartoons") === "1";
    const otr = params.get("otr") === "1";
    const music = params.get("music") === "1";
    const documentaries = params.get("documentaries") === "1";
    const ted = params.get("ted") === "1";
    const sports = params.get("sports") === "1";
    const shorts = params.get("shorts") === "1";
    const silents = params.get("silents") === "1";
    const publictv = params.get("publictv") === "1";
    const science = params.get("science") === "1";
    const govfilms = params.get("govfilms") === "1";
    const audiobooks = params.get("audiobooks") === "1";
    const records = params.get("records") === "1";
    const ephemera = params.get("ephemera") === "1";
    const space = params.get("space") === "1";
    const catalog = tv ? "tv" : anime ? "anime" : cartoons ? "cartoons" : otr ? "otr" : music ? "music" : documentaries ? "documentaries" : ted ? "ted" : sports ? "sports" : shorts ? "shorts" : silents ? "silents" : publictv ? "publictv" : science ? "science" : govfilms ? "govfilms" : audiobooks ? "audiobooks" : records ? "records" : ephemera ? "ephemera" : space ? "space" : null;
    // Per-pool display vocabulary (label + noun) for the search landing/result copy.
    const CATALOG_META = {
      tv: { label: "Classic TV", noun: "show" },
      anime: { label: "Anime", noun: "title" },
      cartoons: { label: "Cartoons", noun: "title" },
      otr: { label: "Old Time Radio", noun: "series" },
      music: { label: "Music & Concerts", noun: "recording" },
      documentaries: { label: "Documentaries", noun: "film" },
      ted: { label: "TED Talks", noun: "talk" },
      sports: { label: "Sports", noun: "film" },
      shorts: { label: "Shorts", noun: "short" },
      silents: { label: "Silent films", noun: "film" },
      publictv: { label: "Public Broadcasting", noun: "program" },
      science: { label: "Science & Medicine", noun: "film" },
      govfilms: { label: "Government Films", noun: "film" },
      audiobooks: { label: "Audiobooks", noun: "book" },
      records: { label: "Vintage Records", noun: "record" },
      ephemera: { label: "Ephemeral Films", noun: "film" },
      space: { label: "Space & NASA", noun: "film" },
    };
    const meta = catalog ? CATALOG_META[catalog] : null;
    const rawPage = parseInt(params.get("page") || "1", 10);
    const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;

    const input = $("#search-input");
    if (input) input.value = q;
    // The header form posts to /search?q=… — keep a serialized-pool search on its pool.
    if (catalog && input) {
      const form = input.closest("form");
      if (form && !form.querySelector(`input[name="${catalog}"]`)) {
        const hidden = document.createElement("input");
        hidden.type = "hidden";
        hidden.name = catalog;
        hidden.value = "1";
        form.appendChild(hidden);
      }
    }
    const head = $("#results-head");
    const count = $("#count");
    const grid = $("#results");
    const nav = $("#pagination");

    if (!q) {
      if (catalog) {
        // The "Search TV shows" shortcut: no query yet — browse the pool newest-first.
        if (head) head.textContent = `${meta.label} — newest first`;
        apiFetch(`/api/search?${catalog}=1&page=${page}`)
          .then((data) => {
            if (count) count.textContent = `${data.total.toLocaleString()} ${meta.noun}${data.total === 1 ? "" : "s"} in the ${meta.label.toLowerCase()} pool`;
            if (grid) renderGrid(grid, data.results);
            if (nav) {
              nav.innerHTML = paginationHtml(data.page, data.pages, (p) => `/search?${catalog}=1&page=${p}`);
            }
          })
          .catch((err) => renderError(grid, err.message));
        return;
      }
      if (head) head.textContent = "Search";
      if (grid) grid.innerHTML = '<p class="empty">Type a title, actor, or genre above to search the free catalog.</p>';
      return;
    }
    // The #results grid ships with a skeleton grid (see search.html) that reserves the
    // cards' space while this fetch runs, so results pop in without layout shift.

    const poolParam = catalog ? `&${catalog}=1` : "";
    apiFetch(`/api/search?q=${encodeURIComponent(q)}&page=${page}${poolParam}`)
      .then((data) => {
        if (head) head.textContent = catalog ? `${meta.label} · results for “${q}”` : `Results for “${q}”`;
        if (count) {
          count.textContent = `${data.total.toLocaleString()} ${catalog ? meta.noun : "film"}${data.total === 1 ? "" : "s"} found`;
        }
        if (grid) renderGrid(grid, data.results);
        if (data.total === 0 && grid) {
          grid.innerHTML = `<p class="empty">No free ${catalog ? `${meta.noun}s` : "films"} match “${escapeHtml(q)}”. Try another title, actor, or genre, or <a href="${catalog ? `/browse?${catalog}=1` : "/browse"}">browse the catalog</a>.</p>`;
          return;
        }
        if (nav) {
          nav.innerHTML = paginationHtml(data.page, data.pages, (p) => `/search?q=${encodeURIComponent(q)}&page=${p}${poolParam}`);
        }
      })
      .catch((err) => {
        renderError(grid, err.message);
        if (head) head.textContent = catalog ? `${meta.label} search` : "Search";
      });
  }

  /* ---------- movie detail ---------- */
  /* Quality + server playback controls. The native <video> is the default for tracking
     and quality control; the embed iframe remains the no-JS fallback and the embed option
     in the server selector. A visitor can always switch back to the embed if they prefer. */
  const SERVER_PREF_KEY = "347movies.serverPref";
  function initPlaybackTools() {
    const tools = $(".player-tools");
    if (!tools) return;
    const wrap = $(".player-wrap");
    const server = tools.querySelector(".player-server");
    if (!wrap || !server) return;
    const quality = tools.querySelector(".player-quality");
    const kind = tools.getAttribute("data-kind") === "audio" ? "audio" : "video";
    const identifier = tools.getAttribute("data-identifier") || "";
    const title = tools.getAttribute("data-title") || "film";
    const poster = tools.getAttribute("data-poster") || "";
    const defaultPath = tools.getAttribute("data-path") || "";
    const mirrorBase = server.getAttribute("data-mirror") || "";
    const origIframe = wrap.querySelector("iframe.player");

    function srcFor(mode, path) {
      const base = mode === "mirror" && mirrorBase
        ? mirrorBase
        : `https://archive.org/download/${encodeURIComponent(identifier)}`;
      return `${base}/${path}`;
    }

    // Continue-watching tracking: the native <video> path is observable (the embed iframe
    // is cross-origin and keeps its own time). Saved positions drive both the resume seek
    // below and the home-page "Continue watching" row.
    let activeVideo = null;
    const savedEntry = progressGet(identifier);

    function track(video) {
      activeVideo = video;
      // Resume: seek to the saved position once metadata is known. The 30s guard skips
      // near-start bookmarks (a visitor who peeked and left doesn't want to be dropped
      // 5 seconds before the opening credits); the 30s-from-the-end guard treats a film
      // as effectively finished.
      video.addEventListener("loadedmetadata", () => {
        if (savedEntry && savedEntry.pos > 30 && (savedEntry.dur === 0 || savedEntry.pos < savedEntry.dur - 30)) {
          try {
            video.currentTime = savedEntry.pos;
          } catch {
            /* seek can fail before the source is ready — the visitor can scrub manually */
          }
        }
      });
      // Throttled saves (≤1 per 5s) of the position; the first 10s of playback are not
      // recorded so a stray click doesn't bookmark the opening frame. `ended` clears the
      // entry — a finished film leaves the Continue row.
      let lastSaveAt = 0;
      video.addEventListener("timeupdate", () => {
        if (video.ended) {
          progressRemove(identifier);
          return;
        }
        const now = Date.now();
        if (now - lastSaveAt < 5000 || video.currentTime < 10) return;
        lastSaveAt = now;
        progressUpdate({ id: identifier, title, thumb: poster, pos: video.currentTime, dur: video.duration || 0 });
      });
      video.addEventListener("ended", () => progressRemove(identifier));
    }

    // One final save when the page goes away, so a visitor who closes the tab mid-scene
    // is resumed where they actually were, not 5s stale.
    window.addEventListener("pagehide", () => {
      const v = activeVideo;
      if (v && !v.ended && v.currentTime > 10) {
        progressUpdate({ id: identifier, title, thumb: poster, pos: v.currentTime, dur: v.duration || 0 });
      }
    });

    function apply() {
      const mode = server.value;
      if (mode === "embed") {
        if (origIframe && wrap.querySelector("video.player")) wrap.replaceChildren(origIframe);
        return;
      }
      const path = quality ? quality.value : defaultPath;
      if (!path) return;
      // Old Time Radio items are audio: the native swap becomes an <audio> element (the
      // same embed iframe renders archive.org's audio player as the default).
      const el = document.createElement(kind === "audio" ? "audio" : "video");
      el.className = kind === "audio" ? "player player--audio" : "player player--video";
      el.controls = true;
      el.playsInline = true;
      el.preload = "metadata";
      if (poster) el.poster = poster;
      el.src = srcFor(mode, path);
      el.setAttribute("aria-label", `${kind === "audio" ? "Listen to" : "Watch"} ${title}`);
      wrap.replaceChildren(el);
      track(el);
    }

    // Restore the visitor's preferred server, then default to native for new visitors.
    let pref = "cdn";
    try {
      const stored = localStorage.getItem(SERVER_PREF_KEY);
      if (stored === "embed" || stored === "cdn" || stored === "mirror") pref = stored;
    } catch { /* storage unavailable */ }
    // Only apply if mirror is actually available; fall back to cdn otherwise.
    if (pref === "mirror" && !mirrorBase) pref = "cdn";
    server.value = pref;

    server.addEventListener("change", () => {
      try { localStorage.setItem(SERVER_PREF_KEY, server.value); } catch { /* ignore */ }
      apply();
    });
    if (quality) {
      quality.addEventListener("change", () => {
        // A quality choice only matters in direct mode; from embed, flip to direct so it
        // takes effect immediately instead of being silently ignored.
        if (server.value === "embed") server.value = "cdn";
        apply();
      });
    }

    // Apply the saved preference on load so tracking and quality control work immediately.
    apply();
  }

  function formatPosition(seconds) {
    if (!seconds || seconds <= 0) return "0:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  function initMovie() {
    initPlaybackTools();
    // Resume chip: show when there's a saved position for this identifier.
    const resumeChip = $("#resume-chip");
    if (resumeChip) {
      const identifier = resumeChip.closest(".player-wrap")?.querySelector(".player-tools")?.getAttribute("data-identifier") || "";
      const entry = identifier ? progressGet(identifier) : null;
      if (entry && entry.pos > 30 && (entry.dur === 0 || entry.pos < entry.dur - 30)) {
        resumeChip.textContent = `Resume at ${formatPosition(entry.pos)}`;
        resumeChip.hidden = false;
        resumeChip.addEventListener("click", () => {
          // The native player auto-seeks on loadedmetadata; this click just scrolls to it.
          resumeChip.closest(".player-wrap")?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      }
    }
    const poster = $(".movie-poster");
    if (poster && poster.parentElement) bindPosterFallbacks(poster.parentElement);
    // More like this: fetch /api/browse?subject=<first usable subject tag> and render a
    // related row; hide the section when the subject yields nothing (it ships hidden).
    const relatedSection = $("#related-section");
    const relatedGrid = $("#related");
    if (relatedSection && relatedGrid) {
      const subject = (relatedSection.getAttribute("data-subject") || "").trim();
      if (subject) {
        apiFetch(`/api/browse?subject=${encodeURIComponent(subject)}&sort=newest&page=1`)
          .then((data) => {
            if (!data.results || data.results.length === 0) return;
            renderGrid(relatedGrid, data.results.slice(0, 8));
            relatedSection.hidden = false;
          })
          .catch(() => {
            /* fail closed: the related row stays hidden */
          });
      }
    }
    // More from this pool: fill the grid client-side from /api/browse?<pool>=1 (the item's
    // curated pool), excluding the item the visitor is already on. The heading + See-all link
    // are server-rendered; the grid ships hidden and only shows when it has items (fail closed).
    const poolSection = $("#pool-section");
    const poolGrid = $("#pool-more");
    if (poolSection && poolGrid) {
      const pool = (poolSection.getAttribute("data-pool") || "").trim();
      const exclude = (poolSection.getAttribute("data-exclude") || "").trim();
      if (pool) {
        const params = new URLSearchParams({ page: "1", sort: "recent" });
        if (pool !== "films") params.set(pool, "1");
        apiFetch(`/api/browse?${params.toString()}`)
          .then((data) => {
            const items = (data.results || [])
              .filter((r) => r && r.identifier !== exclude)
              .slice(0, 8);
            if (items.length === 0) return;
            renderGrid(poolGrid, items);
            poolGrid.hidden = false;
          })
          .catch(() => {
            /* fail closed: the row stays hidden */
          });
      }
    }
    // The player is a cross-origin iframe: focus inside the archive.org embed does NOT
    // propagate :focus-visible/:focus-within to the parent in every engine (verified
    // headless: activeElement is the iframe yet matches(':focus') is false), so a keyboard
    // user could Tab to the player and see no ring. The reliable parent signals are
    // focusout with relatedTarget=null (focus left the document — into the iframe or the
    // browser chrome) plus window blur; a tick later, activeElement disambiguates. Any
    // focus returning to the parent clears the ring.
    const playerWrap = $(".player-wrap");
    if (playerWrap) {
      const player = playerWrap.querySelector("iframe.player");
      const markFocused = () => {
        if (document.activeElement === player) playerWrap.classList.add("is-focused");
      };
      document.addEventListener("focusout", (e) => {
        if (e.relatedTarget === null) setTimeout(markFocused, 0);
      });
      window.addEventListener("blur", markFocused);
      document.addEventListener("focusin", () => playerWrap.classList.remove("is-focused"));
    }
    const btn = $(".watch-btn[data-watch-id]");
    if (!btn) return;
    const item = watchItemFromEl(btn);
    const saved = watchHas(item.id);
    btn.textContent = saved ? "Saved" : "Save";
    btn.setAttribute("aria-pressed", saved ? "true" : "false");
    btn.classList.toggle("is-saved", saved);
    btn.addEventListener("click", () => {
      const isSaved = watchToggle(item);
      btn.textContent = isSaved ? "Saved" : "Save";
      btn.setAttribute("aria-pressed", isSaved ? "true" : "false");
      btn.classList.toggle("is-saved", isSaved);
    });
  }

  /* ---------- watchlist export/import (server-free: a file, never a server) ----------
     Vow 5: nothing leaves the browser. Export serializes the localStorage list to a JSON
     file the viewer owns; import validates a file's every entry against the same strict
     shape watchLoad uses, and only then replaces the local list. Import is destructive
     (it replaces saved data) so it confirms first, like Clear. */
  function watchStatus(message) {
    const el = $("#watchlist-status");
    if (el) el.textContent = message;
  }

  function watchExport() {
    const list = watchLoad();
    const payload = { app: "347movies", version: 1, exported: new Date().toISOString(), films: list };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `347movies-watchlist-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    watchStatus(`Exported ${list.length} film${list.length === 1 ? "" : "s"} to a backup file — nothing left this browser.`);
  }

  function watchImport(file) {
    // The file is untrusted input: parse defensively, validate every entry, and only
    // then touch storage. Any failure leaves the current list untouched.
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(String(reader.result || ""));
      } catch {
        watchStatus("Import failed — that file isn't valid JSON. Your list was not changed. Use a file exported from the Watchlist page.");
        return;
      }
      const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed && parsed.films) ? parsed.films : [];
      const cleaned = arr
        .filter((x) => x && typeof x.id === "string" && x.id)
        .slice(0, WATCH_MAX)
        .map((x) => ({
          id: x.id,
          title: typeof x.title === "string" ? x.title : "Untitled",
          year: typeof x.year === "string" ? x.year : x.year != null ? String(x.year) : "",
          thumb: typeof x.thumb === "string" ? x.thumb : "",
        }));
      if (cleaned.length === 0) {
        watchStatus("Import failed — that file has no films this site can read. Your list was not changed. Use a file exported from the Watchlist page.");
        return;
      }
      watchSave(cleaned);
      renderWatchlist($("#watchlist"));
      watchStatus(`Imported ${cleaned.length} film${cleaned.length === 1 ? "" : "s"} — your list now lives only in this browser.`);
    };
    reader.readAsText(file);
  }

  /* ---------- watchlist page ---------- */
  function renderWatchlist(container) {
    bindPosterFallbacks(container);
    const list = watchLoad();
    // A "Clear watchlist" button on an empty list is a dead control — hide it.
    const clearBtn = $("#watchlist-clear");
    if (clearBtn) clearBtn.hidden = list.length === 0;
    if (list.length === 0) {
      container.innerHTML = '<div class="empty"><p>Your watchlist is empty. Browse the catalog and save a film — it will be stored only in this browser, never on a server.</p><a class="watchlist-empty-cta" href="/browse">Browse the catalog</a></div>';
      return;
    }
    container.innerHTML = list.map(watchCardHtml).join("");
    watchPosters(container);
    bindWatchButtons(container, () => renderWatchlist(container));
  }

  function initWatchlist() {
    const container = $("#watchlist");
    if (!container) return;
    renderWatchlist(container);
    const exportBtn = $("#watchlist-export");
    if (exportBtn) exportBtn.addEventListener("click", watchExport);
    const importBtn = $("#watchlist-import");
    const fileInput = $("#watchlist-file");
    if (importBtn && fileInput) {
      importBtn.addEventListener("click", () => fileInput.click());
      fileInput.addEventListener("change", () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        // Import replaces the saved list — destructive, never immediate (the same
        // discipline as Clear): confirm first, then read and validate.
        if (!window.confirm("Import a watchlist file? This replaces your current watchlist.")) {
          fileInput.value = "";
          return;
        }
        watchImport(file);
        fileInput.value = "";
      });
    }
    const clearBtn = $("#watchlist-clear");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        // Destructive action, never immediate (web-interface-guidelines): one stray tap
        // must not erase the whole saved list — confirm first.
        if (!window.confirm("Clear your saved watchlist? This cannot be undone.")) return;
        watchSave([]);
        renderWatchlist(container);
      });
    }
  }

  /* ---------- genre landing (DESIGN.md → screen prototype, 2026-08-16) ----------
     The curated genre destination page (public/genre.html, data-page="genre"): a genre
     hero plus this grid. Trimmed browse — no decade/sort filters, same count + grid +
     pagination, same films=1 exclusion so serial-episode uploads never lead the genre. */
  function initGenre() {
    const genre = "film-noir";
    const rawPage = parseInt(new URLSearchParams(window.location.search).get("page") || "1", 10);
    const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;

    const grid = $("#results");
    const parts = ["films=1", `genre=${genre}`, `page=${page}`];

    apiFetch(`/api/browse?${parts.join("&")}`)
      .then((data) => renderResults(grid, $("#count"), $("#pagination"), data, (p) => `/genre?page=${p}`))
      .catch((err) => renderError(grid, err.message));
  }

  /* ---------- serialized destinations (TV / anime / cartoons) ----------
     The /tv, /anime, /cartoons pages (public/{tv,anime,cartoons}.html, data-page="tv" /
     "anime" / "cartoons"): first-class homes for the classic-TV, anime, and animation
     catalogs, mirroring the /genre destination. Episodes ARE the content in these pools,
     so no films=1 exclusion here — the newest uploads in each pool lead. */
  function initDestination(flag, pagePath) {
    const rawPage = parseInt(new URLSearchParams(window.location.search).get("page") || "1", 10);
    const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;

    const grid = $("#results");
    apiFetch(`/api/browse?${flag}=1&sort=recent&page=${page}`)
      .then((data) => renderResults(grid, $("#count"), $("#pagination"), data, (p) => `${pagePath}?page=${p}`))
      .catch((err) => renderError(grid, err.message));
  }
  function initTV() { initDestination("tv", "/tv"); }
  function initAnime() { initDestination("anime", "/anime"); }
  function initCartoons() { initDestination("cartoons", "/cartoons"); }
  function initOTR() { initDestination("otr", "/otr"); }
  function initMusic() { initDestination("music", "/music"); }
  function initDocumentaries() { initDestination("documentaries", "/documentaries"); }
  function initSports() { initDestination("sports", "/sports"); }
  function initShorts() { initDestination("shorts", "/shorts"); }
  function initSilents() { initDestination("silents", "/silents"); }
  function initPublicTV() { initDestination("publictv", "/publictv"); }
  function initScience() { initDestination("science", "/science"); }
  function initGovFilms() { initDestination("govfilms", "/govfilms"); }
  function initAudiobooks() { initDestination("audiobooks", "/audiobooks"); }
  function initRecords() { initDestination("records", "/records"); }
  function initEphemera() { initDestination("ephemera", "/ephemera"); }
  function initSpace() { initDestination("space", "/space"); }
  function initTed() { initDestination("ted", "/ted"); }

  /* ---------- collections hub ----------
     The /collections page (public/collections.html, data-page="collections"): ten pool
     cards, each a link. Live counts come from /api/collections — one request instead of
     ten /api/browse calls (which is exactly the concurrent cold-start storm this client
     now retries around). Counts are a progressive enhancement: a failed fetch keeps the
     static links working and shows an em dash rather than an error. */
  function initCollections() {
    const countEls = document.querySelectorAll("[data-pool]");
    if (countEls.length === 0) return;
    apiFetch("/api/collections")
      .then((data) => {
        const pools = data && typeof data.pools === "object" ? data.pools : {};
        for (const el of countEls) {
          const n = pools[el.getAttribute("data-pool")];
          el.textContent = typeof n === "number"
            ? `${n.toLocaleString()} ${el.getAttribute("data-noun") || "titles"}`
            : "—";
        }
      })
      .catch(() => {
        for (const el of countEls) el.textContent = "—";
      });
  }

  /* ---------- browse ---------- */
  const GENRE_LABELS = {
    "film-noir": "Film Noir",
    western: "Western",
    "sci-fi": "Sci-Fi",
    horror: "Horror",
    silent: "Silent",
    comedy: "Comedy",
    drama: "Drama",
  };

  function initBrowse() {
    const params = new URLSearchParams(window.location.search);
    const genre = params.get("genre");
    const decade = params.get("decade");
    const from = params.get("from");
    const to = params.get("to");
    const q = params.get("q");
    const tv = params.get("tv") === "1";
    const anime = params.get("anime") === "1";
    const cartoons = params.get("cartoons") === "1";
    const otr = params.get("otr") === "1";
    const music = params.get("music") === "1";
    const documentaries = params.get("documentaries") === "1";
    const ted = params.get("ted") === "1";
    const sports = params.get("sports") === "1";
    const shorts = params.get("shorts") === "1";
    const silents = params.get("silents") === "1";
    const publictv = params.get("publictv") === "1";
    const science = params.get("science") === "1";
    const govfilms = params.get("govfilms") === "1";
    const audiobooks = params.get("audiobooks") === "1";
    const records = params.get("records") === "1";
    const ephemera = params.get("ephemera") === "1";
    const space = params.get("space") === "1";
    // Which serialized pool this browse view serves.
    const catalog = tv ? "tv" : anime ? "anime" : cartoons ? "cartoons" : otr ? "otr" : music ? "music" : documentaries ? "documentaries" : ted ? "ted" : sports ? "sports" : shorts ? "shorts" : silents ? "silents" : publictv ? "publictv" : science ? "science" : govfilms ? "govfilms" : audiobooks ? "audiobooks" : records ? "records" : ephemera ? "ephemera" : space ? "space" : null;
    // Newest releases is the browse default: the newest films in the catalog lead by
    // default, with Recently added / A–Z / Oldest one click away.
    const sort = params.get("sort") || "newest";
    const rawPage = parseInt(params.get("page") || "1", 10);
    const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;

    const chips = document.querySelectorAll("#genre-chips .genre-chip");
    for (const chip of chips) {
      if (chip.getAttribute("href") === `/browse?genre=${genre}` || (catalog && (chip.getAttribute("href") === `/browse?${catalog}=1` || chip.getAttribute("href") === `/${catalog}`))) {
        chip.classList.add("is-active");
      }
    }
    const decadeSel = $("#decade");
    if (decadeSel && decade) decadeSel.value = decade;
    const fromSel = $("#from");
    if (fromSel && from) fromSel.value = from;
    const sortSel = $("#sort");
    if (sortSel && sort) sortSel.value = sort;

    // From-year and decade are mutually exclusive at the API (conflict → 400), so choosing
    // one clears the other before navigating.
    const clearDecade = () => {
      if (decadeSel) decadeSel.value = "";
    };
    const clearFrom = () => {
      if (fromSel) fromSel.value = "";
    };

    // Wire the from/decade/sort selects to navigation (same clean URLs as the genre chips).
    // Without this the selects only *display* the current filter — changing them did nothing.
    const applyFilters = () => {
      const parts = [];
      if (catalog) parts.push(`${catalog}=1`);
      else if (genre) parts.push(`genre=${genre}`);
      if (fromSel && fromSel.value) {
        parts.push(`from=${fromSel.value}`, "to=2020"); // to = latest decade start: XXXXs–2029
      } else if (decadeSel && decadeSel.value) {
        parts.push(`decade=${decadeSel.value}`);
      }
      if (sortSel && sortSel.value !== "newest") parts.push(`sort=${sortSel.value}`); // newest is the page default
      window.location.href = `/browse${parts.length > 0 ? `?${parts.join("&")}` : ""}`;
    };
    if (fromSel) fromSel.addEventListener("change", () => {
      clearDecade();
      applyFilters();
    });
    if (decadeSel) decadeSel.addEventListener("change", () => {
      clearFrom();
      applyFilters();
    });
    if (sortSel) sortSel.addEventListener("change", applyFilters);

    const head = $("#results-head");
    if (head) {
      const label = catalog === "tv" ? "Classic TV" : catalog === "anime" ? "Anime" : catalog === "cartoons" ? "Cartoons" : catalog === "otr" ? "Old Time Radio" : catalog === "music" ? "Music & Concerts" : catalog === "documentaries" ? "Documentaries" : catalog === "ted" ? "TED Talks" : catalog === "sports" ? "Sports" : catalog === "shorts" ? "Shorts" : catalog === "silents" ? "Silent films" : catalog === "publictv" ? "Public Broadcasting" : catalog === "science" ? "Science & Medicine" : catalog === "govfilms" ? "Government Films" : catalog === "audiobooks" ? "Audiobooks" : catalog === "records" ? "Vintage Records" : catalog === "ephemera" ? "Ephemeral Films" : catalog === "space" ? "Space & NASA" : (genre && GENRE_LABELS[genre]) || "All films";
      head.textContent = `${label}${decade ? ` · ${decade}s` : ""}${from && to ? ` · ${from}s onward` : ""}${q ? ` · “${q}”` : ""}${sort === "title" ? " · A–Z" : sort === "newest" ? " · Newest releases" : sort === "oldest" ? " · Oldest first" : " · Recently added"}`;
    }

    // The #results grid ships with a skeleton grid (see browse.html) that reserves the
    // cards' space while this fetch runs, so results pop in without layout shift.
    const grid = $("#results");

    // films=1 excludes serial-episode uploads (podcasts) so browse presents films, matching
    // the home showcase — a default browse view led by "Episode 18" is a poor first impression.
    const parts = catalog ? [`page=${page}`, `${catalog}=1`] : ["films=1", `page=${page}`];
    if (!catalog && genre) parts.push(`genre=${genre}`);
    if (from && to) parts.push(`from=${from}`, `to=${to}`);
    else if (decade) parts.push(`decade=${decade}`);
    if (q) parts.push(`q=${q}`);
    parts.push(`sort=${sort}`); // always explicit — newest is the page default, but the API's implicit default is recent

    apiFetch(`/api/browse?${parts.join("&")}`)
      .then((data) =>
        renderResults(grid, $("#count"), $("#pagination"), data, (p) => `/browse?${parts.map((x) => (x.startsWith("page=") ? `page=${p}` : x)).join("&")}`),
      )
      .catch((err) => renderError(grid, err.message));
  }

  /* ---------- theme (day / night mode) ----------
     The theater defaults to the visitor's system preference (prefers-color-scheme), and a
     manual toggle overrides it — the explicit choice persists in localStorage (same
     privacy discipline as the watchlist — nothing leaves the browser). data-theme lives on
     <html>; the CSS [data-theme="light"] block re-tokens the whole system. The theme-color
     meta follows so the browser chrome matches the room. CSP forbids inline scripts, so a
     returning visitor whose saved choice differs from the system sees one frame of the
     system theme before the switch. */
  const THEME_KEY = "347movies.theme.v1";

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme; // "light" | "dark"
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#f4f1ea" : "#0c0d11");
    const btn = $("#theme-toggle");
    if (btn) {
      const light = theme === "light";
      btn.setAttribute("aria-pressed", light ? "true" : "false");
      btn.setAttribute("aria-label", light ? "Switch to night mode" : "Switch to day mode");
    }
  }

  function initTheme() {
    // An explicit saved choice always wins; otherwise follow the system preference.
    let manual = false;
    let theme = null;
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") {
        theme = saved;
        manual = true;
      }
    } catch {
      /* storage unavailable: fall through to the system preference */
    }
    if (!theme) {
      theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    applyTheme(theme);
    const btn = $("#theme-toggle");
    if (btn) {
      btn.addEventListener("click", () => {
        const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
        manual = true; // the explicit choice now owns the theme
        try {
          localStorage.setItem(THEME_KEY, next);
        } catch {
          /* storage unavailable: the toggle still works for this visit */
        }
        applyTheme(next);
      });
    }
    // Follow the OS live: if the visitor changes prefers-color-scheme mid-session and has
    // never overridden manually, switch in place so the room matches their OS. A manual
    // override (saved choice or a toggle this visit) keeps the theme pinned.
    const mq = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)");
    const onSystemChange = (e) => {
      if (manual) return;
      applyTheme(e.matches ? "light" : "dark");
    };
    if (mq && typeof mq.addEventListener === "function") mq.addEventListener("change", onSystemChange);
    else if (mq && typeof mq.addListener === "function") mq.addListener(onSystemChange);
  }

  /* ---------- privacy-respecting page-view reporting (vow 5 / constitution §5: an
     aggregate number, never tied to a person) ----------
     One fire-and-forget POST per page load to our own /api/view, carrying only the
     pathname. No cookies (credentials: "omit"), no identifiers, no referrer, no retries,
     no user-visible errors — a blocked or failed report changes nothing for the visitor.
     The server counts the validated path into a daily bucket; the aggregate feeds the
     advertise page's audience stats (public/advertise.html #view-stats). */
  function reportPageView() {
    try {
      const path = window.location.pathname || "/";
      fetch(`/api/view?path=${encodeURIComponent(path)}`, {
        method: "POST",
        credentials: "omit",
        keepalive: true,
      }).catch(() => {
        /* never surface: the site works identically without the report */
      });
    } catch {
      /* never surface */
    }
  }

  /* ---------- advertise (static landing page) ----------
     The contact form is a mailto composer: submit builds a prefilled email to the
     advertised business contact and opens the visitor's mail client. Nothing is sent to
     this site (vow 5 — the only thing that leaves the browser is the email the visitor
     chooses to send). Navigating location.href to mailto: is a top-level navigation, not
     a form submission, so it is unaffected by the CSP form-action 'self' directive. The
     audience-stats line (#view-stats) is filled from our own /api/views aggregate counter
     — approximate, cookie-free, never tied to a person. */
  function initAdvertise() {
    const form = $("#advertise-form");
    if (!form) return;

    // Audience stats: render the aggregate counter's last-7-days into the placeholder.
    const statsEl = $("#view-stats");
    if (statsEl) {
      fetch("/api/views?days=7", { headers: { Accept: "application/json" } })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data || typeof data.total !== "number" || !Array.isArray(data.days)) return;
          if (data.total <= 0) {
            statsEl.textContent =
              "View counting started with this deploy — the first numbers appear after a few days of traffic.";
            return;
          }
          const today = data.days.length > 0 ? data.days[data.days.length - 1].views : 0;
          let text = `≈${data.total.toLocaleString()} page views in the last 7 days`;
          if (today > 0) text += ` · ${today.toLocaleString()} today`;
          text += " — approximate, cookie-free, never tied to a person";
          const top = Object.entries(data.byPath || {})
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);
          if (top.length > 0) {
            const topText = top
              .map(([path, count]) => `${path === "/movie" ? "/movie/*" : path} ${Number(count).toLocaleString()}`)
              .join(" · ");
            statsEl.textContent = `${text}. Most-watched: ${topText}.`;
          } else {
            statsEl.textContent = `${text}.`;
          }
        })
        .catch(() => {
          /* keep the static placeholder — stats are a progressive enhancement */
        });
    }
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const val = (sel) => {
        const el = $(sel);
        return el && typeof el.value === "string" ? el.value.trim() : "";
      };
      const name = val("#ad-name");
      const company = val("#ad-company");
      const email = val("#ad-email");
      const placement = val("#ad-placement");
      const message = val("#ad-message");
      const parts = [];
      if (name) parts.push(`Name: ${name}`);
      if (company) parts.push(`Company: ${company}`);
      if (email) parts.push(`Email: ${email}`);
      if (placement) parts.push(`Placement: ${placement}`);
      const body = (parts.length > 0 ? `${parts.join("\n")}\n\n` : "") + (message || "");
      const subject = placement ? `Advertising inquiry — ${placement}` : "Advertising inquiry";
      window.location.href =
        `mailto:contactae2000@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    });
  }

  /* ---------- boot ---------- */
  initTheme();
  reportPageView();
  const page = document.body ? document.body.dataset.page : "";
  if (page === "home") initHome();
  else if (page === "search") initSearch();
  else if (page === "browse") initBrowse();
  else if (page === "genre") initGenre();
  else if (page === "tv") initTV();
  else if (page === "anime") initAnime();
  else if (page === "cartoons") initCartoons();
  else if (page === "otr") initOTR();
  else if (page === "music") initMusic();
  else if (page === "documentaries") initDocumentaries();
  else if (page === "sports") initSports();
  else if (page === "shorts") initShorts();
  else if (page === "silents") initSilents();
  else if (page === "publictv") initPublicTV();
  else if (page === "science") initScience();
  else if (page === "govfilms") initGovFilms();
  else if (page === "audiobooks") initAudiobooks();
  else if (page === "records") initRecords();
  else if (page === "ephemera") initEphemera();
  else if (page === "space") initSpace();
  else if (page === "ted") initTed();
  else if (page === "collections") initCollections();
  else if (page === "movie") initMovie();
  else if (page === "watchlist") initWatchlist();
  else if (page === "advertise") initAdvertise();

  // PWA: register the service worker (shell cache only — video, API, and third-party
  // hosts are never touched by it). Failure is silent: the site is fully functional
  // without the worker.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* no PWA in this browser/context — the site works identically */
    });
  }
})();
