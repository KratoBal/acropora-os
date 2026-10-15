import { Injectable } from "@nestjs/common";
import { prisma, Prisma } from "@acropora/database";

import { assetsOutsideDepartment } from "../common/assets-in-department.js";
import { unitPathsFor, unitRowsFor } from "../common/unit-path-lookup.js";
import { budapestYearRange } from "./maintenance-order-occasion-year.js";

const orderInclude = {
  contract: {
    select: {
      id: true,
      number: true,
      title: true,
      customerId: true,
      organizationalUnitName: true,
      contactPersonName: true,
      customer: { select: { id: true, displayName: true } },
    },
  },
  items: {
    include: {
      contractItem: {
        select: { id: true, position: true, departmentId: true },
      },
    },
  },
  documents: {
    orderBy: { createdAt: "desc" as const },
    select: {
      id: true,
      type: true,
      fileName: true,
      contentType: true,
      sizeBytes: true,
      createdAt: true,
    },
  },
};

export type MaintenanceOrderItemInput = {
  contractItemId: string;
  description: string;
  unitNet: Prisma.Decimal;
  quantity: Prisma.Decimal;
  vatRatePercent: Prisma.Decimal;
};

export type MaintenanceOrderGeneratedDocument = {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  content: Buffer;
};

/**
 * A PORTÁL SELECTJE -- STRUKTURÁLISAN ÁR NÉLKÜL, NEM CSAK A LEKÉPZÉSBEN
 * ELHAGYVA.
 *
 * Szándékosan NEM az `orderInclude`-ot használja: az `items` relációja ott
 * `unitNet`/`vatRatePercent`-et is hoz (`MaintenanceOrderItem` minden
 * skalár mezője, mert nincs rajta `select`). Egy portál-mapper, ami csak
 * NEM ír ki egy mezőt, egy jóhiszemű bővítésnél visszakerülhet a válaszba;
 * egy `select`, ami a mezőt le sem kérdezi, nem tudja.
 */
const portalOrderSelect = {
  id: true,
  number: true,
  status: true,
  occasionYear: true,
  issuedAt: true,
  contract: {
    select: { number: true, title: true, customerId: true },
  },
  items: {
    select: {
      id: true,
      description: true,
      quantity: true,
      contractItem: { select: { position: true, departmentId: true } },
    },
  },
  documents: {
    orderBy: { createdAt: "desc" as const },
    select: {
      id: true,
      type: true,
      fileName: true,
      contentType: true,
      sizeBytes: true,
      createdAt: true,
    },
  },
} satisfies Prisma.MaintenanceOrderSelect;

export type PortalMaintenanceOrderRow = Prisma.MaintenanceOrderGetPayload<{
  select: typeof portalOrderSelect;
}>;

/** A tételek éves felhasználása (lásd `reserveOccasions`), tételenként. */
async function occasionsUsed(
  tx: Prisma.TransactionClient,
  contractItemIds: string[],
  year: number,
): Promise<Map<string, number>> {
  const used = new Map<string, number>();
  if (!contractItemIds.length) return used;
  const add = (contractItemId: string, count: number) =>
    used.set(contractItemId, (used.get(contractItemId) ?? 0) + count);
  const orderItems = await tx.maintenanceOrderItem.groupBy({
    by: ["contractItemId"],
    where: {
      contractItemId: { in: contractItemIds },
      maintenanceOrder: { occasionYear: year, status: { not: "REVOKED" } },
    },
    _count: { contractItemId: true },
  });
  for (const row of orderItems)
    add(row.contractItemId, row._count.contractItemId);
  const jobItems = await tx.serviceJobContractItem.groupBy({
    by: ["contractItemId"],
    where: {
      contractItemId: { in: contractItemIds },
      serviceJob: {
        status: { not: "CANCELLED" },
        maintenanceOrder: { is: null },
        createdAt: budapestYearRange(year),
      },
    },
    _count: { contractItemId: true },
  });
  for (const row of jobItems)
    add(row.contractItemId, row._count.contractItemId);
  return used;
}

@Injectable()
export class MaintenanceOrdersRepository {
  private readonly database = prisma;

  list(contractId: string) {
    return this.database.maintenanceOrder.findMany({
      where: { contractId },
      orderBy: { issuedAt: "desc" },
      include: orderInclude,
    });
  }

