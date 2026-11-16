import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import { candidateDocument } from "../testing/billing-documents.fixture.js";
import type { CandidateDocument } from "./missing-invoice-matching.js";
import {
  CANDIDATE_ORIGINS,
  loaderExclusion,
  survivingOtherPaths,
  mergedSupplierTaxNumber,
  mergeSameInvoice,
  normalizeAccount,
  queryExclusion,
  notBookableKeyOf,
  splitNotBookable,
  withoutNotBookable,
} from "./missing-invoices.repository.js";

const doc = (overrides: Partial<CandidateDocument>): CandidateDocument =>
  candidateDocument({ id: "x", number: "SZ-1", ...overrides });

describe("mergeSameInvoice", () => {
  it("makes one invoice of the NAV row and its mailbox PDF: NAV gross and payee, the PDF as the original", () => {
    const nav = doc({ id: "nav-1" });
    const pdf = doc({
      id: "mb-1",
      source: "MAILBOX",
      gross: null,
      payee: "UNKNOWN",
      hasOriginal: true,
    });
    const merged = mergeSameInvoice(
      [nav, pdf],
      new Map([
        ["nav-1", "sz-1|12345678"],
        ["mb-1", "sz-1|12345678"],
      ]),
    );
    assert.equal(merged.length, 1);
    assert.deepEqual(
      [
        merged[0]!.id,
        merged[0]!.source,
        merged[0]!.gross?.toString(),
        merged[0]!.payee,
        merged[0]!.hasOriginal,
        merged[0]!.originalId,
      ],
      ["nav-1", "MAILBOX", "12700", "COMPANY", true, "mb-1"],
    );
  });

  // MI PIROSÍT: ha az eredeti a díjbekérő marad, amikor a csoportban a
  // végleges számla is ott áll (Amblard F2602896, 2026-10-06). A díjbekérő
  // ÁLL ELÖL, hogy a régi „első eredeti” szabály ezt válassza.
  it("takes the final invoice as the original, not a pro forma with the same number", () => {
    const nav = doc({ id: "nav-1" });
    const proforma = doc({
      id: "mb-proforma",
      source: "MAILBOX",
      kind: "PROFORMA",
      gross: null,
      payee: "UNKNOWN",
      hasOriginal: true,
    });
    const invoice = doc({
      id: "mb-invoice",
      source: "MAILBOX",
      gross: null,
      payee: "UNKNOWN",
      hasOriginal: true,
    });
    const keys = new Map([
      ["nav-1", "sz-1|12345678"],
      ["mb-proforma", "sz-1|12345678"],
      ["mb-invoice", "sz-1|12345678"],
    ]);
    const merged = mergeSameInvoice([nav, proforma, invoice], keys);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]!.originalId, "mb-invoice");
    assert.equal(merged[0]!.kind, "INVOICE");
    // kontroll: számla nélkül a díjbekérő marad az eredeti, nem tűnik el
    const alone = mergeSameInvoice([nav, proforma], keys);
    assert.equal(alone[0]!.originalId, "mb-proforma");
  });

  // MI PIROSÍT: ha a feed XML-je lesz az eredeti a postafiók PDF-je helyett
  // (UNAS UO-418953/2026, 2026-10-06: a PDF-et díjbekérőnek olvastuk, a feed
  // sorát számlának). A forrás áll elöl, mert a PDF fajta-olvasata tévedhet.
  it("takes the mailbox PDF as the original before the Számlázz.hu feed's file", () => {
    const nav = doc({ id: "nav-1" });
    const feed = doc({
      id: "feed-xml",
      source: "SZAMLAZZ",
      gross: null,
      payee: "UNKNOWN",
      hasOriginal: true,
    });
    const pdf = doc({
      id: "mb-pdf",
      source: "MAILBOX",
      kind: "PROFORMA",
      gross: null,
      payee: "UNKNOWN",
      hasOriginal: true,
    });
    const keys = new Map([
      ["nav-1", "uo-1|14114113"],
      ["feed-xml", "uo-1|14114113"],
      ["mb-pdf", "uo-1|14114113"],
    ]);
    const merged = mergeSameInvoice([nav, feed, pdf], keys);
    assert.equal(merged[0]!.originalId, "mb-pdf");
    assert.equal(merged[0]!.source, "MAILBOX");
    // kontroll: ha csak a feed fájlja van, az az eredeti
    assert.equal(
      mergeSameInvoice([nav, feed], keys)[0]!.originalId,
      "feed-xml",
    );
  });

  // MI PIROSÍT (acrobot 26084): ha a NAV-sorral összevont Számlázz.hu-számla
  // elveszítené a kártyás fizetési módot, és a 3f. szabály nem látná.
  it("keeps the card payment of any source of the merged invoice", () => {
    const merged = mergeSameInvoice(
      [
        doc({ id: "nav-1", source: "NAV", hasOriginal: false }),
        doc({ id: "szlz-1", source: "SZAMLAZZ", cardPaid: true }),
        doc({ id: "nav-2", number: "SZ-2", source: "NAV" }),
      ],
      new Map([
        ["nav-1", "sz-1|12345678"],
        ["szlz-1", "sz-1|12345678"],
        ["nav-2", "sz-2|12345678"],
      ]),
    );
    assert.deepEqual(
      merged.map((d) => [d.id, d.cardPaid ?? false]),
      [
        ["nav-1", true],
        ["nav-2", false],
      ],
    );
  });

  it("leaves apart what has no number, and two different invoices", () => {
    const merged = mergeSameInvoice(
      [doc({ id: "a" }), doc({ id: "b" }), doc({ id: "c" })],
      new Map([
        ["a", "sz-1|12345678"],
        ["b", "sz-2|12345678"],
        ["c", "|12345678"],
      ]),
    );
    assert.equal(merged.length, 3);
  });

  // MI PIROSÍT (acrobot 25636): ha az összevont számla nem vinné a társai
  // fájl-lenyomatát és a számlaszám-kulcsát; ha egy szám nélküli dokumentum
  // hamis kulcsot kapna.
  it("carries what makes two documents the same invoice: the file prints and the number key", () => {
    const merged = mergeSameInvoice(
      [
        doc({ id: "nav-1" }),
        doc({ id: "up-1", source: "UPLOAD", identities: ["sha:aaa"] }),
        doc({ id: "up-2", source: "UPLOAD", identities: ["sha:bbb"] }),
      ],
      new Map([
        ["nav-1", "sz-1|12345678"],
        ["up-1", "sz-1|12345678"],
        ["up-2", "|12345678"],
      ]),
    );
    const byId = (id: string) => merged.find((d) => d.id === id)?.identities;
    assert.deepEqual(
      [byId("nav-1")?.slice().sort(), byId("up-2")],
      [["inv:sz-1|12345678", "sha:aaa"], ["sha:bbb"]],
    );
  });
});

