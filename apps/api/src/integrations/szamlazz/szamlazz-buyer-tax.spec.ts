import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildSzamlazzAgentInvoiceXml } from "./szamlazz-agent-xml.js";
import {
  buyerNeedsTaxNumber,
  buyerTaxNumberProblem,
  looksLikeOrganization,
  ORGANIZATION_NAME_MARKERS,
  SzamlazzBuyerTaxNumberError,
} from "./szamlazz-buyer-tax.js";

/**
 * A VEVŐ ADÓSZÁMA (kártya aaf4f09d; acrobot 42296, 42297, 42299). MI PIROSÍT:
 * ha a partner-tükör, az ismeretlen vagy céges típusú vevő adószám nélkül átmegy;
 * ha a cégformájú nevű „magánszemély" átmegy; ha a kifejezetten magánszemély
 * elakad; ha az XML-építő adószám nélkül épít; ha egy Számlázz.hu-hívó nem az
 * építőn megy át; ha az SQL-ellenőrzés más cégforma-listát vagy más szabályt
 * használ, mint a kapu.
 */
const vevo = (over: Record<string, unknown> = {}) => ({
  name: "Fővárosi Állat- és Növénykert",
  type: "COMPANY",
  partnerMirror: false,
  taxNumber: null,
  euTaxNumber: null,
  ...over,
});

describe("mikor kell adószám", () => {
  it("adószám nélkül csak a kifejezetten magánszemély, nem partner, cégforma nélküli vevő mehet", () => {
    for (const [nev, b, kell] of [
      ["cég", vevo(), true],
      ["ismeretlen típus", vevo({ type: null }), true],
      ["üres típus", vevo({ type: "" }), true],
      [
        "partner-tükör magánszemély típussal (az állatkert esete)",
        vevo({ type: "PERSON", partnerMirror: true }),
        true,
      ],
      [
        "magánszemély cégformájú névvel",
        vevo({ type: "PERSON", name: "Kovács és Társa Bt." }),
        true,
      ],
      ["magánszemély", vevo({ type: "PERSON", name: "Kovács Anna" }), false],
    ] as const) {
      assert.equal(buyerNeedsTaxNumber(b as never), kell, nev);
      assert.equal(buyerTaxNumberProblem(b as never) !== null, kell, nev);
    }
  });

  it("a magyar vagy a közösségi adószám elég, a szóköz nem adószám", () => {
    assert.equal(
      buyerTaxNumberProblem(vevo({ taxNumber: "15490658-2-42" }) as never),
      null,
    );
    assert.equal(
      buyerTaxNumberProblem(vevo({ euTaxNumber: "DE123456789" }) as never),
      null,
    );
    assert.notEqual(
      buyerTaxNumberProblem(vevo({ taxNumber: "  " }) as never),
      null,
    );
  });

  it("a cégforma egész szóként, kis- és nagybetű nélkül", () => {
    for (const nev of [
      "Valami Kft.",
      "VALAMI ZRT",
      "Alma Bt",
      "X Nonprofit Kft.",
      "Kis Péter e.v.",
      "Reef GmbH",
      "Coral Ltd.",
      "Akva s.r.o.",
      "Budapesti Önkormányzat",
      "Zöld Alapítvány",
    ])
      assert.equal(looksLikeOrganization(nev), true, nev);
    for (const nev of [
      "Kovács Anna",
      "Kftárnyék Péter",
      "Bartók Béla",
      "Rita Éva",
    ])
      assert.equal(looksLikeOrganization(nev), false, nev);
  });
});

