/**
 * Drift guard for the two scripts that build their own archive.org gate queries — the
 * weekly license-sweep (scripts/license-sweep.ts) and the founder's long-tail scanner
 * (scripts/scan-longtail.mjs). The browse/search side is pinned to LEGAL_CLAUSE in
 * tests/archive-unit.test.ts; this file pins BOTH scripts to the SAME exported constants
 * (LEGAL_CLAUSE / BASE_CLAUSE), so a refactor that hardcodes the clause or drops one of its
 * scheme arms fails CI instead of silently querying a different gate.
 *
 * Static source assertions, deliberately: license-sweep's module body runs the sweep on
 * import, so importing it in a unit test would hit the live archive.org API. scan-longtail
 * is covered the same way for symmetry.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  AUDIOBOOKS_BASE_CLAUSE,
  BASE_CLAUSE,
  LEGAL_CLAUSE,
  MUSIC_BASE_CLAUSE,
  OTR_BASE_CLAUSE,
  RECORDS_BASE_CLAUSE,
} from "../lib/archive.ts";

const SWEEP_PATH = new URL("../scripts/license-sweep.ts", import.meta.url).pathname;
const LONGTAIL_PATH = new URL("../scripts/scan-longtail.mjs", import.meta.url).pathname;
const sweep = readFileSync(SWEEP_PATH, "utf8");
const longtail = readFileSync(LONGTAIL_PATH, "utf8");

test("license-sweep imports the exact LEGAL_CLAUSE constant (never a hardcoded clone)", () => {
  const importLine = sweep.match(/import\s*\{[^}]*LEGAL_CLAUSE[^}]*\}\s*from\s*"\.\.\/lib\/archive\.ts"/);
  assert.ok(importLine, "scripts/license-sweep.ts imports LEGAL_CLAUSE from lib/archive.ts");
});

test("LEGAL_CLAUSE still gates both declared-mark scheme arms (https and http)", () => {
  assert.ok(
    LEGAL_CLAUSE.includes("licenseurl:https://creativecommons.org*") &&
      LEGAL_CLAUSE.includes("licenseurl:http://creativecommons.org*"),
    "LEGAL_CLAUSE must keep both scheme arms — the sweep and every pool query build on it",
  );
});

test("license-sweep's probe queries are built from the constant, not a hardcoded clause", () => {
  // Both probe call sites must reference LEGAL_CLAUSE in their query construction…
  assert.match(
    sweep,
    /probe\(`\$\{LEGAL_CLAUSE\} AND \$\{pool\.gate\}`\);/,
    "pool probes interpolate LEGAL_CLAUSE",
  );
  assert.match(
    sweep,
    /probe\(`\$\{LEGAL_CLAUSE\} AND collection:\$\{cand\.name\} AND mediatype:\$\{cand\.mediatype\}`\);/,
    "candidate probes interpolate LEGAL_CLAUSE",
  );
  // …and the ONLY `licenseurl:` occurrences in the file must be the doc-prose mention of the
  // clause (line ~228). Any other literal is a hardcoded clone that bypasses the constant.
  const proseMention = sweep.match(/licenseurl:https:\/\/creativecommons\.org\*/g) ?? [];
  assert.ok(proseMention.length >= 1, "doc-prose mentions the gate for the report's audience");
  const literalCount = (sweep.match(/licenseurl:/g) ?? []).length;
  assert.equal(
    literalCount,
    proseMention.length,
    "no `licenseurl:` literal outside the doc prose — probe queries must reference LEGAL_CLAUSE",
  );
});

test("scan-longtail builds its catalog query from the exported BASE_CLAUSE, not a hardcoded clause", () => {
  // The films gate must come from the exported constant…
  assert.match(
    longtail,
    /import\s*\{[^}]*BASE_CLAUSE[^}]*\}\s*from\s*"\.\.\/lib\/archive\.ts"/,
    "scripts/scan-longtail.mjs imports BASE_CLAUSE from lib/archive.ts",
  );
  assert.match(longtail, /const LEGAL_QUERY = BASE_CLAUSE;/, "LEGAL_QUERY is the exported BASE_CLAUSE constant");
  // …and the emitted text stays byte-identical to the live search gate, so the tool scans
  // exactly the same catalog the site serves.
  assert.equal(
    BASE_CLAUSE,
    "(licenseurl:https://creativecommons.org* OR licenseurl:http://creativecommons.org*) " +
      "AND collection:(feature_films OR prelinger OR moviesandfilms) AND mediatype:movies",
    "BASE_CLAUSE text matches the films gate the tool documents",
  );
  // No hardcoded `licenseurl:` literal may appear outside comments/docstrings.
  const stripped = longtail.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.ok(!stripped.includes("licenseurl:"), "no hardcoded licenseurl: clause outside comments");
});

