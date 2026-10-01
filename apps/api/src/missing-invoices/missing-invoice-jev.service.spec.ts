import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";
import type { FetchLike, KnownRow } from "@acropora/jev";

import type { CandidateDocument } from "./missing-invoice-matching.js";
import type {
  MissingInvoiceJevRepository,
  StoredPairRun,
} from "./missing-invoice-jev.repository.js";
import { MissingInvoiceJevService } from "./missing-invoice-jev.service.js";

const KULCS = "titkos-kulcs-SOHA-NEM-LATSZIK";
/* A 10%-os kontroll: sha256("<id>:1") elso 8 hex jegye mod 10 == 0. */
const LATHATO = "bt-teszt-0";
const KONTROLL = "bt-teszt-14";
const ENV = {
  JEV_MISSING_INVOICE_PAIR: "live",
  TYPESAFE_API_KEY: KULCS,
  JEV_COMMON_WORDS: "/flotta/jev-common-words.txt",
};

const D = (v: number) => new Prisma.Decimal(v);
const doc = (
  id: string,
  gross: number,
  supplierName: string,
): CandidateDocument => ({
  id,
  source: "NAV",
  number: `SZ-${id}`,
  date: "2026-05-02",
  gross: D(gross),
  currency: "HUF",
  supplierName,
  supplierAccounts: [],
  kind: "INVOICE",
  payee: "COMPANY",
  hasOriginal: true,
});
const JELOLTEK = [
  doc("docA", 38000, "Valaki Más Kft."),
  doc("docB", 38488, "Magyar Telekom Nyrt."),
];
const fizetes = (
  narrative = "TELEKOMSZAML 925585488 Kovács Péter részére",
) => ({
  date: "2026-05-10",
  amount: "38488",
  currency: "HUF",
  original: "",
  partner: "Kovács Péter",
  narrative,
  type: "ÁTUTALÁS",
});

type Sor = { -readonly [K in keyof StoredPairRun]: StoredPairRun[K] } & {
  entityId: string;
  projectionHash: string;
  resolution: string | null;
  resolvedValue: string | null;
  data: Record<string, unknown>;
};

/** A TAROLO DUPLAJA a valodi szerzodes tipusaval; a teszt a TENYLEG irt sorokat meri. */
function tarolo(opciok: { known?: KnownRow[]; dob?: boolean } = {}) {
  const sorok: Sor[] = [];
  let knownHivas = 0;
  const repo: Pick<
    MissingInvoiceJevRepository,
    | "knownRows"
    | "findRun"
    | "createRun"
    | "markOthersStale"
    | "openRun"
    | "resolveRun"
  > = {
    knownRows: async () => {
      knownHivas++;
      return opciok.known ?? [];
    },
    findRun: async (k) =>
      sorok.find(
        (s) =>
          s.entityId === k.entityId && s.projectionHash === k.projectionHash,
      ) ?? null,
    createRun: async (data) => {
      const sor: Sor = {
        id: `run${sorok.length + 1}`,
        selectedValue:
          (data.selectedValue as string | null | undefined) ?? null,
        confidence: (data.confidence as number | null | undefined) ?? null,
        exposure: data.exposure as "HIDDEN" | "SHOWN",
        status: data.status as "OK" | "ERROR",
        entityId: data.entityId as string,
        projectionHash: data.projectionHash,
        resolution: null,
        resolvedValue: null,
        data: data as unknown as Record<string, unknown>,
      };
      sorok.push(sor);
      return sor;
    },
    markOthersStale: async (k, id) => {
      for (const s of sorok)
        if (s.entityId === k.entityId && s.id !== id && s.resolution === null)
          s.resolution = "STALE";
    },
    openRun: async (k) => {
      if (opciok.dob) throw new Error("az adatbazis nem elerheto");
      return (
        [...sorok]
          .reverse()
          .find((s) => s.entityId === k.entityId && s.resolution === null) ??
        null
      );
    },
    resolveRun: async (id, data) => {
      const s = sorok.find((x) => x.id === id)!;
      s.resolution = data.resolution;
      s.resolvedValue = data.resolvedValue;
    },
  };
  return {
    repo: repo as unknown as MissingInvoiceJevRepository,
    sorok,
    known: () => knownHivas,
  };
}

