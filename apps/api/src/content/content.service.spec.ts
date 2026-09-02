import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ContentService } from "./content.service.js";
import type { ContentRepository } from "./content.repository.js";

/**
 * A REPOSITORY HELYETTESÍTVE: a kérdés a DÖNTÉS, nem az adatbázis. Az
 * `moveState` alapból sikert ad, mert a legtöbb állítás azt méri, hogy
 * ELJUTUNK-e odáig.
 */
function serviceWith(
  overrides: Partial<{
    moveState: ContentRepository["moveState"];
    detail: ContentRepository["detail"];
    list: ContentRepository["list"];
    create: ContentRepository["create"];
  }> = {},
) {
  const calls: unknown[] = [];
  const repository = {
    moveState: (async (input: unknown) => {
      calls.push(input);
      return true;
    }) as ContentRepository["moveState"],
    detail: (async () => ({
      id: "c1",
    })) as unknown as ContentRepository["detail"],
    list: (async () => []) as unknown as ContentRepository["list"],
    // A VARRAT KAPJA A VALODI SZERZODES TIPUSAT, nem egy laza alakot: ez az a
    // lepes, amitol a dupla hianya forditasi hiba lesz, nem futasideju.
    create: (async (data: unknown) => {
      calls.push(data);
      return { id: "uj" } as never;
    }) as ContentRepository["create"],
    ...overrides,
  } as unknown as ContentRepository;
  return { service: new ContentService(repository), calls };
}

