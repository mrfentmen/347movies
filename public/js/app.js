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

  async function apiFetch(path) {
    let res;
    try {
      res = await fetch(path, { headers: { Accept: "application/json" } });
    } catch {
      throw Object.assign(new Error("We couldn't reach the film catalog. Check your connection and try again."), { status: 0 });
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
      throw Object.assign(new Error(message), { status: res.status });
    }
    return res.json();
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

  /* The single card builder — every movie card on the site (grids, watchlist, search,
     browse, genre) is this markup. Takes a normalized item {id, title, year, thumb} and
     whether the film is saved (drives the watch button state). */
  function cardShell(item, saved) {
    const title = item.title || "Untitled";
    const year = item.year ? `<span class="card__year">${escapeHtml(String(item.year))}</span>` : "";
    // The poster sits inside the link whose text is already the title, so it is decorative
    // there: empty alt avoids a duplicated accessible name ("Poster for X X"). data-title
    // keeps the initials fallback working when the image fails to load.
    const img = item.thumb
      ? `<img class="card__poster" src="${escapeHtml(item.thumb)}" alt="" data-title="${escapeHtml(title)}" loading="lazy" decoding="async">`
      : `<div class="card__poster card__poster--empty" aria-hidden="true">${escapeHtml(initialsOf(title))}</div>`;
    return `<div class="card"><a class="card__main" href="/movie/${encodeURIComponent(item.id)}">${img}<span class="card__body"><span class="card__title">${escapeHtml(title)}</span>${year}</span></a>${watchBtnHtml(item, saved)}</div>`;
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
    // year must never reach the DOM (stored-XSS class fixed 2026-08-16).
    const item = {
      id: m.identifier,
      title: m && m.title ? String(m.title) : "Untitled",
      year: m.year || "",
      thumb: m && m.thumbnails && m.thumbnails.small ? String(m.thumbnails.small) : "",
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

  function initHome() {
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
    // Golden-age showcases: anime 1950s–70s (measured live 2026-08-17: 42 items) and
    // cartoons 1930s–40s (185 items), newest release years first.
    loadHomeSection("animegolden", "/api/browse?anime=1&from=1950&to=1970&sort=newest&page=1");
    loadHomeSection("cartoonsgolden", "/api/browse?cartoons=1&from=1930&to=1940&sort=newest&page=1");
    loadHomeSection("recent", "/api/browse?sort=recent&films=1&page=1");
    loadHomeSection("noir", "/api/browse?genre=film-noir&sort=recent&page=1");
    loadHomeSection("silents", "/api/browse?decade=1920&sort=recent&page=1");
  }

  /* ---------- search ---------- */
  function initSearch() {
    const params = new URLSearchParams(window.location.search);
    const q = (params.get("q") || "").trim();
    const tv = params.get("tv") === "1";
    const anime = params.get("anime") === "1";
    const cartoons = params.get("cartoons") === "1";
    const catalog = tv ? "tv" : anime ? "anime" : cartoons ? "cartoons" : null;
    // Per-pool display vocabulary (label + noun) for the search landing/result copy.
    const CATALOG_META = {
      tv: { label: "Classic TV", noun: "show" },
      anime: { label: "Anime", noun: "title" },
      cartoons: { label: "Cartoons", noun: "title" },
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
  /* Quality + server playback controls. The embed iframe is the default and no-JS path; a
     non-embed choice swaps in a native <video> streaming archive.org's direct file (CSP
     media-src already allows archive.org — no bytes are ever hosted or proxied). */
  function initPlaybackTools() {
    const tools = $(".player-tools");
    if (!tools) return;
    const wrap = $(".player-wrap");
    const server = tools.querySelector(".player-server");
    if (!wrap || !server) return;
    const quality = tools.querySelector(".player-quality");
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

    function apply() {
      const mode = server.value;
      if (mode === "embed") {
        if (origIframe && wrap.querySelector("video.player")) wrap.replaceChildren(origIframe);
        return;
      }
      const path = quality ? quality.value : defaultPath;
      if (!path) return;
      const video = document.createElement("video");
      video.className = "player player--video";
      video.controls = true;
      video.playsInline = true;
      video.preload = "metadata";
      if (poster) video.poster = poster;
      video.src = srcFor(mode, path);
      video.setAttribute("aria-label", `Watch ${title}`);
      wrap.replaceChildren(video);
    }

    server.addEventListener("change", apply);
    if (quality) {
      quality.addEventListener("change", () => {
        // A quality choice only matters in direct mode; from embed, flip to direct so it
        // takes effect immediately instead of being silently ignored.
        if (server.value === "embed") server.value = "cdn";
        apply();
      });
    }
  }

  function initMovie() {
    initPlaybackTools();
    const poster = $(".movie-poster");
    if (poster && poster.parentElement) bindPosterFallbacks(poster.parentElement);
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
    // Which serialized pool this browse view serves (TV / anime / cartoons), if any.
    const catalog = tv ? "tv" : anime ? "anime" : cartoons ? "cartoons" : null;
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
      const label = catalog === "tv" ? "Classic TV" : catalog === "anime" ? "Anime" : catalog === "cartoons" ? "Cartoons" : (genre && GENRE_LABELS[genre]) || "All films";
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

  /* ---------- boot ---------- */
  initTheme();
  const page = document.body ? document.body.dataset.page : "";
  if (page === "home") initHome();
  else if (page === "search") initSearch();
  else if (page === "browse") initBrowse();
  else if (page === "genre") initGenre();
  else if (page === "tv") initTV();
  else if (page === "anime") initAnime();
  else if (page === "cartoons") initCartoons();
  else if (page === "movie") initMovie();
  else if (page === "watchlist") initWatchlist();
})();