function szolgaltato(valasz: { status?: number; body: unknown } | Error) {
  const hivasok: {
    body: Record<string, unknown>;
    headers: Record<string, string>;
  }[] = [];
  const fetch: FetchLike = async (_url, init) => {
    hivasok.push({ body: JSON.parse(init.body), headers: init.headers });
    if (valasz instanceof Error) throw valasz;
    return {
      status: valasz.status ?? 200,
      headers: { get: () => null },
      text: async () =>
        typeof valasz.body === "string"
          ? valasz.body
          : JSON.stringify(valasz.body),
    };
  };
  return { fetch, hivasok };
}

const valasz = (choice: string, confidence: number) => ({
  body: {
    model: "jev-1.13.0",
    answers: {
      pair: { choice, confidence, probabilities: { [choice]: confidence } },
    },
    usage: { input_tokens: 900 },
  },
});

function szolgaltatas(opciok: {
  env?: Record<string, string>;
  fetch?: FetchLike;
  repo?: MissingInvoiceJevRepository;
  common?: string;
}) {
  const olvasott: string[] = [];
  const s = new MissingInvoiceJevService(
    opciok.repo ?? tarolo().repo,
    { ...ENV, ...opciok.env },
    opciok.fetch ?? szolgaltato(valasz("c1", 0.95)).fetch,
    async (path) => {
      olvasott.push(path);
      return opciok.common ?? "partner\nreference\ntype\nbank\n";
    },
  );
  return { s, olvasott };
}

const javaslat = (
  s: MissingInvoiceJevService,
  id = LATHATO,
  narrative?: string,
) =>
  s.suggest({
    bankTransactionId: id,
    payment: fizetes(narrative),
    candidates: JELOLTEK,
    kinds: ["NEV"],
  });

describe("MissingInvoiceJevService: a kapcsolo es a zarak", () => {
  it("ki van kapcsolva, ha a kapcsolo nem `live`, ha nincs kulcs, vagy nincs szavak-fajl", async () => {
    for (const env of <Record<string, string>[]>[
      { JEV_MISSING_INVOICE_PAIR: "on" },
      { TYPESAFE_API_KEY: " " },
      { JEV_COMMON_WORDS: "" },
    ]) {
      const p = szolgaltato(valasz("c1", 0.95));
      const { s, olvasott } = szolgaltatas({ env, fetch: p.fetch });
      assert.deepEqual(await javaslat(s), {
        enabled: false,
        documentId: null,
        confidence: null,
      });
      assert.equal(p.hivasok.length, 0);
      assert.deepEqual(olvasott, []);
    }
  });

  it("ures szavak-fajllal NEM hiv: nelkule a kitakaro nem az r11, amit mertunk", async () => {
    const p = szolgaltato(valasz("c1", 0.95));
    const t = tarolo();
    const { s } = szolgaltatas({
      fetch: p.fetch,
      repo: t.repo,
      common: "\n\n",
    });
    assert.deepEqual(await javaslat(s), {
      enabled: true,
      documentId: null,
      confidence: null,
    });
    assert.equal(p.hivasok.length, 0);
    assert.equal(t.sorok.length, 0);
  });
});