describe("moving a piece of content", () => {
  it("moves it when the step is allowed", async () => {
    const { service, calls } = serviceWith();

    await service.move({
      id: "c1",
      from: "AWAITING_APPROVAL",
      to: "READY_TO_SEND",
      actorCanApprove: true,
      actorUserId: "user-1",
    });

    assert.equal(calls.length, 1);
  });

  /**
   * A TILTOTT LÉPÉS NEM ÍR SEMMIT, és a második állítás a fontosabb: az őrzőt
   * nem az bizonyítja, hogy szól, hanem hogy nem történt semmi.
   */
  it("refuses a step outside the closed list, and writes nothing", async () => {
    const { service, calls } = serviceWith();

    await assert.rejects(
      () =>
        service.move({
          id: "c1",
          from: "DRAFTING",
          to: "READY_TO_SEND",
          actorCanApprove: false,
          actorUserId: "user-1",
        }),
      /nem megengedett/,
    );
    assert.equal(calls.length, 0);
  });

  /**
   * EZ A LEGFONTOSABB ÁLLÍTÁS EBBEN A SUITE-BAN. Egy ütemezett tétel MÁR A
   * FACEBOOKON áll: ha nálunk elvetnénk anélkül, hogy ott visszavonnánk, a
   * tábla „elvetve"-t mutatna, a poszt pedig kimenne a vevő elé.
   *
   * Amíg a Facebook-oldali visszavonás nincs megépítve, a helyes válasz a
   * VISSZAUTASÍTÁS: egy állapot-átírás azt hazudná, hogy a poszt nem megy ki.
   */
  it("refuses to discard a scheduled piece by rewriting our own state", async () => {
    const { service, calls } = serviceWith();

    await assert.rejects(
      () =>
        service.move({
          id: "c1",
          from: "SCHEDULED",
          to: "DISCARDED",
          discardReason: "meggondoltuk",
          actorCanApprove: false,
          actorUserId: "user-1",
        }),
      /ütemezve áll a Facebookon/,
    );
    assert.equal(calls.length, 0);
  });

  /**
   * A `SENT` A KIVÉTEL: az nem a mi lépésünk, hanem a tudomásulvétele annak,
   * hogy a poszt kiment. Oda nincs mit visszavonni, tehát ez az egyetlen út
   * `SCHEDULED`-ból, ami átmegy.
   */
  it("still records that a scheduled post went out", async () => {
    const { service, calls } = serviceWith();

    await service.move({
      id: "c1",
      from: "SCHEDULED",
      to: "SENT",
      actorCanApprove: false,
      actorUserId: "user-1",
    });

    assert.equal(calls.length, 1);
  });

  /**
   * AZ ELVETÉS OKA KÖTELEZŐ. Ok nélkül az „elvetve" annyit mond, hogy valaki
   * egyszer nemet mondott -- de nem azt, hogy miért, és a következő ember
   * ugyanazt a tételt kezdi újra.
   */
  it("will not discard anything without a reason", async () => {
    const { service, calls } = serviceWith();

    await assert.rejects(
      () =>
        service.move({
          id: "c1",
          from: "DRAFTING",
          to: "DISCARDED",
          actorCanApprove: false,
          actorUserId: "user-1",
        }),
      /oka kötelező/,
    );
    assert.equal(calls.length, 0);
  });

  it("does not accept whitespace as a reason", async () => {
    const { service } = serviceWith();

    await assert.rejects(
      () =>
        service.move({
          id: "c1",
          from: "DRAFTING",
          to: "DISCARDED",
          discardReason: "   ",
          actorCanApprove: false,
          actorUserId: "user-1",
        }),
      /oka kötelező/,
    );
  });

  /**
   * HA A TÉTEL KÖZBEN ELMOZDULT, a hívó ezt MEGTUDJA. A feltételes írás nulla
   * sort módosít, és az nem csendes siker: két ember egyszerre nyithatja meg
   * ugyanazt, és a második döntés nem írhatja felül az elsőt úgy, hogy az első
   * ember továbbra is azt hiszi, az övé áll.
   */
  it("tells the caller when the piece moved underneath them", async () => {
    const { service } = serviceWith({
      moveState: (async () => false) as ContentRepository["moveState"],
    });

    await assert.rejects(
      () =>
        service.move({
          id: "c1",
          from: "AWAITING_APPROVAL",
          to: "READY_TO_SEND",
          actorCanApprove: true,
          actorUserId: "user-1",
        }),
      /időközben más állapotba került/,
    );
  });

  /**
   * AZ ÜTEMEZÉS HORGONYT KAP. Enélkül a „piszkozat gyújtózsinórral" szabálynak
   * nincs mihez mérnie a 25 napot, és az ütemezett poszt határidő nélkül állna
   * -- vagyis a semmittevés megint kitenné a posztot.
   */
  /**
   * ===================================================================
   * A JÓVÁHAGYÁSI KAPU. Ez a négy állítás azt méri, ami korábban SEHOL nem volt
   * mérve, és ezért csendben nyitva állt.
   * ===================================================================
   *
   * A RÉS, AMIT BEZÁRNAK: a jog korábban kizárólag a végpont választásán múlt
   * (`/move` `content.manage`, `/approve-move` `content.approve`), miközben
   * MINDKETTŐ ezt az egy metódust hívta, és a célállapot bármi lehetett. Egy
   * `content.manage` jogú szerkesztő tehát a `/move` úton kiadhatta a
   * jóváhagyást is.
   */
  it("refuses an approving step from a caller who cannot approve, and writes nothing", async () => {
    const { service, calls } = serviceWith();

    await assert.rejects(
      () =>
        service.move({
          id: "c1",
          from: "AWAITING_APPROVAL",
          to: "READY_TO_SEND",
          actorCanApprove: false,
          actorUserId: "user-1",
        }),
      /jóváhagyói jog/,
    );
    // AZ ŐRZŐT NEM AZ BIZONYÍTJA, HOGY SZÓL, HANEM HOGY NEM TÖRTÉNT SEMMI.
    assert.equal(calls.length, 0);
  });

  /**
   * AZ ELUTASÍTÁS IS JÓVÁHAGYÓI DÖNTÉS, és ez a lépés SAJÁT döntés volt, nem
   * levezetés: az indoka a `content-state.ts` `requiresApproval` fejlécében áll.
   *
   * Röviden: az `AWAITING_APPROVAL` a jóváhagyóra vár, tehát aki nem ő, annak
   * nincs dolga a tétellel. Ha a visszaküldés `content.manage` joggal menne, egy
   * szerkesztő KIVEHETNÉ a saját tételét a jóváhagyói sorból -- nem küldené ki,
   * de a jóváhagyó soha nem látná, és ez a fajta hiba néma.
   */
  it("treats sending it back for revision as an approving step too", async () => {
    const { service, calls } = serviceWith();

    await assert.rejects(
      () =>
        service.move({
          id: "c1",
          from: "AWAITING_APPROVAL",
          to: "AWAITING_REVISION",
          actorCanApprove: false,
          actorUserId: "user-1",
        }),
      /jóváhagyói jog/,
    );
    assert.equal(calls.length, 0);
  });

  /**
   * A BEMENET ITT SZÁNDÉKOSAN TELJES: az elvetés oka KI VAN TÖLTVE.
   *
   * Ok nélkül ez az állítás akkor is piros lenne, ha a jogot senki nem
   * ellenőrizné -- csak épp egy MÁSIK hibaüzenettel, és a teszt neve hazudna.
   * Egy állítás kalibrációjához olyan bemenet kell, ahol minden EGYÉB feltétel
   * teljesül, és csak az áll fenn, amit mérni akarunk.
   */
  it("refuses even a well-formed discard from an approval-waiting state", async () => {
    const { service, calls } = serviceWith();

    await assert.rejects(
      () =>
        service.move({
          id: "c1",
          from: "AWAITING_APPROVAL",
          to: "DISCARDED",
          discardReason: "a kampány elmarad",
          actorCanApprove: false,
          actorUserId: "user-1",
        }),
      /jóváhagyói jog/,
    );
    assert.equal(calls.length, 0);
  });

  /**
   * ÉS A MÁSIK IRÁNY, KÜLÖNBEN A JAVÍTÁS TÚL SOKAT ZÁRNA BE: ugyanaz a lépés
   * jóváhagyói joggal ÁTMEGY. E nélkül az állítás nélkül a három fenti zöld
   * maradna akkor is, ha a kapu MINDENKIT elutasít.
   */
  it("lets an approver send it back for revision", async () => {
    const { service, calls } = serviceWith();

    await service.move({
      id: "c1",
      from: "AWAITING_APPROVAL",
      to: "AWAITING_REVISION",
      // A FELVETÉS ITT IS KÖTELEZŐ, és ez a bemenet azért változott: a
      // visszaküldés indoka azóta minden útra érvényes, nem csak a lektoréra.
      // A jóváhagyói visszaküldésnél a legfontosabb -- a szerző abból tudja meg,
      // mit vár tőle az, aki nemet mondott.
      revisionNote: "a záró bekezdés ígér valamit, amit nem tartunk",
      actorCanApprove: true,
      actorUserId: "user-1",
    });

    assert.equal(calls.length, 1);
  });

  it("anchors the fuse when a piece is scheduled", async () => {
    const { service, calls } = serviceWith();

    await service.move({
      id: "c1",
      from: "READY_TO_SEND",
      to: "SCHEDULED",
      actorCanApprove: false,
      actorUserId: "user-1",
    });

    const call = calls[0] as { scheduleAnchoredAt?: Date; scheduledFor?: Date };
    assert.ok(call.scheduleAnchoredAt instanceof Date);
    assert.ok(call.scheduledFor instanceof Date);
  });
});

