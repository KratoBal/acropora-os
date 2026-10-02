import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  inWindow,
  matchMonth,
  namedMonth,
  normalizeName,
  samePartner,
  type CandidateDocument,
  type MatchableCredit,
  type MatchableDebit,
} from "./missing-invoice-matching.js";
import { sequenceRatio } from "./sequence-ratio.js";

const D = (v: string | number) => new Prisma.Decimal(v);

let n = 0;
const debit = (overrides: Partial<MatchableDebit>): MatchableDebit => ({
  id: `d${++n}`,
  bookingDate: "2026-08-10",
  amount: D(1000),
  currency: "HUF",
  original: null,
  counterpartyName: "Szállító Kft.",
  counterpartyAccount: null,
  narrative: "",
  category: "DOMESTIC_SUPPLIER",
  ...overrides,
});

const doc = (overrides: Partial<CandidateDocument>): CandidateDocument => ({
  id: `c${++n}`,
  source: "NAV",
  number: `SZ-2026-${n}`,
  date: "2026-08-05",
  gross: D(1000),
  currency: "HUF",
  supplierName: "Szállító Kft.",
  supplierAccounts: [],
  kind: "INVOICE",
  payee: "COMPANY",
  hasOriginal: true,
  ...overrides,
});

const run = (
  debits: MatchableDebit[],
  documents: CandidateDocument[],
  manual = new Map<string, string[]>(),
) => matchMonth({ debits, documents, manual });

/*
  BIZTOSÍTÁS (barracuda esetlistája, 2. csoport). MI PIROSÍT: ha egy biztosítási
  díj a partner MÁS számlái miatt „nem párosodott”-nak látszana (az OTP banki
  díjszámlái), vagy ha a biztosító saját, pontos összegű számláját nem találná meg.
*/
describe("insurance: the insurer's invoice first, otherwise a premium notice is missing", () => {
  it("an exact invoice of the insurer pairs; otherwise no invoice, saying a premium notice is missing", () => {
    const premium = () =>
      debit({
        bookingDate: "2026-09-15",
        amount: D(172440),
        counterpartyName: "Allianz Hungária Zrt.",
        narrative: "AMC287127862",
        category: "INSURANCE",
      });
    const other = doc({
      number: "26-10000009740",
      date: "2026-09-01",
      gross: D(49500),
      supplierName: "Allianz Hungária Zrt.",
    });
    const p = premium();
    const missing = run([p], [other]).get(p.id)!;
    assert.deepEqual(
      [missing.state, missing.reason],
      [
        "NO_INVOICE",
        "biztosítás: a díjértesítő (vagy a biztosító számlája) hiányzik",
      ],
    );
    // a partner másik számlája jelöltként látszik, kézzel párosítható
    assert.deepEqual(
      missing.candidates.map((c) => c.number),
      ["26-10000009740"],
    );
    const q = premium();
    const invoice = doc({
      number: "26-10000012345",
      date: "2026-09-10",
      gross: D(172440),
      supplierName: "Allianz Hungária Zrt.",
    });
    assert.equal(run([q], [invoice]).get(q.id)!.state, "FOUND");
    // A KONTROLL: egy nem biztosítási terhelés ugyanígy „nem párosodott” marad
    const r = debit({
      ...premium(),
      id: "nem-bizt",
      category: "DOMESTIC_SUPPLIER",
    });
    assert.equal(run([r], [other]).get(r.id)!.state, "NOT_MATCHED");
  });
});

/*
  BARRACUDA ESETLISTÁJA (agents/barracuda/megosztas/javitasi-esetlista-2026-10-01.md,
  acrobot 25928). MI PIROSÍT: ha egy ékezetre végződő általános szó (felelősségű,
  hungária) a névben maradna; ha a kiírt jogi formájú NAV-név nem lenne a bank
  partnerneve; ha egyetlen közös szó (vezetéknév) is elég lenne; ha az azonos
  összegű havidíjak közül nem a közleményben megnevezett hónapé nyerne, vagy a
  hónap végén előre kiállított számla rossz hónaphoz kerülne; ha a kártyás
  szabály egy feltétel hiányával is párosítana.
*/
describe("the case list: a spelled-out legal form, a named month, a card descriptor", () => {
  it("generic words ending in an accented letter leave the name too", () => {
    assert.equal(
      normalizeName(
        "B-O 2001. BEFEKTETÉSI ÉS KERESKEDELMI KORLÁTOLT FELELŐSSÉGŰ TÁRSASÁG",
      ),
      "b o 2001 befektetési és",
    );
    assert.equal(normalizeName("Allianz Hungária Zrt."), "allianz");
    assert.equal(
      normalizeName("NUMBER ONE CAR KORLÁTOLT FELELŐSSÉGŰ TÁRSASÁG"),
      "number one car",
    );
  });

  it("the bank's name is the start of the spelled-out one, by whole words, from two words on", () => {
    assert.equal(
      samePartner(
        "B-O 2001. BEFEKTETÉSI ÉS KERESKEDELMI KORLÁTOLT FELELŐSSÉGŰ TÁRSASÁG",
        "B-O 2001 Kft.",
      ),
      true,
    );
    // egy szó nem elég: egy vezetéknév sok név elején áll
    assert.equal(
      samePartner("Szabó Géza Bt. Szerelő Üzem", "Szabó Kft."),
      false,
    );
    // csak egész szavakban: a "b o 20" nem eleje a "b o 2001 ..."-nek
    assert.equal(
      samePartner(
        "B-O 2001. BEFEKTETÉSI ÉS KERESKEDELMI KORLÁTOLT FELELŐSSÉGŰ TÁRSASÁG",
        "B-O 20 Kft.",
      ),
      false,
    );
  });

  it("the month a narrative names, with or without the year", () => {
    assert.deepEqual(
      [
        namedMonth("2026 aug", "2026-09-11"),
        namedMonth("2026 febr.", "2026-03-10"),
        namedMonth("március", "2026-04-13"),
        namedMonth("2025 dec", "2026-01-12"),
        namedMonth("dec", "2026-01-12"),
        // a kártyás közlemény eleje egy dátum, nem hónap-név
        namedMonth(
          "2026.09.10 7413124583 OBI 042 KISTA RCSA -APPLE",
          "2026-09-14",
        ),
        namedMonth("Augusztusi bérleti díj", "2026-09-02"),
      ],
      ["2026-08", "2026-02", "2026-03", "2025-12", "2025-12", null, "2026-08"],
    );
  });

  it("B-O 2001: of the same monthly fee the named month's invoice, a NAV row, so its original is missing", () => {
    const bo =
      "B-O 2001. BEFEKTETÉSI ÉS KERESKEDELMI KORLÁTOLT FELELŐSSÉGŰ TÁRSASÁG";
    const august = doc({
      number: "BO-2026-68",
      date: "2026-08-01",
      gross: D(78000),
      supplierName: bo,
      hasOriginal: false,
    });
    const september = doc({
      number: "BO-2026-83",
      date: "2026-09-01",
      gross: D(78000),
      supplierName: bo,
    });
    const payment = debit({
      bookingDate: "2026-09-11",
      amount: D(78000),
      counterpartyName: "B-O 2001 Kft.",
      narrative: "2026 aug",
    });
    const outcome = run([payment], [august, september]).get(payment.id)!;
    assert.deepEqual(
      [outcome.state, outcome.documents.map((d) => d.number)],
      ["ORIGINAL_MISSING", ["BO-2026-68"]],
    );
  });

  it("a monthly invoice issued on the last days of the month before is the next month's", () => {
    const bo =
      "B-O 2001. BEFEKTETÉSI ÉS KERESKEDELMI KORLÁTOLT FELELŐSSÉGŰ TÁRSASÁG";
    const may = doc({
      number: "BO-2026-31",
      date: "2026-05-01",
      gross: D(78000),
      supplierName: bo,
    });
    const june = doc({
      number: "BO-2026-41",
      date: "2026-05-31",
      gross: D(78000),
      supplierName: bo,
    });
    const paidMay = debit({
      bookingDate: "2026-06-15",
      amount: D(78000),
      counterpartyName: "B-O 2001 Kft.",
      narrative: "2026 május",
    });
    const paidJune = debit({
      bookingDate: "2026-07-13",
      amount: D(78000),
      counterpartyName: "B-O 2001 Kft.",
      narrative: "2026 június",
    });
    const outcomes = run([paidMay, paidJune], [may, june]);
    assert.deepEqual(
      [paidMay, paidJune].map((d) => outcomes.get(d.id)!.documents[0]?.number),
      ["BO-2026-31", "BO-2026-41"],
    );
  });

  it("OBI: a card descriptor pairs by the brand, the exact amount and the purchase day, all three", () => {
    const obi = (overrides: Partial<CandidateDocument> = {}) =>
      doc({
        number: "A06600684/0138/00002",
        source: "SZAMLAZZ",
        date: "2026-09-10",
        gross: D(13646),
        supplierName: "OBI HUNGARY RETAIL KFT.",
        ...overrides,
      });
    const purchase = () =>
      debit({
        bookingDate: "2026-09-14",
        amount: D(13646),
        counterpartyName: "OBI 042 KISTARCSA",
        narrative: "2026.09.10 7413124583 OBI 042 KISTA RCSA        -APPLE",
      });
    const state = (documents: CandidateDocument[]) => {
      const p = purchase();
      const outcome = run([p], documents).get(p.id)!;
      return `${outcome.state}:${outcome.documents.map((d) => d.number).join(",")}`;
    };
    assert.equal(state([obi()]), "FOUND:A06600684/0138/00002");
    // egy feltétel hiányzik: nincs párosítás
    assert.equal(state([obi({ date: "2026-09-11" })]), "NO_INVOICE:");
    assert.equal(state([obi({ gross: D(13600) })]), "NO_INVOICE:");
    assert.equal(
      state([obi({ supplierName: "OTP HUNGARY RETAIL KFT." })]),
      "NO_INVOICE:",
    );
    // összeg nélküli NAV-sor sosem pár
    assert.equal(state([obi({ gross: null })]), "NO_INVOICE:");
    // két egyforma: nem választ
    assert.equal(
      state([obi(), obi({ number: "A06600684/0138/00003" })]),
      "NO_INVOICE:",
    );
  });
});

