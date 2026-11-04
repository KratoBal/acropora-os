import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  computeCertificateLineAmounts,
  wholeForintCertificateAmounts,
} from "./completion-certificate-amounts.js";
import {
  planPartnerOrderCertificate,
  remainingByItem,
  type CertifiedLineInput,
  type OrderLineInput,
} from "./partner-order-certificate-plan.js";

/**
 * A MEGRENDELÉS TIG-JÉNEK TERVE (Megrendelések S2). MI PIROSÍT: ha a hátralévőnél
 * több, nulla, negatív vagy rossz alakú mennyiség átmegy; ha egy idegen vagy
 * ismételt tétel átmegy; ha a kérés nélküli terv a teljesített tételt is viszi;
 * ha a részletekre bontott tétel TIG-jeinek nettó összege nem forintra egyezik
 * az ajánlat sorával (acrobot 42206, A).
 */
const D = (v: string | number) => new Prisma.Decimal(v);
const order: OrderLineInput[] = [
  {
    quoteItemId: "qi-1",
    name: "Üvegtisztítás",
    quantity: D("3"),
    unit: "m2",
    unitNet: D("3333.3333"),
    vatRatePercent: D("27"),
  },
  {
    quoteItemId: "qi-2",
    name: "Karbantartás",
    quantity: D("1"),
    unit: "alkalom",
    unitNet: D("15000"),
    vatRatePercent: D("27"),
  },
];
const net = (quantity: Prisma.Decimal, unitNet: Prisma.Decimal) =>
  wholeForintCertificateAmounts(
    computeCertificateLineAmounts({
      quantity,
      unitPrice: unitNet,
      vatRatePercent: 0,
    }),
    0,
  ).netAmount;

describe("a megrendelés TIG-jének terve", () => {
  it("kérés nélkül minden tétel a teljes hátralévővel megy, lezáróként", () => {
    const plan = planPartnerOrderCertificate({ order, certified: [] });
    assert.ok(plan.ok);
    assert.deepEqual(
      plan.lines.map((l) => [
        l.quoteItemId,
        l.quantity.toString(),
        l.quantityUnit,
        l.closing,
      ]),
      [
        ["qi-1", "3", "m2", true],
        ["qi-2", "1", "alkalom", true],
      ],
    );
  });

  it("a teljesített tétel kimarad, és ha minden kész, nincs mit igazolni", () => {
    const certified: CertifiedLineInput[] = [
      {
        quoteItemId: "qi-2",
        quantity: D("1"),
        unitNet: D("15000"),
        vatRatePercent: D("27"),
      },
    ];
    const plan = planPartnerOrderCertificate({ order, certified });
    assert.ok(plan.ok);
    assert.deepEqual(
      plan.lines.map((l) => l.quoteItemId),
      ["qi-1"],
    );
    const kesz = planPartnerOrderCertificate({
      order,
      certified: [
        ...certified,
        {
          quoteItemId: "qi-1",
          quantity: D("3"),
          unitNet: D("3333.3333"),
          vatRatePercent: D("27"),
        },
      ],
    });
    assert.deepEqual(kesz, { ok: false, error: { code: "NOTHING_REMAINING" } });
  });

  it("a részmennyiség az ajánlat egységárával megy, nem lezáróként; vesszőt is elfogad", () => {
    const plan = planPartnerOrderCertificate({
      order,
      certified: [],
      request: [{ quoteItemId: "qi-1", quantity: "1,5" }],
    });
    assert.ok(plan.ok);
    const [line] = plan.lines;
    assert.equal(line!.quantity.toString(), "1.5");
    assert.equal(line!.unitNet.toString(), "3333.3333");
    assert.equal(line!.closing, false);
  });

  it("a rossz kérést a tétel nevével utasítja el", () => {
    const rossz = (quoteItemId: string, quantity: string) =>
      planPartnerOrderCertificate({
        order,
        certified: [],
        request: [{ quoteItemId, quantity }],
      });
    assert.deepEqual(rossz("qi-1", "3.5"), {
      ok: false,
      error: {
        code: "OVER_REMAINING",
        name: "Üvegtisztítás",
        requested: "3.5",
        remaining: "3",
      },
    });
    for (const q of ["0", "0,0", "-1", "", "1.2345678", "egy"])
      assert.deepEqual(
        rossz("qi-1", q),
        {
          ok: false,
          error: { code: "INVALID_QUANTITY", name: "Üvegtisztítás" },
        },
        q,
      );
    assert.deepEqual(rossz("qi-x", "1"), {
      ok: false,
      error: { code: "UNKNOWN_ITEM", quoteItemId: "qi-x" },
    });
    assert.deepEqual(
      planPartnerOrderCertificate({
        order,
        certified: [],
        request: [
          { quoteItemId: "qi-2", quantity: "1" },
          { quoteItemId: "qi-2", quantity: "1" },
        ],
      }),
      { ok: false, error: { code: "DUPLICATE_ITEM", name: "Karbantartás" } },
    );
  });

  it("a hátralévő a TIG-sorokból számolt", () => {
    const left = remainingByItem(order, [
      {
        quoteItemId: "qi-1",
        quantity: D("1.25"),
        unitNet: D("1"),
        vatRatePercent: D("27"),
      },
      {
        quoteItemId: "qi-1",
        quantity: D("0.75"),
        unitNet: D("1"),
        vatRatePercent: D("27"),
      },
    ]);
    assert.equal(left.get("qi-1")!.toString(), "1");
    assert.equal(left.get("qi-2")!.toString(), "1");
  });

  it("bármilyen részletekre bontva a TIG-ek nettója forintra az ajánlat sora (A döntés)", () => {
    const esetek: [string, string, string[]][] = [
      ["3", "3333.3333", ["1", "1", "1"]],
      ["3", "3333.3333", ["1.5", "1.5"]],
      ["10", "999.99", ["3", "3", "3", "1"]],
      ["7", "1428.5714", ["0.5", "2.25", "4.25"]],
      ["2.5", "4999.5", ["0.333333", "2.166667"]],
      ["1000", "12.3456", ["333", "333", "334"]],
    ];
    for (const [qty, unit, parts] of esetek) {
      const line: OrderLineInput = {
        quoteItemId: "qi",
        name: "T",
        quantity: D(qty),
        unit: "db",
        unitNet: D(unit),
        vatRatePercent: D("27"),
      };
      const certified: CertifiedLineInput[] = [];
      for (const part of parts) {
        const plan = planPartnerOrderCertificate({
          order: [line],
          certified,
          request: [{ quoteItemId: "qi", quantity: part }],
        });
        assert.ok(plan.ok, `${qty} x ${unit}: ${part}`);
        const planned = plan.lines[0]!;
        certified.push({
          quoteItemId: "qi",
          quantity: planned.quantity,
          unitNet: planned.unitNet,
          vatRatePercent: planned.vatRatePercent,
        });
      }
      const osszes = certified.reduce(
        (sum, c) => sum.plus(net(c.quantity, c.unitNet)),
        D(0),
      );
      assert.equal(
        osszes.toString(),
        net(D(qty), D(unit)).toString(),
        `${qty} x ${unit} = ${parts.join(" + ")}`,
      );
      assert.equal(
        remainingByItem([line], certified).get("qi")!.toString(),
        "0",
      );
    }
  });
});
