import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import type { Prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { partnerScopeOf } from "../auth/partner-scope.util.js";
import { TicketMailService } from "../notifications/mail/ticket-mail.service.js";
import { hiddenRowsWhere } from "../common/hidden-rows.js";
import { serviceJobVisibilityWhere } from "./service-job-visibility.js";
import { ertesitendoDelegaltak } from "./ertesitendo-delegaltak.js";
import { mayWriteServiceJob } from "./service-job-write-scope.js";
import {
  DESCRIPTION_EDIT_BLOCKER_MESSAGES,
  descriptionEditBlocker,
} from "./description-edit-boundary.js";
import { mayAssignUnit } from "./visibility-assignment.js";

import {
  hasPermission,
  PERMISSIONS,
  personDisplayName,
  serviceJobTimeline,
  type ServiceJobDetail,
  type ServiceJobListResponse,
  partnerServiceJobDetail,
  type ServiceJobPartnerDetail,
} from "@acropora/types";

import type {
  CreateServiceJobDto,
  MoveServiceJobDto,
  ServiceJobListQueryDto,
  SetServiceJobAssigneesDto,
  SetServiceJobPlacementDto,
  UpdateServiceJobFieldsDto,
} from "./dto.js";
import { normalizeAssetIds } from "../common/assets-in-department.js";
import { normalizeAssigneeIds } from "../common/service-assignment.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import {
  nextServiceJobNumber,
  serviceJobNumberPrefix,
} from "./service-job-number.js";
import {
  partnerStatusLabel,
  partnerVisibleStatus,
} from "./service-job-status.js";
import { mayWorksheetJoinTicket } from "../common/worksheet-under-ticket.js";
import {
  worksheetsBlockingTicketClose,
  type TicketCloseBlockReason,
} from "../common/worksheet-signature-gate.js";
import {
  allowedServiceJobSteps,
  isServiceJobStepAllowed,
} from "./service-job-transitions.js";
import { ServiceJobsRepository } from "./service-jobs.repository.js";

@Injectable()
export class ServiceJobsService {
  constructor(
    private readonly repository: ServiceJobsRepository,
    /**
     * AZ ERTESITO ELHAGYHATO, ugyanazzal az indokkal, mint a munkalapnal: a
     * modul hat meglevo specje allitja elo ezt a szolgaltatast, es egyik sem
     * kuld ertesitest. Kotelezove teve mind a hatot at kellene irni, holott
     * egyikuk targya sem ez.
     *
     * AMI VISZONT NEM MARADT KIMONDATLAN: egy elhagyhato fuggoseg NEMA. Ha a
     * modul elfelejtene bekotni, a delegalas lefutna, ertesites nelkul, es
     * semmi nem szolna rola. Ezert all ra kulon allitas
     * (`service-job-assignees.spec.ts`, "a modul bekoti az ertesitot"), ami a
     * modul metaadatat olvassa -- nem azt, hogy a mezo letezik.
     */
    @Optional() private readonly notifications?: NotificationsService,
    /**
     * A LEVELEZO UGYANUGY ELHAGYHATO, mint az ertesito, es ugyanabbol az okbol:
     * a felvitel nem bukhat el attol, hogy a levelezes nincs bekotve.
     *
     * ES UGYANUGY NEMA, ha a modul elfelejti: ezert all ra kulon allitas, ami a
     * modul metaadatat olvassa, nem azt, hogy a mezo letezik.
     */
    @Optional() private readonly ticketMail?: TicketMailService,
  ) {}

  private readonly logger = new Logger(ServiceJobsService.name);

