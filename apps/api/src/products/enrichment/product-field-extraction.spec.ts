import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AUTO_ACCEPT_FIELDS,
  PACK_FIELD,
} from "../knowledge/knowledge-auto-accept.js";
import {
  PRODUCT_FIELD_KEYS,
  productFieldAnswerOf,
  productFieldStatement,
  type ProductFieldAnswer,
} from "./product-field-extraction.js";

/*
  WHAT TURNS THIS RED (T4.4 S1b, card 8639ac2a). An anchor this page does not hold, or a value (the use; the maker's
  name, address, e-mail) its anchor does not hold, becoming a candidate; a cut address (no postcode, no place) passing;
  half a GPSR block (one company of two sound) becoming a value; two companies for one role, or two uses, both kept;
  the AI service's refusal or outage becoming a value; a refusal detail carrying page text into the note; the rule
  (AUTO_V1) able to accept either field without a person (acrobot 52443). Invented page text only.
*/
const PAGE = [
  "Kitalált Jód 100 ml",
  "Alkalmazás:   a tengeri akvárium jódszintjének pótlására szolgál.",
  "Kitalált Felelős AG, Hegyi út 21, CH-6331 Hünenberg, office@kitalalt.example",
  "Gyártás: Kitalált Gyártó GmbH, Példa utca 1, 12345 Mintaváros",
].join("\n");

type Item = Extract<ProductFieldAnswer, { kind: "ANSWER" }>["fields"][number];
const answer = (
  fields: Item[],
  refused: string[] = [],
): ProductFieldAnswer => ({
  kind: "ANSWER",
  fields,
  refused,
});
const use: Item = {
  field: "application",
  value: "a tengeri akvárium jódszintjének pótlására szolgál.",
  anchor: "Alkalmazás: a tengeri akvárium jódszintjének pótlására szolgál.",
};
const maker: Item = {
  field: "manufacturerInfo",
  role: "MAKER",
  name: "Kitalált Gyártó GmbH",
  address: "Példa utca 1, 12345 Mintaváros",
  email: null,
  anchor: "Kitalált Gyártó GmbH, Példa utca 1, 12345 Mintaváros",
};
const responsible: Item = {
  field: "manufacturerInfo",
  role: "RESPONSIBLE",
  name: "Kitalált Felelős AG",
  address: "Hegyi út 21, CH-6331 Hünenberg",
  email: "office@kitalalt.example",
  anchor:
    "Kitalált Felelős AG, Hegyi út 21, CH-6331 Hünenberg, office@kitalalt.example",
};

describe("az AI válaszának alakja", () => {
  it("csak az ismert mezők, szerepek és alakok jönnek át; a lapszöveg a megjegyzésbe nem", () => {
    const a = productFieldAnswerOf({
      fields: [
        { field: "application", value: "jódpótlás", anchor: "jódpótlás" },
        { ...maker, role: "DISTRIBUTOR" },
        { ...maker, role: undefined },
        { ...maker, address: null },
        { field: "dosing", value: "1 ml", anchor: "1 ml" },
      ],
      refusedFields: [
        {
          field: "application",
          refusal: "ANCHOR_NOT_IN_PAGE",
          detail: "anchor 12/22 U+006A",
        },
        { field: "application", refusal: "lapszöveg ide nem jöhet" },
        { field: "dosing", refusal: "VALUE_NOT_IN_ANCHOR" },
      ],
    });
    assert.deepEqual(a, {
      kind: "ANSWER",
      fields: [
        { field: "application", value: "jódpótlás", anchor: "jódpótlás" },
      ],
      refused: ["application ANCHOR_NOT_IN_PAGE anchor 12/22 U+006A"],
    });
    assert.deepEqual(productFieldAnswerOf({ refusal: "NOT_JSON" }), {
      kind: "REFUSED",
      refusal: "NOT_JSON",
    });
    assert.equal(productFieldAnswerOf(null).kind, "UNAVAILABLE");
    assert.equal(productFieldAnswerOf({ model: "x" }).kind, "UNAVAILABLE");
  });
});

