import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import type {
  OperationsLogEntryPhotoDto,
  OperationsTaskFieldDto,
  OperationsTaskTemplateDto,
} from "@acropora/types";

import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import type { OperationsLogEntriesRepository } from "./operations-log-entries.repository.js";
import {
  OperationsLogPhotosService,
  PHOTO_ONLY_MESSAGE,
} from "./operations-log-photos.service.js";
import type { OperationsLogRepository } from "./operations-log.repository.js";

/*
  AZ ÜZEMELTETÉSI NAPLÓ KÉPEI (task os-uzemeltetesi-naplo, S2b). MI PIROSIT: ha idegen rögzítő is csatolhatna képet; ha nem fénykép
  mezőre menne kép; ha a kivezetett fénykép mező képe elveszne (egy offline sorban várt kép); ha a PDF átmenne; ha az
  újraküldés másodikat hozna létre, vagy más feltöltő kulcsára idegen kép jönne vissza; ha a mező kép-korlátja nem védene.
*/
const PDF = Buffer.from("%PDF-1.4\n%âã\n1 0 obj\n<<>>\nendobj\n", "latin1");
const file = (mimetype: string, buffer: Buffer) =>
  ({ originalname: "x", mimetype, buffer }) as Express.Multer.File;

function field(
  key: string,
  type: OperationsTaskFieldDto["type"],
  removedAt: string | null = null,
): OperationsTaskFieldDto {
  return {
    id: `f-${key}`,
    key,
    label: `Címke ${key}`,
    type,
    unit: null,
    required: false,
    meterRole: null,
    sortOrder: 0,
    removedAt,
  };
}

const PHOTO_DTO: OperationsLogEntryPhotoDto = {
  id: "d1",
  fieldKey: "kep",
  fieldLabel: "Címke kep",
  fileName: "x.png",
  contentType: "image/png",
  sizeBytes: 3,
  caption: null,
  createdAt: "2026-11-13T10:00:00.000Z",
};

function fixture(
  over: Partial<{
    entry: { id: string; recordedById: string; templateId: string } | null;
    count: number;
    existing: {
      photo: OperationsLogEntryPhotoDto;
      entryId: string;
      uploadedById: string | null;
    } | null;
  }> = {},
) {
  const stored: unknown[] = [];
  const entries = {
    photoByClientOperationId: async () => over.existing ?? null,
    entryRef: async () =>
      over.entry === undefined
        ? { id: "e1", recordedById: "u1", templateId: "t1" }
        : over.entry,
    photoCount: async () => over.count ?? 0,
    addPhoto: async (row: unknown) => {
      stored.push(row);
      return PHOTO_DTO;
    },
  } as unknown as OperationsLogEntriesRepository;
  const templates = {
    templateById: async () =>
      ({
        fields: [field("kep", "PHOTO"), field("rendben", "BOOLEAN")],
        retiredFields: [field("regi_kep", "PHOTO", "2026-11-01T00:00:00.000Z")],
      }) as unknown as OperationsTaskTemplateDto,
  } as unknown as OperationsLogRepository;
  const store = {
    put: async () => {
      throw new Error("a tárolóhoz nem szabad eljutni");
    },
  } as unknown as DocumentStore;
  return {
    photos: new OperationsLogPhotosService(entries, templates, store),
    stored,
  };
}

describe("OperationsLogPhotosService.addPhoto", () => {
  const png = file("image/png", Buffer.alloc(0));

  it("nem létező bejegyzésre 404, idegen rögzítőnek 403", async () => {
    await assert.rejects(
      fixture({ entry: null }).photos.addPhoto("e1", png, "u1", {
        fieldKey: "kep",
      }),
      NotFoundException,
    );
    await assert.rejects(
      fixture().photos.addPhoto("e1", png, "u9", { fieldKey: "kep" }),
      ForbiddenException,
    );
  });

  it("nem fénykép mezőre és ismeretlen kulcsra 400", async () => {
    const { photos } = fixture();
    for (const fieldKey of ["rendben", "nincs"])
      await assert.rejects(
        photos.addPhoto("e1", png, "u1", { fieldKey }),
        /nem fénykép mező/,
      );
  });

  it("a kivezetett fénykép mező is fogad (a PDF-et viszont a fájlfajta utasítja el, nem a mező)", async () => {
    const { photos, stored } = fixture();
    await assert.rejects(
      photos.addPhoto("e1", file("application/pdf", PDF), "u1", {
        fieldKey: "regi_kep",
      }),
      (error: Error) =>
        error instanceof BadRequestException &&
        error.message === PHOTO_ONLY_MESSAGE,
    );
    assert.equal(stored.length, 0);
  });

  it("a mezőnkénti korlát 409, a felismerhetetlen tartalom 400", async () => {
    await assert.rejects(
      fixture({ count: 10 }).photos.addPhoto("e1", png, "u1", {
        fieldKey: "kep",
      }),
      ConflictException,
    );
    await assert.rejects(
      fixture().photos.addPhoto(
        "e1",
        file("image/png", Buffer.from("nem kep")),
        "u1",
        { fieldKey: "kep" },
      ),
      BadRequestException,
    );
  });

  it("az újraküldés a meglévő képet adja; más feltöltő vagy másik bejegyzés kulcsára 409", async () => {
    const existing = { photo: PHOTO_DTO, entryId: "e1", uploadedById: "u1" };
    const input = { fieldKey: "kep", clientOperationId: "photo-abcdef01" };
    const { photos, stored } = fixture({ existing });
    assert.deepEqual(await photos.addPhoto("e1", png, "u1", input), {
      photo: PHOTO_DTO,
      created: false,
    });
    assert.equal(stored.length, 0);
    await assert.rejects(
      photos.addPhoto("e1", png, "u2", input),
      ConflictException,
    );
    await assert.rejects(
      photos.addPhoto("e2", png, "u1", input),
      ConflictException,
    );
  });
});
