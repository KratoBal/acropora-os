import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import type {
  OperationsTaskFieldInput,
  OperationsTaskTemplateDto,
  OperationsTaskTemplateInput,
} from "@acropora/types";

import {
  OperationsTemplateConflictError,
  type OperationsLogRepository,
  OperationsTaskTemplateWrite,
} from "./operations-log.repository.js";
import { OperationsLogService } from "./operations-log.service.js";

/*
  AZ ÜZEMELTETÉSI NAPLÓ SABLONJAI (task os-uzemeltetesi-naplo, S1). MI PIROSIT: ha egy sablon cél nélkül, vagy egyszerre eszközre
  ÉS kategóriára szólhatna; ha archivált eszközre vagy kivezetett kategóriára felvehető volna; ha a mezők szabályai (a közös
  `operationsFieldErrors`) nem futnának a szerveren; ha a mezők kulcsa nem a címkéből, hanem ütközve vagy a meglévő kulcs
  elvesztésével készülne; ha egy nem szám mező mértékegységet vagy vízóra szerepet vinne a tárba; ha a `DELETE` törölne.
*/
type FakeRepository = Pick<
  OperationsLogRepository,
  | "listTemplates"
  | "templateById"
  | "fieldKeys"
  | "assetIsLive"
  | "categoryIsActive"
  | "createTemplate"
  | "replaceTemplate"
  | "retireTemplate"
>;

function fixture(
  over: Partial<{
    assetLive: boolean;
    categoryActive: boolean;
    existing: boolean;
    conflict: boolean;
    used: string[];
    active: string[];
    /** az aktív mezők típusa kulcs szerint (alapértelmezés: minden aktív mező szöveg) */
    types: Record<string, "NUMBER" | "BOOLEAN" | "TEXT" | "PHOTO">;
  }> = {},
) {
  const calls: { write?: OperationsTaskTemplateWrite; replaceId?: string } = {};
  const repository: FakeRepository = {
    listTemplates: async () => [],
    templateById: async () =>
      over.existing === false ? null : ({ id: "t1" } as never),
    fieldKeys: async () =>
      over.existing === false
        ? null
        : {
            used: new Set(over.used ?? ["viz"]),
            active: new Set(over.active ?? ["viz"]),
            typeOf: new Map(
              (over.active ?? ["viz"]).map((key) => [
                key,
                over.types?.[key] ?? "TEXT",
              ]),
            ),
          },
    assetIsLive: async () => over.assetLive ?? true,
    categoryIsActive: async () => over.categoryActive ?? true,
    createTemplate: async (write) => {
      calls.write = write;
      return { id: "new" } as OperationsTaskTemplateDto;
    },
    replaceTemplate: async (id, write) => {
      if (over.conflict) throw new OperationsTemplateConflictError();
      calls.write = write;
      calls.replaceId = id;
      return over.existing === false
        ? null
        : ({ id } as OperationsTaskTemplateDto);
    },
    retireTemplate: async () => over.existing !== false,
  };
  return {
    service: new OperationsLogService(repository as OperationsLogRepository),
    calls,
  };
}

const input = (
  over: Partial<OperationsTaskTemplateInput> = {},
): OperationsTaskTemplateInput => ({
  name: "Homokszűrő visszamosás",
  frequency: "WEEKLY",
  assetId: "asset-1",
  fields: [],
  ...over,
});
const field = (
  over: Partial<OperationsTaskFieldInput> = {},
): OperationsTaskFieldInput => ({
  label: "Vízóra állás előtte",
  type: "NUMBER",
  unit: "m3",
  ...over,
});