test("aggregation-probe suppresses the confirmed etree curated views, but never via KNOWN_CANDIDATES", () => {
  const PROBE_PATH = new URL("../scripts/aggregation-probe.ts", import.meta.url).pathname;
  const probe = readFileSync(PROBE_PATH, "utf8");

  // The etree band collections confirmed as 100% inside the music pool (2026-08-25 run)
  // must be suppressed in the etree mediatype config — the weekly report would otherwise
  // list the same 15 band collections every Wednesday.
  const suppressBlock = probe.match(/curatedSuppress: \[([\s\S]*?)\],\n  \},\n\};/);
  assert.ok(suppressBlock, "the etree mediatype config carries a curatedSuppress array");
  assert.ok(suppressBlock![1], "the curatedSuppress capture group is present");
  const suppressNames: string = suppressBlock![1];
  const expected = [
    "HairyLarry", "DavidGans", "LaneFamily", "TheShipsCat", "DupreesDeadBand",
    "StuAllenandMarsHotel", "BrokenCompassBluegrass", "BlueFunk", "PandaJAM",
    "TheNational", "ObliviousFools", "BannedFromEden", "Pachyderm",
    "TheBicycleThiefMusic", "TheloniousMonster",
  ];
  for (const name of expected) {
    assert.ok(suppressNames.includes(name), `etree curatedSuppress lists ${name}`);
  }

  // The disjoint-alert contract: a suppressed curated view must STILL be gate-checked every
  // run so that if it ever goes disjoint it lands in newCollections. Adding any of these
  // names to KNOWN_CANDIDATES would skip the gate-check entirely and silently swallow the
  // alert — the test fails if that ever happens.
  const knownCandidatesBlock = probe.match(/const KNOWN_CANDIDATES = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(knownCandidatesBlock, "KNOWN_CANDIDATES set found");
  assert.ok(knownCandidatesBlock![1], "the KNOWN_CANDIDATES capture group is present");
  const knownCandidatesNames: string = knownCandidatesBlock![1];
  for (const name of expected) {
    assert.ok(
      !knownCandidatesNames.includes(`"${name}"`),
      `${name} must NOT be in KNOWN_CANDIDATES — suppression must not skip its gate-check`,
    );
  }

  // The suppression must only hide the confirmation, never an exclusiveCount > 0 candidate.
  assert.match(
    probe,
    /if \(exclusiveCount > 0\) \{[\s\S]*?newCollections\.push\(candidate\);/,
    "an exclusive candidate still surfaces in newCollections before the curatedSuppress check",
  );
});

/**
 * Extract every collection name from a gate constant — both single-name forms
 * (`collection:X`) and OR-groups (`collection:(A OR B OR C)`). Returns a sorted
 * array of lowercase names so the pool-union comparison is stable.
 */
function collectionNames(gate: string): string[] {
  const names: string[] = [];
  // Single-name: collection:foo
  for (const m of gate.matchAll(/collection:([a-zA-Z0-9_]+)/g)) {
    names.push(m[1]!);
  }
  // OR-group: collection:(A OR B OR C)
  const orGroup = gate.match(/collection:\(([^)]+)\)/);
  if (orGroup && orGroup[1]) {
    for (const part of orGroup[1].split(/\s+OR\s+/)) {
      names.push(part.trim());
    }
  }
  return [...new Set(names)].sort();
}

function mediatypeFrom(gate: string): string {
  const m = gate.match(/mediatype:(\w+)/);
  assert.ok(m, `gate contains a mediatype: clause: ${gate.slice(0, 60)}...`);
  assert.ok(m[1], `mediatype capture group is present`);
  return m[1];
}

