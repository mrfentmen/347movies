/**
 * Subtitle helpers for the native player's captions track.
 *
 * The browser's <track> element needs WebVTT. archive.org's ASR captions are SubRip
 * (.srt) — comma-millisecond timestamps — which the browser cannot render directly, so the
 * same-origin /api/subtitle proxy converts them here. The conversion is intentionally
 * tiny: srt and vtt share the cue format; only the timestamp decimal separator (`,` → `.`)
 * and the WEBVTT header differ.
 */

/** Convert SubRip (.srt) text to WebVTT. Cue bodies pass through untouched. */
export function toWebVtt(srt: string): string {
  const body = srt
    .replace(/\r\n/g, "\n")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{1,3})/g, (_m, hms: string, ms: string) => `${hms}.${ms.padEnd(3, "0")}`)
    .trim();
  return `WEBVTT\n\n${body}\n`;
}