describe("normalizeAccount", () => {
  it("makes the IBAN, the 24-digit and the 16-digit forms of a Hungarian account one", () => {
    assert.deepEqual(
      [
        "HU42 1177 3016 1111 1018 0000 0000",
        "11773016-11111018-00000000",
        "1177301611111018",
      ].map(normalizeAccount),
      ["1177301611111018", "1177301611111018", "1177301611111018"],
    );
    assert.equal(
      normalizeAccount("DE89370400440532013000"),
      "DE89370400440532013000",
    );
  });
});

/*
  AZ ÁFA-CSOPORT TAGJA (barracuda 26429, éles mérés: Euroleasing 2, OTP EBIZ 1).
  MI PIROSÍT: a csoport-azonosítós NAV-sor és a tag adószámos Számlázz.hu-sor
  külön jelölt marad; vagy épp fordítva, két különböző szállító azonos
  számlaszáma összevonódik, mert csak a szám egyezik; vagy több lehetséges
  társ közül a szabály választ.
*/
describe("a VAT group member's two tax numbers", () => {
  const euroleasingNav = () =>
    doc({
      id: "nav-1",
      number: "2026/01212920",
      gross: new Prisma.Decimal(48260),
      date: "2026-09-05",
    });
  const euroleasingSzamlazz = (over: Partial<CandidateDocument> = {}) =>
    doc({
      id: "szlz-1",
      source: "SZAMLAZZ",
      number: "2026/01212920",
      gross: new Prisma.Decimal(48260),
      date: "2026-09-05",
      ...over,
    });

  it("the NAV row's group id and the member's own number make one invoice", () => {
    const merged = mergeSameInvoice(
      [euroleasingNav(), euroleasingSzamlazz()],
      new Map([
        ["nav-1", "2026/01212920|17782672"],
        ["szlz-1", "2026/01212920|12238972"],
      ]),
    );
    assert.deepEqual(
      merged.map((d) => [d.id, d.aliasIds ?? []]),
      [["nav-1", ["szlz-1"]]],
    );
  });

  // MI PIROSÍT: a NAV-sor kulcsán álló, bruttó nélküli csatolt kép a
  // csoport-azonosítón marad, és külön jelölt lesz (barracuda, #1617 review)
  it("a scan that shares the NAV row's key moves with it into the one invoice", () => {
    const merged = mergeSameInvoice(
      [
        euroleasingNav(),
        euroleasingSzamlazz(),
        doc({
          id: "scan-1",
          source: "UPLOAD",
          number: "2026/01212920",
          gross: null,
          date: "2026-09-05",
          hasOriginal: true,
        }),
      ],
      new Map([
        ["nav-1", "2026/01212920|17782672"],
        ["szlz-1", "2026/01212920|12238972"],
        ["scan-1", "2026/01212920|17782672"],
      ]),
    );
    assert.deepEqual(
      merged.map((d) => [d.id, [...(d.aliasIds ?? [])].sort()]),
      [["nav-1", ["scan-1", "szlz-1"]]],
      "VAT-GROUP-SCAN-ALONG",
    );
  });

  it("a different gross or day, or a NAV row without a group id, stays apart", () => {
    for (const [szamlazz, navKey] of [
      [
        euroleasingSzamlazz({ gross: new Prisma.Decimal(48261) }),
        "2026/01212920|17782672",
      ],
      [euroleasingSzamlazz({ date: "2026-09-06" }), "2026/01212920|17782672"],
      [euroleasingSzamlazz(), "2026/01212920|11111111"],
    ] as const)
      assert.equal(
        mergeSameInvoice(
          [euroleasingNav(), szamlazz],
          new Map([
            ["nav-1", navKey],
            ["szlz-1", "2026/01212920|12238972"],
          ]),
        ).length,
        2,
      );
  });

  it("two possible partners with different keys: the rule does not choose", () => {
    const merged = mergeSameInvoice(
      [
        euroleasingNav(),
        euroleasingSzamlazz(),
        euroleasingSzamlazz({ id: "mb-1", source: "MAILBOX" }),
      ],
      new Map([
        ["nav-1", "2026/01212920|17782672"],
        ["szlz-1", "2026/01212920|12238972"],
        ["mb-1", "2026/01212920|99999999"],
      ]),
    );
    assert.equal(merged.find((d) => d.id === "nav-1")?.aliasIds, undefined);
  });
});

