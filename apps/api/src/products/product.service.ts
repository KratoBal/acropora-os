import { createHash } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import { sanitizeRichHtml } from "@acropora/rich-text";
import type { ProductCatalogAuthority } from "@acropora/types";

import type { CreateProductDto } from "./dto/create-product.dto.js";
import type { ProductListQueryDto } from "./dto/product-list-query.dto.js";
import type {
  SetProductImageAltDto,
  SetProductImageOrderDto,
} from "./dto/product-image.dto.js";
import type { SetVariantPriceDto } from "./dto/set-variant-price.dto.js";
import type { SetVariantSaleDto } from "./dto/set-variant-sale.dto.js";
import type { UpdateProductDto } from "./dto/update-product.dto.js";
import { richTextImageHosts } from "../homepage-content/homepage-content.service.js";
import {
  detectImageContentType,
  imageFileNameFor,
} from "../integrations/medusa/image-content-type.js";
import { productImageDocumentId } from "../integrations/medusa/product-image-storage-key.js";
import {
  assertStorageKeyMatches,
  storageKeyFor,
} from "../service-assets/document-store/document-storage-key.js";
import {
  documentUnavailableMessage,
  type DocumentKey,
  type DocumentStore,
} from "../service-assets/document-store/document-store.js";
import {
  DOCUMENT_STORE,
  documentStoreEnabled,
} from "../service-assets/document-store/document-store.provider.js";
import {
  ProductRepository,
  VariantSaleConflict,
} from "./product.repository.js";

/**
 * A FELTÖLTÖTT KÉP AZONOSÍTÓJA A `url` MEZŐBEN (T4.1-D3, 6. szelet). A tárolókulcs
 * a `url` lenyomatából jön (`productImageDocumentId`), és a vetítés a tárolóból
 * tölti fel a képet a boltba, tehát a mező nem webcím, hanem a tartalom
 * lenyomata. Ugyanaz a fájl másodszor ugyanazt az azonosítót kapja, és a
 * `[productId, url]` egyedi kulcs megfogja.
 */
export const UPLOADED_IMAGE_URL_PREFIX = "os-upload:";

export function uploadedImageUrl(bytes: Uint8Array): string {
  return `${UPLOADED_IMAGE_URL_PREFIX}${createHash("sha256").update(bytes).digest("hex")}`;
}

/** A feltöltés fájlja, amennyi belőle kell (a multer `File`-ja ennél több). */
export interface ProductImageUpload {
  originalname: string;
  buffer: Buffer;
}

/** The environment the description's image hosts come from (`RICH_TEXT_IMAGE_HOSTS`). */
export const PRODUCT_ENVIRONMENT = Symbol("PRODUCT_ENVIRONMENT");

/**
 * A LEIRAS A TELJES PROFIL TISZTITOJAN AT TAROLODIK (Balazs dontese,
 * 2026-10-25 22:30 UTC, msg 1564043552525389924: a termekleiras a teljes
 * szerkesztot kapja).
 *
 * AZ OS SAJAT IROI (letrehozas es modositas) ezen at tarolnak: ugyanaz a
 * tisztito fut itt, mint a szerkeszto elonezeteben, es amit a szerkeszto
 * eloallit, azt valtozatlanul engedi at (allitas a web tesztjei kozott). A
 * `null` es a hianyzo mezo erintetlen marad.
 *
 * NEM EZ AZ EGYETLEN VEDELMI HATAR, es ezt ki kell mondani (barracuda, #1893
 * review): a UNAS-import a UNAS HTML-jet valtozatlanul tarolja
 * (`unas-product-sync.repository`, `unas-apply.repository`), mert a kirakat
 * tisztitoja (acropora-commerce `sanitize-description.ts`) epp arra a HTML-re
 * van hangolva (stilusok, tablazatok). Ezert MINDEN kirajzolas is tisztit: az OS
 * termeklapja es a JEV-attekintes `sanitizeDescriptionHtml`-lel, a kirakat
 * `sanitizeDescription`-nel. Mert 2026-10-26.
 *
 * A KEP CSAK A `RICH_TEXT_IMAGE_HOSTS` HOSZTJAIROL jon, mint a kezdolapon es a
 * cikkben (barracuda, #1875/#1877): egy idegen hoszt kepe a boltban harmadik
 * feles betoltes. Az ures lista egy kepet sem enged at.
 */