/*
  SZTORNÓZOTT VÁSÁRLÁS (barracuda esetlistája, Tesla; acrobot 25933), a mért
  eset: 85 000 Ft kártyával 09-17-én, a Tesla 09-25-én 85 000-es jóváírót adott,
  az eredeti számla NAV-sora 0 bruttót hordoz. MI PIROSÍT: ha a jóváíró nélkül,
  más összegűvel, a 15 napos ablakon kívülivel, más eladóéval vagy kettő közül
  is sztornónak látszana; ha a határidő a mai naphoz és nem a kivonatokhoz
  mérne; ha a visszatérítés más összegű, más kereskedőjű vagy a vásárlás előtti
  jóváírással is lezárulna; ha egy jóváírás két terhelést zárna le; ha a pontos
  számla elől elvenné a terhelést.
*/
describe("a cancelled purchase: no invoice needed, the refund is expected", () => {
  const tesla = (overrides: Partial<MatchableDebit> = {}) =>
    debit({
      bookingDate: "2026-09-21",
      amount: D(85000),
      counterpartyName: "Tesla Inc",
      narrative: "2026.09.17 7413124583 Tesla Inc -APPLE",
      category: "CARD_SUBSCRIPTION",
      ...overrides,
    });
  const original = () =>
    doc({
      number: "4042A0000031808",
      date: "2026-09-17",
      gross: D(0),
      supplierName: "Tesla Hungary Kft.",
      hasOriginal: false,
    });
  const creditNote = (overrides: Partial<CandidateDocument> = {}) =>
    doc({
      source: "SZAMLAZZ",
      number: "CR4042A0000012507",
      date: "2026-09-25",
      gross: D(-85000),
      supplierName: "Tesla Hungary Kft.",
      ...overrides,
    });
  let k = 0;
  const refund = (
    overrides: Partial<MatchableCredit> = {},
  ): MatchableCredit => ({
    id: `cr${++k}`,
    bookingDate: "2026-10-03",
    amount: D(85000),
    currency: "HUF",
    counterpartyName: null,
    narrative: "2026.10.02 7413124583 Tesla Inc -APPLE",
    ...overrides,
  });
  const decide = (
    debits: MatchableDebit[],
    documents: CandidateDocument[],
    extra: { credits?: MatchableCredit[]; asOf?: string } = {},
  ) => matchMonth({ debits, documents, manual: new Map(), ...extra });

  it("the Tesla case: expected until 30 days after the credit note, measured to the statements", () => {
    const d = tesla();
    const note = creditNote();
    const at = (asOf?: string) =>
      decide([d], [original(), note], asOf ? { asOf } : {}).get(d.id)!;
    const expected = at("2026-09-30");
    assert.equal(expected.state, "REFUND_EXPECTED");
    // az eredeti számla is, a jóváíró előtt (acrobot 25981)
    assert.deepEqual(
      expected.documents.map((x) => x.number),
      ["4042A0000031808", "CR4042A0000012507"],
    );
    assert.deepEqual(
      { ...expected.refund, amount: expected.refund?.amount.toFixed(0) },
      {
        amount: "85000",
        currency: "HUF",
        creditNoteNumber: "CR4042A0000012507",
        due: "2026-10-25",
        receivedOn: null,
      },
    );
    assert.deepEqual(
      [at("2026-10-25"), at("2026-10-26"), at()].map((o) => o.state),
      ["REFUND_EXPECTED", "REFUND_MISSING", "REFUND_EXPECTED"],
    );
  });

  it("the card refund closes it, also after the due date: no invoice needed", () => {
    const d = tesla();
    const out = decide([d], [original(), creditNote()], {
      credits: [refund()],
      asOf: "2026-11-30",
    }).get(d.id)!;
    assert.equal(out.state, "NO_INVOICE_NEEDED");
    assert.equal(out.refund?.receivedOn, "2026-10-03");
    // átutalásként, a partner nevével is
    const e = tesla();
    const transfer = decide([e], [creditNote()], {
      credits: [
        refund({
          counterpartyName: "Tesla Hungary Kft.",
          narrative: "Visszautalás CR4042A0000012507",
        }),
      ],
    }).get(e.id)!;
    assert.equal(transfer.refund?.receivedOn, "2026-10-03");
  });

  it("a refund of another amount, another merchant, or before the purchase does not close it", () => {
    const d = tesla();
    const states = [
      refund({ amount: D(84000) }),
      refund({ currency: "EUR" }),
      refund({ narrative: "2026.10.02 7413124583 Alza.hu Kft. -APPLE" }),
      refund({ bookingDate: "2026-09-16" }),
    ].map(
      (credit) =>
        decide([d], [creditNote()], { credits: [credit] }).get(d.id)!.refund
          ?.receivedOn,
    );
    assert.deepEqual(states, [null, null, null, null]);
  });

  it("one refund closes one purchase", () => {
    const first = tesla({ id: "tesla-1" });
    // két külön sztornózott vásárlás, mindegyiknek a saját jóváírója
    const second = tesla({
      id: "tesla-2",
      bookingDate: "2026-09-03",
      narrative: "2026.09.01 7413124583 Tesla Inc -APPLE",
    });
    const out = decide(
      [first, second],
      [
        creditNote({ id: "cn-1" }),
        creditNote({
          id: "cn-2",
          number: "CR4042A0000012508",
          date: "2026-09-05",
        }),
      ],
      { credits: [refund()] },
    );
    assert.deepEqual(
      [first, second].map((d) => out.get(d.id)!.state),
      ["REFUND_EXPECTED", "NO_INVOICE_NEEDED"],
    );
  });

  it("without a credit note of the whole amount, from the seller, within 15 days, and only one: not a cancellation", () => {
    const cancelled = (documents: CandidateDocument[]) => {
      const d = tesla();
      return decide([d], [original(), ...documents])
        .get(d.id)!
        .state.startsWith("REFUND");
    };
    assert.deepEqual(
      [
        cancelled([]),
        cancelled([creditNote({ gross: D(-84000) })]),
        cancelled([creditNote({ gross: D(85000) })]),
        cancelled([creditNote({ date: "2026-10-03" })]),
        cancelled([creditNote({ date: "2026-09-16" })]),
        cancelled([creditNote({ supplierName: "Alza.hu Kft." })]),
        cancelled([creditNote(), creditNote({ number: "CR4042A0000012508" })]),
      ],
      [false, false, false, false, false, false, false],
    );
    // a 15. nap még benne van
    assert.equal(cancelled([creditNote({ date: "2026-10-02" })]), true);
    // egy márkatárs (az első szó egyezik, a név nem hasonló): a 3. szabály nem
    // viszi el, tehát itt az előjel dönt; a jóváírója sztornó, a számlája nem
    const sibling = "Tesla Energy Solutions Europe Kft.";
    assert.deepEqual(
      [
        cancelled([creditNote({ supplierName: sibling })]),
        cancelled([creditNote({ supplierName: sibling, gross: D(85000) })]),
      ],
      [true, false],
    );
  });

  it("a transfer: the booking day is the purchase day, and a short name pairs by similarity", () => {
    // az „OM” két betű: nincs márka-szó, csak a név hasonlósága köti össze
    const d = debit({
      bookingDate: "2026-09-10",
      amount: D(20000),
      counterpartyName: "OM Kft.",
      narrative: "Rendelés 4411",
    });
    const note = (date: string) =>
      creditNote({
        number: "OM-J-12",
        date,
        gross: D(-20000),
        supplierName: "OM Kereskedelmi Kft.",
      });
    assert.deepEqual(
      ["2026-09-15", "2026-09-26"].map((date) =>
        decide([d], [note(date)])
          .get(d.id)!
          .state.startsWith("REFUND"),
      ),
      [true, false],
    );
  });

  // AZ EREDETI A JÓVÁÍRÓ MELLÉ (acrobot 25981). MI PIROSÍT: ha két aznapi
  // jelöltből választana; ha más eladó, más nap vagy más összeg számláját
  // tenné az eredeti helyére.
  it("the original joins the credit note only when exactly one fits", () => {
    const numbers = (documents: CandidateDocument[]) => {
      const d = tesla();
      return decide([d], [creditNote(), ...documents])
        .get(d.id)!
        .documents.map((x) => x.number);
    };
    const another = (overrides: Partial<CandidateDocument>) =>
      doc({
        number: "4042A0000031809",
        date: "2026-09-17",
        gross: D(0),
        supplierName: "Tesla Hungary Kft.",
        hasOriginal: false,
        ...overrides,
      });
    assert.deepEqual(numbers([original(), another({})]), ["CR4042A0000012507"]);
    assert.deepEqual(
      [
        numbers([another({ supplierName: "Alza.hu Kft." })]),
        numbers([another({ date: "2026-09-18" })]),
        numbers([another({ gross: D(4400) })]),
      ],
      [["CR4042A0000012507"], ["CR4042A0000012507"], ["CR4042A0000012507"]],
    );
  });

  it("an exact invoice still wins over a credit note", () => {
    const d = tesla();
    const out = decide(
      [d],
      [
        creditNote(),
        doc({
          number: "4042A0000031809",
          date: "2026-09-17",
          gross: D(85000),
          supplierName: "Tesla Hungary Kft.",
        }),
      ],
    ).get(d.id)!;
    assert.equal(out.state, "FOUND");
  });
});

