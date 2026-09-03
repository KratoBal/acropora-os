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
        // A NYITO A JEGYEN, NEM CSAK A NAPLOBAN. Ugyanaz az aktor kerul mindket
        // helyre, egy tranzakcioban -- de a naplo aktora `SetNull` egy kesobbi
        // felhasznalo-torlesnel, ez a mezo pedig megmarad. A ketto tehat nem
        // duplikacio: mas a feladatuk es mas a sorsuk.
        openedById: input.actorUserId,
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
        scheduledAt: true,
        startedAt: true,
        completedAt: true,
        customer: { select: { displayName: true } },
        events: {
          // CSAK AZ ALLAPOTVALTASOK, KIMONDVA (ADR-013). A naplo tablaja
          // 2026-09-02 ota tobbfajta sort hordoz, es ennek az olvasonak az
          // ERTELME VALTOZATLAN: allapotvaltasokat fesul ossze. A szures
          // ezert nem szukites, hanem a mai jelentes megtartasa -- enelkul
          // egy munkalap-esemeny cel-allapot nelkul kerulne az idovonalra.
          where: { kind: "STATUS_CHANGE" },
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

  /**
   * EGY MEGLEVO LAP A JEGY ALA.
   *
   * A `serviceJobId: null` FELTETEL A `WHERE`-BEN VAN, nem egy elozetes
   * olvasasban: ket egyszerre csatolo ember kozul a masodik igy nem veszi el
   * csendben a lapot az elsotol, hanem nem talal sort, es a hivo utkozest mond.
   *
   * MASODIK JEGY ALA NEM KERULHET at egy lap. Nem azert, mert technikailag nem
   * menne, hanem mert az ATSOROLAS mas muvelet, mas kerdesekkel (mi tortenjen a
   * regi jegy naplojaval, latja-e a partner) - es azokra ma nincs dontes.
   */
  async attachWorksheet(input: { serviceJobId: string; worksheetId: string }) {
    const attached = await this.database.worksheet.updateMany({
      where: { id: input.worksheetId, serviceJobId: null },
      data: { serviceJobId: input.serviceJobId },
    });
    return { ok: attached.count === 1 };
  }

  /**
   * A LAP LEVALASZTASA A JEGYROL.
   *
   * A FELTETEL ITT IS A `WHERE`-BEN ALL: csak akkor ir, ha a lap EPP EHHEZ a
   * jegyhez tartozik. Ket egyszerre dolgozo ember kozul a masodik igy nem
   * valaszt le olyat, amit kozben mar athelyeztek vagy levalasztottak.
   *
   * ES AMI EZ NEM: atsorolas. A lap a jegy NELKULI allapotba kerul vissza, ami
   * a modellben amugy is letezik es rendes -- a masik jegy ala helyezes mas
   * muvelet, mas kerdesekkel, es azokra nincs dontes.
   */
  async detachWorksheet(input: { serviceJobId: string; worksheetId: string }) {
    const detached = await this.database.worksheet.updateMany({
      where: { id: input.worksheetId, serviceJobId: input.serviceJobId },
      data: { serviceJobId: null },
    });
    return { ok: detached.count === 1 };
  }

  /**
   * Letezik-e a lap, all-e mar jegy alatt, es KIE.
   *
   * A partner azert jon ide, mert a csatolas feltetele: a lap es a jegy
   * ugyanahhoz a partnerhez tartozzon. Kulon lekerdezes nelkul, ugyanabbol a
   * sorbol -- egy masodik korben a ket ertek mar ket kulonbozo pillanate lenne.
   */
  async worksheetAttachState(
    id: string,
  ): Promise<{ serviceJobId: string | null; customerId: string } | null> {
    return this.database.worksheet.findUnique({
      where: { id },
      select: { serviceJobId: true, customerId: true },
    });
  }

  /**
   * A PARTNER BEALLITASA EGY MEG PARTNER NELKULI JEGYRE.
   *
   * A `customerId: null` FELTETEL A `WHERE`-BEN, nem elozetes olvasasban: ket
   * egyszerre allito ember kozul a masodik nem irja felul csendben az elsot.
   *
   * ES AMI EZ NEM: ATSOROLAS. Egy jegy, aminek MAR van partnere, ezen az uton
   * nem valtoztathato meg -- az mas muvelet, mas kerdesekkel (mi legyen a mar
   * csatolt lapokkal, mit lat a regi partner), es azokra ma nincs dontes.
   */
  async setPartner(input: { id: string; customerId: string }) {
    const updated = await this.database.serviceJob.updateMany({
      where: { id: input.id, customerId: null },
      data: { customerId: input.customerId },
    });
    return { ok: updated.count === 1 };
  }

  /** Letezik-e ez a vevo. A hibauzenet igy megnevezheti, MI a baj. */
  async customerExists(id: string): Promise<boolean> {
    const row = await this.database.customer.findUnique({
      where: { id },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * A JEGY LETEZESE ES PARTNERE, egy lekerdezesben.
   *
   * A `customerId` NULLAZHATO a jegyen (a lape nem), es epp ez a kulonbseg
   * teszi a csatolast dontesse: partner nelkuli jegy ala nem mehet lap
   * (acrobot dontese, 2026-09-02 -- NEM a gazdae: az a kerdes ma meg a sorban
   * all) -- kulonben a jegy CSENDBEN megkapna egy partner tulajdonat, esemeny
   * nelkul.
   */
  async jobAttachState(
    id: string,
  ): Promise<{ customerId: string | null } | null> {
    return this.database.serviceJob.findUnique({
      where: { id },
      select: { customerId: true },
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
