import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { ContentRepository } from "./content.repository.js";
import {
  ROLES_THIS_VIEW_CANNOT_COVER,
  STATES_THAT_CAN_WAIT_FOR_IMAGE,
  waitingFor,
  waitingOnMe,
  type ContentViewerRole,
} from "./content-filter.js";
import {
  contentBlockers,
  moveOptions,
  planTransition,
  requiresApproval,
  type ContentState,
} from "./content-state.js";
import { scheduleStanding, scheduleTargetFor } from "./content-schedule.js";

/**
 * A TARTALOM-SOR SZOLGÁLTATÁSA.
 *
 * A DÖNTÉSEK TISZTA FÜGGVÉNYEKBEN ÁLLNAK (`content-state.ts`,
 * `content-schedule.ts`, `content-filter.ts`), ez az osztály pedig beköti őket
 * az adatbázisba. A szétválasztás nem stílus: a szabályok így mérhetők
 * adatbázis nélkül, és a mérésük nem függ attól, hogy a Prisma épp mit ad
 * vissza.
 */
@Injectable()
export class ContentService {
  constructor(private readonly repository: ContentRepository) {}

  /**
   * MINDEN SORHOZ ODAKERÜL, MIT LEHET BELŐLE LÉPNI.
   *
   * MIÉRT ITT, ÉS MIÉRT NEM A FELÜLETEN: az átmenetek zárt listája, a jóváhagyói
   * jog és a külső munka mind a szerver tudása, tiszta függvényekben mérve. Ha a
   * felület számolná ki ugyanezt, ugyanaz a szabály két helyen állna, és a
   * második egy nap csendben elavulna -- épp a kapunál.
   *
   * A SORRENDET NEM ÍRJA ÁT: a lista rendezése a lekérdezésé marad, ez csak
   * hozzátesz egy mezőt.
   */
  private withMoves<T extends { state: ContentState }>(items: T[]) {
    return items.map((item) => ({ ...item, moves: moveOptions(item.state) }));
  }

  /**
   * AMI RÁM VÁR. Ez a lista alapértelmezett nézete, és Balázs kérésének szó
   * szerinti fordítása: „minden felkerul ami rank var".
   */
  async waitingForMe(role: ContentViewerRole, userId: string) {
    const filter = waitingFor(role);
    return this.withMoves(
      await this.repository.list({
        state: { in: filter.states },
        ...(filter.ownOnly
          ? { OR: [{ authorId: userId }, { reviewerId: userId }] }
          : {}),
      }),
    );
  }

  /**
   * MI VÁR RÁM, SZEREP-VÁLASZTÁS NÉLKÜL.
   *
   * A HÁROM RÉSZ EGY LEKÉRDEZÉSBE MEGY, `OR`-ral, nem három hívásba: így a
   * rendezés a teljes halmazon érvényes. Három külön lista összefűzése azt
   * jelentené, hogy a legrégebbi tétel a második lista tetején állna, és a
   * sorrend -- ami ebben a nézetben a sürgősséget hordozza -- hazudna.
   *
   * A VÁLASZ MEGNEVEZI, MIT NEM FED LE. Ez nem óvatoskodás: a `sender` szerep ma
   * semmiből nem vezethető le, és egy „mi vár rám" nézet, ami erről hallgat,
   * pontosan azt a hamis megnyugvást adja, amit kerülni akarunk. Ugyanaz az elv,
   * mint a dokumentum-tároló állapotánál: a válasz mondja meg, miről nem tud
   * nyilatkozni.
   */
  async waitingOnMe(viewer: { userId: string; canApprove: boolean }) {
    const shards = waitingOnMe(viewer);
    const items = await this.repository.list({
      OR: shards.map((shard) => ({
        state: { in: shard.states },
        ...(shard.scope === "own-author" ? { authorId: viewer.userId } : {}),
        ...(shard.scope === "own-reviewer"
          ? { reviewerId: viewer.userId }
          : {}),
      })),
    });

    return {
      items: this.withMoves(items),
      notCovered: ROLES_THIS_VIEW_CANNOT_COVER,
    };
  }