describe("what the list hands to the screen", () => {
  /**
   * A SOR MAGA MONDJA MEG, MIT LEHET BELŐLE LÉPNI.
   *
   * E nélkül a felületnek le kellene másolnia az átmenetek tábláját, és akkor
   * ugyanaz a szabály két helyen állna. A második egy nap csendben elavulna --
   * és a különbség egy olyan gombban jelenne meg, ami elutasításba fut.
   */
  it("puts the possible steps on every row", async () => {
    const { service } = serviceWith({
      list: (async () => [
        { id: "c1", state: "AWAITING_APPROVAL" },
        { id: "c2", state: "SENT" },
      ]) as unknown as ContentRepository["list"],
    });

    const rows = await service.waitingForMe("approver", "user-1");

    // A JÓVÁHAGYÁSRA VÁRÓ SORNAK VAN LÉPÉSE, ÉS MIND JÓVÁHAGYÓI.
    assert.ok(rows[0]!.moves.length > 0);
    assert.ok(rows[0]!.moves.every((move) => move.requiresApproval));

    // A KIKÜLDÖTTNEK EGY SINCS. Ez a két állítás EGYÜTT mér: ha a mező mindig
    // üres lenne, az első pirosodna; ha mindig tele, a második.
    assert.deepEqual(rows[1]!.moves, []);
  });

  /**
   * A KÉPRE VÁRÓ LISTA UGYANÚGY KAPJA MEG. Külön végpont, külön hívás -- és egy
   * kimaradt sor pont ott venné el a cselekvést, ahol a leghosszabb ideje áll
   * valami.
   */
  it("puts them on the image queue too", async () => {
    const { service } = serviceWith({
      list: (async () => [
        { id: "c1", state: "AWAITING_APPROVAL" },
      ]) as unknown as ContentRepository["list"],
    });

    const rows = await service.waitingForImage();

    assert.ok(rows[0]!.moves.length > 0);
  });
});

