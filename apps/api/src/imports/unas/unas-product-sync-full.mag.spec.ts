import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, it } from "node:test";

import {
  FULL_SYNC_USAGE,
  runUnasProductSyncFull,
  type FullSyncDeps,
  type FullSyncRunRow,
} from "./unas-product-sync-full.mag.js";

const RUN: FullSyncRunRow = {
  id: "run-1",
  kind: "FULL",
  status: "APPLIED",
  startedAt: new Date("2026-11-14T18:43:59.000Z"),
  completedAt: new Date("2026-11-14T18:46:11.800Z"),
  productsSeen: 1919,
  createdCount: 13,
  updatedCount: 1556,
  unchangedCount: 157,
  conflictCount: 0,
  missingCount: 3,
  skippedCount: 194,
  skippedSourceChangedCount: 0,
  errorCode: null,
};

function harness(overrides: Partial<FullSyncDeps> = {}) {
  const calls: string[] = [];
  const deps: FullSyncDeps = {
    getToken: async () => {
      calls.push("getToken");
      return "token-value";
    },
    runFull: async (token) => {
      calls.push(`runFull:${token}`);
      return { runId: "run-1" };
    },
    readRun: async (runId) => {
      calls.push(`readRun:${runId}`);
      return RUN;
    },
    ...overrides,
  };
  const out: string[] = [];
  const err: string[] = [];
  return {
    calls,
    out,
    err,
    deps,
    io: { stdout: (t: string) => out.push(t), stderr: (t: string) => err.push(t) },
  };
}

describe("a UNAS teljes ujraolvasas parancsanak teste", () => {
  it("--teljes nelkul nem olvas semmit, nem indit semmit, 2-vel kilep", async () => {
    const h = harness();
    const code = await runUnasProductSyncFull([], h.deps, h.io);
    assert.equal(code, 2);
    // A LENYEG: se token, se futas, se adatbazis-olvasas a kapcsolo nelkul.
    assert.deepEqual(h.calls, []);
    assert.deepEqual(h.out, []);
    assert.match(h.err.join(""), /--teljes/);
  });

  it("ismeretlen argumentumnal is megall, es megnevezi", async () => {
    const h = harness();
    const code = await runUnasProductSyncFull(["--teljes", "--gyors"], h.deps, h.io);
    assert.equal(code, 2);
    assert.deepEqual(h.calls, []);
    assert.match(h.err.join(""), /--gyors/);
  });

  it("lefut, es EGY JSON sorban csak szamokat es kodokat ir ki", async () => {
    const h = harness();
    const code = await runUnasProductSyncFull(["--teljes"], h.deps, h.io);
    assert.equal(code, 0);
    assert.deepEqual(h.calls, ["getToken", "runFull:token-value", "readRun:run-1"]);
    assert.equal(h.out.length, 1);
    assert.ok(h.out[0]!.endsWith("\n"));
    assert.deepEqual(JSON.parse(h.out[0]!), {
      runId: "run-1",
      kind: "FULL",
      status: "APPLIED",
      durationSeconds: 132.8,
      productsSeen: 1919,
      created: 13,
      updated: 1556,
      unchanged: 157,
      conflict: 0,
      missing: 3,
      skipped: 194,
      skippedSourceChanged: 0,
      errorCode: null,
    });
    // A token nem kerulhet a kimenetre.
    assert.doesNotMatch(h.out.join("") + h.err.join(""), /token-value/);
  });

  it("FAILED futas 1-gyel lep ki, de a szamokat kiirja", async () => {
    const h = harness({
      readRun: async () => ({ ...RUN, status: "FAILED", errorCode: "UNAS_X" }),
    });
    assert.equal(await runUnasProductSyncFull(["--teljes"], h.deps, h.io), 1);
    assert.equal(JSON.parse(h.out[0]!).errorCode, "UNAS_X");
  });

  it("ha mar fut egy szinkron, 3-mal lep ki, es nem olvassa a futast", async () => {
    const h = harness({
      runFull: async () => {
        throw new Error("UNAS_PRODUCT_SYNC_ALREADY_RUNNING");
      },
    });
    assert.equal(await runUnasProductSyncFull(["--teljes"], h.deps, h.io), 3);
    assert.deepEqual(h.out, []);
    assert.match(h.err.join(""), /UNAS_PRODUCT_SYNC_ALREADY_RUNNING/);
  });

  it("szabad szoveges hibat nem ir ki, csak altalanos kodot", async () => {
    const h = harness({
      getToken: async () => {
        throw new Error("connect ECONNREFUSED secret-host.example:443");
      },
    });
    assert.equal(await runUnasProductSyncFull(["--teljes"], h.deps, h.io), 1);
    const text = h.err.join("");
    assert.match(text, /UNAS_PRODUCT_SYNC_FULL_FAILED/);
    assert.doesNotMatch(text, /secret-host/);
  });

  it("ha a futas ideje hianyzik, null idotartamot ir", async () => {
    const h = harness({ readRun: async () => ({ ...RUN, completedAt: null }) });
    await runUnasProductSyncFull(["--teljes"], h.deps, h.io);
    assert.equal(JSON.parse(h.out[0]!).durationSeconds, null);
  });
});

