import { randomUUID } from "node:crypto";

import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import type {
  ExchangeRateLookupResult,
  ProjectOption,
  PurchaseInvoiceDetail,
  PurchaseInvoiceListResponse,
  PurchaseInvoiceResult,
  PurchaseProductConflictLookup,
  PurchaseProductSearchResult,
  SupplierCodeConflict,
} from "@acropora/types";

import { withUniqueCode } from "../common/unique-code.util.js";
import { eanCheckDigitValid } from "../products/barcode.util.js";
import { MnbExchangeRateService } from "../integrations/mnb/mnb-exchange-rate.service.js";
import { SuppliersRepository } from "../suppliers/suppliers.repository.js";
import type { CreatePurchaseInvoiceDto } from "./dto/create-purchase-invoice.dto.js";
import type { PurchaseInvoiceListQueryDto } from "./dto/purchase-invoice-list-query.dto.js";
import {
  PurchaseInvoiceRepository,
  type CreatePurchaseInvoiceLine,
} from "./purchase-invoice.repository.js";
import { PurchaseProductSearchService } from "./purchase-product-search.service.js";
import { navLineSource, navSourceLines } from "./nav-line-source.js";
import { ProjectRepository } from "./project.repository.js";
import { SupplierLineSuggestionService } from "./line-suggestions/supplier-line-suggestion.service.js";
import { SupplierCodeLearningRepository } from "./supplier-code-learning.repository.js";

@Injectable()
export class PurchasingService {
  // No UnasApiClient/UnasAuthService dependency anymore - the synchronous
  // UNAS stock push that used to happen here has been removed entirely.
  // Local stock is written (via the shared postInventoryMovement primitive,
  // see purchase-invoice.repository.ts) in the same DB transaction as the
  // invoice itself, and a UnasStockSyncOutbox row is created alongside it;
  // the actual UNAS publish happens later, out of band, in
  // unas-stock-sync-outbox.service.ts. This means invoice creation can no
  // longer fail or block because UNAS is slow or unreachable.
  constructor(
    private readonly invoices: PurchaseInvoiceRepository,
    private readonly suppliers: SuppliersRepository,
    private readonly productSearch: PurchaseProductSearchService,
    private readonly mnbRates: MnbExchangeRateService,
    private readonly projects: ProjectRepository,
    // #1199 P-026: closes the suggestion runs of the saved lines. Optional so
    // a construction without it (tests, a module without the pilot) works as
    // before: no run is resolved, and nothing else changes.
    @Optional()
    private readonly lineSuggestions?: SupplierLineSuggestionService,
    // learns (supplier code -> product) from lines a person linked. Optional
    // for the same reason: without it nothing is learned, nothing else changes
    @Optional()
    private readonly codeLearning?: SupplierCodeLearningRepository,
  ) {}

  private readonly logger = new Logger(PurchasingService.name);

  listProjects(): Promise<ProjectOption[]> {
    return this.projects.listAssignable();
  }

  createProject(name: string, actorUserId: string): Promise<ProjectOption> {
    const normalizedName = name.trim();
    if (normalizedName.length < 2)
      throw new BadRequestException(
        "A projekt neve legalább 2 karakter legyen.",
      );
    return this.projects.create(normalizedName, actorUserId);
  }

  searchProducts(
    query: string | undefined,
  ): Promise<PurchaseProductSearchResult[]> {
    return this.productSearch.search(query);
  }

  async getExchangeRate(
    currency: string,
    date: string,
  ): Promise<ExchangeRateLookupResult> {
    const parsedDate = new Date(date);
    if (Number.isNaN(parsedDate.getTime()))
      throw new BadRequestException("Érvénytelen dátum.");
    try {
      const resolved = await this.mnbRates.getRateForDate(currency, parsedDate);
      return {
        currency: currency.trim().toUpperCase(),
        quotedDate: resolved.quotedDate,
        rate: resolved.rate,
      };
    } catch (error) {
      throw this.mapExchangeRateError(error);
    }
  }

