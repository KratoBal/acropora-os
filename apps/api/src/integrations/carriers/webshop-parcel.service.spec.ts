import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WebshopParcel } from "@acropora/database";

import {
  type CarrierClient,
  CarrierError,
  type CreateParcelInput,
  type ParcelRef,
} from "./carrier.types.js";
import type {
  ParcelReservation,
  WebshopParcelRepository,
} from "./webshop-parcel.repository.js";
import {
  RESERVATION_RELEASE_AFTER_MS,
  WebshopParcelService,
} from "./webshop-parcel.service.js";

/**
 * Egy memoriabeli tar, ami az adatbazis reszleges egyedi indexet utanozza:
 * rendelesenkent egy ACTIVE sor. Hogy a VALODI index ezt tartja-e, azt a
 * webshop-parcel.repository.integration.spec.ts meri; itt a szolgaltatas
 * sorrendje a kerdes (foglalas a hivas elott).
 */
class MemoryParcels {
  rows: WebshopParcel[] = [];
  findActiveManyCalls = 0;
  private seq = 0;

  asRepository(): WebshopParcelRepository {
    return this as unknown as WebshopParcelRepository;
  }

  async reserve(r: ParcelReservation): Promise<WebshopParcel | null> {
    if (
      this.rows.some(
        (row) =>
          row.commerceOrderId === r.commerceOrderId && row.status === "ACTIVE",
      )
    )
      return null;
    const row: WebshopParcel = {
      id: `p${(this.seq += 1)}`,
      ...r,
      parcelNumber: null,
      carrierParcelId: null,
      status: "ACTIVE",
      cancelledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }

  async confirm(id: string, parcel: ParcelRef): Promise<WebshopParcel> {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, {
      parcelNumber: parcel.parcelNumber,
      carrierParcelId: parcel.carrierParcelId ?? null,
    });
    return row;
  }

  async dropReservation(id: string): Promise<void> {
    this.rows = this.rows.filter(
      (r) => !(r.id === id && r.parcelNumber === null),
    );
  }

  async findActive(commerceOrderId: string) {
    return (
      this.rows.find(
        (r) => r.commerceOrderId === commerceOrderId && r.status === "ACTIVE",
      ) ?? null
    );
  }

  async findActiveMany(ids: string[]) {
    this.findActiveManyCalls += 1;
    return this.rows.filter(
      (r) => ids.includes(r.commerceOrderId) && r.status === "ACTIVE",
    );
  }

  async markCancelled(
    id: string,
    options: { unconfirmedOnly?: boolean; olderThan?: Date } = {},
  ) {
    const row = this.rows.find(
      (r) =>
        r.id === id &&
        r.status === "ACTIVE" &&
        (!options.unconfirmedOnly || r.parcelNumber === null) &&
        (!options.olderThan || r.createdAt < options.olderThan),
    );
    if (!row) return false;
    Object.assign(row, { status: "CANCELLED", cancelledAt: new Date() });
    return true;
  }
}

/** Egy hamis szallito: szamolja a hivasokat, es kerre megall vagy hibazik. */
class FakeCarrier implements CarrierClient {
  readonly carrier = "foxpost" as const;
  created: CreateParcelInput[] = [];
  labels: ParcelRef[] = [];
  cancelled: ParcelRef[] = [];
  failWith: CarrierError | Error | null = null;
  gate: Promise<void> | null = null;

  async createParcel(input: CreateParcelInput): Promise<ParcelRef> {
    this.created.push(input);
    if (this.gate) await this.gate;
    if (this.failWith) throw this.failWith;
    return {
      parcelNumber: `CLFOX${String(this.created.length).padStart(15, "0")}`,
    };
  }
  async labelPdf(parcel: ParcelRef) {
    this.labels.push(parcel);
    return Buffer.from("%PDF-1.4");
  }
  async tracking() {
    return [];
  }
  async cancelParcel(parcel: ParcelRef) {
    if (this.failWith) throw this.failWith;
    this.cancelled.push(parcel);
  }
}

const ORDER = {
  commerceOrderId: "order_teszt_1",
  displayId: 1042,
  carrier: "foxpost" as const,
  recipient: {
    name: "Teszt Címzett",
    phone: "+36000000000",
    email: "cimzett@example.test",
  },
  destination: { kind: "point" as const, pointId: "TESZTPONT01" },
};

function setup() {
  const store = new MemoryParcels();
  const carrier = new FakeCarrier();
  const service = new WebshopParcelService(store.asRepository(), () => carrier);
  return { store, carrier, service };
}

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof CarrierError, String(error));
    return error.code;
  }
  assert.fail("expected a CarrierError");
}

