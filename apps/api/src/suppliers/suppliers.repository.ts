import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { Prisma, prisma, Repository, type Supplier } from "@acropora/database";
import type {
  SupplierListResponse,
  SupplierSummary,
  WorksheetDepartmentListResponse,
  WorksheetDepartmentSummary,
} from "@acropora/types";

import { generateCode } from "../common/code-generator.util.js";
import {
  retryOnTakenCode,
  withUniqueCode,
} from "../common/unique-code.util.js";
import type { CreateWorksheetDepartmentDto } from "../worksheets/dto/worksheet.dto.js";
import type { PartnerReferenceCounts } from "./partner-deletion.js";
import type {
  CreateSupplierDto,
  SupplierListQueryDto,
  UpdateSupplierDto,
} from "./dto/supplier.dto.js";

function toSummary(supplier: Supplier): SupplierSummary {
  return {
    id: supplier.id,
    code: supplier.code,
    name: supplier.name,
    isSupplier: supplier.isSupplier,
    isService: supplier.isService,
    worksheetPartnerCode: supplier.worksheetPartnerCode ?? undefined,
    taxNumber: supplier.taxNumber ?? undefined,
    country: supplier.country,
    email: supplier.email ?? undefined,
    phone: supplier.phone ?? undefined,
    iban: supplier.iban ?? undefined,
    swiftCode: supplier.swiftCode ?? undefined,
    bankAccountNumber: supplier.bankAccountNumber ?? undefined,
    contactPersonName: supplier.contactPersonName ?? undefined,
    contactPersonPhone: supplier.contactPersonPhone ?? undefined,
    contactPersonEmail: supplier.contactPersonEmail ?? undefined,
    postalCode: supplier.postalCode ?? undefined,
    city: supplier.city ?? undefined,
    addressLine1: supplier.addressLine1 ?? undefined,
    addressLine2: supplier.addressLine2 ?? undefined,
    isActive: supplier.isActive,
    createdAt: supplier.createdAt.toISOString(),
    updatedAt: supplier.updatedAt.toISOString(),
  };
}

/**
 * The code has to be free on BOTH sides, and the reason is the mirror: the
 * partner's code is copied onto its customer row, where the same column is
 * already unique. Checking only the partner table would let a save pass
 * validation and then fail at the database with a message naming a constraint
 * instead of a company.
 *
 * The error names the holder on purpose. "Ez a kód foglalt" sends the person
 * hunting through a list; naming it ends the question.
 */
export async function assertPartnerCodeFree(
  tx: Prisma.TransactionClient,
  code: string,
  supplierId: string | null,
) {
  const partner = await tx.supplier.findFirst({
    where: {
      worksheetPartnerCode: code,
      ...(supplierId ? { NOT: { id: supplierId } } : {}),
    },
    select: { name: true },
  });
  if (partner) throw new Error(`PARTNER_CODE_TAKEN:${partner.name}`);

  const customer = await tx.customer.findFirst({
    where: {
      worksheetPartnerCode: code,
      ...(supplierId ? { partner: { isNot: { id: supplierId } } } : {}),
    },
    select: { displayName: true },
  });
  if (customer) throw new Error(`PARTNER_CODE_TAKEN:${customer.displayName}`);
}

/**
 * A worksheet belongs to a customer in three places -- the sheet, the unit and
 * the abbreviation the close path requires -- so a service partner is given a
 * customer row of its own to carry them. The row is the partner's, not a buyer's: it is created
 * here rather than typed in, so a partner is still recorded once, by hand, in
 * one place, and the customer list leaves these rows out.
 *
 * Kept in step on every save, because the name and the code are what a
 * colleague reads on the worksheet: a partner renamed on the partner screen and
 * left alone here would put the old name on every sheet written afterwards.
 */
