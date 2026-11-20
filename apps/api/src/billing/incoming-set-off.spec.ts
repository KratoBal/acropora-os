import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  FOXPOST_TAX_BASE,
  GLS_TAX_BASE,
} from "../missing-invoices/missing-invoices.repository.js";

import {
  FOXPOST_SUPPLIER_BASE,
  GLS_SUPPLIER_BASE,
  incomingSetOffPayments,
  setOffKey,
  type FoxpostSetOffInput,
  type GlsSetOffInput,
  type SetOffInvoice,
} from "./incoming-set-off.js";

/*
  A FUTÁR LEVONTA A DÍJSZÁMLÁJÁT AZ UTÁNVÉT-UTALÁSBÓL (acrobot 58315, 58343; Balázs 2026-10-01, emlék 1994). MI PIROSÍT: ha a rendben lévő
  Foxpost- vagy GLS-elszámolás díjszámlája nem lesz kifizetett (a 18 éles számla ilyen); ha a feltételek BÁRMELYIKÉNEK sérülésénél mégis kifizetett lesz:
  Foxpost: beolvasatlan vagy hibás elszámolás, megnevezett számla nélkül, a sorok összege nem a beszedett, a beszedett mínusz díj nem az átutalt, nincs
  vagy kettő a jóváírás, más összegű a jóváírás, ismeretlen számla, a bruttó eltér, deviza; GLS: a hivatkozás nem GLS-számlaszám (egy csomag lehet), a
  maradvány nem nulla (részleges beszámítás), a beszedett mínusz beszámított nem az átutalt, nincs aznapi részletező vagy más az összege, nincs vagy
  kettő a jóváírás, egy hivatkozott számla ismeretlen, a bruttók összege nem a beszámított; ha a nap nem a jóváírás (Foxpost), illetve a beszámítás
  napja (GLS); ha egy elszámolás egy másik számlát jelöl.
*/
const D = (v: string | number) => new Prisma.Decimal(v);
/** A szállító alapértelmezése a szám alakjából: HU + 8 számjegy a GLS, minden más a Foxpost; a negyedik elem felülírja. */
const invoices = (
  entries: [string, string | number, string?, (string | null)?][],
) =>
  new Map<string, SetOffInvoice>(
    entries.map(([number, gross, currency, supplier]) => [
      setOffKey(
        supplier === undefined
          ? /^HU\d{8}$/.test(number)
            ? GLS_SUPPLIER_BASE
            : FOXPOST_SUPPLIER_BASE
          : supplier,
        number,
      ),
      { gross: D(gross), currency: currency ?? "HUF" },
    ]),
  );
const keyOf = (number: string) =>
  setOffKey(
    /^HU\d{8}$/.test(number) ? GLS_SUPPLIER_BASE : FOXPOST_SUPPLIER_BASE,
    number,
  );

const foxpost = (
  over: Partial<FoxpostSetOffInput> = {},
): FoxpostSetOffInput => ({
  settlementCode: "26H35",
  status: "COMPLETED",
  invoiceNumber: "FX01034668",
  invoiceGrossAmount: D(7803),
  collectedAmount: D(102141),
  transferredAmount: D(94338),
  currency: "HUF",
  lineSum: D(102141),
  credits: [{ amount: D(94338), bookingDate: "2026-09-03" }],
  ...over,
});