describe("WebshopParcelService", () => {
  it("creates the parcel with the shipment reference and stores its number", async () => {
    const { store, carrier, service } = setup();
    const parcel = await service.createParcel({
      ...ORDER,
      displayId: "#1042",
      codHuf: 12490,
    });
    assert.equal(carrier.created[0]!.reference, "1042");
    assert.equal(carrier.created[0]!.codHuf, 12490);
    assert.equal(parcel.parcelNumber, "CLFOX000000000000001");
    assert.equal(parcel.stub, false);
    assert.equal(store.rows.length, 1);
  });

  it("a double click reaches the carrier ONCE: the second request stops on the reservation", async () => {
    const { carrier, service } = setup();
    let release!: () => void;
    carrier.gate = new Promise((resolve) => (release = resolve));

    const first = service.createParcel(ORDER);
    const second = service.createParcel(ORDER);
    assert.equal(await codeOf(second), "UNCONFIRMED");
    release();
    await first;

    assert.equal(carrier.created.length, 1);
    assert.equal(await codeOf(service.createParcel(ORDER)), "DUPLICATE");
    assert.equal(carrier.created.length, 1);
  });

  it("a certain rejection frees the order, so a corrected retry can go", async () => {
    const { store, carrier, service } = setup();
    carrier.failWith = new CarrierError("INVALID_POINT", "foxpost");
    assert.equal(await codeOf(service.createParcel(ORDER)), "INVALID_POINT");
    assert.equal(store.rows.length, 0);

    carrier.failWith = null;
    assert.ok((await service.createParcel(ORDER)).parcelNumber);
  });

  it("an uncertain outcome keeps the reservation: no second parcel until someone releases it", async () => {
    for (const failure of [
      new CarrierError("TIMEOUT", "foxpost"),
      new CarrierError("UNEXPECTED_RESPONSE", "foxpost"),
      new Error("socket hang up"),
    ]) {
      const { store, carrier, service } = setup();
      carrier.failWith = failure;
      await assert.rejects(service.createParcel(ORDER));
      carrier.failWith = null;

      assert.equal(await codeOf(service.createParcel(ORDER)), "UNCONFIRMED");
      assert.equal(carrier.created.length, 1, String(failure));
      assert.equal(store.rows.filter((r) => r.status === "ACTIVE").length, 1);
    }
  });

  it("releases an uncertain reservation only once a running call must have ended", async () => {
    const { store, carrier, service } = setup();
    carrier.failWith = new CarrierError("TIMEOUT", "foxpost");
    await assert.rejects(service.createParcel(ORDER));
    carrier.failWith = null;

    assert.equal(
      await codeOf(service.releaseUnconfirmed(ORDER.commerceOrderId)),
      "UNCONFIRMED",
    );
    store.rows[0]!.createdAt = new Date(
      Date.now() - RESERVATION_RELEASE_AFTER_MS - 1000,
    );
    await service.releaseUnconfirmed(ORDER.commerceOrderId);
    assert.equal(store.rows[0]!.status, "CANCELLED");

    assert.ok((await service.createParcel(ORDER)).parcelNumber);
    assert.equal(carrier.created.length, 2);
  });

  it("never releases a confirmed parcel as unconfirmed", async () => {
    const { store, service } = setup();
    await service.createParcel(ORDER);
    store.rows[0]!.createdAt = new Date(0);
    assert.equal(
      await codeOf(service.releaseUnconfirmed(ORDER.commerceOrderId)),
      "DUPLICATE",
    );
    assert.equal(store.rows[0]!.status, "ACTIVE");
  });

  it("a reprint asks the label of the existing parcel and creates nothing", async () => {
    const { carrier, service } = setup();
    await service.createParcel(ORDER);
    await service.labelPdf(ORDER.commerceOrderId);
    await service.labelPdf(ORDER.commerceOrderId);
    assert.equal(carrier.created.length, 1);
    assert.deepEqual(
      carrier.labels.map((l) => l.parcelNumber),
      ["CLFOX000000000000001", "CLFOX000000000000001"],
    );
    assert.equal(await codeOf(service.labelPdf("order_nincs")), "NO_PARCEL");
  });

  it("cancels at the carrier first, and keeps the parcel if the carrier refuses", async () => {
    const { store, carrier, service } = setup();
    await service.createParcel(ORDER);
    carrier.failWith = new CarrierError("REJECTED", "foxpost");
    assert.equal(
      await codeOf(service.cancelParcel(ORDER.commerceOrderId)),
      "REJECTED",
    );
    assert.equal(store.rows[0]!.status, "ACTIVE");

    carrier.failWith = null;
    await service.cancelParcel(ORDER.commerceOrderId);
    assert.equal(store.rows[0]!.status, "CANCELLED");
    assert.ok(
      (await service.createParcel(ORDER)).parcelNumber,
      "a cancelled parcel frees the order",
    );
  });

  it("lists the active parcels of many orders with one query", async () => {
    const { store, service } = setup();
    await service.createParcel(ORDER);
    await service.createParcel({
      ...ORDER,
      commerceOrderId: "order_teszt_2",
      displayId: 1043,
    });
    const parcels = await service.activeParcelsFor([
      "order_teszt_1",
      "order_teszt_2",
      "order_teszt_1",
      "order_nincs",
    ]);
    assert.equal(store.findActiveManyCalls, 1);
    assert.deepEqual(Object.keys(parcels).sort(), [
      "order_teszt_1",
      "order_teszt_2",
    ]);
    assert.equal(parcels.order_teszt_2!.reference, "1043");
  });

  it("marks a stub parcel so it never passes for a real one", async () => {
    const store = new MemoryParcels();
    const stub = new FakeCarrier();
    stub.createParcel = async () => ({ parcelNumber: "STUB-FOXPOST-ABC" });
    const parcel = await new WebshopParcelService(
      store.asRepository(),
      () => stub,
    ).createParcel(ORDER);
    assert.equal(parcel.stub, true);
  });
});