export async function syncWorksheetMirror(
  tx: Prisma.TransactionClient,
  supplier: {
    id: string;
    name: string;
    isService: boolean;
    customerId: string | null;
    worksheetPartnerCode?: string | null;
  },
) {
  if (!supplier.isService) {
    // Un-ticking "Szerviz" does not drop the row: worksheets may already point
    // at it, and `onDelete: Restrict` would refuse anyway. It stays, unlisted,
    // and is reused if the partner becomes a service partner again.
    return supplier.customerId;
  }
  // The code travels with the name: the worksheet number is built from the
  // customer row's copy, so a code left behind here would number new sheets
  // after the partner's old abbreviation.
  const carried = {
    displayName: supplier.name,
    companyName: supplier.name,
    worksheetPartnerCode: supplier.worksheetPartnerCode ?? null,
  };
  if (supplier.customerId) {
    await tx.customer.update({
      where: { id: supplier.customerId },
      data: carried,
    });
    return supplier.customerId;
  }
  const mirror = await tx.customer.create({
    data: {
      // `PARTNER`, not `VEVO`: this row will turn up on an invoice or in an
      // export one day, in front of somebody who never heard of mirrors, and
      // the number is the one field that travels everywhere the row goes. It
      // costs a word here and saves that person the question.
      customerNumber: generateCode("PARTNER"),
      type: "COMPANY",
      ...carried,
    },
    select: { id: true },
  });
  await tx.supplier.update({
    where: { id: supplier.id },
    data: { customerId: mirror.id },
  });
  return mirror.id;
}

@Injectable()
export class SuppliersRepository extends Repository {
  constructor() {
    super(prisma);
  }