/** A csomag gyokerehez kepest (`apps/api`), mert a teszt a `test-dist` alol fut. */
const FORDITOTT = "dist/imports/unas/unas-product-sync-full.cli.js";
const FORRAS = "src/imports/unas/unas-product-sync-full";

describe("a UNAS teljes ujraolvasas parancsanak INDULASA", () => {
  /**
   * A tunet (a parancs kulon folyamatban elindul-e) es az ok (az import-iranyok) KET kulon meres:
   * a torzs fixture-on hivva a modul-betoltesrol semmit nem tud (acrobot 2026-09-17, a
   * kapcsolat-ujraepites parancsa 13-as kilepessel nem indult, mikozben harom orzo zold volt).
   */
  it("kulon folyamatban elindul, es --help-pel nem ures kimenettel er veget", () => {
    // A DIAGNOZIS A FUTTATAS ELOTT All: a `dist` hianya nem a kod hibaja.
    assert.ok(
      existsSync(FORDITOTT),
      `a lefordított parancs NINCS MEG (${FORDITOTT}) -- ez NEM a kód hibája: a csomag test parancsa a dist-et nem építi; futtasd a repó saját alakjával (turbo run test --filter=@acropora/api).`,
    );
    const regebbi = [".mag.ts", ".cli.ts"]
      .map((veg) => `${FORRAS}${veg}`)
      .filter((ut) => statSync(ut).mtimeMs > statSync(FORDITOTT).mtimeMs);
    assert.deepEqual(
      regebbi,
      [],
      "a lefordított parancs RÉGEBBI, mint a forrása -- építsd újra (turbo run test --filter=@acropora/api).",
    );
    const kimenet = execFileSync("node", [FORDITOTT, "--help"], { encoding: "utf8" });
    assert.ok(kimenet.trim().length > 0);
    assert.equal(kimenet, FULL_SYNC_USAGE);
  });

  it("az import-irany egy iranyba mutat: a mag nem tud a parancsrol", () => {
    const mag = readFileSync(`${FORRAS}.mag.ts`, "utf8");
    const parancs = readFileSync(`${FORRAS}.cli.ts`, "utf8");
    // POZITIV KONTROLL: rossz utvonalnal ures szovegen minden allitas zold.
    assert.ok(mag.length > 500 && parancs.length > 500);
    // Csak az IMPORT-sorra illeszkedik: a fejlec-komment a parancs nevet idezi.
    assert.doesNotMatch(mag, /from\s+"[^"]*full\.cli\.js"/);
    assert.match(parancs, /unas-product-sync-full\.mag\.js/);
  });
});