  /**
   * AMI KÉPRE VÁR. KÜLÖN lekérdezés, nem az állapotszűrő része, mert a kép a
   * szövegtől független feltétel -- ma NÉGY kész szövegű poszt áll pontosan itt,
   * 2026-08-18 óta (a szám és a határa a `content-state.ts` fejlécében).
   */
  async waitingForImage() {
    return this.withMoves(
      await this.repository.list({
        imageRequired: true,
        imageAttachedAt: null,
        state: { in: STATES_THAT_CAN_WAIT_FOR_IMAGE },
      }),
    );
  }

  /**
   * A NAPTÁR NÉZET: a tervezett kiküldési dátum szerint, egy időszakra.
   *
   * A dátum nélküli tételek NEM szerepelnek benne, és ez szándékos: egy naptár,
   * ami a dátum nélkülieket is mutatja, nem naptár, hanem lista.
   */
  async calendar(from: Date, to: Date) {
    return this.withMoves(
      await this.repository.list({ plannedFor: { gte: from, lte: to } }),
    );
  }

  async detail(id: string) {
    const item = await this.repository.detail(id);
    if (!item) throw new NotFoundException("A tartalom nem található.");

    const blockers = contentBlockers({
      state: item.state,
      imageRequired: item.imageRequired,
      imageAttached: item.imageAttachedAt !== null,
    });

    // AZ ÜTEMEZÉS ÁLLÁSA A TÉTELLEL EGYÜTT JÖN, mert a felület naptára két
    // dátumot mutat: amikorra ütemezve van, és amikor a MI határidőnk lejár
    // rajta. Egy „ütemezve" felirat a lejárat nélkül eseménytelennek látszana,
    // holott ez az egyetlen állapotunk, amiben a semmittevésnek határideje van.
    const schedule =
      item.state === "SCHEDULED" && item.scheduleAnchoredAt
        ? scheduleStanding(
            { scheduleAnchoredAt: item.scheduleAnchoredAt },
            new Date(),
          )
        : null;

    // A RÉSZLET IS MEGKAPJA A LÉPÉSEKET, ugyanabból a forrásból, mint a lista.
    // Ha csak a lista kapná meg, egy részletről nyíló cselekvés megint a
    // felület találgatásán állna.
    return { ...item, blockers, schedule, moves: moveOptions(item.state) };
  }

