import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MedusaOrderOverviewRow } from "../../integrations/medusa/medusa-admin.client.js";
import {
  NO_FACTS,
  applyFilters,
  countersOf,
  inView,
  isStale,
  matchesSearch,
  paymentMethodLabel,
  paymentStateOf,
  sortItems,
  stageOf,
  toListItem,
} from "./webshop-orders.rules.js";

/*
  A WEBSHOP RENDELÉSLISTA SZABÁLYAI (Balázs, 2026-10-05). MI PIROSÍT: a zárolt
  kártyás fizetés levontnak vagy a részben visszatérített teljesen
  visszatérítettnek látszik; az elavulás egy perccel a küszöb előtt vagy a
  végállapotban is jelez; számla nélkül „Feladásra vár” lesz, vagy a bolti
  átvétel csomagot vár; a keresés a rendelésszámot részletben is egyezőnek
  veszi (a #3 a #38-at); az éjfél körüli rendelés a rossz napra esik; a
  számlálók a szűrt halmazon számolódnak.
*/
const NOW = new Date("2026-10-05T12:00:00.000Z");
const hoursAgo = (hours: number) =>
  new Date(NOW.getTime() - hours * 3_600_000).toISOString();

const row = (
  over: Partial<MedusaOrderOverviewRow> & { id: string },
): MedusaOrderOverviewRow => ({
  display_id: 38,
  created_at: "2026-10-05T10:00:00.000Z",
  total: 26390,
  email: "emese@example.hu",
  currency_code: "huf",
  customer_name: "Nagy Emese",
  phone: "+36 30 555 0137",
  business_status: {
    code: "confirmed",
    label: "Visszaigazolva",
    changed_at: hoursAgo(1),
  },
  shipping_method: "Foxpost csomagpont",
  pickup_point: { id: "HU1", name: "FOXPOST Allee" },
  payment: {
    provider_id: "pp_stripe_stripe",
    status: "authorized",
    amount: 26390,
    captured_amount: 0,
    refunded_amount: 0,
  },
  related_order: null,
  customer_signals: {
    is_new_customer: true,
    unsuccessful_closed_order_count: 0,
    has_other_open_order: false,
    purchased_without_registration: false,
  },
  ...over,
});
const item = (over: Partial<MedusaOrderOverviewRow> & { id: string }) =>
  toListItem(row(over), NO_FACTS, NOW);

describe("payment", () => {
  it("held, captured, partly and fully refunded, canceled, awaiting", () => {
    const of = (
      payment: Partial<NonNullable<MedusaOrderOverviewRow["payment"]>>,
    ) =>
      paymentStateOf({
        provider_id: "pp_stripe_stripe",
        status: "authorized",
        amount: 1000,
        captured_amount: 0,
        refunded_amount: 0,
        ...payment,
      });
    assert.deepEqual(
      [
        of({}),
        of({ status: "completed", captured_amount: 1000 }),
        of({
          status: "completed",
          captured_amount: 1000,
          refunded_amount: 350,
        }),
        of({
          status: "completed",
          captured_amount: 1000,
          refunded_amount: 1000,
        }),
        of({ status: "canceled" }),
        of({ status: "not_paid" }),
        paymentStateOf(null),
      ],
      [
        "AUTHORIZED",
        "CAPTURED",
        "PARTIALLY_REFUNDED",
        "REFUNDED",
        "CANCELED",
        "AWAITING",
        null,
      ],
    );
  });

  it("names only the providers it knows, and says the rest as they are", () => {
    assert.deepEqual(
      [
        paymentMethodLabel("pp_stripe_stripe"),
        paymentMethodLabel("pp_acropora_cod"),
        paymentMethodLabel("pp_system_default"),
        paymentMethodLabel(null),
      ],
      ["Stripe", "Utánvét", "Egyéb (pp_system_default)", null],
    );
  });
});

describe("stale", () => {
  it("at the threshold, not a minute before; never for a status without one", () => {
    assert.equal(isStale("pending_processing", hoursAgo(4), NOW), true);
    assert.equal(
      isStale("pending_processing", hoursAgo(4 - 1 / 60), NOW),
      false,
    );
    assert.equal(isStale("stocking", hoursAgo(8), NOW), true);
    assert.equal(isStale("out_for_delivery", hoursAgo(71), NOW), false);
    assert.equal(isStale("confirmed", hoursAgo(500), NOW), false);
    assert.equal(isStale("closed", hoursAgo(500), NOW), false);
  });
});