  /**
   * A DELEGALTAK MAR ITT KIOSZTHATOK, es ez nem kenyelmi rovidites.
   *
   * Az iroda nyitja a jegyet a szervizesnek: a delegalas abban a pillanatban
   * ismert, amikor a jegy megszuletik. Kulon lepesre bizva a felvivo azt hiszi,
   * kiadta a munkat, kozben a jegy senki listajan nem jelenik meg -- es errol
   * semmi nem szol, mert a delegalatlan jegy nem hibas allapot.
   *
   * A KOLLEGAK ELLENORZESE A LETREHOZAS ELOTT FUT: egy ismeretlen azonosito igy
   * NEM hoz letre semmit, ahelyett hogy egy mar megszuletett jegyet hagyna
   * delegalatlanul. Ugyanaz a sorrend, mint a munkalapnal.
   */
  async create(
    input: CreateServiceJobDto,
    actor: AuthenticatedUser | string,
    now: Date = new Date(),
  ) {
    const actorUserId = typeof actor === "string" ? actor : actor.id;
    const partnerScope =
      typeof actor === "string"
        ? { kind: "internal" as const }
        : partnerScopeOf(actor);
    /**
     * A HELYSZINI BEJELENTES KULCSA A LEGELSO KERDES, MINDEN MAS ELOTT.
     *
     * A telefon terero nelkul sorba teszi a jegyet, es a sor a halozati hibat
     * SZANDEKOSAN ujraprobalja -- offline az a normalis allapot. Epp ott lehet
     * viszont, hogy ez a metodus MAR lefutott, es csak a valasz veszett el.
     * Kulcs nelkul az ujrakuldes MASODIK jegyet nyitna ugyanarrol a hibarol.
     *
     * ES MIERT ITT, NEM A TARBAN (az eszkoznel ott all): harom dolog tortenne
     * meg fololegesen, es a HARMADIK nem is artalmatlan.
     *   - a delegaltak ujra-ellenorzese: egy felesleges kor,
     *   - egy JEGYSZAM elhasznalasa: a sorszam a kereses utan tovabb lep,
     *   - ES UJABB ERTESITES a delegaltaknak ugyanarrol a jegyrol. Az mar a
     *     kollega telefonjan csorren meg masodszor, ugyanarra a munkara.
     *
     * A KERESES NEM ONMAGABAN A VEDELEM: ket parhuzamos keres a kereses es a
     * beszuras kozott elcsuszhat. Azt az esetet az EGYEDI INDEX vagja el, es a
     * tar `create` metodusa forditja vissza ugyanarra a valaszra.
     */
    const kulcs = input.clientOperationId?.trim() || null;
    if (kulcs) {
      const meglevo = await this.repository.byClientOperationId(kulcs);
      if (meglevo) return meglevo;
    }

    const assigneeIds = normalizeAssigneeIds(input.assigneeIds ?? []);
    await this.requireAssignableUsers(assigneeIds);

    const year = now.getFullYear();
    const last = await this.repository.lastNumberOfYear(
      serviceJobNumberPrefix(year),
    );
    /**
     * AMIT A TELEFON NEM TUD MEGADNI, AZT AZ ESZKOZBOL VEZETJUK LE.
     *
     * A helyszinen a szerelo EGY eszkoz elott all, es abbol a partner es a
     * helyszin mar kovetkezik. A megadott ertek viszont ELSOBBSEGET elvez: ez
     * a mezo POTOL, nem felulir.
     */
    const honnan = input.originAssetId?.trim() || null;
    const eredet = honnan
      ? await this.repository.placementOfAsset(honnan)
      : null;
    if (honnan && !eredet) {
      if (partnerScope.kind === "customer") {
        throw new BadRequestException(
          "Hibajegyet csak a saját cégéhez lehet nyitni.",
        );
      }
      throw new BadRequestException(
        "A megadott eszköz nem található, ezért nem tudom, hova tartozik a jegy.",
      );
    }
    let customerId = input.customerId?.trim() || eredet?.customerId || null;
    if (partnerScope.kind === "customer") {
      if (customerId !== null && customerId !== partnerScope.customerId)
        throw new BadRequestException(
          "Hibajegyet csak a saját cégéhez lehet nyitni.",
        );
      customerId = partnerScope.customerId;
    }
    if (partnerScope.kind === "supplier")
      throw new NotFoundException("A hibajegy nem található.");

    /**
     * AZ EREDET-ESZKOZ ES A JEGY PARTNERE NEM MONDHAT ELLENT EGYMASNAK.
     *
     * BALAZS DONTESE, 2026-09-21 10:48:51 UTC (Discord, fo csatorna,
     * message_id 1551545743054082049), szo szerint: "utasitsa el. johet a
     * kovetkezo". A kerdes az volt, mi tortenjen, ha valaki MASIK partner
     * gepet ad meg egy hibajegy eredetekent.
     *
     * === EZ EGY KORABBI, SZANDEKOS VISELKEDEST IR AT ===
     *
     * A fenti "POTOL, nem felulir" elv VALTOZATLANUL all, es nem is szabad
     * elvenni: a helyszinen a szerelo tenyleg nem tud partnert megadni, es
     * akkor az eszkozbol kell levezetni. Amit ez a kapu elutasit, az nem a
     * POTLAS, hanem a ket ertek ELLENTMONDASA. Harom eset van, es csak a
     * harmadik hibas:
     *
     *   csak eszkoz               az eszkozbol jon a partner       -- marad
     *   csak partner              nincs mit osszevetni             -- marad
     *   mind a ketto, ES ELTER    ELUTASITAS
     *
     * === A NEGYEDIK ESET, AMI NEM ELLENTMONDAS: A GAZDATLAN ESZKOZ ===
     *
     * Ha az eszkoznek NINCS tulajdonosa (`eredet.customerId === null`), akkor
     * nincs ket ertek, amit ossze lehetne vetni -- egy HIANYT tolt ki a
     * megadott partner, es pontosan erre valo a potlas. Ezt a sort tehat
     * atengedjuk, es ez a legkozelebbi teveszes: egy `!=` osszevetes null
     * mellett elutasitana, es epp a POTLAST venne el.
     *
     * === MIERT ELUTASITAS, ES NEM CSENDES FIGYELMEN KIVUL HAGYAS ===
     *
     * Ez nem tamadas, hanem ELGEPELES: egy belsos kollega a teljes listabol
     * valaszt, a jegy partnere kozben mas ceg. Az elutasitas AZONNAL latszik
     * es javithato; ha az eszkozt csendben hagynank el, a jegy letrejonne, es
     * senki nem tudna meg, hogy hianyzik rola a gep.
     *
     * === A HELYE: A VEGLEGES ERTEKEN MER, DE MA NEM TEHERHORDO ===
     *
     * Ez a kapu a `partnerScope` KENYSZERITESE UTAN all, tehat a VEGLEGES
     * `customerId`-t veti ossze. Elsore azt irtam ide, hogy enelkul egy
     * partner-fiok idegen gepet vihetne fel -- A KALIBRACIO EZT MEGCAFOLTA:
     * a kaput a kenyszerites FOLE mozgatva NULLA allitas pirosodott.
     *
     * AZ OK: a fenti ag mar elutasit minden olyan kerest, ahol a megadott
     * `customerId` eltér a kero sajat cegetol. Mire ide erunk, a ket ertek
     * (a kenyszerites elotti es utani) MINDIG egyezik -- tehat a ket elhelyezes
     * ma EGYENERTEKU.
     *
     * AKKOR MIERT ITT: mert a VEGLEGES erteken mer. Ha a kenyszerites logikaja
     * valaha valtozik (peldaul megengedobb lesz), egy feljebb allo kapu
     * CSENDBEN a regi erteket vetne ossze. Ez elovigyazatossag, nem mert
     * vedelem, es igy is kell olvasni.
     */
    if (
      eredet &&
      eredet.customerId !== null &&
      customerId !== null &&
      eredet.customerId !== customerId
    ) {
      throw new BadRequestException(
        "A megadott eszköz másik partnerhez tartozik, mint a hibajegy partnere. Vagy a partnert javítsd, vagy az eszközt.",
      );
    }
    const departmentId =
      input.departmentId?.trim() || eredet?.departmentId || null;
    /**
     * A HELYSZIN A MEGADOTT PARTNERE LEGYEN, ES EZ A SZERVEREN DOL EL.
     *
     * A felulet ma csak a kivalasztott partner egysegeit kinalja, tehat
     * "normalis uton" ez nem allhat elo. De a felulet nem hataroz meg
     * korlatot: a vegpontra barmi beirhato, es egy IDEGEN egyseghez kotott
     * jegy a kepernyon URESNEK latszana, nem hibasnak -- a lista a sajat
     * partner egysegeit rajzolja, es az idegen id egyszeruen nem lenne
     * kozottuk. Nema keveredes, ami kesobb a lathatosagot is elviszi.
     *
     * A PARTNER NELKULI HELYSZIN KULON AG: nem "ismeretlen egyseg", hanem
     * ertelmetlen keres. Megnevezve, mert a ket hiba mas javitast ker.
     */
    if (departmentId) {
      if (!customerId) {
        throw new BadRequestException(
          "Helyszínt csak partnerrel együtt lehet megadni.",
        );
      }
      const belongs = await this.repository.departmentBelongsToCustomer(
        departmentId,
        customerId,
      );
      if (!belongs) {
        throw new BadRequestException(
          "A megadott helyszín nem ehhez a partnerhez tartozik.",
        );
      }
      /**
       * ES A KERO SAJAT HELYSZINEI IS SZAMITANAK (Balazs dontese, 2026-09-22:
       * "idegen helyszinre nem is tud jegyet nyitni").
       *
       * A FENTI ELLENORZES CSAK AZ UGYFELET NEZTE, es enelkul a dontes FELE
       * valosulna meg: a valaszto mar nem ajanlja fel az idegen helyszint, de
       * egy kozvetlen hivas atmenne rajta.
       *
       * ES AMIERT EZ NEM CSAK ELMELETI: elesben MAR LETEZIK egy ilyen jegy
       * (merve 2026-09-22) -- egy partner-fiok olyan helyszinre nyitotta, ami
       * nincs nala. A kovetkezmenye nem a nyitas, hanem az, amit UTANA lat: a
       * jegyet igen (a nyito-tengelyen), a munkalapjait viszont nem, mert ott
       * nincs nyito-tengely. "Az en jegyem, es nem latom, mit csinaltak rajta."
       *
       * A SZUKITES CSAK A VEVO-HATOKORRE SZOL. A belsos felhasznalok NULLA
       * hozzarendelessel dolgoznak (elesben mind a hat ilyen), tehat rajuk
       * alkalmazva a sajat szerelonk EGYETLEN helyszinre sem nyithatna jegyet.
       *
       * A HIBAUZENET MEGNEVEZI AZ OKOT, es ez tudatos: a kero a sajat
       * ugyfelenek a partnere, es a helyszin-lista amugy is csak a sajatjait
       * adja -- egy "nem ehhez a partnerhez tartozik" alaku valasz itt nem
       * vedene tobbet, csak felrevezetne.
       */
      if (partnerScope.kind === "customer") {
        /**
         * A TAROLON AT, NEM A MODUL-SZINTU LEKERDEZESSEL -- ES EZ NEM STILUS.
         * Az `assignedUnitIdsFor` a `prisma` peldanyt kozvetlenul hasznalja,
         * tehat egy duplaval dolgozo spec nem tudna megkerulni: a meres
         * adatbazishoz kotodne. A tarolo metodusa ugyanazt hivja, de VARRAT --
         * ezen a hatokor-szabaly egyseg-teszttel merheto.
         */
        const sajatHelyszinek =
          await this.repository.assignedUnitIds(actorUserId);
        if (!sajatHelyszinek.includes(departmentId)) {
          throw new BadRequestException(
            "Erre a helyszínre nem nyithatsz hibajegyet: nincs hozzád rendelve.",
          );
        }
      }
    }
    /**
     * AZ ESZKOZOK A VALASZTOTT HELYSZINEN ALLJANAK, A RESZFAT IS BELEERTVE.
     *
     * A HELYSZIN NELKULI ESZKOZ-LISTA SAJAT AG, sajat uzenettel: nem
     * "ismeretlen eszkoz", hanem hianyzo helyszin. A ket hiba mas teendot ker
     * attol, aki belefut.
     *
     * A DUPLA AZONOSITO NEM HIBA, csak zaj: a kapcsolotablan `@@unique`
     * ([serviceJobId, assetId]) all, tehat ket azonos sor amugy is elhasalna --
     * itt egyszeruen kiszurjuk, mielott a tarolohoz erne.
     */
    const valasztott = normalizeAssetIds(input.assetIds);
    if (valasztott.length > 0) {
      if (!departmentId) {
        throw new BadRequestException(
          "Eszközt csak helyszínnel együtt lehet megadni.",
        );
      }
      await this.requireAssetsOnDepartment(valasztott, departmentId);
    }
    /**
     * AZ EREDET-ESZKOZ AKKOR IS FELKERUL, HA NINCS HELYSZINE -- ES EZ ELTER A
     * VALASZTOTT ESZKOZOK SZABALYATOL, SZANDEKOSAN.
     *
     * A "csak helyszinnel egyutt" szabaly oka az, hogy a VALASZTHATO halmaz
     * maga a helyszin eszkozeibol all: helyszin nelkul a felhasznalo nem tudna
     * mibol valasztani. Az eredet-eszkoznel nincs halmaz -- a szerelo MEGNEVEZI
     * azt az egyet, ami elott all.
     *
     * ES A HELYSZIN NELKULI ESZKOZ NEM ELMELETI: az `Asset.departmentId`
     * opcionalis. Ha ilyenkor elutasitanank, a szerelo epp arrol a gepről nem
     * tudna jegyet nyitni, aminek meg nincs rogzitve a helye -- vagy nyitna
     * egyet, ami CSENDBEN nem emliti az eszkozt. A masodik a rosszabb.
     */
    const assetIds = honnan
      ? [...new Set([...valasztott, honnan])]
      : valasztott;
    const kind = input.kind ?? "REPAIR";
    const contractId = input.contractId?.trim() || null;
    if (contractId) {
      if (kind !== "MAINTENANCE")
        throw new BadRequestException(
          "Szerződés csak karbantartási laphoz kapcsolható.",
        );
      if (!customerId)
        throw new BadRequestException(
          "Szerződéshez partner megadása kötelező.",
        );
      if (
        !(await this.repository.contractBelongsToCustomer(
          contractId,
          customerId,
        ))
      )
        throw new BadRequestException(
          "A megadott szerződés nem ehhez a partnerhez tartozik.",
        );
    }
    const title = input.title.trim();
    const created = await this.repository.create({
      jobNumber: nextServiceJobNumber({ year, lastNumber: last }),
      title,
      description: input.description?.trim() || null,
      customerId,
      departmentId,
      assetIds,
      actorUserId,
      assigneeIds,
      kind,
      contractId,
      clientOperationId: kulcs,
    });

    /*
      ERTESITES CSAK AZUTAN, hogy a jegy tarolva van. Felvitelkor minden
      delegalt uj, tehat a lista maga a kulonbseg.

      A FELTETEL A SZURT LISTARA ALL, NEM A NYERSRE, es ez nem stilus: ha
      valaki EGYEDUL sajat magat teszi a jegyre, a szures utan URES lista
      marad. A nyers hosszra kotott feltetel mellett egy ures nevsorral hivnank
      az ertesitot -- egy kuldes, aminek nincs cimzettje.
    */
    const ertesitendok = ertesitendoDelegaltak({
      jeloltek: assigneeIds,
      cselekvo: actorUserId,
    });
    if (ertesitendok.length > 0)
      this.notifications?.notifyServiceJobAssignment({
        serviceJobId: created.id,
        subject: title,
        userIds: ertesitendok,
      });

    /**
     * UGYFEL NYITOTTA A JEGYET -> ERTESITES A FELELOS-SZEREP BIRTOKOSAINAK.
     *
     * Balazs kerese, 2026-09-22 (ertesitesi folyamat, 1. pont).
     *
     * A FELTETEL A HATOKOR, NEM A DELEGALT-LISTA. A partner-urlap ma egyaltalan
     * nem kuld delegaltat (merve: `createTicket` a partner kliensben negy mezot
     * kuld, `assigneeIds` nincs kozte), tehat a fenti ag ilyenkor URES -- de a
     * feltetel akkor sem a lista hossza lenne: egy belsos kollega is nyithat
     * jegyet delegalt nelkul, es arrol NEM szol ez az ertesites.
     *
     * A KET KULDES EGY HALMAZT KAP. A cimzetteket EGYSZER kerdezzuk le, es
     * ugyanazt adjuk a push-nak es a levelnek -- ket kulon lekerdezes kozott a
     * halmaz megvaltozhatna, es a ketto mas embernek menne ki ugyanarrol a
     * jegyrol.
     */
    if (partnerScope.kind === "customer")
      await this.ertesitsUgyfelBejelentesrol(created.id, title, actorUserId);

    return created;
  }

