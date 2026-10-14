import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isPurchasableOnUnas,
  isRecommendableOnUnas,
  JevRecommendationCandidateSource,
  limitCandidates,
  matchingJevRows,
  MAX_CANDIDATES,
  PURCHASABLE_UNAS_STATUSES,
  wantedMoves,
  type JevEffectRow,
} from "./jev-candidate-source.js";
import type { RecommendationDeviation } from "./measurement-recommendation.contract.js";

/**
 * A JELÖLTEK A JEV-BŐL (kártya 2b3983e1). MI PIROSÍT: az irány megfordul
 * (alacsony kalciumra csökkentő termék); egy ütköző érték jelölt lesz; a
 * csak saját adattal alátámasztott (UNVERIFIED) hatás kimarad, vagy
 * megjelölés nélkül megy át; egy olvashatatlan érték elviszi a többit; egy
 * inaktív termék jelölt lesz; eltérés nélkül is lekérdez.
 */
const dev = (
  parameterCode: string,
  direction: "LOW" | "HIGH",
): RecommendationDeviation =>
  ({
    parameterCode,
    direction,
    measured: 1,
    unit: "mg/l",
    status: "WARN",
    trend: null,
  }) as RecommendationDeviation;

/** A UNAS row of a product one can buy (status 1), for the fixtures that are not about status. */
const SELLS = [{ channel: "UNAS", externalStatus: "1" }];

const row = (over: Partial<JevEffectRow>): JevEffectRow => ({
  productId: "p",
  status: "VERIFIED",
  value: "KALCIUM:EMEL",
  currentValue: null,
  sourceRef: "https://gyarto.example/termek",
  ...over,
});

describe("what the measurement wants", () => {
  it("low raises, high lowers", () => {
    assert.deepEqual(
      [...wantedMoves([dev("KALCIUM", "LOW"), dev("NITRAT", "HIGH")])],
      [
        ["KALCIUM", "EMEL"],
        ["NITRAT", "CSOKKENT"],
      ],
    );
  });
});

describe("the JEV rows that help", () => {
  it("only a verified value that moves a deviating parameter the right way", () => {
    const wanted = wantedMoves([dev("KALCIUM", "LOW"), dev("NITRAT", "HIGH")]);
    const found = matchingJevRows(
      [
        row({ productId: "ca-up", value: "KALCIUM:EMEL;KH:EMEL" }),
        row({ productId: "ca-down", value: "KALCIUM:CSOKKENT" }),
        row({
          productId: "no3-down",
          value: "NITRAT:CSOKKENT",
          sourceRef: null,
        }),
        row({ productId: "unverified", status: "UNVERIFIED" }),
        row({ productId: "conflict", status: "CONFLICTING" }),
        row({ productId: "garbage", value: "kalcium fel" }),
        row({ productId: "empty", value: null }),
        row({ productId: "other", value: "FOSZFAT:CSOKKENT" }),
      ],
      wanted,
    );
    assert.deepEqual(found, [
      {
        productId: "ca-up",
        effects: [
          { parameterCode: "KALCIUM", direction: "EMEL" },
          { parameterCode: "KH", direction: "EMEL" },
        ],
        evidenceRef: "https://gyarto.example/termek",
      },
      {
        productId: "no3-down",
        effects: [{ parameterCode: "NITRAT", direction: "CSOKKENT" }],
      },
    ]);
  });
});

