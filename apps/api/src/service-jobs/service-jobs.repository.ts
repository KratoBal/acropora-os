import { Injectable } from "@nestjs/common";

import { expandAssignedUnits } from "./assigned-units.js";
import { assetsOutsideDepartment } from "../common/assets-in-department.js";
import { SERVICE_ASSIGNABLE_ROLES } from "../common/service-assignment.js";
import { DOCUMENT_DELETED_ACTION } from "./service-job-documents.repository.js";
import { ALL_SERVICE_JOB_STATUSES } from "./service-job-status.js";
import { prisma, type Prisma, type ServiceJobStatus } from "@acropora/database";

/**
 * A LEZÁRT ÁLLAPOTOK, EGY HELYEN. A lista alapból ezeket hagyja ki - és ha egy
 * új záró állapot keletkezik, itt kell felvenni, nem a lekérdezésben.
 */
const FINISHED: ServiceJobStatus[] = ["COMPLETED", "CANCELLED"];

/**
 * A LISTA HATARA. Nevet kapott, mert ket helyen kell: a lekerdezesben es abban
 * a valaszban, ami megmondja, hogy a lista vagott-e. Ket helyen allo szam
 * elobb-utobb elcsuszik, es a kulonbseg itt NEMA lenne.
 */
const LIST_LIMIT = 200;

/**
 * A SZABAD SZAVAS KERESES FELTETELE.
 *
 * KULON FUGGVENY, mert KET lekerdezes hasznalja: a lista es a szamlalo. Ha a
 * ketto kulon-kulon epitene fel, egyszer elcsuszna -- es a kulonbseg NEMA
 * lenne: a lista harom sort adna, a csempek folotte mast mondananak, es egyik
 * sem nezne ki hibasnak.
 *
 * A HAROM MEZO UGYANAZ, MINT A MUNKALAP-LISTAN: azonosito, partner neve, es a
 * sajat szoveg (ott a targy, itt a cim). Ket szerviz-lista, egy szabaly.
 */