describe("sequenceRatio", () => {
  it("gives Python difflib's ratio (values measured against difflib)", () => {
    assert.deepEqual(
      [
        ["allianz hungaria", "sopro hungaria"],
        ["hetzner online", "unas online"],
        ["abxcd", "abcd"],
        ["coral sands", "coralsands"],
      ].map(([a, b]) => Math.round(sequenceRatio(a!, b!) * 1e6) / 1e6),
      [0.6, 0.64, 0.888889, 0.952381],
    );
  });
});

describe("samePartner", () => {
  it("refuses the measured false likenesses that share a generic word", () => {
    assert.equal(
      samePartner("Allianz Hungária Zrt.", "SOPRO HUNGÁRIA Kft."),
      false,
    );
    assert.equal(samePartner("Hetzner Online GmbH", "UNAS Online Kft."), false);
    assert.equal(
      samePartner("Fluidra Magyarország Kft.", "Yettel Magyarország Zrt."),
      false,
    );
    assert.equal(
      samePartner("Tesla Hungary Kft.", "Tesla Hungary Korlatol"),
      true,
    );
  });
});

describe("inWindow", () => {
  it("takes an invoice up to 4 months before the payment and until the 15th of the next month", () => {
    assert.deepEqual(
      ["2026-04-01", "2026-03-31", "2026-09-15", "2026-09-16"].map((d) =>
        inWindow("2026-08-10", d),
      ),
      [true, false, true, false],
    );
  });
});

