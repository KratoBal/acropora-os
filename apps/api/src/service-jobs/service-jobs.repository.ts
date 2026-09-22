import { Injectable } from "@nestjs/common";

import { NOT_HIDDEN } from "../common/hidden-rows.js";
import { assignedUnitIdsFor } from "./assigned-units.query.js";
import { assetsOutsideDepartment } from "../common/assets-in-department.js";
import { isPrismaUniqueConstraintViolation } from "../common/prisma-error.util.js";
import { assignableUserWhere } from "../common/service-assignment.js";
import { DOCUMENT_DELETED_ACTION } from "./service-job-documents.repository.js";
import {
  serviceJobScopeWhere,
  type ServiceJobListScope,
} from "./service-job-list-scope.js";
import { ALL_SERVICE_JOB_STATUSES } from "./service-job-status.js";
import {
  prisma,
  type Prisma,
  type ServiceJobStatus,
  type WorksheetVersionStatus,
  type NotificationRole,
} from "@acropora/database";
import { unitPathFor, unitPathsFor } from "../common/unit-path-lookup.js";

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
  /** A helyszin TELJES utja, a gyokertol lefele. `null`, ha nincs vagy nem epithető. */
  departmentPath: string[] | null;
  createdAt: Date;
  worksheetCount: number;
  /** A rejtes idopontja, vagy `null`. A felulet ebbol csinal jelolot. */
  hiddenAt: Date | null;
}

@Injectable()
export class ServiceJobsRepository {
  private readonly database = prisma;

