import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runReferenceCli } from "./reference-check.cli.js";
import {
  checkReferences,
  readCrossrefWork,
  readEuropePmcHit,
  titleKey,
  titlesMatch,
  type ReferenceSource,
} from "./reference-check.js";
import type { ApiFetch } from "../discovery/scholarly-client.js";

/**
 * T1 (plan v4, 10; S7): how a registry's answer is read against the source.
 * The real resolution is the stage run (`knowledge:check-references`); these
 * pin the reading, with invented works. WHAT TURNS IT RED: a 404 or an empty
 * hit read as resolved; another work's title or DOI read as this one; an
 * unreachable registry counted as a pass; a title printed.
 */
const SOURCE: ReferenceSource = {
  id: "s1",
  doi: "10.5555/kitalalt.2001.1",
  pmid: "11111111",
  title: "Kitalált foszfát-dúsítás és az <i>Acropora</i> kalcifikációja",
  year: 2001,
};

const crossref = (over: Record<string, unknown> = {}) => ({
  message: {
    DOI: "10.5555/KITALALT.2001.1",
    title: ["Kitalált foszfát-dúsítás és az Acropora kalcifikációja"],
    issued: { "date-parts": [[2001, 5]] },
    ...over,
  },
});
const europePmc = (over: Record<string, unknown> = {}) => ({
  hitCount: 1,
  resultList: {
    result: [
      {
        pmid: "11111111",
        doi: "10.5555/kitalalt.2001.1",
        title: "Kitalált foszfát-dúsítás és az Acropora kalcifikációja.",
        pubYear: "2001",
        ...over,
      },
    ],
  },
});

describe("titles", () => {
  it("compare letters and digits, without case, diacritics or markup", () => {
    assert.equal(
      titleKey("Az <i>Acropora</i> és a Foszfát!"),
      "azacroporaesafoszfat",
    );
    assert.ok(titlesMatch("A foszfát hatása.", "a foszfat hatasa"));
  });
  it("a long enough beginning is the same title (a subtitle left out); a short one is not", () => {
    assert.ok(
      titlesMatch(
        "Phosphate enrichment and coral calcification",
        "Phosphate enrichment and coral calcification: a field test",
      ),
    );
    assert.equal(
      titlesMatch("Coral", "Coral calcification under phosphate"),
      false,
    );
    assert.equal(
      titlesMatch("Phosphate and corals", "Nitrate and corals"),
      false,
    );
    assert.equal(titlesMatch("", ""), false);
  });
});

describe("a Crossref answer", () => {
  it("the same DOI and title: RESOLVED", () => {
    assert.deepEqual(readCrossrefWork(SOURCE, SOURCE.doi!, crossref()), {
      verdict: "RESOLVED",
      reasons: [],
      yearDiffers: false,
    });
  });
  it("a title with its subtitle on the Crossref side still matches", () => {
    const r = readCrossrefWork(
      {
        ...SOURCE,
        title:
          "Kitalált foszfát-dúsítás és az Acropora kalcifikációja: terepi kísérlet",
      },
      SOURCE.doi!,
      crossref({ subtitle: ["terepi kísérlet"] }),
    );
    assert.equal(r.verdict, "RESOLVED");
  });
  it("another work's title or DOI: OTHER_WORK, by code", () => {
    assert.deepEqual(
      readCrossrefWork(
        SOURCE,
        SOURCE.doi!,
        crossref({ title: ["Egészen más cikk a nitrátról"] }),
      ).reasons,
      ["TITLE_DIFFERS"],
    );
    assert.deepEqual(
      readCrossrefWork(SOURCE, SOURCE.doi!, crossref({ DOI: "10.5555/masik" }))
        .reasons,
      ["DOI_DIFFERS"],
    );
    assert.equal(
      readCrossrefWork(SOURCE, SOURCE.doi!, {}).verdict,
      "OTHER_WORK",
    );
  });
  it("a different year is a note, not a failure", () => {
    const r = readCrossrefWork(
      SOURCE,
      SOURCE.doi!,
      crossref({ issued: { "date-parts": [[2002]] } }),
    );
    assert.equal(r.verdict, "RESOLVED");
    assert.equal(r.yearDiffers, true);
  });
});

describe("a Europe PMC answer", () => {
  it("the same PMID and title: RESOLVED", () => {
    assert.equal(
      readEuropePmcHit(SOURCE, "11111111", europePmc()).verdict,
      "RESOLVED",
    );
  });
  it("no hit is NOT_FOUND; a hit of another PMID, title or DOI is OTHER_WORK", () => {
    assert.equal(
      readEuropePmcHit(SOURCE, "11111111", {
        hitCount: 0,
        resultList: { result: [] },
      }).verdict,
      "NOT_FOUND",
    );
    assert.deepEqual(
      readEuropePmcHit(SOURCE, "11111111", europePmc({ pmid: "22222222" }))
        .reasons,
      ["PMID_DIFFERS"],
    );
    assert.deepEqual(
      readEuropePmcHit(SOURCE, "11111111", europePmc({ title: "Más" })).reasons,
      ["TITLE_DIFFERS"],
    );
    assert.deepEqual(
      readEuropePmcHit(SOURCE, "11111111", europePmc({ doi: "10.5555/masik" }))
        .reasons,
      ["DOI_DIFFERS"],
    );
  });
  it("a hit without a DOI is not a DOI mismatch", () => {
    assert.equal(
      readEuropePmcHit(SOURCE, "11111111", europePmc({ doi: undefined }))
        .verdict,
      "RESOLVED",
    );
  });
});

