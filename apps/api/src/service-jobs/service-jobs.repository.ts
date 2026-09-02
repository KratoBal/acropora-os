import { Injectable } from "@nestjs/common";
import { prisma, type Prisma, type ServiceJobStatus } from "@acropora/database";

/**
 * A LEZÁRT ÁLLAPOTOK, EGY HELYEN. A lista alapból ezeket hagyja ki - és ha egy
 * új záró állapot keletkezik, itt kell felvenni, nem a lekérdezésben.
 */
const FINISHED: ServiceJobStatus[] = ["COMPLETED", "CANCELLED"];

export interface ServiceJobRow {
  id: string;
  jobNumber: string;
  title: string;
  status: ServiceJobStatus;
  customerName: string | null;
  createdAt: Date;
  worksheetCount: number;
}

@Injectable()
export class ServiceJobsRepository {
  private readonly database = prisma;

  async create(input: {
    jobNumber: string;
    title: string;
    description: string | null;
    customerId: string | null;
    actorUserId: string;
  }) {
    // A KELETKEZÉS IS ESEMÉNY, és a naplóba is bekerül - egy tranzakcióban.
    // Külön írva a kettő szétcsúszhatna: egy jegy, aminek nincs első sora a
    // naplóban, úgy néz ki, mintha a semmiből lépett volna tovább.
    return this.database.serviceJob.create({
      data: {
        jobNumber: input.jobNumber,
        title: input.title,
        description: input.description,
        customerId: input.customerId,
        events: {
          create: {
            // `fromStatus` nincs: a keletkezésnek nincs előzménye.
            toStatus: "NEW",
            actorUserId: input.actorUserId,
          },
        },
      },
      select: { id: true, jobNumber: true },
    });
  }

  async list(scope: "open" | "all"): Promise<ServiceJobRow[]> {
    const where: Prisma.ServiceJobWhereInput =
      scope === "open" ? { status: { notIn: FINISHED } } : {};

    const rows = await this.database.serviceJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        jobNumber: true,
        title: true,
        status: true,
        createdAt: true,
        customer: { select: { displayName: true } },
        // A DARABSZÁM A LISTÁN LÁTSZIK, mert a jegy értéke abból derül ki,
        // hány munka áll mögötte. Egy külön lekérdezés soronként N+1 lenne.
        _count: { select: { worksheets: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      jobNumber: row.jobNumber,
      title: row.title,
      status: row.status,
      customerName: row.customer?.displayName ?? null,
      createdAt: row.createdAt,
      worksheetCount: row._count.worksheets,
    }));
  }

  /** Az idei legnagyobb sorszám, a következő szám kiosztásához. */
  async lastNumberOfYear(prefix: string): Promise<string | null> {
    const row = await this.database.serviceJob.findFirst({
      where: { jobNumber: { startsWith: prefix } },
      orderBy: { jobNumber: "desc" },
      select: { jobNumber: true },
    });
    return row?.jobNumber ?? null;
  }

  /**
   * A LÉPÉS ÉS A NAPLÓSOR EGY TRANZAKCIÓBAN.
   *
   * Ha külön mennének, egy megszakadt kérés után a jegy már az új állapotban
   * állna, a napló pedig hallgatna róla - és a részletlap azt mutatná, hogy a
   * jegy magától mozdult.
   */
  async move(input: {
    id: string;
    from: ServiceJobStatus;
    to: ServiceJobStatus;
    note: string | null;
    actorUserId: string;
  }) {
    return this.database.$transaction(async (transaction) => {
      // A `from` FELTÉTEL A WHERE-BEN, nem csak az olvasásnál: két egyszerre
      // lépő ember közül a második így nem írja felül az elsőt csendben.
      const moved = await transaction.serviceJob.updateMany({
        where: { id: input.id, status: input.from },
        data: { status: input.to },
      });
      if (moved.count !== 1) return { ok: false as const };

      await transaction.serviceJobEvent.create({
        data: {
          serviceJobId: input.id,
          fromStatus: input.from,
          toStatus: input.to,
          note: input.note,
          actorUserId: input.actorUserId,
        },
      });
      return { ok: true as const };
    });
  }

  /**
   * A RÉSZLETLAP HÁROM FORRÁSA, EGY LEKÉRDEZÉSBEN.
   *
   * Külön hívásokban N+1 lenne, és ami rosszabb: a három lista MÁS
   * pillanatképet mutatna. Egy napló, amiben a lépés már benne van, de a
   * hozzá tartozó munkalap még nem, olvasás közben keletkezett hazugság.
   *
   * A `null` visszatérés a NINCS ILYEN JEGY esetet jelenti, nem az üreset -
   * a hívó ebből tud 404-et mondani. Egy üres részletlap ugyanúgy nézne ki,
   * mint egy létező, még üres jegy.
   */
  async detail(id: string) {
    return this.database.serviceJob.findUnique({
      where: { id },
      select: {
        id: true,
        jobNumber: true,
        title: true,
        description: true,
        status: true,
        createdAt: true,
        customer: { select: { displayName: true } },
        events: {
          // A napló legújabb felül; a végleges sorrendet a közös
          // `serviceJobTimeline` adja, de a lekérdezés se adjon vaktában.
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            fromStatus: true,
            toStatus: true,
            note: true,
            createdAt: true,
            actor: { select: { displayName: true } },
          },
        },
        worksheets: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            number: true,
            createdAt: true,
            handedOverAt: true,
          },
        },
        assets: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            assetId: true,
            createdAt: true,
            asset: { select: { assetNumber: true, name: true } },
          },
        },
      },
    });
  }

  async statusOf(id: string): Promise<ServiceJobStatus | null> {
    const row = await this.database.serviceJob.findUnique({
      where: { id },
      select: { status: true },
    });
    return row?.status ?? null;
  }
}