/**
 * A KÖNYVELŐI CSOMAG FÁJLJA PDF LEGYEN (acrobot 35571, Coral Sands RE67900,
 * 2026-10-23): a postafiók az XRechnung XML-jét és a PDF-et két dokumentumként
 * hozza, azonos forrással és fajtával. A csomag-építő csak %PDF- fejlécű fájlt
 * fűz be. MI PIROSÍT: ha az XML lesz az eredeti, akármilyen sorrendben állnak a
 * dokumentumok; ha a PDF-et díjbekérőnek olvasták, és emiatt az XML megelőzi; ha
 * egy önmagában álló XML elveszik az eredeti szerepből; ha egy ismeretlen nevű
 * fájl nem-PDF-nek számít.
 */
describe("mergeSameInvoice prefers a PDF original over an XML one", () => {
  const xml = doc({
    id: "mb-xml",
    source: "MAILBOX",
    gross: null,
    payee: "UNKNOWN",
    hasOriginal: true,
    originalIsPdf: false,
  });
  const pdf = doc({
    id: "mb-pdf",
    source: "MAILBOX",
    gross: null,
    payee: "UNKNOWN",
    hasOriginal: true,
    originalIsPdf: true,
  });
  const keys = new Map([
    ["mb-xml", "re67900|de152405660"],
    ["mb-pdf", "re67900|de152405660"],
  ]);

  it("takes the PDF as the original whichever order the two documents come in", () => {
    assert.equal(mergeSameInvoice([xml, pdf], keys)[0]!.originalId, "mb-pdf");
    assert.equal(mergeSameInvoice([pdf, xml], keys)[0]!.originalId, "mb-pdf");
  });

  it("takes the PDF even when its kind was read as a pro forma and the XML's as an invoice", () => {
    const misread = doc({ ...pdf, kind: "PROFORMA" });
    assert.equal(
      mergeSameInvoice([xml, misread], keys)[0]!.originalId,
      "mb-pdf",
    );
    assert.equal(
      mergeSameInvoice([misread, xml], keys)[0]!.originalId,
      "mb-pdf",
    );
  });

  it("keeps the XML as the original when there is no PDF", () => {
    const nav = doc({ id: "nav-1" });
    const merged = mergeSameInvoice(
      [nav, xml],
      new Map([
        ["nav-1", "re67900|de152405660"],
        ["mb-xml", "re67900|de152405660"],
      ]),
    );
    assert.equal(merged[0]!.originalId, "mb-xml");
  });

  it("treats a document with no format information as a PDF", () => {
    const unknown = doc({
      id: "mb-unknown",
      source: "MAILBOX",
      gross: null,
      payee: "UNKNOWN",
      hasOriginal: true,
    });
    const merged = mergeSameInvoice(
      [xml, unknown],
      new Map([
        ["mb-xml", "k|x"],
        ["mb-unknown", "k|x"],
      ]),
    );
    assert.equal(merged[0]!.originalId, "mb-unknown");
  });
});

