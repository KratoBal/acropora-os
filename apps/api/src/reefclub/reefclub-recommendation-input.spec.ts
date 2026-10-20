import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { recommend } from "@acropora/aquarium-calc";

import {
  PROJECTION_REFUSALS_MISSING,
  buildRecommendationInput,
  doseListBuiltAt,
  parseReservedChanges,
  type RawAdministration,
  type RawDoseRow,
  type RawMeasurement,
  type RawRecommendation,
  type RecommendationRawData,
} from "./reefclub-recommendation-input.js";

/**
 * THE ROWS INTO THE ENGINE'S INPUT (ReefClub slice 8, service PR). Made-up
 * data. Each case is a mapping the engine's safety depends on; the last block
 * runs the engine on the built input to show the pieces fit.
 */
const NOW = new Date("2026-10-21T12:00:00.000Z");
const HOUR = 3_600_000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);
const dec = (value: number) => ({ toNumber: () => value });

const measurement = (over: Partial<RawMeasurement> = {}): RawMeasurement => ({
  id: "m-kh",
  parameterCode: "KH",
  value: dec(6),
  measuredAt: ago(1),
  source: "REEFCLUB_MANUAL",
  ...over,
});

const doseRow = (over: Partial<RawDoseRow> = {}): RawDoseRow => ({
  sourceId: "src-kh",
  sourceVersion: 3,
  productId: "p-kh",
  productName: "Minta KH+",
  parameterCode: "KH",
  direction: "EMEL",
  effectPer100L: dec(0.25),
  doseUnit: "ML",
  doseStep: dec(1),
  maxDailyDosePer100L: dec(20),
  effectHours: 12,
  source: "Gyártói címke (teszt)",
  refusals: [],
  inStock: null,
  pricePerDoseUnit: null,
  ...over,
});

const recommendation = (
  over: Partial<RawRecommendation> = {},
): RawRecommendation => ({
  id: "rec-1",
  createdAt: ago(20),
  parameterCode: "KH",
  basisMeasurementId: "m-old",
  productId: "p-kh",
  amount: dec(8),
  doseUnit: "ML",
  status: "OPEN",
  effectEndsAt: ago(8),
  reservedChanges: [{ parameter: "KH", change: 1 }],
  ...over,
});

function raw(over: Partial<RecommendationRawData> = {}): RecommendationRawData {
  return {
    now: NOW,
    origin: "OWN",
    parameter: "KH",
    aquarium: {
      systemVolumeLiters: dec(200),
      waterType: "TENGERI",
      targets: [],
    },
    measurements: [measurement()],
    rows: [doseRow()],
    doseListBuiltAt: ago(1),
    administrations: [],
    recommendations: [],
    ...over,
  };
}

describe("a mérések", () => {
  it("SHOP csak bolti akváriumban és nem a vevő kézi forrásával; minden más, az ismeretlen vagy hiányzó forrás is, MANUAL (barracuda, #1757)", () => {
    const sources = (origin: "OWN" | "SHOP") =>
      buildRecommendationInput(
        raw({
          origin,
          measurements: [
            measurement({ id: "m-kezi", source: "REEFCLUB_MANUAL" }),
            measurement({ id: "m-bolt", source: "bolt", measuredAt: ago(30) }),
            measurement({ id: "m-null", source: null, measuredAt: ago(31) }),
            measurement({
              id: "m-uj",
              source: "kulso-app",
              measuredAt: ago(32),
            }),
          ],
        }),
      ).measurements.map((point) => [point.id, point.source]);
    assert.deepEqual(sources("SHOP"), [
      ["m-kezi", "MANUAL"],
      ["m-bolt", "SHOP"],
      ["m-null", "SHOP"],
      ["m-uj", "SHOP"],
    ]);
    // the customer's own aquarium: nothing there can be the shop's, whatever the source says
    assert.deepEqual(sources("OWN"), [
      ["m-kezi", "MANUAL"],
      ["m-bolt", "MANUAL"],
      ["m-null", "MANUAL"],
      ["m-uj", "MANUAL"],
    ]);
  });

  it("a saját akváriumban a hiányzó forrású riasztás ismétlést kér, nem oldódik fel bolti mérésként", () => {
    const result = recommend(
      buildRecommendationInput(
        raw({ measurements: [measurement({ value: dec(4), source: null })] }),
      ),
    );
    assert.ok(result.kind === "NO_DOSE");
    assert.equal(result.reason, "NEEDS_REPEAT_MEASUREMENT");
  });

  it("az alkalom azonosítója a mérés ideje", () => {
    const input = buildRecommendationInput(raw());
    assert.equal(input.measurements[0]!.occasionId, ago(1).toISOString());
  });

  it("a riasztás ugyanazon a sávon, mint a bemenet: a KH 4,0 a 7-9 sávban ALERT, a 6,0 csak WARN", () => {
    const input = buildRecommendationInput(
      raw({
        measurements: [
          measurement({ value: dec(4) }),
          measurement({ id: "m2", value: dec(6) }),
        ],
      }),
    );
    assert.deepEqual(
      input.measurements.map((point) => point.alert),
      [true, false],
    );
  });

  it("a saját célsáv felülírja az alapot, és a riasztás is azt követi (6-8 sávban a 4,0 ALERT, az 5,0 WARN)", () => {
    const input = buildRecommendationInput(
      raw({
        aquarium: {
          systemVolumeLiters: dec(200),
          waterType: "TENGERI",
          targets: [{ parameterCode: "KH", min: dec(6), max: dec(8) }],
        },
        measurements: [
          measurement({ value: dec(4) }),
          measurement({ id: "m2", value: dec(5) }),
        ],
      }),
    );
    assert.deepEqual(input.bands.KH, { min: 6, max: 8 });
    assert.deepEqual(
      input.measurements.map((point) => point.alert),
      [true, false],
    );
  });

  it("nem ajánlott paraméter (pH) mérése nem kerül a bemenetbe", () => {
    const input = buildRecommendationInput(
      raw({
        measurements: [
          measurement(),
          measurement({ id: "m-ph", parameterCode: "PH", value: dec(8.2) }),
        ],
      }),
    );
    assert.deepEqual(
      input.measurements.map((point) => point.parameter),
      ["KH"],
    );
  });

  it("édesvízi akváriumnak nincs alap célsáv: a sáv hiányzik, nem kitalált", () => {
    const input = buildRecommendationInput(
      raw({
        aquarium: {
          systemVolumeLiters: dec(200),
          waterType: "EDESVIZI",
          targets: [],
        },
      }),
    );
    assert.equal(input.bands.KH, undefined);
    assert.equal(input.measurements[0]!.alert, false);
  });
});

