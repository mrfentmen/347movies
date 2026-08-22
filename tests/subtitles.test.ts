import assert from "node:assert/strict";
import { test } from "node:test";
import { toWebVtt } from "../lib/subtitles.ts";

test("toWebVtt adds the WEBVTT header and converts srt timestamps", () => {
  const srt = `1
00:00:30,95 --> 00:00:31,52
In the.

2
00:01:11,45 --> 00:01:14,20
The. Out of the shadows.`;
  const vtt = toWebVtt(srt);
  assert.ok(vtt.startsWith("WEBVTT\n\n"), "WEBVTT header");
  assert.ok(vtt.includes("00:00:30.950 --> 00:00:31.520"), "comma ms -> dotted 3-digit ms");
  assert.ok(vtt.includes("00:01:11.450 --> 00:01:14.200"), "2-digit ms padded");
  assert.ok(vtt.includes("In the."), "cue bodies pass through");
});

test("toWebVtt handles CRLF and keeps empty cue bodies", () => {
  const vtt = toWebVtt("1\r\n00:00:01,000 --> 00:00:02,000\r\nHello\r\n");
  assert.ok(!vtt.includes("\r"), "CRLF normalized");
  assert.ok(vtt.includes("Hello"));
});

test("toWebVtt tolerates timestamps without milliseconds", () => {
  const vtt = toWebVtt("1\n00:00:01 --> 00:00:02\nX\n");
  assert.ok(vtt.includes("00:00:01 --> 00:00:02"), "bare timestamps pass through");
});