describe("a végső kapu az XML-építőben", () => {
  const input = (buyer: Record<string, unknown>) =>
    ({
      agentKey: "k",
      issueDate: "2026-11-04",
      fulfillmentDate: "2026-11-04",
      paymentDueDate: "2026-11-12",
      paymentMethod: "Átutalás",
      currency: "HUF",
      seller: {},
      buyer: {
        name: "Fővárosi Állat- és Növénykert",
        zip: "1146",
        city: "Budapest",
        address: "Állatkerti krt. 6-12.",
        ...buyer,
      },
      items: [
        {
          name: "Karbantartás",
          quantity: 1,
          unit: "db",
          netUnitPrice: 1000,
          vatRatePercent: "27",
          netAmount: 1000,
          vatAmount: 270,
          grossAmount: 1270,
        },
      ],
    }) as never;

  it("a partner-tükörnek adószám nélkül nem épít XML-t", () => {
    assert.throws(
      () =>
        buildSzamlazzAgentInvoiceXml(
          input({ taxSubject: { type: "PERSON", partnerMirror: true } }),
        ),
      (error: unknown) =>
        error instanceof SzamlazzBuyerTaxNumberError &&
        error.message.startsWith("A vevőnek nincs adószáma:"),
    );
  });

  it("adószámmal, és a kifejezetten magánszemélynek épít", () => {
    assert.match(
      buildSzamlazzAgentInvoiceXml(
        input({
          taxNumber: "15490658-2-42",
          taxSubject: { type: null, partnerMirror: true },
        }),
      ),
      /<adoszam>15490658-2-42<\/adoszam>/,
    );
    assert.doesNotThrow(() =>
      buildSzamlazzAgentInvoiceXml(
        input({
          name: "Kovács Anna",
          taxSubject: { type: "PERSON", partnerMirror: false },
        }),
      ),
    );
  });
});

/** a compiled spec runs from `test-dist/integrations/szamlazz/`: the sources are `apps/api/src` */
const SRC = new URL("../../../src/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, SRC), "utf8");

describe("minden számla a kapun megy át", () => {
  /*
    A MÉRT KIÁLLÍTÁSI UTAK (2026-11-04): a `generateInvoice` három fájlban hívódik, és
    mindhárom a `buildSzamlazzAgentInvoiceXml`-lel építi az XML-t. Ha egy új fájl hívja
    a `generateInvoice`-t, ez a lista elavul, és a teszt megáll, amíg valaki meg nem
    nézi, a kapun megy-e át.
  */
  const GENERATORS = [
    "billing/billing-document-issue.service.ts",
    "billing/billing-document-preview.service.ts",
    "maintenance-invoice/maintenance-invoice-draft.service.ts",
  ];

  it("a generateInvoice-hívók ismertek, és mind az XML-építőn megy át", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = SRC.pathname;
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (
          name.endsWith(".ts") &&
          !name.endsWith(".spec.ts") &&
          !full.includes("/integrations/szamlazz/")
        ) {
          if (/\.generateInvoice\(/.test(readFileSync(full, "utf8")))
            found.push(full.slice(root.length));
        }
      }
    };
    walk(root);
    assert.deepEqual(found.sort(), [...GENERATORS].sort());
    for (const file of GENERATORS)
      // the preview takes the builder as an injectable default; the default is the gate
      assert.match(
        read(file),
        /buildSzamlazzAgentInvoiceXml\(|= buildSzamlazzAgentInvoiceXml,/,
        file,
      );
  });

  it("az SQL-ellenőrzés ugyanazt a szabályt és cégforma-listát használja", () => {
    const sql = readFileSync(
      new URL(
        "../../../packages/database/prisma/diagnostics/ceges-szamla-adoszam-nelkul.sql",
        SRC,
      ),
      "utf8",
    );
    const lista = /~\* '\(\^\|\[\^\[:alnum:\]\]\)\(([^)]*)\)/.exec(sql)?.[1];
    assert.ok(lista, "a cégforma-minta nem olvasható az SQL-ből");
    assert.deepEqual(lista!.split("|"), [...ORGANIZATION_NAME_MARKERS]);
    assert.match(sql, /c\."type" IS DISTINCT FROM 'PERSON'/);
    assert.match(sql, /s\."id" IS NOT NULL\s*\n\s*OR/);
    assert.match(sql, /i\."status" = 'ISSUED'/);
  });
});