describe("az OS saját ellenőrzése a lapon", () => {
  it("a használat és mindkét szerep: jelölt, a gyártó elöl, a horgonyok a kivonatban", () => {
    const s = productFieldStatement(answer([use, responsible, maker]), PAGE);
    assert.deepEqual(
      s.values.map((v) => [v.field, v.raw]),
      [
        ["application", "a tengeri akvárium jódszintjének pótlására szolgál."],
        [
          "manufacturerInfo",
          "Gyártó: Kitalált Gyártó GmbH, Példa utca 1, 12345 Mintaváros; Felelős: Kitalált Felelős AG, Hegyi út 21, CH-6331 Hünenberg, office@kitalalt.example",
        ],
      ],
    );
    assert.match(s.values[1]!.excerpt, /^AI-horgony = ".* \| .*"$/);
    assert.deepEqual(s.notes, []);
  });

  it("egy cég, de a lapon kettő áll: az érték megvan, és a megjegyzés megnevezi a különbséget", () => {
    const s = productFieldStatement(answer([maker]), PAGE);
    assert.equal(
      s.values[0]?.raw,
      "Gyártó: Kitalált Gyártó GmbH, Példa utca 1, 12345 Mintaváros",
    );
    assert.deepEqual(s.notes, [
      "termékmezők (AI): manufacturerInfo: a lapon 2 cég áll, a válasz 1-t nevez",
    ]);
  });

  it("a lapon nem álló horgony, a horgonyban nem álló rész, a csonka cím: nincs érték", () => {
    const s = productFieldStatement(
      answer([
        { ...use, value: "jódpótlás", anchor: "Alkalmazás: jódpótlás." },
        { ...maker, address: "Másik utca 2, 54321 Másikváros" },
      ]),
      PAGE,
    );
    assert.deepEqual(s.values, []);
    assert.deepEqual(s.notes, [
      "termékmezők (AI): application: a horgony nincs a lapon",
      "termékmezők (AI): manufacturerInfo: Gyártó: az érték nincs a horgonyban",
    ]);
    const cut = productFieldStatement(
      answer([
        {
          ...maker,
          address: "Példa utca 1",
          anchor: "Kitalált Gyártó GmbH, Példa utca 1",
        },
      ]),
      PAGE,
    );
    assert.deepEqual(cut.values, []);
    assert.deepEqual(cut.notes, [
      "termékmezők (AI): manufacturerInfo: Gyártó: a címben nincs irányítószám és település",
    ]);
  });

  // pilot-20, third run (card 8639ac2a), the two maker values as they came. WHAT TURNS THIS RED: a copyright line
  // passing as an address (its year looked like a postcode); the company name kept twice when the address repeats it.
  it("a copyright-sor nem cím; a címben megismételt cégnév nem duplázódik", () => {
    const red = "Red Sea © 2026 Red Sea. All rights reserved";
    const s = productFieldStatement(
      answer([
        {
          field: "manufacturerInfo",
          role: "RESPONSIBLE",
          name: "Red Sea",
          address: "© 2026 Red Sea. All rights reserved",
          email: null,
          anchor: red,
        },
      ]),
      red,
    );
    assert.deepEqual(s.values, []);
    assert.deepEqual(s.notes, [
      "termékmezők (AI): manufacturerInfo: Felelős: a cím egy copyright-sor",
    ]);
    const kz =
      "Korallenzucht.de Vertriebs GmbH Schlesierstr. 1 96237 Ebersdorf b. Coburg Deutschland info@korallen-zucht.de";
    const k = productFieldStatement(
      answer([
        {
          field: "manufacturerInfo",
          role: "MAKER",
          name: "Korallenzucht.de Vertriebs GmbH",
          address:
            "Korallenzucht.de Vertriebs GmbH Schlesierstr. 1 96237 Ebersdorf b. Coburg Deutschland",
          email: "info@korallen-zucht.de",
          anchor: kz,
        },
      ]),
      kz,
    );
    assert.equal(
      k.values[0]?.raw,
      "Gyártó: Korallenzucht.de Vertriebs GmbH, Schlesierstr. 1 96237 Ebersdorf b. Coburg Deutschland, info@korallen-zucht.de",
    );
  });

  // barracuda on #2560. WHAT TURNS THIS RED: a number in the company name read as the address's postcode.
  it("a cégnév száma nem irányítószám: a cím-alak a név levágása után áll", () => {
    const line = "Aqua 2000 GmbH, Fő utca 5";
    const s = productFieldStatement(
      answer([
        {
          field: "manufacturerInfo",
          role: "MAKER",
          name: "Aqua 2000 GmbH",
          address: "Aqua 2000 GmbH, Fő utca 5",
          email: null,
          anchor: line,
        },
      ]),
      line,
    );
    assert.deepEqual(s.values, []);
    assert.deepEqual(s.notes, [
      "termékmezők (AI): manufacturerInfo: Gyártó: a címben nincs irányítószám és település",
    ]);
  });

  // pilot-20 fourth run (card 8639ac2a), the two addresses as they came, and barracuda's corner on #2561. WHAT TURNS
  // THIS RED: a manager, a phone or a web address passing inside an address; "is located at" kept; a name alone, cut to
  // nothing, given back as the address.
  it("a cím csak utca, irányítószám, település és ország; a csak-cégnév nem cím", () => {
    const one = (name: string, address: string) => {
      const line = `${name}, ${address}`;
      return productFieldStatement(
        answer([
          {
            field: "manufacturerInfo",
            role: "RESPONSIBLE",
            name,
            address,
            email: null,
            anchor: line,
          },
        ]),
        line,
      );
    };
    for (const [name, address] of [
      [
        "Euro Corals",
        "Geschäftsführer: Ali Hussein Akil Ammar Passauer Straße 12 84359 Simbach am Inn DEUTSCHLAND Tel.: 08571 924 95 57",
      ],
      [
        "Blue Life USA",
        "is located at: 7831 ALABAMA AVE UNIT 12 CANOGA PARK CALIFORNIA 91304",
      ],
      ["Kitalált GmbH", "Példa utca 1, 12345 Mintaváros, www.kitalalt.example"],
    ] as const) {
      const s = one(name, address);
      assert.deepEqual(s.values, [], address);
      assert.deepEqual(
        s.notes,
        [
          "termékmezők (AI): manufacturerInfo: Felelős: a címben elérhetőség vagy cégadat is áll",
        ],
        address,
      );
    }
    const nameOnly = one("Aqua 2000 GmbH", "Aqua 2000 GmbH");
    assert.deepEqual(nameOnly.values, []);
    assert.deepEqual(nameOnly.notes, [
      "termékmezők (AI): manufacturerInfo: Felelős: a címben nincs irányítószám és település",
    ]);
    // a clean one still passes, words like "Webergasse" or "Telgte" are no contact data
    assert.equal(
      one("Kitalált GmbH", "Webergasse 3, 48291 Telgte, Deutschland").values
        .length,
      1,
    );
  });

  // barracuda on #90 and #2562. WHAT TURNS THIS RED: a dropped e-mail not said; a contact word in the company name
  // failing a clean address; a German register or representation label passing inside an address.
  it("az elejtett e-mail jegyzetet kap; a cégnév szava nem szennyezés; a német cégadat-címkék kiszűrve", () => {
    const one = (name: string, address: string, emailDropped = false) => {
      const line = `${name}, ${address}`;
      return productFieldStatement(
        answer([
          {
            field: "manufacturerInfo",
            role: "RESPONSIBLE",
            name,
            address,
            email: null,
            anchor: line,
            ...(emailDropped ? { emailDropped: true as const } : {}),
          },
        ]),
        line,
      );
    };
    const dropped = one(
      "Kitalált AG",
      "Rothusstrasse 21, CH-6331 Hünenberg",
      true,
    );
    assert.equal(dropped.values.length, 1);
    assert.deepEqual(dropped.notes, [
      "termékmezők (AI): manufacturerInfo: Felelős: az e-mail a lapon nem e-mail alakú, kimaradt",
    ]);
    assert.equal(
      one(
        "Aquaristik-Web GmbH",
        "Aquaristik-Web GmbH, Hauptstraße 1, 12345 Musterstadt",
      ).values.length,
      1,
    );
    for (const address of [
      "Geschäftsführung: Max Muster, Hauptstraße 1, 12345 Musterstadt",
      "Inhaber Max Muster, Hauptstraße 1, 12345 Musterstadt",
      "vertreten durch Max Muster, Hauptstraße 1, 12345 Musterstadt",
      "Hauptstraße 1, 12345 Musterstadt, Amtsgericht Musterstadt",
      "Hauptstraße 1, 12345 Musterstadt, HRA 1234",
      "Hauptstraße 1, 12345 Musterstadt, Mobil 0170 1234567",
    ])
      assert.deepEqual(one("Kitalált GmbH", address).values, [], address);
  });

  // barracuda on #2564. WHAT TURNS THIS RED: a phone carried in the company name into the value, or its note pointing at
  // the address; "Web" in a company's own name taken for contact data. (Known limit, not asserted: a town named "Tel …" fails the address filter.)
  it("a cégnévben álló telefon kiszűrve; a névben álló Web szó nem", () => {
    const one = (name: string, address: string) => {
      const line = `${name}, ${address}`;
      return productFieldStatement(
        answer([
          {
            field: "manufacturerInfo",
            role: "RESPONSIBLE",
            name,
            address,
            email: null,
            anchor: line,
          },
        ]),
        line,
      );
    };
    const phoneInName = one(
      "Euro Corals Tel.: 08571 924 95 57",
      "Euro Corals Tel.: 08571 924 95 57 Passauer Straße 12 84359 Simbach am Inn",
    );
    assert.deepEqual(phoneInName.values, []);
    // the note points at the name, not the address (barracuda on #2565): the address here is clean
    assert.deepEqual(phoneInName.notes, [
      "termékmezők (AI): manufacturerInfo: Felelős: a cégnévben elérhetőség áll",
    ]);
    assert.equal(
      one("Aquaristik-Web GmbH", "Hauptstraße 1, 12345 Musterstadt").values
        .length,
      1,
    );
  });

  it("fél GPSR-blokk nem érték: ha az egyik cég elbukik, a másik sem marad", () => {
    const s = productFieldStatement(
      answer([maker, { ...responsible, email: "sales@kitalalt.example" }]),
      PAGE,
    );
    assert.deepEqual(s.values, []);
    assert.deepEqual(s.notes, [
      "termékmezők (AI): manufacturerInfo: Felelős: az érték nincs a horgonyban",
    ]);
  });

  it("ha az AI egy céget elutasított, a megmaradt sem érték (fél GPSR-blokk)", () => {
    const s = productFieldStatement(
      answer([maker], ["manufacturerInfo VALUE_NOT_IN_ANCHOR"]),
      PAGE,
    );
    assert.deepEqual(s.values, []);
    assert.deepEqual(s.notes, [
      "termékmezők (AI): az AI őre elutasította (manufacturerInfo VALUE_NOT_IN_ANCHOR)",
      "termékmezők (AI): manufacturerInfo: az AI egy céget elutasított, a többi egyedül nem érték",
    ]);
  });

  it("két cég egy szerephez, két használat: egyik sem, a többi mező marad", () => {
    const s = productFieldStatement(
      answer([
        use,
        { ...use, value: "pótlására", anchor: "pótlására" },
        maker,
        { ...responsible, role: "MAKER" },
      ]),
      PAGE,
    );
    assert.deepEqual(s.values, []);
    assert.deepEqual(s.notes, [
      "termékmezők (AI): application kétszer, egyik sem",
      "termékmezők (AI): manufacturerInfo: egy szerephez két cég",
    ]);
    const keepsOther = productFieldStatement(
      answer([maker, responsible, use, { ...use }]),
      PAGE,
    );
    assert.deepEqual(
      keepsOther.values.map((v) => v.field),
      ["manufacturerInfo"],
    );
  });

  it("az AI elutasítása vagy kiesése nem érték", () => {
    assert.deepEqual(
      productFieldStatement({ kind: "REFUSED", refusal: "NOT_JSON" }, PAGE),
      {
        values: [],
        notes: ["termékmezők (AI): az AI őre elutasította (NOT_JSON)"],
      },
    );
    assert.deepEqual(
      productFieldStatement({ kind: "UNAVAILABLE", reason: "timeout" }, PAGE),
      { values: [], notes: ["termékmezők (AI): nem elérhető (timeout)"] },
    );
    assert.deepEqual(
      productFieldStatement(
        answer([], ["application ANCHOR_NOT_IN_PAGE"]),
        PAGE,
      ).notes,
      [
        "termékmezők (AI): az AI őre elutasította (application ANCHOR_NOT_IN_PAGE)",
      ],
    );
  });
});

describe("ember nélküli elfogadás", () => {
  // acrobot 52443: the maker block and the use are candidates only; a person accepts them
  it("az AUTO_V1 szabály egyik mezőt sem fogadhatja el", () => {
    for (const field of PRODUCT_FIELD_KEYS) {
      assert.equal(
        (AUTO_ACCEPT_FIELDS as readonly string[]).includes(field),
        false,
        field,
      );
      assert.notEqual(PACK_FIELD, field);
    }
  });
});
