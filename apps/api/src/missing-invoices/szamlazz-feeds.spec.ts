import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import {
  feedReply,
  parseSzamlabe,
  parseSzamlaKi,
  parseXmlTree,
  pdfFromField,
  SzamlazzFeedParseError,
} from "./szamlazz-feed-xml.js";
import type {
  FeedInvoiceInput,
  FeedStoreOutcome,
  SzamlazzFeedsRepository,
} from "./szamlazz-feeds.repository.js";
import { preferredSameContentSource } from "./szamlazz-feeds.repository.js";
import { SzamlazzFeedsService } from "./szamlazz-feeds.service.js";

/*
  A MINTA a szamlabe.xsd szerint (exchange/szamlazz-xsd, 2026-10-01): a `cim`
  típusnak is van `cim` eleme, tehát a fa beágyazott. A számok, nevek kitaláltak.
*/
const PDF = Buffer.from("%PDF-1.4 kboss szamla");
const szamlabe = (
  over: {
    vevoAdoszam?: string;
    vevoNev?: string;
    pdf?: string;
    teszt?: string;
    extra?: string;
  } = {},
) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<szamlabe xmlns="http://www.szamlazz.hu/szamlabe">
  <szallito><id>1</id><nev>KBOSS.hu Kft.</nev>
    <cim><orszag>HU</orszag><irsz>1031</irsz><telepules>Budapest</telepules><cim>Záhony utca 7.</cim></cim>
    <adoszam>13421739-2-41</adoszam></szallito>
  <alap><id>98765</id><szamlaszam>E-KBOSS-2026-1234</szamlaszam><gazdEsemAzon>1</gazdEsemAzon><tipus>SZ</tipus>
    <eszamla>1</eszamla><kelt>2026-09-28</kelt><telj>2026-09-28</telj><fizh>2026-10-06</fizh>
    <fizmod>Átutalás</fizmod><fizmodunified>átutalás</fizmodunified><keszpenz>false</keszpenz><nyelv>hu</nyelv>
    <devizanem>HUF</devizanem><penzforg>false</penzforg><kata>false</kata><katafokonyv>false</katafokonyv>
    <teszt>${over.teszt ?? "false"}</teszt></alap>
  <vevo><nev>${over.vevoNev ?? "Acropora Kft."}</nev>
    <cim><irsz>1106</irsz><telepules>Budapest</telepules><cim>Pesti Gábor utca 35.</cim></cim>
    <adoszam>${over.vevoAdoszam ?? "23916229-2-42"}</adoszam><lokacio>1</lokacio></vevo>
  <tetelek><tetel><nev>Számlázz.hu előfizetés</nev><mennyiseg>1</mennyiseg><mennyisegiegyseg>db</mennyisegiegyseg>
    <nettoegysegar>10000</nettoegysegar><afakulcs>27</afakulcs><netto>10000</netto><afa>2700</afa>
    <brutto>12700</brutto><sztetordering>1</sztetordering></tetel></tetelek>
  <osszegek><afakulcsossz><afakulcs>27</afakulcs><netto>10000</netto><afa>2700</afa><brutto>12700</brutto></afakulcsossz>
    <totalossz><netto>10000</netto><afa>2700</afa><brutto>12700.0</brutto></totalossz></osszegek>
  ${over.pdf === undefined ? `<pdf>${PDF.toString("base64")}</pdf>` : over.pdf}${over.extra ?? ""}