test("aggregation-probe MEDIATYPES overlap baselines match the registered pool gates", () => {
  const PROBE_PATH = new URL("../scripts/aggregation-probe.ts", import.meta.url).pathname;
  const probe = readFileSync(PROBE_PATH, "utf8");

  // Helper: extract the poolUnion string for a given mediatype key.
  function probePoolUnion(mediatype: string): string | undefined {
    const block = new RegExp(
      `${mediatype}:\\s*\\{[^}]*poolUnion:\\s*"([^"]+)"`,
      "s",
    );
    const m = probe.match(block);
    return m?.[1];
  }
  function probeClause(mediatype: string): string | undefined {
    const block = new RegExp(
      `${mediatype}:\\s*\\{[^}]*clause:\\s*"([^"]+)"`,
      "s",
    );
    const m = probe.match(block);
    return m?.[1];
  }

  // --- movies ---
  // The films union is the three collections in BASE_CLAUSE + mediatype:movies.
  // The probe's poolUnion covers only those three; other video pools (wwii, newsreels,
  // govfilms…) are already in KNOWN_COLLECTIONS so they never reach the gate-check.
  const gateMoviesNames = collectionNames(BASE_CLAUSE);
  const gateMoviesMediatype = mediatypeFrom(BASE_CLAUSE);
  const probeMoviesUnion = probePoolUnion("movies");
  assert.ok(probeMoviesUnion, "probe movies poolUnion found");
  assert.equal(gateMoviesMediatype, "movies", "BASE_CLAUSE uses mediatype:movies");
  assert.equal(probeClause("movies"), "mediatype:movies");
  assert.deepEqual(
    collectionNames(probeMoviesUnion).sort(),
    gateMoviesNames,
    "probe's movies.poolUnion covers exactly the BASE_CLAUSE film collections",
  );

  // --- audio ---
  // The three registered audio pools: OTR, audiobooks, records.
  const gateAudioNames = [
    ...collectionNames(OTR_BASE_CLAUSE),
    ...collectionNames(AUDIOBOOKS_BASE_CLAUSE),
    ...collectionNames(RECORDS_BASE_CLAUSE),
  ].sort();
  assert.equal(mediatypeFrom(OTR_BASE_CLAUSE), "audio", "OTR uses mediatype:audio");
  assert.equal(mediatypeFrom(AUDIOBOOKS_BASE_CLAUSE), "audio", "audiobooks uses mediatype:audio");
  assert.equal(mediatypeFrom(RECORDS_BASE_CLAUSE), "audio", "records uses mediatype:audio");
  const probeAudioUnion = probePoolUnion("audio");
  assert.ok(probeAudioUnion, "probe audio poolUnion found");
  assert.equal(probeClause("audio"), "mediatype:audio");
  assert.deepEqual(
    collectionNames(probeAudioUnion).sort(),
    gateAudioNames,
    "probe's audio.poolUnion covers exactly the three audio gate collections",
  );

  // --- etree ---
  const gateEtreeNames = collectionNames(MUSIC_BASE_CLAUSE);
  assert.equal(gateEtreeNames.length, 2, "MUSIC_BASE_CLAUSE covers two collections");
  assert.deepEqual(gateEtreeNames, ["GratefulDead", "etree"].sort(), "MUSIC_BASE_CLAUSE collections");
  const gateEtreeMediatype = mediatypeFrom(MUSIC_BASE_CLAUSE);
  const probeEtreeUnion = probePoolUnion("etree");
  assert.ok(probeEtreeUnion, "probe etree poolUnion found");
  assert.equal(probeClause("etree"), `mediatype:${gateEtreeMediatype}`);
  assert.deepEqual(
    collectionNames(probeEtreeUnion).sort(),
    gateEtreeNames,
    "probe's etree.poolUnion covers exactly the MUSIC_BASE_CLAUSE collections",
  );
});


// ---------------------------------------------------------------------------
// Bidirectional drift guard: probe KNOWN_COLLECTIONS ↔ lib/archive.ts gate
// constants.  If a name is in the probe set but no gate constant uses it,
// the pool was removed from the site but its probe entry is orphaned.  If a
// gate constant references a collection the probe doesn't know about, the
// probe may falsely surface it as "new" every week.
// ---------------------------------------------------------------------------

test("aggregation-probe KNOWN_COLLECTIONS ↔ registered gate constants are in sync", () => {
  const ARCHIVE_PATH = new URL("../lib/archive.ts", import.meta.url).pathname;
  const archive = readFileSync(ARCHIVE_PATH, "utf8");
  const gateNames = new Set<string>();

  // Pass 1: collection:(WORD OR WORD2 OR …) — handles all parenthesized forms
  // including LEGAL_COLLECTIONS (double-quoted, not a backtick export).
  const groupRegex = /collection:\(([^)]+)\)/g;
  let gm: RegExpExecArray | null;
  while ((gm = groupRegex.exec(archive)) !== null) {
    for (const name of gm[1]!.split(/\s+OR\s+/)) {
      gateNames.add(name.trim());
    }
  }

  // Pass 2: collection:WORD that is NOT followed by a paren (singles).
  const singleRegex = /collection:(\w+)(?!\s*\()/g;
  let sm: RegExpExecArray | null;
  while ((sm = singleRegex.exec(archive)) !== null) {
    gateNames.add(sm[1]!);
  }

  // Extract every name from the probe KNOWN_COLLECTIONS set.
  const PROBE_PATH = new URL("../scripts/aggregation-probe.ts", import.meta.url).pathname;
  const probe = readFileSync(PROBE_PATH, "utf8");
  const knownMatch = probe.match(/const KNOWN_COLLECTIONS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(knownMatch, "KNOWN_COLLECTIONS block found in probe");
  const probeNames = new Set<string>();
  const nameRegex = /"(\w+)"/g;
  let nm: RegExpExecArray | null;
  assert.ok(knownMatch![1] != null, "KNOWN_COLLECTIONS capture group found");
  while ((nm = nameRegex.exec(knownMatch![1]!)) !== null) {
    probeNames.add(nm[1]!);
  }

  // Forward: every probe entry must trace to a gate constant.
  const orphans = [...probeNames].filter(n => !gateNames.has(n));
  // nasaaudiocollection is pending pool registration — accepted exception.
  const pending = new Set(["nasaaudiocollection"]);
  const realOrphans = orphans.filter(n => !pending.has(n));
  assert.deepEqual(
    realOrphans,
    [],
    `probe KNOWN_COLLECTIONS entries with no corresponding gate constant (pending: ${
      [...pending].join(", ")})`,
  );

  // Reverse: every gate collection must be in the probe known set.
  const missing = [...gateNames].filter(n => !probeNames.has(n));
  assert.deepEqual(
    missing,
    [],
    `gate collections not in probe KNOWN_COLLECTIONS: ${
      missing.join(", ")} — add them`,
  );
});
