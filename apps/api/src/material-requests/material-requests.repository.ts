import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";

export interface MaterialRequestItemInput {
  name: string;
  quantity: string;
  unit: string;
}

export interface MaterialRequestItemRow {
  id: string;
  name: string;
  quantity: string;
  unit: string;
}

export type MaterialRequestStatus = "DRAFT" | "OPEN" | "RECEIVED";

export interface MaterialRequestRow {
  id: string;
  worksheetId: string;
  status: MaterialRequestStatus;
  requestedById: string | null;
  requestedByName: string | null;
  createdAt: Date;
  submittedAt: Date | null;
  receivedAt: Date | null;
  receivedByName: string | null;
  items: MaterialRequestItemRow[];
}

/** Ugyanaz a szuk mezo-halmaz, ami a kuldeshez kell -- lasd a hivokat. */
export interface ActiveUserContact {
  id: string;
  email: string;
  displayName: string;
}

const rowInclude = {
  requestedBy: { select: { displayName: true } },
  receivedBy: { select: { displayName: true } },
  items: { orderBy: { position: "asc" } },
} satisfies Prisma.MaterialRequestInclude;

function toRow(row: {
  id: string;
  worksheetId: string;
  status: MaterialRequestStatus;
  requestedById: string | null;
  requestedBy: { displayName: string } | null;
  createdAt: Date;
  submittedAt: Date | null;
  receivedAt: Date | null;
  receivedBy: { displayName: string } | null;
  items: { id: string; name: string; quantity: string; unit: string }[];
}): MaterialRequestRow {
  return {
    id: row.id,
    worksheetId: row.worksheetId,
    status: row.status,
    requestedById: row.requestedById,
    requestedByName: row.requestedBy?.displayName ?? null,
    createdAt: row.createdAt,
    submittedAt: row.submittedAt,
    receivedAt: row.receivedAt,
    receivedByName: row.receivedBy?.displayName ?? null,
    items: row.items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
    })),
  };
}

@Injectable()
export class MaterialRequestsRepository extends Repository {
  constructor() {
    super(prisma);
  }

  /**
   * PISZKOZATKENT HOZZA LETRE -- a `MaterialRequestStatus.DRAFT` az
   * adatbazis-alapertelmezes, itt nincs kulon iras. A fej es a tetelek EGY
   * tranzakcioban jonnek letre (a Prisma beagyazott `create` ezt magatol
   * biztositja), tehat felig felvitt igeny nem allhat elo.
   *
   * ERTESITES NEM INNEN INDUL -- lasd `submit`.
   */
  async create(input: {
    worksheetId: string;
    requestedById: string | null;
    items: readonly MaterialRequestItemInput[];
  }): Promise<MaterialRequestRow> {
    const row = await this.database.materialRequest.create({
      data: {
        worksheetId: input.worksheetId,
        requestedById: input.requestedById,
        items: {
          create: input.items.map((item, index) => ({
            position: index,
            name: item.name,
            quantity: item.quantity,
            unit: item.unit,
          })),
        },
      },
      include: rowInclude,
    });
    return toRow(row);
  }

  /**
   * ATOMI, FELTETELES ATMENET, UGYANAZ A MINTA, MINT A `markReceived`-nel:
   * csak akkor ir, ha MEG `DRAFT` ES a hivo a SAJAT piszkozatat kuldi el --
   * a masik ember piszkozatanak elkuldese nem irasi jog kerdese, hanem
   * tulajdon kerdese.
   */
  async submit(input: {
    id: string;
    requestedById: string;
  }): Promise<MaterialRequestRow | null> {
    const eredmeny = await this.database.materialRequest.updateMany({
      where: {
        id: input.id,
        status: "DRAFT",
        requestedById: input.requestedById,
      },
      data: { status: "OPEN", submittedAt: new Date() },
    });
    if (eredmeny.count === 0) return null;
    return this.detail(input.id);
  }