</szamlabe>`;

const code = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (error) {
    return error instanceof SzamlazzFeedParseError ? "parse" : String(error);
  }
};

// MI PIROSÍT: ha a beágyazott `cim` a rossz mezőt adná; ha DOCTYPE, entitás,
// feldolgozási utasítás, idegen gyökér vagy névtér, kiegyensúlyozatlan jelölés,
// vagy hiányzó kötelező mező átmenne; ha a PDF kódolását találgatnánk.
describe("the Számlázz.hu invoice message", () => {
  it("reads the fields the pairing uses, through the nested address", () => {
    const message = parseSzamlabe(szamlabe());
    assert.deepEqual(
      {
        ...message,
        pdf: message.pdf ? "present" : null,
      },
      {
        id: "98765",
        szamlaszam: "E-KBOSS-2026-1234",
        kelt: "2026-09-28",
        devizanem: "HUF",
        brutto: "12700.0",
        szallitoNev: "KBOSS.hu Kft.",
        szallitoAdoszam: "13421739-2-41",
        vevoNev: "Acropora Kft.",
        vevoAdoszam: "23916229-2-42",
        vevoAdoszamEu: null,
        teszt: false,
        sztornozott: false,
        pdf: "present",
      },
    );
  });

  /**
   * AMIT AZ XSD MEGENGED, AZ NEM BUKTATJA EL AZ ÜZENETET (acrobot 25807, éles
   * hiba 2026-10-01 15:00 UTC: két bejövő számla „a devizanem nem háromjegyű kód”
   * miatt 400-at kapott). A devizanem `string`, a kelt `xs:date` (időzónával is).
   * MI PIROSÍT: ha a „Ft” vagy egy ismeretlen pénznem-szöveg, vagy egy időzónás
   * dátum az egész üzenetet elutasítaná; ha a forint nem HUF-ként menne tovább
   * (a párosító a terhelés pénznemével veti össze).
   */
  it("takes the currency and the date in every form the schema allows", () => {
    const read = (devizanem: string, kelt = "2026-09-28") =>
      parseSzamlabe(
        szamlabe()
          .replace(
            "<devizanem>HUF</devizanem>",
            `<devizanem>${devizanem}</devizanem>`,
          )
          .replace("<kelt>2026-09-28</kelt>", `<kelt>${kelt}</kelt>`),
      );
    assert.deepEqual(
      ["Ft", "ft.", "HUF", "Forint", "eur", "Euró"].map(
        (d) => read(d).devizanem,
      ),
      ["HUF", "HUF", "HUF", "HUF", "EUR", "Euró"],
    );
    assert.deepEqual(
      ["2026-09-28+02:00", "2026-09-28Z", "2026-09-28"].map(
        (k) => read("Ft", k).kelt,
      ),
      ["2026-09-28", "2026-09-28", "2026-09-28"],
    );
  });

  it("refuses DOCTYPE, entities, a processing instruction, a foreign root or namespace, broken markup", () => {
    for (const bad of [
      `<!DOCTYPE x [<!ENTITY a "b">]>${szamlabe()}`,
      szamlabe().replace("<szamlabe ", "<?php x ?><szamlabe "),
      szamlabe().replace(/szamlabe/g, "valami"),
      szamlabe().replace("http://www.szamlazz.hu/szamlabe", "http://evil"),
      szamlabe().replace("</alap>", ""),
      szamlabe().replace("<szamlaszam>E-KBOSS-2026-1234</szamlaszam>", ""),
      szamlabe().replace("<kelt>2026-09-28</kelt>", "<kelt>tegnap</kelt>"),
      szamlabe().replace("<kelt>2026-09-28</kelt>", "<kelt>2026-02-31</kelt>"),
      szamlabe().replace(
        "<devizanem>HUF</devizanem>",
        "<devizanem> </devizanem>",
      ),
      szamlabe().replace("Acropora Kft.", "Acropora & Társa"),
    ])
      assert.equal(
        code(() => parseSzamlabe(bad)),
        "parse",
        bad.slice(0, 60),
      );
  });

  it("the outgoing invoice: its id and number; a tree reader that takes CDATA and comments", () => {
    const ki = szamlabe()
      .replace(/szamlabe/g, "szamla")
      .replace(
        "<szamlaszam>E-KBOSS-2026-1234</szamlaszam>",
        "<szamlaszam><![CDATA[ACR-2026-77]]></szamlaszam><!-- x -->",
      );
    assert.deepEqual(parseSzamlaKi(ki), {
      id: "98765",
      szamlaszam: "ACR-2026-77",
    });
    assert.equal(parseXmlTree("<a><b>1</b></a>").children[0]?.text, "1");
  });

  it("the PDF only when its base64 decodes to a PDF; anything else is not guessed", () => {
    assert.deepEqual(pdfFromField(PDF.toString("base64")), PDF);
    assert.equal(pdfFromField(Buffer.from("<html>").toString("base64")), null);
    assert.equal(pdfFromField("https://szamlazz.hu/pdf/1"), null);
    assert.equal(pdfFromField(null), null);
  });

  it("the replies give back the id, or the code", () => {
    assert.match(
      feedReply("szamlabevalasz", { id: "98765" }),
      /<szamlabevalasz xmlns="http:\/\/www\.szamlazz\.hu\/szamlabevalasz"><alap><id>98765<\/id><\/alap><\/szamlabevalasz>/,
    );
    assert.match(
      feedReply("nyugtavalasz", { hibakod: "KEY_ERR" }),
      /<hibakod>KEY_ERR<\/hibakod>/,
    );
    assert.doesNotMatch(feedReply("nyugtavalasz", { id: "1" }), /<id>/);
  });
});

const KEY = "proba-kulcs-ACROS";
const live = {
  SZAMLAZZ_BANKTRANZ_KEY: KEY,
  SZAMLAZZ_SZAMLABE_MODE: "live",
  SZAMLAZZ_SZAMLAKI_MODE: "live",
  SZAMLAZZ_NYUGTA_MODE: "live",
};

function setup(
  env: NodeJS.ProcessEnv = live,
  opts: { known?: boolean; seen?: boolean; stored?: FeedStoreOutcome } = {},
) {
  const raw: string[] = [];
  const invoices: FeedInvoiceInput[] = [];
  const projected: { externalId: string; documentNumber: string }[] = [];
  const incoming: { externalId: string; documentNumber: string }[] = [];
  const contentShas: (string | null | undefined)[] = [];
  const order: string[] = [];
  const repository = {
    projectIncoming: async (input: {
      externalId: string;
      contentSha256?: string | null;
      projection: { documentNumber: string };
    }) => {
      order.push("projectIncoming");
      contentShas.push(input.contentSha256);
      incoming.push({
        externalId: input.externalId,
        documentNumber: input.projection.documentNumber,
      });
      return "PROJECTED";
    },
    projectOutgoing: async (input: {
      externalId: string;
      projection: { documentNumber: string };
    }) => {
      projected.push({
        externalId: input.externalId,
        documentNumber: input.projection.documentNumber,
      });
      return "PROJECTED";
    },
    storeRaw: async (input: { kind: string; externalId: string }) => {
      raw.push(`${input.kind}:${input.externalId.slice(0, 12)}`);
      return opts.stored ?? (opts.seen ? "SEEN" : "NEW");
    },
    hasContent: async () => opts.known ?? false,
    storeInvoice: async (input: FeedInvoiceInput) => {
      order.push("storeInvoice");
      invoices.push(input);
      return { id: "doc-1" };
    },
  } as unknown as SzamlazzFeedsRepository;
  return {
    service: new SzamlazzFeedsService(repository, env),
    raw,
    invoices,
    projected,
    incoming,
    contentShas,
    order,
  };
}

// MI PIROSÍT: ha kikapcsolva vagy rossz kulccsal írna; ha a bejövő számla nem
// jutna a Hiányzó számlák közé PDF-fel, bruttóval, vevővel; ha egy újraküldés,
// egy teszt- vagy sztornózott számla, vagy egy már meglévő fájl is bekerülne; ha
// a kimenő számla és a nyugta nem tárolódna; ha egy olvashatatlan üzenet íródna.
describe("SzamlazzFeedsService", () => {
  it("off unless switched on and keyed: 404; a wrong key: KEY_ERR; nothing stored", async () => {
    for (const env of [
      {},
      { ...live, SZAMLAZZ_SZAMLABE_MODE: "off" },
      { ...live, SZAMLAZZ_BANKTRANZ_KEY: "" },
    ]) {
      const { service, raw } = setup(env);
      assert.equal(
        (await service.receive("SZAMLABE", KEY, szamlabe())).status,
        404,
      );
      assert.deepEqual(raw, []);
    }
    const { service, raw } = setup();
    const wrong = await service.receive("SZAMLABE", `${KEY}x`, szamlabe());
    assert.deepEqual(
      [wrong.status, /KEY_ERR/.test(wrong.body), raw],
      [200, true, []],
    );
  });

  it("an incoming invoice: stored raw, and into Missing invoices with its PDF, gross and payee", async () => {
    const { service, raw, invoices } = setup();
    const reply = await service.receive("SZAMLABE", KEY, szamlabe());
    assert.deepEqual(
      [reply.status, /<id>98765<\/id>/.test(reply.body), raw],
      [200, true, ["SZAMLABE:98765"]],
    );
    assert.deepEqual(
      {
        ...invoices[0],
        content: invoices[0]?.content.subarray(0, 5).toString(),
        sha256: typeof invoices[0]?.sha256,
      },
      {
        externalId: "98765",
        fileName: "E-KBOSS-2026-1234.pdf",
        content: "%PDF-",
        sha256: "string",
        receivedAt: new Date("2026-09-28T00:00:00Z"),
        payee: "COMPANY",
        textReading: {
          invoiceNumber: "E-KBOSS-2026-1234",
          numberFrom: "SZAMLAZZ",
          supplierTaxNumber: "13421739-2-41",
          supplierName: "KBOSS.hu Kft.",
          gross: "12700.0",
          currency: "HUF",
        },
      },
    );
  });

  /**
   * AZ ÉLES ESET (acrobot 25807): a „Ft” pénznemű bejövő számla 400 helyett
   * nyugtázva (az azonosítóval), és HUF-ként kerül a Hiányzó számlák közé. A
   * valóban hibás üzenet továbbra is 400, és semmi nem íródik.
   */
  it("a forint written as Ft is answered and goes in as HUF; a broken message is still 400", async () => {
    const ft = setup();
    const ok = await ft.service.receive(
      "SZAMLABE",
      KEY,
      szamlabe().replace(
        "<devizanem>HUF</devizanem>",
        "<devizanem>Ft</devizanem>",
      ),
    );
    assert.deepEqual(
      [ok.status, /<id>98765<\/id>/.test(ok.body), ft.raw.length],
      [200, true, 1],
    );
    assert.equal(
      (ft.invoices[0]?.textReading as { currency?: string }).currency,
      "HUF",
    );
    const broken = setup();
    const bad = await broken.service.receive(
      "SZAMLABE",
      KEY,
      szamlabe().replace("<devizanem>HUF</devizanem>", ""),
    );
    assert.deepEqual([bad.status, broken.raw, broken.invoices], [400, [], []]);
  });

  /**
   * A KIMENŐ SZÁMLA A SZÁMLÁZÁS LISTÁJÁBA (acrobot 25812). MI PIROSÍT: ha az
   * új (vagy új változatú) kimenő számla nem vetülne; ha egy már ismert tartalom
   * újra; ha egy vetíthetetlen, de tárolható üzenet a fogadást buktatná el (a
   * Számlázz.hu akkor 72 órán át újraküldené).
   */
  it("an outgoing invoice goes to the billing list; a known one does not; an unprojectable one is still answered", async () => {
    const ki = szamlabe().replace(/szamlabe/g, "szamla");
    const fresh = setup();
    await fresh.service.receive("SZAMLAKI", KEY, ki);
    assert.deepEqual(fresh.projected, [
      { externalId: "98765", documentNumber: "E-KBOSS-2026-1234" },
    ]);

    const version = setup(live, { stored: "NEW_VERSION" });
    await version.service.receive("SZAMLAKI", KEY, ki);
    assert.equal(version.projected.length, 1);

    const seen = setup(live, { seen: true });
    await seen.service.receive("SZAMLAKI", KEY, ki);
    assert.deepEqual(seen.projected, []);

    const half = setup();
    const reply = await half.service.receive(
      "SZAMLAKI",
      KEY,
      ki.replace("<nev>Acropora Kft.</nev>", "<nev></nev>"),
    );
    assert.deepEqual(
      [
        reply.status,
        /<id>98765<\/id>/.test(reply.body),
        half.raw.length,
        half.projected,
      ],
      [200, true, 1, []],
    );
  });

  /**
   * A BEJÖVŐ SZÁMLA A SZÁMLÁZÁS „BEJÖVŐ” NÉZETÉBE (acrobot 25869, A szelet). MI
   * PIROSÍT: ha a vetítés a forrás-dokumentum (a PDF) tárolása ELŐTT futna
   * (akkor az első változatnak nem lenne PDF-je); ha egy új változat nem
   * frissítené, vagy egy újraküldött igen; ha a teszt-számla vetülne; ha egy nem
   * vetíthető számla a Számlázz.hu válaszát is elrontaná.
   */
  it("an incoming invoice goes to the billing incoming view after its source; a new version too, a resent or test one not", async () => {
    const fresh = setup();
    await fresh.service.receive("SZAMLABE", KEY, szamlabe());
    assert.deepEqual(
      [fresh.incoming, fresh.order],
      [
        [{ externalId: "98765", documentNumber: "E-KBOSS-2026-1234" }],
        ["storeInvoice", "projectIncoming"],
      ],
    );

    const version = setup(live, { stored: "NEW_VERSION" });
    await version.service.receive("SZAMLABE", KEY, szamlabe());
    const seen = setup(live, { seen: true });
    await seen.service.receive("SZAMLABE", KEY, szamlabe());
    const test = setup();
    await test.service.receive("SZAMLABE", KEY, szamlabe({ teszt: "true" }));
    assert.deepEqual(
      [version.incoming.length, seen.incoming.length, test.incoming.length],
      [1, 0, 0],
    );

    const half = setup();
    const reply = await half.service.receive(
      "SZAMLABE",
      KEY,
      szamlabe().replace(
        "<totalossz><netto>10000</netto>",
        "<totalossz><netto>sok</netto>",
      ),
    );
    assert.deepEqual(
      [
        reply.status,
        /<id>98765<\/id>/.test(reply.body),
        half.invoices.length,
        half.incoming,
      ],
      [200, true, 1, []],
    );
  });

  it("the payee from the buyer's tax number, else from its name", async () => {
    const other = setup();
    await other.service.receive(
      "SZAMLABE",
      KEY,
      szamlabe({ vevoAdoszam: "12345678-2-41" }),
    );
    const byName = setup();
    await byName.service.receive(
      "SZAMLABE",
      KEY,
      szamlabe({ vevoAdoszam: "" }),
    );
    assert.deepEqual(
      [other.invoices[0]?.payee, byName.invoices[0]?.payee],
      ["NOT_COMPANY", "COMPANY"],
    );
  });

  /**
   * A MÁR MEGLÉVŐ FÁJL (7ff26bc9): a feed nem tárolja másodszor, de a vetítés
   * megkapja a tartalom lenyomatát, és arra a meglévő dokumentumra mutat. MI
   * PIROSÍT: ha a lenyomat nem a TÁROLT tartalomé (a PDF-é), hanem az egész
   * üzeneté, vagy egyáltalán nem megy át: akkor a sornak nincs forrása.
   */
  it("a file we already have is not stored again, and the projection gets its content hash", async () => {
    const pdfSha = createHash("sha256").update(PDF).digest("hex");
    for (const known of [false, true]) {
      const { service, invoices, contentShas } = setup(live, { known });
      await service.receive("SZAMLABE", KEY, szamlabe());
      assert.equal(invoices.length, known ? 0 : 1);
      assert.deepEqual(contentShas, [pdfSha]);
      if (!known) assert.equal(invoices[0]!.sha256, pdfSha);
    }
  });

  it("a resent, a test or a storno invoice, or a file we have, does not go in", async () => {
    for (const [opts, body] of [
      [{ seen: true }, szamlabe()],
      [{}, szamlabe({ teszt: "true" })],
      [
        {},
        szamlabe({ extra: "" }).replace(
          "</teszt></alap>",
          "</teszt><sztornozott>true</sztornozott></alap>",
        ),
      ],
      [{ known: true }, szamlabe()],
    ] as const) {
      const { service, invoices } = setup(live, opts);
      assert.equal((await service.receive("SZAMLABE", KEY, body)).status, 200);
      assert.deepEqual(invoices, []);
    }
  });

  /**
   * EGY ÚJ VÁLTOZAT UGYANARRÓL A SZÁMLÁRÓL (acrobot 25781): a Számlázz.hu a
   * fizetési állapot vagy egy mező változása után ugyanazzal az azonosítóval
   * küldi újra. MI PIROSÍT: ha a változat második dokumentumként a Hiányzó
   * számlák közé kerülne (a számla kétszer állna a jelöltek között); ha a
   * Számlázz.hu nem kapná vissza az azonosítót (akkor újraküldené).
   */
  it("a new version of the same invoice is answered, and does not go in a second time", async () => {
    const { service, invoices } = setup(live, { stored: "NEW_VERSION" });
    const reply = await service.receive("SZAMLABE", KEY, szamlabe());
    assert.equal(reply.status, 200);
    assert.match(reply.body, /<id>98765<\/id>/);
    assert.deepEqual(invoices, []);
  });

  it("a pdf field that is not a base64 PDF: the XML itself is the content", async () => {
    const { service, invoices } = setup();
    await service.receive(
      "SZAMLABE",
      KEY,
      szamlabe({ pdf: "<pdf>https://szamlazz.hu/x</pdf>" }),
    );
    assert.deepEqual(
      [invoices[0]?.fileName, invoices[0]?.content.subarray(0, 5).toString()],
      ["E-KBOSS-2026-1234.xml", "<?xml"],
    );
  });

  it("the outgoing invoice and the receipt are stored raw; an unreadable message is 400 and not stored", async () => {
    const { service, raw, invoices } = setup();
    const ki = await service.receive(
      "SZAMLAKI",
      KEY,
      szamlabe().replace(/szamlabe/g, "szamla"),
    );
    const nyugta = await service.receive(
      "NYUGTA",
      KEY,
      "<nyugta><id>1</id></nyugta>",
    );
    const broken = await service.receive(
      "NYUGTA",
      KEY,
      "<nyugta><id>1</nyugta>",
    );
    assert.deepEqual(
      [
        ki.status,
        /<id>98765<\/id>/.test(ki.body),
        nyugta.status,
        broken.status,
        raw.length,
        raw[0],
        invoices,
      ],
      [200, true, 200, 400, 2, "SZAMLAKI:98765", []],
    );
  });
});

/*
  A VETÍTÉS FORRÁSA AZONOS TARTALOMNÁL (TEA E-SI-2026-51598, élesen mérve
  2026-10-05). MI PIROSÍT: ha a legkorábbi, de begyűjtött másolatot választja,
  holott ugyanez a tartalom más úton is megvan -- azt a jelölt-összerakó
  kihagyja, és a forrás egyetlen jelöltben sem állna.
*/
describe("preferredSameContentSource", () => {
  it("the copy the matcher keeps, not the earliest collected one; only collected: the earliest", () => {
    const mail = { id: "gyujtott", origin: "COLLECTED_MAIL" };
    const drive = { id: "drive", origin: "COLLECTED_DRIVE" };
    const upload = { id: "feltoltes", origin: "UPLOAD" };
    const mailbox = { id: "postafiok", origin: "MAILBOX" };
    assert.equal(preferredSameContentSource([mail, upload])?.id, "feltoltes");
    assert.equal(
      preferredSameContentSource([mail, drive, mailbox, upload])?.id,
      "postafiok",
    );
    assert.equal(preferredSameContentSource([drive, mail])?.id, "drive");
    assert.equal(preferredSameContentSource([]), null);
  });
});