describe("matchMonth", () => {
  it("pairs by the invoice number in the narrative first", () => {
    const d = debit({
      narrative: "Számla: KS26/05848",
      counterpartyName: "Bárki",
    });
    const c = doc({
      number: "KS26/05848",
      supplierName: "Fluidra Kft.",
      gross: D(9),
    });
    assert.equal(
      run([d], [c]).get(d.id)?.reason,
      "a számla száma a közleményben",
    );
  });

  it("pays a month of one card's payments with the partner's one invoice from the start of the next month", () => {
    const card = (date: string, amount: number, number = "7413124583") =>
      debit({
        bookingDate: date,
        amount: D(amount),
        counterpartyName: "SIMPLEP*PARKL.NET",
        narrative: `${date.replace(/-/g, ".")} ${number} SIMPLEP*PARKL .NET`,
        category: "CARD_SUBSCRIPTION",
      });
    const march = [
      card("2026-03-05", 400),
      card("2026-03-17", 350),
      card("2026-03-31", 450),
    ];
    const otherCard = card("2026-03-20", 999, "0194683438");
    const invoice = doc({
      number: "E-PAR-2026-13900",
      date: "2026-04-01",
      gross: D(1200),
      supplierName: "Parkl Digital Technologies Kft.",
    });
    const out = run([...march, otherCard], [invoice]);
    assert.deepEqual(
      march.map((d) => [
        out.get(d.id)?.documents[0]?.id,
        out.get(d.id)?.reason,
      ]),
      march.map(() => [
        invoice.id,
        "gyűjtőszámla: 3 kártyás fizetés havi összege",
      ]),
    );
    assert.equal(out.get(otherCard.id)?.state, "NOT_MATCHED");
  });

  it("does not take a monthly invoice that is late, off by an amount, or one of two equal ones", () => {
    const card = (date: string, amount: number) =>
      debit({
        bookingDate: date,
        amount: D(amount),
        counterpartyName: "SIMPLEP*PARKL.NET",
        narrative: `${date.replace(/-/g, ".")} 7413124583 SIMPLEP*PARKL .NET`,
        category: "CARD_SUBSCRIPTION",
      });
    const parkl = (date: string, gross: number) =>
      doc({
        date,
        gross: D(gross),
        supplierName: "Parkl Digital Technologies Kft.",
      });
    const reasons = (documents: CandidateDocument[]) => {
      const month = [card("2026-03-05", 400), card("2026-03-17", 800)];
      const out = run(month, documents);
      return month.map(
        (d) => out.get(d.id)?.reason.startsWith("gyűjtőszámla") ?? false,
      );
    };
    assert.deepEqual(reasons([parkl("2026-04-10", 1200)]), [false, false]); // késői, de az ablakon belül
    assert.deepEqual(reasons([parkl("2026-04-01", 1190)]), [false, false]); // a számla a kisebb
    // a többlet nagyobb a legnagyobb fizetésnél (900 > 800), vagy a számla 10 %-ánál (300 > 150)
    assert.deepEqual(reasons([parkl("2026-04-01", 2100)]), [false, false]);
    assert.deepEqual(reasons([parkl("2026-04-01", 1500)]), [false, false]);
    // csak a legnagyobb-fizetés korlát: 12 x 100 Ft, a többlet 120 (a 10 % alatt, a 100 fölött)
    const many = Array.from({ length: 12 }, (_, i) =>
      card(`2026-03-${String(i + 10)}`, 100),
    );
    const manyOut = run(many, [parkl("2026-04-01", 1320)]);
    assert.equal(manyOut.get(many[0]!.id)?.state, "NOT_MATCHED");
    assert.equal(
      run(many, [parkl("2026-04-01", 1290)]).get(many[0]!.id)?.state,
      "FOUND",
    );
    assert.deepEqual(
      reasons([parkl("2026-04-01", 1200), parkl("2026-04-02", 1200)]),
      [false, false],
    ); // kettő közül nem választunk
  });

  it("a small remainder on the invoice still pairs the month, with the difference (Parkl, 2026-09: a pending 640 Ft payment)", () => {
    const card = (date: string, amount: number, number = "0194683438") =>
      debit({
        bookingDate: date,
        amount: D(amount),
        counterpartyName: "SIMPLEP*PARKL.NET",
        narrative: `${date.replace(/-/g, ".")} ${number} SIMPLEP*PARKL .NET`,
        category: "CARD_SUBSCRIPTION",
      });
    const month = [
      card("2026-09-03", 6900),
      card("2026-09-14", 3980),
      card("2026-09-29", 11202),
    ];
    const invoice = doc({
      number: "E-PAR-2026-46439",
      date: "2026-10-01",
      gross: D(22722),
      supplierName: "Parkl Digital Technologies Kft.",
    });
    const out = run(month, [invoice]);
    for (const d of month) {
      const o = out.get(d.id)!;
      assert.equal(o.state, "FOUND");
      assert.deepEqual(o.documents, [invoice]);
      assert.equal(
        o.reason,
        "gyűjtőszámla: 3 kártyás fizetés havi összege, a számla többlete 640 HUF, könyveletlen tétel lehet",
      );
      assert.equal(o.amountDifference?.amount.toString(), "-640");
      assert.equal(o.amountDifference?.currency, "HUF");
    }
  });

  it("the exact card takes its invoice first, so the other card's remainder finds its own", () => {
    const card = (date: string, amount: number, number: string) =>
      debit({
        bookingDate: date,
        amount: D(amount),
        counterpartyName: "SIMPLEP*PARKL.NET",
        narrative: `${date.replace(/-/g, ".")} ${number} SIMPLEP*PARKL .NET`,
        category: "CARD_SUBSCRIPTION",
      });
    const exactCard = [
      card("2026-03-05", 500, "1111111111"),
      card("2026-03-06", 500, "1111111111"),
    ];
    const shortCard = [
      card("2026-03-07", 480, "2222222222"),
      card("2026-03-08", 480, "2222222222"),
    ];
    const parkl = (number: string, gross: number) =>
      doc({
        number,
        date: "2026-04-01",
        gross: D(gross),
        supplierName: "Parkl Digital Technologies Kft.",
      });
    // az E-PAR-Y a pontos kártyáé; a rövid kártyának MINDKETTŐ kis többlet
    // lenne (40 és 30 Ft), tehát a pontos kör nélkül kettő közül nem választana
    const out = run(
      [...exactCard, ...shortCard],
      [parkl("E-PAR-Y", 1000), parkl("E-PAR-X", 990)],
    );
    const numbers = (ds: MatchableDebit[]) =>
      ds.map((d) =>
        out
          .get(d.id)
          ?.documents.map((c) => c.number)
          .join(),
      );
    assert.deepEqual(numbers(exactCard), ["E-PAR-Y", "E-PAR-Y"]);
    assert.deepEqual(numbers(shortCard), ["E-PAR-X", "E-PAR-X"]);
    assert.equal(
      out.get(shortCard[0]!.id)?.amountDifference?.amount.toString(),
      "-30",
    );
    assert.equal(out.get(exactCard[0]!.id)?.amountDifference, undefined);
  });

  it("takes the number only as a whole word of the narrative (the two measured wrong pairings)", () => {
    // PETIK-2026-3 a PETIK-2026-30 közleményben: a teljes szám a helyes
    const d = debit({ narrative: "PETIK-2026-30", amount: D(777) });
    const short = doc({ number: "PETIK-2026-3", gross: D(1) });
    const right = doc({ number: "PETIK-2026-30", gross: D(2) });
    assert.equal(
      run([d], [short, right]).get(d.id)?.documents[0]?.id,
      right.id,
    );
    // egy MÁSIK partner 2026-37 számlája az E-VEGA-2026-37 közleményben
    const e = debit({
      narrative: "E-VEGA-2026-37",
      counterpartyName: "Vértes és Tsa Bt.",
      amount: D(778),
    });
    const other = doc({
      number: "2026-37",
      supplierName: "UPS Bt.",
      gross: D(3),
    });
    assert.notEqual(
      run([e], [other]).get(e.id)?.reason,
      "a számla száma a közleményben",
    );
  });

  it("needs the partner too for a short number, and never takes a number under 5 characters", () => {
    const d = debit({
      narrative: "Számla 26/88",
      counterpartyName: "Szállító Kft.",
      amount: D(779),
    });
    const theirs = doc({
      number: "26/88",
      supplierName: "Szállító Kft.",
      gross: D(4),
    });
    const others = doc({
      number: "26/88",
      supplierName: "Másik Bt.",
      gross: D(5),
    });
    assert.equal(
      run([d], [others]).get(d.id)?.reason === "a számla száma a közleményben",
      false,
    );
    assert.equal(run([d], [theirs]).get(d.id)?.documents[0]?.id, theirs.id);
    // a 469-es (rövid) szám a saját partnerénél sem elég
    const e = debit({ narrative: "469", amount: D(780) });
    assert.notEqual(
      run([e], [doc({ number: "469", gross: D(6) })]).get(e.id)?.reason,
      "a számla száma a közleményben",
    );
  });

  it("takes a short number from the partner's own invoice even when the bank spells the name otherwise (Hertlein shape)", () => {
    // Hertlein 260835: 6 karakter, tehát a partnernek is egyeznie kell
    const d = debit({
      narrative: "Invoice 260835",
      counterpartyName: "HERTLEIN AQUARISTIK E.KFR.",
      amount: D(781),
    });
    const theirs = doc({
      number: "260835",
      supplierName: "Hertlein Aquaristik e.Kfr.",
      gross: D(7),
    });
    assert.equal(run([d], [theirs]).get(d.id)?.documents[0]?.id, theirs.id);
    // ugyanez a rövid szám egy másik kiállító HIVATKOZÁSAKÉNT nem párosít
    const other = doc({
      number: "X-99999999",
      references: ["260835"],
      supplierName: "Másik GmbH",
      gross: D(8),
    });
    assert.notEqual(
      run([d], [other]).get(d.id)?.reason,
      "a számla száma a közleményben",
    );
  });

  it("pairs by a reference the invoice carries, when the narrative names that instead of the number", () => {
    // Fauna Marin, éles 2026-10-01: a fizetés a rendelésszámot nevezi meg
    const d = debit({
      narrative: "1.698,58 EUR 20144304 Fauna Marin Gmbh",
      counterpartyName: "Fauna Marin Gmbh",
    });
    const c = doc({
      number: "40142365",
      references: ["20144304"],
      supplierName: "Fauna Marin",
      gross: null,
    });
    const outcome = run([d], [c]).get(d.id);
    assert.equal(outcome?.reason, "a számla száma a közleményben");
    assert.deepEqual(
      outcome?.documents.map((x) => x.id),
      [c.id],
    );
  });

  it("pairs by the supplier's bank account with an exact amount", () => {
    const d = debit({
      counterpartyName: "más név",
      counterpartyAccount: "1177301611111018",
    });
    const c = doc({
      supplierAccounts: ["1177301611111018"],
      supplierName: "Teljesen Más",
    });
    assert.equal(run([d], [c]).get(d.id)?.state, "FOUND");
  });

  it("gives an exact invoice to the payment that matches it exactly, not to an earlier one 1 Ft off", () => {
    const july = debit({ bookingDate: "2026-07-15", amount: D(1999) });
    const august = debit({ bookingDate: "2026-08-07", amount: D(1998) });
    const c = doc({ date: "2026-08-05", gross: D(1998) });
    const out = run([july, august], [c]);
    assert.equal(out.get(august.id)?.documents[0]?.id, c.id);
    assert.equal(out.get(july.id)?.state, "NOT_MATCHED");
  });

  it("counts a 2-5 Ft rounding as found, but does not choose between two such invoices", () => {
    const d = debit({ amount: D(1003) });
    assert.equal(run([d], [doc({})]).get(d.id)?.state, "FOUND");
    const e = debit({ amount: D(1003) });
    const out = run([e], [doc({ gross: D(1000) }), doc({ gross: D(1006) })]);
    assert.equal(out.get(e.id)?.state, "NOT_MATCHED");
    assert.match(out.get(e.id)!.reason, /kerekítési/);
  });

  it("lets one invoice pay one debit only (the two 23 810 Ft Alza payments)", () => {
    // fix ids: a tie goes by id, and the counter's `d99` sorts after `d100`
    const first = debit({
      id: "alza-1",
      amount: D(23810),
      counterpartyName: "Alza.hu Kft.",
    });
    const second = debit({
      id: "alza-2",
      amount: D(23810),
      counterpartyName: "Alza.hu Kft.",
    });
    const out = run(
      [first, second],
      [doc({ gross: D(23810), supplierName: "Alza.hu Kft." })],
    );
    assert.deepEqual(
      [out.get(first.id)?.state, out.get(second.id)?.state],
      ["FOUND", "NOT_MATCHED"],
    );
  });

  it("pairs several invoices in one transfer, and refuses to choose between two sets", () => {
    const d = debit({ amount: D(3000) });
    const out = run([d], [doc({ gross: D(1000) }), doc({ gross: D(2000) })]);
    assert.equal(out.get(d.id)?.documents.length, 2);
    const e = debit({ amount: D(3000) });
    const twice = run(
      [e],
      [
        doc({ gross: D(1000) }),
        doc({ gross: D(2000) }),
        doc({ gross: D(1500) }),
        doc({ gross: D(1500) }),
      ],
    );
    assert.equal(twice.get(e.id)?.state, "NOT_MATCHED");
  });

  it("marks a proforma, a private-person invoice and an unverifiable payee", () => {
    const states = (["PROFORMA", "INVOICE", "INVOICE"] as const).map(
      (kind, i) => {
        const d = debit({});
        return run(
          [d],
          [
            doc({
              kind,
              payee: (["COMPANY", "NOT_COMPANY", "UNKNOWN"] as const)[i],
            }),
          ],
        ).get(d.id)?.state;
      },
    );
    assert.deepEqual(states, ["PROFORMA_ONLY", "NOT_COMPANY", "NOT_MATCHED"]);
  });

  it("asks for the original when only the NAV data row is there", () => {
    const d = debit({});
    assert.equal(
      run([d], [doc({ hasOriginal: false })]).get(d.id)?.state,
      "ORIGINAL_MISSING",
    );
  });

  it("takes the paper original as the original, and a manual pairing by any id of a merged invoice", () => {
    const d = debit({});
    const nav = doc({ hasOriginal: false, aliasIds: ["pdf-1"] });
    const paper = matchMonth({
      debits: [d],
      documents: [nav],
      manual: new Map(),
      paperOriginals: new Set([d.id]),
    });
    assert.equal(paper.get(d.id)?.state, "FOUND");
    const e = debit({ amount: D(1) });
    const byAlias = run([e], [nav], new Map([[e.id, ["pdf-1"]]]));
    assert.deepEqual(
      [byAlias.get(e.id)?.matchedBy, byAlias.get(e.id)?.documents[0]?.id],
      ["MANUAL", nav.id],
    );
  });

  /*
    KÉTSZER FIZETETT SZÁMLA (acrobot 25636: a Sopro KB-2855/2026 két 172 006
    Ft-os terheléshez, ugyanaz a PDF kétszer feltöltve). MI PIROSÍT: ha a két
    terhelés Megvan maradna; ha nem neveznék meg egymást; ha egyetlen
    párosítás is kettősnek látszana; ha egy más gondú tétel (nem a cégre szól)
    elveszítené a saját állapotát.
  */
  it("the same file paired to two debits: both are double paid, and name each other", () => {
    const a = debit({
      id: "pay-28",
      bookingDate: "2026-09-28",
      amount: D(172006),
    });
    const b = debit({
      id: "pay-29",
      bookingDate: "2026-09-29",
      amount: D(172006),
    });
    const first = doc({
      id: "up-1",
      source: "UPLOAD",
      gross: null,
      identities: ["sha:same"],
    });
    const second = doc({
      id: "up-2",
      source: "UPLOAD",
      gross: null,
      identities: ["sha:same"],
    });
    const outcome = run(
      [a, b],
      [first, second],
      new Map([
        [a.id, ["up-1"]],
        [b.id, ["up-2"]],
      ]),
    );
    assert.deepEqual(
      [a, b].map((d) => [
        outcome.get(d.id)?.state,
        outcome.get(d.id)?.doublePaidWith,
      ]),
      [
        ["DOUBLE_PAID", ["pay-29"]],
        ["DOUBLE_PAID", ["pay-28"]],
      ],
    );
  });

  it("the same invoice number paired twice is double paid too; one pairing, or another problem, is not", () => {
    const a = debit({ id: "n-1" });
    const b = debit({ id: "n-2", bookingDate: "2026-08-11" });
    const same = (id: string, payee: CandidateDocument["payee"] = "COMPANY") =>
      doc({ id, identities: ["inv:kb-2855/2026|12345678"], payee });
    const twice = run(
      [a, b],
      [same("x-1"), same("x-2")],
      new Map([
        [a.id, ["x-1"]],
        [b.id, ["x-2"]],
      ]),
    );
    assert.equal(twice.get(a.id)?.state, "DOUBLE_PAID");
    const once = run([a], [same("x-3")], new Map([[a.id, ["x-3"]]]));
    assert.deepEqual(
      [once.get(a.id)?.state, once.get(a.id)?.doublePaidWith],
      ["FOUND", undefined],
    );
    const notOurs = run(
      [a, b],
      [same("x-4", "NOT_COMPANY"), same("x-5")],
      new Map([
        [a.id, ["x-4"]],
        [b.id, ["x-5"]],
      ]),
    );
    assert.deepEqual(
      [notOurs.get(a.id)?.state, notOurs.get(b.id)?.state],
      ["NOT_COMPANY", "DOUBLE_PAID"],
    );
  });

  it("tells no invoice from an unmatched one by whether the partner has documents", () => {
    const d = debit({ amount: D(777) });
    const e = debit({ amount: D(777), counterpartyName: "Ismeretlen Bt." });
    const out = run([d, e], [doc({ gross: D(5000) })]);
    assert.deepEqual(
      [out.get(d.id)?.state, out.get(e.id)?.state],
      ["NOT_MATCHED", "NO_INVOICE"],
    );
    assert.equal(out.get(d.id)?.candidates.length, 1);
  });

  it("keeps a manual pairing even against a rule, and never matches categories that need no invoice", () => {
    const d = debit({ narrative: "SZ-X-99999" });
    const byRule = doc({ number: "SZ-X-99999" });
    const chosen = doc({ gross: D(1) });
    const out = run([d], [byRule, chosen], new Map([[d.id, [chosen.id]]]));
    assert.deepEqual(
      [out.get(d.id)?.matchedBy, out.get(d.id)?.documents[0]?.id],
      ["MANUAL", chosen.id],
    );
    const tax = debit({ category: "TAX" });
    assert.equal(run([tax], [doc({})]).get(tax.id)?.state, "NO_INVOICE_NEEDED");
  });

  it("compares a card payment's original currency amount with a EUR invoice", () => {
    const d = debit({
      amount: D(21990),
      original: { amount: D("55.38"), currency: "EUR" },
      counterpartyName: "Hetzner Online GmbH",
    });
    const c = doc({
      gross: D("55.38"),
      currency: "EUR",
      supplierName: "Hetzner Online GmbH",
    });
    assert.equal(run([d], [c]).get(d.id)?.state, "FOUND");
  });
});

