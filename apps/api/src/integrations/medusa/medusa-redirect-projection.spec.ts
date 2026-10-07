import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MedusaUrlRedirect } from "./medusa-admin.client.js";
import { runRedirectCli } from "./medusa-redirect.cli.js";
import {
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
    assert.equal(
      urlRedirectsHash([
        r("/b", "/hu/termek/b"),
        r("/Pumpa", "/hu/termek/p"),
        r("/spd/1/Á", "/hu/termek/a"),
      ]),
      "e940fd01f827505f2388bbb2c28fbaeaf5bc86d8c9f27de68b265b1df7217832",
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