  /**
   * A KET ERTESITES EGY HELYEN, es SOHA nem buktathatja el a felvitelt.
   *
   * A jegy MAR TAROLVA van, amikor ez fut. Egy ertesitesi hiba (nincs token,
   * nem megy a levelezo) nem teheti meg nem tortentte a bejelentest -- a
   * bejelento ilyenkor ujra bekuldene, es ket jegy lenne ugyanarrol.
   */
  private async ertesitsUgyfelBejelentesrol(
    serviceJobId: string,
    subject: string,
    actorUserId: string | null,
  ): Promise<void> {
    try {
      const cimzettek =
        await this.repository.notificationRoleRecipients("SERVICE_JOB_OPENED");
      if (cimzettek.length === 0) return;

      const partnerCode = await this.repository.partnerCodeOf(serviceJobId);

      this.notifications?.notifyServiceJobOpened({
        serviceJobId,
        subject,
        partnerCode,
        userIds: cimzettek.map((cimzett) => cimzett.id),
      });

      await this.ticketMail?.deliverServiceJobOpened({
        serviceJobId,
        actorUserId,
        recipients: cimzettek,
      });
    } catch (cause) {
      this.logger.warn(
        `Az ügyfél-bejelentés értesítése nem sikerült (${serviceJobId}): ${
          cause instanceof Error ? cause.message : "ismeretlen hiba"
        }`,
      );
    }
  }

  /**
   * A JEGY DELEGALTJAINAK BEALLITASA, A FELVITEL UTAN.
   *
   * KET UT KELL, es nem az egyik a masik rovidítese: a felvitelkor az iroda mar
   * tudja, kinek adja, kesobb viszont ATSZERVEZ -- valaki szabadsagra megy,
   * valaki besegit. Egy jegy elete alatt a nevsor tobbszor valtozik, es az
   * ujranyitas nem valasz ra.
   *
   * A BEKULDOTT LISTA A TELJES NEVSOR: aki nincs rajta, lekerul. Ures listat
   * kuldeni szabad -- az kimondott szandek, nem elgepeles (a mezo maga
   * kotelezo, epp ezert).
   *
   * ERTESITEST CSAK AZ UJAK KAPNAK. Aki mar a jegyen allt, annak a telefonja
   * hallgat: egy masodik kollega hozzaadasa nem hir annak, aki mar dolgozik
   * rajta.
   */
  async setAssignees(
    id: string,
    input: SetServiceJobAssigneesDto,
    user: AuthenticatedUser,
  ): Promise<ServiceJobDetail> {
    this.requireWriteScope(user);
    const userIds = normalizeAssigneeIds(input.userIds);
    await this.requireAssignableUsers(userIds);

    const updated = await this.repository.setAssignees({
      serviceJobId: id,
      userIds,
      actorUserId: user.id,
    });
    if (!updated.ok) throw new NotFoundException("A hibajegy nem található.");

    const detail = await this.internalDetail(id, user);

    /*
      A MASIK HIVOHELY, ES A BEMENET MAST JELENT: itt CSAK a hozzaadottak
      allnak a listan, nem a teljes nevsor. A szures szabalya ugyanaz, a
      jelentese nem -- ezert all mind a kettore KULON allitas.
    */
    const ujErtesitendok = ertesitendoDelegaltak({
      jeloltek: updated.added,
      cselekvo: user.id,
    });
    if (ujErtesitendok.length > 0)
      this.notifications?.notifyServiceJobAssignment({
        serviceJobId: id,
        subject: detail.title,
        userIds: ujErtesitendok,
      });

    return detail;
  }

  /**
   * KIT LEHET DELEGALNI. A hibauzenet EGY mondat a ket okra (nincs ilyen
   * kollega / a szerepkore nem engedi), es ez szandekos: a kettot
   * szetvalasztva a valasz elarulna, letezik-e egy adott azonosito.
   */
  private async requireAssignableUsers(userIds: readonly string[]) {
    if (userIds.length === 0) return;
    const assignable = await this.repository.assignableUserIds(userIds);
    const rejected = userIds.filter((userId) => !assignable.has(userId));
    if (rejected.length > 0) {
      throw new BadRequestException(
        "A delegált kolléga nem található, vagy a szerepköre nem engedi a szerviz-munka kezelését.",
      );
    }
  }

  /**
   * AZ ESZKOZOK A MEGADOTT HELYSZIN RESZFAJAN ALLJANAK.
   *
   * KOZOS METODUS, mert KET ut kerdezi ugyanezt: a felvitel es a
   * `setPlacement`. Ket kulon leirt valtozat addig egyezne, amig valaki az
   * egyiket javitja -- es a kulonbseg NEMA lenne: az egyik uton bejutna a
   * jegyre egy idegen helyszinen allo eszkoz.
   *
   * A HIBAUZENET A DARABSZAMOT MONDJA, NEM AZ AZONOSITOKAT: egy azonosito-lista
   * a kepernyon semmit nem jelent annak, aki olvassa, es kozben elarulna, hany
   * eszkoz letezik egyaltalan.
   */
  private async requireAssetsOnDepartment(
    assetIds: readonly string[],
    departmentId: string,
  ): Promise<void> {
    const missing = await this.repository.assetsOutsideDepartment(
      assetIds,
      departmentId,
    );
    if (missing.length > 0) {
      throw new BadRequestException(
        `Ez a ${missing.length} eszköz nem a megadott helyszínen áll.`,
      );
    }
  }

  /**
   * MELYIK KOTOTT LAPON MELYIK ESZKOZ ESNE AZ UJ HELYSZINEN KIVULRE.
   *
   * A VALASZ MONDATOK LISTAJA, NEM DARABSZAM. Egy "nehany eszkoz kivul esne"
   * mondat ugyanannyit er, mint a csend: a felhasznalo nem tud donteni belole.
   * Ezert all mindegyikben, hogy MELYIK LAP, MELYIK ESZKOZ, es HOL ALL MA.
   *
   * A lap megnevezese a SZAMA, ha van -- de itt definicio szerint nincs (csak
   * szam nelkuli lapot mozgatunk), tehat a TARGYA all ott. Ha az sincs, a
   * szoveg akkor is megmondja, hany lapról van szo, nem hallgat el egy sort.
   */
  private async worksheetAssetsOutsideSite(
    sheets: {
      id: string;
      number: string | null;
      subject: string | null;
      assets: {
        assetId: string;
        assetNumber: string;
        assetName: string;
        assetDepartmentId: string | null;
      }[];
    }[],
    departmentId: string,
  ): Promise<string[]> {
    const mind = [
      ...new Set(
        sheets.flatMap((sheet) => sheet.assets.map((eszkoz) => eszkoz.assetId)),
      ),
    ];
    if (mind.length === 0) return [];

    const kivul = new Set(
      await this.repository.assetsOutsideDepartment(mind, departmentId),
    );
    if (kivul.size === 0) return [];

    // AZ UTAK KOTEGBEN JONNEK, nem eszkozonkent: egy hivas, akarhany sor.
    const utak = await this.repository.unitPathsOf(
      sheets.flatMap((sheet) =>
        sheet.assets.map((eszkoz) => eszkoz.assetDepartmentId),
      ),
    );

    const mondatok: string[] = [];
    for (const sheet of sheets) {
      const lap = sheet.number ?? sheet.subject ?? "Névtelen munkalap";
      for (const eszkoz of sheet.assets) {
        if (!kivul.has(eszkoz.assetId)) continue;
        const ut = eszkoz.assetDepartmentId
          ? utak.get(eszkoz.assetDepartmentId)
          : null;
        /**
         * A HELY HIANYA SAJAT MONDATOT KAP. A "nincs megadva" nem ugyanaz,
         * mint egy ismert, de masik egyseg -- es a ket esetben a felhasznalo
         * teendoje is mas.
         */
        const hol = ut?.length
          ? `a(z) ${ut.join(" / ")} egységen áll`
          : "helyszín nélkül áll";
        mondatok.push(
          `${lap}: ${eszkoz.assetName} (${eszkoz.assetNumber}) ${hol}, ami az új helyszínen kívül esik. A lapon marad.`,
        );
      }
    }
    return mondatok;
  }

