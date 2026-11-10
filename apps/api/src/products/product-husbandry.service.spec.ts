import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { ProductHusbandry, ProductHusbandryFacts } from "@acropora/types";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { UpdateProductHusbandryDto } from "./dto/update-product-husbandry.dto.js";
import {
  ProductHusbandryService,
  husbandryDecision,
} from "./product-husbandry.service.js";
import type {
  HusbandryDecision,
  HusbandryWriteResult,
  ProductHusbandryRepository,
} from "./product-husbandry.repository.js";

/*
  WHAT TURNS THESE RED (V2.2, card d2fc06e7): a verification that survives an edit, or that is stamped with a name or a time
  the caller sent; `ellenorizve: true` that does not stamp the actor and the server's clock; a list cleared with null that
  stays; an empty write accepted; the first step written to an Acropora; a body key the DTO does not know accepted; a 404 or a
  refusal that is not an HTTP error.
*/

const NOW = new Date("2026-11-10T12:00:00.000Z");

function emptyFacts(): ProductHusbandryFacts {
  return {
    magyarNev: null,
    genus: "Zebrasoma",
    species: null,
    careDifficulty: null,
    minLiter: null,
    medenceErettsegHonap: null,
    elhelyezesZona: null,
    reefSafe: null,
    reefSafeIndok: null,
    socialKeeping: null,
    aggression: [],
    korallevo: null,
    gerinctelenevo: null,
    feedingType: [],
    etetesGyakorisag: null,
    eloEleseg: null,
    fenyIgeny: null,
    aramlasIgeny: null,
    meretMax: null,
    meretDimenzio: null,
    szarmazas: null,
    kinekNem: null,
    forrasTipus: "gyártó",
    forrasHivatkozas: "https://example.invalid/x",
  };
}

const decide = (
  body: Record<string, unknown>,
  current: ProductHusbandryFacts = emptyFacts(),
): HusbandryDecision =>
  husbandryDecision(
    current,
    plainToInstance(UpdateProductHusbandryDto, body),
    "user-1",
    NOW,
  );

const dataOf = (decision: HusbandryDecision) => {
  assert.ok("data" in decision, JSON.stringify(decision));
  return decision.data as Record<string, unknown>;
};