// „Nem könyvelendő” (Balázs, 2026-10-26): a jelölt számla MINDEN forrásból kiesik,
// különben egy megmaradt társ (NAV-sor, postafiók PDF-je) újra jelölt lenne.
describe("withoutNotBookable", () => {
  const nav = doc({ id: "nav-1" });
  const pdf = doc({ id: "mb-1", source: "MAILBOX", hasOriginal: true });
  const feed = doc({ id: "feed-1", source: "SZAMLAZZ", hasOriginal: true });
  const other = doc({ id: "nav-2", number: "SZ-2" });
  const keys = new Map([
    ["nav-1", "sz-1|12345678"],
    ["mb-1", "sz-1|12345678"],
    ["feed-1", "sz-1|12345678"],
    ["nav-2", "sz-2|12345678"],
  ]);
  const none = {
    sourceDocumentIds: new Set<string>(),
    keys: new Set<string>(),
  };

  it("with nothing marked it returns every document", () => {
    assert.deepEqual(
      withoutNotBookable([nav, pdf, other], keys, none).map((d) => d.id),
      ["nav-1", "mb-1", "nav-2"],
    );
  });

  it("drops the invoice from every source that brings it, by its key, and keeps the others", () => {
    const left = withoutNotBookable([nav, pdf, feed, other], keys, {
      ...none,
      keys: new Set(["sz-1|12345678"]),
    });
    assert.deepEqual(
      left.map((d) => d.id),
      ["nav-2"],
    );
  });

  it("drops by the feed row's source document too, and with it the same invoice from the other sources", () => {
    const left = withoutNotBookable([nav, pdf, feed, other], keys, {
      ...none,
      sourceDocumentIds: new Set(["feed-1"]),
    });
    assert.deepEqual(
      left.map((d) => d.id),
      ["nav-2"],
    );
  });

  it("drops a numberless document only by its identifier, never by an empty key", () => {
    const loose = doc({ id: "loose-1", number: "", source: "UPLOAD" });
    const looseKeys = new Map([...keys, ["loose-1", "|szállító kft."]]);
    assert.deepEqual(
      withoutNotBookable([loose, other], looseKeys, {
        ...none,
        keys: new Set(["|szállító kft."]),
      }).map((d) => d.id),
      ["loose-1", "nav-2"],
    );
    assert.deepEqual(
      withoutNotBookable([loose, other], looseKeys, {
        ...none,
        sourceDocumentIds: new Set(["loose-1"]),
      }).map((d) => d.id),
      ["nav-2"],
    );
  });

  it("drops the NAV row of a VAT group member whose key differs until aligned", () => {
    // NAV: the group id; feed: the member's own number; same number, gross and day
    const group = doc({ id: "nav-g", number: "SZ-9" });
    const member = doc({
      id: "feed-g",
      source: "SZAMLAZZ",
      number: "SZ-9",
      hasOriginal: true,
    });
    const left = withoutNotBookable(
      [group, member, other],
      new Map([
        ["nav-g", "sz-9|17123456"],
        ["feed-g", "sz-9|12345678"],
        ["nav-2", "sz-2|12345678"],
      ]),
      { ...none, keys: new Set(["sz-9|12345678"]) },
    );
    assert.deepEqual(
      left.map((d) => d.id),
      ["nav-2"],
    );
  });
});

