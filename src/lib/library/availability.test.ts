import assert from "node:assert/strict";
import test from "node:test";
import {
  canonical,
  httpUrl,
  parseEnvelope,
  parseMovieReview,
  parsePlatform,
  reviewStale,
  validReviewDate,
} from "./availability.ts";
import { familyDay } from "./rules.ts";
import { canonicalLibrarySearch, readLibraryFilters } from "./filters.ts";
const workId = "10000000-0000-4000-8000-000000000001",
  platformId = "20000000-0000-4000-8000-000000000001";
const offer = {
  mode: "free_with_ads",
  sourceUrls: ["https://www.justwatch.com/ar/pelicula/example"],
  linkKind: "aggregator",
  url: "https://www.justwatch.com/ar/pelicula/example",
  directVerifiedOn: null,
  channel: null,
};
const check = {
  platformId,
  outcome: "completed",
  checkedOn: "2026-11-08",
  sourceUrls: ["https://example.org/source"],
  offers: [offer],
};
const movie = { workId, checks: [check] };
test("Argentina calendar thresholds including empty reviews and midnight", () => {
  assert.equal(familyDay(new Date("2026-11-09T02:59:59Z")), "2026-11-08");
  assert.equal(familyDay(new Date("2026-11-09T03:00:00Z")), "2026-11-09");
  assert.equal(reviewStale("2026-10-26", ["free"], "2026-11-08"), false);
  assert.equal(
    reviewStale("2026-10-25", ["free_with_ads"], "2026-11-08"),
    true,
  );
  assert.equal(
    reviewStale("2026-10-10", ["subscription"], "2026-11-08"),
    false,
  );
  assert.equal(reviewStale("2026-10-09", ["subscription"], "2026-11-08"), true);
  assert.equal(reviewStale("2026-10-25", [], "2026-11-08"), true);
  assert.equal(validReviewDate("2026-02-30", "2026-11-08"), false);
  assert.equal(validReviewDate("2026-11-09", "2026-11-08"), false);
});
test("strict versioned review, failed search, aggregator validity and direct link invariants", () => {
  assert.equal(parseMovieReview(movie, "2026-11-08").checks.length, 1);
  assert.throws(() =>
    parseEnvelope({ schemaVersion: 2, country: "AR", movies: [movie] }),
  );
  assert.throws(() =>
    parseEnvelope({ schemaVersion: 1, country: "US", movies: [movie] }),
  );
  assert.throws(() =>
    parseEnvelope({ schemaVersion: 1, country: "AR", movies: [movie, movie] }),
  );
  assert.throws(() => parseMovieReview({ ...movie, extra: true }));
  assert.throws(() => parseMovieReview({ ...movie, checks: [check, check] }));
  assert.throws(() =>
    parseMovieReview({
      ...movie,
      checks: [{ ...check, offers: [offer, offer] }],
    }),
  );
  assert.equal(
    parseMovieReview({
      workId,
      checks: [
        {
          platformId,
          outcome: "failed",
          reason: "Página incompleta",
          findings: "Hallazgo sin confirmar",
        },
      ],
    }).checks[0].outcome,
    "failed",
  );
  assert.throws(() =>
    parseMovieReview({
      workId,
      checks: [{ platformId, outcome: "failed", reason: "Error", offers: [] }],
    }),
  );
  for (const bad of [
    "javascript:alert(1)",
    "file:///tmp/x",
    "https://user:pass@example.org",
    "https://example.org/ x",
  ]) {
    assert.equal(httpUrl(bad), false);
    assert.throws(() =>
      parseMovieReview({
        workId,
        checks: [{ ...check, offers: [{ ...offer, url: bad }] }],
      }),
    );
  }
  assert.throws(() =>
    parseMovieReview({
      workId,
      checks: [{ ...check, offers: [{ ...offer, linkKind: "direct" }] }],
    }),
  );
  assert.throws(() =>
    parseMovieReview(
      {
        workId,
        checks: [
          {
            ...check,
            offers: [
              { ...offer, linkKind: "direct", directVerifiedOn: "2026-11-09" },
            ],
          },
        ],
      },
      "2026-11-09",
    ),
  );
  assert.equal(
    parseMovieReview(
      {
        workId,
        checks: [
          { ...check, offers: [{ ...offer, linkKind: "none", url: null }] },
        ],
      },
      "2026-11-08",
    ).checks.length,
    1,
  );
  assert.throws(() =>
    parseMovieReview({
      workId,
      checks: [
        {
          ...check,
          offers: [
            {
              ...offer,
              channel: { name: "Fake", url: "https://youtube.com/channel/x" },
            },
          ],
        },
      ],
    }),
  );
});
test("platform aliases, modes, coverage evidence and canonical hashes", () => {
  const p = parsePlatform(
    {
      name: " Disney+ ",
      aliases: ["Disney Plus", "disney plus"],
      modes: ["subscription"],
      coverage: "pending",
      coverageSources: [],
      requiresChannel: false,
    },
    false,
  );
  assert.equal(p.aliases.length, 2);
  assert.equal(p.name, "Disney+");
  assert.throws(() =>
    parsePlatform(
      { ...p, coverage: "verified", id: undefined, expectedVersion: undefined },
      false,
    ),
  );
  assert.equal(
    canonical({ b: 2, a: [{ d: 4, c: 3 }] }),
    canonical({ a: [{ c: 3, d: 4 }], b: 2 }),
  );
});
test("platform URL selection is OR, repeated IDs canonicalize without losing existing filters", () => {
  const id2 = "30000000-0000-4000-8000-000000000001";
  const q = new URLSearchParams(
    `genre=terror&platform=${id2}&platform=${platformId}&platform=${platformId}&free=true&cursor=old`,
  );
  const read = readLibraryFilters(q);
  assert.deepEqual(read.platforms, [platformId, id2]);
  assert.equal(read.free, true);
  assert.equal(
    canonicalLibrarySearch(q),
    `genre=terror&platform=${platformId}&platform=${id2}&free=true`,
  );
});
