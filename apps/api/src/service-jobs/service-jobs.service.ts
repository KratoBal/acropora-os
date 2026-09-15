import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import type { Prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { partnerScopeOf } from "../auth/partner-scope.util.js";
import { serviceJobVisibilityWhere } from "./service-job-visibility.js";
import { mayWriteServiceJob } from "./service-job-write-scope.js";
import { mayAssignUnit } from "./visibility-assignment.js";

import {
  personDisplayName,
  serviceJobTimeline,
  type ServiceJobDetail,
  type ServiceJobListResponse,
} from "@acropora/types";

import type {
  CreateServiceJobDto,
  MoveServiceJobDto,
  ServiceJobListQueryDto,
  SetServiceJobAssigneesDto,
} from "./dto.js";
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
  ) {}

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
    actorUserId: string,
    now: Date = new Date(),
  ) {
    const assigneeIds = normalizeAssigneeIds(input.assigneeIds ?? []);
    await this.requireAssignableUsers(assigneeIds);

    const year = now.getFullYear();
    const last = await this.repository.lastNumberOfYear(
      serviceJobNumberPrefix(year),
    );
    const customerId = input.customerId?.trim() || null;
    const departmentId = input.departmentId?.trim() || null;
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
    const assetIds = [...new Set(input.assetIds ?? [])].filter(
      (id) => id.trim() !== "",
    );
    if (assetIds.length > 0) {
      if (!departmentId) {
        throw new BadRequestException(
          "Eszközt csak helyszínnel együtt lehet megadni.",
        );
      }
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
    });

    // ERTESITES CSAK AZUTAN, hogy a jegy tarolva van. Felvitelkor minden
    // delegalt uj, tehat a lista maga a kulonbseg.
    if (assigneeIds.length > 0)
      this.notifications?.notifyServiceJobAssignment({
        serviceJobId: created.id,
        subject: title,
        userIds: assigneeIds,
      });

    return created;
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

    const detail = await this.detail(id, user);

    if (updated.added.length > 0)
      this.notifications?.notifyServiceJobAssignment({
        serviceJobId: id,
        subject: detail.title,
        userIds: updated.added,
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
    const visibility = await this.visibilityFor(user);
    const [{ rows, truncated }, counts] = await Promise.all([
      this.repository.list(query.scope ?? "open", visibility, query.search),
      this.repository.countsByStatus(visibility, query.search),
    ]);
    return {
      counts,
      truncated,
      items: rows.map((row) => ({
        id: row.id,
        jobNumber: row.jobNumber,
        title: row.title,
        status: row.status,
        partnerStatus: partnerVisibleStatus(row.status),
        partnerStatusLabel: partnerStatusLabel(row.status),
        customerName: row.customerName,
        worksheetCount: row.worksheetCount,
        createdAt: row.createdAt.toISOString(),
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
  async detail(id: string, user: AuthenticatedUser): Promise<ServiceJobDetail> {
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

    return {
      id: row.id,
      jobNumber: row.jobNumber,
      title: row.title,
      description: row.description,
      status: row.status,
      partnerStatus: partnerVisibleStatus(row.status),
      partnerStatusLabel: partnerStatusLabel(row.status),
      customerName: row.customer?.displayName ?? null,
      customerId: row.customerId,
      departmentId: row.departmentId,
      // A SZULO CSAK AKKOR KERUL ELE, HA VAN. Gyokerszintu egysegnel egy vezeto
      // elvalaszto maradna a nev elott, ami hianyzo adatnak latszik.
      departmentName: row.department
        ? [row.department.parent?.name, row.department.name]
            .filter(Boolean)
            .join(" / ")
        : null,
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
     * a felhasznalo megerositi. Ez ma nem donthetо el maskepp: nulla adatunk
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
    return { ok: true };
  }
}