/*
  AZ ÖSSZEVONT CSOPORT ADÓSZÁMA (barracuda, #2093 review). MI PIROSÍT: ha a NAV-sor adószáma
  nem az elsődleges; ha két, eltérő törzsű kiolvasás közül az „első” nyerne (véletlenül az
  egyik adóalany kulcsát kapná a másik); ha a saját adószámunk (a vevő) vagy egy külföldi
  azonosító szállítói adószámmá válna.
*/
describe("mergedSupplierTaxNumber", () => {
  const mail = (id: string, tax: string | null) =>
    doc({ id, source: "MAILBOX", supplierTaxNumber: tax });

  it("the NAV row's number comes first, even against a differing reading", () => {
    const nav = doc({
      id: "nav",
      source: "NAV",
      supplierTaxNumber: "12345678-2-41",
    });
    assert.equal(
      mergedSupplierTaxNumber([mail("m", "87654321-2-41"), nav]),
      "12345678-2-41",
    );
  });

  it("without a NAV row: the one common base of the readings; two different bases give none", () => {
    assert.equal(
      mergedSupplierTaxNumber([
        mail("a", "12345678-2-41"),
        mail("b", "12345678"),
      ]),
      "12345678-2-41",
    );
    assert.equal(
      mergedSupplierTaxNumber([
        mail("a", "12345678-2-41"),
        mail("b", "87654321-2-41"),
      ]),
      null,
    );
    assert.equal(
      mergedSupplierTaxNumber([mail("a", null), mail("b", null)]),
      null,
    );
  });

  it("our own number and a foreign identifier are never the supplier's", () => {
    const ours = "23916229-2-42";
    assert.equal(
      mergedSupplierTaxNumber([mail("a", ours), mail("b", ours)]),
      null,
    );
    assert.equal(mergedSupplierTaxNumber([mail("a", "DE123456789")]), null);
    // a NAV-sor sem lehet a mi számunk: ilyenkor a kiolvasott egyetlen használható törzs marad
    const navOurs = doc({ id: "nav", source: "NAV", supplierTaxNumber: ours });
    assert.equal(
      mergedSupplierTaxNumber([navOurs, mail("m", "12345678-2-41")]),
      "12345678-2-41",
    );
  });

  it("a merged document gets no tax number when its members disagree", () => {
    const merged = mergeSameInvoice(
      [mail("a", "12345678-2-41"), mail("b", "87654321-2-41")],
      new Map([
        ["a", "sz-1|12345678"],
        ["b", "sz-1|12345678"],
      ]),
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0]!.supplierTaxNumber, null);
  });
});