function searchWhere(search: string | undefined): Prisma.ServiceJobWhereInput {
  const trimmed = search?.trim();
  if (!trimmed) return {};
  return {
    OR: [
      { jobNumber: { contains: trimmed, mode: "insensitive" } },
      { title: { contains: trimmed, mode: "insensitive" } },
      {
        customer: {
          displayName: { contains: trimmed, mode: "insensitive" },
        },
      },
    ],
  };
}

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

  /**
   * A HELYSZIN A PARTNERE-E. Egy sor, egy kerdes: a `WorksheetDepartment`
   * `customerId` mezoje KOTELEZO, tehat a talalat hianya vagy azt jelenti,
   * hogy az egyseg nem letezik, vagy azt, hogy mas partnere. A ket eset a
   * hivonak ugyanaz a valasz, es szandekosan: a letezes sem szivaroghat ki egy
   * masik partner egysegerol.
   */
  async departmentBelongsToCustomer(
    departmentId: string,
    customerId: string,
  ): Promise<boolean> {
    const found = await this.database.worksheetDepartment.findFirst({
      where: { id: departmentId, customerId },
      select: { id: true },
    });
    return found !== null;
  }

  /**
   * MELYIK MEGADOTT ESZKOZ NEM ALL A HELYSZIN RESZFAJABAN.
   *
   * A VALASZ A HIANYZOK LISTAJA, NEM EGY IGEN-NEM. Aki elutasitast kap, azt
   * akarja tudni, HANY eszkoz esett ki -- egy puszta "nem jo" ugyanolyan
   * hasznalhatatlan, mint a nema elfogadas.
   *
   * KET LEPES, mert a fa melysege nem korlatos, es a Prisma rekurziv
   * lekerdezest nem tud kifejezni: egy koteg sor, majd egy tiszta bejaras
   * (`collectUnitSubtreeIds`). Ugyanaz a minta, amit az eszkoz-lista szuroje
   * hasznal -- a ket helyen ugyanaz a fuggveny jar be, tehat a felajanlott es
   * az elfogadott halmaz nem tud elcsuszni egymastol.
   *
   * A NEM LETEZO HELYSZIN ONMAGARA SZUKUL, es akkor minden eszkoz "kivul" lesz.
   * Ez a helyes irany: a hivas elutasit, ahelyett hogy egy elgepelt azonositora
   * BARMIT atengedne.
   */
  /**
   * A SZABALY 2026-09-15 OTA KOZOS FUGGVENYBEN ALL
   * (`common/assets-in-department.ts`), mert a MUNKALAP felvitele is ugyanezt
   * kerdezi. Ez a metodus megmarad, hogy a hivoi ne valtozzanak -- de a
   * szabalybol csak EGY peldany van.
   */
  async assetsOutsideDepartment(
    assetIds: readonly string[],
    departmentId: string,
  ): Promise<string[]> {
    return assetsOutsideDepartment(assetIds, departmentId);
  }

  async create(input: {
    jobNumber: string;
    title: string;
    description: string | null;
    customerId: string | null;
    departmentId: string | null;
    assetIds: readonly string[];
    actorUserId: string;
    assigneeIds: readonly string[];
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
        departmentId: input.departmentId,
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
        // AZ ESZKOZOK UGYANEBBEN A TRANZAKCIOBAN. Kulon irva a ketto
        // szetcsuszhatna: egy jegy, aminek a kapcsolt eszkozei csak masodpercek
        // mulva jelennek meg, ugy nez ki, mintha nelkuluk nyitottak volna --
        // es egy megszakadt masodik iras eszrevetlenul hagyna a jegyet urest.
        assets: {
          create: input.assetIds.map((assetId) => ({ assetId })),
        },
        // A DELEGALAS UGYANEBBEN A TRANZAKCIOBAN, ugyanabbol az okbol, amiert
        // a naplo elso sora is itt keletkezik: kulon hivaskent a masodik fele
        // elbukhatna (halozat, jogosultsag, elgepelt azonosito), es epp az a
        // delegalatlan jegy maradna, amit a felvivo mar kiadottnak hisz.
        assignees: {
          create: input.assigneeIds.map((userId) => ({
            userId,
            assignedById: input.actorUserId,
          })),
        },
      },
      select: { id: true, jobNumber: true },
    });
  }

  /**
   * KIT LEHET A JEGYRE DELEGALNI -- a bekuldott halmazbol azok, akik szabad.
   *
   * A szabaly nem itt all, hanem a `common/service-assignment.js` fajlban,
   * ugyanaz, amit a munkalap felelos-kiosztasa hasznal. Ket felteteltol fugg:
   * a kollega AKTIV legyen, es a szerepkore engedje a szerviz kezeleset.
   *
   * URES BEMENETRE URES HALMAZ, lekerdezes NELKUL: egy `in: []` szuro minden
   * sort kizarna, tehat ugyanaz jonne vissza -- csak egy felesleges korrel.
   */
  async assignableUserIds(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.database.user.findMany({
      where: {
        id: { in: [...ids] },
        isActive: true,
        role: { in: [...SERVICE_ASSIGNABLE_ROLES] },
      },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }

  /**
   * A JEGY DELEGALTJAINAK BEALLITASA. A bekuldott lista a teljes nevsor: aki
   * nincs rajta, lekerul.
   *
   * A MAR FENT LEVO SOROKHOZ NEM NYULUNK (`skipDuplicates`), es ez nem
   * takarekossag: az `assignedAt` az egyetlen jel arrol, ki KERULT UJONNAN a
   * jegyre. Ha minden mentes ujrairna az osszes sort, az ertesites ("uj
   * hibajegyed van") minden szerkesztesnel mindenkinek ujra kimenne.
   *
   * AZT JELENTI VISSZA, KI UJ A JEGYEN, nem azt, ki all rajta. A hivo ez
   * alapjan ertesit, es a kulonbseg dont arrol, hallgat-e a telefon: ugyanazt a
   * jegyet ketszer mentve, vagy egy masodik kollegat hozzaadva nem szabad
   * megrezegtetni azt, aki mar rajta volt. Az osszevetes a TRANZAKCION BELUL
   * tortenik, az iras elotti sorokhoz kepest.
   */
  async setAssignees(input: {
    serviceJobId: string;
    userIds: readonly string[];
    actorUserId: string;
  }): Promise<{ ok: boolean; added: string[] }> {
    return this.database.$transaction(async (transaction) => {
      const job = await transaction.serviceJob.findUnique({
        where: { id: input.serviceJobId },
        select: { id: true },
      });
      if (!job) return { ok: false, added: [] };

      const before = await transaction.serviceJobAssignee.findMany({
        where: { serviceJobId: input.serviceJobId },
        select: { userId: true },
      });
      const alreadyAssigned = new Set(before.map((row) => row.userId));

      await transaction.serviceJobAssignee.deleteMany({
        where: {
          serviceJobId: input.serviceJobId,
          ...(input.userIds.length > 0
            ? { userId: { notIn: [...input.userIds] } }
            : {}),
        },
      });

      if (input.userIds.length > 0) {
        await transaction.serviceJobAssignee.createMany({
          data: input.userIds.map((userId) => ({
            serviceJobId: input.serviceJobId,
            userId,
            assignedById: input.actorUserId,
          })),
          skipDuplicates: true,
        });
      }

      return {
        ok: true,
        added: input.userIds.filter((userId) => !alreadyAssigned.has(userId)),
      };
    });
  }

  /**
   * EGY FELHASZNALO LATHATOSAGI EGYSEGEI, A RESZFAVAL EGYUTT.
   *
   * KET LEPES, es a masodik tiszta fuggveny: a Prisma rekurziv lekerdezest nem
   * tud kifejezni, a fa melysege viszont nem korlatos. Ugyanaz az alak, mint a
   * `service-assets` oldalan -- ket kulonbozo bejaras ugyanarra a fara ket
   * kulonbozo valaszt tudna adni.
   *
   * URES HALMAZ IS ERVENYES VALASZ, es nem hiba: aki meg nem kapott
   * hozzarendelest -- vagy akinek a partnere alatt nincs alegyseg, mert nincs
   * tukor-vevo sora -- csak a SAJAT nyitott jegyeit latja. A szuro erre az agra
   * kulon fel van keszitve.
   */
  async assignedUnitIds(userId: string): Promise<string[]> {
    const assignments = await this.database.userWorksheetDepartment.findMany({
      where: { userId },
      select: { departmentId: true },
    });
    if (assignments.length === 0) return [];

    const assignedIds = assignments.map((row) => row.departmentId);
    const found = await this.database.worksheetDepartment.findMany({
      where: { id: { in: assignedIds } },
      select: { customerId: true },
    });
    const customerIds = [...new Set(found.map((row) => row.customerId))];
    const units = customerIds.length
      ? await this.database.worksheetDepartment.findMany({
          where: { customerId: { in: customerIds } },
          select: { id: true, name: true, parentId: true },
        })
      : [];

    return expandAssignedUnits({ assignedIds, units });
  }

  /**
   * A HOZZARENDELESHEZ SZUKSEGES HAROM ADAT, EGY KORBEN.
   *
   * Kulon lekerdezesekkel ugyanez harom kor lenne, es a kozottuk eltelt idoben a
   * partner tukor-sora megvaltozhatna -- egy ellenorzes, ami mas allapoton dont,
   * mint amin ir, nem ellenorzes.
   */
  async assignmentContext(userId: string, departmentId: string) {
    const [user, unit] = await Promise.all([
      this.database.user.findUnique({
        where: { id: userId },
        select: { supplierId: true },
      }),
      this.database.worksheetDepartment.findUnique({
        where: { id: departmentId },
        select: { customerId: true },
      }),
    ]);
    if (!user || !unit) return null;
    const supplier = user.supplierId
      ? await this.database.supplier.findUnique({
          where: { id: user.supplierId },
          select: { customerId: true },
        })
      : null;
    return {
      userSupplierId: user.supplierId,
      supplierMirrorCustomerId: supplier?.customerId ?? null,
      unitCustomerId: unit.customerId,
    };
  }

  /**
   * A FELHASZNALOHOZ VALASZTHATO ALEGYSEGEK.
   *
   * MIERT A SZERVER RAKJA OSSZE, ES NEM A FELULET. A lanc harom lepes:
   * felhasznalo -> szallito -> tukor-vevo sor -> annak alegysegei. A felulet
   * ebbol CSAK az elsot latja (a `UserDetail` a `supplierId` mezot adja), es a
   * masodikhoz nincs utja: a `selectable-partners` valasza `customerId`-t ad,
   * `supplierId`-t nem -- a ketto nem parosithato. Merve, nem feltetelezve.
   *
   * ES HA A FELULET MEGIS OSSZERAKNA, ket forras keletkezne ugyanarra a
   * szabalyra: a `mayAssignUnit` epp ezt a lancot jarja be a MASIK oldalon. Egy
   * kesobbi szigoritas az egyiket javitana, a masikat nem.
   *
   * URES LISTA HAROM KULONBOZO OKBOL JOHET, es mind a harom RENDES allapot:
   * a fiok belsos (nincs szallitoja), a partnernek nincs tukor-vevo sora, vagy
   * a tukor alatt nincs alegyseg. A HIANYZO felhasznalo viszont `null` -- azt
   * a hivo 404-re forditja, mert az elgepelt azonosito nem ugyanaz.
   */
  async selectableUnits(userId: string) {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { supplierId: true },
    });
    if (!user) return null;
    if (user.supplierId === null) return [];

    const supplier = await this.database.supplier.findUnique({
      where: { id: user.supplierId },
      select: { customerId: true },
    });
    if (!supplier?.customerId) return [];

    return this.database.worksheetDepartment.findMany({
      where: { customerId: supplier.customerId, isActive: true },
      orderBy: [{ parentId: "asc" }, { code: "asc" }],
      select: { id: true, name: true, code: true, parentId: true },
    });
  }

  async listAssignments(userId: string) {
    return this.database.userWorksheetDepartment.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        departmentId: true,
        createdAt: true,
        department: { select: { name: true, code: true } },
      },
    });
  }

  /**
   * `createMany` + `skipDuplicates` HELYETT `create`, es ez szandekos: a
   * duplikatum NEM csendes atlepes, hanem hiba. Aki ketszer rendeli hozza
   * ugyanazt, valoszinuleg mast akart -- es egy nema siker elrejtene.
   */
  async addAssignment(userId: string, departmentId: string) {
    return this.database.userWorksheetDepartment.create({
      data: { userId, departmentId },
      select: { departmentId: true },
    });
  }

  async removeAssignment(userId: string, departmentId: string) {
    const result = await this.database.userWorksheetDepartment.deleteMany({
      where: { userId, departmentId },
    });
    return result.count > 0;
  }

  async list(
    scope: "open" | "all",
    visibility: Prisma.ServiceJobWhereInput,
    search?: string,
  ): Promise<{ rows: ServiceJobRow[]; truncated: boolean }> {
    /**
     * A LATHATOSAGI SZURO `AND` AGBAN ALL, nem kulcskent. Ugyanaz az indok, mint
     * a partner-hatokornel: a felso szintu objektum implicit ES, es egy kesobbi
     * azonos kulcsu spread FELULIRNA a jogosultsagit. A `visibility` sajat
     * `OR`-t is hordozhat -- egy szinten a statusz-szurovel az `OR` mindent
     * atengedne, ami az egyik agara illik.
     */
    const where: Prisma.ServiceJobWhereInput = {
      AND: [
        visibility,
        scope === "open" ? { status: { notIn: FINISHED } } : {},
        searchWhere(search),
      ],
    };

    /**
     * EGGYEL TOBBET KERUNK, MINT AMENNYIT ADUNK.
     *
     * Igy a "van-e tobb" kerdesre nem talalgatni kell: ha a hatar+1-edik sor
     * megjott, akkor van tobb. A pontosan hatarnyi talalatot ez
     * megkulonbozteti a levagott listatol -- egy sima `length === LIMIT`
     * osszehasonlitas a ket esetet EGYFORMAN vagottnak mondana.
     */
    const rows = await this.database.serviceJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: LIST_LIMIT + 1,
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

    return {
      rows: rows.slice(0, LIST_LIMIT).map((row) => ({
        id: row.id,
        jobNumber: row.jobNumber,
        title: row.title,
        status: row.status,
        customerName: row.customer?.displayName ?? null,
        createdAt: row.createdAt,
        worksheetCount: row._count.worksheets,
      })),
      truncated: rows.length > LIST_LIMIT,
    };
  }

  /**
   * ALLAPOTONKENTI DARABSZAM, A TELJES LATHATO HALMAZBOL.
   *
   * UGYANAZT a lathatosagi szurot kapja, mint a lista, es SZANDEKOSAN nem kap
   * `scope`-ot: a szamlalok epp azt mondjak meg, mi van a scope-on KIVUL is.
   * Ha a scope ide is beszivarogna, a "lezart ugy" doboz nullat mutatna egy
   * nyitott listan -- ugy, mintha nem lenne lezart jegy.
   *
   * A `groupBy` a HATARTOL FUGGETLEN: a ketszazas vagas a lapozasra vonatkozik,
   * nem a szamolasra.
   */
  async countsByStatus(
    visibility: Prisma.ServiceJobWhereInput,
    search?: string,
  ): Promise<Record<ServiceJobStatus, number>> {
    /**
     * A KERESES BESZAMIT, A SCOPE NEM -- ES A KETTO KULONBSEGE SZANDEKOS.
     *
     * A csempek azt mondjak meg, mi van a SCOPE-on kivul is (ezert latszik a
     * "lezart ugy" szam egy nyitott listan). A KERESES viszont a felhasznalo
     * sajat szukitese: ha az nem szamitana bele, a csempek a keresestol
     * fuggetlen szamot mutatnanak a talalatok folott, es a ketto ellentmondana
     * egymasnak a kepernyon.
     */
    const rows = await this.database.serviceJob.groupBy({
      by: ["status"],
      where: { AND: [visibility, searchWhere(search)] },
      _count: { _all: true },
    });

    /**
     * MINDEN ALLAPOT SZEREPEL, A NULLAS IS. A `groupBy` csak a letezo sorokat
     * adja vissza, tehat egy ma ures allapot KULCS NELKUL erkezne -- a kliensen
     * az `undefined` az osszeadasban csendben eltunne, es a hianyzo kulcs
     * pontosan ugy nezne ki, mint a nulla.
     */
    const counts = Object.fromEntries(
      ALL_SERVICE_JOB_STATUSES.map((status) => [status, 0]),
    ) as Record<ServiceJobStatus, number>;
    for (const row of rows) counts[row.status] = row._count._all;
    return counts;
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
  /**
   * A RESZLETLAP IS SZUR, es ez nem masolas: egy azonositot ki lehet talalni vagy
   * megkapni egy linkbol. Ha csak a lista szurne, a jegy tartalma egy kozvetlen
   * lekeressel elerheto maradna -- es az a fajta szivargas NEMA.
   *
   * `findFirst` es nem `findUnique`: az utobbi csak egyedi kulcsra szur, tehat a
   * hatokort nem lehetne melle tenni.
   */
  /**
   * A JEGYROL TOROLT CSATOLMANYOK, IDORENDBEN.
   *
   * KULON LEKERDEZES, es nem a `detail` `select`-jenek a resze: az `AuditLog`
   * nem all relacioban a jeggyel -- altalanos tabla, `entityType` es `entityId`
   * parossal hivatkozik barmire. Prisma `include` tehat nincs ra, es ez nem
   * hianyossag: epp ettol tud egyetlen tabla minden modell nyomat vinni.
   *
   * A MEGLEVO `@@index([entityType, entityId, createdAt])` szolgalja ki, tehat
   * nem kell uj index sem.
   *
   * A `fileName` a `metadata`-bol jon, es NEM a dokumentum sorabol -- az
   * addigra nincs meg. Ez a masolat a lenyeg, nem keruloút.
   */
  async documentRemovals(serviceJobId: string) {
    return this.database.auditLog.findMany({
      where: {
        entityType: "ServiceJob",
        entityId: serviceJobId,
        action: DOCUMENT_DELETED_ACTION,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        createdAt: true,
        metadata: true,
        user: { select: { displayName: true } },
      },
    });
  }

  async detail(id: string, visibility: Prisma.ServiceJobWhereInput) {
    return this.database.serviceJob.findFirst({
      where: { AND: [{ id }, visibility] },
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
        // AZ AZONOSITO A NEV MELLE: a nev megjelenitesre jo, szuresre nem. A
        // csatolhato lapok listaja a jegy partnerere szukul, es ahhoz a
        // feluletnek az AZONOSITO kell.
        customerId: true,
        customer: { select: { displayName: true } },
        /**
         * A HELYSZIN NEVE A RESZLETLAPRA. A `departmentId` onmagaban tarolas,
         * nem megjelenites: egy azonosito a kepernyon semmit nem mond, es a
         * kliens sem tudna feloldani egy kulon lekerdezes nelkul.
         *
         * A SZULO IS KELL, egy szinttel: a kod es a nev csak TESTVEREK kozott
         * egyedi, tehat "Biodom" onmagaban ket kulonbozo helyet is jelenthet. A
         * TELJES ut itt nem fer el (tetszoleges melyseg, rekurziv lekerdezes
         * lenne), de az egy szint mar megkulonboztet -- es a felvitelen amugy is
         * a teljes utas valaszto all.
         */
        departmentId: true,
        department: {
          select: {
            name: true,
            code: true,
            parent: { select: { name: true } },
          },
        },
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
        // A DELEGALTAK A KIOSZTAS SORRENDJEBEN, a regebbi elol -- forditva,
        // mint a naplo es a lapok. Ez nem elnezes: ott a LEGUJABB esemeny a
        // kerdes, itt viszont egy NEVSOR, aminek a sorrendje ne ugraljon
        // amiatt, hogy kit vettek fel utoljara. A masodik rendezo a `userId`,
        // mert egy tranzakcioban felvitt sorok `assignedAt` erteke azonos.
        assignees: {
          orderBy: [{ assignedAt: "asc" }, { userId: "asc" }],
          select: {
            userId: true,
            assignedAt: true,
            user: { select: { displayName: true, nickname: true } },
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