describe("sending a piece back for revision", () => {
  /**
   * A FELVETÉS KÖTELEZŐ, UGYANÚGY, MINT AZ ELVETÉS OKA.
   *
   * A meglévő szabályunk szó szerint ez volt: „Ok nélkül az elvetve annyit mond,
   * hogy valaki egyszer nemet mondott -- de nem azt, hogy MIÉRT, és a következő
   * ember ugyanazt a tételt fogja újra elkezdeni." Ez betűre áll a
   * visszaküldésre is: a szerzőnél álló tétel mellett ott kell lennie, mit kell
   * javítani, különben a szerző vagy találgat, vagy visszakérdez.
   *
   * MIÉRT KÖTELEZŐ, ÉS NEM CSAK LEHETSÉGES: ha választható lenne, pont a sietős
   * körökben maradna el -- vagyis pont akkor, amikor a legtöbbet számítana.
   */
  it("will not send it back without saying what to fix", async () => {
    const { service, calls } = serviceWith();

    await assert.rejects(
      () =>
        service.move({
          id: "c1",
          from: "AWAITING_REVIEW",
          to: "AWAITING_REVISION",
          actorCanApprove: false,
          actorUserId: "user-1",
        }),
      /mit kell javítani/,
    );
    // AZ ŐRZŐT NEM AZ BIZONYÍTJA, HOGY SZÓL, HANEM HOGY NEM TÖRTÉNT SEMMI.
    // Egy kötelező mező, ami szól, de közben léptet, rosszabb a semminél.
    assert.equal(calls.length, 0);
  });

  it("does not accept whitespace as the note either", async () => {
    const { service, calls } = serviceWith();

    await assert.rejects(
      () =>
        service.move({
          id: "c1",
          from: "AWAITING_REVIEW",
          to: "AWAITING_REVISION",
          revisionNote: "   ",
          actorCanApprove: false,
          actorUserId: "user-1",
        }),
      /mit kell javítani/,
    );
    assert.equal(calls.length, 0);
  });

  /**
   * ÉS A MÁSIK IRÁNY: felvetéssel a lépés ÁTMEGY, és a felvetés a lépéssel
   * EGYÜTT megy le a tárolóba. E nélkül a fenti két állítás attól is zöld
   * maradna, hogy a visszaküldés SOHA nem sikerül.
   */
  it("sends it back with the note, in the same call", async () => {
    const { service, calls } = serviceWith();

    await service.move({
      id: "c1",
      from: "AWAITING_REVIEW",
      to: "AWAITING_REVISION",
      revisionNote: "  a második bekezdés két állítást kever  ",
      actorCanApprove: false,
      actorUserId: "user-7",
    });

    assert.equal(calls.length, 1);
    const call = calls[0] as {
      note?: { authorId: string; body: string };
    };
    assert.deepEqual(call.note, {
      authorId: "user-7",
      // A KÖRÜLÖTTE ÁLLÓ SZÓKÖZ LEVÁGVA: ugyanaz a kezelés, mint az elvetés
      // okánál, különben egy szóközökből álló felvetés átcsúszna.
      body: "a második bekezdés két állítást kever",
    });
  });

  /**
   * ÉS A TÖBBI LÉPÉS NEM KÉR FELVETÉST. Enélkül a javítás túl sokat zárna be: a
   * jóváhagyás, az ütemezés és a lektorálásra adás ugyanúgy megy tovább.
   */
  it("asks for nothing extra on the other steps", async () => {
    const { service, calls } = serviceWith();

    await service.move({
      id: "c1",
      from: "DRAFTING",
      to: "AWAITING_REVIEW",
      actorCanApprove: false,
      actorUserId: "user-1",
    });

    assert.equal(calls.length, 1);
    assert.equal((calls[0] as { note?: unknown }).note, undefined);
  });
});