describe("several invoices named in one payment (acrobot 25610)", () => {
  const FLUIDRA = "Fluidra Magyarország Kft.";
  const ks = (
    number: string,
    gross: number,
    extra: Partial<CandidateDocument> = {},
  ) =>
    doc({
      number,
      gross: D(gross),
      supplierName: FLUIDRA,
      date: "2026-09-10",
      ...extra,
    });

  it("pairs EVERY named invoice, the bank's split forms too (Fluidra, 2026-09-25)", () => {
    const d = debit({
      bookingDate: "2026-09-25",
      amount: D(5000),
      counterpartyName: FLUIDRA,
      narrative: "KS26/08132 KS26/08382 KS26/0 8450 K S26/08541 KS26/08638",
    });
    const docs = [
      ks("KS26/08132", 1000),
      ks("KS26/08382", 1000),
      ks("KS26/08450", 1000),
      ks("KS26/08541", 1000),
      ks("KS26/08638", 1000),
    ];
    const outcome = run([d], docs).get(d.id)!;
    assert.equal(outcome.reason, "a számla száma a közleményben");
    assert.deepEqual(outcome.documents.map((x) => x.number).sort(), [
      "KS26/08132",
      "KS26/08382",
      "KS26/08450",
      "KS26/08541",
      "KS26/08638",
    ]);
    assert.equal(outcome.state, "FOUND");
    assert.equal(outcome.missingNumbers, undefined);
    assert.equal(outcome.amountDifference, undefined);
  });

  it("a split number finds only the partner's own invoice", () => {
    // "26/0 8450" osszefuzve egy MASIK kiallito szamlaszama: nem talalat
    const d = debit({
      counterpartyName: FLUIDRA,
      narrative: "26/0 8450 befizetes",
    });
    const other = doc({
      number: "26/08450",
      supplierName: "Más Kft.",
      gross: D(1),
    });
    assert.notEqual(
      run([d], [other]).get(d.id)?.reason,
      "a számla száma a közleményben",
    );
    const own = ks("26/08450", 2);
    assert.deepEqual(
      run([d], [own])
        .get(d.id)
        ?.documents.map((x) => x.id),
      [own.id],
    );
  });

  it("names the missing ones: an invoice without its original, and a named number with no document", () => {
    const d = debit({
      amount: D(3000),
      counterpartyName: FLUIDRA,
      narrative: "KS26/08132 KS26/08382 KS26/08999",
    });
    const navOnly = ks("KS26/08132", 1000, { hasOriginal: false });
    const withPdf = ks("KS26/08382", 1000);
    const outcome = run([d], [navOnly, withPdf]).get(d.id)!;
    assert.equal(outcome.state, "ORIGINAL_MISSING");
    assert.deepEqual(outcome.missingNumbers, ["KS26/08132", "KS26/08999"]);
    // ket szamla 2000, a terheles 3000: az elteres jelezve, a parositas all
    assert.equal(outcome.amountDifference?.amount.toString(), "1000");
    assert.equal(outcome.documents.length, 2);
  });

  it("a named number with no document keeps the item from Found, even when every paired invoice has its original", () => {
    const d = debit({
      counterpartyName: FLUIDRA,
      narrative: "KS26/08132 KS26/08999",
    });
    const outcome = run([d], [ks("KS26/08132", 1000)]).get(d.id)!;
    assert.equal(outcome.state, "ORIGINAL_MISSING");
    assert.deepEqual(outcome.missingNumbers, ["KS26/08999"]);
  });

  it("a named number already paired to another payment is not missing", () => {
    const first = debit({
      bookingDate: "2026-09-01",
      counterpartyName: FLUIDRA,
      narrative: "KS26/08132",
    });
    const second = debit({
      bookingDate: "2026-09-20",
      counterpartyName: FLUIDRA,
      narrative: "KS26/08132 KS26/08382",
    });
    const a = ks("KS26/08132", 1000);
    const b = ks("KS26/08382", 1000);
    const out = run([first, second], [a, b]);
    assert.deepEqual(
      out.get(second.id)?.documents.map((x) => x.id),
      [b.id],
    );
    assert.equal(out.get(second.id)?.missingNumbers, undefined);
  });

  it("only a different shape is not taken for a missing invoice, and a rounding gap is no difference", () => {
    const d = debit({
      amount: D(1003),
      counterpartyName: FLUIDRA,
      narrative: "KS26/08132 rendeles 20260915 Budapest",
    });
    const outcome = run([d], [ks("KS26/08132", 1000)]).get(d.id)!;
    assert.equal(outcome.missingNumbers, undefined);
    assert.equal(outcome.amountDifference, undefined);
    assert.equal(outcome.state, "FOUND");
  });
});

