import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MedusaUrlRedirect } from "./medusa-admin.client.js";
import { runRedirectCli } from "./medusa-redirect.cli.js";
import {
  describeRedirectProjection,
  projectUrlRedirects,
  urlRedirectsHash,
  type RedirectSource,
} from "./medusa-redirect-projection.js";

/**
 * AZ ÁTIRÁNYÍTÁS-LISTA VETÍTÉSE (SEO P0 PR 7b). MI PIROSIT: az ujjlenyomat eltér a
 * commerce-étől (a közös tesztvektor); azonos listánál is küld; eltérésnél nem a
 * teljes listát küldi; láncot küld; a szárazfutás ír; ismeretlen kapcsolóra fut.
 */
const r = (
  source_path: string,
  destination_path: string,
): MedusaUrlRedirect => ({
  source_path,
  destination_path,
  status: 301,
});
const forras = (rows: MedusaUrlRedirect[]): RedirectSource => ({
  activeRedirects: async () =>
    rows.map((x) => ({
      sourcePath: x.source_path,
      destinationPath: x.destination_path,
      httpStatus: x.status,
    })),
});
function bolt(rows: MedusaUrlRedirect[]) {
  const kuldott: MedusaUrlRedirect[][] = [];
  return {
    kuldott,
    client: {
      fetchUrlRedirects: async () => ({
        count: rows.length,
        hash: urlRedirectsHash(rows),
        redirects: rows,
      }),
      replaceUrlRedirects: async (list: MedusaUrlRedirect[]) => {
        kuldott.push(list);
        return {
          count: list.length,
          hash: urlRedirectsHash(list),
          redirects: list,
        };
      },
    },
  };
}

describe("urlRedirectsHash", () => {
  it("a commerce közös tesztvektora (apps/backend url-redirects spec)", () => {
    // `/á` és `/b`: kódegység-sorrendben az `/á` az utolsó, localeCompare-rel az
    // első, tehát egy localeCompare-es rendezés más lenyomatot adna (barracuda, #533 2.)
    assert.equal(
      urlRedirectsHash([
        r("/b", "/hu/termek/b"),
        r("/Pumpa", "/hu/termek/p"),
        r("/spd/1/Á", "/hu/termek/a"),
        r("/á", "/hu/termek/aa"),
        r("/a-b", "/hu/termek/ab1"),
        r("/ab", "/hu/termek/ab2"),
      ]),
      "2cef566902591f180ff39c090f476a8560c7bbcacfa62ab2e04b93e8277ae64f",
    );
  });

  it("sorrend-független", () => {
    const sorok = [r("/b", "/x"), r("/A", "/y")];
    assert.equal(
      urlRedirectsHash(sorok),
      urlRedirectsHash([...sorok].reverse()),
    );
  });
});

describe("projectUrlRedirects", () => {
  const ott = [r("/Pumpa", "/hu/termek/p")];

  it("azonos lista: nem küld", async () => {
    const b = bolt(ott);
    const e = await projectUrlRedirects(b.client, forras(ott), true);
    assert.equal(e.status, "unchanged");
    assert.deepEqual(b.kuldott, []);
  });

  it("eltérés: a teljes listát küldi, --apply mellett", async () => {
    const b = bolt(ott);
    const uj = [...ott, r("/Szuro", "/hu/termek/sz")];
    const e = await projectUrlRedirects(b.client, forras(uj), true);
    assert.equal(e.status, "sent");
    assert.deepEqual(b.kuldott, [uj]);
  });

  it("szárazfutás: nem küld", async () => {
    const b = bolt([]);
    const e = await projectUrlRedirects(b.client, forras(ott), false);
    assert.equal(e.status, "would-send");
    assert.deepEqual(b.kuldott, []);
  });

  it("410-es sor: a célja önmaga, nem lánc; a lap nélküli termékeket megszámolja", async () => {
    const b = bolt([]);
    const e = await projectUrlRedirects(
      b.client,
      {
        activeRedirects: async () => [
          {
            sourcePath: "/SLW-10",
            destinationPath: "/SLW-10",
            httpStatus: 410,
            target: "gone",
          },
          {
            sourcePath: "/SLW-20",
            destinationPath: "/hu/marka/jebao",
            httpStatus: 301,
            target: "brand",
          },
          {
            sourcePath: "/Pumpa",
            destinationPath: "/hu/termek/p",
            httpStatus: 301,
            target: "page",
          },
        ],
      },
      true,
    );
    assert.equal(e.status, "sent");
    assert.deepEqual(b.kuldott, [
      [
        { source_path: "/SLW-10", destination_path: "/SLW-10", status: 410 },
        r("/SLW-20", "/hu/marka/jebao"),
        r("/Pumpa", "/hu/termek/p"),
      ],
    ]);
    assert.match(
      describeRedirectProjection(e),
      /lap nelkuli termek: 1 a markalapra, 1 410$/,
    );
  });

  it("a véglegesen megszűnt termék sorait megszámolja, és a jelentés megnevezi", async () => {
    const b = bolt([]);
    const e = await projectUrlRedirects(
      b.client,
      {
        activeRedirects: async () => [
          {
            sourcePath: "/Regi",
            destinationPath: "/hu/termek/uj",
            httpStatus: 301,
            target: "moved",
          },
          {
            sourcePath: "/hu/termek/regi",
            destinationPath: "/hu/termek/uj",
            httpStatus: 301,
            target: "moved",
          },
          {
            sourcePath: "/Pumpa",
            destinationPath: "/hu/termek/p",
            httpStatus: 301,
            target: "page",
          },
        ],
      },
      false,
    );
    assert.equal(e.status, "would-send");
    assert.deepEqual(e.retargeted, { brand: 0, gone: 0, moved: 2 });
    assert.match(
      describeRedirectProjection(e),
      /veglegesen megszunt termek: 2 sor a helyettesitore vagy a kategoriara$/,
    );
  });

  it("301 egy 410-es forrásra: lánc, nem küld", async () => {
    const b = bolt([]);
    const e = await projectUrlRedirects(
      b.client,
      forras([
        { source_path: "/x", destination_path: "/x", status: 410 },
        r("/y", "/X"),
      ]),
      true,
    );
    assert.equal(e.status, "refused");
    assert.deepEqual(b.kuldott, []);
  });

  it("lánc: nem küld, és megnevezi", async () => {
    const b = bolt([]);
    const e = await projectUrlRedirects(
      b.client,
      forras([r("/a", "/B"), r("/b", "/c")]),
      true,
    );
    assert.equal(e.status, "refused");
    assert.deepEqual(b.kuldott, []);
  });
});

describe("a medusa:redirects parancs", () => {
  const csend = { stdout: () => {}, stderr: () => {} };

  it("alapból szárazfutás, --apply mellett küld, ismeretlen kapcsolóra nem fut", async () => {
    const egy = [r("/Pumpa", "/hu/termek/p")];
    let b = bolt([]);
    assert.equal(
      await runRedirectCli([], csend, {
        client: async () => b.client as never,
        source: forras(egy),
      }),
      0,
    );
    assert.deepEqual(b.kuldott, []);
    b = bolt([]);
    assert.equal(
      await runRedirectCli(["--apply"], csend, {
        client: async () => b.client as never,
        source: forras(egy),
      }),
      0,
    );
    assert.deepEqual(b.kuldott, [egy]);
    b = bolt([]);
    assert.equal(
      await runRedirectCli(["--aply"], csend, {
        client: async () => b.client as never,
        source: forras(egy),
      }),
      1,
    );
    assert.deepEqual(b.kuldott, []);
  });
});