describe("stage", () => {
  it("invoice before parcel; a shop pickup waits for no parcel", () => {
    const noInvoice = NO_FACTS;
    const invoiced = { invoiceNumber: "ACR-2026-1", hasParcel: false };
    const shipped = { invoiceNumber: "ACR-2026-1", hasParcel: true };
    assert.deepEqual(
      [
        stageOf("pending_processing", false, noInvoice),
        stageOf("confirmed", false, noInvoice),
        stageOf("stocking", false, invoiced),
        stageOf("stocking", true, invoiced),
        stageOf("stocking", false, shipped),
        stageOf("ready_for_pickup", true, invoiced),
        stageOf("out_for_delivery", false, noInvoice),
        stageOf(null, false, noInvoice),
      ],
      ["processing", "invoice", "dispatch", null, null, "pickup", null, null],
    );
  });

  it("a shop pickup is the seed's Bolti átvétel, nothing else", () => {
    assert.equal(
      item({ id: "a", shipping_method: "Bolti átvétel" }).shipping.storePickup,
      true,
    );
    assert.equal(
      item({ id: "b", shipping_method: "GLS csomagpont" }).shipping.storePickup,
      false,
    );
  });
});

describe("search and filters", () => {
  it("the order number whole, never a part of it; name, e-mail and phone digits", () => {
    const order = item({ id: "a", display_id: 38 });
    assert.deepEqual(
      [
        "#38",
        "38",
        "3",
        "nagy em",
        "EMESE@",
        "30 555 0137",
        "+36305550137",
        "555",
      ].map((q) => matchesSearch(order, q)),
      [true, true, false, true, true, true, true, false],
    );
  });

  it("the day is Budapest's: 22:30 UTC on the 4th is the 5th", () => {
    const late = item({ id: "late", created_at: "2026-10-04T22:30:00.000Z" });
    assert.deepEqual(
      [
        applyFilters([late], { from: "2026-10-05", to: "2026-10-05" }).length,
        applyFilters([late], { to: "2026-10-04" }).length,
      ],
      [1, 0],
    );
  });

  it("guest, new customer, invoice, payment state and the stale stage filter as named", () => {
    const items = [
      item({
        id: "guest",
        customer_signals: {
          ...row({ id: "x" }).customer_signals,
          purchased_without_registration: true,
          is_new_customer: false,
        },
      }),
      item({
        id: "stale",
        business_status: {
          code: "pending_processing",
          label: null,
          changed_at: hoursAgo(5),
        },
      }),
    ];
    const ids = (query: Parameters<typeof applyFilters>[1]) =>
      applyFilters(items, query).map((each) => each.id);
    assert.deepEqual(
      [
        ids({ customerType: "guest" }),
        ids({ customerType: "registered" }),
        ids({ newCustomer: true }),
        ids({ stage: "stale" }),
        ids({ invoice: "issued" }),
        ids({ paymentState: "AUTHORIZED" }).length,
      ],
      [["guest"], ["stale"], ["stale"], ["stale"], [], 2],
    );
  });
});

describe("view, counters and sort", () => {
  it("counters on the view, not on the filtered set; the open view hides the two terminals", () => {
    const items = [
      item({
        id: "p",
        business_status: {
          code: "pending_processing",
          label: null,
          changed_at: hoursAgo(5),
        },
      }),
      item({
        id: "c",
        business_status: {
          code: "confirmed",
          label: null,
          changed_at: hoursAgo(1),
        },
      }),
      item({
        id: "r",
        business_status: {
          code: "ready_for_pickup",
          label: null,
          changed_at: hoursAgo(1),
        },
      }),
      item({
        id: "done",
        business_status: {
          code: "closed",
          label: null,
          changed_at: hoursAgo(1),
        },
      }),
      item({
        id: "fail",
        business_status: {
          code: "closed_unsuccessfully",
          label: null,
          changed_at: hoursAgo(1),
        },
      }),
    ];
    const open = inView(items, "open");
    assert.deepEqual(
      open.map((each) => each.id),
      ["p", "c", "r"],
    );
    assert.equal(inView(items, "all").length, 5);
    assert.deepEqual(countersOf(open), {
      processing: 1,
      invoice: 1,
      dispatch: 0,
      pickup: 1,
      stale: 1,
    });
  });

  it("status sorts by the workflow order, equal keys by the newest first", () => {
    const items = [
      item({
        id: "old-stock",
        created_at: "2026-10-01T10:00:00.000Z",
        business_status: { code: "stocking", label: null, changed_at: null },
      }),
      item({
        id: "pending",
        business_status: {
          code: "pending_processing",
          label: null,
          changed_at: null,
        },
      }),
      item({
        id: "new-stock",
        created_at: "2026-10-03T10:00:00.000Z",
        business_status: { code: "stocking", label: null, changed_at: null },
      }),
    ];
    assert.deepEqual(
      sortItems(items, "status", "asc").map((each) => each.id),
      ["pending", "new-stock", "old-stock"],
    );
    assert.deepEqual(
      sortItems(items, "createdAt", "asc").map((each) => each.id),
      ["old-stock", "new-stock", "pending"],
    );
  });
});
