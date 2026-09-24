import { Injectable } from "@nestjs/common";
import { prisma, Prisma } from "@acropora/database";

const contractInclude = {
  customer: { select: { id: true, displayName: true } },
  items: {
    orderBy: { position: "asc" as const },
    include: {
      department: { select: { id: true, name: true, code: true } },
      assets: {
        include: {
          asset: { select: { id: true, assetNumber: true, name: true } },
        },
      },
    },
  },
  documents: {
    orderBy: { createdAt: "desc" as const },
    select: {
      id: true,
      fileName: true,
      contentType: true,
      sizeBytes: true,
      createdAt: true,
    },
  },
};

export type ContractInput = {
  customerId: string;
  number: string;
  title: string;
  validFrom: Date;
  validTo: Date | null;
  status: "DRAFT" | "ACTIVE" | "EXPIRED" | "TERMINATED";
  notes: string | null;
  organizationalUnitName: string | null;
  contactPersonName: string | null;
  items: Array<{
    /**
     * MEGLÉVŐ TÉTEL AZONOSÍTÓJA -- ha adott ÉS a szerződésen valóban létezik,
     * az `update()` a SOROT frissíti (`ContractItem.id` állandó marad).
     * Hiányzó vagy ismeretlen id: ÚJ tétel jön létre. Lásd `dto.ts`
     * `ContractItemDto.id` jegyzetét a MIÉRT-hez.
     */
    id?: string;
    description: string;
    unitNet: Prisma.Decimal;
    quantity: Prisma.Decimal;
    occasionsPerYear: number;
    vatRatePercent: Prisma.Decimal;
    departmentId: string | null;
    assetIds: string[];
  }>;
};

@Injectable()
export class ContractsRepository {
  private readonly database = prisma;

  list() {
    return this.database.contract.findMany({
      orderBy: [{ validFrom: "desc" }, { number: "desc" }],
      include: contractInclude,
    });
  }