describe("a Foxpost fee invoice set off in the weekly transfer", () => {
  const run = (
    over: Partial<FoxpostSetOffInput> = {},
    gross: string | number = 7803,
    currency = "HUF",
  ) =>
    incomingSetOffPayments({
      foxpost: [foxpost(over)],
      gls: [],
      invoices: invoices([["FX01034668", gross, currency]]),
    });

  it("is paid on the day of the bank credit, from the settlement (the measured 26H35 shape)", () => {
    assert.deepEqual(
      [...run()],
      [
        [
          keyOf("FX01034668"),
          { day: "2026-09-03", carrier: "FOXPOST", reference: "26H35" },
        ],
      ],
    );
  });

  it("a settlement still in review (NEEDS_REVIEW) counts: the review is about our orders, not the money", () => {
    assert.equal(run({ status: "NEEDS_REVIEW" }).size, 1);
  });

  it("is not paid when the settlement is unread or failed, or names no invoice or code", () => {
    for (const over of [
      { status: "PROCESSING" },
      { status: "ERROR" },
      { invoiceNumber: null },
      { settlementCode: null },
      { invoiceGrossAmount: null },
      { collectedAmount: null },
      { transferredAmount: null },
    ] as Partial<FoxpostSetOffInput>[])
      assert.equal(run(over).size, 0, JSON.stringify(over));
  });

  it("is not paid when the settlement's own sums do not agree", () => {
    // the lines do not add up to the collected sum
    assert.equal(run({ lineSum: D(100000) }).size, 0);
    // collected minus the fee is not the transferred sum
    assert.equal(
      run({
        transferredAmount: D(94000),
        credits: [{ amount: D(94000), bookingDate: "2026-09-03" }],
      }).size,
      0,
    );
  });

  it("is not paid without exactly ONE credit of exactly the transferred sum", () => {
    assert.equal(run({ credits: [] }).size, 0);
    assert.equal(
      run({
        credits: [
          { amount: D(94338), bookingDate: "2026-09-03" },
          { amount: D(94338), bookingDate: "2026-09-04" },
        ],
      }).size,
      0,
    );
    assert.equal(
      run({ credits: [{ amount: D(94337), bookingDate: "2026-09-03" }] }).size,
      0,
    );
    // a credit of another amount beside the right one does not make it ambiguous
    assert.equal(
      run({
        credits: [
          { amount: D(94338), bookingDate: "2026-09-03" },
          { amount: D(1), bookingDate: "2026-09-03" },
        ],
      }).size,
      1,
    );
  });

  it("is not paid when the incoming invoice is unknown, in another currency, or its gross is not the settlement's fee invoice", () => {
    assert.equal(
      incomingSetOffPayments({
        foxpost: [foxpost()],
        gls: [],
        invoices: new Map(),
      }).size,
      0,
    );
    assert.equal(run({}, 7803, "EUR").size, 0);
    assert.equal(run({}, 7805).size, 0);
    // within one forint of rounding still counts
    assert.equal(run({}, 7804).size, 1);
    assert.equal(run({ currency: "EUR" }).size, 0);
  });
});

const gls = (over: Partial<GlsSetOffInput> = {}): GlsSetOffInput => ({
  day: "2026-09-03",
  currency: "HUF",
  cod: D(117450),
  compensated: D(8013),
  transferred: D(109437),
  remaining: D(0),
  references: ["HU00912382"],
  reportTotal: D(117450),
  credits: [{ amount: D(109437) }],
  ...over,
});

describe("a GLS fee invoice set off by the compensation letter", () => {
  const run = (
    over: Partial<GlsSetOffInput> = {},
    list: [string, string | number, string?][] = [["HU00912382", 8013]],
  ) =>
    incomingSetOffPayments({
      foxpost: [],
      gls: [gls(over)],
      invoices: invoices(list),
    });

  it("is paid on the day of the set-off and the transfer (the measured 09-03 shape: 8 013 Ft against HU00912382)", () => {
    assert.deepEqual(
      [...run()],
      [
        [
          keyOf("HU00912382"),
          { day: "2026-09-03", carrier: "GLS", reference: "2026-09-03" },
        ],
      ],
    );
  });

  it("several invoices in one letter are all paid when their grosses add up to the set-off", () => {
    const out = run(
      {
        references: ["HU00912382", "HU00912383"],
        compensated: D(20000),
        transferred: D(97450),
        credits: [{ amount: D(97450) }],
      },
      [
        ["HU00912382", 8013],
        ["HU00912383", 11987],
      ],
    );
    assert.deepEqual(
      [...out.keys()].sort(),
      [keyOf("HU00912382"), keyOf("HU00912383")].sort(),
    );
  });

  it("is not paid when a reference is not a GLS invoice number (a parcel number may be the buyer's money)", () => {
    assert.equal(
      run({ references: ["HU00912382", "99999999999"] }, [["HU00912382", 8013]])
        .size,
      0,
    );
    assert.equal(run({ references: [] }).size, 0);
    assert.equal(
      run({ references: ["HU0091238"] }, [["HU0091238", 8013]]).size,
      0,
    );
  });

  it("is not paid when the set-off was partial (a remainder is left) or the letter's own sums disagree", () => {
    assert.equal(run({ remaining: D(500) }).size, 0);
    assert.equal(
      run({ transferred: D(100000), credits: [{ amount: D(100000) }] }).size,
      0,
    );
  });

  it("is not paid without the day's COD report of the same sum, or without exactly one credit of the transferred sum", () => {
    assert.equal(run({ reportTotal: null }).size, 0);
    assert.equal(run({ reportTotal: D(117451) }).size, 0);
    assert.equal(run({ credits: [] }).size, 0);
    assert.equal(
      run({ credits: [{ amount: D(109437) }, { amount: D(109437) }] }).size,
      0,
    );
    assert.equal(run({ credits: [{ amount: D(109436) }] }).size, 0);
  });

  it("is not paid when a referenced invoice is unknown or the grosses do not add up to the set-off (no part is marked)", () => {
    assert.equal(
      run(
        {
          references: ["HU00912382", "HU00912383"],
          compensated: D(20000),
          transferred: D(97450),
          credits: [{ amount: D(97450) }],
        },
        [["HU00912382", 8013]],
      ).size,
      0,
    );
    assert.equal(run({}, [["HU00912382", 8100]]).size, 0);
    assert.equal(run({}, [["HU00912382", 8013, "EUR"]]).size, 0);
    assert.equal(run({ currency: "EUR" }).size, 0);
  });

  it("a Foxpost and a GLS settlement side by side do not disturb each other", () => {
    const out = incomingSetOffPayments({
      foxpost: [foxpost()],
      gls: [gls()],
      invoices: invoices([
        ["FX01034668", 7803],
        ["HU00912382", 8013],
      ]),
    });
    assert.deepEqual(
      [...out.keys()].sort(),
      [keyOf("FX01034668"), keyOf("HU00912382")].sort(),
    );
  });
});