describe("the one view that answers what waits on me", () => {
  /**
   * A HÁROM RÉSZ EGY LEKÉRDEZÉSBE MEGY, `OR`-ral. Három külön hívás
   * összefűzésénél a rendezés csak a részeken belül lenne igaz, és a
   * legrégebbi tétel a második lista tetején állna -- ebben a nézetben pedig a
   * sorrend hordozza a sürgősséget.
   */
  it("asks for all three parts at once, and narrows only my own work", async () => {
    let where: unknown;
    const { service } = serviceWith({
      list: (async (input: unknown) => {
        where = input;
        return [];
      }) as unknown as ContentRepository["list"],
    });

    await service.waitingOnMe({ userId: "user-1", canApprove: true });

    const clauses = (where as { OR: Record<string, unknown>[] }).OR;
    assert.equal(clauses.length, 3);
    assert.equal(clauses[0]!.authorId, "user-1");
    assert.equal(clauses[1]!.reviewerId, "user-1");
    // A JÓVÁHAGYÓI RÉSZ NEM SZŰKÜL SENKIRE: se szerző, se lektor szerint.
    assert.equal(clauses[2]!.authorId, undefined);
    assert.equal(clauses[2]!.reviewerId, undefined);
  });

  /**
   * ÉS JOG NÉLKÜL A HARMADIK RÉSZ EL SEM INDUL. E nélkül az előző állítás attól
   * is zöld maradna, hogy a jóváhagyói rész MINDIG bekerül.
   */
  it("leaves the approval part out when the caller cannot approve", async () => {
    let where: unknown;
    const { service } = serviceWith({
      list: (async (input: unknown) => {
        where = input;
        return [];
      }) as unknown as ContentRepository["list"],
    });

    await service.waitingOnMe({ userId: "user-1", canApprove: false });

    assert.equal((where as { OR: unknown[] }).OR.length, 2);
  });

  /**
   * A VÁLASZ MEGNEVEZI, MIT NEM FED LE. Ugyanaz az elv, mint a
   * dokumentum-tároló állapotánál: a válasz mondja meg, miről nem tud
   * nyilatkozni -- különben a hiányzó negyed nem létezőnek látszik.
   */
  it("says out loud which quarter it does not cover", async () => {
    const { service } = serviceWith();

    const reported = await service.waitingOnMe({
      userId: "user-1",
      canApprove: true,
    });

    assert.deepEqual(
      reported.notCovered.map((entry) => entry.role),
      ["sender"],
    );
  });

  /**
   * ÉS A SOROK ITT IS MEGKAPJÁK A LÉPÉSEIKET. Egy nézet, ami megmondja, mi vár
   * rám, de nem enged lépni, épp a felénél áll meg.
   */
  it("hands the same steps to this view as to the others", async () => {
    const { service } = serviceWith({
      list: (async () => [
        { id: "c1", state: "AWAITING_APPROVAL" },
      ]) as unknown as ContentRepository["list"],
    });

    const reported = await service.waitingOnMe({
      userId: "user-1",
      canApprove: true,
    });

    assert.ok(reported.items[0]!.moves.length > 0);
  });
});

