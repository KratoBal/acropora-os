import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";

import { productImageDocumentId } from "../integrations/medusa/product-image-storage-key.js";
import { InMemoryDocumentStore } from "../service-assets/document-store/in-memory-document-store.js";
import {
  VariantSaleConflict,
  type ProductRepository,
  type StoredProductImage,
  type UploadedProductImage,
  type VariantSale,
} from "./product.repository.js";
import { ProductService, uploadedImageUrl } from "./product.service.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const FILE_ENV = { DOCUMENT_STORE_ROOT: "/var/docs" } as NodeJS.ProcessEnv;
const keyOf = (productId: string, url: string) => ({
  owner: "product" as const,
  ownerId: productId,
  documentId: productImageDocumentId(url),
});

/** The stored row of the uploaded JPEG on `productId`. */
function storedImage(productId: string): StoredProductImage {
  const url = uploadedImageUrl(JPEG);
  return {
    id: "img-1",
    url,
    storageKey: `products/${productId}/${productImageDocumentId(url)}`,
    fileName: "kek.jpg",
  };
}

function repositoryWith(
  product: {
    id: string;
    catalogAuthority: "UNAS" | "ACROPORA" | null;
    unasMirror?: { source: "UNAS" } | null;
  } | null,
  options: { rowStillThere?: boolean } = {},
) {
  const calls: string[] = [];
  const inputs: unknown[] = [];
  return {
    calls,
    inputs,
    repository: {
      create: async (input: unknown) => {
        calls.push("create");
        inputs.push(input);
        return { id: "created" };
      },
      findById: async () => product,
      list: async () => ({ items: [], pagination: {} }),
      update: async (_id: string, input: unknown) => {
        calls.push("update");
        inputs.push(input);
        return { id: "updated" };
      },
      archive: async () => {
        calls.push("archive");
        return { id: "archived" };
      },
      setVariantSellingPrice: async (
        _id: string,
        variantId: string,
        price: { toString(): string },
      ) => {
        calls.push("setVariantSellingPrice");
        inputs.push(price.toString());
        return variantId === "variant-1" ? { id: "priced" } : null;
      },
      setImageAltText: async (
        _id: string,
        imageId: string,
        altText: string | null,
      ) => {
        calls.push("setImageAltText");
        inputs.push(altText);
        return imageId === "img-1" ? { id: "alt-set" } : null;
      },
      setImageOrder: async (_id: string, imageIds: string[]) => {
        calls.push("setImageOrder");
        return imageIds.length === 2 ? { id: "ordered" } : null;
      },
      setVariantSale: async (
        _id: string,
        variantId: string,
        sale: VariantSale | null,
      ) => {
        calls.push(sale ? "setVariantSale" : "clearVariantSale");
        inputs.push(sale);
        if (sale?.grossPrice.toString() === "99999")
          throw new VariantSaleConflict("sale-not-lower", "9990", "99999");
        return variantId === "variant-1" ? { id: "sale-set" } : null;
      },
      addUploadedImage: async (
        _id: string,
        image: UploadedProductImage,
        storeFile: () => Promise<void>,
      ) => {
        calls.push("addUploadedImage");
        inputs.push(image);
        await storeFile();
        if (image.fileName.startsWith("dupla"))
          throw new Prisma.PrismaClientKnownRequestError("duplicate", {
            code: "P2002",
            clientVersion: "test",
          });
        if (image.fileName.startsWith("elhasal")) throw new Error("db down");
        return { id: "uploaded" };
      },
      removeImage: async (id: string, imageId: string) => {
        calls.push("removeImage");
        return imageId === "img-1"
          ? { product: { id: "removed" }, removed: storedImage(id) }
          : null;
      },
      findImage: async (id: string, imageId: string) =>
        imageId === "img-1" ? storedImage(id) : null,
      /** `rowStillThere`: a takarítás idején ugyanezzel a címmel újra van sor */
      releaseImageFileIfUnused: async (
        _id: string,
        _url: string,
        releaseFile: () => Promise<void>,
      ) => {
        if (options.rowStillThere) return false;
        await releaseFile();
        return true;
      },
      takeCatalogAuthority: async () => {
        calls.push("takeCatalogAuthority");
        return {
          product: { id: product?.id, catalogAuthority: "ACROPORA" },
          changed: true,
        };
      },
    } as unknown as ProductRepository,
  };
}

