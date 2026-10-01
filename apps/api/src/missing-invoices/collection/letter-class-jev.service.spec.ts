import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FetchLike, KnownRow } from "@acropora/jev";

import type {
  MissingInvoiceJevRepository,
  StoredPairRun,
} from "../missing-invoice-jev.repository.js";
import {
  LetterClassJevService,
  type CollectedLetter,
} from "./letter-class-jev.service.js";

const KULCS = "titkos-kulcs-SOHA-NEM-LATSZIK";
const ENV = {
  JEV_LETTER_CLASS: "live",
  TYPESAFE_API_KEY: KULCS,
  JEV_COMMON_WORDS: "/flotta/jev-common-words.txt",
};

const level = (lines?: string[]): CollectedLetter => ({
  source: "INFO_MAIL",
  externalId: "m-1",
  subject: "Invoice 2026-0412",
  fileName: "Invoice_2026-0412.pdf",
  lines: lines ?? [
    "INVOICE",
    "Invoice number: 2026-0412",
    "Contact: Kovács Péter, peter.kovacs@example.com",
    "Total: 1 234,00 EUR",
  ],
});

type Sor = { -readonly [K in keyof StoredPairRun]: StoredPairRun[K] } & {
  entityId: string;
  projectionHash: string;
  resolution: string | null;
  data: Record<string, unknown>;
};

/** A TAROLO DUPLAJA a valodi szerzodes tipusaval; a teszt a TENYLEG irt sorokat meri. */
function tarolo(opciok: { known?: KnownRow[]; dob?: boolean } = {}) {
  const sorok: Sor[] = [];
  let knownHivas = 0;
  const repo: Pick<
    MissingInvoiceJevRepository,
    "knownRows" | "findRun" | "createRun" | "markOthersStale"
  > = {
    knownRows: async () => {
      knownHivas++;
      if (opciok.dob) throw new Error("az adatbazis nem elerheto");
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
      kind: { choice, confidence, probabilities: { [choice]: confidence } },
    },
    usage: { input_tokens: 700 },
  },
});

function szolgaltatas(opciok: {
  env?: Record<string, string>;
  fetch?: FetchLike;
  repo?: MissingInvoiceJevRepository;
  common?: string;
}) {
  const olvasott: string[] = [];
  const s = new LetterClassJevService(
    opciok.repo ?? tarolo().repo,
    { ...ENV, ...opciok.env },
    opciok.fetch ?? szolgaltato(valasz("BEJOVO_SZAMLA", 0.93)).fetch,
    async (path) => {
      olvasott.push(path);
      return opciok.common ?? "contact\nnumber\n";
    },
  );
  return { s, olvasott };
}

describe("LetterClassJevService: a kapcsolo es a zarak", () => {
  it("ki van kapcsolva, ha a kapcsolo nem `live`, ha nincs kulcs, vagy nincs szavak-fajl", async () => {
    for (const env of <Record<string, string>[]>[
      { JEV_LETTER_CLASS: "on" },
      { JEV_LETTER_CLASS: "" },
      { TYPESAFE_API_KEY: " " },
      { JEV_COMMON_WORDS: "" },
    ]) {
      const p = szolgaltato(valasz("BEJOVO_SZAMLA", 0.93));
      const t = tarolo();
      const { s, olvasott } = szolgaltatas({
        env,
        fetch: p.fetch,
        repo: t.repo,
      });
      assert.equal(await s.classify(level()), null);
      assert.equal(p.hivasok.length, 0);
      assert.deepEqual(olvasott, []);
      assert.equal(t.sorok.length, 0);
    }
  });

  it("ures szavak-fajllal NEM hiv: nelkule a kitakaro nem az r14, amit mertunk", async () => {
    const p = szolgaltato(valasz("BEJOVO_SZAMLA", 0.93));
    const t = tarolo();
    const { s } = szolgaltatas({ fetch: p.fetch, repo: t.repo, common: "\n" });
    assert.equal(await s.classify(level()), null);
    assert.equal(p.hivasok.length, 0);
    assert.equal(t.sorok.length, 0);
  });
});