describe("a tartási írás döntése", () => {
  it("egy szerkesztés ellenőrzés nélkül visszavonja a korábbi ellenőrzést", () => {
    const data = dataOf(decide({ kinekNem: "Kis medencébe nem ajánljuk." }));
    assert.equal(data.kinekNem, "Kis medencébe nem ajánljuk.");
    assert.equal(data.ellenorizteUserId, null);
    assert.equal(data.ellenorizveAt, null);
  });

  it("az `ellenorizve: true` a hívó azonosítóját és a szerver óráját bélyegzi", () => {
    const data = dataOf(decide({ kinekNem: "x", ellenorizve: true }));
    assert.equal(data.ellenorizteUserId, "user-1");
    assert.deepEqual(data.ellenorizveAt, NOW);
    assert.ok(!("ellenorizve" in data));
  });

  it("a puszta ellenőrzés (adat nélkül) a mostani tartalmat ellenőrzi", () => {
    const decision = decide({ ellenorizve: true });
    const data = dataOf(decision);
    assert.equal(data.ellenorizteUserId, "user-1");
    assert.deepEqual((decision as { changed: string[] }).changed, []);
  });

  it("az `ellenorizve: false` visszavon", () => {
    const data = dataOf(decide({ ellenorizve: false }));
    assert.equal(data.ellenorizteUserId, null);
    assert.equal(data.ellenorizveAt, null);
  });

  it("az ellenőrzés forrás nélkül elutasított", () => {
    const decision = decide(
      { ellenorizve: true },
      { ...emptyFacts(), forrasTipus: null, forrasHivatkozas: null },
    );
    assert.ok("refused" in decision);
    assert.equal(decision.refused.length, 2);
  });

  it("a null lista üres listává válik, a null szám és szöveg null marad", () => {
    const data = dataOf(
      decide({ aggression: null, feedingType: null, kinekNem: null }),
    );
    assert.deepEqual(data.aggression, []);
    assert.deepEqual(data.feedingType, []);
    assert.equal(data.kinekNem, null);
  });

  it("az üres írás elutasított, az üres szöveg törlés, nem érték", () => {
    assert.ok("refused" in decide({}));
    const data = dataOf(decide({ kinekNem: "   " }));
    assert.equal(data.kinekNem, null);
  });

  it("az 1-es fokozat Acropora-ra elutasított, más nemzetségre átmegy", () => {
    assert.ok(
      "refused" in
        decide(
          { careDifficulty: "KONNYU" },
          { ...emptyFacts(), genus: "Acropora" },
        ),
    );
    assert.equal(
      dataOf(decide({ careDifficulty: "KONNYU" })).careDifficulty,
      "KONNYU",
    );
  });

  it("a hívótól küldött azonosító vagy idő nem kerül az oszlopokba (a DTO nem ismeri)", () => {
    const dto = plainToInstance(UpdateProductHusbandryDto, {
      kinekNem: "x",
      ellenorizteUserId: "someone-else",
      ellenorizveAt: "2020-01-01T00:00:00Z",
    });
    const errors = validateSync(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    assert.ok(errors.length > 0);
  });
});

describe("a tartási DTO alakja", () => {
  const invalid = (body: Record<string, unknown>) =>
    validateSync(plainToInstance(UpdateProductHusbandryDto, body)).length > 0;

  it("a szöveg szóköz nélkül megy tovább, a null és a hiányzó kulcs rendben", () => {
    const dto = plainToInstance(UpdateProductHusbandryDto, {
      genus: "  Zebrasoma ",
    });
    assert.equal(dto.genus, "Zebrasoma");
    assert.equal(invalid({ kinekNem: null, aggression: null }), false);
    assert.equal(invalid({}), false);
  });

  it("ismeretlen felsorolás-érték és rossz típus elutasított", () => {
    assert.equal(invalid({ careDifficulty: "NEHEZ" }), true);
    assert.equal(invalid({ szarmazas: "VAD" }), true);
    assert.equal(invalid({ aggression: ["BEKES", "DUH"] }), true);
    assert.equal(invalid({ korallevo: "igen" }), true);
    assert.equal(invalid({ medenceErettsegHonap: 2.5 }), true);
    assert.equal(invalid({ medenceErettsegHonap: -1 }), true);
    assert.equal(invalid({ minLiter: "300" }), true);
  });

  it("a négy fokozat és a három zóna mind érvényes", () => {
    for (const careDifficulty of ["KONNYU", "KOZEPES", "HALADO", "SZAKERTO"])
      assert.equal(invalid({ careDifficulty }), false);
    for (const elhelyezesZona of ["ALSO", "KOZEPSO", "FELSO"])
      assert.equal(invalid({ elhelyezesZona }), false);
  });

  it("a hosszkorlát: 300 karakter a kinek-nem mondatnál, 301 már nem", () => {
    assert.equal(invalid({ kinekNem: "a".repeat(300) }), false);
    assert.equal(invalid({ kinekNem: "a".repeat(301) }), true);
  });
});

function husbandryOf(): ProductHusbandry {
  return {
    productId: "p1",
    livestockKind: "FISH",
    facts: { ...emptyFacts() },
    verification: { verified: false, byUserId: null, at: null },
    missing: ["verification"],
  };
}

function serviceWith(result: HusbandryWriteResult | null) {
  const calls: { actor: string }[] = [];
  const repository = {
    read: async () =>
      result && result.kind === "ok" ? result.husbandry : null,
    write: async (
      _id: string,
      actor: string,
      decideFn: (c: ProductHusbandryFacts) => HusbandryDecision,
    ) => {
      calls.push({ actor });
      decideFn(emptyFacts());
      return result ?? ({ kind: "not-found" } as const);
    },
  } as unknown as ProductHusbandryRepository;
  return { service: new ProductHusbandryService(repository), calls };
}

describe("a tartási szolgáltatás", () => {
  it("a hiányzó termék 404, olvasáskor és íráskor is", async () => {
    const { service } = serviceWith(null);
    await assert.rejects(() => service.get("nincs"), NotFoundException);
    await assert.rejects(
      () => service.update("nincs", { kinekNem: "x" }, "user-1"),
      NotFoundException,
    );
  });

  it("az elutasítás 400, az indokokkal és kóddal", async () => {
    const { service } = serviceWith({
      kind: "refused",
      errors: ["Egy.", "Kettő."],
    });
    await assert.rejects(
      () => service.update("p1", { kinekNem: "x" }, "user-1"),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const body = error.getResponse() as { code: string; errors: string[] };
        assert.equal(body.code, "HUSBANDRY_REFUSED");
        assert.deepEqual(body.errors, ["Egy.", "Kettő."]);
        return true;
      },
    );
  });

  it("a sikeres írás a hívót adja át a tárolónak és a tárolt választ adja vissza", async () => {
    const husbandry = husbandryOf();
    const { service, calls } = serviceWith({ kind: "ok", husbandry });
    const out = await service.update("p1", { kinekNem: "x" }, "user-7");
    assert.equal(out, husbandry);
    assert.deepEqual(calls, [{ actor: "user-7" }]);
  });
});
