import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";

import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import type { MortalityRepository } from "./mortality.repository.js";
import {
  MortalityPhotosService,
  PHOTO_ONLY_MESSAGE,
} from "./mortality-photos.service.js";

const PDF = Buffer.from("%PDF-1.4\n%âã\n1 0 obj\n<<>>\nendobj\n", "latin1");

function service(exists: boolean) {
  const stored: unknown[] = [];
  const repository = {
    exists: async () => exists,
    addPhoto: async (row: unknown) => {
      stored.push(row);
      return row;
    },
  } as unknown as MortalityRepository;
  const store = {
    put: async () => {
      throw new Error("a tárolóhoz nem szabad eljutni");
    },
  } as unknown as DocumentStore;
  return { photos: new MortalityPhotosService(repository, store), stored };
}

function file(mimetype: string, buffer: Buffer) {
  return { originalname: "x", mimetype, buffer } as Express.Multer.File;
}

describe("MortalityPhotosService.addPhoto", () => {
  it("nem létező bejegyzésre 404", async () => {
    const { photos } = service(false);
    await assert.rejects(
      photos.addPhoto("nope", file("image/png", Buffer.alloc(0)), "u"),
      NotFoundException,
    );
  });

  it("PDF-et 400-zal elutasít, mielőtt bármit tárolna", async () => {
    const { photos, stored } = service(true);
    await assert.rejects(
      photos.addPhoto("rec-1", file("application/pdf", PDF), "u"),
      (error: Error) =>
        error instanceof BadRequestException &&
        error.message === PHOTO_ONLY_MESSAGE,
    );
    assert.equal(stored.length, 0);
  });

  it("felismerhetetlen tartalmat is elutasít", async () => {
    const { photos } = service(true);
    await assert.rejects(
      photos.addPhoto("rec-1", file("image/png", Buffer.from("nem kep")), "u"),
      BadRequestException,
    );
  });
});