describe("MissingInvoiceJevService: a hivas", () => {
  it("a kitakart, mert alakot kuldi, es a lathato javaslat a szamla azonositoja", async () => {
    const p = szolgaltato(valasz("c1", 0.95));
    const t = tarolo();
    const { s } = szolgaltatas({ fetch: p.fetch, repo: t.repo });
    assert.deepEqual(await javaslat(s), {
      enabled: true,
      documentId: "docB",
      confidence: 0.95,
    });
    assert.equal(p.hivasok.length, 1);
    const body = p.hivasok[0]!.body;
    const kuldott = JSON.stringify(body);
    // a magansezemely partner es a neve a kozlemenyben sem megy ki
    assert.ok(!kuldott.includes("Kovács"), kuldott);
    assert.ok(!kuldott.includes(KULCS));
    assert.equal(p.hivasok[0]!.headers.Authorization, `Bearer ${KULCS}`);
    assert.equal(body.model, "jev-1.13.0");
    const kerdes = (body.questions as Record<string, Record<string, unknown>>)
      .pair!;
    assert.deepEqual(Object.keys(kerdes), ["type", "criteria", "instructions"]);
    assert.deepEqual(Object.keys(kerdes.criteria as object), [
      "c0",
      "c1",
      "NONE",
    ]);
    assert.deepEqual(Object.keys(body.state as object), ["query", "c0", "c1"]);
    assert.match(
      (body.state as Record<string, string>).c1!,
      /Magyar Telekom Nyrt\./,
    );
    // a futas: a valasztott szamla AZONOSITOJA, a vetulet a kitakart szoveg
    const sor = t.sorok[0]!;
    assert.equal(sor.selectedValue, "docB");
    assert.equal(sor.exposure, "SHOWN");
    assert.equal(sor.status, "OK");
    assert.ok(!JSON.stringify(sor.data.projectionPayload).includes("Kovács"));
  });

  it("ugyanarra a vetuletre nincs uj hivas, a known-lista egyszer epul", async () => {
    const p = szolgaltato(valasz("c1", 0.95));
    const t = tarolo();
    const { s } = szolgaltatas({ fetch: p.fetch, repo: t.repo });
    await javaslat(s);
    assert.deepEqual(await javaslat(s), {
      enabled: true,
      documentId: "docB",
      confidence: 0.95,
    });
    assert.equal(p.hivasok.length, 1);
    assert.equal(t.known(), 1);
  });

  it("rejtett marad: a kontroll-terheles, a NONE es a 0,9 alatti bizonyossag", async () => {
    for (const [id, v] of [
      [KONTROLL, valasz("c1", 0.99)],
      [LATHATO, valasz("NONE", 0.97)],
      [LATHATO, valasz("c1", 0.89)],
    ] as const) {
      const t = tarolo();
      const { s } = szolgaltatas({ fetch: szolgaltato(v).fetch, repo: t.repo });
      assert.deepEqual(await javaslat(s, id), {
        enabled: true,
        documentId: null,
        confidence: null,
      });
      assert.equal(t.sorok[0]!.exposure, "HIDDEN");
    }
  });

  it("egy ismert nev jogi forma nelkul megallitja: nincs hivas, a futas hibakent rogzul", async () => {
    const p = szolgaltato(valasz("c1", 0.95));
    const t = tarolo();
    const { s } = szolgaltatas({ fetch: p.fetch, repo: t.repo });
    // a FANK a flotta szintu EXTRA listan all, jogi forma nelkul
    assert.deepEqual(await javaslat(s, LATHATO, "FANK karbantartás"), {
      enabled: true,
      documentId: null,
      confidence: null,
    });
    assert.equal(p.hivasok.length, 0);
    assert.equal(t.sorok[0]!.status, "ERROR");
    assert.equal(t.sorok[0]!.data.errorCode, "blocked_runtime_guard");
    assert.equal(t.sorok[0]!.data.projectionPayload, undefined);
  });

  it("a szolgaltato hibaja csendes kimaradas; az eltunt modell leallitja", async () => {
    const t = tarolo();
    const halozat = szolgaltatas({
      fetch: szolgaltato(new Error("ECONNRESET")).fetch,
      repo: t.repo,
    });
    assert.deepEqual(await javaslat(halozat.s), {
      enabled: true,
      documentId: null,
      confidence: null,
    });
    assert.equal(t.sorok[0]!.data.errorCode, "NETWORK_ERROR");

    const p = szolgaltato({ status: 400, body: "Unknown model: jev-1.13.0" });
    const { s } = szolgaltatas({ fetch: p.fetch });
    await javaslat(s);
    assert.equal(s.enabled(), false);
    assert.deepEqual(await javaslat(s, "bt-teszt-1"), {
      enabled: false,
      documentId: null,
      confidence: null,
    });
    assert.equal(p.hivasok.length, 1);
  });
});