  /**
   * A JEGY HELYSZINE ES AZ OTT ALLO ESZKOZOK, A FELVITEL UTAN.
   *
   * Balazs kerese, 2026-09-16: a meglevo jegyhez is lehessen eszkozt adni, es a
   * helyszint is lehessen modositani.
   *
   * EGY MUVELET A KETTORE, es az indok a DTO jegyzeteben all. Ami itt szamit: a
   * bekuldott eszkoz-lista a TELJES halmaz, es az uj helyszinre kell
   * ervenyesnek lennie. Helyszin-valtaskor tehat a felulet MEGNEVEZI, melyik
   * eszkoz esne le, es amit a felhasznalo jovahagy, az utazik a keresben --
   * a szerver soha nem szed le olyat, amit o nem latott.
   *
   * A PARTNER-ELLENORZES UGYANAZ, MINT A FELVITELEN: a helyszin a jegy
   * partnerehez tartozzon. Enelkul egy elgepelt vagy atmasolt azonosito MAS
   * partner egysegere akasztana ra a jegyet, es a felulet ezt soha nem mutatna
   * meg -- a lista a sajat partnere egysegeit rajzolja, tehat egy idegen egyseg
   * ott egyszeruen URESKENT jelenne meg.
   *
   * A PARTNER NELKULI JEGY SAJAT AGAT KAP: nem "ismeretlen egyseg", hanem
   * ertelmetlen keres, es a teendo is mas (elobb partnert kell allitani).
   */
  /**
   * A JEGY MEZOINEK SZERKESZTESE (ma: a leiras).
   *
   * === NINCS `requireWriteScope`, ES EZ A LEGFONTOSABB SOR ITT ===
   *
   * A kezenfekvo valasztas az lenne: ott all az ot szomszed iro ut elso
   * soraban. Csak epp BINARIS -- belsos vagy sem --, itt viszont a hatokor nem
   * KIZAR, hanem MEGVALASZTJA a hatart. Ha itt allna, a partner 404-et kapna,
   * MIELOTT a hatar-fuggveny szohoz jutna, es csendben kiesne pont az, amit
   * Balazs kert.
   *
   * ELLENORZES EGY MONDATBAN: ha egy partner hivo 404-et kap egy munkalap
   * nelkuli, NYITOTT jegyen, az orzo rossz helyen all -- akkor is, ha a belsos
   * ag zold.
   *
   * A LATHATOSAGOT VISZONT AZ `internalDetail` ELINTEZI: a nem lathato jegy
   * ugyanazt a 404-et adja, mint a nem letezo, es ez a meglevo viselkedes.
   */
  async updateFields(
    id: string,
    input: UpdateServiceJobFieldsDto,
    user: AuthenticatedUser,
  ): Promise<ServiceJobDetail | ServiceJobPartnerDetail> {
    const jegy = await this.internalDetail(id, user);

    /**
     * A MUNKALAP-JELENLET KULON LEKERDEZES, ES A TELJES HALMAZT SZAMOLJA.
     * Nem a reszletlapbol jon: a `ServiceJobDetail` NEM visel `worksheets`
     * mezot (a lapjai a `timeline`-ba olvadnak). A szamlalo a REJTETT lapokat
     * is beleveszi -- egy rejtett lap is LAP, es a hatar a letezeserol szol,
     * nem a lathatosagarol.
     */
    const akadaly = descriptionEditBlocker(partnerScopeOf(user), {
      status: jegy.status,
      hasWorksheet: await this.repository.hasWorksheet(id),
    });
    if (akadaly !== null) {
      const mondat = DESCRIPTION_EDIT_BLOCKER_MESSAGES[akadaly];
      /**
       * KET KULON HIBAKOD, MERT KET KULON DOLGOT MOND.
       *
       * A ket ALLAPOT-hatar (lezart jegy, mar van lapja) 409: a keres helyes,
       * csak a jegy mai allapota nem engedi -- holnap vagy egy masik jegyen
       * ugyanez a keres atmegy. A HATOKOR viszont 403: azon nem valtoztat sem
       * ido, sem allapot.
       */
      throw akadaly === "OUT_OF_SCOPE"
        ? new ForbiddenException(mondat)
        : new ConflictException(mondat);
    }

    /**
     * A HIANYZO MEZO ES A `null` MAST JELENT: az elso azt, hogy NE NYULJ
     * hozza, a masodik azt, hogy URITSD KI. Ha semmi nem jott, nem irunk -- es
     * naplosort sem: egy "modosult" bejegyzes valtozas nelkul hazugsag lenne.
     */
    const mezok: { title?: string; description?: string | null } = {};
    const valtozott: string[] = [];

    if (input.title !== undefined) {
      const cim = input.title.trim();
      /**
       * A `@MinLength(1)` A NYERS ERTEKET NEZI, tehat a csupa szokozt
       * ATENGEDI -- es a `title` a semaban `String`, nem `String?`. Egy
       * szokozokre irt cim ures cimet tarolna, es a jegy a listaban nevtelenul
       * allna. A DTO-t ez nem tudja megfogni: a trim UTANI allapotrol szol.
       */
      if (cim.length === 0)
        throw new BadRequestException(
          "A hibajegy címét nem lehet üresen hagyni.",
        );
      mezok.title = cim;
      valtozott.push("címe");
    }

    if (input.description !== undefined) {
      mezok.description =
        input.description === null ? null : input.description.trim() || null;
      valtozott.push("leírása");
    }

    if (valtozott.length === 0) return this.detail(id, user);

    const ok = await this.repository.updateFields({
      serviceJobId: id,
      fields: mezok,
      /**
       * A NAPLOSOR MEGNEVEZI, MI VALTOZOTT. Egy allando "modosult" mondat
       * ugyanazt mondana egy cim-javitasra es egy leiras-uritesre -- a naplo
       * pont attol hasznalhato, hogy a kettot meg lehet kulonboztetni.
       */
      note: `A hibajegy ${valtozott.join(" és ")} módosult.`,
      actorUserId: user.id,
    });
    if (!ok) throw new NotFoundException("A hibajegy nem található.");

    return this.detail(id, user);
  }

  async setPlacement(
    id: string,
    input: SetServiceJobPlacementDto,
    user: AuthenticatedUser,
  ): Promise<ServiceJobDetail> {
    this.requireWriteScope(user);
    const job = await this.repository.jobAttachState(id);
    if (!job) throw new NotFoundException("A hibajegy nem található.");
    if (!job.customerId)
      throw new BadRequestException(
        "Helyszínt csak partnerrel együtt lehet megadni.",
      );

    const departmentId = input.departmentId.trim();
    const belongs = await this.repository.departmentBelongsToCustomer(
      departmentId,
      job.customerId,
    );
    if (!belongs)
      throw new BadRequestException(
        "A megadott helyszín nem ehhez a partnerhez tartozik.",
      );

    const assetIds = normalizeAssetIds(input.assetIds);
    if (assetIds.length > 0)
      await this.requireAssetsOnDepartment(assetIds, departmentId);

    /**
     * A HELYSZIN A KOTOTT LAPOKRA IS ATMEGY -- DE CSAK ARRA, AMINEK NINCS SZAMA.
     *
     * Balazs merese, 2026-09-16: "a hibajegynel meg tudtam valtoztatni a
     * helyszint. de a mar hozzakotott munkalapnal nem valtozott meg".
     *
     * A HATAR A SZAM, NEM AZ ALLAPOT-NEV: a munkalap-szamot a lezaras osztja
     * ki, es az elso tagja a HELYSZIN KODJA. Egy mar szamozott lap mozgatasa
     * olyan szamot hagyna hatra, ami mas helyszint nevez meg, mint ahol a lap
     * all -- es a szam a lap azonossaga, kinyomtatva es atadva.
     */
    const sheets = await this.repository.worksheetsForPlacement(id);
    const movable = sheets.filter((sheet) => sheet.number === null);

    /**
     * ES HA EGY MOZGATOTT LAPON OLYAN ESZKOZ ALL, AMI AZ UJ REszfan KIVUL ESIK,
     * A MUVELET MEGALL, ES MEGNEVEZI.
     *
     * Acrobot dontese (2026-09-16) a harom alak kozul: az eszkozok a lapon
     * MARADNAK, de a valtas nem mehet at csendben. Az a) (maradnak, szo nelkul)
     * csendben sertene azt a szabalyt, amit a lap felvitele kikenyszerit; a b)
     * (lekerulnek) csendben vinne el a szerelo munkajat. A megallas az egyetlen,
     * ahol a dontes ott szuletik, ahol EMBER all.
     *
     * ES CSAK AKKOR ALL MEG, HA VAN MIROL DONTENI. Egy megerosito kerdes, ami
     * minden mentesnel feljon, ket het alatt reflexbol elkattintott ablakka
     * valik -- es akkor a valodi utkozest sem olvassa el senki.
     */
    if (!input.acceptWorksheetAssetsOutsideSite) {
      const utkozesek = await this.worksheetAssetsOutsideSite(
        movable,
        departmentId,
      );
      if (utkozesek.length > 0) throw new ConflictException(utkozesek);
    }

    const ok = await this.repository.setPlacement({
      serviceJobId: id,
      departmentId,
      assetIds,
      worksheetIds: movable.map((sheet) => sheet.id),
      actorUserId: user.id,
    });
    if (!ok) throw new NotFoundException("A hibajegy nem található.");

    return this.internalDetail(id, user);
  }

  /**
   * A LISTA MINDKÉT ÁLLAPOTOT VISZI: a belsőt és a partnernek látszót.
   *
   * Nem redundancia. A belső szerint dolgozunk (egy alkatrészre váró jegyet
   * máshogy kezelünk, mint egy ütemezettet), a látszó pedig az, amit a partner
   * felé bármikor kimondhatunk. Ha csak az egyiket adnánk vissza, a hívó
   * kezdené el képezni a másikat - és a leképezés attól a pillanattól két
   * helyen állna.
   *
   * A VISSZATÉRÉSI TÍPUS KI VAN ÍRVA, és ez nem díszítés: a felület ugyanezt a
   * típust importálja a közös csomagból. Kiírás nélkül a szerver alakja
   * elmozdulhatna (egy átnevezett mező mindkét oldalon lefordul), és a
   * képernyőn `undefined` jelenne meg, hibaüzenet nélkül.
   */
  /**
   * A LATHATOSAG A LEKERDEZESBEN DOL EL, NEM A VALASZ SZUKITESEVEL.
   *
   * Ket lepes, es a sorrend szamit: eloszor a hozzarendelt egysegek (reszfaval),
   * aztan a szuro. Belsos hivonal a masodik lepes ures objektumot ad, tehat az
   * elso lekerdezest sem inditjuk el feleslegesen.
   */
  /**
   * AZ IRAS KAPUJA, ES AZ IRAS ELOTT.
   *
   * MINDEN IRASI UT ELSO SORA, es szandekosan EGY helyen: ha az ot ut
   * kulon-kulon dontene, negy helyes es egy tagabb valtozat is eloallhatna --
   * es epp ez tortent 2026-09-14-ig, csak akkor mind az ot volt tagabb.
   *
   * A HELYE A LENYEG, NEM A MEGLETE. A `setAssignees` eddig is adott 404-et egy
   * partner-hatokoru hivonak, csak KESON: a valasz osszeallitasakor, amikor az
   * iras a tranzakcioban MAR megtortent. Egy hatokor-ellenorzes a valasz
   * oldalan nem hatokor-ellenorzes, hanem elfedes.
   */
  private requireWriteScope(user: AuthenticatedUser): void {
    if (!mayWriteServiceJob(partnerScopeOf(user)))
      throw new NotFoundException("A hibajegy nem található.");
  }

