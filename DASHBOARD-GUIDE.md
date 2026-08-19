# 347movies — Click-by-click dashboard guide

The exact dashboard steps for the items in `FOUNDER-CHECKLIST.md`, for when you're in the
Cloudflare dashboard (https://dash.cloudflare.com) and Google Search Console. Everything else
is already built and verified — these are the only account-access steps left.

---

## 1. KV namespace (24h cache) — dashboard or CLI

**Via the dashboard (no terminal needed):**

1. Login → **Workers & Pages** → **KV** (left sidebar).
2. Click **Create a namespace** → name it `MOVIES_KV` → **Add**.
3. Click the namespace → copy its **ID** (long string).
4. Open `wrangler.jsonc` in the project → the file has a commented-out `kv_namespaces`
   block near the top (with instructions). Uncomment it and set both `"id"` and
   `"preview_id"` to the copied ID.
5. Deploy: `npm run deploy`.

**Via CLI (alternative):**

```bash
npx wrangler kv namespace create MOVIES_KV
# paste the returned id into the commented kv_namespaces block in wrangler.jsonc
# (both "id" and "preview_id"), then:
npm run deploy
```

The code uses KV automatically once the binding exists — no other changes.

## 2. Zone settings (WAF, bot fight, TLS)

**Keep the free `347movies.pages.dev` URL** (fine for launch) or add a custom domain:

1. **Workers & Pages** → **347movies** → **Custom domains** → **Add custom domain**.
2. Follow the prompts to add the domain to your Cloudflare zone (or create one — Cloudflare
   will show the nameserver change; it takes a few minutes to propagate).
3. In the **zone dashboard** (not the Pages project):
   - **Security → WAF**: make sure **Managed Rules** is On.
   - **Security → Bots**: enable **Bot Fight Mode**.
   - **SSL/TLS → Edge Certificates**: enable **Always Use HTTPS** and **HSTS** (set
     max-age 6 months+, include subdomains, preload — the site already sends
     `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`).
   - **DNS → Records**: an `A`/`CNAME` record pointing at `347movies.pages.dev` is created
     automatically by the custom-domain flow; verify it shows **Proxied** (orange cloud).

## 3. Search Console (indexing)

1. Go to https://search.google.com/search-console → **Add property** →
   `https://347movies.pages.dev` (or your custom domain).
2. Verify ownership — easiest: **Domain** property + DNS TXT record from your Cloudflare
   zone (DNS → Records → Add record, TXT, paste the value, save; it validates in minutes).
3. **Sitemaps** (left sidebar) → enter `https://347movies.pages.dev/sitemap.xml` → Submit.
   Expect 71,992 URLs (23 static + every item across all fifteen pools, split into per-pool sub-sitemaps), no errors, after a few days.

## 4. `AMAZON_TAG` (affiliate mechanism, optional)

1. **Workers & Pages** → **347movies** → **Settings** → **Environment variables** → **Add**.
2. Name `AMAZON_TAG`, value your Associates tag, save, redeploy (`npm run deploy`).

## 5. Real ad network (when you have a contract)

1. Sign up with a compliant ad network (legal-only content is accepted by most).
2. Wire their script/tag into the marked slots — search the codebase for `data-ad-slot`
   (`public/*.html` and `lib/layout.ts`). Keep placement inside the slot containers; ads
   must never touch the player.
3. Update `public/privacy.html` (disclosure before any ad renders) and the About page.
4. Deploy. Nothing renders until then — by design.

---

**Check your work anytime:** `npm run smoke` (45 live checks, no credentials).