describe("a proforma is only a fallback (acrobot 25607, Aquarioom 2026-09-29)", () => {
  // a valos eset alakja: EUR-terheles, a kozlemeny a rendelesszamot nevezi meg,
  // ami a proforma (Commande) szama; a valodi szamla (Facture) mas szamu
  const aq = (overrides: Partial<MatchableDebit> = {}) =>
    debit({
      bookingDate: "2026-09-29",
      amount: D("939.67"),
      currency: "EUR",
      counterpartyName: "AQUARIOOM",
      narrative: "CM9201 ACROPORA",
      category: "FOREIGN_SUPPLIER",
      ...overrides,
    });
  const proforma = (overrides: Partial<CandidateDocument> = {}) =>
    doc({
      source: "MAILBOX",
      number: "CM9201",
      date: "2026-09-28",
      gross: D("939.67"),
      currency: "EUR",
      supplierName: "Aquarioom",
      kind: "PROFORMA",
      payee: "NOT_COMPANY",
      ...overrides,
    });
  const invoice = (overrides: Partial<CandidateDocument> = {}) =>
    doc({
      source: "MAILBOX",
      number: "FA00009139",
      date: "2026-09-30",
      gross: D("939.67"),
      currency: "EUR",
      supplierName: "Aquarioom",
      ...overrides,
    });

  it("the named proforma gives way to the partner's exact-amount invoice", () => {
    const d = aq();
    const fa = invoice();
    const outcome = run([d], [proforma(), fa]).get(d.id)!;
    assert.equal(outcome.state, "FOUND");
    assert.deepEqual(
      outcome.documents.map((x) => x.number),
      ["FA00009139"],
    );
  });

  it("with no real invoice, or one of another amount or partner, the proforma stays", () => {
    for (const others of [
      [],
      [invoice({ gross: D("939.00") })],
      [invoice({ supplierName: "Fauna Marin GmbH" })],
    ]) {
      const d = aq();
      const outcome = run([d], [proforma(), ...others]).get(d.id)!;
      assert.equal(outcome.state, "PROFORMA_ONLY");
      assert.deepEqual(
        outcome.documents.map((x) => x.number),
        ["CM9201"],
      );
      // az 1. szabaly tartotta meg, nem egy kesobbi szabaly talalta ujra
      assert.equal(outcome.reason, "a számla száma a közleményben");
    }
  });

  it("the account rule also prefers the invoice to a closer proforma", () => {
    const d = aq({ narrative: "rendeles", counterpartyAccount: "FR7612345" });
    const outcome = run(
      [d],
      [
        proforma({ date: "2026-09-29", supplierAccounts: ["FR7612345"] }),
        invoice({ date: "2026-10-05", supplierAccounts: ["FR7612345"] }),
      ],
    ).get(d.id)!;
    assert.equal(
      outcome.reason,
      "a szállító bankszámlájára ment, egyező összeggel",
    );
    assert.deepEqual(
      outcome.documents.map((x) => x.number),
      ["FA00009139"],
    );
  });

  it("when the narrative names both, only the invoice pairs", () => {
    const d = aq({ narrative: "CM9201 FA00009139" });
    const outcome = run([d], [proforma(), invoice()]).get(d.id)!;
    assert.deepEqual(
      outcome.documents.map((x) => x.number),
      ["FA00009139"],
    );
  });

  it("amount and partner alone: the invoice wins even when the proforma is closer in date", () => {
    const d = aq({ narrative: "rendeles" });
    const outcome = run(
      [d],
      [proforma({ date: "2026-09-29" }), invoice({ date: "2026-10-05" })],
    ).get(d.id)!;
    assert.deepEqual(
      outcome.documents.map((x) => x.number),
      ["FA00009139"],
    );
  });

  it("a rounding proforma next to a rounding invoice is not an ambiguity", () => {
    const d = debit({ amount: D(10003), narrative: "rendeles" });
    const outcome = run(
      [d],
      [
        doc({ kind: "PROFORMA", gross: D(10000), payee: "NOT_COMPANY" }),
        doc({ number: "SZ-VALODI", gross: D(10000) }),
      ],
    ).get(d.id)!;
    assert.deepEqual(
      outcome.documents.map((x) => x.number),
      ["SZ-VALODI"],
    );
  });

  it("the invoice taken by another payment does not displace the proforma", () => {
    const first = aq({ bookingDate: "2026-09-20", narrative: "FA00009139" });
    const second = aq();
    const outcomes = run([first, second], [proforma(), invoice()]);
    assert.deepEqual(
      outcomes.get(first.id)!.documents.map((x) => x.number),
      ["FA00009139"],
    );
    assert.equal(outcomes.get(second.id)!.state, "PROFORMA_ONLY");
  });
});