  /**
   * MEGALL, HA A JEGY ALATT ALAIRATLAN MUNKALAP ALL.
   *
   * A MONDAT MEGNEVEZI A LAPOT, es ez nem kenyelem: egy jegy alatt tobb lap is
   * allhat, es a „nem zarhato le" onmagaban keresesre kuldi a kezelot.
   *
   * ES KIMONDJA, HA A LAP REJTETT. A jegy alatti lista szandekosan nem mutatja
   * a rejtett lapokat (`worksheetsForPlacement`), tehat a kezelo ott hiaba
   * keresi. Enelkul a hibauzenet IGAZ lenne es hasznalhatatlan -- pontosan az
   * a fajta hamis diagnozis, ami orakra rossz iranyba visz.
   *
   * A KIUTAT IS MEGMONDJA, mert ketto van, es a helyes valasztas a lapon mulik:
   * ha a munka megtortent, ala kell iratni; ha a lap nem ide tartozik, le kell
   * valasztani a jegyrol.
   */
  private async requireClosableWorksheets(
    serviceJobId: string,
    to: "COMPLETED" | "CANCELLED",
  ): Promise<void> {
    const rows = await this.repository.worksheetSignatureStates(serviceJobId);
    const blocking = worksheetsBlockingTicketClose({
      worksheets: rows.map((row) => ({
        id: row.id,
        number: row.number,
        currentVersionStatus: row.versions[0]?.status ?? null,
        hidden: row.hiddenAt !== null,
        handedOver: row.handedOverAt !== null,
      })),
      to,
    });
    if (blocking.length === 0) return;

    const nev = (sheet: { number: string | null; hidden: boolean }): string => {
      const alap = sheet.number ?? "szám nélküli munkalap";
      return sheet.hidden ? `${alap} (rejtett)` : alap;
    };
    const nevekAhol = (ok: TicketCloseBlockReason): string =>
      blocking
        .filter((tetel) => tetel.reasons.includes(ok))
        .map((tetel) => nev(tetel.sheet))
        .join(", ");

    /**
     * MIND A KET FELTETEL EGY MONDATBAN MEGY KI.
     *
     * Ha csak az elso dobo feltetelt mondanank el, a kezelo megjavitana,
     * visszajonne, es a MASODIKON allna meg: ugyanaz az ut ketszer, es a
     * masodik megallas ugyanolyan indokolatlannak latszana, mint az elso.
     * Az ara vallalt: a mondat hosszabb, es emlithet olyan feltetelt, ami azt
     * a kezelot epp nem erinti.
     */
    const reszek: string[] = [];
    const alairatlan = nevekAhol("unsigned");
    if (alairatlan)
      reszek.push(
        `Nincs aláírva: ${alairatlan}. Írasd alá a lapot, vagy ha nem ide tartozik, vedd le a hibajegyről.`,
      );
    const jeloletlen = nevekAhol("not-handed-over");
    if (jeloletlen)
      reszek.push(
        `Az átadás nincs rögzítve: ${jeloletlen}. Jelöld meg a lapon, hogy az átadás megtörtént, vagy vedd le a hibajegyről.`,
      );
    if (blocking.some((tetel) => tetel.sheet.hidden))
      reszek.push(
        "A rejtett lap a hibajegy alatt nem látszik: a munkalap-listán, a „Rejtettek is” jelölővel találod meg.",
      );

    const nyito =
      to === "COMPLETED"
        ? "Ez a hibajegy nem zárható le."
        : "Ez a hibajegy nem állítható elállt állapotba.";
    throw new BadRequestException([nyito, ...reszek].join(" "));
  }

  private async visibilityFor(
    user: AuthenticatedUser,
  ): Promise<Prisma.ServiceJobWhereInput> {
    const scope = partnerScopeOf(user);
    if (scope.kind === "internal") return {};
    return serviceJobVisibilityWhere({
      scope,
      userId: user.id,
      unitIds: await this.repository.assignedUnitIds(user.id),
    });
  }

  /**
   * A LATHATOSAGI HOZZARENDELES BEALLITASA -- MINDIG A MI OLDALUNKROL.
   *
   * Balazs megkotese (2026-08-26 22:10, szo szerint acrobot atadasaban): "mindig
   * mi allitjuk". A partner sajat vezetoje SOHA nem allithat, es ezert nincs
   * partner-oldali valtozata ennek a hivasnak: a jogkort
   * (`service.visibility.assign`) egyetlen partner-szerep sem kapja meg.
   *
   * A HIBAUZENETEK KULONBOZNEK, ES EZ NEM KOZLEKENYSEG: a harom eset TEENDOJE
   * mas. Tukor nelkul a partnert kell szerviznek jelolni; masik partner
   * alegysegenel masik egyseget kell valasztani; sajat kollegan pedig nincs mit
   * szukiteni. Egy osszevont "nem lehet" mindharomnal rossz iranyba kuldene.
   */
  async assignUnit(userId: string, departmentId: string) {
    const context = await this.repository.assignmentContext(
      userId,
      departmentId,
    );
    if (context === null)
      throw new NotFoundException(
        "A felhasználó vagy az alegység nem található.",
      );

    const check = mayAssignUnit(context);
    if (!check.ok) {
      throw new BadRequestException(
        check.reason === "not-partner-user"
          ? "Ez a fiók nem partner-oldali: belső hatókörrel amúgy is mindent lát."
          : check.reason === "no-mirror"
            ? "A partnernek nincs tükör-vevő sora, ezért alegysége sincs. Előbb szerviz partnernek kell jelölni."
            : /**
               * A VEVOS AGNAK SAJAT MONDATA VAN, es ez nem stilus: a
               * `tukor-vevo` szo egy vevohoz kotott fioknal ertelmetlen, a
               * "masik partnerhez tartozik" pedig rossz helyre kuld -- ott nem
               * partnert kell valtani, hanem a SAJAT vevo alegysegei kozul
               * valasztani.
               */
              check.reason === "other-customer"
              ? "Ez az alegység másik vevőhöz tartozik. Ehhez a fiókhoz csak a saját vevője alegységei rendelhetők."
              : "Ez az alegység másik partnerhez tartozik.",
      );
    }
    return this.repository.addAssignment(userId, departmentId);
  }

  async unassignUnit(userId: string, departmentId: string) {
    const removed = await this.repository.removeAssignment(
      userId,
      departmentId,
    );
    if (!removed)
      throw new NotFoundException("Ez a hozzárendelés nem található.");
    return { removed: true };
  }

  /**
   * A VALASZTHATO ALEGYSEGEK. A HIANYZO FELHASZNALO NEM URES LISTA.
   *
   * Egy ures tomb azt mondana, hogy a fiok letezik es nincs mit valasztani --
   * egy elgepelt azonositora pedig a felulet ures legordulot mutatna, hiba
   * nelkul, es a kezelo azt hinne, a partnernek nincs alegysege.
   */
  async selectableUnits(userId: string) {
    const units = await this.repository.selectableUnits(userId);
    if (units === null)
      throw new NotFoundException("A felhasználó nem található.");
    return { items: units };
  }

  listAssignments(userId: string) {
    return this.repository.listAssignments(userId);
  }

  async list(
    query: ServiceJobListQueryDto,
    user: AuthenticatedUser,
  ): Promise<ServiceJobListResponse> {
    /**
     * EGY LATHATOSAGI SZURO, KET LEKERDEZES.
     *
     * A szamlalok UGYANAZT a szurot kapjak, mint a lista -- kulonben egy
     * partner a HAZ osszesitojet latna a sajatja helyett, es a szam nem is
     * nezne ki hibasnak. Ezert all egy valtozoban: ket kulon hivas ket kulon
     * helyen elobb-utobb elcsuszna.
     */
    /**
     * A REJTES A LATHATOSAGI FELTETEL RESZE, ES EZ NEM KENYELMI DONTES.
     *
     * A lista es a szamlalo KET kulon hivas, es ugyanazt a `visibility` agat
     * kapja. Ha a rejtes kulon argumentum lenne, EGYIKBOL kimaradhatna: a
     * lista ures maradna, a csempeken allo szam mellette nem nulla. Igy
     * viszont szerkezetileg nem tud szetcsuszni.
     *
     * A KAPCSOLOT A HATOKOR ERTELMEZI, nem a hivo (`hiddenRowsWhere`): a
     * partner portaljan a rejtett jegy soha nem ertelmezett, akarmit kuld.
     */
    const visibility: Prisma.ServiceJobWhereInput = {
      AND: [
        await this.visibilityFor(user),
        hiddenRowsWhere(
          partnerScopeOf(user),
          query.includeHidden,
          hasPermission(user, PERMISSIONS.SERVICE_HIDE),
        ),
      ],
    };
    const kind = query.kind ?? "REPAIR";
    const [{ rows, truncated }, counts] = await Promise.all([
      this.repository.list(
        query.scope ?? "open",
        visibility,
        query.search,
        kind,
        user.id,
      ),
      this.repository.countsByStatus(visibility, query.search, kind),
    ]);
    return {
      counts,
      truncated,
      items: rows.map((row) => ({
        id: row.id,
        jobNumber: row.jobNumber,
        title: row.title,
        kind: row.kind,
        status: row.status,
        partnerStatus: partnerVisibleStatus(row.status),
        partnerStatusLabel: partnerStatusLabel(row.status),
        customerName: row.customerName,
        departmentPath: row.departmentPath,
        worksheetCount: row.worksheetCount,
        createdAt: row.createdAt.toISOString(),
        hidden: row.hiddenAt !== null,
      })),
    };
  }