  detail(id: string) {
    return this.database.maintenanceOrder.findUnique({
      where: { id },
      include: orderInclude,
    });
  }

  /**
   * A SZERZŐDÉS ÉS A KIVÁLASZTOTT TÉTELEK, KIÁLLÍTÁSHOZ.
   *
   * Csak azokat a tételeket adja vissza, amik TÉNYLEG ehhez a szerződéshez
   * tartoznak -- ha a hívó egy másik szerződés tétel-azonosítóját küldi be
   * (elgépelés vagy összefésült űrlap), az csendben kimaradna a szűrés
   * nélkül, és a hívó azt hinné, megrendelte, amit valójában nem.
   */
  contractForIssuance(contractId: string, itemIds: string[]) {
    return this.database.contract.findUnique({
      where: { id: contractId },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        kind: true,
        organizationalUnitName: true,
        contactPersonName: true,
        customer: { select: { id: true, displayName: true } },
        items: {
          where: { id: { in: itemIds } },
          orderBy: { position: "asc" },
          select: {
            id: true,
            position: true,
            description: true,
            unitNet: true,
            quantity: true,
            occasionsPerYear: true,
            vatRatePercent: true,
            departmentId: true,
          },
        },
      },
    });
  }

  /** A helyszínek teljes útja, hibaüzenetbe -- ugyanaz a felbontás, mint a munkalapon. */
  departmentPaths(departmentIds: readonly string[]) {
    return unitPathsFor(this.database, [...departmentIds]);
  }

  /** A helyszínek gazdáinak teljes fája (a közös felső helyszínhez). */
  departmentTree(departmentIds: readonly string[]) {
    return unitRowsFor(this.database, departmentIds);
  }

  /**
   * A SZERZŐDÉS-TÉTELEK ESZKÖZEI (`ContractItemAsset`), TÉTELENKÉNT -- DE
   * CSAK AZOK, AMIK MA IS A TÉTEL HELYSZÍNÉNEK RÉSZFÁJÁN ÁLLNAK.
   *
   * A szűrés oka: a lap és a munkalap létrehozása ugyanezt a részfa-szabályt
   * kéri számon (`requireAssetsOnDepartment`, `requireAssetsInDepartment`),
   * és hibát dob egy kívül álló eszközre. A szerződés mentése ugyan a tétel
   * helyszínéhez méri az eszközt, de csak 2026-09-24 óta (előtte a partnerhez),
   * és egy eszköz azóta át is költözhetett. Szűrés nélkül egy ilyen eszköz egy
   * vevő által aláírt megrendelőlap feldolgozását állítaná meg, holott a
   * megrendelés a TÉTELRE szól, nem az eszközre. Ami nem a helyszínen áll, azt
   * ott nem is lehet karbantartani -- ezért marad le a lapról.
   *
   * A KIMARADTAKAT IS VISSZAADJA (`outside`, karbantartási felmérés S3): a
   * szerződés eszközlistája ilyenkor elavult, és a hívó jelzi (barracuda
   * 31588, nautilus 31615).
   */
  async itemAssetsBySite(
    items: readonly { contractItemId: string; departmentId: string }[],
  ): Promise<Map<string, { onSite: string[]; outside: string[] }>> {
    const result = new Map<string, { onSite: string[]; outside: string[] }>();
    if (items.length === 0) return result;
    const rows = await this.database.contractItemAsset.findMany({
      where: {
        contractItemId: { in: items.map((item) => item.contractItemId) },
      },
      select: { contractItemId: true, assetId: true },
    });
    for (const item of items) {
      const assetIds = rows
        .filter((row) => row.contractItemId === item.contractItemId)
        .map((row) => row.assetId);
      if (assetIds.length === 0) {
        result.set(item.contractItemId, { onSite: [], outside: [] });
        continue;
      }
      const outside = new Set(
        await assetsOutsideDepartment(assetIds, item.departmentId),
      );
      result.set(item.contractItemId, {
        onSite: assetIds.filter((assetId) => !outside.has(assetId)),
        outside: assetIds.filter((assetId) => outside.has(assetId)),
      });
    }
    return result;
  }

  /**
   * A HELYSZÍN NEVE, NEM A TELJES ÚTJA -- a portál "Helyszín" oszlopának
   * (acrobot szabálya, msg_id 23868): "annak a neve", a Figma terv is
   * rövid nevet mutat ("Trópusi ház"), nem breadcrumb-ösvényt.
   */
  async departmentNames(
    departmentIds: readonly string[],
  ): Promise<Map<string, string>> {
    if (departmentIds.length === 0) return new Map();
    const rows = await this.database.worksheetDepartment.findMany({
      where: { id: { in: [...departmentIds] } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  defaultAddress(customerId: string) {
    return this.database.customerAddress.findFirst({
      where: { customerId, isDefault: true },
      select: { line1: true, line2: true, postalCode: true, city: true },
    });
  }

  async lastNumberOfYear(prefix: string): Promise<string | null> {
    const row = await this.database.maintenanceOrder.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    return row?.number ?? null;
  }

  /**
   * AZ ÉVES ALKALOMKERET FOGLALÁSA, ZÁRRAL (karbantartási felmérés S0/1,
   * Balázs 2026-10-15; a zár barracuda 31567-es kikötése).
   *
   * Egy tranzakcióban: (1) szerződésenkénti zár (`pg_advisory_xact_lock`, a
   * tranzakció végén magától oldódik), (2) a tételek ÉVES felhasználása,
   * (3) ha egy tétel elérte az `occasionsPerYear`-t, a túllépett tételek
   * listája jön vissza, és SEMMI nem íródik; különben (4) a hívó `write`-ja
   * ugyanebben a tranzakcióban fut. Zár nélkül két egyszerre indított
   * foglalás ugyanazt a maradékot látná, és együtt túllépnék a keretet.
   *
   * MI SZÁMÍT FELHASZNÁLÁSNAK, tételenként, az adott évben:
   *   - a nem visszavont megrendelőlap tétele (`occasionYear` szerint; egy
   *     visszavont kiállítás felszabadítja az alkalmat);
   *   - a megrendelőlap NÉLKÜLI, nem lemondott karbantartási lap
   *     `ServiceJobContractItem` sora, a lap létrehozásának budapesti éve
   *     szerint. A megrendelőlapos lap sora NEM számít külön: annak az
   *     alkalmát a megrendelőlap már lefoglalta.
   *
   * Az alkalom nélküli tételnek (`occasionsPerYear` null) nincs kerete, tehát
   * az mindig túllépett: ugyanaz a viselkedés, mint eddig a kiállításnál.
   */
  async reserveOccasions<T>(
    input: {
      contractId: string;
      year: number;
      items: readonly {
        contractItemId: string;
        description: string;
        occasionsPerYear: number | null;
      }[];
    },
    write: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<
    | { ok: true; value: T }
    | { ok: false; exhausted: string[] }
    | { ok: false; busy: true }
  > {
    /*
      AZ IDŐKORLÁT KIMONDVA (barracuda 31686): a Prisma interaktív
      tranzakciójának alapja 5 mp, és a zárra várás is beleszámít. Egy
      torlódásnál (több kiállítás vagy lap ugyanarra a szerződésre) a várakozó
      ennél tovább állhat; a lejárt tranzakció P2028-at ad, és az nem
      keret-túllépés, hanem "próbáld újra": a hívó így tudja megkülönböztetni.
    */
    try {
      return await this.reserveOccasionsLocked(input, write);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2028"
      )
        return { ok: false as const, busy: true as const };
      throw error;
    }
  }

  private reserveOccasionsLocked<T>(
    input: {
      contractId: string;
      year: number;
      items: readonly {
        contractItemId: string;
        description: string;
        occasionsPerYear: number | null;
      }[];
    },
    write: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.database.$transaction(
      async (tx) => {
        // a `::text` azért kell, mert a void visszatérést a Prisma nem tudja beolvasni
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`maintenance-occasions:${input.contractId}`}))::text`;
        const used = await occasionsUsed(
          tx,
          input.items.map((item) => item.contractItemId),
          input.year,
        );
        const exhausted = input.items.filter(
          (item) =>
            (used.get(item.contractItemId) ?? 0) >=
            (item.occasionsPerYear ?? 0),
        );
        if (exhausted.length)
          return {
            ok: false as const,
            exhausted: exhausted.map((item) => item.description),
          };
        return { ok: true as const, value: await write(tx) };
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
  }

  /**
   * A MEGRENDELŐLAP NÉLKÜLI LAP ÁLLAPOTA A FOGLALÁSHOZ: mikor jött létre (az
   * alkalomkeret éve ebből számol) és hány szerződés-tétele van már. Ha
   * vannak, egy korábbi próbálkozás a foglalásig eljutott: az újrahívás nem
   * foglal újra (a saját sorait különben a keret felhasználásnak látná).
   */
  async serviceJobContractItemState(
    where: { id: string } | { clientOperationId: string },
  ) {
    const job = await this.database.serviceJob.findUnique({
      where,
      select: {
        id: true,
        createdAt: true,
        status: true,
        contractId: true,
        _count: { select: { contractItems: true } },
      },
    });
    return job
      ? {
          id: job.id,
          createdAt: job.createdAt,
          status: job.status,
          contractId: job.contractId,
          itemCount: job._count.contractItems,
        }
      : null;
  }

  /**
   * A LAP SZERZŐDÉS-TÉTELEI, ÁRRÖGZÍTÉSSEL (felmérés S4; a másolat oka a
   * `ServiceJobContractItem` modell fejlécén). A foglalás `write`-jaként fut,
   * a zár alatt.
   */
  insertServiceJobContractItems(
    tx: Prisma.TransactionClient,
    serviceJobId: string,
    items: readonly {
      contractItemId: string;
      description: string;
      unitNet: Prisma.Decimal;
      quantity: Prisma.Decimal;
      vatRatePercent: Prisma.Decimal;
    }[],
  ) {
    return tx.serviceJobContractItem.createMany({
      data: items.map((item) => ({ serviceJobId, ...item })),
    });
  }

  /**
   * A KIÁLLÍTÁS: A REKORD, A TÉTEL-MÁSOLATOK ÉS A GENERÁLT PDF EGY
   * TRANZAKCIÓBAN. Ha külön mennének, egy megszakadt kérés után a rendelés
   * már létezne, a PDF viszont nélküle -- és a felület egy dokumentum
   * nélküli, kiadhatatlan kiállítást mutatna.
   */
  async issue(
    input: {
      contractId: string;
      number: string;
      occasionYear: number;
      issuedByName: string | null;
      items: MaintenanceOrderItemInput[];
      document: MaintenanceOrderGeneratedDocument;
    },
    tx: Prisma.TransactionClient = this.database,
  ) {
    return tx.maintenanceOrder.create({
      data: {
        contractId: input.contractId,
        number: input.number,
        occasionYear: input.occasionYear,
        issuedByName: input.issuedByName,
        items: {
          create: input.items.map((item) => ({
            contractItemId: item.contractItemId,
            description: item.description,
            unitNet: item.unitNet,
            quantity: item.quantity,
            vatRatePercent: item.vatRatePercent,
          })),
        },
        documents: {
          create: {
            type: "GENERATED_FORM",
            fileName: input.document.fileName,
            contentType: input.document.contentType,
            sizeBytes: input.document.sizeBytes,
            content: Uint8Array.from(input.document.content),
          },
        },
      },
      include: orderInclude,
    });
  }

  document(orderId: string, documentId: string) {
    return this.database.maintenanceOrderDocument.findFirst({
      where: { id: documentId, maintenanceOrderId: orderId },
      select: { fileName: true, contentType: true, content: true },
    });
  }

  /**
   * A DOKUMENTUM MENTÉSE ÉS AZ ÁLLAPOTVÁLTÁS EGY TRANZAKCIÓBAN.
   *
   * Balázs éles hibája (2026-09-24 21:48, staging): korábban a dokumentum
   * mentése és a `SIGNED` állapot két KÜLÖN hívás volt, a karbantartási lap
   * (másik két szolgáltatás) létrehozása pedig közéjük ékelődött. Egy
   * megszakadt kérés így elmenthette a dokumentumot úgy, hogy az állapot
   * ISSUED maradt -- egy újrapróbálkozás ÚJRA elmentette volna a
   * dokumentumot. Ez a két írás most EGYÜTT, egy tranzakcióban fut: vagy
   * mindkettő megtörténik, vagy egyik sem. Az `uploadSignedDocument()`
   * ezután az `order.status` értékéből tudja, hogy ezt a lépést kell-e
   * még elvégezni, vagy a hívás egy MEGSZAKADT próbálkozás folytatása
   * (lásd a szolgáltatás fejlécét).
   */
  async saveSignedDocumentAndMarkSigned(
    orderId: string,
    file: Express.Multer.File,
  ) {
    return this.database.$transaction(async (tx) => {
      await tx.maintenanceOrderDocument.create({
        data: {
          maintenanceOrderId: orderId,
          type: "SIGNED_FORM",
          fileName: file.originalname,
          contentType: file.mimetype,
          sizeBytes: file.size,
          content: Uint8Array.from(file.buffer),
        },
      });
      await tx.maintenanceOrder.update({
        where: { id: orderId },
        data: { status: "SIGNED", signedAt: new Date() },
      });
    });
  }

  /**
   * A KARBANTARTÁSI LAP HOZZÁRENDELÉSE -- KÜLÖN LÉPÉS, MERT A LAP MAGA
   * MÁSIK KÉT SZOLGÁLTATÁSON (`ServiceJobsService`, `WorksheetsService`)
   * ÁT JÖN LÉTRE, KÖZÖS TRANZAKCIÓ NÉLKÜL. Az idempotenciát emiatt NEM ez
   * a hívás adja, hanem hogy azok a hívások MAGUK is `clientOperationId`
   * alapján dolgoznak -- lásd `uploadSignedDocument()`.
   */
  attachServiceJob(orderId: string, serviceJobId: string) {
    return this.database.maintenanceOrder.update({
      where: { id: orderId },
      data: { serviceJobId },
      include: orderInclude,
    });
  }

  markRevoked(
    orderId: string,
    revokedByName: string | null,
    reason: string | null,
  ) {
    return this.database.maintenanceOrder.update({
      where: { id: orderId },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        revokedByName,
        revokeReason: reason,
      },
      include: orderInclude,
    });
  }

  /**
   * A PORTÁL LISTÁJA -- AZ ÜGYFÉL ÖSSZES SZERZŐDÉSÉBŐL, NEM EGYETLEN
   * `contractId`-RA SZŰKÍTVE (ellentétben a belső `list()`-tel). A
   * hívó-szintű láthatóságot (melyik helyszín) a szolgáltatás-réteg dönti
   * el a betöltött tételeken -- lásd `maintenance-order-visibility.ts`.
   */
  portalListForCustomer(
    customerId: string,
  ): Promise<PortalMaintenanceOrderRow[]> {
    return this.database.maintenanceOrder.findMany({
      where: { contract: { customerId } },
      orderBy: { issuedAt: "desc" },
      select: portalOrderSelect,
    });
  }

  /**
   * `findFirst`, NEM `findUnique` -- ugyanaz az indok, mint az
   * `AquariumsRepository.detail()`-nél: a hívó-szintű ügyfél-szűrést itt
   * kötjük az `id`-hoz, a tétel-szintű helyszín-láthatóságot a
   * szolgáltatás-réteg dönti el a visszaadott sorból.
   */
  portalDetail(
    id: string,
    customerId: string | null,
  ): Promise<PortalMaintenanceOrderRow | null> {
    return this.database.maintenanceOrder.findFirst({
      where:
        customerId === null
          ? { id }
          : { AND: [{ id }, { contract: { customerId } }] },
      select: portalOrderSelect,
    });
  }

  /**
   * VAN-E BEJELÖLVE A HÍVÓNÁL AZ ALÁÍRT MEGRENDELŐLAP FELTÖLTÉSÉNEK
   * KÉPESSÉGE -- ugyanaz a minta, mint az `AquariumsRepository`
   * `hasAquariumAssetAssignCapability()`-je.
   */
  async hasUploadSignedCapability(userId: string): Promise<boolean> {
    const row = await this.database.userServiceCapability.findUnique({
      where: {
        userId_capability: {
          userId,
          capability: "MAINTENANCE_ORDER_UPLOAD_SIGNED",
        },
      },
    });
    return row !== null;
  }
}