/** A fake registry: URL substring -> [status, body]. */
function registry(routes: [string, number, unknown][]): {
  fetch: ApiFetch;
  urls: string[];
} {
  const urls: string[] = [];
  return {
    urls,
    fetch: async (url) => {
      urls.push(url);
      const route = routes.find(([part]) => url.includes(part));
      if (!route) throw new Error(`unexpected ${url}`);
      return new Response(JSON.stringify(route[2]), { status: route[1] });
    },
  };
}
const deps = (
  fetch: ApiFetch,
  checkable: ReferenceSource[],
  withoutId = 0,
) => ({
  sources: async () => ({ checkable, withoutId }),
  fetch,
  sleep: async () => undefined,
  now: () => new Date("2026-10-28T05:00:00Z"),
});
function output() {
  const out = { stdout: "", stderr: "" };
  return {
    out,
    sink: {
      stdout: (t: string) => (out.stdout += t),
      stderr: (t: string) => (out.stderr += t),
    },
  };
}

describe("the run", () => {
  const GOOD: [string, number, unknown][] = [
    ["api.crossref.org/works/10.5555/kitalalt.2001.1", 200, crossref()],
    ["europepmc", 200, europePmc()],
  ];

  it("asks Crossref for the DOI and Europe PMC for the PMID, and passes when both resolve", async () => {
    const reg = registry(GOOD);
    const { out, sink } = output();
    assert.equal(
      await runReferenceCli([], sink, deps(reg.fetch, [SOURCE], 3)),
      0,
    );
    assert.equal(reg.urls.length, 2);
    assert.match(reg.urls[1]!, /query=EXT_ID%3A11111111%20AND%20SRC%3AMED/);
    assert.match(
      out.stdout,
      /T1: 2\/2 azonosító feloldva, 1 forrásból -> TELJESÜL/,
    );
    assert.match(
      out.stdout,
      /Azonosító nélküli befogadott forrás \(nem mérhető\): 3/,
    );
    // the output names identifiers and codes, never a title
    assert.equal(out.stdout.includes("kalcifik"), false);
  });
  it("a DOI Crossref does not know fails the run with its identifier", async () => {
    const reg = registry([
      ["api.crossref.org", 404, {}],
      ["europepmc", 200, europePmc()],
    ]);
    const { out, sink } = output();
    assert.equal(await runReferenceCli([], sink, deps(reg.fetch, [SOURCE])), 3);
    assert.match(
      out.stdout,
      /NOT_FOUND DOI 10\.5555\/kitalalt\.2001\.1 \(forrás s1\): HTTP_404/,
    );
  });
  it("another work behind the DOI fails the run", async () => {
    const reg = registry([
      [
        "api.crossref.org",
        200,
        crossref({ title: ["Egészen más cikk a nitrátról"] }),
      ],
      ["europepmc", 200, europePmc()],
    ]);
    const { out, sink } = output();
    assert.equal(await runReferenceCli([], sink, deps(reg.fetch, [SOURCE])), 3);
    assert.match(out.stdout, /OTHER_WORK DOI .*TITLE_DIFFERS/);
  });
  it("a registry that does not answer is no pass: the identifier is UNREACHABLE", async () => {
    const reg = registry([
      ["api.crossref.org", 503, {}],
      ["europepmc", 200, europePmc()],
    ]);
    const { out, sink } = output();
    assert.equal(await runReferenceCli([], sink, deps(reg.fetch, [SOURCE])), 4);
    assert.match(out.stdout, /UNREACHABLE DOI .*HTTP_503/);
    assert.match(out.stdout, /NEM TELJESÜL/);
  });
  it("nothing to check is not a pass either", async () => {
    const { sink } = output();
    assert.equal(
      await runReferenceCli([], sink, deps(registry([]).fetch, [])),
      2,
    );
  });
  it("--json gives the whole report", async () => {
    const { out, sink } = output();
    await runReferenceCli(
      ["--json"],
      sink,
      deps(registry(GOOD).fetch, [SOURCE], 1),
    );
    const r = JSON.parse(out.stdout);
    assert.equal(r.met, true);
    assert.equal(r.withoutIdentifier, 1);
    assert.deepEqual(
      r.results.map((x: { kind: string }) => x.kind),
      ["DOI", "PMID"],
    );
  });
  it("a source with only a DOI is asked once", async () => {
    const reg = registry(GOOD);
    const r = await checkReferences([{ ...SOURCE, pmid: null }], {
      getJson: async (_api, url) => {
        const res = await reg.fetch(url, {
          method: "GET",
          headers: {},
          signal: AbortSignal.timeout(1000),
        });
        return { ok: true, json: await res.json(), httpStatus: res.status };
      },
    });
    assert.equal(r.identifiers, 1);
    assert.equal(r.met, true);
  });
});