  /**
   * A RÉSZLETLAP: A JEGY, ÉS AMI TÖRTÉNT VELE.
   *
   * HÁROM KÜLÖN LISTÁT AD VISSZA, nem egy összefésült sort. Ez a ház mintája
   * (a munkalap részletlapja is így teszi), az összefésülés viszont NEM a
   * kliensé: a `serviceJobTimeline` a közös csomagban áll, mert a web és a
   * mobil külön fésülve két helyen tartaná ugyanazt a sorrend-szabályt.
   *
   * AZ IDŐPONTOK A NAPLÓBÓL JÖNNEK. A jegyen ott van `startedAt` és
   * `completedAt` is, de azokat ma semmi nem írja, és ha ez a metódus írná
   * őket, két írónk lenne egy tényre. Az elcsúszásuk néma hiba volna.
   */
  /**
   * A BELSO ALAK, KULON METODUSBAN -- ES CSAK IRASRA JOGOSULT HIVONAK.
   *
   * A `setAssignees`, a `setPlacement` es a `move` valasza 2026-09-17 ota a
   * TELJES reszletlap, es mind a harom `requireWriteScope`-pal kezdodik. Az
   * pedig `mayWriteServiceJob` = `scope.kind === "internal"` -- vagyis partner
   * ezekre az utakra EL SEM JUT (sajat specje van:
   * `service-jobs.write-scope.spec.ts`).
   *
   * EZERT NEM VETIT EZ A METODUS: nem "elfelejtettuk", hanem a hivoi kore
   * kizarolag belso. A PRIVAT lathatosag tartja igy: aki uj publikus utat nyit
   * ra, annak a `detail()`-t kell hivnia, vagy sajat orzot tennie.
   */
  private async internalDetail(
    id: string,
    user: AuthenticatedUser,
  ): Promise<ServiceJobDetail> {
    /**
     * A NEM LATHATO JEGY UGYANAZT A VALASZT ADJA, MINT A NEM LETEZO.
     *
     * Szandekos: egy kulon "nincs jogod" uzenet elarulna, hogy a jegy LETEZIK --
     * a szamabol pedig egy partner vegigprobalhatna, mennyi jegyunk van.
     */
    const row = await this.repository.detail(
      id,
      await this.visibilityFor(user),
    );
    if (row === null) throw new NotFoundException("A hibajegy nem található.");

    /**
     * A TOROLT CSATOLMANYOK NYOMA -- A LATHATOSAG UTAN, NEM ELOTTE.
     *
     * A sorrend nem izles: ha a jegy nem lathato a hivonak, a fenti `null` mar
     * kivetelt dobott, tehat ide csak olyan azonositoval jutunk el, amit a
     * hivo LATHAT. Igy a naplo-lekerdezes nem kaphat sajat lathatosagi szurot
     * -- es nem is kell neki egy MASIK, amit kulon karban kellene tartani.
     */
    const removals = await this.repository.documentRemovals(row.id);
    // AZ UT A SORRAL EGYUTT ERKEZIK a tarolobol -- lasd ott az indokot.
    const ut = row.departmentPath ?? null;

    const belso: ServiceJobDetail = {
      id: row.id,
      jobNumber: row.jobNumber,
      title: row.title,
      kind: row.kind,
      description: row.description,
      /**
       * A RESZLETLAP REJTETT JEGYNEL IS ELERHETO, tehat itt mind a ket ertek
       * elofordulhat -- a lista-elemen alapbol mindig hamis.
       */
      hidden: row.hiddenAt !== null,
      status: row.status,
      partnerStatus: partnerVisibleStatus(row.status),
      partnerStatusLabel: partnerStatusLabel(row.status),
      customerName: row.customer?.displayName ?? null,
      customerId: row.customerId,
      departmentId: row.departmentId,
      /**
       * A TELJES UT, NEM CSAK A SZULO. Ez a mezo korabban EGY szintet fuzott a
       * nev ele -- harom szintnel viszont ugyanugy nem mondja meg, melyik agrol
       * van szo, es a ket eset kivulrol egyforman nez ki.
       */
      departmentPath: ut,
      // A REGI MEZO MARAD, es most az UT osszefuzott alakja. A mobil csomag
      // sajat tipusdeklaraciokat tart, tehat ott a tomb nem jelenik meg
      // magatol -- ez a sor az, ami ott is javul.
      departmentName: ut ? ut.join(" / ") : null,
      createdAt: row.createdAt.toISOString(),
      // A tábla `readonly` tömböt ad (nem írható felül kívülről); a válasz
      // sima tömb, ezért itt másolat készül róla.
      scheduledAt: row.scheduledAt?.toISOString() ?? null,
      startedAt: row.startedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      allowedSteps: [...allowedServiceJobSteps(row.status)],
      // AZ ÖSSZEFÉSÜLÉS ITT TÖRTÉNIK, NEM A KLIENSBEN. A sorrend szabály, és a
      // mobil csomag nem is éri el ezt a közös függvényt (nem függ a
      // `@acropora/types`-tól), tehát ott újraíródna - két kliens, két
      // sorrend, és a különbség néma, mert mindkettő hihetően néz ki.
      timeline: serviceJobTimeline({
        // A `toStatus` a naplo tablajan 2026-09-02 ota nullazhato (ADR-013),
        // mert a munkalap-esemenyeknek nincs cel-allapotuk. IDE OLYAN SOR NEM
        // ERHET, aminek nincs: a lekerdezes `STATUS_CHANGE`-re szur, es az
        // adatbazis CHECK-je szerint egy ilyen sor cel-allapot nelkul nem is
        // keletkezhet. Ez a sor tehat KET fuggetlen garancia utan all itt --
        // es azert eldobassal, nem kivetellel, mert egy olvasasi uton egy
        // lehetetlen sor miatt nem szabad a teljes reszletlapot elvenni.
        events: row.events.flatMap((event) =>
          event.toStatus === null
            ? []
            : [
                {
                  id: event.id,
                  fromStatus: event.fromStatus,
                  toStatus: event.toStatus,
                  note: event.note,
                  actorName: event.actor?.displayName ?? null,
                  createdAt: event.createdAt.toISOString(),
                },
              ],
        ),
        worksheets: row.worksheets.map((worksheet) => ({
          id: worksheet.id,
          number: worksheet.number,
          /*
            AZ URES STRING ITT NEM NEVTELENSEGET ALLIT, hanem azt, hogy a
            laphoz nem tartozik verzio, tehat nincs honnan tudni a nevet. A
            rajzolo ezt a ket esetet egyforman kezeli (visszaesik a szamra),
            de a null helyett azert all ures string, mert a mezo NEM
            elhagyhato: egy `null` a kliensekben kulon agat nyitna arra, ami
            ugyanaz a hiany.
          */
          subject: worksheet.versions[0]?.subject ?? "",
          createdAt: worksheet.createdAt.toISOString(),
          handedOverAt: worksheet.handedOverAt?.toISOString() ?? null,
        })),
        assets: row.assets.map((link) => ({
          id: link.id,
          assetId: link.assetId,
          assetNumber: link.asset.assetNumber,
          assetName: link.asset.name,
          attachedAt: link.createdAt.toISOString(),
        })),
        /**
         * A FAJLNEV A NAPLO SAJAT MASOLATABOL JON, es nem lehet mashonnan: a
         * dokumentum sora a torleskor megszunt. A `metadata` szabad alaku
         * JSON, tehat a kiolvasas OVATOS -- egy hianyzo vagy mas tipusu mezo
         * nem donthet el egy reszletlapot, ezert nevesitett helyettesitest kap.
         */
        documentRemovals: removals.map((removal) => {
          const meta =
            removal.metadata &&
            typeof removal.metadata === "object" &&
            !Array.isArray(removal.metadata)
              ? (removal.metadata as Record<string, unknown>)
              : {};
          return {
            id: removal.id,
            fileName:
              typeof meta.fileName === "string"
                ? meta.fileName
                : "ismeretlen fájl",
            /*
              A TIPUS VISSZAESESE `OTHER`, NEM `PHOTO`. A regebbi naplo-sorokban
              (a mai valtozas elottrol) nincs `documentType`, es egy hianyzo
              mezobol nem szabad fenykepet allitani -- az tobbet mondana, mint
              amit tudunk. Az `OTHER` az az ertek, ami nem allit semmit.
            */
            documentType: meta.documentType === "PHOTO" ? "PHOTO" : "OTHER",
            actorName: removal.user?.displayName ?? null,
            removedAt: removal.createdAt.toISOString(),
            /*
              A FELTOLTES ADATAI A NAPLO SAJAT MASOLATABOL -- mashonnan nem is
              jöhetnenek: a dokumentum sora, ami ezeket hordozta, a torleskor
              megszunt. A `null` itt azt mondja, hogy NEM TUDJUK (regebbi
              bejegyzes), nem azt, hogy nem volt feltoltve.
            */
            uploadedByName:
              typeof meta.uploadedByName === "string"
                ? meta.uploadedByName
                : null,
            uploadedAt:
              typeof meta.uploadedAt === "string" ? meta.uploadedAt : null,
          } as const;
        }),
      }),
      /**
       * ES UGYANEZ SAJAT LISTAKENT IS. NEM duplikacio: a naplo az IDORENDET
       * mondja meg, ez a HALMAZT -- es a hibajegybol nyitott munkalap ezt a
       * halmazt orokli. A naplobol kiolvasva a felvitel egy megjelenitesi
       * dontestol fuggne.
       */
      assets: row.assets.map((link) => ({
        id: link.id,
        assetId: link.assetId,
        assetNumber: link.asset.assetNumber,
        assetName: link.asset.name,
        attachedAt: link.createdAt.toISOString(),
      })),
      // A DELEGALT A BECENEVEN SZEREPEL, nem a hivatalos neven: a delegalas
      // belso munkaszervezes, nem dokumentum-tartalom. Ugyanaz a valasztas,
      // mint a munkalap felelosenel.
      assignees: row.assignees.map((assignee) => ({
        userId: assignee.userId,
        name: personDisplayName(assignee.user),
        assignedAt: assignee.assignedAt.toISOString(),
      })),
    };

    /**
     * A PARTNER SAJAT ALAKOT KAP, NEM A BELSOT MEGSZURVE.
     *
     * Balazs dontese, 2026-09-21 12:07:32 UTC (message_id 1551565542886740020).
     * Az indok, amit elfogadott: a "nem latja" NEM vedelem -- a bongeszo
     * fejlesztoi ablaka elolvassa a valaszt, es ezek a mezok EGYETLEN feluleti
     * valtozasnyira vannak attol, hogy ki is rajzolodjanak.
     *
     * A VETITES A KOZOS CSOMAGBAN ALL (`partnerServiceJobDetail`), tehat a
     * partner KLIENS ugyanazt a tipust latja, amit a szerver eloallit.
     *
     * ES A SZALLITO IS PARTNER: a `supplier` hatokor ide el sem jut (a fenti
     * lathatosagi szuro eldobja), de ha egyszer eljutna, a `!== "internal"`
     * alak a SZUKEBB iranyba esik -- a `=== "customer"` alak csendben a belso
     * valaszt adna neki.
     */
    return belso;
  }