describe("a térfogat és a lista kora", () => {
  it("a nettó liter számként; ha nincs, null", () => {
    assert.equal(buildRecommendationInput(raw()).volumeLiters, 200);
    assert.equal(
      buildRecommendationInput(
        raw({
          aquarium: {
            systemVolumeLiters: null,
            waterType: "TENGERI",
            targets: [],
          },
        }),
      ).volumeLiters,
      null,
    );
  });

  it("a lista építési ideje változatlanul megy tovább (null: soha)", () => {
    assert.equal(
      buildRecommendationInput(raw({ doseListBuiltAt: null })).doseListBuiltAt,
      null,
    );
    assert.equal(
      buildRecommendationInput(raw()).doseListBuiltAt?.getTime(),
      ago(1).getTime(),
    );
  });
});

describe("a lista kora a sorok futásából (barracuda, #1757)", () => {
  const run = (id: string, over: object = {}) => ({
    id,
    status: "SUCCEEDED",
    finishedAt: ago(2),
    ...over,
  });
  const LATEST = ago(0.1);

  it("a sorok futásának ideje, nem a legutóbbi futásé", () => {
    assert.equal(
      doseListBuiltAt(
        [{ runId: "r1" }, { runId: "r1" }],
        [run("r1")],
        LATEST,
      )?.getTime(),
      ago(2).getTime(),
    );
  });

  it("két futás sorai, hiányzó vagy nem SUCCEEDED futás: elavult (null)", () => {
    assert.equal(
      doseListBuiltAt(
        [{ runId: "r1" }, { runId: "r2" }],
        [run("r1"), run("r2")],
        LATEST,
      ),
      null,
    );
    assert.equal(doseListBuiltAt([{ runId: "r1" }], [], LATEST), null);
    assert.equal(
      doseListBuiltAt(
        [{ runId: "r1" }],
        [run("r1", { status: "FAILED" })],
        LATEST,
      ),
      null,
    );
  });

  it("üres sorhalmaz: marad a legutóbbi sikeres futás ideje (onnan úgysem jön adag)", () => {
    assert.equal(doseListBuiltAt([], [], LATEST)?.getTime(), LATEST.getTime());
    assert.equal(doseListBuiltAt([], [], null), null);
  });

  it("a motor a harminc órás sorokra nem ad adagot, akkor sem, ha a legutóbbi futás friss", () => {
    const rows = [doseRow()];
    const stale = recommend(
      buildRecommendationInput(
        raw({
          rows,
          doseListBuiltAt: doseListBuiltAt(
            [{ runId: "r1" }],
            [run("r1", { finishedAt: ago(30) })],
            ago(0.1),
          ),
        }),
      ),
    );
    assert.ok(stale.kind === "NO_DOSE");
    assert.equal(stale.reason, "DOSE_LIST_STALE");
  });
});