describe("a water effect backed only by our own data (Balázs, 2026-10-12 12:42 UTC)", () => {
  it("is a candidate from its own value, marked, with no source page; the reconciled value is never read for it", () => {
    const wanted = wantedMoves([dev("KH", "LOW"), dev("NITRAT", "HIGH")]);
    const found = matchingJevRows(
      [
        // the #1669 category rule: UNVERIFIED, no value, ours in currentValue
        row({
          productId: "kh-own",
          status: "UNVERIFIED",
          value: null,
          currentValue: "KH:EMEL",
          sourceRef: "unas-kategoria:Vizkezelok",
        }),
        // a value on an UNVERIFIED row is not ours: it does not count
        row({
          productId: "kh-stray",
          status: "UNVERIFIED",
          value: "KH:EMEL",
          currentValue: null,
        }),
        // with both on an UNVERIFIED row, ours decides (here: the right way)
        row({
          productId: "kh-mixed",
          status: "UNVERIFIED",
          value: "NITRAT:EMEL",
          currentValue: "KH:EMEL",
        }),
        // the wrong way, own data or not, stays out
        row({
          productId: "no3-up-own",
          status: "UNVERIFIED",
          value: null,
          currentValue: "NITRAT:EMEL",
        }),
        // a conflict or a likely wrong value is no candidate, even with ours
        row({
          productId: "kh-conflict",
          status: "CONFLICTING_SOURCES",
          value: null,
          currentValue: "KH:EMEL",
        }),
        row({
          productId: "kh-wrong",
          status: "POSSIBLE_WRONG_VALUE",
          value: null,
          currentValue: "KH:EMEL",
        }),
        // a verified row reads its value, not ours
        row({
          productId: "kh-verified",
          value: "KH:EMEL",
          currentValue: "NITRAT:EMEL",
        }),
      ],
      wanted,
    );
    assert.deepEqual(found, [
      {
        productId: "kh-own",
        effects: [{ parameterCode: "KH", direction: "EMEL" }],
        unverified: true,
      },
      {
        productId: "kh-mixed",
        effects: [{ parameterCode: "KH", direction: "EMEL" }],
        unverified: true,
      },
      {
        productId: "kh-verified",
        effects: [{ parameterCode: "KH", direction: "EMEL" }],
        evidenceRef: "https://gyarto.example/termek",
      },
    ]);
  });

  it("under the cap, a verified candidate goes before an unverified one helping as much", () => {
    const wanted = wantedMoves([dev("KH", "LOW")]);
    const candidate = (name: string, unverified: boolean) => ({
      productId: name,
      name,
      category: "",
      basis: "JEV" as const,
      effects: [{ parameterCode: "KH", direction: "EMEL" as const }],
      ...(unverified ? { unverified: true } : {}),
    });
    assert.deepEqual(
      limitCandidates(
        [candidate("a-sajat", true), candidate("b-gyartoi", false)],
        wanted,
      ).map((c) => c.name),
      ["b-gyartoi", "a-sajat"],
    );
  });
});

describe("a product that moves another measured deviation the wrong way (barracuda, #1668)", () => {
  it("is not a candidate: low calcium and high magnesium, a product raising both", () => {
    const wanted = wantedMoves([
      dev("KALCIUM", "LOW"),
      dev("MAGNEZIUM", "HIGH"),
    ]);
    assert.deepEqual(
      matchingJevRows(
        [
          row({ productId: "both-up", value: "KALCIUM:EMEL;MAGNEZIUM:EMEL" }),
          row({ productId: "ca-only", value: "KALCIUM:EMEL" }),
          row({
            productId: "both-right",
            value: "KALCIUM:EMEL;MAGNEZIUM:CSOKKENT",
          }),
        ],
        wanted,
      ).map((m) => m.productId),
      ["ca-only", "both-right"],
    );
  });
});

describe("the cap the AI side takes (barracuda, #1668)", () => {
  it("at most MAX_CANDIDATES, the ones helping more deviations first, then by name", () => {
    const wanted = wantedMoves([dev("KALCIUM", "LOW"), dev("NITRAT", "HIGH")]);
    const candidate = (name: string, effects: string[]) => ({
      productId: name,
      name,
      category: "",
      basis: "JEV" as const,
      effects: effects.map((e) => {
        const [parameterCode, direction] = e.split(":") as [
          string,
          "EMEL" | "CSOKKENT",
        ];
        return { parameterCode, direction };
      }),
    });
    const many = Array.from({ length: 250 }, (_, i) =>
      candidate(`termek-${String(i).padStart(3, "0")}`, ["KALCIUM:EMEL"]),
    );
    const limited = limitCandidates(
      [...many, candidate("zz-mindketto", ["KALCIUM:EMEL", "NITRAT:CSOKKENT"])],
      wanted,
    );
    assert.equal(MAX_CANDIDATES < 300, true);
    assert.deepEqual(
      [
        limited.length,
        limited[0]!.name,
        limited[1]!.name,
        limited.at(-1)!.name,
      ],
      [MAX_CANDIDATES, "zz-mindketto", "termek-000", "termek-198"],
    );
  });
});