function withSanitizedDescription<T extends { description?: string | null }>(
  input: T,
  imageHosts: readonly string[],
): T {
  if (typeof input.description !== "string") return input;
  return {
    ...input,
    description: sanitizeRichHtml(input.description, {
      profile: "full",
      allowedImageHosts: imageHosts,
    }),
  };
}

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(
    private readonly products: ProductRepository,
    @Optional()
    @Inject(PRODUCT_ENVIRONMENT)
    private readonly environment: NodeJS.ProcessEnv = process.env,
    @Optional()
    @Inject(DOCUMENT_STORE)
    private readonly documentStore?: DocumentStore,
  ) {}

  createProduct(input: CreateProductDto, actorUserId?: string) {
    return this.products.create(
      withSanitizedDescription(input, richTextImageHosts(this.environment)),
      actorUserId,
    );
  }

  async updateProduct(id: string, input: UpdateProductDto) {
    const product = await this.requireProduct(id);
    this.assertLocallyManaged(product);
    return this.products.update(
      id,
      withSanitizedDescription(input, richTextImageHosts(this.environment)),
    );
  }

  /**
   * A változat saját eladási ára (T4.1-D3). Csak az OS-gazdájú terméknél:
   * UNAS-gazdánál az árat a tükör adja, és a saját ár ott nem kerül a boltba,
   * tehát egy itt beírt szám csak megtévesztene (409, ugyanaz, mint a többi
   * törzsadat-írásnál).
   */
  async setVariantPrice(
    id: string,
    variantId: string,
    input: SetVariantPriceDto,
    actorUserId?: string,
  ) {
    const product = await this.requireProduct(id);
    this.assertLocallyManaged(product);
    const updated = await this.products
      .setVariantSellingPrice(
        id,
        variantId,
        new Prisma.Decimal(input.grossPrice),
        actorUserId,
      )
      .catch(saleConflictToHttp);
    if (!updated)
      throw new NotFoundException({
        code: "PRODUCT_VARIANT_NOT_FOUND",
        message: "A változat nem ehhez a termékhez tartozik.",
      });
    return updated;
  }

  /**
   * A VÁLTOZAT SAJÁT AKCIÓJA (T4.1-D3, akciós ár 1. szelet). Csak OS-gazdájú
   * terméknél (UNAS-gazdánál a tükör akciója áll). A vég a kezdet után, és a
   * jövőben kell legyen: egy már lejárt akció beállítása elírás. Az akció a
   * saját eladási árnál olcsóbb (a tranzakció méri, 409).
   */
  async setVariantSale(
    id: string,
    variantId: string,
    input: SetVariantSaleDto,
    actorUserId?: string,
    now: Date = new Date(),
  ) {
    const product = await this.requireProduct(id);
    this.assertLocallyManaged(product);
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (!(startsAt < endsAt))
      throw new BadRequestException({
        code: "PRODUCT_SALE_WINDOW_EMPTY",
        message: "Az akció vége a kezdete után legyen.",
      });
    if (!(endsAt > now))
      throw new BadRequestException({
        code: "PRODUCT_SALE_ALREADY_OVER",
        message: "Az akció vége már elmúlt.",
      });
    const updated = await this.products
      .setVariantSale(
        id,
        variantId,
        { grossPrice: new Prisma.Decimal(input.grossPrice), startsAt, endsAt },
        actorUserId,
      )
      .catch(saleConflictToHttp);
    if (!updated) throw variantNotFound();
    return updated;
  }

  /** Az akció törlése; egy akció nélküli változaton is rendben (nincs mit venni). */
  async clearVariantSale(id: string, variantId: string, actorUserId?: string) {
    const product = await this.requireProduct(id);
    this.assertLocallyManaged(product);
    const updated = await this.products.setVariantSale(
      id,
      variantId,
      null,
      actorUserId,
    );
    if (!updated) throw variantNotFound();
    return updated;
  }

  /**
   * KÉP ALT-SZÖVEGE ÉS SORRENDJE (T4.1-D3, 4. szelet). Csak OS-gazdájú terméknél:
   * UNAS-gazdánál a szinkron minden futásnál újraírja a képeket (409, mint a többi
   * törzsadat-írásnál). Az üres alt null: a kirakat a nevet adja helyette.
   */
  async setImageAlt(
    id: string,
    imageId: string,
    input: SetProductImageAltDto,
    actorUserId?: string,
  ) {
    const product = await this.requireProduct(id);
    this.assertLocallyManaged(product);
    const altText = input.altText?.trim() ? input.altText.trim() : null;
    const updated = await this.products.setImageAltText(
      id,
      imageId,
      altText,
      actorUserId,
    );
    if (!updated)
      throw new NotFoundException({
        code: "PRODUCT_IMAGE_NOT_FOUND",
        message: "A kép nem ehhez a termékhez tartozik.",
      });
    return updated;
  }

  async setImageOrder(
    id: string,
    input: SetProductImageOrderDto,
    actorUserId?: string,
  ) {
    const product = await this.requireProduct(id);
    this.assertLocallyManaged(product);
    const updated = await this.products.setImageOrder(
      id,
      input.imageIds,
      actorUserId,
    );
    if (!updated)
      throw new BadRequestException({
        code: "PRODUCT_IMAGE_ORDER_MISMATCH",
        message:
          "A sorrendnek a termék minden képét pontosan egyszer kell tartalmaznia.",
      });
    return updated;
  }

  /**
   * KÉP FELTÖLTÉSE (T4.1-D3, 6. szelet). Csak OS-gazdájú terméknél, és csak a
   * tartalmából felismert képet (JPEG, PNG, GIF, WebP: amit a vetítés is
   * felismer). A sorrend nem cserélhető: előbb a TÁROLÓ, aztán a SOR, mert a sor
   * azt állítja, hogy a fájl megvan (a másoló mintája), és mindkettő a termék
   * zárja alatt fut. Ha a sor nem jön létre, a fájl takarítása is a zár alatt
   * fut, és csak akkor töröl, ha nincs rá sor: ha ugyanez a kép már a termék
   * képe, az a sor használja ugyanazt a fájlt.
   */
  async uploadImage(
    id: string,
    file: ProductImageUpload | undefined,
    actorUserId?: string,
  ) {
    if (!file?.buffer?.length)
      throw new BadRequestException({
        code: "PRODUCT_IMAGE_FILE_REQUIRED",
        message: "A feltöltendő kép kötelező.",
      });
    const product = await this.requireProduct(id);
    this.assertLocallyManaged(product);
    const contentType = detectImageContentType(file.buffer);
    if (!contentType)
      throw new BadRequestException({
        code: "PRODUCT_IMAGE_NOT_AN_IMAGE",
        message: "Csak JPEG, PNG, GIF vagy WebP kép tölthető fel.",
      });
    const store = this.imageStore();
    const url = uploadedImageUrl(file.buffer);
    const key = imageKey(id, url);
    try {
      return await this.products.addUploadedImage(
        id,
        {
          url,
          storageKey: storageKeyFor(key),
          fileName: imageFileNameFor(
            safeFileName(file.originalname),
            contentType,
          ),
        },
        () => store.put(key, file.buffer),
        actorUserId,
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException({
          code: "PRODUCT_IMAGE_DUPLICATE",
          message: "Ez a kép már a termék képei között van.",
        });
      await this.discardImageFile(id, url);
      throw error;
    }
  }

  /**
   * KÉP TÖRLÉSE (T4.1-D3, 6. szelet). A sor a tranzakcióban megy, a fájl utána:
   * egy elhasaló fájltörlés árva fájlt hagy (az egyeztetés megtalálja), nem
   * fájl nélküli sort. A boltból a következő vetítés veszi ki.
   */
  async deleteImage(id: string, imageId: string, actorUserId?: string) {
    const product = await this.requireProduct(id);
    this.assertLocallyManaged(product);
    const result = await this.products.removeImage(id, imageId, actorUserId);
    if (!result)
      throw new NotFoundException({
        code: "PRODUCT_IMAGE_NOT_FOUND",
        message: "A kép nem ehhez a termékhez tartozik.",
      });
    // csak a sor saját fájlja megy: ha a tárolt kulcs nem a számított, nem találgatunk
    const key = imageKey(id, result.removed.url);
    if (result.removed.storageKey === storageKeyFor(key))
      await this.discardImageFile(id, result.removed.url);
    return result.product;
  }

  /**
   * EGY KÉP FÁJLJA A TÁROLÓBÓL (a feltöltött képnek nincs webcíme, a felület
   * innen mutatja). Bármelyik gazdájú terméknél olvasható, ha a fájl megvan.
   */
  async imageFile(id: string, imageId: string) {
    const image = await this.products.findImage(id, imageId);
    if (!image)
      throw new NotFoundException({
        code: "PRODUCT_IMAGE_NOT_FOUND",
        message: "A kép nem ehhez a termékhez tartozik.",
      });
    if (!image.storageKey)
      throw new NotFoundException({
        code: "PRODUCT_IMAGE_NOT_STORED",
        message: "A kép még nincs a tárolóban.",
      });
    const key = imageKey(id, image.url);
    assertStorageKeyMatches(image.storageKey, key);
    const bytes = await this.imageStore().get(key);
    if (!bytes)
      throw new ServiceUnavailableException(documentUnavailableMessage());
    const contentType = detectImageContentType(bytes);
    if (!contentType)
      throw new ServiceUnavailableException(
        "A tárolt fájl tartalma nem ismerhető fel képként.",
      );
    return {
      bytes: Buffer.from(bytes),
      contentType,
      fileName: image.fileName ?? imageFileNameFor("kep", contentType),
    };
  }

  /**
   * A tároló, ha valóban be van állítva. A memóriabeli tároló `ready`, de egy
   * újraindulás elvinné a bájtjait (`documentStoreEnabled`), tehát éles képet
   * nem tehetünk bele.
   */
  private imageStore(): DocumentStore {
    if (!this.documentStore || !documentStoreEnabled(this.environment))
      throw new ServiceUnavailableException(
        "A dokumentum-tároló nincs beállítva ebben a példányban.",
      );
    return this.documentStore;
  }

  /** A fájl takarítása a termék zárja alatt, és csak ha már nincs rá sor. */
  private async discardImageFile(productId: string, url: string) {
    const key = imageKey(productId, url);
    try {
      await this.products.releaseImageFileIfUnused(productId, url, async () => {
        await this.documentStore?.delete(key);
      });
    } catch (error) {
      this.logger.warn(
        `A termékkép fájlja nem törlődött (${storageKeyFor(key)}): ${String(error)}`,
      );
    }
  }

  async archiveProduct(id: string) {
    const product = await this.requireProduct(id);
    this.assertLocallyManaged(product);
    return this.products.archive(id);
  }

  /**
   * A törzsadat gazdájának átvétele: UNAS -> ACROPORA, egy irányban.
   *
   * Ez az a pont, ahol a webshop-szinkron leáll a terméken. Nem "beállítás",
   * hanem döntés: az átvétel után egy UNAS oldali javítás NEM érkezik meg
   * ide, és ezt a felhasználónak a művelet előtt kell tudnia.
   *
   * Visszafelé NINCS út ebben a körben, és ez szándékos. Egy visszaadás
   * ugyanis nem az ellenkező irányú kapcsoló: a UNAS a következő szinkronnál
   * felülírná a nevet és a leírást, amit itt közben megszerkesztettek. Amíg
   * nincs eldöntve, mi történjen az így elvesző szerkesztésekkel, a
   * visszaadás nem létezik.
   *
   * Feloldatlan (null) authority esetén ugyanaz a fail-closed válasz jön,
   * mint az írásnál: nem tudjuk, kié a termék, tehát nem adjuk oda.
   */
  async takeCatalogAuthority(id: string, actorUserId?: string) {
    const product = await this.requireProduct(id);
    if (product.catalogAuthority === null)
      throw new ConflictException("PRODUCT_CATALOG_AUTHORITY_UNRESOLVED");
    const { product: updated } = await this.products.takeCatalogAuthority(
      id,
      actorUserId,
    );
    return updated;
  }

  /** The detail, with the image hosts its description editor may use. */
  async getProduct(id: string) {
    const product = await this.requireProduct(id);
    return {
      ...product,
      descriptionImageHosts: richTextImageHosts(this.environment),
    };
  }

  listProducts(query: ProductListQueryDto) {
    return this.products.list(query);
  }

  listCategoryOptions() {
    return this.products.listCategoryOptions();
  }

  listBrandOptions() {
    return this.products.listBrandOptions();
  }

  private async requireProduct(id: string) {
    const product = await this.products.findById(id);
    if (!product) {
      throw new NotFoundException("A termék nem található.");
    }
    return product;
  }

  private assertLocallyManaged(product: {
    catalogAuthority: ProductCatalogAuthority | null;
  }) {
    if (product.catalogAuthority === "UNAS")
      throw new ConflictException("PRODUCT_MANAGED_BY_UNAS");
    if (product.catalogAuthority !== "ACROPORA")
      throw new ConflictException("PRODUCT_CATALOG_AUTHORITY_UNRESOLVED");
  }
}