describe("a sablon célja", () => {
  it("pontosan egy cél kell: egy eszköz VAGY egy kategória", async () => {
    const { service } = fixture();
    await assert.rejects(
      service.create(input({ assetId: null, assetCategoryId: null }), "u1"),
      BadRequestException,
    );
    await assert.rejects(
      service.create(input({ assetId: "a", assetCategoryId: "c" }), "u1"),
      BadRequestException,
    );
    // az érvényes pár: a kitöltött cél átmegy (kategóriával is)
    const { service: ok, calls } = fixture();
    await ok.create(input({ assetId: null, assetCategoryId: "c" }), "u1");
    assert.equal(calls.write?.assetCategoryId, "c");
    assert.equal(calls.write?.assetId, null);
  });

  it("archivált eszközre és kivezetett kategóriára nem vehető fel", async () => {
    await assert.rejects(
      fixture({ assetLive: false }).service.create(input(), "u1"),
      /archivált/,
    );
    await assert.rejects(
      fixture({ categoryActive: false }).service.create(
        input({ assetId: null, assetCategoryId: "c" }),
        "u1",
      ),
      /kivezetett/,
    );
  });

  it("üres név és szóközös üres azonosító nem megy át, a név körülvágva tárolódik", async () => {
    await assert.rejects(
      fixture().service.create(input({ name: "   " }), "u1"),
      BadRequestException,
    );
    const { service, calls } = fixture();
    await service.create(
      input({
        name: "  Visszamosás ",
        description: "  ",
        assetId: " asset-1 ",
      }),
      "u1",
    );
    assert.equal(calls.write?.name, "Visszamosás");
    assert.equal(calls.write?.description, null);
    assert.equal(calls.write?.assetId, "asset-1");
  });
});

describe("a mezők", () => {
  it("a közös szabályok futnak: nem szám mezőn mértékegység és szerep elutasítva", async () => {
    const { service } = fixture();
    await assert.rejects(
      service.create(
        input({ fields: [field({ type: "TEXT", unit: "m3" })] }),
        "u1",
      ),
      BadRequestException,
    );
    await assert.rejects(
      service.create(
        input({
          fields: [field({ type: "BOOLEAN", unit: null, meterRole: "AFTER" })],
        }),
        "u1",
      ),
      BadRequestException,
    );
    await assert.rejects(
      service.create(
        input({
          fields: [
            field({ meterRole: "BEFORE" }),
            field({ label: "Másik", meterRole: "BEFORE" }),
          ],
        }),
        "u1",
      ),
      /előtte/,
    );
  });

  it("a kulcsok a címkéből jönnek, ütközésnél számozva; a szám mező szerepe és egysége megmarad, másé nincs", async () => {
    const { service, calls } = fixture();
    await service.create(
      input({
        fields: [
          field({ meterRole: "BEFORE" }),
          field({ label: "Vízóra állás előtte", meterRole: "AFTER" }),
          { label: "Rendellenesség", type: "BOOLEAN", required: true },
        ],
      }),
      "u1",
    );
    const fields = calls.write!.fields;
    assert.deepEqual(
      fields.map((f) => f.key),
      ["vizora_allas_elotte", "vizora_allas_elotte_2", "rendellenesseg"],
    );
    assert.deepEqual(
      fields.map((f) => [f.unit, f.meterRole, f.required]),
      [
        ["m3", "BEFORE", false],
        ["m3", "AFTER", false],
        [null, null, true],
      ],
    );
  });

  it("módosításkor a meglévő aktív mező megtartja a kulcsát átnevezve is", async () => {
    const { service, calls } = fixture({ types: { viz: "NUMBER" } });
    await service.update(
      "t1",
      input({
        fields: [
          field({ key: "viz", label: "Vízóra (új név)" }),
          field({ label: "Víz" }),
        ],
      }),
      "u1",
    );
    assert.equal(calls.replaceId, "t1");
    assert.deepEqual(
      calls.write!.fields.map((f) => f.key),
      ["viz", "viz_2"],
    );
  });
});