describe("putting a new piece into the queue", () => {
  it("starts it in DRAFTING, not in the schema's IDEA default", async () => {
    // EZ A LENYEG, ES NEM STILUS. Az IDEA a STATES_BY_ROLE tablazat egyik
    // szerepenel sem szerepel, es a modulnak nincs "minden tetel" listaja --
    // egy IDEA allapotu tetel tehat senki listajaban nem jelenne meg. A
    // letrehozas pontosan azt a panaszt termelne ujra, amiert keszult.
    const { service, calls } = serviceWith();

    await service.create({
      title: "Uj poszt",
      channel: "FACEBOOK_POST",
      authorId: "u1",
    });

    const data = calls[0] as { state: string; authorId: string };
    assert.equal(data.state, "DRAFTING");
    assert.notEqual(data.state, "IDEA");
  });

  it("makes the caller the author, so it lands on their own list", async () => {
    const { service, calls } = serviceWith();

    await service.create({
      title: "Uj poszt",
      channel: "ARTICLE",
      authorId: "u42",
    });

    assert.equal((calls[0] as { authorId: string }).authorId, "u42");
  });

  it("trims the title and refuses one that is only whitespace", async () => {
    const { service, calls } = serviceWith();

    await service.create({
      title: "  Kozeppontban a korall  ",
      channel: "ARTICLE",
      authorId: "u1",
    });
    assert.equal(
      (calls[0] as { title: string }).title,
      "Kozeppontban a korall",
    );

    await assert.rejects(
      () =>
        service.create({ title: "   ", channel: "ARTICLE", authorId: "u1" }),
      /cim nem lehet ures/,
    );
  });

  it("leaves an absent optional field OUT, rather than writing undefined", async () => {
    // Egy `body: undefined` a Prisma fele nem ugyanaz, mint a mezo hianya: az
    // elso ertelmezese a hivo verzojatol fugg, a masodik egyertelmu.
    const { service, calls } = serviceWith();

    await service.create({
      title: "Uj poszt",
      channel: "OTHER",
      authorId: "u1",
    });

    const data = calls[0] as Record<string, unknown>;
    assert.equal("body" in data, false);
    assert.equal("plannedFor" in data, false);
    assert.equal("imageRequired" in data, false);
  });

  it("passes the optional fields through when they are given", async () => {
    const { service, calls } = serviceWith();

    await service.create({
      title: "Uj poszt",
      channel: "FACEBOOK_AD",
      authorId: "u1",
      body: "  torzs  ",
      imageRequired: true,
      plannedFor: "2026-09-10T08:00:00.000Z",
    });

    const data = calls[0] as {
      body: string;
      imageRequired: boolean;
      plannedFor: Date;
    };
    assert.equal(data.body, "torzs");
    assert.equal(data.imageRequired, true);
    assert.ok(data.plannedFor instanceof Date);
    assert.equal(data.plannedFor.toISOString(), "2026-09-10T08:00:00.000Z");
  });
});

describe("an idea, and where it can be found", () => {
  it("is created in IDEA, which is a different thing from a draft", async () => {
    const { service, calls } = serviceWith();

    await service.createIdea({
      title: "Korall-sorozat",
      channel: "ARTICLE",
      authorId: "u1",
    });

    const data = calls[0] as { state: string };
    assert.equal(data.state, "IDEA");
  });

  it("keeps the two entry points apart, so neither can be reached by a parameter", async () => {
    // A KULONBSEG A LEPES NEVEBEN VAN, nem egy mezoben. Ha egy `state`
    // parameter dontene, a jovahagyasi kapu egy kenyelmes ertekkel
    // megkerulheto lenne.
    const { service, calls } = serviceWith();

    await service.create({
      title: "Vazlat",
      channel: "ARTICLE",
      authorId: "u1",
    });
    await service.createIdea({
      title: "Otlet",
      channel: "ARTICLE",
      authorId: "u1",
    });

    assert.equal((calls[0] as { state: string }).state, "DRAFTING");
    assert.equal((calls[1] as { state: string }).state, "IDEA");
  });

  it("lists exactly the ideas, and nothing else", async () => {
    const seen: unknown[] = [];
    const { service } = serviceWith({
      list: (async (where: unknown) => {
        seen.push(where);
        return [];
      }) as unknown as ContentRepository["list"],
    });

    await service.ideas();

    assert.deepEqual(seen[0], { state: "IDEA" });
  });
});