describe("MissingInvoiceJevService: r12 es a jelolt kiejtese (acrobot 25560, 25567)", () => {
  const hanna = doc("docH", 146000, "HANNA Instruments Service Kft.");
  const masik = doc("docE", 145854, "Euroleasing Zrt.");

  it("r12: a HANNA szamla jelolt marad, es lehet o maga a valasz", async () => {
    const p = szolgaltato(valasz("c0", 0.95));
    const t = tarolo({ known: [["ORG", "HANNA Instruments Service Kft."]] });
    const { s } = szolgaltatas({ fetch: p.fetch, repo: t.repo });
    const v = await s.suggest({
      bankTransactionId: LATHATO,
      payment: {
        date: "2026-05-10",
        amount: "146000",
        currency: "HUF",
        original: "",
        partner: "HANNA Instruments Service Kft.",
        narrative: "SZ-docH",
        type: "ÁTUTALÁS",
      },
      candidates: [hanna, masik],
      kinds: ["NEV"],
    });
    assert.deepEqual(v, {
      enabled: true,
      documentId: "docH",
      confidence: 0.95,
    });
    assert.deepEqual(Object.keys(p.hivasok[0]!.body.state as object), [
      "query",
      "c0",
      "c1",
    ]);
    assert.deepEqual(
      (t.sorok[0]!.data.projectionPayload as { data: { dropped: string[] } })
        .data.dropped,
      [],
    );
  });

  // a FANK a flotta szintu EXTRA listan all: egy szamlaszamban jogi forma nelkul
  const fank = { ...doc("docF", 1999, "Szállító Kft."), number: "FANK-2026" };
  const helyes = doc("docS", 1999, "Szállító Kft.");
  const fizetes = {
    date: "2026-05-10",
    amount: "1999",
    currency: "HUF",
    original: "",
    partner: "Akvárium Szerviz Kft.",
    narrative: "SZ-docS",
    type: "ÁTUTALÁS",
  };

  it("az orben megallo jelolt kiesik, a valasz a megmaradt sorszamon at a helyes azonosito", async () => {
    const p = szolgaltato(valasz("c0", 0.95));
    const t = tarolo();
    const { s } = szolgaltatas({ fetch: p.fetch, repo: t.repo });
    const v = await s.suggest({
      bankTransactionId: LATHATO,
      payment: fizetes,
      candidates: [fank, helyes],
      kinds: ["NEV"],
    });
    assert.deepEqual(v, {
      enabled: true,
      documentId: "docS",
      confidence: 0.95,
    });
    const body = p.hivasok[0]!.body;
    assert.deepEqual(Object.keys(body.state as object), ["query", "c0"]);
    assert.ok(!JSON.stringify(body).includes("FANK"));
    const sor = t.sorok[0]!;
    assert.equal(sor.selectedValue, "docS");
    assert.deepEqual(
      (sor.data.projectionPayload as { data: { dropped: string[] } }).data
        .dropped,
      ["docF"],
    );
  });

  it("ha minden jelolt kiesik, nincs hivas, es a futas hibakent rogzul", async () => {
    const p = szolgaltato(valasz("c0", 0.95));
    const t = tarolo();
    const { s } = szolgaltatas({ fetch: p.fetch, repo: t.repo });
    const v = await s.suggest({
      bankTransactionId: LATHATO,
      payment: fizetes,
      candidates: [fank],
      kinds: ["NEV"],
    });
    assert.deepEqual(v, { enabled: true, documentId: null, confidence: null });
    assert.equal(p.hivasok.length, 0);
    assert.equal(t.sorok[0]!.status, "ERROR");
    assert.equal(t.sorok[0]!.data.errorMessage, "no candidate left");
  });
});

describe("MissingInvoiceJevService: a feloldas a kezi parositaskor", () => {
  it("elfogadott, felulirt, es a rejtettnel arnyek-egyezes", async () => {
    for (const [id, paired, want] of [
      [LATHATO, "docB", "ACCEPTED"],
      [LATHATO, "docA", "OVERRIDDEN"],
      [KONTROLL, "docB", "SHADOW_MATCH"],
      [KONTROLL, "docA", "SHADOW_MISMATCH"],
    ] as const) {
      const t = tarolo();
      const { s } = szolgaltatas({
        fetch: szolgaltato(valasz("c1", 0.99)).fetch,
        repo: t.repo,
      });
      await javaslat(s, id);
      await s.resolveOnPair({ bankTransactionId: id, documentId: paired });
      assert.equal(t.sorok[0]!.resolution, want, `${id} ${paired}`);
      assert.equal(t.sorok[0]!.resolvedValue, paired);
    }
  });

  it("a hibas futasnak nincs javaslata, es a feloldas soha nem dob", async () => {
    const t = tarolo();
    const { s } = szolgaltatas({
      fetch: szolgaltato(new Error("x")).fetch,
      repo: t.repo,
    });
    await javaslat(s);
    await s.resolveOnPair({ bankTransactionId: LATHATO, documentId: "docB" });
    assert.equal(t.sorok[0]!.resolution, null);
    assert.equal(t.sorok[0]!.resolvedValue, "docB");

    const rossz = tarolo({ dob: true });
    const { s: s2 } = szolgaltatas({ repo: rossz.repo });
    await s2.resolveOnPair({ bankTransactionId: LATHATO, documentId: "docB" });
  });
});
