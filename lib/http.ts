/** JSON response helpers for API routes. All API responses are JSON (specs.md §3). */
export function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

export function jsonError(status: number, code: string, message: string): Response {
  return jsonResponse({ error: code, message }, status);
}