describe("LetterClassJevService: a hivas", () => {
  it("a kitakart, mert alakot kuldi, es az osztalyt, a bizonyossagot es a futast adja vissza", async () => {
    const p = szolgaltato(valasz("BEJOVO_SZAMLA", 0.93));
    const t = tarolo();
    const { s } = szolgaltatas({ fetch: p.fetch, repo: t.repo });
    assert.deepEqual(await s.classify(level()), {
      kind: "BEJOVO_SZAMLA",
      confidence: 0.93,
      decisionRunId: "run1",
    });
    assert.equal(p.hivasok.length, 1);
    const body = p.hivasok[0]!.body;
    const kuldott = JSON.stringify(body);
    // a szemely es az e-mail nem megy ki; a dokumentum fajtajat jelolo szo igen
    assert.ok(!/Kovács|Péter|example\.com/.test(kuldott), kuldott);
    assert.ok(!kuldott.includes(KULCS));
    assert.equal(p.hivasok[0]!.headers.Authorization, `Bearer ${KULCS}`);
    const message = (body.state as Record<string, string>).message!;
    assert.match(message, /^Subject: Invoice /);
    assert.match(message, /\nFile: Invoice_2026-0412\.pdf\nINVOICE\n/);
    assert.deepEqual(Object.keys(body.state as object), ["message"]);
    const kerdes = (body.questions as Record<string, Record<string, unknown>>)
      .kind!;
    assert.deepEqual(Object.keys(kerdes), ["type", "criteria", "instructions"]);
    assert.equal(Object.keys(kerdes.criteria as object).length, 8);
    // a futas: HIDDEN (a megjelenites a 4. szelet dontese), a fajl az entitas
    const sor = t.sorok[0]!;
    assert.deepEqual(
      [sor.status, sor.exposure, sor.selectedValue, sor.entityId],
      ["OK", "HIDDEN", "BEJOVO_SZAMLA", "INFO_MAIL:m-1:Invoice_2026-0412.pdf"],
    );
    assert.equal(sor.data.entityType, "InvoiceCollectionFile");
    assert.equal(sor.data.policyKey, "acropora-letter-class-v1");
    // a szoveg nem kerul az adatbazisba, kitakarva sem
    const payload = JSON.stringify(sor.data.projectionPayload);
    assert.ok(!payload.includes("INVOICE") && !payload.includes("Subject"));
    assert.match(payload, /"chars":\d+/);
  });

  it("ugyanarra a vetuletre nincs uj hivas (a napi ujraolvasas), a known-lista egyszer epul", async () => {
    const p = szolgaltato(valasz("BEJOVO_SZAMLA", 0.93));
    const t = tarolo();
    const { s } = szolgaltatas({ fetch: p.fetch, repo: t.repo });
    await s.classify(level());
    assert.deepEqual(await s.classify(level()), {
      kind: "BEJOVO_SZAMLA",
      confidence: 0.93,
      decisionRunId: "run1",
    });
    assert.equal(p.hivasok.length, 1);
    assert.equal(t.known(), 1);
  });

  it("mas szoveg ugyanarra a fajlra uj futas, es a regi elavul", async () => {
    const p = szolgaltato(valasz("EGYEB", 0.6));
    const t = tarolo();
    const { s } = szolgaltatas({ fetch: p.fetch, repo: t.repo });
    await s.classify(level());
    const masik = await s.classify(level(["Allgemeine Geschäftsbedingungen"]));
    assert.deepEqual(masik, {
      kind: "EGYEB",
      confidence: 0.6,
      decisionRunId: "run2",
    });
    assert.equal(p.hivasok.length, 2);
    assert.equal(t.sorok[0]!.resolution, "STALE");
  });

  it("a ki nem mehető szoveg: nincs hivas, a futas hibakent rogzul, vetulet nelkul", async () => {
    const p = szolgaltato(valasz("BEJOVO_SZAMLA", 0.93));
    const t = tarolo();
    const { s } = szolgaltatas({ fetch: p.fetch, repo: t.repo });
    assert.equal(await s.classify(level(["y".repeat(20_001)])), null);
    assert.equal(p.hivasok.length, 0);
    assert.equal(t.sorok[0]!.status, "ERROR");
    assert.equal(t.sorok[0]!.data.errorCode, "blocked_too_long");
    assert.equal(t.sorok[0]!.data.projectionPayload, undefined);
  });

  it("a szolgaltato hibaja csendes kimaradas; az eltunt modell leallitja", async () => {
    const t = tarolo();
    const halozat = szolgaltatas({
      fetch: szolgaltato(new Error("ECONNRESET")).fetch,
      repo: t.repo,
    });
    assert.equal(await halozat.s.classify(level()), null);
    assert.equal(t.sorok[0]!.data.errorCode, "NETWORK_ERROR");

    const p = szolgaltato({ status: 400, body: "Unknown model: jev-1.13.0" });
    const { s } = szolgaltatas({ fetch: p.fetch });
    assert.equal(await s.classify(level()), null);
    assert.equal(s.enabled(), false);
    assert.equal(await s.classify(level(["masik"])), null);
    assert.equal(p.hivasok.length, 1);
  });

  it("soha nem dob: az adatbazis hibaja is `null`", async () => {
    const p = szolgaltato(valasz("BEJOVO_SZAMLA", 0.93));
    const { s } = szolgaltatas({
      fetch: p.fetch,
      repo: tarolo({ dob: true }).repo,
    });
    assert.equal(await s.classify(level()), null);
    assert.equal(p.hivasok.length, 0);
  });
});
