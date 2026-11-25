import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PARTNER_TODO_ITEMS, partnerTodosOf } from "./partner-overview.js";

/*
  A PARTNER TEENDŐI (kártya 28f31715). MI PIROSÍT: egy ki nem küldött munkalap teendőnek számít (a partner nem tudná aláírni); az
  aláírt példánnyal már rendelkező igazolás vagy az aláírt, visszavont megrendelőlap teendő; feltöltési jog nélkül is teendőt
  mutat; a darabszám csak a megjelenített ötöt számolja; a link nem az adatlapra visz.
*/
const ws = (n: number, status: string, sentForSignature?: boolean) => ({
  id: `ws_${n}`,
  number: `M-${n}`,
  subject: ` Szivattyú ${n} `,
  status,
  sentForSignature,
});

describe("a partner teendői", () => {
  it("munkalap: csak az aláírásra kiküldött; a szám, a tárgy és a link az adatlapra", () => {
    const overview = partnerTodosOf({
      worksheets: [
        ws(1, "AWAITING_SIGNATURE", true),
        ws(2, "AWAITING_SIGNATURE", false),
        ws(3, "AWAITING_SIGNATURE"),
        ws(4, "SIGNED", true),
      ],
      certificates: [],
      maintenanceOrders: [],
      canUploadSignedCertificate: true,
      canUploadSignedMaintenanceOrder: true,
    });
    assert.deepEqual(overview.todos, [
      {
        kind: "WORKSHEET_SIGNATURE",
        label: "Aláírásra váró munkalap",
        count: 1,
        items: [
          { id: "ws_1", title: "M-1 · Szivattyú 1", href: "/munkalapok/ws_1" },
        ],
        listHref: "/munkalapok",
      },
    ]);
  });

  it("igazolás és megrendelőlap: aláírt példány nélkül, kiállítva, és csak feltöltési joggal", () => {
    const input = {
      worksheets: [],
      certificates: [
        { id: "tig_1", number: "TIG-1", hasSignedDocument: false },
        { id: "tig_2", number: "TIG-2", hasSignedDocument: true },
      ],
      maintenanceOrders: [
        {
          id: "mo_1",
          number: "MR-1",
          contractTitle: "Karbantartás",
          status: "ISSUED",
        },
        {
          id: "mo_2",
          number: "MR-2",
          contractTitle: "Karbantartás",
          status: "SIGNED",
        },
        {
          id: "mo_3",
          number: "MR-3",
          contractTitle: "Karbantartás",
          status: "REVOKED",
        },
      ],
    };
    const may = partnerTodosOf({
      ...input,
      canUploadSignedCertificate: true,
      canUploadSignedMaintenanceOrder: true,
    });
    assert.deepEqual(
      may.todos.map((g) => [g.kind, g.count, g.items.map((i) => i.href)]),
      [
        ["CERTIFICATE_SIGNED_COPY", 1, ["/teljesitesi-igazolasok/tig_1"]],
        ["MAINTENANCE_ORDER_SIGNED_COPY", 1, ["/megrendelesek/mo_1"]],
      ],
    );
    const mayNot = partnerTodosOf({
      ...input,
      canUploadSignedCertificate: false,
      canUploadSignedMaintenanceOrder: false,
    });
    assert.deepEqual(mayNot.todos, []);
  });

  // acrobot 61350: a "Válaszra vár" csak itt; a jegy felirata a 4/8 szerint "Feldolgozás alatt" marad
  it("hibajegy: a válaszra váró (WAITING_FOR_CUSTOMER) elöl, a darabszám a szerver teljes számából, a karbantartás a saját lapjára", () => {
    const overview = partnerTodosOf({
      tickets: [
        {
          id: "sj_1",
          jobNumber: "HJ-1",
          title: "Szivárog",
          status: "WAITING_FOR_CUSTOMER",
        },
        {
          id: "sj_2",
          jobNumber: "HJ-2",
          title: "Zajos",
          status: "IN_PROGRESS",
        },
        {
          id: "sj_3",
          jobNumber: "KB-3",
          title: "Negyedéves",
          status: "WAITING_FOR_CUSTOMER",
          kind: "MAINTENANCE",
        },
      ],
      waitingTicketCount: 4,
      worksheets: [ws(1, "AWAITING_SIGNATURE", true)],
      certificates: [],
      maintenanceOrders: [],
      canUploadSignedCertificate: false,
      canUploadSignedMaintenanceOrder: false,
    });
    assert.deepEqual(
      overview.todos.map((g) => [
        g.kind,
        g.label,
        g.count,
        g.items.map((i) => i.href),
      ]),
      [
        [
          "TICKET_REPLY",
          "Válaszra váró hibajegy",
          4,
          ["/hibajegyek/sj_1", "/karbantartas/sj_3"],
        ],
        [
          "WORKSHEET_SIGNATURE",
          "Aláírásra váró munkalap",
          1,
          ["/munkalapok/ws_1"],
        ],
      ],
    );
  });

  it("a darabszám mind, a tételek csak az első öt", () => {
    const overview = partnerTodosOf({
      worksheets: Array.from({ length: 7 }, (_, i) =>
        ws(i, "AWAITING_SIGNATURE", true),
      ),
      certificates: [],
      maintenanceOrders: [],
      canUploadSignedCertificate: false,
      canUploadSignedMaintenanceOrder: false,
    });
    assert.equal(overview.todos[0]!.count, 7);
    assert.equal(overview.todos[0]!.items.length, PARTNER_TODO_ITEMS);
  });
});