  /**
   * A PISZKOZATOK REJTETTEK, KIVEVE A SAJATJAT -- Balazs kerese: "a
   * szervizes lassa a sajat piszkozatat a munkalapon". Masok piszkozata nem
   * kesz tartalom, tehat a lista nem mutatja -- ez NEM jogosultsagi
   * kerdes (mindenki, aki a lapot latja, ide is jogosult lenne), hanem a
   * TARTALOM allapota.
   */
  async listForWorksheet(
    worksheetId: string,
    actorId: string,
  ): Promise<MaterialRequestRow[]> {
    const rows = await this.database.materialRequest.findMany({
      where: {
        worksheetId,
        OR: [{ status: { not: "DRAFT" } }, { requestedById: actorId }],
      },
      include: rowInclude,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toRow);
  }

  async detail(id: string): Promise<MaterialRequestRow | null> {
    const row = await this.database.materialRequest.findUnique({
      where: { id },
      include: rowInclude,
    });
    return row ? toRow(row) : null;
  }

  /**
   * A BESZERZO SAJAT LISTAJA: a meg nyitott igenyek, a legregebbi elol -- azt
   * kell eloszor elintezni, ami legregebben var.
   *
   * A MUNKALAP-KONTEXTUS EGYUTT JON (customer, department), mert a beszerzo
   * TOBB igeny kozott tajekozodik, es egyetlen igeny onmagaban nem mondja
   * meg, MELYIK munkarol van szo.
   */
  async listPending(): Promise<
    (MaterialRequestRow & {
      worksheetNumber: string | null;
      customerDisplayName: string;
      departmentName: string;
    })[]
  > {
    const rows = await this.database.materialRequest.findMany({
      where: { status: "OPEN" },
      include: {
        ...rowInclude,
        worksheet: {
          select: {
            number: true,
            customer: { select: { displayName: true } },
            department: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({
      ...toRow(row),
      worksheetNumber: row.worksheet.number,
      customerDisplayName: row.worksheet.customer.displayName,
      departmentName: row.worksheet.department.name,
    }));
  }

  /**
   * ATOMI, FELTETELES ATMENET: csak akkor ir, ha MEG `OPEN` -- ket egyidejű
   * kattintas kozul csak az egyik nyerhet, es a masik `null`-t kap, nem egy
   * masodik "beerkezett" ertesitest.
   */
  async markReceived(input: {
    id: string;
    receivedById: string;
  }): Promise<MaterialRequestRow | null> {
    const eredmeny = await this.database.materialRequest.updateMany({
      where: { id: input.id, status: "OPEN" },
      data: {
        status: "RECEIVED",
        receivedAt: new Date(),
        receivedById: input.receivedById,
      },
    });
    if (eredmeny.count === 0) return null;
    return this.detail(input.id);
  }

  /** Akiknel a `MATERIAL_REQUEST_CREATED` ertesulesi szerep be van jelolve. */
  async notificationRecipients(): Promise<ActiveUserContact[]> {
    const rows = await this.database.userNotificationRole.findMany({
      where: { role: "MATERIAL_REQUEST_CREATED", user: { isActive: true } },
      select: {
        user: { select: { id: true, email: true, displayName: true } },
      },
      orderBy: [{ user: { displayName: "asc" } }, { userId: "asc" }],
    });
    return rows.map((row) => row.user);
  }

  /** Van-e bejelolve nala a beerkezes-jelolo kepesseg. */
  async hasMarkReceivedCapability(userId: string): Promise<boolean> {
    const row = await this.database.userServiceCapability.findUnique({
      where: {
        userId_capability: {
          userId,
          capability: "MATERIAL_REQUEST_MARK_RECEIVED",
        },
      },
    });
    return row !== null;
  }

  /**
   * VAN-E AKTIV FELHASZNALO, AKI JELOLHET BEERKEZEST -- BARKI, NEM EGY
   * KONKRET SZEMELY.
   *
   * A `hasMarkReceivedCapability`-tol KULON metodus, mert mas a kerdes: az
   * egy KONKRET felhasznalorol kerdez (a hivo maga), ez pedig arrol, hogy
   * LETEZIK-E EGYALTALAN ilyen valaki -- lasd a `submit()` hivo helyet, miert
   * kell ez a kulonbseg.
   *
   * `findFirst`, NEM `count`: a kerdesre az elso talalat is valaszol, a
   * `@@index([capability])` pedig pontosan erre a mintara all.
   */
  async anyActiveMarkReceivedCapabilityHolder(): Promise<boolean> {
    const row = await this.database.userServiceCapability.findFirst({
      where: {
        capability: "MATERIAL_REQUEST_MARK_RECEIVED",
        user: { isActive: true },
      },
      select: { userId: true },
    });
    return row !== null;
  }

  /**
   * A CIMZETTEK AKTIV, LETEZO SORAI -- A KERO ES A FELELOSOK EMAIL-CIMEHEZ.
   *
   * CSAK AKTIV FELHASZNALO, ugyanaz a szabaly, mint a `notificationRecipients`-nel:
   * egy kilepett kollega nem kap levelet.
   */
  async activeUsersByIds(
    userIds: readonly string[],
  ): Promise<ActiveUserContact[]> {
    if (userIds.length === 0) return [];
    return this.database.user.findMany({
      where: { id: { in: [...userIds] }, isActive: true },
      select: { id: true, email: true, displayName: true },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
    });
  }
}