  /**
   * A JEGY REJTESE VAGY VISSZAALLITASA -- ES A LAPJAIT NEM VISZI MAGAVAL.
   *
   * Egy jegy alatt allhat VALODI munkalap, es a lanc (jegy -> lap ->
   * teljesitesi igazolas -> szamla) ep marad. A rejtes PER SOR megy, mind a ket
   * modellen kulon.
   *
   * A VISSZAVONAS MIND A KET MEZOT NULLAZZA, ugyanugy, mint a munkalapnal: egy
   * mar nem rejtett soron alldogalo regi rejto-nev tenynek latszik.
   */
  async setHidden(
    id: string,
    hiddenAt: Date | null,
    hiddenById: string | null,
  ): Promise<void> {
    await this.database.serviceJob.update({
      where: { id },
      data: { hiddenAt, hiddenById: hiddenAt ? hiddenById : null },
    });
  }

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
  /**
   * HONNAN NYITOTTAK A JEGYET: az eszkoz elhelyezese, egy lekerdezessel.
   *
   * A SZALLITO TULAJDONOSNAL A TUKOR-SORT ADJA VISSZA, nem a szallito
   * azonositojat. A jegy partnere `Customer`, az eszkozé lehet `Supplier` -- es
   * a ketto kozott a `Supplier.customerId` tukor-sor all, amit a rendszer maga
   * tart szinkronban (`syncWorksheetMirror`). Ha a kliens a szallito
   * azonositojat kapna es azt kuldene vissza, egy NEM LETEZO partnerre nyitna
   * jegyet -- es a hiba csak a mentesnel latszana.
   *
   * A TUKOR HIANYOZHAT: csak szerviz-jelolt partnerre keletkezik. A `null` itt
   * nem hiba, hanem valasz: a jegy partner nelkul szuletik, es a felulet ezt ki
   * is mondja.
   */
  async placementOfAsset(assetId: string): Promise<{
    customerId: string | null;
    departmentId: string | null;
  } | null> {
    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
      select: {
        customerId: true,
        departmentId: true,
        supplier: { select: { customerId: true } },
      },
    });
    if (!asset) return null;
    return {
      customerId: asset.customerId ?? asset.supplier?.customerId ?? null,
      departmentId: asset.departmentId,
    };
  }

  async assetsOutsideDepartment(
    assetIds: readonly string[],
    departmentId: string,
  ): Promise<string[]> {
    return assetsOutsideDepartment(assetIds, departmentId);
  }

  /**
   * A MAR LETREJOTT JEGY, A HELYSZINI BEJELENTES KULCSA ALAPJAN.
   *
   * Ugyanazt az alakot adja vissza, mint a `create`, mert a hivo szamara a ket
   * eset UGYANAZ: a bejelentes EGY jegyet jelent, akkor is, ha ketszer erkezett
   * meg.
   */
  async byClientOperationId(clientOperationId: string) {
    return this.database.serviceJob.findUnique({
      where: { clientOperationId },
      select: { id: true, jobNumber: true },
    });
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
    /** A helyszini bejelentes idempotencia-kulcsa; a weben nincs ilyen. */
    clientOperationId?: string | null;
  }) {
    // A KELETKEZÉS IS ESEMÉNY, és a naplóba is bekerül - egy tranzakcióban.
    // Külön írva a kettő szétcsúszhatna: egy jegy, aminek nincs első sora a
    // naplóban, úgy néz ki, mintha a semmiből lépett volna tovább.
    try {
      return await this.insert(input);
    } catch (error) {
      /**
       * A KET PARHUZAMOS KERES ESETE, ES EZ NEM HIBA.
       *
       * A szolgaltatas eloszor RAKERES a kulcsra; a kereses es ez a beszuras
       * kozott viszont eltelik ido. Ha ugyanaz a bejelentes ketszer erkezik
       * egyszerre, a masodik itt hasal el az EGYEDI INDEXEN -- es ilyenkor a
       * hivo ugyanazt a valaszt kapja, mint az elso.
       *
       * A SZURES SZUK: kizarolag a `clientOperationId` utkozese. Egy
       * JEGYSZAM-utkozes VALODI hiba (ket kerés ugyanarra a sorszamra), es
       * hangosan kell elbuknia -- azt ez az ag nem nyeli el.
       */
      if (
        input.clientOperationId &&
        isPrismaUniqueConstraintViolation(error, "clientOperationId")
      ) {
        const meglevo = await this.byClientOperationId(input.clientOperationId);
        if (meglevo) return meglevo;
      }
      throw error;
    }
  }

  private insert(input: {
    jobNumber: string;
    title: string;
    description: string | null;
    customerId: string | null;
    departmentId: string | null;
    assetIds: readonly string[];
    actorUserId: string;
    assigneeIds: readonly string[];
    clientOperationId?: string | null;
  }) {
    return this.database.serviceJob.create({
      data: {
        jobNumber: input.jobNumber,
        clientOperationId: input.clientOperationId ?? null,
        title: input.title,
        description: input.description,
        customerId: input.customerId,
        /**
         * `!` -- ISMERT, NYITOTT KOCKAZAT, NEM GARANCIA. A `department_required`
         * migracio ota a `ServiceJob.departmentId` NOT NULL, DE ezen a
         * hivason NINCS OLYAN VALIDACIO, MINT AZ ASSET-EN
         * (`assetDepartmentPresenceRefusal`), ami kikenyszeritene, hogy
         * `input.departmentId` sose legyen `null`. Kulonosen a "partner
         * nelkuli jegy" eset (a `customerId` a DTO-ban opcionalis) SOHA nem
         * tud helyszint kapni -- ez zart kor, hasonlo az Asset
         * CUSTOMER_OWNER esetehez, de MEG NINCS FELOLDVA (jelentve, 15c9cd7a
         * kartya, 4953-as komment).
         *
         * A `!` ITT KIZAROLAG A TIPUSHIBAT (es vele a konteneres build
         * hibajat) oldja fel -- NEM VALTOZTAT a futasideju viselkedesen:
         * ha `input.departmentId` valoban `null`, ez a hivas MA IS, EZUTAN
         * IS ugyanugy a NOT NULL megkotesbe futna. A `!` nem uj kockazatot
         * vezet be, csak nem allitja meg a forditot ott, ahol a kockazat MAR
         * MEGVAN es MASHOL van dokumentalva.
         */
        departmentId: input.departmentId!,
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
      where: { id: { in: [...ids] }, ...assignableUserWhere() },
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
   * EGYSEGEK TELJES UTJA, KOTEGBEN.
   *
   * Azert kell, mert egy utkozes-uzenet csak akkor hasznalhato, ha MEGMONDJA,
   * hol all ma az eszkoz -- a puszta egyseg-nev ket tavoli ag alatt ugyanaz
   * lehet (ADR-010). Egy kozos hivas, nem eszkozonkent egy.
   */
  async unitPathsOf(
    departmentIds: (string | null | undefined)[],
  ): Promise<Map<string, string[]>> {
    return unitPathsFor(this.database, departmentIds);
  }

  /**
   * A JEGYHEZ KOTOTT MUNKALAPOK, A HELYSZIN ATVEZETESEHEZ.
   *
   * MIERT KELL A `number`, ES MIERT AZ A HATAR: a munkalap-szamot a lezaras
   * osztja ki, es az ELSO TAGJA A HELYSZIN KODJA (`buildWorksheetNumber`; a
   * sema jegyzete szerint "csak lezart lapnal"). Egy MAR SZAMOZOTT lapot tehat
   * nem mozgathatunk: a szama olyan helyszint nevezne meg, ahol a lap mar nem
   * all -- es a szam a lap azonossaga, kinyomtatva es atadva.
   *
   * A hatar ezert ADAT (van-e szam), nem ALLAPOT-nev. Az elso valtozat a
   * SIGNED verziora szurt volna; az az AWAITING_SIGNATURE es a REJECTED lapokat
   * mozgatta volna, holott azok mar szamozottak (merve 2026-09-16).
   *
   * AZ ESZKOZ SAJAT HELYSZINE IS JON: enelkul a hivo eszkozonkent kerdezne
   * vissza, hogy MEGNEVEZHESSE, hol all ma az, ami az uj reszfan kivul esne.
   */
  async worksheetsForPlacement(serviceJobId: string): Promise<
    {
      id: string;
      number: string | null;
      subject: string | null;
      departmentId: string;
      assets: {
        assetId: string;
        assetNumber: string;
        assetName: string;
        assetDepartmentId: string | null;
      }[];
    }[]
  > {
    const rows = await this.database.worksheet.findMany({
      /**
       * A REJTETT LAP A JEGY ALATT SEM JELENIK MEG, ES ITT NINCS KAPCSOLO.
       *
       * Ez lista, csak egy reszletlapon belul -- es pont az a hely, ahol a
       * probalapok a legjobban zavarnak. A lap SAJAT reszletlapja tovabbra is
       * elerheto azonositoval; az egyedi lekeresre a rejtes nem szol.
       *
       * AMIT EZ JELENT, KIMONDVA: egy rejtett lapot a jegy alatt nem lehet
       * visszahozni kapcsoloval. Elo kell venni a munkalap-listabol, a
       * "Rejtettek is" jelolovel -- ott van az egyetlen hely, ahol a rejtes
       * visszavonhato, es ez szandekos: EGY hely, ahol a visszavonas tortenik.
       */
      where: { ...NOT_HIDDEN, serviceJobId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        number: true,
        departmentId: true,
        // A LAP NEVE A LEGFRISSEBB VERZIOJAROL JON, ugyanugy, ahogy a jegy
        // reszletlapjan: a nev a verzion lakik, nem a lapon.
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: { subject: true },
        },
        assets: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            assetId: true,
            asset: {
              select: {
                assetNumber: true,
                name: true,
                departmentId: true,
              },
            },
          },
        },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      subject: row.versions[0]?.subject ?? null,
      departmentId: row.departmentId,
      assets: row.assets.map((link) => ({
        assetId: link.assetId,
        assetNumber: link.asset.assetNumber,
        assetName: link.asset.name,
        assetDepartmentId: link.asset.departmentId,
      })),
    }));
  }

  /**
   * A JEGY HELYSZINE ES AZ OTT ALLO ESZKOZOK, EGY TRANZAKCIOBAN.
   *
   * === MIERT EGY TRANZAKCIO, ES NEM KET IRAS ===
   *
   * A ketto kozott a jegy egy OLYAN allapotban allna, amit a felvitel sosem
   * enged meg: uj helyszin a regi eszkozokkel (vagy forditva). Ha a masodik
   * iras elhasal (halozat, egyedi kulcs, leallas), az az allapot ITT MARAD --
   * es semmi nem hibas rajta ranezesre, tehat senki nem keresne.
   *
   * === A MAR FENT LEVO SOROKHOZ NEM NYULUNK (`skipDuplicates`) ===
   *
   * Ugyanaz az indok, mint a delegalasnal: a `createdAt` az egyetlen jel arrol,
   * mikor KERULT a jegyre egy eszkoz, es azt a felulet ki is irja
   * (`attachedAt`). Ha minden mentes ujrairna az osszes sort, minden
   * helyszin-modositas "ma csatoltnak" mutatna egy honapja rajta allo eszkozt.
   *
   * === A BEKULDOTT LISTA A TELJES HALMAZ ===
   *
   * Aki nincs rajta, lekerul. Ures listat kuldeni SZABAD -- az kimondott
   * szandek (a `notIn` ilyenkor elmarad, tehat MINDET leveszi).
   *
   * A HIANYZO JEGY `false`-t ad, nem kivetelt: a hivo dolga eldonteni, mit mond
   * rola -- es a szolgaltatas ugyanazt a 404-et adja, mint a tobbi uton.
   */
  /**
   * VAN-E A JEGYEN MUNKALAP -- A PARTNER-HATARHOZ.
   *
   * REJTETT LAPOT IS SZAMOL, ES EZ SZANDEKOS. A fajl tobb helyen szur a
   * `NOT_HIDDEN` feltetellel (a jegy alatti LISTA is), de az MAS kerdesre
   * valaszol: hogy mit MUTATUNK. A hatar a lap LETEZESEROL szol -- egy rejtett
   * lap is lap, es ha nem szamolna, a partner egy olyan jegy leirasat irhatna
   * at, amin mar all munka.
   *
   * ES AZERT NEM A RESZLETLAPBOL JON: a `ServiceJobDetail` NEM visel
   * `worksheets` mezot (merve 2026-09-22: a lapjai a `timeline`-ba olvadnak),
   * tehat egy onnan vett darabszam nem is letezik.
   */
  /**
   * KINEL VAN BEJELOLVE EGY ERTESITESI SZEREP.
   *
   * EGY HELYEN ALL, ES A HIVO ADJA TOVABB. Ugyanez a halmaz kell a PUSH-hoz es
   * a LEVELHEZ is; ket kulon lekerdezes kozott a halmaz meg is valtozhatna, es
   * akkor a push egy embernek menne ki, a level egy masiknak -- ugyanarrol a
   * jegyrol.
   *
   * CSAK AKTIV FELHASZNALO. Egy kilepett kollega sora megmaradhat (a szerep
   * beallitas, nem esemeny), de kuldes nem mehet neki -- ugyanaz a szabaly,
   * amit a nyito-ertesites is alkalmaz (`opener.isActive`).
   *
   * A RENDEZES DETERMINALT: azonos nev mellett az azonosito dont. A kuldesnek
   * mindegy, a meresnek nem -- enelkul ugyanaz a hivas ket sorrendet adhatna.
   */
  async notificationRoleRecipients(role: NotificationRole): Promise<
    {
      id: string;
      email: string;
      displayName: string;
    }[]
  > {
    const sorok = await this.database.userNotificationRole.findMany({
      where: { role, user: { isActive: true } },
      select: {
        user: { select: { id: true, email: true, displayName: true } },
      },
      orderBy: [{ user: { displayName: "asc" } }, { userId: "asc" }],
    });
    return sorok.map((sor) => sor.user);
  }

  /** Az ugyfel rovidítése a jegyrol -- a push cimehez es a levelhez. */
  async partnerCodeOf(serviceJobId: string): Promise<string | null> {
    const sor = await this.database.serviceJob.findUnique({
      where: { id: serviceJobId },
      select: { customer: { select: { worksheetPartnerCode: true } } },
    });
    return sor?.customer?.worksheetPartnerCode ?? null;
  }

  async hasWorksheet(serviceJobId: string): Promise<boolean> {
    const darab = await this.database.worksheet.count({
      where: { serviceJobId },
    });
    return darab > 0;
  }

  /**
   * A JEGY MEZOINEK IRASA, A NAPLOSORRAL EGY TRANZAKCIOBAN.
   *
   * A HATART NEM ITT DONTJUK EL: azt a `descriptionEditBlocker` mondja meg, a
   * szolgaltatasban. Ez a metodus AZT irja, amit kapott -- egy masodik
   * hatar-ellenorzes itt csak azt jelentene, hogy a szabaly ket helyen all.
   */
  async updateFields(input: {
    serviceJobId: string;
    /**
     * CSAK AZ ERKEZETT MEZOK IRODNAK. A `title` es a `description` kulon
     * elhagyhato: a hianyuk azt jelenti, hogy NE NYULJ hozzajuk. A
     * `description` `null` erteke viszont ERVENYES -- az az urites.
     */
    fields: { title?: string; description?: string | null };
    /** A naplosor szovegehez: MI valtozott. A hivo allitja ossze. */
    note: string;
    actorUserId: string | null;
  }): Promise<boolean> {
    return this.database.$transaction(async (transaction) => {
      const frissitett = await transaction.serviceJob.updateMany({
        where: { id: input.serviceJobId },
        data: input.fields,
      });
      if (frissitett.count !== 1) return false;

      await transaction.serviceJobEvent.create({
        data: {
          serviceJobId: input.serviceJobId,
          kind: "FIELDS_EDITED",
          note: input.note,
          actorUserId: input.actorUserId,
        },
      });
      return true;
    });
  }

  async setPlacement(input: {
    serviceJobId: string;
    departmentId: string;
    assetIds: readonly string[];
    /**
     * A JEGYHEZ KOTOTT, MOZGATHATO LAPOK -- azok, amiknek MEG NINCS SZAMUK.
     *
     * A hivo valogatja ki oket (`worksheetsForPlacement`), es nem ez a metodus:
     * a hatar indoka ott all leirva, es egy masodik peldany ITT pontosan ott
     * csuszna el, ahol senki nem nezi. Ures lista ervenyes: a jegynek nem kell
     * lapja.
     */
    worksheetIds: readonly string[];
    /** A naplosorhoz. Nullazhato: a naplo aktora `SetNull` a torlesnel. */
    actorUserId: string | null;
  }): Promise<boolean> {
    return this.database.$transaction(async (transaction) => {
      const job = await transaction.serviceJob.findUnique({
        where: { id: input.serviceJobId },
        select: { id: true },
      });
      if (!job) return false;

      await transaction.serviceJob.update({
        where: { id: input.serviceJobId },
        data: { departmentId: input.departmentId },
      });

      /**
       * A NAPLO EDDIG HALLGATOTT EROL, ES EZ RES VOLT.
       *
       * Merve 2026-09-22: a helyszin-atvezetes NULLA naplosort irt, pozitiv
       * kontrollal (a `move` ag ugyanebben a fajlban ir esemenyt). Egy jegy
       * helyszine es eszkozei tehat csendben atirhatoak voltak, es a lap azt
       * allitotta, hogy mindig ez volt.
       *
       * UGYANABBAN A KORBEN KERULT BE, MINT A MEZO-SZERKESZTES naplosora, es
       * ez nem kenyelem: egy naplo, ami a KISEBB valtozast rogziti es a
       * NAGYOBBAT nem, rosszabb a naplo hianyanal -- teljesseget sugall.
       *
       * A `kind` KIIRVA ALL. Az alapertelmezese `STATUS_CHANGE`, tehat egy
       * kihagyott mezo nem hianykent jelenne meg, hanem ALLAPOTVALTASKENT --
       * es azt a `ServiceJobEvent_status_change_has_to_status` megkotes is
       * elutasitana, mert `toStatus` nelkul allna.
       */
      await transaction.serviceJobEvent.create({
        data: {
          serviceJobId: input.serviceJobId,
          kind: "FIELDS_EDITED",
          note: "A helyszín és az érintett eszközök módosultak.",
          actorUserId: input.actorUserId,
        },
      });

      await transaction.serviceJobAsset.deleteMany({
        where: {
          serviceJobId: input.serviceJobId,
          ...(input.assetIds.length > 0
            ? { assetId: { notIn: [...input.assetIds] } }
            : {}),
        },
      });

      if (input.assetIds.length > 0) {
        await transaction.serviceJobAsset.createMany({
          data: input.assetIds.map((assetId) => ({
            serviceJobId: input.serviceJobId,
            assetId,
          })),
          skipDuplicates: true,
        });
      }

      /**
       * ES A HELYSZIN ATMEGY A MOZGATHATO LAPOKRA IS, UGYANEBBEN A
       * TRANZAKCIOBAN.
       *
       * Balazs merese, 2026-09-16: "a hibajegynel meg tudtam valtoztatni a
       * helyszint. de a mar hozzakotott munkalapnal nem valtozott meg".
       *
       * KET IRAS, ES A MASODIK NEM ELHAGYHATO: a lap `departmentId` mezoje
       * MELLETT a PISZKOZAT-VERZIO `unitName` mezoje is atall. Az a nev a
       * verzio KIIRASAKOR fagy be (lasd `versionContentData` jegyzetet), tehat
       * egyedul a mezot atirva a lap UJ helyszinen allna, REGI helyszin-nevvel
       * a lapjan -- es ez a mezo a verzio-elteresben is szerepel ("Egyseg"),
       * vagyis a kovetkezo verzio ugy mutatna valtozast, hogy senki nem irt at
       * semmit.
       *
       * CSAK A DRAFT VERZIOKAT irjuk at. Egy szam nelkuli lapnak ma csak ilyen
       * verzioja lehet (a szamot a lezaras osztja), de a szures ITT all, nem a
       * hivo bizalmaban.
       */
      if (input.worksheetIds.length > 0) {
        const egyseg = await transaction.worksheetDepartment.findUnique({
          where: { id: input.departmentId },
          select: { name: true },
        });
        await transaction.worksheet.updateMany({
          where: { id: { in: [...input.worksheetIds] } },
          data: { departmentId: input.departmentId },
        });
        if (egyseg) {
          await transaction.worksheetVersion.updateMany({
            where: {
              worksheetId: { in: [...input.worksheetIds] },
              status: "DRAFT",
            },
            data: { unitName: egyseg.name },
          });
        }
      }

      return true;
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
    return assignedUnitIdsFor(userId);
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
        // A VEVO-KOTES IS KELL: a mai partner-fiokok tobbsege vevohoz kotott,
        // es az orzo azon az agon dont.
        select: { supplierId: true, customerId: true },
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
      userCustomerId: user.customerId,
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
      select: { supplierId: true, customerId: true },
    });
    if (!user) return null;

    /**
     * A VEVOHOZ KOTOTT FIOK A SAJAT VEVOJE ALEGYSEGEIT VALASZTHATJA -- EGY
     * LEPESBEN, TUKOR NELKUL.
     *
     * MIERT KELL KULON AG: a mai partner-fiokok TOBBSEGE ilyen. A
     * `PARTNER_SERVICE` szerepkor kikotese a `customerId` mezore all, tehat az
     * ujonnan felvett partner-fiokok `supplierId` mezoje NULL -- es a lenti
     * szallitos lancnak EZ az elso feltetele. A valaszto ezert SOHA nem kinalt
     * semmit egy partner-fioknak, akarhany aktiv alegyseg allt a vevo alatt.
     * (Merve 2026-09-17, eles akadaskent: a kepernyo azt irta, hogy "Ehhez a
     * fiokhoz nincs valaszthato alegyseg", miközben a fiok neve mellett ott
     * allt a partner.)
     *
     * A TUKOR-VEVO IT NEM KELL, es ez nem rovidites: a szallitos ag azert jar
     * be harom lepest, mert ott a felhasznalo egy SZALLITOHOZ kotodik, es az
     * alegysegek egy VEVO alatt allnak -- a tukor-sor koti ossze a kettot. Itt
     * a felhasznalo MAR a vevohoz kotodik, tehat nincs mit athidalni.
     *
     * A KET KOTES KIZARJA EGYMAST (`User_at_most_one_partner_check`), tehat ez
     * az ag nem vesz el semmit a szallitostol.
     */
    if (user.customerId !== null) return this.activeUnitsOf(user.customerId);

    if (user.supplierId === null) return [];

    const supplier = await this.database.supplier.findUnique({
      where: { id: user.supplierId },
      select: { customerId: true },
    });
    if (!supplier?.customerId) return [];

    return this.activeUnitsOf(supplier.customerId);
  }

  /**
   * EGY VEVO AKTIV ALEGYSEGEI, EGY HELYEN.
   *
   * KET AG hasznalja (a vevohoz kotott es a szallitohoz kotott fiok), es a
   * KERDES ugyanaz: mi all ez alatt a vevo alatt. Ket masolat eloszor egyezne,
   * aztan az egyikbe bekerulne egy szures, a masikba nem -- es a ket
   * partner-fajta CSENDBEN mast latna.
   */
  private activeUnitsOf(customerId: string) {
    return this.database.worksheetDepartment.findMany({
      where: { customerId, isActive: true },
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
    scope: ServiceJobListScope,
    visibility: Prisma.ServiceJobWhereInput,
    search: string | undefined,
    /**
     * A NEZO AZONOSITOJA, ES KOTELEZO ARGUMENTUM, NEM ELHAGYHATO.
     *
     * A `mine` hatokor ezen all. Ha elhagyhato lenne, egy hivo, aki elfelejti
     * atadni, NEM hibat kapna, hanem egy CSENDBEN URES listat -- ami pontosan
     * ugy nez ki, mint "nincs rad kiosztva semmi".
     */
    viewerUserId: string,
  ): Promise<{ rows: ServiceJobRow[]; truncated: boolean }> {
    /**
     * A LATHATOSAGI SZURO `AND` AGBAN ALL, nem kulcskent. Ugyanaz az indok, mint
     * a partner-hatokornel: a felso szintu objektum implicit ES, es egy kesobbi
     * azonos kulcsu spread FELULIRNA a jogosultsagit. A `visibility` sajat
     * `OR`-t is hordozhat -- egy szinten a statusz-szurovel az `OR` mindent
     * atengedne, ami az egyik agara illik.
     *
     * ES A HATOKOR UGYANIGY TOVABBI `AND` TAG, nem egy masik `OR` ag: a
     * "ram kiosztva" SZUKIT a lathatoon belul, nem nyit meg semmit, amit a
     * nezo amugy nem lathatna.
     */
    const where: Prisma.ServiceJobWhereInput = {
      AND: [
        visibility,
        serviceJobScopeWhere(scope, viewerUserId),
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
        hiddenAt: true,
        customer: { select: { displayName: true } },
        // A HELYSZIN AZONOSITOJA A LISTARA IS. A nevet nem kerjuk el: a listan
        // a TELJES ut all majd, azt pedig egy kotegelt lekerdezes epiti fel,
        // nem ez a `select`.
        departmentId: true,
        // A DARABSZÁM A LISTÁN LÁTSZIK, mert a jegy értéke abból derül ki,
        // hány munka áll mögötte. Egy külön lekérdezés soronként N+1 lenne.
        _count: { select: { worksheets: true } },
      },
    });

    const lap = rows.slice(0, LIST_LIMIT);
    /**
     * A TELJES UTAK EGY KOTEGBEN. Ket lekerdezes, fuggetlenul attol, hany sor
     * jott: a `unitPathFor` soronkent ketto lenne, ami ezen a listan
     * negyszazat is jelenthet.
     */
    const utak = await unitPathsFor(
      this.database,
      lap.map((row) => row.departmentId),
    );

    return {
      rows: lap.map((row) => ({
        id: row.id,
        jobNumber: row.jobNumber,
        title: row.title,
        status: row.status,
        customerName: row.customer?.displayName ?? null,
        departmentPath: row.departmentId
          ? (utak.get(row.departmentId) ?? null)
          : null,
        createdAt: row.createdAt,
        worksheetCount: row._count.worksheets,
        hiddenAt: row.hiddenAt,
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

  /**
   * A JEGY ADATLAPJA, ES VELE A HELYSZIN TELJES UTJA.
   *
   * AZ UT KULON LEKERDEZESBOL JON, nem az `select` melyitesevel: a helyszin-fa
   * melysege NEM korlatos, tehat egy `parent: { parent: { ... } }` lanc mindig
   * csak addig latna, ameddig valaki megirta -- es a hianyzo szint CSENDBEN
   * maradna ki, ugyanugy helyesnek latszo eredmennyel.
   *
   * ES ITT, A TAROLOBAN, nem a szolgaltatasban: a szolgaltatasok hamis
   * tarolokkal futnak az egyseg-tesztekben, tehat egy ottani adatbazis-hivas
   * kivezetne oket a fedes alol. (Merve: huszonhat teszt bukott el, amikor
   * eloszb odatettem.)
   */
  async detail(id: string, visibility: Prisma.ServiceJobWhereInput) {
    const sor = await this.detailRow(id, visibility);
    if (!sor) return sor;
    return {
      ...sor,
      departmentPath: await unitPathFor(this.database, sor.departmentId),
    };
  }

  private async detailRow(id: string, visibility: Prisma.ServiceJobWhereInput) {
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
        hiddenAt: true,
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
            // A LAP NEVE A LEGFRISSEBB VERZIOJAROL JON, ugyanugy, ahogy a
            // csatolo valaszto is veszi (`attachableWorksheets`). A nev a
            // verzion lakik, nem a lapon: egy javitott targy uj verziot ir, es
            // a jegy alatt a MAI nevnek kell allnia, nem az elsonek.
            versions: {
              orderBy: { version: "desc" },
              take: 1,
              select: { subject: true },
            },
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
   * A JEGY MUNKALAPJAI, ANNYI ALLAPOTTAL, AMENNYI A LEZARASI KAPUHOZ KELL.
   *
   * A REJTETT LAPOT SZANDEKOSAN NEM SZURI KI, es ezert nem hasznalja a
   * `NOT_HIDDEN` feltetelt, amit a `worksheetsForPlacement` igen. A ketto ket
   * kulonbozo kerdesre valaszol: ott MEGJELENITES a tet (a probalapok
   * zavarnak), itt DONTES. Ha a rejtes itt is szurne, egy aláiratlan lap
   * elrejtesevel csendben lezarhato lenne a jegy -- a rejtes nezet-kapcsolobol
   * jogosultsagi eszkozze valna.
   *
   * A `hidden` MEZOT EZERT ADJA VISSZA: a hivo mondata ki tudja mondani, hogy
   * a lap rejtett. A jegy alatti lista nem mutatja, tehat a kezelo hiaba
   * keresi ott -- enelkul a hibauzenet helyes lenne es hasznalhatatlan.
   *
   * A VERZIOBOL EGY KELL, A LEGMAGASABB: a "jelenlegi verzio" ugyanaz a fogalom,
   * mint a modul tobbi lekerdezeseben (`orderBy: { version: "desc" }, take: 1`).
   */
  async worksheetSignatureStates(serviceJobId: string): Promise<
    {
      id: string;
      number: string | null;
      hiddenAt: Date | null;
      handedOverAt: Date | null;
      versions: { status: WorksheetVersionStatus }[];
    }[]
  > {
    return this.database.worksheet.findMany({
      where: { serviceJobId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        number: true,
        hiddenAt: true,
        handedOverAt: true,
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: { status: true },
        },
      },
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