/*
  A BETÖLTŐ KIZÁRÁSAI OKKAL (niceshops, 2026-11-12). MI PIROSÍT: ha egy kizárás kód nélkül marad (a ciklus és a vizsgálat
  szétcsúszik); ha az eredeti sorrend megváltozik (a begyűjtött másolat a dátum-ellenőrzés ELŐTT esik ki); ha egy átmenő
  dokumentum kizárást kap; ha a `where` magyarázata mást mond, mint a `where`.
*/
describe("loaderExclusion: why a stored document is not a candidate", () => {
  const base = {
    origin: "COLLECTED_MAIL",
    sha256: "aa",
    fileName: "Rechnung.pdf",
    linkedToUnpostedPurchase: false,
    linked: false,
    upload: false,
    otherContent: new Map<string, readonly string[]>(),
    date: "2026-11-05" as string | null,
    hasResult: false,
    hasReading: true,
    from: "2025-09-01",
    to: "2026-11-15",
  };
  const code = (patch: Partial<typeof base>) =>
    loaderExclusion({ ...base, ...patch })?.code ?? null;

  it("lets an ordinary document through", () => {
    assert.equal(code({}), null);
  });

  it("names each exclusion", () => {
    assert.equal(
      code({ origin: "UPLOAD", upload: false, linkedToUnpostedPurchase: true }),
      "UPLOAD_OF_UNPOSTED_PURCHASE",
    );
    assert.equal(
      code({ otherContent: new Map([["aa", ["up-1"]]]) }),
      "COLLECTED_COPY_OF_OTHER_PATH",
    );
    assert.equal(code({ date: null }), "NO_DATE");
    assert.equal(code({ hasReading: false }), "NO_READING");
    assert.equal(code({ date: "2024-01-01" }), "OUT_OF_WINDOW");
    assert.equal(code({ date: "2026-12-01" }), "OUT_OF_WINDOW");
    assert.equal(
      code({ fileName: "Fizetési emlékeztető.pdf" }),
      "REMINDER_FILE_NAME",
    );
  });

  it("a collected copy is judged before the date: a copy of another path with no date is the copy, not NO_DATE", () => {
    assert.equal(
      code({ otherContent: new Map([["aa", ["up-1"]]]), date: null }),
      "COLLECTED_COPY_OF_OTHER_PATH",
    );
  });

  it("a mailbox document (not collected) with the same hash is not a copy; an upload is never windowed or file-name filtered", () => {
    assert.equal(
      code({ origin: "MAILBOX", otherContent: new Map([["aa", ["up-1"]]]) }),
      null,
    );
    assert.equal(
      code({
        origin: "UPLOAD",
        upload: true,
        date: "2024-01-01",
        hasReading: false,
      }),
      null,
    );
  });
});

describe("queryExclusion: why the query never loaded a document", () => {
  it("a document waiting for a person is named with its state", () => {
    assert.deepEqual(
      queryExclusion({
        reviewState: "SUGGESTED",
        status: "READ",
        kind: "INVOICE",
        origin: "COLLECTED_MAIL",
      }),
      { code: "AWAITING_REVIEW", detail: "reviewState=SUGGESTED" },
    );
  });

  it("a document that is neither read nor of a candidate origin is not a candidate kind", () => {
    assert.equal(
      queryExclusion({
        reviewState: null,
        status: "FAILED",
        kind: null,
        origin: "MAILBOX",
      })?.code,
      "NOT_A_CANDIDATE_KIND",
    );
  });

  it("agrees with the query: a read, kinded mailbox document and every candidate origin pass", () => {
    assert.equal(
      queryExclusion({
        reviewState: null,
        status: "LATE_CORRECTION",
        kind: "INVOICE",
        origin: "MAILBOX",
      }),
      null,
    );
    for (const origin of CANDIDATE_ORIGINS)
      assert.equal(
        queryExclusion({
          reviewState: null,
          status: "FAILED",
          kind: null,
          origin,
        }),
        null,
        origin,
      );
  });
});

describe("splitNotBookable: what the not-bookable mark removed, and why", () => {
  it("names the way each document fell out: its own id, its key, or the key of a marked twin", () => {
    const a = doc({ id: "a", number: "R-1" });
    const b = doc({ id: "b", number: "R-1" });
    const c = doc({ id: "c", number: "R-2" });
    const keys = new Map([
      ["a", "r-1|niceshops"],
      ["b", "r-1|niceshops"],
      ["c", "r-2|other"],
    ]);
    const { kept, removed } = splitNotBookable([a, b, c], keys, {
      sourceDocumentIds: new Set(["a"]),
      keys: new Set<string>(),
    });
    assert.deepEqual(
      kept.map((d) => d.id),
      ["c"],
    );
    assert.deepEqual(
      removed.map((r) => [r.document.id, r.via]),
      [
        ["a", "sourceDocumentId"],
        ["b", "sameKeyAsMarked"],
      ],
    );
  });
});

