import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import {
  contractKindSwitchBlocker,
  type ContractKind,
  contractBilling,
} from "@acropora/types";

import {
  ContractItemDto,
  CreateContractDto,
  UpdateContractDto,
} from "./dto.js";
import {
  ContractsRepository,
  type ContractInput,
  REPAIR_FEE_FIELDS,
  type RepairFees,
} from "./contracts.repository.js";
import { sumDocumentBytesInUse } from "../documents/document-bytes-in-use.js";
import { decideQuota } from "../service-assets/document-store/document-quota.js";
import { assetsOutsideDepartment } from "../common/assets-in-department.js";

/**
 * A JAVÍTÁSI DÍJAK A KÉRÉSBŐL (kártya 3d80a18d): a hiányzó mező `undefined`
 * marad (a tárolt érték nem változik), a `null` törlődik, a szám Decimal lesz.
 */
function repairFeesInput(
  item: Partial<Record<(typeof REPAIR_FEE_FIELDS)[number], string | null>>,
): RepairFees {
  return Object.fromEntries(
    REPAIR_FEE_FIELDS.map((field) => {
      const value = item[field];
      return [
        field,
        value === undefined
          ? undefined
          : value === null || value.trim() === ""
            ? null
            : new Prisma.Decimal(value),
      ];
    }),
  );
}

@Injectable()
export class ContractsService {
  constructor(private readonly repository: ContractsRepository) {}

  list() {
    return this.repository.list();
  }
  customers() {
    return this.repository.customers();
  }
  quantityUnits() {
    return this.repository.quantityUnits();
  }

  async detail(id: string) {
    const contract = await this.repository.detail(id);
    if (!contract) throw new NotFoundException("A szerződés nem található.");
    // a visszaváltás feltétele a felületen (barracuda, #1661): készült-e számla
    return {
      ...contract,
      invoiceCount:
        contract.kind === "PURCHASE"
          ? await this.repository.invoiceCount(id)
          : 0,
      billing: await this.billingOf(contract),
    };
  }

  /**
   * A RÉSZTELJESÍTÉS ÉS SZÁMLÁZÁS (feladat d510): beszerzési szerződésnél
   * tételenként a számlázott és a maradék mennyiség, és az állapot (nincs,
   * részben, teljesen számlázva). Karbantartásinál `null`: ott az alkalmakat a
   * megrendelőlap számolja.
   */
  private async billingOf(contract: {
    id: string;
    kind: string;
    items: Array<{ id: string; quantity: { toString(): string } }>;
  }) {
    if (contract.kind !== "PURCHASE") return null;
    return contractBilling(
      contract.items.map((item) => ({
        id: item.id,
        quantity: item.quantity.toString(),
      })),
      await this.repository.billedLines(contract.id),
    );
  }

  async create(input: CreateContractDto) {
    const data = await this.normalize(input);
    try {
      return await this.repository.create(data);
    } catch (error) {
      this.mapUniqueNumberConflict(error, data.number);
    }
  }

