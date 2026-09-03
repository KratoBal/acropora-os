import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { partnerScopeOf } from "../auth/partner-scope.util.js";
import { serviceJobVisibilityWhere } from "./service-job-visibility.js";
import { mayAssignUnit } from "./visibility-assignment.js";

import {
  serviceJobTimeline,
  type ServiceJobDetail,
  type ServiceJobListResponse,
} from "@acropora/types";

import type {
  CreateServiceJobDto,
  MoveServiceJobDto,
  ServiceJobListQueryDto,
} from "./dto.js";
import {
  nextServiceJobNumber,
  serviceJobNumberPrefix,
} from "./service-job-number.js";
import {
  partnerStatusLabel,
  partnerVisibleStatus,
} from "./service-job-status.js";
import {
  allowedServiceJobSteps,
  isServiceJobStepAllowed,
} from "./service-job-transitions.js";
import { ServiceJobsRepository } from "./service-jobs.repository.js";

@Injectable()
export class ServiceJobsService {
  constructor(private readonly repository: ServiceJobsRepository) {}

  async create(
    input: CreateServiceJobDto,
    actorUserId: string,
    now: Date = new Date(),
  ) {
    const year = now.getFullYear();
    const last = await this.repository.lastNumberOfYear(
      serviceJobNumberPrefix(year),
    );
    return this.repository.create({
      jobNumber: nextServiceJobNumber({ year, lastNumber: last }),
      title: input.title.trim(),
      description: input.description?.trim() || null,
      customerId: input.customerId?.trim() || null,
      actorUserId,
    });
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

  listAssignments(userId: string) {
    return this.repository.listAssignments(userId);
  }

  async list(
    query: ServiceJobListQueryDto,
    user: AuthenticatedUser,
  ): Promise<ServiceJobListResponse> {
    const rows = await this.repository.list(
      query.scope ?? "open",
      await this.visibilityFor(user),
    );
    return {
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
      }),
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
  async attachWorksheet(jobId: string, worksheetId: string) {
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
    if (job.customerId === null)
      throw new BadRequestException(
        "Ehhez a hibajegyhez még nincs partner. Először állítsd be a hibajegy partnerét.",
      );
    if (job.customerId !== sheet.customerId)
      throw new BadRequestException(
        "Ez a munkalap másik partnerhez tartozik, mint a hibajegy.",
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
  async setPartner(jobId: string, customerId: string) {
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
  async detachWorksheet(jobId: string, worksheetId: string) {
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
  async move(id: string, input: MoveServiceJobDto, actorUserId: string) {
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

    const moved = await this.repository.move({
      id,
      from,
      to: input.to,
      note: input.note?.trim() || null,
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