describe("a kulcsok a sablon korábbi mezőihez képest (barracuda, #2497)", () => {
  it("a korábban elhagyott mező kulcsát egy új, azonos címkéjű mező nem kapja meg", async () => {
    // a „viz” mező egy korábbi mentésben kikerült (kivezetett): used igen, active nem
    const { service, calls } = fixture({ used: ["viz"], active: [] });
    await service.update(
      "t1",
      input({ fields: [{ label: "Víz", type: "TEXT" }] }),
      "u1",
    );
    assert.deepEqual(
      calls.write!.fields.map((f) => f.key),
      ["viz_2"],
    );
  });

  it("a kivezetett mező kulcsát a kliens küldve sem kapja vissza", async () => {
    const { service, calls } = fixture({ used: ["viz"], active: [] });
    await service.update(
      "t1",
      input({ fields: [{ key: "viz", label: "Víz", type: "TEXT" }] }),
      "u1",
    );
    assert.deepEqual(
      calls.write!.fields.map((f) => f.key),
      ["viz_2"],
    );
  });

  it("a kliens tetszőleges kulcsa nem lesz kulcs: csak a sablon aktív mezőjéé", async () => {
    const { service, calls } = fixture({ used: ["viz"], active: ["viz"] });
    await service.update(
      "t1",
      input({
        fields: [
          { key: "viz", label: "Víz", type: "TEXT" },
          { key: "Tetszőleges szöveg", label: "Más", type: "TEXT" },
          { key: "nem-letezo", label: "Harmadik", type: "TEXT" },
        ],
      }),
      "u1",
    );
    assert.deepEqual(
      calls.write!.fields.map((f) => f.key),
      ["viz", "mas", "harmadik"],
    );
  });

  it("létrehozáskor a kliens kulcsa nem számít, a kulcs a címkéből készül", async () => {
    const { service, calls } = fixture();
    await service.create(
      input({ fields: [{ key: "viz", label: "Vízóra", type: "TEXT" }] }),
      "u1",
    );
    assert.deepEqual(
      calls.write!.fields.map((f) => f.key),
      ["vizora"],
    );
  });
});

/*
  A TIPUSVALTAS UJ MEZO (barracuda, #2499): egy meglevo mezo mas tipussal ugyanazt a kulcsot kapna, es a bejegyzesek (S2) egy
  kulcs alatt regi szam es uj szoveg erteket kevernek. MI PIROSIT: ha a tipusvalto mezo megtartja a kulcsat; ha a valtozatlan
  tipusu mezo is uj kulcsot kapna (a kulcs-stabilitas elveszne).
*/
describe("a típusváltás új mező, új kulccsal", () => {
  it("a más típusú meglévő mező nem viszi tovább a kulcsát, a régi kulcs nem kerül újra kiosztásra", async () => {
    const { service, calls } = fixture({
      used: ["viz"],
      active: ["viz"],
      types: { viz: "NUMBER" },
    });
    await service.update(
      "t1",
      input({ fields: [{ key: "viz", label: "Víz", type: "TEXT" }] }),
      "u1",
    );
    assert.deepEqual(
      calls.write!.fields.map((f) => [f.key, f.type]),
      [["viz_2", "TEXT"]],
    );
  });

  it("a körülvágandó alakban küldött kulcs sem csúszik át a típus-őrön", async () => {
    const { service, calls } = fixture({
      used: ["viz"],
      active: ["viz"],
      types: { viz: "NUMBER" },
    });
    await service.update(
      "t1",
      input({ fields: [{ key: " viz ", label: "Víz", type: "TEXT" }] }),
      "u1",
    );
    assert.deepEqual(
      calls.write!.fields.map((f) => f.key),
      ["viz_2"],
    );
  });

  it("az azonos típusú meglévő mező megtartja a kulcsát", async () => {
    const { service, calls } = fixture({
      used: ["viz"],
      active: ["viz"],
      types: { viz: "TEXT" },
    });
    await service.update(
      "t1",
      input({ fields: [{ key: "viz", label: "Víz (új név)", type: "TEXT" }] }),
      "u1",
    );
    assert.deepEqual(
      calls.write!.fields.map((f) => f.key),
      ["viz"],
    );
  });
});

describe("az egyidejűség-őr", () => {
  it("ha a sablont közben más módosította, 409, és a mezők nem íródnak felül", async () => {
    const { service, calls } = fixture({ conflict: true });
    await assert.rejects(
      service.update(
        "t1",
        { ...input(), expectedUpdatedAt: "2026-11-13T09:00:00.000Z" },
        "u1",
      ),
      ConflictException,
    );
    assert.equal(calls.write, undefined);
  });
});

describe("olvasás, módosítás, kivezetés", () => {
  it("nem létező sablon: 404 olvasáskor, módosításkor és kivezetéskor", async () => {
    const { service } = fixture({ existing: false });
    await assert.rejects(service.get("x"), NotFoundException);
    await assert.rejects(service.update("x", input(), "u1"), NotFoundException);
    await assert.rejects(service.retire("x", "u1"), NotFoundException);
  });

  it("a kivezetés kimondja, hogy kivezetett, nem törölt", async () => {
    assert.deepEqual(await fixture().service.retire("t1", "u1"), {
      retired: true,
    });
  });
});