describe("the source", () => {
  it("the active products among the matches, with their category; no deviation, no query", async () => {
    let queries = 0;
    let asked: unknown;
    const source = new JevRecommendationCandidateSource();
    (source as unknown as { database: unknown }).database = {
      $queryRaw: async () => {
        queries++;
        return [
          row({ productId: "aktiv", value: "KALCIUM:EMEL" }),
          row({ productId: "inaktiv", value: "KALCIUM:EMEL" }),
        ];
      },
      product: {
        findMany: async (args: { where: unknown }) => {
          asked = args.where;
          return [
            {
              id: "aktiv",
              name: "Kalcium adalék",
              categories: [{ category: { name: "Adalékok" } }],
              channelListings: SELLS,
            },
          ];
        },
      },
    };
    assert.deepEqual(await source.candidates({ deviations: [] }), []);
    assert.equal(queries, 0);
    const candidates = await source.candidates({
      deviations: [dev("KALCIUM", "LOW")],
    });
    assert.deepEqual(asked, {
      id: { in: ["aktiv", "inaktiv"] },
      isActive: true,
    });
    assert.deepEqual(candidates, [
      {
        productId: "aktiv",
        name: "Kalcium adalék",
        category: "Adalékok",
        effects: [{ parameterCode: "KALCIUM", direction: "EMEL" }],
        basis: "JEV",
        evidenceRef: "https://gyarto.example/termek",
      },
    ]);
  });

  it("an unverified match reaches the candidate marked, and the query reads our own value", async () => {
    let sql = "";
    const source = new JevRecommendationCandidateSource();
    (source as unknown as { database: unknown }).database = {
      $queryRaw: async (strings: TemplateStringsArray) => {
        sql = strings.join("?");
        return [
          row({
            productId: "kh-own",
            status: "UNVERIFIED",
            value: null,
            currentValue: "KH:EMEL",
          }),
        ];
      },
      product: {
        findMany: async () => [
          {
            id: "kh-own",
            name: "KH puffer",
            categories: [],
            channelListings: SELLS,
          },
        ],
      },
    };
    const candidates = await source.candidates({
      deviations: [dev("KH", "LOW")],
    });
    // without the column every UNVERIFIED row would silently give nothing
    assert.match(sql, /f\."currentValue"/);
    assert.deepEqual(
      candidates.map((c) => [c.productId, c.unverified, c.evidenceRef]),
      [["kh-own", true, undefined]],
    );
  });

  it("only a product one can buy: UNAS status 1 and 2 stay, 3 (active, not purchasable), 0, unknown and no UNAS row drop out", async () => {
    // Balázs, 2026-10-14 11:26:20 UTC, message_id 1559890095572779059 ("B")
    const statuses: Record<
      string,
      { channel: string; externalStatus: string | null }[]
    > = {
      "st-1": [{ channel: "UNAS", externalStatus: "1" }],
      "st-2": [{ channel: "UNAS", externalStatus: "2" }],
      "st-3": [{ channel: "UNAS", externalStatus: "3" }],
      "st-0": [{ channel: "UNAS", externalStatus: "0" }],
      "st-null": [{ channel: "UNAS", externalStatus: null }],
      // a status "1" on ANOTHER channel is not the shop's word
      "no-unas": [{ channel: "WEBSHOP", externalStatus: "1" }],
    };
    const source = new JevRecommendationCandidateSource();
    (source as unknown as { database: unknown }).database = {
      $queryRaw: async () =>
        Object.keys(statuses).map((productId) =>
          row({ productId, value: "KALCIUM:EMEL" }),
        ),
      product: {
        findMany: async () =>
          Object.entries(statuses).map(([id, channelListings]) => ({
            id,
            name: id,
            categories: [],
            channelListings,
          })),
      },
    };
    const candidates = await source.candidates({
      deviations: [dev("KALCIUM", "LOW")],
    });
    assert.deepEqual(candidates.map((c) => c.productId).sort(), [
      "st-1",
      "st-2",
    ]);
  });

  /*
    CSAK ÉRDEKLŐDÉSRE (feladat ajanlas-inquire; acrobot mérése az élő UNAS-ból:
    84 termék 1-es vagy 2-es státuszú, de csak érdeklődésre). MI PIROSÍT: egy
    Inquire=1 termék jelölt marad; egy Inquire=0 vagy pillanatkép nélküli termék
    kiesik (pillanatkép nélkül a státusz dönt, ahogy eddig); a pillanatkép nem
    kerül a lekérdezésbe.
  */
  it("INQUIRE-SOURCE: an inquire-only product drops out; Inquire 0 and no snapshot stay", async () => {
    const SELLS = [{ channel: "UNAS", externalStatus: "1" }];
    const snapshots: Record<string, { rawPayload: unknown } | null> = {
      "inq-1": { rawPayload: { Inquire: "1" } },
      "inq-0": { rawPayload: { Inquire: "0" } },
      "no-snapshot": null,
    };
    let selected: unknown;
    const source = new JevRecommendationCandidateSource();
    (source as unknown as { database: unknown }).database = {
      $queryRaw: async () =>
        Object.keys(snapshots).map((productId) =>
          row({ productId, value: "KALCIUM:EMEL" }),
        ),
      product: {
        findMany: async (args: { select: Record<string, unknown> }) => {
          selected = args.select.unasSnapshot;
          return Object.entries(snapshots).map(([id, unasSnapshot]) => ({
            id,
            name: id,
            categories: [],
            channelListings: SELLS,
            unasSnapshot,
          }));
        },
      },
    };
    const candidates = await source.candidates({
      deviations: [dev("KALCIUM", "LOW")],
    });
    assert.deepEqual(candidates.map((c) => c.productId).sort(), [
      "inq-0",
      "no-snapshot",
    ]);
    assert.deepEqual(selected, { select: { rawPayload: true } });
  });

  it("INQUIRE-RULE: the stored flag shapes the sync uses; the status still decides first", () => {
    const sells = [{ channel: "UNAS", externalStatus: "2" }];
    const with_ = (rawPayload: unknown) =>
      isRecommendableOnUnas({
        channelListings: sells,
        unasSnapshot: { rawPayload },
      });
    assert.deepEqual(
      [
        with_({ Inquire: "1" }),
        with_({ Inquire: 1 }),
        with_({ Inquire: true }),
        with_({ Inquire: "0" }),
        with_({}),
        with_(null),
        with_("x"),
      ],
      [false, false, false, true, true, true, true],
    );
    // a status 3 product is out whatever the snapshot says
    assert.equal(
      isRecommendableOnUnas({
        channelListings: [{ channel: "UNAS", externalStatus: "3" }],
        unasSnapshot: { rawPayload: { Inquire: "0" } },
      }),
      false,
    );
  });

  it("isPurchasableOnUnas: the shop's base status decides, only 1 and 2", () => {
    const on = (externalStatus: string | null) =>
      isPurchasableOnUnas([{ channel: "UNAS", externalStatus }]);
    assert.deepEqual(["0", "1", "2", "3", "", null].map(on), [
      false,
      true,
      true,
      false,
      false,
      false,
    ]);
    assert.equal(isPurchasableOnUnas([]), false);
    // the link rule is wider (3 is visible): the two must stay different
    assert.deepEqual([...PURCHASABLE_UNAS_STATUSES].sort(), ["1", "2"]);
  });

  it("the source itself applies the cap", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `p-${i}`);
    const source = new JevRecommendationCandidateSource();
    (source as unknown as { database: unknown }).database = {
      $queryRaw: async () =>
        ids.map((productId) => row({ productId, value: "KALCIUM:EMEL" })),
      product: {
        findMany: async () =>
          ids.map((id) => ({
            id,
            name: id,
            categories: [],
            channelListings: SELLS,
          })),
      },
    };
    const candidates = await source.candidates({
      deviations: [dev("KALCIUM", "LOW")],
    });
    assert.equal(candidates.length, MAX_CANDIDATES);
  });
});