  /// Az MNB külső szolgáltatás, és kieshet (2026-07-23 és 2026-09-29 között
  /// a https címe minden hívást elutasított, lásd a kliens kommentjét). A
  /// hívó felé ezért csak egy érthető, a kézi megadásra terelő üzenetet adunk
  /// vissza a nyers hibakód helyett; a részletek szerveroldalon a kliens
  /// logjában maradnak.
  private mapExchangeRateError(error: unknown): Error {
    if (error instanceof NotFoundException) return error;
    return new BadGatewayException(
      "Az MNB árfolyam-szolgáltatás jelenleg nem érhető el. Add meg az árfolyamot kézzel.",
    );
  }

  list(
    query: PurchaseInvoiceListQueryDto,
  ): Promise<PurchaseInvoiceListResponse> {
    return this.invoices.list(query);
  }

  async getDetail(id: string): Promise<PurchaseInvoiceDetail> {
    const detail = await this.invoices.findById(id);
    if (!detail)
      throw new NotFoundException("A beszerzési számla nem található.");
    return detail;
  }

  /**
   * Új termék felvétele ELŐTT (#1199 P-026): van-e már termék ezzel az
   * EAN-nel, vagy ezzel a beszállítói cikkszámmal ennél a szállítónál. A
   * felület ebből ajánlja fel a meglévőhöz kötést.
   */
  async newProductConflicts(query: {
    ean?: string;
    supplierId?: string;
    supplierSku?: string;
  }): Promise<PurchaseProductConflictLookup> {
    const ean = query.ean?.trim();
    const supplierSku = query.supplierSku?.trim();
    const [byEan] = ean ? await this.invoices.barcodeOwners([ean]) : [];
    const [bySupplierSku] =
      query.supplierId && supplierSku
        ? await this.invoices.supplierSkuOwners(query.supplierId, [supplierSku])
        : [];
    const owner = (row?: {
      variantId: string;
      sku: string;
      productName: string;
    }) =>
      row
        ? {
            variantId: row.variantId,
            sku: row.sku,
            productName: row.productName,
          }
        : null;
    return { byEan: owner(byEan), bySupplierSku: owner(bySupplierSku) };
  }

  /**
   * A számlával létrehozandó új termékek NEM lehetnek már meglévők. Egy
   * foglalt EAN vagy egy már leképezett beszállítói cikkszám azt jelenti,
   * hogy a termék megvan: új termék helyett a meglévőhöz kell kötni. Egy
   * számlán belül két új termék sem kaphatja ugyanazt.
   */
  private async assertNewProductsAreNew(
    supplierId: string,
    lines: readonly CreatePurchaseInvoiceLine[],
  ): Promise<void> {
    const created = lines.flatMap((line) =>
      line.createLocalProduct ? [line.createLocalProduct] : [],
    );
    if (created.length === 0) return;
    const eans = created.flatMap((product) =>
      product.ean ? [product.ean] : [],
    );
    const skus = created.flatMap((product) =>
      product.supplierSku ? [product.supplierSku] : [],
    );
    const brandIds = [
      ...new Set(
        created.flatMap((product) =>
          product.brandId ? [product.brandId] : [],
        ),
      ),
    ];
    const repeated = (values: string[]) =>
      values.find((value, index) => values.indexOf(value) !== index);
    const repeatedEan = repeated(eans);
    if (repeatedEan)
      throw new BadRequestException(
        `Két új termék ugyanazt az EAN-t kapná: ${repeatedEan}.`,
      );
    const repeatedSku = repeated(skus);
    if (repeatedSku)
      throw new BadRequestException(
        `Két új termék ugyanazt a beszállítói cikkszámot kapná: ${repeatedSku}.`,
      );
    const [takenEan] = eans.length
      ? await this.invoices.barcodeOwners(eans)
      : [];
    if (takenEan)
      throw new ConflictException(
        `A(z) ${takenEan.code} EAN már a(z) „${takenEan.productName}” (${takenEan.sku}) termékhez tartozik: a sort ehhez kösd, ne hozz létre új terméket.`,
      );
    const [takenSku] = skus.length
      ? await this.invoices.supplierSkuOwners(supplierId, skus)
      : [];
    if (takenSku)
      throw new ConflictException(
        `A(z) ${takenSku.supplierSku} beszállítói cikkszám ennél a szállítónál már a(z) „${takenSku.productName}” (${takenSku.sku}) termékhez tartozik: a sort ehhez kösd.`,
      );
    const activeBrands = brandIds.length
      ? await this.invoices.activeBrandIds(brandIds)
      : new Set<string>();
    const unknownBrand = brandIds.find((id) => !activeBrands.has(id));
    if (unknownBrand)
      throw new BadRequestException(
        "A kiválasztott márka nem található vagy archivált.",
      );
  }