  async update(id: string, patch: UpdateContractDto) {
    const existing = await this.detail(id);
    const kind = patch.kind ?? existing.kind;
    /*
      KARBANTARTÁSIBÓL BESZERZÉSI CSAK MEGRENDELŐLAP NÉLKÜL (hétfői lista M4,
      Balázs: „így van”). A megrendelőlap tételei a szerződés tételeire
      mutatnak, és alkalmakat számolnak: egy beszerzési szerződés alatt ezek
      értelmüket vesztenék. A felület ugyanezt előre kiírja.
    */
    // a tükre (barracuda, #1661): számla után nem lesz újra karbantartási;
    // és a javítási fajta (felmérés S0/3) megrendelőlap után ugyanígy zárt
    if (kind !== existing.kind) {
      const blocker = contractKindSwitchBlocker(existing.kind, kind, {
        maintenanceOrderCount:
          existing.kind !== "PURCHASE" && kind !== "MAINTENANCE"
            ? await this.repository.maintenanceOrderCount(id)
            : 0,
        invoiceCount:
          existing.kind === "PURCHASE"
            ? await this.repository.invoiceCount(id)
            : 0,
      });
      if (blocker) throw new ConflictException(blocker);
    }
    const data = await this.normalize({
      kind,
      customerId: existing.customerId,
      number: patch.number ?? existing.number,
      title: patch.title ?? existing.title,
      validFrom: patch.validFrom ?? existing.validFrom.toISOString(),
      validTo:
        patch.validTo === undefined
          ? (existing.validTo?.toISOString() ?? null)
          : patch.validTo,
      status: patch.status ?? existing.status,
      notes: patch.notes === undefined ? existing.notes : patch.notes,
      organizationalUnitName:
        patch.organizationalUnitName === undefined
          ? existing.organizationalUnitName
          : patch.organizationalUnitName,
      contactPersonName:
        patch.contactPersonName === undefined
          ? existing.contactPersonName
          : patch.contactPersonName,
      items:
        patch.items ??
        existing.items.map((item) => ({
          id: item.id,
          description: item.description,
          unitNet: item.unitNet.toString(),
          quantity: item.quantity.toString(),
          occasionsPerYear: item.occasionsPerYear,
          vatRatePercent: item.vatRatePercent.toString(),
          unitOfMeasureId: item.unitOfMeasureId,
          departmentId: item.departmentId,
          assetIds: item.assets.map((asset) => asset.assetId),
          ...Object.fromEntries(
            REPAIR_FEE_FIELDS.map((field) => [
              field,
              item[field]?.toString() ?? null,
            ]),
          ),
        })),
    });
    try {
      const updated = await this.repository.update(id, data);
      // ugyanaz az alak, mint a `detail()`-é: a felület a mentés válaszából él
      return {
        ...updated,
        invoiceCount:
          updated.kind === "PURCHASE"
            ? await this.repository.invoiceCount(id)
            : 0,
        billing: await this.billingOf(updated),
      };
    } catch (error) {
      /*
        A REPOSITORY TÉTELENKÉNT UPSERT-EL (`contracts.repository.ts`
        `update()`), NEM TÖRLI+ÚJRAÉPÍTI AZ ÖSSZES SORT -- ez a viselkedés
        2026-09-24-én változott (Balázs éles hibája, Állatkert,
        SZ2026/0000019: a régi alak minden mentésnél új `id`-t adott a
        MEGMARADÓ tételeknek is). A P2003 tehát MOSTANTÓL csak akkor jön,
        ha a küldött tétel-lista TÉNYLEG kihagy egy olyan tételt, amihez
        már készült megrendelőlap (`MaintenanceOrderItem.contractItemId`,
        `onDelete: Restrict`) -- vagyis valódi törlési szándékra, nem
        minden mentésre.
      */
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2003"
      )
        throw new ConflictException(
          // a számlasor (feladat d510) és a megrendelőlap nélküli karbantartási
          // lap tételsora (felmérés S4, barracuda 31612) is a tételre mutat
          "A tétel nem törölhető, mert már készült megrendelőlap, számla vagy karbantartási lap, ami rá hivatkozik.",
        );
      this.mapUniqueNumberConflict(error, data.number);
    }
  }

  /**
   * A DUPLIKÁLT SZERZŐDÉSSZÁM 409-ET AD, MAGYARUL, A SZÁMMAL EGYÜTT --
   * Balázs éles hibája (2026-09-24 20:31): egy már létező számmal próbált
   * menteni, a nyers P2002 pedig a `create()`-en volt csak elkapva (a
   * `update()`-en EGYÁLTALÁN NEM), ezért a felületen "A kérés feldolgozása
   * nem sikerült" jelent meg -- se a mező, se a szám nem látszott.
   */
  private mapUniqueNumberConflict(error: unknown, number: string): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      throw new ConflictException(
        `Ez a szerződésszám már létezik (${number}).`,
      );
    throw error;
  }

  async addPdf(id: string, file: Express.Multer.File) {
    await this.detail(id);
    if (
      file.mimetype !== "application/pdf" ||
      !file.buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))
    )
      throw new BadRequestException("Csak valódi PDF-fájl tölthető fel.");
    const limitBytes = Number(process.env.DOCUMENT_STORE_LIMIT_BYTES ?? 0);
    if (Number.isFinite(limitBytes) && limitBytes > 0) {
      const quota = decideQuota({
        usedBytes: await sumDocumentBytesInUse(),
        incomingBytes: file.buffer.length,
        limitBytes,
      });
      if (quota.state === "reject") throw new ConflictException(quota.reason);
    }
    return this.repository.addPdf(id, file);
  }

  async document(id: string, documentId: string) {
    const document = await this.repository.document(id, documentId);
    if (!document || !document.content)
      throw new NotFoundException("A dokumentum nem található.");
    return { ...document, bytes: document.content };
  }

  private async normalize(input: {
    kind?: ContractKind;
    customerId: string;
    number: string;
    title: string;
    validFrom: string;
    validTo?: string | null;
    status?: "DRAFT" | "ACTIVE" | "EXPIRED" | "TERMINATED";
    notes?: string | null;
    organizationalUnitName?: string | null;
    contactPersonName?: string | null;
    items: ContractItemDto[];
  }): Promise<ContractInput> {
    const customerId = input.customerId.trim();
    if (!(await this.repository.customerExists(customerId)))
      throw new BadRequestException("A megadott partner nem található.");
    const kind = input.kind ?? "MAINTENANCE";
    const purchase = kind === "PURCHASE";
    /*
      A FAJTA DÖNTI EL, MELYIK TÉTELMEZŐ KÖTELEZŐ (hétfői lista M4). Beszerzésnél
      csak leírás, nettó egységár, mennyiség, mennyiségi egység és ÁFA: az
      alkalom, a helyszín, az eszközök és a javítási díjak üresek lesznek, akkor
      is, ha egy korábbi karbantartási változatból ott álltak. Karbantartásnál
      az alkalom / év kötelező, a mennyiségi egység nincs. Javításnál (felmérés
      S0/3) ugyanaz, mint a karbantartásnál, csak az alkalom nem kötelező.
    */
    const knownUnits = purchase
      ? await this.repository.quantityUnitIds(
          input.items.flatMap((item) =>
            item.unitOfMeasureId ? [item.unitOfMeasureId] : [],
          ),
        )
      : new Set<string>();
    for (const item of input.items) {
      if (purchase && !item.unitOfMeasureId)
        throw new BadRequestException(
          `A beszerzési tételnél a mennyiségi egység kötelező: ${item.description.trim()}.`,
        );
      if (purchase && !knownUnits.has(item.unitOfMeasureId!))
        throw new BadRequestException(
          `Ismeretlen mennyiségi egység: ${item.description.trim()}.`,
        );
      // a javítási tételnél az alkalom nem kötelező (felmérés S0/3)
      if (kind === "MAINTENANCE" && !item.occasionsPerYear)
        throw new BadRequestException(
          `A karbantartási tételnél az alkalom / év kötelező: ${item.description.trim()}.`,
        );
    }
    const validFrom = new Date(input.validFrom);
    const validTo = input.validTo ? new Date(input.validTo) : null;
    if (validTo && validTo < validFrom)
      throw new BadRequestException(
        "Az érvényesség vége nem lehet korábbi a kezdeténél.",
      );
    const items = await Promise.all(
      input.items.map(async (item) => {
        const assetIds = purchase ? [] : [...new Set(item.assetIds ?? [])];
        const departmentId = purchase
          ? null
          : item.departmentId?.trim() || null;
        if (
          departmentId &&
          !(await this.repository.departmentBelongsToCustomer(
            departmentId,
            customerId,
          ))
        )
          throw new BadRequestException(
            "A megadott helyszín nem ehhez a partnerhez tartozik.",
          );
        /*
          A TÉTEL HELYSZÍNÉHEZ VISZONYÍTVA ELLENŐRZÜNK, NEM A SZERZŐDÉS
          PARTNERÉHEZ -- Balázs éles hibája (2026-09-24 21:48, Állatkert,
          SZ2026/0000019): a `JobAssetPicker` a HELYSZÍN alfája szerint
          kínálja fel az eszközöket (`assets-in-department.ts`), a korábbi
          `assetsBelongToCustomer` viszont a szerződés `customerId`-jét
          nézte. A kettő szétcsúszhat, ha ugyanahhoz a valós partnerhez
          (itt: Állatkert) KÉT `Customer` sor tartozik, és az eszköz meg a
          szerződés nem ugyanarra mutat -- ekkor a felkínált eszköz mindig
          elutasítva jött volna vissza, holott pontosan azt választották,
          amit a felület felkínált. Helyszín nélkül (a felület ezt sosem
          engedi meg, ha van kiválasztott eszköz) a régi, partner-szintű
          ellenőrzés marad az egyetlen védelem.
        */
        if (assetIds.length) {
          if (departmentId) {
            const outside = await assetsOutsideDepartment(
              assetIds,
              departmentId,
            );
            if (outside.length)
              throw new BadRequestException(
                "A megadott eszközök között idegen vagy ismeretlen eszköz van.",
              );
          } else {
            const owned = await this.repository.assetsBelongToCustomer(
              assetIds,
              customerId,
            );
            if (owned.length !== assetIds.length)
              throw new BadRequestException(
                "A megadott eszközök között idegen vagy ismeretlen eszköz van.",
              );
          }
        }
        return {
          id: item.id?.trim() || undefined,
          description: item.description.trim(),
          unitNet: new Prisma.Decimal(item.unitNet),
          quantity: new Prisma.Decimal(item.quantity),
          occasionsPerYear: purchase ? null : (item.occasionsPerYear ?? null),
          vatRatePercent: new Prisma.Decimal(item.vatRatePercent),
          unitOfMeasureId: purchase ? (item.unitOfMeasureId ?? null) : null,
          departmentId,
          assetIds,
          ...(purchase
            ? repairFeesInput(
                Object.fromEntries(
                  REPAIR_FEE_FIELDS.map((field) => [field, null]),
                ),
              )
            : repairFeesInput(item)),
        };
      }),
    );
    return {
      customerId,
      number: input.number.trim(),
      title: input.title.trim(),
      validFrom,
      validTo,
      status: input.status ?? "DRAFT",
      kind,
      notes: input.notes?.trim() || null,
      organizationalUnitName: input.organizationalUnitName?.trim() || null,
      contactPersonName: input.contactPersonName?.trim() || null,
      items,
    };
  }
}