describe("a typo twin: the exact payment wins over the by-name one (acrobot 25655, Fluidra 2026-07-30)", () => {
  const fluidra = (
    amount: number,
    narrative: string,
    overrides: Partial<MatchableDebit> = {},
  ) =>
    debit({
      bookingDate: "2026-07-30",
      amount: D(amount),
      counterpartyName: "Fluidra Magyarország Kft.",
      narrative,
      ...overrides,
    });
  const ks4727 = () =>
    doc({
      number: "KS26/04727",
      date: "2026-05-27",
      gross: D(234778),
      supplierName: "Fluidra Magyarország Kft.",
    });

  it("the exact payment with the mistyped number takes the invoice; the by-name one stays unmatched with it as a candidate", () => {
    const byName = fluidra(81915, "KS26/04727");
    const exactTypo = fluidra(234778, "KS26/04724");
    const invoice = ks4727();
    const out = run([byName, exactTypo], [invoice]);
    assert.deepEqual(out.get(exactTypo.id)!.documents, [invoice]);
    assert.equal(out.get(exactTypo.id)!.state, "FOUND");
    const left = out.get(byName.id)!;
    assert.equal(left.state, "NOT_MATCHED");
    assert.deepEqual(left.candidates, [invoice]);
    assert.match(left.reason, /KS26\/04727.*elírás-gyanú/);
  });

  it("without a typo twin the by-name pairing stands, with the difference (#1332)", () => {
    const other = () =>
      doc({
        number: "KS26/09999",
        date: "2026-06-01",
        gross: D(1),
        supplierName: "Fluidra Magyarország Kft.",
      });
    const cases: [string, () => MatchableDebit[], CandidateDocument[]][] = [
      ["nincs másik fizetés", () => [], []],
      // a másik fizetés LÉTEZŐ számot nevez meg, nem elírást
      ["létező szám", () => [fluidra(234778, "KS26/09999")], [other()]],
      ["nem pontos összeg", () => [fluidra(234000, "KS26/04724")], []],
      [
        "másik partner",
        () => [
          fluidra(234778, "KS26/04724", {
            counterpartyName: "Menet-Trend Kft.",
          }),
        ],
        [],
      ],
      ["más alakú szám", () => [fluidra(234778, "rendeles 4724")], []],
      // a másik fizetésnek van MÁSIK pontos számlája is: nem ezt kell elvenni
      [
        "a másiknak két pontos számlája van",
        () => [fluidra(234778, "KS26/04724")],
        [
          doc({
            number: "KS26/04800",
            date: "2026-06-10",
            gross: D(234778),
            supplierName: "Fluidra Magyarország Kft.",
          }),
        ],
      ],
    ];
    for (const [name, others, extra] of cases) {
      const byName = fluidra(81915, "KS26/04727");
      const invoice = ks4727();
      const o = run([byName, ...others()], [invoice, ...extra]).get(byName.id)!;
      assert.deepEqual(o.documents, [invoice], name);
      assert.equal(o.amountDifference?.amount.toString(), "-152863", name);
    }
    // ha a név szerinti fizetés összege is pontos, az övé marad
    const exactByName = fluidra(234778, "KS26/04727");
    const invoice = ks4727();
    const out = run([exactByName, fluidra(234778, "KS26/04724")], [invoice]);
    assert.deepEqual(out.get(exactByName.id)!.documents, [invoice]);
    // név szerint, nem egy későbbi szabály adta vissza
    assert.equal(
      out.get(exactByName.id)!.reason,
      "a számla száma a közleményben",
    );
  });
});