  /**
   * A szerződés közvetlenül `Customer`-hoz köt, míg a partner-lista a tükör
   * `Supplier` sorokat adja. Ez a rövid lista ezért nem új partnerkatalógus,
   * hanem a szerződés űrlapjának szükséges, helyes tulajdonosi választója.
   */
  customers() {
    return this.database.customer.findMany({
      where: { partner: { is: { isService: true, isActive: true } } },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true, worksheetPartnerCode: true },
    });
  }

  detail(id: string) {
    return this.database.contract.findUnique({
      where: { id },
      include: contractInclude,
    });
  }

  customerExists(customerId: string) {
    return this.database.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
  }

  async departmentBelongsToCustomer(departmentId: string, customerId: string) {
    return this.database.worksheetDepartment.findFirst({
      where: { id: departmentId, customerId },
      select: { id: true },
    });
  }

  async assetsBelongToCustomer(assetIds: string[], customerId: string) {
    if (!assetIds.length) return [];
    return this.database.asset.findMany({
      where: { id: { in: assetIds }, customerId },
      select: { id: true },
    });
  }

  create(input: ContractInput) {
    return this.database.contract.create({
      data: this.data(input),
      include: contractInclude,
    });
  }

  /**
   * TÉTELENKÉNT UPSERT, NEM TÖRLÉS+ÚJRAÉPÍTÉS -- Balázs éles hibája
   * (2026-09-24 21:48, Állatkert, SZ2026/0000019). A korábbi alak
   * (`deleteMany` majd `create`) MINDEN mentésnél új `id`-t adott a
   * MEGMARADÓ tételeknek is, a kliens tétel-kulcsos állapota (kijelölt
   * tételek a megrendelőlaphoz, helyszín, eszközök) pedig a RÉGI id-n
   * maradt -- a következő megrendelőlap-kiállítás "olyan tétel, ami nem
   * is létezik" hibával hasalt el, és a törlés a Postgres-idegenkulcs-
   * megkötésen (P2003) is csak VÉLETLENSZERŰEN akadt el, attól függően,
   * hogy éppen melyik régi sorhoz készült már megrendelőlap.
   *
   * Mostantól: a kliens által küldött `id`-vel rendelkező, a szerződésen
   * TÉNYLEG létező tétel UPDATE-elődik (az azonosítója állandó marad), a
   * `id` nélküli VAGY ismeretlen `id`-jű új sorként jön létre, a
   * bemenetből KIMARADÓ meglévő tétel pedig törlődik -- és PONTOSAN EZ a
   * törlés az, ami P2003-at ad, ha időközben megrendelőlap készült hozzá
   * (lásd `contracts.service.ts` `update()` catch ága).
   */
  async update(id: string, input: ContractInput) {
    return this.database.$transaction(async (tx) => {
      const existing = await tx.contractItem.findMany({
        where: { contractId: id },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((row) => row.id));
      const keepIds = new Set(
        input.items
          .filter((item) => item.id && existingIds.has(item.id))
          .map((item) => item.id as string),
      );
      const removedIds = [...existingIds].filter(
        (rowId) => !keepIds.has(rowId),
      );
      if (removedIds.length)
        await tx.contractItem.deleteMany({ where: { id: { in: removedIds } } });

      /*
        ÁTMENETI, ÜTKÖZÉS-MENTES POZÍCIÓK a megmaradó tételeken, MIELŐTT a
        véglegeset beállítanánk. A `@@unique([contractId, position])` egy
        egyszerű felcserélésnél (1↔2) is elhasalna, ha a két UPDATE
        egymás után, a régi értékek mellett futna: az első UPDATE a saját
        régi pozícióján találná a MÁSIK tételt.
      */
      let temp = 0;
      for (const item of input.items) {
        if (!item.id || !keepIds.has(item.id)) continue;
        temp -= 1;
        await tx.contractItem.update({
          where: { id: item.id },
          data: { position: temp },
        });
      }

      /*
        SZEKVENCIÁLISAN, NEM `Promise.all`-lal: egy interaktív Prisma-
        tranzakció EGYETLEN kapcsolaton fut, tehát párhuzamos hívás a
        tranzakción belül nem gyorsítás, hanem hibaforrás.
      */
      for (const [index, item] of input.items.entries()) {
        const position = index + 1;
        const scalar = {
          position,
          description: item.description,
          unitNet: item.unitNet,
          quantity: item.quantity,
          occasionsPerYear: item.occasionsPerYear,
          vatRatePercent: item.vatRatePercent,
          departmentId: item.departmentId,
        };
        if (item.id && keepIds.has(item.id)) {
          await tx.contractItem.update({
            where: { id: item.id },
            data: {
              ...scalar,
              assets: {
                deleteMany: {},
                create: item.assetIds.map((assetId) => ({ assetId })),
              },
            },
          });
        } else {
          await tx.contractItem.create({
            data: {
              ...scalar,
              contractId: id,
              assets: {
                create: item.assetIds.map((assetId) => ({ assetId })),
              },
            },
          });
        }
      }

      return tx.contract.update({
        where: { id },
        data: this.scalarData(input),
        include: contractInclude,
      });
    });
  }

  addPdf(contractId: string, file: Express.Multer.File) {
    return this.database.contractDocument.create({
      data: {
        contractId,
        fileName: file.originalname,
        contentType: file.mimetype,
        sizeBytes: file.size,
        content: Uint8Array.from(file.buffer),
      },
      select: {
        id: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        createdAt: true,
      },
    });
  }

  document(contractId: string, documentId: string) {
    return this.database.contractDocument.findFirst({
      where: { id: documentId, contractId },
      select: { fileName: true, contentType: true, content: true },
    });
  }

  /** A SKALÁR MEZŐK, TÉTELEK NÉLKÜL -- az `update()` a tételeket külön, upsert-tel kezeli. */
  private scalarData(
    input: ContractInput,
  ): Omit<Prisma.ContractCreateInput, "items"> {
    return {
      customer: { connect: { id: input.customerId } },
      number: input.number,
      title: input.title,
      validFrom: input.validFrom,
      validTo: input.validTo,
      status: input.status,
      notes: input.notes,
      organizationalUnitName: input.organizationalUnitName,
      contactPersonName: input.contactPersonName,
    };
  }

  private data(input: ContractInput): Prisma.ContractCreateInput {
    return {
      ...this.scalarData(input),
      items: {
        create: input.items.map((item, index) => ({
          position: index + 1,
          description: item.description,
          unitNet: item.unitNet,
          quantity: item.quantity,
          occasionsPerYear: item.occasionsPerYear,
          vatRatePercent: item.vatRatePercent,
          departmentId: item.departmentId,
          assets: { create: item.assetIds.map((assetId) => ({ assetId })) },
        })),
      },
    };
  }
}
