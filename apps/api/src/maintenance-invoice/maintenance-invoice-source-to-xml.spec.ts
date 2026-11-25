import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import { buildSzamlazzAgentInvoiceXml } from "../integrations/szamlazz/szamlazz-agent-xml.js";
import {
  maintenanceInvoiceXmlInputFrom,
  type MaintenanceInvoiceCertificateSource,
} from "./maintenance-invoice-xml-input.js";

/**
 * A FORRÁS-SOR -> A SZÁMLÁZZ.HU TÉTELÉNEK MEZŐI, A KÉSZ XML-BEN (barracuda L8, acrobot 61289, kártya 4a59885d): a teljesítési
 * igazolás sora (így tárolja a szerviz munka és a megrendelés: mennyiség = alkalom, egységár = egy alkalom díja, az egység
 * "alkalom" vagy a tétel egysége) végigmegy a leképezésen ÉS az XML-építőn, és a `<tetel>` mezőit olvassuk vissza: mennyiseg,
 * mennyisegiEgyseg, nettoEgysegar, afakulcs, nettoErtek. Eddig a leképezést kézzel épített tétellel, az XML-t egy másik specben
 * csak a nevek sorrendjével néztük, tehát a kettő közötti szakadást egyik sem fogta volna meg. MI PIROSÍT: ha a mennyiség 1-re
 * vagy más számra vált; ha az egységár a sorösszeg lesz; ha az egység "db"-ra esik az igazolás "alkalom"-ja vagy m2-e helyett; ha
 * az ÁFA-kulcs elmarad vagy más; ha a sorösszeg nem a TIG kerekített sorösszege.
 */
const base = (
  items: MaintenanceInvoiceCertificateSource["items"],
): MaintenanceInvoiceCertificateSource => ({
  number: "TI-2026-009",
  issuedAt: new Date("2026-11-19T00:00:00.000Z"),
  serviceJob: {
    customer: {
      id: "customer-1",
      displayName: "Fővárosi Állatkert",
      taxNumber: "12345678-2-42",
      paymentDueDays: null,
      addresses: [
        {
          line1: "Állatkerti körút 6-12.",
          line2: null,
          postalCode: "1146",
          city: "Budapest",
        },
      ],
    },
  },
  items,
});

/** A kész XML egyetlen tételének mezői. */
function tetelOf(xml: string): Record<string, string> {
  const tetel = /<tetel>([\s\S]*?)<\/tetel>/.exec(xml)?.[1];
  assert.ok(tetel, "nincs <tetel> az XML-ben");
  return Object.fromEntries(
    [...tetel.matchAll(/<(\w+)>([^<]*)<\/\1>/g)].map((m) => [m[1]!, m[2]!]),
  );
}

const xmlOf = (items: MaintenanceInvoiceCertificateSource["items"]) =>
  tetelOf(
    buildSzamlazzAgentInvoiceXml({
      ...maintenanceInvoiceXmlInputFrom(base(items)).xmlInput,
      agentKey: "teszt-kulcs",
      previewOnly: true,
    }),
  );

const D = (value: string | number) => new Prisma.Decimal(value);

describe("a TIG sora a kész XML tételében", () => {
  it("2 alkalom x 450 000: mennyiség 2, alkalom, 450 000 egységár, 27%, 900 000 nettó (a mai Luca-eset)", () => {
    const tetel = xmlOf([
      {
        description: "Cápasuli középső medence",
        quantity: D(2),
        unitNet: D("450000"),
        vatRatePercent: D(27),
        quantityUnit: "alkalom",
      },
    ]);
    assert.deepEqual(
      [
        tetel.mennyiseg,
        tetel.mennyisegiEgyseg,
        tetel.nettoEgysegar,
        tetel.afakulcs,
        tetel.nettoErtek,
      ],
      ["2", "alkalom", "450000", "27", "900000"],
    );
  });

  it("a régi, egység nélküli sor (nincs tárolt egység) az igazolás szerint alkalom, 1-es mennyiségnél is", () => {
    for (const quantity of [1, 2]) {
      const tetel = xmlOf([
        {
          description: "Akvárium karbantartás",
          quantity: D(quantity),
          unitNet: D("15000"),
          vatRatePercent: D(27),
        },
      ]);
      assert.equal(tetel.mennyiseg, String(quantity));
      assert.equal(tetel.mennyisegiEgyseg, "alkalom");
      assert.equal(tetel.nettoEgysegar, "15000");
    }
  });

  it("tört egységár és több mennyiség: az egységár tizedesekkel, a mennyiség és az egység a TIG-é, a nettó a kerekített sorösszeg", () => {
    const tetel = xmlOf([
      {
        description: "Üvegtisztítás",
        quantity: D(3),
        unitNet: D("3333.3333"),
        vatRatePercent: D(27),
        quantityUnit: "m2",
      },
    ]);
    assert.deepEqual(
      [
        tetel.mennyiseg,
        tetel.mennyisegiEgyseg,
        tetel.nettoEgysegar,
        tetel.afakulcs,
        tetel.nettoErtek,
      ],
      ["3", "m2", "3333.3333", "27", "10000"],
    );
  });

  it("tört mennyiség és más ÁFA-kulcs változatlanul megy", () => {
    const tetel = xmlOf([
      {
        description: "Víz",
        quantity: D("0.125"),
        unitNet: D("8000"),
        vatRatePercent: D(5),
        quantityUnit: "kg",
      },
    ]);
    assert.deepEqual(
      [
        tetel.mennyiseg,
        tetel.mennyisegiEgyseg,
        tetel.nettoEgysegar,
        tetel.afakulcs,
        tetel.nettoErtek,
      ],
      ["0.125", "kg", "8000", "5", "1000"],
    );
  });
});