  /**
   * ÁLLAPOTVÁLTÁS, NÉGY KAPUVAL.
   *
   * 1. Az átmenet engedélyezett-e (`planTransition`).
   * 2. Van-e hozzá JOGA a hívónak (`requiresApproval`).
   * 3. Kíván-e KÜLSŐ munkát -- ilyenkor NEM írunk, hanem visszautasítunk. A
   *    Facebook-oldali visszavonás külön döntés, és amíg nincs megépítve, egy
   *    állapot-átírás azt hazudná, hogy a poszt nem megy ki.
   * 4. A tétel abban az állapotban van-e, amiben a hívó hitte (feltételes
   *    írás a repository-ban).
   *
   * A MÁSODIK KAPU ITT ÁLL, ÉS NEM A VÉGPONTON, ÉS EZ A LÉNYEGE.
   *
   * Korábban a jóváhagyási kapu KIZÁRÓLAG abból állt, hogy két végpont van: a
   * `/move` `content.manage` jogot kért, az `/approve-move` `content.approve`-ot.
   * Csakhogy mindkettő EZT a metódust hívta, ugyanazzal a törzzsel, és a `to`
   * mező mind a kilenc állapotot elfogadta. Vagyis a kaput a HÍVÓ választotta ki
   * azzal, hogy melyik URL-re küldött -- egy `content.manage` jogú szerkesztő a
   * `/move` végponton át kiadhatta a jóváhagyást is. A kapu nem volt kapu.
   *
   * A végpont-szintű jog MEGMARAD (a keret olcsóbban utasít el, mint mi), de a
   * döntő ellenőrzés itt van, ahol a CÉLÁLLAPOT is ismert. Egy jövendő harmadik
   * végpont így nem tudja megkerülni: aki ezt a metódust hívja, annak meg kell
   * mondania, hogy a hívó jóváhagyhat-e.
   *
   * AZ `actorCanApprove` KÖTELEZŐ MEZŐ, nem opcionális. Egy alapértelmezett
   * érték itt azt jelentené, hogy egy új hívó CSENDBEN elfelejtheti -- így
   * viszont a fordító szól, mielőtt bárki futtatná.
   */
  async move(input: {
    id: string;
    from: ContentState;
    to: ContentState;
    discardReason?: string;
    revisionNote?: string;
    actorCanApprove: boolean;
    actorUserId: string;
  }) {
    const planned = planTransition(input.from, input.to);

    if (planned.kind === "refused") {
      throw new BadRequestException(
        `Ez a lépés nem megengedett: ${input.from} -> ${input.to}.`,
      );
    }

    // A JOG A KÜLSŐ MUNKA ELŐTT DŐL EL. Akinek nincs joga a lépéshez, annak a
    // Facebook-oldali teendőről sem kell értesülnie: az már a lépés HOGYANJA,
    // és ő odáig nem jut el.
    if (requiresApproval(input.from) && !input.actorCanApprove) {
      throw new ForbiddenException(
        "Ehhez a lépéshez jóváhagyói jog kell (content.approve).",
      );
    }

    if (planned.kind === "needs-external") {
      throw new ConflictException(planned.external.reason);
    }

    // AZ ELVETÉS OKA KÖTELEZŐ. Ok nélkül az „elvetve" állapot annyit mond, hogy
    // valaki egyszer nemet mondott -- de nem azt, hogy MIÉRT, és a következő
    // ember ugyanazt a tételt fogja újra elkezdeni.
    if (input.to === "DISCARDED" && !input.discardReason?.trim()) {
      throw new BadRequestException("Az elvetés oka kötelező.");
    }

    // ÉS A VISSZAKÜLDÉS FELVETÉSE UGYANÚGY KÖTELEZŐ.
    //
    // A fenti mondat betűre áll erre a lépésre is, csak eddig nem alkalmaztuk:
    // egy javításra visszaadott tétel a szerzőnél áll, és ha nem derül ki,
    // MIT kell javítani, a szerző vagy találgat, vagy visszakérdez -- és a
    // lektor addigra már mással foglalkozik.
    //
    // MIÉRT KÖTELEZŐ, ÉS NEM CSAK LEHETSÉGES: ha választható lenne, pont a
    // sietős körökben maradna el, vagyis pont akkor, amikor a legtöbbet
    // számítana. Ugyanaz a döntés, mint az elvetésnél.
    //
    // ÉS MIÉRT HOZZÁSZÓLÁS, NEM ÚJ MEZŐ: így a felvetés ott áll, ahol a válasz
    // is lesz, és nem keletkezik második hely, ahol ugyanaz a szöveg állhat.
    // Egy tétel, aminek két helyen van „miért javítsam" szövege, egy nap két
    // különbözőt fog mondani.
    if (input.to === "AWAITING_REVISION" && !input.revisionNote?.trim()) {
      throw new BadRequestException(
        "A visszaküldéshez írd meg, mit kell javítani.",
      );
    }

    const moved = await this.repository.moveState({
      id: input.id,
      from: input.from,
      to: input.to,
      ...(input.to === "DISCARDED"
        ? { discardReason: input.discardReason?.trim() ?? null }
        : {}),
      ...(input.to === "SCHEDULED"
        ? {
            scheduleAnchoredAt: new Date(),
            scheduledFor: scheduleTargetFor(new Date()),
          }
        : {}),
      // A FELVETÉS A LÉPÉSSEL EGYÜTT SZÜLETIK MEG, egy tranzakcióban. Külön
      // hívásként mindkét sorrend hagyna egy rossz állapotot: vagy árva
      // hozzászólás egy elmozdult tételen, vagy indok nélküli visszaküldés.
      ...(input.to === "AWAITING_REVISION" && input.revisionNote?.trim()
        ? {
            note: {
              authorId: input.actorUserId,
              body: input.revisionNote.trim(),
            },
          }
        : {}),
    });

    if (!moved) {
      throw new ConflictException(
        "A tartalom időközben más állapotba került. Töltsd újra, mielőtt döntesz.",
      );
    }

    return { ok: true as const };
  }

