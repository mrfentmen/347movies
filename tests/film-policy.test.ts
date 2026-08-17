import assert from "node:assert/strict";
import { test } from "node:test";
import { FILMS_ONLY_SOLR_CLAUSE, isNonFilmTitle } from "../lib/film-policy.ts";

test("FILMS_ONLY_SOLR_CLAUSE is the exact documented exclusion", () => {
  // searchArchive (lib/archive.ts) pushes this exact clause when filmsOnly is set; the local
  // matcher below must stay equivalent (verified live 2026-08-15: 15,927 = 15,927 kept-sets,
  // identifier-identical). Guard the string so a rename never silently drifts the two sides.
  assert.equal(FILMS_ONLY_SOLR_CLAUSE, '-title:(episode* OR season* OR pilot OR "ep." OR trailer* OR teaser* OR "music video" OR chapter OR part)');
});

test("isNonFilmTitle matches the documented Solr exclusion patterns", () => {
  // Episode/serial patterns (verified live 2026-08-15):
  assert.equal(isNonFilmTitle("Episode 5 of a Series"), true);
  assert.equal(isNonFilmTitle("Season 2 Finale"), true);
  assert.equal(isNonFilmTitle("The Pilot"), true);
  assert.equal(isNonFilmTitle("S01 Ep. 3"), true);
  assert.equal(isNonFilmTitle("Spook Show ep 14"), true); // Solr's `"ep."` phrase matches the bare `ep` token
  // Trailer patterns:
  assert.equal(isNonFilmTitle("Nightmare Alley trailer"), true);
  assert.equal(isNonFilmTitle("HIGH SIERRA trailer."), true);
  assert.equal(isNonFilmTitle("THE MYSTERIANS trailer 2 (long version)"), true);
  assert.equal(isNonFilmTitle('Movie Trailers ("Independence Day, 1940" Promotion)'), true);
  assert.equal(isNonFilmTitle("Trailer Park Boys"), true); // token-prefix rule, same as Solr's `trailer*`
  // Teaser patterns (added 2026-08-16 — teasers are trailers by another name):
  assert.equal(isNonFilmTitle("LovesSecretDomain-Teaser"), true);
  assert.equal(isNonFilmTitle("Snowpiercer Red Band Teaser (ProRes)"), true);
  assert.equal(isNonFilmTitle("Don't Go Near The Park Teaser"), true);
  // Music-video patterns (added 2026-08-16 — the adjacent "music video" token pair,
  // exactly Solr's `"music video"` phrase across punctuation/hyphen boundaries):
  assert.equal(isNonFilmTitle("Run With Us (Official Music Video, Subtitled)"), true);
  assert.equal(isNonFilmTitle("Yungblud - Willow - Memories - 4K ProRes Music Video"), true);
  assert.equal(isNonFilmTitle("music-video-compilation-1993"), true);
  // Serial-installment patterns (chapter exact, part exact — verified live 2026-08-15):
  assert.equal(isNonFilmTitle("The Vanishing Shadow: Chapter 10 - The Iron Death"), true);
  assert.equal(isNonFilmTitle("Flash Gordon Conquers the Universe: Chapter 9"), true);
  assert.equal(isNonFilmTitle("Operation Crossroads (Part I)"), true);
  assert.equal(isNonFilmTitle("Publicvideos May 2009 batch, part 2"), true);
  assert.equal(isNonFilmTitle("Japanese Relocation: Part Of The Japanese Fishing Fleet in California"), true); // documented edge
  // Complete-serial compilations stay (plural "chapters", never the exact token):
  assert.equal(isNonFilmTitle("The Phantom (1943) Serial - 15 Chapters"), false);
  assert.equal(isNonFilmTitle("Compilation of All 12 Chapters"), false);
  assert.equal(isNonFilmTitle("THE LOST CITY (all 12 chapters & video quality upgrade)"), false);
  // Negatives:
  assert.equal(isNonFilmTitle("A Normal Film"), false);
  assert.equal(isNonFilmTitle("Ephemeral City"), false); // "ep." not at word-ish boundary
  assert.equal(isNonFilmTitle("Fighter Pilots"), false); // Solr's exact `pilot` token never matches plural
  assert.equal(isNonFilmTitle("Crop Dusting From Pilot's Perspective"), false); // apostrophe keeps token whole (probed live)
  // Music-video negatives — background music descriptions survive (no adjacent "video"):
  assert.equal(isNonFilmTitle("City Pop Background Music Video Mix"), true); // adjacent pair present
  assert.equal(isNonFilmTitle("Twinkle Square 1985 City Pop Background Music (Laserdisc)"), false);
  assert.equal(isNonFilmTitle("The Music Box (1932)"), false);
  assert.equal(isNonFilmTitle("A Film About Music"), false);
  assert.equal(isNonFilmTitle("Video Review of Silent Films"), false); // "video" precedes, not follows, "music"
});