function imageKey(productId: string, url: string): DocumentKey {
  return {
    owner: "product",
    ownerId: productId,
    documentId: productImageDocumentId(url),
  };
}

/** A feltöltött fájl neve tárolható alakban (a dokumentum-felvétel szabálya). */
function safeFileName(name: string): string {
  const safe = name
    .normalize("NFKC")
    .replace(/[\\/\u0000-\u001f\u007f]/g, "-")
    .slice(0, 180)
    .trim();
  return safe || "kep";
}

function variantNotFound() {
  return new NotFoundException({
    code: "PRODUCT_VARIANT_NOT_FOUND",
    message: "A változat nem ehhez a termékhez tartozik.",
  });
}

/** Az akció és a rendes ár ütközése 409, a két árral együtt. */
function saleConflictToHttp(error: unknown): never {
  if (!(error instanceof VariantSaleConflict)) throw error;
  if (error.code === "own-price-missing")
    throw new ConflictException({
      code: "PRODUCT_SALE_OWN_PRICE_MISSING",
      message: "Előbb a saját eladási árat kell megadni, az akció ahhoz mér.",
    });
  throw new ConflictException({
    code: "PRODUCT_SALE_NOT_LOWER",
    message: `Az akciós ár (${error.saleGrossPrice} Ft) csak a rendes ár (${error.sellingGrossPrice} Ft) alatt lehet.`,
    sellingGrossPrice: error.sellingGrossPrice,
    saleGrossPrice: error.saleGrossPrice,
  });
}