  /**
   * EGY UJ TETEL FELVETELE A SORBA.
   *
   * A MENU MA URES, ES NEM AZERT, MERT ELROMLOTT. A modul nyolc vegpontja
   * mind OLVAS vagy LEPTET; letrehozo ut nem volt, a taroloban allo `create`
   * fuggvenynek nem volt hivoja. Balazs panasza szo szerint az volt, hogy
   * "semmi nincs benne, vagyis nincs benne adat" -- a felulet a sor olvaso es
   * jovahagyo felet mutatta, a bemenet hianyzott.
   *
   * A KEZDO ALLAPOT `DRAFTING`, ES EZ NEM A SEMA ALAPERTELMEZESE. A Prisma
   * oszlop `@default(IDEA)`, es az elso valasztas az lett volna, hogy hagyjuk
   * ugy. Megmerve viszont: az `IDEA` a `STATES_BY_ROLE` tablazat EGYIK
   * szerepenel sem szerepel, es a modulnak nincs "minden tetel" listaja. Egy
   * IDEA allapotu tetel tehat SENKI listajaban nem jelenne meg -- vagyis a
   * letrehozas pontosan azt a panaszt termelne ujra, amiert keszult: az adat
   * ott van, es nem latszik.
   *
   * `DRAFTING` allapotban a tetel a SZERZOJERE var, es azonnal megjelenik a
   * sajat "mi var ram" listajaban. Az atmenet-tablazat szerint az `IDEA ->
   * DRAFTING` ut letezik, tehat a `DRAFTING` nem megkerules, hanem ugyanannak
   * az utnak a kezdopontja, egy lepessel kesobbrol.
   *
   * AMIT EZ NEM OLD MEG, ES KIMONDOM: az OTLET rogzitese. Aki csak egy temat
   * akar feljegyezni, annak ma nincs helye, mert az `IDEA` lathatatlan. Ez
   * kulon munka (vagy egy otlet-lista, vagy az `IDEA` felvetele valamelyik
   * nezetbe), es NEM azert maradt ki, mert nem vettem eszre.
   */
  async create(input: {
    title: string;
    channel: "FACEBOOK_POST" | "FACEBOOK_AD" | "ARTICLE" | "OTHER";
    authorId: string;
    body?: string;
    imageRequired?: boolean;
    plannedFor?: string;
  }) {
    const title = input.title.trim();
    if (!title) throw new BadRequestException("A cim nem lehet ures.");

    return this.repository.create({
      title,
      channel: input.channel,
      // A SZERZO A LETREHOZO, es nem valaszthato: egy tetel, aminek a szerzoje
      // valaki mas, azonnal az O listajaban allna, anelkul hogy tudna rola.
      authorId: input.authorId,
      state: "DRAFTING",
      ...(input.body?.trim() ? { body: input.body.trim() } : {}),
      ...(input.imageRequired === undefined
        ? {}
        : { imageRequired: input.imageRequired }),
      ...(input.plannedFor ? { plannedFor: new Date(input.plannedFor) } : {}),
    });
  }

  async comment(input: { contentId: string; authorId: string; body: string }) {
    if (!input.body.trim())
      throw new BadRequestException("Az üres hozzászólás nem menthető.");
    await this.repository.detail(input.contentId).then((item) => {
      if (!item) throw new NotFoundException("A tartalom nem található.");
    });
    return this.repository.addComment({ ...input, body: input.body.trim() });
  }
}