/*
  A „NEM KÖNYVELENDŐ” JELÖLÉS A KÜLFÖLDI SZÁLLÍTÓ SORÁN IS ELÉR A DOKUMENTUMIG (acrobot 49536, barracuda #2491): a bejövő rekord
  adószáma a `supplierEuTaxNumber` mezőben áll, a `supplierTaxNumber` üres; a kulcs korábban a névre esett, a dokumentumé az
  adószám-számjegyekre. MI PIROSÍT: ha az EU-számos jelölt sor kulcsa nem egyezik a dokumentuméval (a dokumentum a hiányzók között
  marad); ha egy MÁS EU-számú sor is eltüntetné ugyanazt a dokumentumot; ha a magyar adószám nem nyerne az EU mező fölött.
*/
describe("notBookableKeyOf: the mark of a foreign supplier's row meets the document", () => {
  const NUMBER = "R49010000026240667";
  const marked = (over: Record<string, string | null> = {}) =>
    notBookableKeyOf({
      documentNumber: NUMBER,
      supplierName: "niceshops GmbH",
      supplierTaxNumber: null,
      supplierEuTaxNumber: "ATU63964918",
      ...over,
    });
  // a dokumentum oldali kulcs: számlaszám + az adószám számjegyei (mergeSameInvoice / invoiceKey)
  const documentKey = "r49010000026240667|63964918";

  it("a row whose tax number is only in the EU field has the document's key, and the mark removes the document", () => {
    assert.equal(marked(), documentKey);
    const upload = doc({ id: "upload", number: NUMBER });
    const { kept, removed } = splitNotBookable(
      [upload],
      new Map([["upload", documentKey]]),
      { sourceDocumentIds: new Set<string>(), keys: new Set([marked()]) },
    );
    assert.deepEqual(kept, []);
    assert.deepEqual(
      removed.map((r) => [r.document.id, r.via]),
      [["upload", "key"]],
    );
  });

  it("another EU number does not remove it, and the supplierTaxNumber wins when it gives digits", () => {
    assert.notEqual(
      marked({ supplierEuTaxNumber: "ATU11111111" }),
      documentKey,
    );
    assert.equal(
      marked({
        supplierTaxNumber: "ATU63964918",
        supplierEuTaxNumber: "ATU11111111",
      }),
      documentKey,
    );
    // no tax number in either field: the key falls to the name, as before
    assert.equal(
      marked({ supplierEuTaxNumber: null }),
      `${NUMBER.toLowerCase()}|niceshops gmbh`,
    );
  });
});

/*
  A BEGYŰJTÖTT MÁSOLAT CSAK AKKOR KIESIK, HA A MÁSIK ÚT DOKUMENTUMA JELÖLT MARAD (niceshops, 2026-11-12: a 338 018 Ft-os
  számla gyűjtött példánya kiesett, mert egy nem gyűjtött dokumentum ugyanazt a fájlt hordozta, és az a dokumentum maga sem
  volt jelölt, tehát a terhelésnek nem maradt jelölt). MI PIROSÍT: ha a másik út kiesett dokumentuma is eltünteti a másolatot;
  ha a másik út jelölt-képes dokumentuma már NEM tünteti el (a duplikátum-védelem marad); ha a másik út azonosítója nem kerül
  a kizárás okába.
*/
describe("collected copy and the other path", () => {
  const entries = [
    { id: "copy", sha256: "aa", collected: true, candidateCapable: true },
    {
      id: "other-dead",
      sha256: "aa",
      collected: false,
      candidateCapable: false,
    },
    { id: "other-ok", sha256: "bb", collected: false, candidateCapable: true },
    { id: "copy-2", sha256: "bb", collected: true, candidateCapable: true },
  ];

  it("only a candidate-capable document of another path counts; a collected one never does", () => {
    assert.deepEqual([...survivingOtherPaths(entries)], [["bb", ["other-ok"]]]);
  });

  it("the copy of a file whose other-path document dropped out stays; the copy of a file whose other path stays a candidate falls out, naming it", () => {
    const survivors = survivingOtherPaths(entries);
    const base = {
      origin: "COLLECTED_MAIL",
      fileName: "Rechnung.pdf",
      linkedToUnpostedPurchase: false,
      linked: false,
      upload: false,
      otherContent: survivors,
      date: "2026-11-05" as string | null,
      hasResult: false,
      hasReading: true,
      from: "2025-09-01",
      to: "2026-11-15",
    };
    assert.equal(loaderExclusion({ ...base, sha256: "aa" }), null);
    const dropped = loaderExclusion({ ...base, sha256: "bb" });
    assert.equal(dropped?.code, "COLLECTED_COPY_OF_OTHER_PATH");
    assert.match(dropped?.detail ?? "", /other-ok/);
  });
});
