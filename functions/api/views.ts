import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../lib/env.ts";
import { headHandler } from "../_head.ts";
import { jsonResponse } from "../../lib/http.ts";
import { getViewStats } from "../../lib/views.ts";

/**
 * GET /api/views?days=7 — aggregate page-view stats for the advertise page.
 *
 * Returns the last N days (1–30, default 7) of daily totals plus the bounded per-page
 * breakdown. Everything here is aggregate and approximate — JS-enabled page loads counted
 * into daily buckets, no identifiers, no IPs, no cookies (see lib/views.ts). Deliberately
 * NOT edge-cached (`no-store`): the numbers change with every report, and a stale count
 * would be a lie. The per-IP middleware rate limiter applies like every other API route.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const raw = url.searchParams.get("days") ?? "7";
  // Clamped to 1–30 in getViewStats; numeric junk is clamped rather than erroring and
  // non-numeric junk falls back to the default — this endpoint is a public read of
  // aggregate numbers, so fail-soft is the right shape.
  const days = /^\d{1,3}$/.test(raw) ? parseInt(raw, 10) : 7;
  const stats = await getViewStats(context.env, days);
  return jsonResponse({ enabled: true, ...stats }, 200);
};

export const onRequestHead = headHandler(onRequestGet);