  async list(query: SupplierListQueryDto): Promise<SupplierListResponse> {
    const where: Prisma.SupplierWhereInput = {
      // A törölt partner kikerül a listából, a "Mind" szűrő alól is: az a
      // szűrő az aktív és az inaktív között választ, a törölt viszont nem
      // ezen a tengelyen van. A neve továbbra is látszik a régi
      // bejegyzéseken, ahol hivatkoznak rá.
      deletedAt: null,
      ...(query.status === "ALL"
        ? {}
        : { isActive: query.status === "ACTIVE" }),
      ...(query.kind === "SUPPLIER" ? { isSupplier: true } : {}),
      ...(query.kind === "SERVICE" ? { isService: true } : {}),
      ...(query.countryScope === "DOMESTIC"
        ? { country: { equals: "HU", mode: "insensitive" } }
        : query.countryScope === "EU"
          ? {
              NOT: [
                { country: { equals: "HU", mode: "insensitive" } },
                { country: "" },
              ],
            }
          : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { code: { contains: query.search, mode: "insensitive" } },
              { taxNumber: { contains: query.search, mode: "insensitive" } },
              {
                contactPersonName: {
                  contains: query.search,
                  mode: "insensitive",
                },
              },
              { city: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [suppliers, totalItems] = await Promise.all([
      prisma.supplier.findMany({
        where,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.supplier.count({ where }),
    ]);
    return {
      items: suppliers.map(toSummary),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }

  /**
   * A partner alegységei. Az alegység a munkalapon a szám első tagját adja,
   * és a sémában a VEVŐHÖZ tartozik -- egy szerviz partner alegységei tehát a
   * tükör-során lógnak.
   *
   * A tükör azonosítója NEM kerül ki a kliensnek: a partner belső részlete, és
   * ha a felület ismerné, akkor előbb-utóbb használná is olyasmire, amiről itt
   * senki nem tud. A partner azonosítójával kérdez, a feloldás itt történik.
   *
   * Tükör nélküli partnernek üres a listája, nem hibás. Egy tisztán beszállító
   * partnernek nincs és nem is lehet alegysége, és ez nem hibaállapot.
   */
  async units(supplierId: string): Promise<WorksheetDepartmentListResponse> {
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { customerId: true },
    });
    if (!supplier?.customerId) return { items: [] };
    // LAPOSAN jon vissza, a fat a hivo epiti fel a parentId mezobol. Egy
    // rekurziv lekerdezes itt tobbet vinne, mint amennyit er: egy partner
    // helyszinei elférnek egy koteg­ben, es igy egy uj szint nem valtoztat
    // vegpontot.
    const items = await prisma.worksheetDepartment.findMany({
      where: { customerId: supplier.customerId },
      select: {
        id: true,
        parentId: true,
        code: true,
        name: true,
        isActive: true,
      },
      orderBy: [{ parentId: "asc" }, { code: "asc" }],
    });
    return { items };
  }

  /**
   * Új alegység a partnerhez. A tükör hiánya itt NEM üres válasz, hanem
   * elutasítás: aki alegységet visz fel, azt várja, hogy az meg is maradjon,
   * és egy csendben elnyelt mentés rosszabb, mint egy mondat arról, mi
   * hiányzik.
   */
  async createUnit(
    supplierId: string,
    input: CreateWorksheetDepartmentDto,
  ): Promise<WorksheetDepartmentSummary | null> {
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { customerId: true },
    });
    if (!supplier?.customerId) return null;

    /**
     * A SZULO UGYANAHHOZ A PARTNERHEZ TARTOZZON.
     *
     * Enelkul egy letezo, de MASIK partnerhez tartozo azonosito atmenne: az
     * idegen kulcs csak azt nezi, hogy a sor letezik-e, a tulajdonost nem. Az
     * igy keletkezo helyszin a masik partner faja alatt fugne, es a
     * munkalapszamot vinne rossz helyre -- csendben, mert a felulet a sajat
     * fajat mutatja, es abban nem is latszana.
     *
     * A "nem talaltam" es a "masé" ugyanaz a valasz: mindketto ismeretlen
     * szulo a hivo szemszogebol, es a kulonbseg kimondasa mas partner adatarol
     * arulna el valamit.
     */
    const parentId = input.parentId?.trim() || null;
    if (parentId) {
      const parent = await prisma.worksheetDepartment.findFirst({
        where: { id: parentId, customerId: supplier.customerId },
        select: { id: true },
      });
      if (!parent) throw new Error("WORKSHEET_DEPARTMENT_PARENT_NOT_FOUND");
    }

    return prisma.worksheetDepartment.create({
      data: {
        customerId: supplier.customerId,
        parentId,
        code: input.code.trim().toUpperCase(),
        name: input.name.trim(),
      },
      select: {
        id: true,
        parentId: true,
        code: true,
        name: true,
        isActive: true,
      },
    });
  }

  /**
   * Leszámolja, mi hivatkozik a partnerre, és mi tartozik hozzá.
   *
   * A tükör vevő-soron át futó hivatkozások ugyanennek a partnernek szólnak:
   * a munkalapjai, az alegységei és a vevőként kiállított számlái mind ott
   * ülnek. Ezért a számolás két helyről gyűjt, de EGY partnerről beszél.
   *
   * Minden fajta külön számol, mert a felhasználónak meg kell tudni mondani,
   * MI tartja vissza a törlést - egy "van rá hivatkozás" válasszal nem tud
   * mit kezdeni.
   */
  async referenceCounts(id: string): Promise<PartnerReferenceCounts> {
    const supplier = await this.database.supplier.findUnique({
      where: { id },
      select: { customerId: true },
    });
    if (!supplier) return {};

    const forSupplier = { supplierId: id };
    const mirrorId = supplier.customerId;
    const forMirror = mirrorId ? { customerId: mirrorId } : null;
    const zero = async () => 0;

    const [
      supplierProducts,
      preferredByExtensions,
      purchaseOrders,
      purchaseInvoices,
      supplierInvoices,
      supplierAssets,
      mirrorAddresses,
      salesOrders,
      projects,
      serviceJobs,
      aquariums,
      customerInvoices,
      customerAssets,
      worksheetDepartments,
      worksheets,
    ] = await Promise.all([
      this.database.supplierProduct.count({ where: forSupplier }),
      this.database.productExtension.count({
        where: { preferredSupplierId: id },
      }),
      this.database.purchaseOrder.count({ where: forSupplier }),
      this.database.purchaseInvoice.count({ where: forSupplier }),
      this.database.invoice.count({ where: forSupplier }),
      this.database.asset.count({ where: forSupplier }),
      forMirror
        ? this.database.customerAddress.count({ where: forMirror })
        : zero(),
      forMirror ? this.database.salesOrder.count({ where: forMirror }) : zero(),
      forMirror ? this.database.project.count({ where: forMirror }) : zero(),
      forMirror ? this.database.serviceJob.count({ where: forMirror }) : zero(),
      forMirror ? this.database.aquarium.count({ where: forMirror }) : zero(),
      forMirror ? this.database.invoice.count({ where: forMirror }) : zero(),
      forMirror ? this.database.asset.count({ where: forMirror }) : zero(),
      forMirror
        ? this.database.worksheetDepartment.count({ where: forMirror })
        : zero(),
      forMirror ? this.database.worksheet.count({ where: forMirror }) : zero(),
    ]);

    return {
      supplierProducts,
      preferredByExtensions,
      purchaseOrders,
      purchaseInvoices,
      supplierInvoices,
      supplierAssets,
      mirrorAddresses,
      salesOrders,
      projects,
      serviceJobs,
      aquariums,
      customerInvoices,
      customerAssets,
      worksheetDepartments,
      worksheets,
    };
  }

  /**
   * Fizikai törlés, a tükör vevő-sorral együtt.
   *
   * A sorrend kötött, és nem stílus: a partner sora mutat a tükörre
   * (`onDelete: Restrict`), tehát amíg a partner megvan, a vevő-sor nem
   * törölhető. Egy tranzakcióban megy, mert egy félig lefutott törlés árva
   * tükör-sort hagyna a Vevők képernyőn, amit senki nem tudna hova tenni.
   */
  async remove(id: string): Promise<void> {
    await this.database.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({
        where: { id },
        select: { customerId: true },
      });
      if (!supplier) return;

      await tx.supplier.delete({ where: { id } });
      if (supplier.customerId)
        await tx.customer.delete({ where: { id: supplier.customerId } });
    });
  }