  /**
   * A RESZLETLAP, A HIVO HATOKORE SZERINT.
   *
   * A partner SAJAT ALAKOT kap, nem a belsot megszurve (Balazs dontese,
   * 2026-09-21 12:07:32 UTC, message_id 1551565542886740020). Az indok, amit
   * elfogadott: a "nem latja" NEM vedelem -- a bongeszo fejlesztoi ablaka
   * elolvassa a valaszt.
   *
   * ES A SZALLITO IS PARTNER: a `supplier` hatokor ide ma el sem jut (a
   * lathatosagi szuro eldobja), de ha egyszer eljutna, a `!== "internal"` alak
   * a SZUKEBB iranyba esik. A `=== "customer"` alak csendben a belso valaszt
   * adna neki.
   */
  async detail(
    id: string,
    user: AuthenticatedUser,
  ): Promise<ServiceJobDetail | ServiceJobPartnerDetail> {
    const belso = await this.internalDetail(id, user);
    return partnerScopeOf(user).kind === "internal"
      ? belso
      : partnerServiceJobDetail(belso);
  }

  /**
   * EGY MEGLEVO MUNKALAP A JEGY ALA.
   *
   * EZ A FOLYAMAT MASODIK FELE, es nelkule az elso fele sem teljes: a lap
   * keletkezhet hibajegy nelkul (a szerelo karbantartas kozben veszi fel), es a
   * jegy NALUNK szuletik meg utolag - akar hetekkel kesobb. Ha a mar meglevo
   * lapot nem lehet a jegy ala tenni, az az ut a felenel megall.
   *
   * HAROM KIMENET, ES MINDHAROM MAS MONDAT:
   *   nincs ilyen jegy vagy lap  -> nem talalhato
   *   a lap MAR jegy alatt all   -> utkozes, es MEGMONDJUK, hogy melyik alatt
   *   sikeres                    -> nyugta
   *
   * A MASODIKAT azert nem nyeljuk el: aki csatolni akar, es a lap mar mashol
   * van, annak nem az a kerdese, hogy "sikerult-e", hanem hogy HOL van.
   */
  async attachWorksheet(
    jobId: string,
    worksheetId: string,
    user: AuthenticatedUser,
  ) {
    this.requireWriteScope(user);
    const job = await this.repository.jobAttachState(jobId);
    if (job === null) throw new NotFoundException("A hibajegy nem található.");

    const sheet = await this.repository.worksheetAttachState(worksheetId);
    if (sheet === null)
      throw new NotFoundException("A munkalap nem található.");
    if (sheet.serviceJobId !== null)
      throw new ConflictException(
        sheet.serviceJobId === jobId
          ? "Ez a munkalap már ehhez a hibajegyhez tartozik."
          : "Ez a munkalap már egy másik hibajegyhez tartozik.",
      );

    /*
     * A PARTNERNEK EGYEZNIE KELL, ES A KET ELTERESRE KET KULONBOZO MONDAT JAR,
     * mert a felhasznalonak KET KULONBOZO teendot adnak:
     *
     *   kulonbozo partner  -> a LAP a rossz: masikat kell valasztani
     *   a jegynek nincs    -> a JEGY hianyos: eloszor a partneret kell beallitani
     *
     * Egy kozos uzenet mindkettore ugyanaz a hiba lenne, mint a gondolatjel a
     * hiany helyen: elmondja, hogy valami nincs rendben, azt nem, hogy mit tegyen.
     *
     * MIERT NEM MEHET PARTNER NELKULI JEGY ALA (acrobot dontese, 2026-09-02; a
     * gazda ele MEG NEM jutott el, tehat NEM az o dontese): a
     * jegy CSENDBEN megkapna egy partner tulajdonat, esemeny nelkul -- epp abban
     * a rendszerben, ahol most epitjuk a naplot, hogy minden valtozasnak legyen
     * nyoma. A megengedo iranyban KET rossz allitas keletkezne egy muveletbol
     * (rossz helyen a lap ES rossz partnernel a jegy), es egyik sem kerdezett.
     *
     * MI NYITNA MEG: ha a partner nelkuli jegy GYAKORINAK bizonyul elesben, es
     * a plusz lepes zavaro. Akkor sem a csendes atvetel jonne, hanem egy
     * KIMONDOTT alak: a csatolas felajanlja a jegy partnerenek beallitasat, es
     * a felhasznalo megerositi. Ez ma nem dontheto el maskepp: nulla adatunk
     * van rola, mert a modul meg nem all elesben.
     */
    /**
     * A SZABALY KOZOS A LAP-NYITASSAL (`common/worksheet-under-ticket.ts`), a
     * MONDAT viszont ezé az uté: itt egy MAR LETEZO lap kerul a jegy ala, tehat
     * a felhasznalo masik lapot valaszt. A nyitasnal ugyanez a helyzet mast
     * jelent, es mas a teendo is.
     */
    const check = mayWorksheetJoinTicket({
      ticketCustomerId: job.customerId,
      worksheetCustomerId: sheet.customerId,
    });
    if (!check.ok)
      throw new BadRequestException(
        check.reason === "ticket-has-no-partner"
          ? "Ehhez a hibajegyhez még nincs partner. Először állítsd be a hibajegy partnerét."
          : "Ez a munkalap másik partnerhez tartozik, mint a hibajegy.",
      );

    const attached = await this.repository.attachWorksheet({
      serviceJobId: jobId,
      worksheetId,
    });
    // A FELTETEL A `WHERE`-BEN IS OTT VOLT: ha kozben mas csatolta, itt derul
    // ki, es nem irjuk felul csendben.
    if (!attached.ok)
      throw new ConflictException(
        "A munkalap időközben egy hibajegy alá került. Töltsd újra.",
      );
    return { ok: true };
  }

  /**
   * PARTNER EGY MEG PARTNER NELKULI JEGYRE.
   *
   * MIERT KELL: a felvitel nem koveteli meg a partnert (a jegy tipikusan egy
   * mar meglevo lapbol szuletik, aminek van partnere), a CSATOLAS viszont
   * igen. Enelkul az ut nelkul egy partner nelkul megnyitott jegy BENT RAGAD:
   * soha nem tud lapot fogadni, es a feluleten nincs kiut. Ez rosszabb, mint a
   * hiany, mert ELOALL es UTANA ALL.
   *
   * ES AMI EZ NEM: ATSOROLAS. Egy jegy, aminek MAR van partnere, ezen az uton
   * nem valtoztathato meg, es ez KIMONDOTT dontes, nem mellekhatas:
   *
   *   - a partner megvaltoztatasa egy MAR CSATOLT lappal rendelkezo jegyen
   *     azonnal eltérest csinalna a jegy es a lap partnere kozott -- pont azt a
   *     rest nyitna ujra, amit a csatolas-ellenorzes bezart, csak egy masik
   *     ajton;
   *   - egy jegynek pedig csak akkor lehet lapja, ha VAN partnere (a csatolas
   *     ezt koveteli), tehat a "partner megvaltoztatasa" gyakorlatilag mindig
   *     olyan jegyet erint, ami mar dolgozik -- az pedig ATSOROLAS, ugyanazokkal
   *     a nyitott kerdesekkel, mint a lap athelyezese masik jegy ala.
   *
   * A TILTAS TEHAT HANGOS: a felhasznalo megtudja, hogy amit akar, az mas
   * muvelet. A megengedo irany NEMA lenne: ket partner egy jegyen, es senki
   * nem keresi.
   */
  async setPartner(jobId: string, customerId: string, user: AuthenticatedUser) {
    this.requireWriteScope(user);
    const job = await this.repository.jobAttachState(jobId);
    if (job === null) throw new NotFoundException("A hibajegy nem található.");
    if (job.customerId !== null)
      throw new ConflictException(
        "Ennek a hibajegynek már van partnere. A partner megváltoztatása átsorolás, arra ma nincs út.",
      );

    if (!(await this.repository.customerExists(customerId)))
      throw new NotFoundException("A partner nem található.");

    const updated = await this.repository.setPartner({
      id: jobId,
      customerId,
    });
    // A FELTETEL A `WHERE`-BEN IS OTT VOLT: ha kozben mas allitotta be, itt
    // derul ki, es nem irjuk felul csendben.
    if (!updated.ok)
      throw new ConflictException(
        "A hibajegy időközben partnert kapott. Töltsd újra, és nézd meg, mi történt.",
      );
    return { ok: true };
  }