describe("ProductService", () => {
  it("returns a product", async () => {
    const { repository } = repositoryWith({
      id: "product-1",
      catalogAuthority: "ACROPORA",
    });
    const service = new ProductService(repository, {
      RICH_TEXT_IMAGE_HOSTS: "static.acropora.hu, nem hoszt",
    });
    assert.deepEqual(await service.getProduct("product-1"), {
      id: "product-1",
      catalogAuthority: "ACROPORA",
      // the same list the save cleans with; a malformed entry is dropped
      descriptionImageHosts: ["static.acropora.hu"],
    });
  });

  it("throws for a missing product", async () => {
    const { repository } = repositoryWith(null);
    const service = new ProductService(repository);
    await assert.rejects(
      () => service.getProduct("missing"),
      NotFoundException,
    );
  });

  it("checks existence before update and archive", async () => {
    const { repository, calls } = repositoryWith({
      id: "product-1",
      catalogAuthority: "ACROPORA",
      unasMirror: null,
    });
    const service = new ProductService(repository);
    await service.updateProduct("product-1", { name: "Updated" });
    await service.archiveProduct("product-1");
    assert.deepEqual(calls, ["update", "archive"]);
  });

  /**
   * The description is stored through the full-profile sanitizer: what the
   * editor produces passes unchanged, script, iframe and on* do not.
   */
  it("stores the description through the full-profile sanitizer", async () => {
    const { repository, inputs } = repositoryWith({
      id: "product-1",
      catalogAuthority: "ACROPORA",
    });
    const service = new ProductService(repository, {});
    const clean =
      '<table><tbody><tr><td><p>a</p></td></tr></tbody></table><div data-product-card="clx0abc123">Kaja</div>';

    await service.updateProduct("product-1", {
      description: `${clean}<script>alert(1)</script><iframe src="https://x.hu"></iframe><p onclick="x()">b</p>`,
    });
    await service.updateProduct("product-1", { description: null });
    await service.updateProduct("product-1", { name: "Only the name" });

    assert.deepEqual(inputs, [
      { description: `${clean}<p>b</p>` },
      { description: null },
      { name: "Only the name" },
    ]);
  });

  /**
   * The image hosts (barracuda, #1875/#1877): an image from a listed host
   * stays, a foreign one is dropped, and without the variable no image passes.
   */
  it("keeps only description images from RICH_TEXT_IMAGE_HOSTS", async () => {
    const own = '<p><img src="https://static.acropora.hu/a.webp" alt="a"></p>';
    const foreign = '<p><img src="https://cdn.unas.hu/b.jpg" alt="b"></p>';
    const { repository, inputs } = repositoryWith({
      id: "product-1",
      catalogAuthority: "ACROPORA",
    });
    await new ProductService(repository, {
      RICH_TEXT_IMAGE_HOSTS: "static.acropora.hu",
    }).updateProduct("product-1", { description: own + foreign });
    await new ProductService(repository, {}).updateProduct("product-1", {
      description: own,
    });
    const [listed, none] = inputs as { description: string }[];
    assert.match(listed!.description, /static\.acropora\.hu\/a\.webp/);
    assert.doesNotMatch(listed!.description, /cdn\.unas\.hu/);
    assert.doesNotMatch(none!.description, /<img/);
  });

  /*
    A NEW PRODUCT'S DESCRIPTION goes through the same cleaning (barracuda,
    #1893 review): before, createProduct passed it on as it came. What turns
    this red: create storing raw HTML again, or touching an absent field.
  */
  it("cleans a new product's description the same way", async () => {
    const { repository, inputs } = repositoryWith(null);
    const service = new ProductService(repository, {
      RICH_TEXT_IMAGE_HOSTS: "static.acropora.hu",
    });
    await service.createProduct({
      name: "Új",
      description:
        '<p onclick="x()">a</p><script>alert(1)</script><p><img src="https://static.acropora.hu/a.webp" alt="a"><img src="https://cdn.unas.hu/b.jpg" alt="b"></p>',
    } as never);
    await service.createProduct({ name: "Leírás nélkül" } as never);
    const [cleaned, without] = inputs as {
      name: string;
      description?: string;
    }[];
    assert.equal(
      cleaned!.description,
      '<p>a</p><p><img src="https://static.acropora.hu/a.webp" alt="a"></p>',
    );
    assert.deepEqual(without, { name: "Leírás nélkül" });
  });

  it("blocks generic writes to an UNAS managed product", async () => {
    const { repository, calls } = repositoryWith({
      id: "product-1",
      catalogAuthority: "UNAS",
      unasMirror: { source: "UNAS" },
    });
    const service = new ProductService(repository);

    await assert.rejects(
      service.updateProduct("product-1", { name: "Forbidden" }),
      (error) =>
        error instanceof ConflictException &&
        error.message === "PRODUCT_MANAGED_BY_UNAS",
    );
    await assert.rejects(
      service.archiveProduct("product-1"),
      ConflictException,
    );
    assert.deepEqual(calls, []);
  });

  /**
   * The transfer is allowed exactly where the generic write is NOT: an
   * UNAS-managed product is the only thing worth taking over. Asserting only
   * that it succeeds on an ACROPORA product would pass on a service that
   * refuses the case the feature exists for.
   */
  it("takes authority from a product the webshop manages", async () => {
    const { repository, calls } = repositoryWith({
      id: "product-1",
      catalogAuthority: "UNAS",
      unasMirror: { source: "UNAS" },
    });
    const service = new ProductService(repository);

    const result = await service.takeCatalogAuthority("product-1", "user-1");

    assert.deepEqual(calls, ["takeCatalogAuthority"]);
    assert.equal(
      (result as { catalogAuthority: string }).catalogAuthority,
      "ACROPORA",
    );
  });

  /**
   * Unresolved authority means we do not know who owns the row. Handing it
   * over on a guess is the one outcome that cannot be undone by a later
   * sync, so it fails closed here exactly as the generic write does.
   */
  it("refuses to hand over a product whose owner is unknown", async () => {
    const { repository, calls } = repositoryWith({
      id: "product-1",
      catalogAuthority: null,
    });
    const service = new ProductService(repository);

    await assert.rejects(
      service.takeCatalogAuthority("product-1", "user-1"),
      (error) =>
        error instanceof ConflictException &&
        error.message === "PRODUCT_CATALOG_AUTHORITY_UNRESOLVED",
    );
    assert.deepEqual(calls, []);
  });

  it("throws for a missing product before touching the repository", async () => {
    const { repository, calls } = repositoryWith(null);
    const service = new ProductService(repository);

    await assert.rejects(
      () => service.takeCatalogAuthority("missing", "user-1"),
      NotFoundException,
    );
    assert.deepEqual(calls, []);
  });

  it("fails closed when catalog authority has not been resolved", async () => {
    const { repository, calls } = repositoryWith({
      id: "product-1",
      catalogAuthority: null,
    });
    const service = new ProductService(repository);

    await assert.rejects(
      service.updateProduct("product-1", { name: "Forbidden" }),
      (error) =>
        error instanceof ConflictException &&
        error.message === "PRODUCT_CATALOG_AUTHORITY_UNRESOLVED",
    );
    assert.deepEqual(calls, []);
  });

  /**
   * THE OWN PRICE IS EDITED ONLY WHERE IT IS THE SHOP'S PRICE (T4.1-D3). Under
   * UNAS authority the mirror price holds and the own price never reaches the
   * shop, so a number typed in there would only mislead: 409 like every other
   * master-data write. A variant id from another product is a 404, not a write.
   */
  it("sets an own price only on a product the OS owns", async () => {
    const own = repositoryWith({
      id: "product-1",
      catalogAuthority: "ACROPORA",
    });
    const result = await new ProductService(own.repository).setVariantPrice(
      "product-1",
      "variant-1",
      { grossPrice: "12990" },
      "user-1",
    );
    assert.deepEqual(result, { id: "priced" });
    assert.deepEqual(own.calls, ["setVariantSellingPrice"]);
    assert.deepEqual(own.inputs, ["12990"]);

    const unas = repositoryWith({ id: "product-1", catalogAuthority: "UNAS" });
    await assert.rejects(
      () =>
        new ProductService(unas.repository).setVariantPrice(
          "product-1",
          "variant-1",
          { grossPrice: "12990" },
        ),
      ConflictException,
    );
    assert.deepEqual(unas.calls, []);
  });

  it("answers 404 for a variant of another product", async () => {
    const own = repositoryWith({
      id: "product-1",
      catalogAuthority: "ACROPORA",
    });
    await assert.rejects(
      () =>
        new ProductService(own.repository).setVariantPrice(
          "product-1",
          "variant-of-another",
          { grossPrice: "100" },
        ),
      NotFoundException,
    );
  });

  /** THE IMAGE EDITOR (T4.1-D3, slice 4): OS-owned products only; a blank alt is no alt. */
  it("edits image alt and order only on a product the OS owns", async () => {
    const own = repositoryWith({
      id: "product-1",
      catalogAuthority: "ACROPORA",
    });
    const service = new ProductService(own.repository);
    assert.deepEqual(
      await service.setImageAlt("product-1", "img-1", { altText: "  Kék  " }),
      { id: "alt-set" },
    );
    await service.setImageAlt("product-1", "img-1", { altText: "   " });
    assert.deepEqual(own.inputs, ["Kék", null]);
    await assert.rejects(
      () => service.setImageAlt("product-1", "img-x", { altText: "x" }),
      NotFoundException,
    );
    assert.deepEqual(
      await service.setImageOrder("product-1", { imageIds: ["a", "b"] }),
      { id: "ordered" },
    );
    await assert.rejects(
      () => service.setImageOrder("product-1", { imageIds: ["a"] }),
      BadRequestException,
    );

    const unas = repositoryWith({ id: "product-1", catalogAuthority: "UNAS" });
    const unasService = new ProductService(unas.repository);
    await assert.rejects(
      () => unasService.setImageAlt("product-1", "img-1", { altText: "x" }),
      ConflictException,
    );
    await assert.rejects(
      () => unasService.setImageOrder("product-1", { imageIds: ["a", "b"] }),
      ConflictException,
    );
    assert.deepEqual(unas.calls, []);
  });

  /**
   * UPLOAD, DELETE AND FILE (T4.1-D3, slice 6). MI PIROSÍT: ha a fájl a sor
   * NÉLKÜL marad a tárolóban (elhasaló sor), vagy egy ismétlés törli a meglévő
   * sor fájlját; ha nem kép, UNAS-gazdájú termék vagy be nem állított tároló
   * mellett bármi íródik; ha a törlés után a fájl megmarad.
   */
  it("uploads an image: the file first, then the row; a non-image is refused", async () => {
    const own = repositoryWith({
      id: "product-1",
      catalogAuthority: "ACROPORA",
    });
    const store = new InMemoryDocumentStore();
    const service = new ProductService(own.repository, FILE_ENV, store);
    const url = uploadedImageUrl(JPEG);

    assert.deepEqual(
      await service.uploadImage(
        "product-1",
        { originalname: "kék korall.png", buffer: JPEG },
        "user-1",
      ),
      { id: "uploaded" },
    );
    assert.deepEqual(own.inputs[0], {
      url,
      storageKey: `products/product-1/${productImageDocumentId(url)}`,
      // a kiterjesztés a tartalomé, nem a névé
      fileName: "kék korall.jpg",
    });
    assert.ok(await store.get(keyOf("product-1", url)));

    await assert.rejects(
      () =>
        service.uploadImage("product-1", {
          originalname: "level.pdf",
          buffer: Buffer.from("%PDF-1.7"),
        }),
      BadRequestException,
    );
    await assert.rejects(
      () => service.uploadImage("product-1", undefined),
      BadRequestException,
    );
    assert.deepEqual(own.calls, ["addUploadedImage"]);
  });

  it("keeps the file of an image already there, and drops it when the row fails", async () => {
    const own = repositoryWith({
      id: "product-1",
      catalogAuthority: "ACROPORA",
    });
    const store = new InMemoryDocumentStore();
    const service = new ProductService(own.repository, FILE_ENV, store);
    const key = keyOf("product-1", uploadedImageUrl(JPEG));

    await assert.rejects(
      () =>
        service.uploadImage("product-1", {
          originalname: "dupla.jpg",
          buffer: JPEG,
        }),
      ConflictException,
    );
    assert.ok(await store.get(key), "the existing row's file stays");

    await assert.rejects(
      () =>
        service.uploadImage("product-1", {
          originalname: "elhasal.jpg",
          buffer: JPEG,
        }),
      /db down/,
    );
    assert.equal(await store.get(key), null, "no file without a row");
  });

  it("writes nothing on a UNAS product or without a configured store", async () => {
    const unas = repositoryWith({ id: "product-1", catalogAuthority: "UNAS" });
    const store = new InMemoryDocumentStore();
    await assert.rejects(
      () =>
        new ProductService(unas.repository, FILE_ENV, store).uploadImage(
          "product-1",
          { originalname: "kek.jpg", buffer: JPEG },
        ),
      ConflictException,
    );
    await assert.rejects(
      () =>
        new ProductService(unas.repository, FILE_ENV, store).deleteImage(
          "product-1",
          "img-1",
        ),
      ConflictException,
    );

    const own = repositoryWith({
      id: "product-1",
      catalogAuthority: "ACROPORA",
    });
    // a memóriabeli tároló újraindulásnál elviszi a bájtokat: gyökér nélkül nem írunk bele
    await assert.rejects(
      () =>
        new ProductService(own.repository, {}, store).uploadImage("product-1", {
          originalname: "kek.jpg",
          buffer: JPEG,
        }),
      ServiceUnavailableException,
    );
    assert.deepEqual([...unas.calls, ...own.calls], []);
    assert.equal(
      await store.get(keyOf("product-1", uploadedImageUrl(JPEG))),
      null,
    );
  });

  it("deletes the row, then its file; another product's image is a 404", async () => {
    const own = repositoryWith({
      id: "product-1",
      catalogAuthority: "ACROPORA",
    });
    const store = new InMemoryDocumentStore();
    const key = keyOf("product-1", uploadedImageUrl(JPEG));
    await store.put(key, JPEG);
    const service = new ProductService(own.repository, FILE_ENV, store);

    assert.deepEqual(
      await service.deleteImage("product-1", "img-1", "user-1"),
      {
        id: "removed",
      },
    );
    assert.equal(await store.get(key), null);
    await assert.rejects(
      () => service.deleteImage("product-1", "img-x"),
      NotFoundException,
    );
  });

  it("keeps the file when the same image was uploaded again meanwhile (barracuda, #2142)", async () => {
    const own = repositoryWith(
      { id: "product-1", catalogAuthority: "ACROPORA" },
      { rowStillThere: true },
    );
    const store = new InMemoryDocumentStore();
    const key = keyOf("product-1", uploadedImageUrl(JPEG));
    await store.put(key, JPEG);

    await new ProductService(own.repository, FILE_ENV, store).deleteImage(
      "product-1",
      "img-1",
    );
    assert.ok(await store.get(key), "a re-uploaded row lost its file");
  });

  it("serves the stored file with the type of its content", async () => {
    const own = repositoryWith({ id: "product-1", catalogAuthority: "UNAS" });
    const store = new InMemoryDocumentStore();
    await store.put(keyOf("product-1", uploadedImageUrl(JPEG)), JPEG);
    const service = new ProductService(own.repository, FILE_ENV, store);

    const file = await service.imageFile("product-1", "img-1");
    assert.equal(file.contentType, "image/jpeg");
    assert.equal(file.fileName, "kek.jpg");
    assert.deepEqual([...file.bytes], [...JPEG]);
    await assert.rejects(
      () => service.imageFile("product-1", "img-x"),
      NotFoundException,
    );
  });

  /**
   * THE OWN SALE (T4.1-D3, sale slice 1). MI PIROSÍT: ha UNAS-gazdájú terméken,
   * üres vagy lejárt ablakkal bármi íródik; ha az ütközés nem 409; ha az idegen
   * változat nem 404.
   */
  it("sets a sale only on an OS product, with a non-empty window in the future", async () => {
    const own = repositoryWith({
      id: "product-1",
      catalogAuthority: "ACROPORA",
    });
    const service = new ProductService(own.repository);
    const now = new Date("2026-11-04T12:00:00Z");
    const sale = {
      grossPrice: "7990",
      startsAt: "2026-11-10T00:00:00+01:00",
      endsAt: "2026-11-17T00:00:00+01:00",
    };

    assert.deepEqual(
      await service.setVariantSale("product-1", "variant-1", sale, "u", now),
      { id: "sale-set" },
    );
    const written = own.inputs[0] as VariantSale;
    assert.equal(written.grossPrice.toString(), "7990");
    assert.equal(written.startsAt.toISOString(), "2026-11-09T23:00:00.000Z");
    assert.equal(written.endsAt.toISOString(), "2026-11-16T23:00:00.000Z");

    for (const rossz of [
      { ...sale, endsAt: sale.startsAt },
      { ...sale, startsAt: sale.endsAt, endsAt: sale.startsAt },
      {
        ...sale,
        startsAt: "2026-10-01T00:00:00Z",
        endsAt: "2026-11-04T12:00:00Z",
      },
    ])
      await assert.rejects(
        () => service.setVariantSale("product-1", "variant-1", rossz, "u", now),
        BadRequestException,
        JSON.stringify(rossz),
      );
    await assert.rejects(
      () =>
        service.setVariantSale(
          "product-1",
          "variant-1",
          { ...sale, grossPrice: "99999" },
          "u",
          now,
        ),
      ConflictException,
    );
    await assert.rejects(
      () => service.setVariantSale("product-1", "variant-x", sale, "u", now),
      NotFoundException,
    );
    assert.deepEqual(await service.clearVariantSale("product-1", "variant-1"), {
      id: "sale-set",
    });
    assert.deepEqual(own.calls, [
      "setVariantSale",
      "setVariantSale",
      "setVariantSale",
      "clearVariantSale",
    ]);

    const unas = repositoryWith({ id: "product-1", catalogAuthority: "UNAS" });
    const unasService = new ProductService(unas.repository);
    await assert.rejects(
      () =>
        unasService.setVariantSale("product-1", "variant-1", sale, "u", now),
      ConflictException,
    );
    await assert.rejects(
      () => unasService.clearVariantSale("product-1", "variant-1"),
      ConflictException,
    );
    assert.deepEqual(unas.calls, []);
  });

  it("answers 409 when a regular price would not stay above the sale", async () => {
    const own = repositoryWith({
      id: "product-1",
      catalogAuthority: "ACROPORA",
    });
    (
      own.repository as unknown as {
        setVariantSellingPrice: () => Promise<never>;
      }
    ).setVariantSellingPrice = async () => {
      throw new VariantSaleConflict("sale-not-lower", "7000", "7990");
    };
    await assert.rejects(
      () =>
        new ProductService(own.repository).setVariantPrice(
          "product-1",
          "variant-1",
          { grossPrice: "7000" },
        ),
      (error: unknown) =>
        error instanceof ConflictException &&
        (error.getResponse() as { code: string }).code ===
          "PRODUCT_SALE_NOT_LOWER",
    );
  });

  it("answers 409 with its own code when a running sale's start would move (barracuda #2219)", async () => {
    const own = repositoryWith({
      id: "product-1",
      catalogAuthority: "ACROPORA",
    });
    let passedNow: unknown;
    (
      own.repository as unknown as {
        setVariantSale: (...args: unknown[]) => Promise<never>;
      }
    ).setVariantSale = async (...args: unknown[]) => {
      passedNow = args[4];
      throw new VariantSaleConflict("sale-start-locked", "9990", "7990");
    };
    const now = new Date("2026-11-12T00:00:00.000Z");
    await assert.rejects(
      () =>
        new ProductService(own.repository).setVariantSale(
          "product-1",
          "variant-1",
          {
            grossPrice: "7990",
            startsAt: "2026-11-12T00:00:00Z",
            endsAt: "2026-11-17T00:00:00Z",
          },
          undefined,
          now,
        ),
      (error: unknown) =>
        error instanceof ConflictException &&
        (error.getResponse() as { code: string }).code ===
          "PRODUCT_SALE_START_LOCKED",
    );
    // the service's "now" is the repository's: the guard and the window check read the same moment
    assert.equal(passedNow, now);
  });
});