  /**
   * A sor marad, törölt jelöléssel.
   *
   * A tükör vevő-sorhoz NEM nyúlunk: a régi munkalapok azon keresztül tartják
   * a partner nevét, és ha azt elvennénk, a lapokon üresen maradna a hely -
   * pontosan az, amit a törölt jelölés elkerülni hivatott.
   */
  async markDeleted(id: string): Promise<void> {
    await this.database.supplier.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  async detail(id: string): Promise<SupplierSummary | null> {
    const supplier = await prisma.supplier.findUnique({ where: { id } });
    return supplier ? toSummary(supplier) : null;
  }

  /**
   * A SZALLITO LETREHOZASA KET KODOT AD KI EGY TRANZAKCIOBAN, es a tranzakcio
   * BARMELYIKEN elbukhat: a szallito sajat kodjan, es a tukor vevo-sor szaman,
   * amit a `syncWorksheetMirror` allit elo idelent.
   *
   * Ezert szerepel mind a ketto a listan. Ujraprobalaskor MINDKETTO ujra
   * keletkezik -- a szallitoe a burkolattol, a tukore a segedfuggvenyen belul --,
   * tehat ket fuggetlen ujrahuzas tortenik, nem ugyanaz a kiserlet megismetelve.
   */
  create(input: CreateSupplierDto, actorId: string): Promise<SupplierSummary> {
    return withUniqueCode(
      { prefix: "SZALL", field: ["code", "customerNumber"] },
      (code) =>
        prisma.$transaction(
          async (tx) => {
            if (input.worksheetPartnerCode)
              await assertPartnerCodeFree(tx, input.worksheetPartnerCode, null);
            const supplier = await tx.supplier.create({
              data: {
                code,
                name: input.name.trim(),
                // Omitted stays omitted, so the column default decides. Writing
                // `?? true` here would look equivalent and would not be: it would
                // move the decision out of the schema and into every caller.
                isSupplier: input.isSupplier,
                isService: input.isService,
                worksheetPartnerCode: input.worksheetPartnerCode,
                taxNumber: input.taxNumber?.trim() || undefined,
                country: (input.country ?? "HU").trim().toUpperCase(),
                email: input.email?.trim() || undefined,
                phone: input.phone?.trim() || undefined,
                iban: input.iban?.trim() || undefined,
                swiftCode: input.swiftCode?.trim() || undefined,
                bankAccountNumber: input.bankAccountNumber?.trim() || undefined,
                contactPersonName: input.contactPersonName?.trim() || undefined,
                contactPersonPhone:
                  input.contactPersonPhone?.trim() || undefined,
                contactPersonEmail:
                  input.contactPersonEmail?.trim() || undefined,
                postalCode: input.postalCode?.trim() || undefined,
                city: input.city?.trim() || undefined,
                addressLine1: input.addressLine1?.trim() || undefined,
                addressLine2: input.addressLine2?.trim() || undefined,
              },
            });
            await syncWorksheetMirror(tx, {
              id: supplier.id,
              name: supplier.name,
              isService: supplier.isService,
              customerId: supplier.customerId,
              worksheetPartnerCode: supplier.worksheetPartnerCode,
            });
            await tx.domainEvent.create({
              data: {
                id: randomUUID(),
                eventType: "supplier.created",
                aggregateType: "Supplier",
                aggregateId: supplier.id,
                actorUserId: actorId,
                payload: { code: supplier.code, name: supplier.name },
                occurredAt: new Date(),
                schemaVersion: 1,
              },
            });
            return toSummary(supplier);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
    );
  }

  /**
   * A MODOSITAS IS KIADHAT EGY KODOT, es ez a leheto legkevesbe latszik rajta:
   * ha a partner MOST valik szervizesse, a `syncWorksheetMirror` idelent
   * letrehozza a tukor vevo-sort, es ahhoz vevoszamot huz. Ket ilyen mentes
   * ugyanabban a masodpercben ugyanazt a veget huzhatja.
   *
   * A BURKOLAT ITT NEM AD ATT KODOT, es ez a kulonbseg a `create`-hez kepest: a
   * vevoszamot a segedfuggveny huzza idelent, tehat elég az EGESZ tranzakciot
   * ujra lefuttatni, es a huzas magatol ujra megtortenik.
   *
   * ES AMI AZ UJRAFUTTATAST BIZTONSAGOSSA TESZI: az elbukott kiserlet semmit
   * nem hagy maga utan (a Postgres visszagorgeti), tehat a `expectedUpdatedAt`
   * ellenorzes a masodik kiserletben ugyanazt a sort talalja, ugyanazzal az
   * idobelyeggel. A STALE_UPDATE tehat nem az ujraprobalastol keletkezik.
   *
   * MENNYIT ER: keveset, es ezt jobb kimondani. A tukor-sor csak egy ritka
   * esemenynel keletkezik, es azon belul is 65 536-bol egy eset az utkozes. A
   * javitas azert kerult ide, mert a testver-eszkoz a masik ket helyhez ugyis
   * elkeszult, nem azert, mert onmagaban megerte volna.
   */
  update(
    id: string,
    input: UpdateSupplierDto,
    actorId: string,
  ): Promise<SupplierSummary> {
    return retryOnTakenCode({ field: "customerNumber" }, () =>
      prisma.$transaction(
        async (tx) => {
          const existing = await tx.supplier.findUniqueOrThrow({
            where: { id },
          });
          if (input.worksheetPartnerCode)
            await assertPartnerCodeFree(tx, input.worksheetPartnerCode, id);
          const changed = await tx.supplier.updateMany({
            where: { id, updatedAt: new Date(input.expectedUpdatedAt) },
            data: {
              name: input.name?.trim(),
              isSupplier: input.isSupplier,
              isService: input.isService,
              worksheetPartnerCode: input.worksheetPartnerCode,
              taxNumber:
                input.taxNumber === null ? null : input.taxNumber?.trim(),
              country: input.country?.trim().toUpperCase(),
              email: input.email === null ? null : input.email?.trim(),
              phone: input.phone === null ? null : input.phone?.trim(),
              iban: input.iban === null ? null : input.iban?.trim(),
              swiftCode:
                input.swiftCode === null ? null : input.swiftCode?.trim(),
              bankAccountNumber:
                input.bankAccountNumber === null
                  ? null
                  : input.bankAccountNumber?.trim(),
              contactPersonName:
                input.contactPersonName === null
                  ? null
                  : input.contactPersonName?.trim(),
              contactPersonPhone:
                input.contactPersonPhone === null
                  ? null
                  : input.contactPersonPhone?.trim(),
              contactPersonEmail:
                input.contactPersonEmail === null
                  ? null
                  : input.contactPersonEmail?.trim(),
              postalCode:
                input.postalCode === null ? null : input.postalCode?.trim(),
              city: input.city === null ? null : input.city?.trim(),
              addressLine1:
                input.addressLine1 === null ? null : input.addressLine1?.trim(),
              addressLine2:
                input.addressLine2 === null ? null : input.addressLine2?.trim(),
            },
          });
          if (changed.count !== 1) throw new Error("STALE_UPDATE");
          const saved = await tx.supplier.findUniqueOrThrow({
            where: { id },
            select: {
              id: true,
              name: true,
              isService: true,
              customerId: true,
              worksheetPartnerCode: true,
            },
          });
          await syncWorksheetMirror(tx, saved);
          await tx.domainEvent.create({
            data: {
              id: randomUUID(),
              eventType: "supplier.updated",
              aggregateType: "Supplier",
              aggregateId: id,
              actorUserId: actorId,
              payload: {
                previousName: existing.name,
                name: input.name ?? existing.name,
              },
              occurredAt: new Date(),
              schemaVersion: 1,
            },
          });
          const supplier = await tx.supplier.findUniqueOrThrow({
            where: { id },
          });
          return toSummary(supplier);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }
}
