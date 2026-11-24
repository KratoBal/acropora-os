import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConflictException } from "@nestjs/common";

import {
  CarrierError,
  type CarrierClient,
  type TrackingEvent,
} from "../../integrations/carriers/carrier.types.js";
import { observeParcelStatusCodes } from "./parcel-status-codes.js";
import { ParcelStatusCodesService } from "./parcel-status-codes.service.js";

/*
  WHAT TURNS THIS RED (cards ef84489d, 17fe0cfd). A recipient's text that appears on one parcel shown (the sync's
  privacy rule must hold here too); a parcel counted twice; one parcel's failure stopping the others, or its message
  shown instead of a code; a parcel number in the answer; the observer running against the stub (its codes look like
  an answer); two runs at once; the limit not passed to the source.
*/
const event = (status: string, statusText = status): TrackingEvent => ({
  status,
  statusText,
  at: null,
});

describe("observeParcelStatusCodes", () => {
  it("counts codes per parcel, shows a description only where it repeats, and counts empty and failed answers", async () => {
    const answers: Record<string, TrackingEvent[] | Error> = {
      P1: [event("RECEIVE", "Átvette"), event("CREATE", "Létrehozva")],
      P2: [event("RECEIVE", "Átvette"), event("RECEIVE", "Átvette")],
      P3: [event("RECEIVE", "Átvette")],
      P4: [event("RECEIVE", "Kiss Anna vette át")],
      P5: [],
      P6: new CarrierError("TIMEOUT", "foxpost"),
      P7: new Error("connect ECONNREFUSED 10.0.0.1:443 for P7"),
    };
    const asked: string[] = [];
    const result = await observeParcelStatusCodes(
      "foxpost",
      "live",
      ["P1", "P2", " P2 ", "P3", "P4", "P5", "P6", "P7", ""],
      async (n) => {
        asked.push(n);
        const answer = answers[n] ?? [];
        if (answer instanceof Error) throw answer;
        return answer;
      },
    );
    assert.deepEqual(asked, ["P1", "P2", "P3", "P4", "P5", "P6", "P7"]);
    assert.deepEqual(result, {
      carrier: "foxpost",
      mode: "live",
      asked: 7,
      answered: 4,
      empty: 1,
      failed: [
        { error: "ERROR", parcels: 1 },
        { error: "TIMEOUT", parcels: 1 },
      ],
      observed: [
        { code: "RECEIVE", description: "Átvette", parcels: 3 },
        { code: "CREATE", description: "", parcels: 1 },
        { code: "RECEIVE", description: "", parcels: 1 },
      ],
    });
    const shown = JSON.stringify(result);
    for (const secret of ["Kiss Anna", "P1", "ECONNREFUSED", "10.0.0.1"])
      assert.ok(!shown.includes(secret), secret);
  });
});

describe("ParcelStatusCodesService", () => {
  const client = (events: TrackingEvent[]): CarrierClient =>
    ({
      carrier: "gls",
      tracking: async () => events,
    }) as unknown as CarrierClient;

  it("asks the source for the limit and tracks with the environment's mode", async () => {
    const service = new ParcelStatusCodesService();
    const limits: number[] = [];
    const modes: (string | undefined)[] = [];
    service.parcelNumbers = async (_carrier, limit) => {
      limits.push(limit);
      return ["1", "2", "3"];
    };
    service.clientFor = (_carrier, env) => {
      modes.push(env.GLS_API_MODE);
      return client([event("05", "Kézbesítve")]);
    };
    const result = await service.observe("gls", 7, { GLS_API_MODE: "live" });
    assert.deepEqual(limits, [7]);
    assert.deepEqual(modes, ["live"]);
    assert.equal(result.mode, "live");
    assert.deepEqual(result.observed, [
      { code: "05", description: "Kézbesítve", parcels: 3 },
    ]);
  });

  it("refuses the stub: its codes look like an answer and are not one", async () => {
    const service = new ParcelStatusCodesService();
    let asked = false;
    service.parcelNumbers = async () => {
      asked = true;
      return ["1"];
    };
    for (const env of [
      {},
      { FOXPOST_API_MODE: "stub" },
      { FOXPOST_API_MODE: "élő" },
    ]) {
      await assert.rejects(
        service.observe("foxpost", 5, env),
        (error: unknown) =>
          error instanceof ConflictException &&
          (error.getResponse() as { code?: string }).code === "STUB_MODE",
      );
    }
    assert.equal(asked, false);
  });

  it("runs one observation at a time, and frees itself after a failure", async () => {
    const service = new ParcelStatusCodesService();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    service.parcelNumbers = async () => {
      await gate;
      return ["1"];
    };
    service.clientFor = () => client([event("05")]);
    const env = { GLS_API_MODE: "test" };
    const first = service.observe("gls", 1, env);
    await assert.rejects(
      service.observe("gls", 1, env),
      (error: unknown) =>
        error instanceof ConflictException &&
        (error.getResponse() as { code?: string }).code === "BUSY",
    );
    release();
    assert.equal((await first).asked, 1);
    service.parcelNumbers = async () => {
      throw new Error("db down");
    };
    await assert.rejects(service.observe("gls", 1, env), /db down/);
    service.parcelNumbers = async () => ["9"];
    assert.equal((await service.observe("gls", 1, env)).asked, 1);
  });
});