describe("a vetített sorok", () => {
  it("a forrás verziója és azonosítója megy rowId és rowVersion néven, a számok számként", () => {
    const [row] = buildRecommendationInput(raw()).rows;
    assert.equal(row!.rowId, "src-kh");
    assert.equal(row!.rowVersion, 3);
    assert.equal(row!.effectPer100L, 0.25);
    assert.equal(row!.maxDailyDosePer100L, 20);
    assert.deepEqual(row!.refusals, []);
  });

  it("a HIÁNYZÓ (null) kizáró-lista elutasítás, nem élő sor", () => {
    const [row] = buildRecommendationInput(
      raw({ rows: [doseRow({ refusals: null })] }),
    ).rows;
    assert.deepEqual(row!.refusals, [PROJECTION_REFUSALS_MISSING]);
    const result = recommend(
      buildRecommendationInput(raw({ rows: [doseRow({ refusals: null })] })),
    );
    assert.equal(result.kind, "NO_DOSE");
  });
});

describe("a korábbi ajánlások és beadások", () => {
  it("a nyitott, de lejárt ajánlás EXPIRED; a nyitott érvényes marad OPEN; a megválaszolt marad", () => {
    const input = buildRecommendationInput(
      raw({
        recommendations: [
          recommendation({ id: "a", status: "OPEN", effectEndsAt: ago(1) }),
          recommendation({
            id: "b",
            status: "OPEN",
            effectEndsAt: new Date(NOW.getTime() + HOUR),
          }),
          recommendation({ id: "c", status: "GIVEN" }),
        ],
      }),
    );
    assert.deepEqual(
      input.priorRecommendations.map((prior) => prior.status),
      ["EXPIRED", "OPEN", "GIVEN"],
    );
  });

  it("a törölt mérés (null alap) üres azonosítóvá lesz, ami semmivel nem egyezik; a törölt termék null marad", () => {
    const [prior] = buildRecommendationInput(
      raw({
        recommendations: [
          recommendation({ basisMeasurementId: null, productId: null }),
        ],
      }),
    ).priorRecommendations;
    assert.equal(prior!.basisMeasurementId, "");
    assert.equal(prior!.productId, null);
  });

  it("a foglalás olvasható alakja; az olvashatatlan HIBA, nem üres lista (az üres felszabadítaná a korlátot)", () => {
    assert.deepEqual(
      parseReservedChanges([{ parameter: "KH", change: 1 }], "r"),
      [{ parameter: "KH", change: 1 }],
    );
    for (const bad of [
      null,
      "x",
      {},
      [{ parameter: "KH" }],
      [{ parameter: 1, change: 1 }],
      [{ parameter: "KH", change: Number.NaN }],
      [null],
    ])
      assert.throws(
        () => parseReservedChanges(bad, "r-1"),
        /r-1/,
        JSON.stringify(bad),
      );
    assert.throws(() =>
      buildRecommendationInput(
        raw({
          recommendations: [recommendation({ reservedChanges: "sérült" })],
        }),
      ),
    );
  });

  it("a rögzített beadás mennyisége számként, az ismeretlen (null) null marad", () => {
    const administrations: RawAdministration[] = [
      {
        id: "a1",
        administeredAt: ago(3),
        parameterCode: "KH",
        productId: "p-kh",
        amount: dec(4),
        doseUnit: "ML",
      },
      {
        id: "a2",
        administeredAt: ago(2),
        parameterCode: "KH",
        productId: null,
        amount: null,
        doseUnit: null,
      },
    ];
    const input = buildRecommendationInput(raw({ administrations }));
    assert.deepEqual(
      input.administrations.map((given) => [
        given.id,
        given.amount,
        given.unit,
      ]),
      [
        ["a1", 4, "ML"],
        ["a2", null, null],
      ],
    );
  });
});

describe("a motor az épített bemeneten", () => {
  it("az alapeset: 200 liter, KH 6,0, a 7-9 sáv: 8 ml", () => {
    const result = recommend(buildRecommendationInput(raw()));
    assert.equal(result.kind, "DOSE");
    assert.ok(result.kind === "DOSE");
    assert.equal(result.amount, 8);
    assert.equal(result.product.productId, "p-kh");
    assert.equal(result.log.rowVersion, 3);
  });

  it("a lejárt korábbi ajánlás a korlátban beadottnak számít (a foglalás átmegy a leképezésen)", () => {
    const result = recommend(
      buildRecommendationInput(raw({ recommendations: [recommendation()] })),
    );
    assert.ok(result.kind === "NO_DOSE");
    assert.equal(result.reason, "DAILY_LIMIT_FILLED");
  });
});
