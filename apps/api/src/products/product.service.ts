import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { sanitizeRichHtml } from "@acropora/rich-text";
import type { ProductCatalogAuthority } from "@acropora/types";

import type { CreateProductDto } from "./dto/create-product.dto.js";
import type { ProductListQueryDto } from "./dto/product-list-query.dto.js";
import type { UpdateProductDto } from "./dto/update-product.dto.js";
import { richTextImageHosts } from "../homepage-content/homepage-content.service.js";
import { ProductRepository } from "./product.repository.js";

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
  constructor(
    private readonly products: ProductRepository,
    @Optional()
    @Inject(PRODUCT_ENVIRONMENT)
    private readonly environment: NodeJS.ProcessEnv = process.env,
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
