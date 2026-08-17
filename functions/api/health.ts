import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../lib/env.ts";
import { headHandler } from "../_head.ts";
import { jsonResponse } from "../../lib/http.ts";

/** GET /api/health — liveness check (task T1.4). */
export const onRequestGet: PagesFunction<Env> = async () => {
  return jsonResponse(
    { ok: true, service: "347movies", time: new Date().toISOString() },
    200,
    { "Cache-Control": "public, max-age=60" },
  );
};

export const onRequestHead = headHandler(onRequestGet);