  async createInvoice(
    input: CreatePurchaseInvoiceDto,
    actorUserId: string,
  ): Promise<PurchaseInvoiceResult> {
    if (input.lines.length === 0)
      throw new BadRequestException(
        "Legalább egy tétel szükséges a számlához.",
      );

    // BELSOS UT, ES EZT KI KELL MONDANI. A beszerzesi szamla rogzitese
    // PURCHASING_MANAGE jog alatt all, amit partner-oldali felhasznalo nem kap
    // meg; a szallito adatai (orszag) itt a szamla helyessegehez kellenek, nem
    // partner-nezetkent. A hatokort AZERT irjuk ki, mert a kotelezo parameter
    // pont ezt a dontest hozza a hivo helyre: itt nem szukitunk, es ez latszik.
    const supplier = await this.suppliers.detail(input.supplierId, {
      kind: "internal",
    });
    if (!supplier) throw new NotFoundException("A beszállító nem található.");
    const supplierCountry = supplier.country.trim().toUpperCase();
    if (input.source === "EU" && (!supplierCountry || supplierCountry === "HU"))
      throw new BadRequestException(
        "EU-s beszerzéshez csak nem magyarországi beszállító választható.",
      );
    if (input.source !== "EU" && supplierCountry !== "HU")
      throw new BadRequestException(
        "Belföldi beszerzéshez csak magyarországi beszállító választható.",
      );

    const currency = input.currency.trim().toUpperCase();
    const invoiceDate = new Date(input.invoiceDate);
    if (Number.isNaN(invoiceDate.getTime()))
      throw new BadRequestException("Érvénytelen számla kelte.");

    let exchangeRate: Prisma.Decimal | null;
    let vatRate: Prisma.Decimal | null;
    if (input.source === "EU") {
      vatRate = null;
      if (currency === "HUF") {
        exchangeRate = null;
      } else if (input.exchangeRate !== undefined) {
        exchangeRate = new Prisma.Decimal(input.exchangeRate);
      } else {
        // Az MNB kieshet (lásd mapExchangeRateError) - a számla rögzítését
        // emiatt nem szabad hagyni összeomlani, helyette egyértelmű kérést
        // adunk a kézi árfolyam megadására.
        try {
          const resolved = await this.mnbRates.getRateForDate(
            currency,
            invoiceDate,
          );
          exchangeRate = new Prisma.Decimal(resolved.rate);
        } catch {
          throw new BadRequestException(
            "Az árfolyam automatikus lekérdezése nem sikerült. Add meg az árfolyamot kézzel.",
          );
        }
      }
    } else {
      // HU_MANUAL / HU_NAV: belföldi számla, mindig HUF, nincs MNB-lekérdezés
      // (lásd docs/CURRENT_STATUS.md - a séma szándékosan egyetlen,
      // számla-szintű ÁFA-kulcsot tárol, nem soronkéntit).
      if (currency !== "HUF")
        throw new BadRequestException(
          "Belföldi számlánál a pénznem csak HUF lehet.",
        );
      exchangeRate = null;
      if (input.vatRate === undefined)
        throw new BadRequestException(
          "Belföldi számlánál az ÁFA-kulcs megadása kötelező.",
        );
      vatRate = new Prisma.Decimal(input.vatRate);
    }

    const variantIds = input.lines
      .map((line) => line.variantId)
      .filter((variantId): variantId is string => Boolean(variantId));
    for (const line of input.lines) {
      if (line.variantId && line.createLocalProduct)
        throw new BadRequestException(
          "Egy számlasor vagy meglévő termékhez kapcsolható, vagy új helyi terméket hozhat létre; a kettő egyszerre nem adható meg.",
        );
    }
    const { warehouseId, variants } =
      await this.invoices.currentStock(variantIds);
    const requestedProjectIds = new Set(
      input.lines.flatMap((line) =>
        (line.projectAllocations ?? []).map(
          (allocation) => allocation.projectId,
        ),
      ),
    );
    if (requestedProjectIds.size > 0) {
      const assignableProjects = await this.projects.listAssignable();
      const assignableIds = new Set(
        assignableProjects.map((project) => project.id),
      );
      for (const projectId of requestedProjectIds) {
        if (!assignableIds.has(projectId))
          throw new BadRequestException(
            "A kiválasztott projekt nem található vagy már nem fogadhat új készletfoglalást.",
          );
      }
    }

    // A NAV SOR FORRASA A TAROLT NAV ADATBOL jon, nem a klienstol (#1199
    // A-007). Nem allit meg semmit: ha nincs NAV adat, vagy a sorszam nem
    // egyertelmu, a ket mezo null marad.
    // A módosító és a sztornó okirat (jóváíró) nem vételezhető be: nem áru
    // érkezik vele, hanem egy korábbi számla változik.
    if (input.navIncomingInvoiceId) {
      const operation = await this.invoices.navInvoiceOperation(
        input.navIncomingInvoiceId,
      );
      if (operation === "MODIFY" || operation === "STORNO")
        throw new BadRequestException(
          "A NAV módosító vagy sztornó okirata nem vételezhető be.",
        );
    }

    const navLines = input.navIncomingInvoiceId
      ? navSourceLines(
          await this.invoices.navInvoiceParsedData(input.navIncomingInvoiceId),
        )
      : null;

    const preparedLines: CreatePurchaseInvoiceLine[] = [];
    for (const line of input.lines) {
      const navSource = navLineSource(navLines, line.navLineNumber);
      if (!Number.isFinite(line.actualQuantity) || line.actualQuantity < 0)
        throw new BadRequestException(
          "A ténylegesen bevételezett mennyiség nem lehet negatív.",
        );
      const allocationProjectIds = new Set<string>();
      const projectAllocations = (line.projectAllocations ?? []).map(
        (allocation) => {
          if (allocationProjectIds.has(allocation.projectId))
            throw new BadRequestException(
              "Egy számlasoron ugyanaz a projekt csak egyszer szerepelhet.",
            );
          allocationProjectIds.add(allocation.projectId);
          if (!Number.isFinite(allocation.quantity) || allocation.quantity <= 0)
            throw new BadRequestException(
              "A projektfoglalás mennyiségének nullánál nagyobbnak kell lennie.",
            );
          return {
            projectId: allocation.projectId,
            quantity: new Prisma.Decimal(allocation.quantity),
          };
        },
      );
      const allocatedQuantity = projectAllocations.reduce(
        (sum, allocation) => sum.plus(allocation.quantity),
        new Prisma.Decimal(0),
      );
      const actualQuantity = new Prisma.Decimal(line.actualQuantity);
      if (allocatedQuantity.greaterThan(actualQuantity))
        throw new BadRequestException(
          "A projektekhez rendelt összmennyiség nem lehet több a ténylegesen bevételezett mennyiségnél.",
        );
      if (
        projectAllocations.length > 0 &&
        !line.variantId &&
        !line.createLocalProduct
      )
        throw new BadRequestException(
          "Projektkészlet csak termékhez kapcsolt számlasorból hozható létre.",
        );

      // Terméktörzsben nem szereplő tétel is rögzíthető (pl. a számlán van,
      // de a termék még nincs felvéve nálunk) - ilyenkor nincs mit
      // egyeztetni a saját cikkszámmal/mennyiséggel, ezért a számlán
      // szereplő megnevezés és az egység kötelező, a helyi készlethatás és
      // a UNAS-szinkron pedig kimarad rá (lásd repository/create).
      if (!line.variantId && !line.createLocalProduct) {
        const sourceDescription = line.sourceDescription?.trim();
        if (!sourceDescription)
          throw new BadRequestException(
            "A terméktörzsben nem szereplő tételeknél a számlán szereplő megnevezés megadása kötelező.",
          );
        if (!line.unit.trim())
          throw new BadRequestException(
            `Az egység megadása kötelező: ${sourceDescription}.`,
          );
        if (!Number.isFinite(line.actualQuantity) || line.actualQuantity < 0)
          throw new BadRequestException(
            `Érvénytelen mennyiség: ${sourceDescription}.`,
          );
        if (!Number.isFinite(line.unitNet) || line.unitNet < 0)
          throw new BadRequestException(
            `Érvénytelen beszerzési ár: ${sourceDescription}.`,
          );
        preparedLines.push({
          variantId: null,
          sku: null,
          createLocalProduct: null,
          sourceDescription,
          ...navSource,
          orderedQuantity: new Prisma.Decimal(line.orderedQuantity),
          actualQuantity: new Prisma.Decimal(line.actualQuantity),
          unit: line.unit.trim(),
          unitNet: new Prisma.Decimal(line.unitNet),
          discountPercent:
            line.discountPercent !== undefined
              ? new Prisma.Decimal(line.discountPercent)
              : null,
          syncStatus: "NOT_LINKED",
          syncError: null,
          syncToUnas: false,
          projectAllocations,
        });
        continue;
      }

      if (line.createLocalProduct) {
        const name = line.createLocalProduct.name.trim();
        const sourceDescription = line.sourceDescription?.trim() || name;
        if (name.length < 2)
          throw new BadRequestException(
            "Az új helyi termék neve legalább 2 karakter legyen.",
          );
        if (!line.unit.trim())
          throw new BadRequestException(
            `Az egység megadása kötelező: ${name}.`,
          );
        if (!Number.isFinite(line.actualQuantity) || line.actualQuantity < 0)
          throw new BadRequestException(`Érvénytelen mennyiség: ${name}.`);
        if (!Number.isFinite(line.unitNet) || line.unitNet < 0)
          throw new BadRequestException(`Érvénytelen beszerzési ár: ${name}.`);
        preparedLines.push({
          variantId: null,
          sku: null,
          createLocalProduct: {
            name,
            primaryCategoryId:
              line.createLocalProduct.primaryCategoryId?.trim() || null,
            ...newProductDetails(line.createLocalProduct, name),
            webshopDraft: line.createLocalProduct.webshopDraft === true,
          },
          sourceDescription,
          ...navSource,
          orderedQuantity: new Prisma.Decimal(line.orderedQuantity),
          actualQuantity: new Prisma.Decimal(line.actualQuantity),
          unit: line.unit.trim(),
          unitNet: new Prisma.Decimal(line.unitNet),
          discountPercent:
            line.discountPercent !== undefined
              ? new Prisma.Decimal(line.discountPercent)
              : null,
          syncStatus: "NOT_APPLICABLE",
          syncError: null,
          syncToUnas: false,
          projectAllocations,
        });
        continue;
      }

      const variantId = line.variantId;
      if (!variantId)
        throw new BadRequestException("A számlasor termékfeloldása hiányos.");
      const info = variants.get(variantId);
      if (!info)
        throw new BadRequestException(`Ismeretlen termék: ${line.variantId}.`);
      if (!Number.isFinite(line.actualQuantity) || line.actualQuantity < 0)
        throw new BadRequestException(`Érvénytelen mennyiség: ${info.sku}.`);
      if (!Number.isFinite(line.unitNet) || line.unitNet < 0)
        throw new BadRequestException(
          `Érvénytelen beszerzési ár: ${info.sku}.`,
        );
      if (
        info.catalogAuthority !== "UNAS" &&
        info.catalogAuthority !== "ACROPORA"
      )
        throw new BadRequestException(
          `A termék Product Master besorolása nem egyértelmű: ${info.sku}.`,
        );
      if (info.isPackageProduct)
        throw new BadRequestException(
          `A csomagtermék nem vételezhető be önálló készletként; válaszd az összetevőket: ${info.sku}.`,
        );
      const syncToUnas = info.catalogAuthority === "UNAS";

      preparedLines.push({
        variantId,
        sku: info.sku,
        createLocalProduct: null,
        sourceDescription: line.sourceDescription?.trim() || null,
        ...navSource,
        orderedQuantity: new Prisma.Decimal(line.orderedQuantity),
        actualQuantity: new Prisma.Decimal(line.actualQuantity),
        unit: line.unit.trim() || info.unit,
        unitNet: new Prisma.Decimal(line.unitNet),
        discountPercent:
          line.discountPercent !== undefined
            ? new Prisma.Decimal(line.discountPercent)
            : null,
        // "PENDING": the stock effect and its UnasStockSyncOutbox row are
        // posted atomically with the invoice itself (see
        // purchase-invoice.repository.ts); actual UNAS publication is the
        // background worker's job from here on, so this must not claim a
        // synchronous OK it can no longer guarantee.
        syncStatus: syncToUnas ? "PENDING" : "NOT_APPLICABLE",
        syncError: null,
        syncToUnas,
        projectAllocations,
      });
    }

    const now = new Date();
    // A BIZONYLATSZAM MOSTANTOL A MENTES KORE KERUL, ES CSAK ARRA. A szam eddig
    // jóval feljebb keletkezett, a validacio elott, es ha ket bevetelezes
    // ugyanabban a masodpercben ugyanazt a negyjegyu veget huzta, a masodik
    // hibaval vegzodott. A lezar a leheto legkisebb: a fenti ellenorzesek es
    // olvasasok valtozatlanul EGYSZER futnak, csak a mentes ismetlodik, friss
    // szammal.
    //
    // A KESZLET-MOZGAS SZAMA ITT NEM KULON HUZAS: a mentes a bizonylatszambol
    // szarmaztatja (`BESZMOZG-...`), tehat egy ujrahuzas mind a kettot
    // megujitja.
    //
    // AMIT SZANDEKOSAN ATENGED: a (szallito, szallitoi szamlaszam) parra allo
    // egyedisegi hiba. Az ennek a folyamatnak a DUPLA-BEKULDES elleni vedelme,
    // nem kodutkozes, es a mai valasza a helyes. A burkolat csak a
    // `documentNumber` oszlopra van felirva.
    await this.assertNewProductsAreNew(input.supplierId, preparedLines);

    // #1199 P-026: a line that carries a suggestion run gets its id here, so
    // the run can be closed against exactly this saved line.
    if (preparedLines.length !== input.lines.length)
      throw new Error("PREPARED_LINES_OUT_OF_STEP");
    const suggestionLinks = input.lines.flatMap((line, index) => {
      if (!line.decisionRunId) return [];
      const lineId = randomUUID();
      preparedLines[index] = { ...preparedLines[index]!, lineId };
      return [{ decisionRunId: line.decisionRunId, lineId }];
    });

    const detail = await withUniqueCode(
      { prefix: "BESZ", field: "documentNumber" },
      (documentNumber) =>
        this.invoices.create({
          documentNumber,
          supplierInvoiceNumber: input.supplierInvoiceNumber.trim(),
          source: input.source,
          supplierId: input.supplierId,
          warehouseId,
          currency,
          exchangeRate,
          invoiceDate,
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          isPaid: input.isPaid ?? false,
          paidAt: input.isPaid
            ? new Date(input.paidAt ?? now.toISOString())
            : null,
          vatRate,
          note: input.note?.trim() || null,
          navIncomingInvoiceId: input.navIncomingInvoiceId,
          expectedArrivalId: input.expectedArrivalId,
          actorUserId,
          lines: preparedLines,
        }),
    );

    if (suggestionLinks.length > 0 && this.lineSuggestions) {
      const savedVariant = new Map(
        detail.lines.map((line) => [line.id, line.variantId ?? null]),
      );
      try {
        await this.lineSuggestions.resolveForInvoice(
          suggestionLinks.map((link) => ({
            ...link,
            variantId: savedVariant.get(link.lineId) ?? null,
          })),
        );
      } catch (error) {
        // the invoice is saved and stays saved; only the audit closure failed
        this.logger.warn(
          `A sor-javaslatok lezárása kimaradt (${detail.id}): ${error instanceof Error ? error.name : "ismeretlen hiba"}`,
        );
      }
    }

    // what a person linked by hand becomes the supplier mapping for next time
    let supplierCodesLearned = 0;
    let supplierCodeConflicts: SupplierCodeConflict[] = [];
    const learnable = input.lines.flatMap((line, index) => {
      const variantId = preparedLines[index]?.variantId;
      const supplierSku = line.supplierSku?.trim();
      return supplierSku && variantId
        ? [
            {
              supplierSku,
              variantId,
              sourceDescription: line.sourceDescription?.trim() || null,
              unitNet: line.unitNet,
              decisionRunId: line.decisionRunId ?? null,
            },
          ]
        : [];
    });
    if (learnable.length > 0 && this.codeLearning) {
      try {
        const learned = await this.codeLearning.learn({
          supplierId: input.supplierId,
          currency,
          lines: learnable,
        });
        supplierCodesLearned = learned.learned;
        supplierCodeConflicts = learned.conflicts;
      } catch (error) {
        // the invoice is saved and stays saved; only the learning failed
        this.logger.warn(
          `A szállítói kódok megtanulása kimaradt (${detail.id}): ${error instanceof Error ? error.name : "ismeretlen hiba"}`,
        );
      }
    }

    const linkedLineCount = preparedLines.filter(
      (line) => line.variantId || line.createLocalProduct,
    ).length;
    // Always 0: the invoice + stock movement + outbox are one atomic
    // transaction (see repository.create) - a real failure throws and
    // rolls back the whole thing rather than reporting a partial failure
    // here. "successCount" now means "lines whose stock change was
    // committed locally"; unasQueuedCount separately reports the subset
    // queued for UNAS. Neither value claims an UNAS-side confirmation -
    // see docs/INVENTORY-CONSISTENCY.md.
    return {
      detail,
      successCount: linkedLineCount,
      failedCount: 0,
      unasQueuedCount: preparedLines.filter((line) => line.syncToUnas).length,
      localProductCreatedCount: preparedLines.filter(
        (line) => line.createLocalProduct,
      ).length,
      projectReservationCount: preparedLines.reduce(
        (count, line) => count + (line.projectAllocations?.length ?? 0),
        0,
      ),
      supplierCodesLearned,
      supplierCodeConflicts,
    };
  }
}

/**
 * A számlasorból felvett új termék alapadatai, ellenőrizve (#1199 P-026).
 * Minden mező opcionális: a régi kliens (csak név és kategória) változatlanul
 * működik.
 */
function newProductDetails(
  input: {
    brandId?: string;
    vatRate?: number;
    ean?: string;
    supplierSku?: string;
  },
  name: string,
): {
  brandId: string | null;
  vatRate: Prisma.Decimal | null;
  ean: string | null;
  supplierSku: string | null;
} {
  const ean = input.ean?.replace(/\s/g, "") || null;
  if (ean !== null && eanCheckDigitValid(ean) !== true)
    throw new BadRequestException(
      `Érvénytelen EAN (8, 12, 13 vagy 14 számjegy, helyes ellenőrzőjeggyel): ${name}.`,
    );
  return {
    brandId: input.brandId?.trim() || null,
    vatRate:
      input.vatRate !== undefined ? new Prisma.Decimal(input.vatRate) : null,
    ean,
    supplierSku: input.supplierSku?.trim() || null,
  };
}