/*
  A SZÁMLA A SZÁLLÍTÓJÁVAL KÖTŐDIK (barracuda, #2788 review). MI PIROSÍT: ha egy MÁSIK szállító azonos számú és összegű számlája is kifizetett lenne (a Lejáró
  számlák listából egy valóban fizetendő számla esne ki); ha az a sor felülírná a futár sorát a térképben; ha a szállító nélküli vagy külföldi adószámú sor a
  futáréval egyezne; ha a két törzsszám elcsúszna a Hiányzó számlák elszámolás-levonásáétól.
*/
describe("the set-off binds an invoice to its supplier, not to its number alone", () => {
  const OTHER = "99999999";
  const both = (number: string, other: string | null) =>
    [
      [number, number.startsWith("HU") ? 8013 : 7803],
      [number, number.startsWith("HU") ? 8013 : 7803, "HUF", other],
    ] as [string, number, string?, (string | null)?][];

  it("another supplier's invoice with the same Foxpost number and gross is not marked, and does not displace the carrier's", () => {
    const out = incomingSetOffPayments({
      foxpost: [foxpost()],
      gls: [],
      invoices: invoices(both("FX01034668", OTHER)),
    });
    assert.deepEqual([...out.keys()], [keyOf("FX01034668")]);
    assert.equal(out.has(setOffKey(OTHER, "FX01034668")), false);
  });

  it("the same for a GLS number: only the GLS supplier's row is marked", () => {
    const out = incomingSetOffPayments({
      foxpost: [],
      gls: [gls()],
      invoices: invoices(both("HU00912382", OTHER)),
    });
    assert.deepEqual([...out.keys()], [keyOf("HU00912382")]);
    assert.equal(out.has(setOffKey(OTHER, "HU00912382")), false);
  });

  it("a row of another supplier with the carrier's number is not the carrier's invoice even when it is the only row", () => {
    for (const supplier of [OTHER, null, "DE123456789"]) {
      const foxpostOut = incomingSetOffPayments({
        foxpost: [foxpost()],
        gls: [],
        invoices: invoices([["FX01034668", 7803, "HUF", supplier]]),
      });
      const glsOut = incomingSetOffPayments({
        foxpost: [],
        gls: [gls()],
        invoices: invoices([["HU00912382", 8013, "HUF", supplier]]),
      });
      assert.equal(foxpostOut.size, 0, String(supplier));
      assert.equal(glsOut.size, 0, String(supplier));
    }
  });

  it("the carrier's supplier is recognised in every written form of the tax number", () => {
    for (const written of ["32435119", "32435119-2-13", "HU32435119"]) {
      assert.equal(
        setOffKey(written, "FX1"),
        setOffKey(FOXPOST_SUPPLIER_BASE, "FX1"),
        written,
      );
    }
  });

  it("the two tax bases are the ones the missing-invoices set-off deduction uses", () => {
    assert.equal(FOXPOST_SUPPLIER_BASE, FOXPOST_TAX_BASE);
    assert.equal(GLS_SUPPLIER_BASE, GLS_TAX_BASE);
  });
});