  /**
   * A LAP LEVALASZTASA A JEGYROL -- A CSATOLAS VISSZAUTJA.
   *
   * MIERT KELL: a csatolas egy legordulobol valaszt, a lapokat pedig sokszor
   * sorszam nelkul kell megkulonboztetni (a piszkozatnak nincs szama). Egy
   * rossz valasztas enelkul OROKRE ott hagyna a lapot, es meg egy masik
   * csatolassal sem lenne javithato -- azt a sajat utkozes-orzonk zarja ki.
   *
   * ES AMI EZ NEM: ATSOROLAS. Ez az allapot, ahova visszavisz (a lap jegy
   * nelkul), a modellben amugy is letezik es rendes: a lap keletkezhet jegy
   * nelkul. Az atsorolas ezzel szemben uj kerdeseket nyitna (mi legyen a regi
   * jegy naplojaval, mit lat a partner), es azokra ma nincs dontes.
   */
  async detachWorksheet(
    jobId: string,
    worksheetId: string,
    user: AuthenticatedUser,
  ) {
    this.requireWriteScope(user);
    // A LEVALASZTAS NEM NEZI A PARTNERT, es ez nem feledekenyseg: a partner-
    // egyezes a BEKERULES feltetele. Egy mar csatolt lapot levenni akkor is
    // szabad kell hogy legyen, ha a partner idokozben elmozdult -- kulonben
    // epp a hibas allapotot zarnank be.
    const job = await this.repository.jobAttachState(jobId);
    if (job === null) throw new NotFoundException("A hibajegy nem található.");

    const sheet = await this.repository.worksheetAttachState(worksheetId);
    if (sheet === null)
      throw new NotFoundException("A munkalap nem található.");
    if (sheet.serviceJobId !== jobId)
      throw new ConflictException(
        sheet.serviceJobId === null
          ? "Ez a munkalap nem tartozik hibajegyhez."
          : "Ez a munkalap egy másik hibajegyhez tartozik.",
      );

    const detached = await this.repository.detachWorksheet({
      serviceJobId: jobId,
      worksheetId,
    });
    if (!detached.ok)
      throw new ConflictException(
        "A munkalap időközben elmozdult. Töltsd újra, és nézd meg, mi történt.",
      );
    return { ok: true };
  }

  /**
   * EGY LÉPÉS A JEGYEN, A TÁBLA SZERINT.
   *
   * A SZABÁLYT A TISZTA FÜGGVÉNY MONDJA MEG, nem ez a metódus: itt csak az
   * dől el, mi történjen az elutasítással. Így az átmenetek szabálya
   * adatbázis nélkül is mérhető marad.
   *
   * AZ ELUTASÍTÁS MEGNEVEZI, MI MEHETNE HELYETTE. Egy puszta „nem lehet"
   * arra kényszerítené a felhasználót, hogy sorra próbálgassa a gombokat -
   * és a válasz úgyis a szerveren áll, tehát olcsóbb kimondani.
   */
  /**
   * A JEGY ELREJTESE VAGY VISSZAALLITASA.
   *
   * UGYANAZ AZ ALAK, MINT A MUNKALAPNAL: egy metodus ket iranyra, es a
   * hatokor-korlat itt all, nem a kontrolleren. A `requireWriteScope` az a
   * meglevo ellenorzes, ami mar ma kimondja, hogy iras csak belso utrol jon --
   * nem irtam melle masodikat.
   *
   * ES AMIT EZ SZANDEKOSAN NEM CSINAL: nem rejti el a jegy MUNKALAPJAIT. Egy
   * jegy alatt allhat valodi lap, es a lanc (jegy -> lap -> teljesitesi
   * igazolas -> szamla) ep marad. A rejtes per sor megy.
   */
  async setHidden(
    id: string,
    hidden: boolean,
    user: AuthenticatedUser,
  ): Promise<void> {
    /**
     * KET KULONBOZO KERDES, ES MIND A KETTO KELL.
     *
     * A `requireWriteScope` a PARTNERT zarja ki (csak belso utrol jon iras); a
     * `SERVICE_HIDE` a sajat szerelo kollegainkat, akik `SERVICE_MANAGE`-et
     * viselnek. Egyik sem helyettesiti a masikat: a `SERVICE_MANAGE` jogot a
     * partner-fiokok is viselik, tehat jog-ellenorzes onmagaban nem zarna ki
     * oket.
     *
     * A kontrolleren is all `SERVICE_HIDE` kapu. Ez a sor azt vedi, ami a
     * dekoratort megkerulne: egy masodik hivo (utemezes, import, masik
     * vegpont).
     */
    this.requireWriteScope(user);
    if (!hasPermission(user, PERMISSIONS.SERVICE_HIDE))
      throw new ForbiddenException(
        "A hibajegy elrejtése admin jogkör: ehhez a művelethez nincs jogosultságod.",
      );
    /**
     * A LETEZES ELLENORZESE ELOSZOR. Enelkul egy ismeretlen azonositora a
     * Prisma `update` dobna, es a hivo nyers adatbazis-hibat kapna a "nem
     * talalhato" helyett.
     */
    const status = await this.repository.statusOf(id);
    if (status === null)
      throw new NotFoundException("A hibajegy nem található.");
    await this.repository.setHidden(id, hidden ? new Date() : null, user.id);
  }

  async move(
    id: string,
    input: MoveServiceJobDto,
    actorUserId: string,
    user: AuthenticatedUser,
  ) {
    this.requireWriteScope(user);
    const from = await this.repository.statusOf(id);
    if (from === null) throw new NotFoundException("A hibajegy nem található.");

    if (!isServiceJobStepAllowed(from, input.to)) {
      const lehet = allowedServiceJobSteps(from);
      throw new BadRequestException(
        lehet.length === 0
          ? "Ez a hibajegy lezárult, nincs több lépése."
          : `Ebből az állapotból ezek a lépések mehetnek: ${lehet.join(", ")}.`,
      );
    }

    /**
     * A LEZARAS KAPUJA: ALAIRATLAN MUNKALAP FOLOTT NEM ZARHATO LE A JEGY.
     *
     * Balazs, 2026-09-18 18:06:13 UTC: „Ha nem kerul ala munkalap, akkor
     * lezarhato. Ha kerul ala munkalap, akkor csak ugy zarhato le ha a munkalap
     * ala van irva."
     *
     * KET FELTETEL, KET KULONBOZO HATOKORREL -- a reszletes indok a policy
     * fejleceben all (`worksheet-signature-gate.ts`), itt csak a lenyeg:
     *
     *   alairas  CSAK a `COMPLETED` lepesre. Nautilus indoka (2026-09-18)
     *            valtozatlanul all: az elallt jegyre epp az a jellemzo, hogy
     *            NEM lett belole munka.
     *   atadas   a `CANCELLED` lepesre IS. Az atadas a GEPROL szol, ami nem
     *            allt el: ha elallunk, mikozben a vevo eszkoze nalunk van, a
     *            jegy kikerul az aktiv listabol, es SEMMI nem koveti tovabb.
     *
     * A HIVAS EZERT ATADJA A CELALLAPOTOT, nem a hivohely donti el, melyik
     * feltetel all. Igy a ket hatokor EGY helyen latszik, es nem lehet az
     * egyiket a masik elgepelesenek nezni.
     */
    if (input.to === "COMPLETED" || input.to === "CANCELLED")
      await this.requireClosableWorksheets(id, input.to);

    /**
     * A CSUPA SZOKOZ UGYANAZ, MINT A SEMMI. A megjegyzes ELHAGYHATO (Balazs
     * dontese, 2026-09-03), de ha be van irva, akkor tartalom legyen: egy
     * szokozokbol allo szoveg kitoltott mezonek latszik, es ures sort vinne a
     * jegy tortenetebe. A `|| null` ezert all itt: a hianyt EGYFELE alak
     * jelolje, ne ketfele.
     */
    const note = input.note?.trim() || null;

    const moved = await this.repository.move({
      id,
      from,
      to: input.to,
      note,
      actorUserId,
    });
    // A LÉPÉS FELTÉTELE A `from` VOLT: ha közben más lépett, nem írjuk felül
    // csendben, hanem megmondjuk, hogy elmozdult alattunk.
    if (!moved.ok)
      throw new ConflictException(
        "A hibajegy időközben másik állapotba került. Töltsd újra, és nézd meg, mi történt.",
      );

    /**
     * A VÁLASZ A TELJES RÉSZLETLAP, NEM NYUGTA -- ÉS EZ ÉLES HIBÁBÓL JÖN.
     *
     * 2026-09-17-ig `{ ok: true }` ment vissza, a telefon kliense viszont
     * `ServiceJobDetail` típusúnak DEKLARÁLTA ugyanezt a választ. A fordító
     * ezt nem láthatta: az Expo app nem húzhatja be a munkatér csomagjait,
     * tehát a válasz típusait MÁSOLJA, és egy másolat önmagával konzisztens.
     * A képernyő a nyugtát tette a gyorsítótárba, a következő kirajzolás
     * pedig `detail.assets.length` értéken állt meg -- React Native-ben ez
     * nem hibaüzenet, hanem KILÉPÉS. Balázs jelentése: „a hibajegynél ha
     * allapotot leptetek kilep az alkalmazas".
     *
     * UGYANAZ AZ ALAK, mint a `setAssignees` és a `setPlacement` fölött:
     * nyugta után a felület MÉG egy lekérdezést indítana, és a két válasz
     * között a jegy már mozdulhatott. Egy körből friss lap jön, és a napló
     * új sora -- a lépés bizonyítéka -- rajta van.
     */
    return this.internalDetail(id, user);
  }
}