describe("a company original is not overruled by another document of the same invoice (acrobot 25664)", () => {
  it("the reminder's not-the-company verdict gives way to the invoice's", () => {
    const d = debit({
      narrative: "26007910",
      amount: D(1703.08),
      currency: "EUR",
      counterpartyName: "De Jong Marinelife B.V.",
    });
    const invoice = doc({
      number: "26007910",
      gross: D(1703.08),
      currency: "EUR",
      supplierName: "De Jong Marinelife B.V.",
      source: "MAILBOX",
    });
    const reminder = doc({
      number: "26007910",
      gross: null,
      supplierName: "",
      source: "MAILBOX",
      payee: "NOT_COMPANY",
    });
    assert.equal(run([d], [invoice, reminder]).get(d.id)?.state, "FOUND");
    // egy MÁSIK számla „nem a cégre” ítélete továbbra is dönt
    const e = debit({
      narrative: "26007910 26007911",
      amount: D(1703.08),
      currency: "EUR",
      counterpartyName: "De Jong Marinelife B.V.",
    });
    const other = doc({
      number: "26007911",
      gross: D(1),
      supplierName: "De Jong Marinelife B.V.",
      source: "MAILBOX",
      payee: "NOT_COMPANY",
    });
    assert.equal(
      run([e], [{ ...invoice, id: "inv-2" }, other]).get(e.id)?.state,
      "NOT_COMPANY",
    );
  });
});

describe("a summary invoice's group is one pairing, not a double payment (acrobot 25708)", () => {
  const card = (date: string, amount: number) =>
    debit({
      bookingDate: date,
      amount: D(amount),
      counterpartyName: "SIMPLEP*PARKL.NET",
      narrative: `${date.replace(/-/g, ".")} 0194683438 SIMPLEP*PARKL .NET`,
      category: "CARD_SUBSCRIPTION",
    });
  const parkl = (gross: number, id?: string) =>
    doc({
      ...(id ? { id } : {}),
      number: "E-PAR-2026-46439",
      date: "2026-10-01",
      gross: D(gross),
      supplierName: "Parkl Digital Technologies Kft.",
      identities: ["inv:e-par-2026-46439|12967726"],
    });

  it("the exact monthly group and the small-remainder group are not double paid", () => {
    for (const gross of [1200, 1260]) {
      const month = [
        card("2026-09-05", 400),
        card("2026-09-17", 350),
        card("2026-09-28", 450),
      ];
      const out = run(month, [parkl(gross)]);
      for (const d of month) {
        assert.equal(out.get(d.id)?.state, "FOUND", `${gross}`);
        assert.equal(out.get(d.id)?.doublePaidWith, undefined);
      }
    }
  });

  it("the same invoice in a group AND in another pairing is still double paid", () => {
    const month = [
      card("2026-09-05", 400),
      card("2026-09-17", 350),
      card("2026-09-28", 450),
    ];
    // egy átutalás ugyanarra a számlára (egy másik, azonos számú dokumentummal)
    const transfer = debit({
      bookingDate: "2026-10-02",
      amount: D(1200),
      counterpartyName: "Parkl Digital Technologies Kft.",
      narrative: "szamla",
      category: "DOMESTIC_SUPPLIER",
    });
    const out = run(
      [...month, transfer],
      [parkl(1200, "nav-1"), parkl(1200, "pdf-1")],
    );
    for (const d of [...month, transfer])
      assert.equal(out.get(d.id)?.state, "DOUBLE_PAID", d.id);
    assert.deepEqual(
      out.get(transfer.id)?.doublePaidWith,
      month.map((d) => d.id).sort(),
    );
  });
});

describe("an invoice the collector tied to its card payment(s) (acrobot 25691, Kia Charge)", () => {
  it("pairs the invoice to every payment of its set, and only when all of them are free", () => {
    const a = debit({
      amount: D(21279),
      counterpartyName: "Digital Charging Solut",
      bookingDate: "2026-09-10",
    });
    const b = debit({
      amount: D(18807),
      counterpartyName: "Digital Charging Solut",
      bookingDate: "2026-09-10",
    });
    const invoice = doc({
      number: "OVR_6284372308261",
      gross: D(40086),
      supplierName: "Digital Charging Solut",
      source: "MAILBOX",
      cardPaymentIds: [a.id, b.id],
    });
    const out = run([a, b], [invoice]);
    for (const d of [a, b]) {
      assert.deepEqual(out.get(d.id)?.documents, [invoice]);
      assert.equal(
        out.get(d.id)?.reason,
        "a számla végösszege 2 kártyás fizetés összege",
      );
    }
    // a számla azonossággal (NAV- vagy fájl-kulcs) sem kétszer fizetett: a
    // halmaz EGY párosítás (acrobot 25709, Kia augusztus)
    const identified = {
      ...invoice,
      identities: ["inv:ovr_6284372308261|dcs"],
    };
    const once = run([a, b], [identified]);
    for (const d of [a, b]) {
      assert.equal(once.get(d.id)?.state, "FOUND");
      assert.equal(once.get(d.id)?.doublePaidWith, undefined);
    }
    // ha az egyik fizetést kézzel máshoz párosították, a halmaz nem áll össze
    const other = doc({ number: "X-1", gross: D(1) });
    const manual = run([a, b], [invoice, other], new Map([[a.id, [other.id]]]));
    assert.notDeepEqual(manual.get(b.id)?.documents, [invoice]);
  });
});

describe("a paper original without any digital invoice (acrobot 25745, Aqua-Light 2026-09-07)", () => {
  const aqua = () =>
    debit({
      bookingDate: "2026-09-07",
      amount: D(297458),
      original: { amount: D("810.69"), currency: "EUR" },
      counterpartyName: "AQUA-LIGHT Gmbh",
      category: "FOREIGN_SUPPLIER",
    });
  const withPaper = (
    debits: MatchableDebit[],
    documents: CandidateDocument[],
    paper: string[],
  ) =>
    matchMonth({
      debits,
      documents,
      manual: new Map(),
      paperOriginals: new Set(paper),
    });

  it("marked, a payment with no invoice at all, or none that pairs, is found on paper", () => {
    // nincs dokumentum: NO_INVOICE
    const a = aqua();
    const none = withPaper([a], [], [a.id]).get(a.id)!;
    assert.deepEqual([none.state, none.documents], ["FOUND", []]);
    assert.equal(
      none.reason,
      "a partnertől nincs számla a forrásokban; nincs digitális számla, az eredeti papíron megvan",
    );
    // a partnertől van más számla, de ez a fizetés nem párosodik: NOT_MATCHED
    const b = aqua();
    const other = doc({
      number: "AL-1",
      gross: D(5),
      currency: "EUR",
      supplierName: "AQUA-LIGHT GmbH",
    });
    const unpaired = withPaper([b], [other], [b.id]).get(b.id)!;
    assert.deepEqual([unpaired.state, unpaired.documents], ["FOUND", []]);
    // az indokból látszik, hogy volt jelölt digitális számla (acrobot 25762)
    assert.match(
      unpaired.reason,
      /^a partnertől van számla, de ez a fizetés nem párosodott; nincs digitális számla/,
    );
  });

  it("unmarked it stays missing, and a wrong document (proforma, not the company's) is not resolved by paper", () => {
    const a = aqua();
    assert.equal(withPaper([a], [], []).get(a.id)?.state, "NO_INVOICE");
    const b = aqua();
    const proforma = doc({
      number: "PF-1",
      gross: D("810.69"),
      currency: "EUR",
      supplierName: "AQUA-LIGHT GmbH",
      kind: "PROFORMA",
    });
    assert.equal(
      withPaper([b], [proforma], [b.id]).get(b.id)?.state,
      "PROFORMA_ONLY",
    );
  });
});
