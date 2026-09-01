/**
 * A TARTALOM ÚTJA: kilenc állapot, és mindegyik mellett az, hogy KIRE VÁR.
 *
 * MIÉRT A „KIRE VÁR" A LÉNYEG, ÉS NEM AZ ÁLLAPOT NEVE: a panasz, amiből ez a
 * felület készül, nem a jóváhagyásról szólt, hanem arról, hogy sem Balázs, sem
 * Luca nem látja, mi vár rájuk. Egy állapot, ami nem mondja meg, kinek kell
 * lépnie, ugyanaz a lista, ami ma három helyen áll és egyik sem frissül.
 *
 * A KÉP NEM ÁLLAPOT, HANEM FELTÉTEL, és ez a modell legfontosabb döntése.
 * Ha a „képre vár" állapot lenne, a fotóra váró darabok ott állnának -- és
 * ELVESZNE az az információ, hogy a szövegük már jóvá van hagyva. Egy
 * állapotgép, ami két független feltételt egy tengelyre húz, mindig az egyiket
 * felejti el. Az állapot a SZÖVEG útja; a kép külön feltétel, és a „mi vár
 * Lucára képért" ezért szűrés, nem állapot.
 *
 * ===================================================================
 * A SZÁM, AMI EZT A DÖNTÉST INDOKOLJA -- ÉS AMI KISEBB, MINT HITTÜK
 * ===================================================================
 *
 * **NÉGY kész szövegű poszt vár fotóra, 2026-08-18 óta (kb. két hét).**
 * Visszamérve 2026-09-01 16:20-kor, korall listájából. Ez a lap és a felület
 * több kommentje eredetileg HATOT mondott: a hatos szám a délelőtti
 * összefoglalóból jött, és egész délután ellenőrzés nélkül ismétlődött.
 *
 * A hatból kettő nem tartozik ide: **egy jogi döntésen áll** (volt-e pipa a
 * hírlevélhez), nem fotón, **egynek pedig vázlata sincs** -- az Luca
 * témadöntésére vár, tehát ötlet.
 *
 * **MI VÁLTOZIK EZZEL, ÉS MI NEM.** A modell NÉGY döntése áll a négyes számmal
 * is, csak GYENGÉBB indokkal:
 *
 *   1. a kép feltétel, nem állapot
 *   2. a képre váró lista KÜLÖN áll, és a szerep-szűrő nem rejtheti el
 *   3. a szekció a lista TETEJÉN van
 *   4. a kor-címke, és hogy a „régóta" szó csak akkor áll ott, ha igaz
 *
 * Négy tétel, két hete állva, ugyanaz a fajta baj, csak kisebb.
 *
 * **HOL A HATÁRUK, és ez a lényeg:** ha egyszer csak EGY tétel áll, és az is
 * egy napja, akkor ezek a döntések felülvizsgálatot kívánnak -- a külön lista,
 * a kiemelt hely és a figyelmeztető szín akkor többet ígér, mint amennyit a
 * helyzet ér. A számot tehát nem azért írjuk ide, hogy igazoljon, hanem hogy a
 * következő olvasó tudja, MIKOR nem igazol többé.
 */
export type ContentState =
  | "IDEA"
  | "DRAFTING"
  | "AWAITING_REVIEW"
  | "AWAITING_REVISION"
  | "AWAITING_APPROVAL"
  | "READY_TO_SEND"
  | "SCHEDULED"
  | "SENT"
  | "DISCARDED";

/**
 * KI AZ, AKIRE EGY TÉTEL VÁR.
 *
 * A `nobody` nem ugyanaz, mint a „kész": az ötlet is senkire vár, és a kiküldött
 * is. A különbséget az állapot mondja meg, ez a mező azt, hogy kell-e valakinek
 * MOST lépnie.
 */
export type ContentWaitsOn =
  | { on: "nobody" }
  | { on: "author" }
  | { on: "reviewer" }
  | { on: "approver" }
  | { on: "sender" }
  | { on: "schedule" };

export interface ContentItemState {
  state: ContentState;
  /** Kell-e kép ehhez a tételhez. A szövegtől FÜGGETLEN feltétel. */
  imageRequired: boolean;
  /** Megvan-e a kép. */
  imageAttached: boolean;
}

/**
 * MI HIÁNYZIK EGY TÉTELHEZ, AZ ÁLLAPOTÁN FELÜL.
 *
 * A kép külön szerepel, mert egy tétel egyszerre lehet jóváhagyott szövegű ÉS
 * képre váró. A hívó ezt a két adatot EGYÜTT mutatja, nem összevonva.
 */
export interface ContentBlockers {
  waitsOn: ContentWaitsOn;
  /** Igaz, ha a kép hiányzik és kell. A szöveg állapotától független. */
  waitsForImage: boolean;
}

const WAITS_ON: Record<ContentState, ContentWaitsOn["on"]> = {
  IDEA: "nobody",
  DRAFTING: "author",
  AWAITING_REVIEW: "reviewer",
  AWAITING_REVISION: "author",
  AWAITING_APPROVAL: "approver",
  READY_TO_SEND: "sender",
  SCHEDULED: "schedule",
  SENT: "nobody",
  DISCARDED: "nobody",
};

export function contentBlockers(item: ContentItemState): ContentBlockers {
  return {
    waitsOn: { on: WAITS_ON[item.state] },
    // A KÉP AKKOR IS HIÁNYOZHAT, HA A SZÖVEG KÉSZ, és akkor is megvan, ha a
    // szöveg még vázlat. A két kérdés nem metszi egymást, és a lista mindkettőt
    // mutatja.
    waitsForImage: item.imageRequired && !item.imageAttached,
  };
}

/**
 * AZ ÁTMENETEK. Ami itt nincs felsorolva, az nem megengedett.
 *
 * MIÉRT ZÁRT LISTA, ÉS NEM SZABAD MOZGÁS: a jóváhagyás kapu, nem címke. Balázs
 * szabálya szó szerint az, hogy egyelőre semmi nem mehet ki nélküle vagy Luca
 * nélkül; egy szabadon állítható állapotmező ezt a kaput az első kényelmes
 * pillanatban megkerülné.
 *
 * A VISSZAKÖR SZÁNDÉKOSAN ISMÉTELHETŐ: a lektorálás és a javítás között egy
 * tétel akárhányszor oda-vissza mehet. A mai menet mérése szerint ez egy
 * tételen háromszor is megtörténik, és egy egyirányú modell ezt hazugsággá
 * tenné.
 *
 * AZ ELVETÉS BÁRHONNAN ELÉRHETŐ, kivéve a már kiküldöttet: amit egyszer láttak,
 * azt nem lehet meg nem történtté tenni. Egy `SENT -> DISCARDED` átmenet épp azt
 * az egy tényt törölné, amit a legdrágább volt visszaszerezni.
 */
const TRANSITIONS: Record<ContentState, readonly ContentState[]> = {
  IDEA: ["DRAFTING", "DISCARDED"],
  DRAFTING: ["AWAITING_REVIEW", "DISCARDED"],
  AWAITING_REVIEW: ["AWAITING_REVISION", "AWAITING_APPROVAL", "DISCARDED"],
  AWAITING_REVISION: ["AWAITING_REVIEW", "DISCARDED"],
  AWAITING_APPROVAL: ["AWAITING_REVISION", "READY_TO_SEND", "DISCARDED"],
  READY_TO_SEND: ["SCHEDULED", "SENT", "AWAITING_REVISION", "DISCARDED"],
  // AZ ÜTEMEZÉS VISSZAVONHATÓ, amíg a poszt nem ment ki: a `SCHEDULED ->
  // READY_TO_SEND` az az út, amin egy ütemezett tétel visszakerül a sorba,
  // mielőtt a lejárata törölné.
  SCHEDULED: ["SENT", "READY_TO_SEND", "DISCARDED"],
  SENT: [],
  DISCARDED: ["DRAFTING"],
};

export function canMove(from: ContentState, to: ContentState): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * EGY ÜTEMEZETT TÉTEL NEM NÁLUNK VÁR, HANEM MÁR A FACEBOOKON ÁLL.
 *
 * Ez a modell legveszélyesebb pontja, és nem a mi táblánkon látszik. Ha valaki
 * a felületen elvet egy `SCHEDULED` tételt, a mi oldalunk „elvetve" állapotot
 * mutat -- a Facebook viszont a megadott napon KI FOGJA TENNI. A tábla
 * megnyugtat, a poszt megjelenik a vevő előtt, jóváhagyás nélkül.
 *
 * UGYANEZ ÁLL A SAJÁT SZABÁLYUNKRA: a 25. napi törlés nem nálunk állapotváltás,
 * hanem törlés a Facebookon. Ha a kettő elválik, a „piszkozat gyújtózsinórral"
 * épp a gyújtózsinórt veszti el.
 *
 * EZÉRT NEM `boolean` A VÁLASZ, HANEM EGY ELÁGAZÓ TÍPUS. A hívó nem tudja
 * „csak átírni az állapotot": a `needs-external` ágat kezelnie KELL, különben
 * a fordító szól. Egy megjegyzés ugyanezt csak kérné.
 */
export type ExternalWork = {
  /** Mit kell a külső felületen elvégezni, MIELŐTT az állapot átíródik. */
  action: "cancel-scheduled-post";
  /** Ember által olvasható indok, ami a naplóba és a hibaüzenetbe is mehet. */
  reason: string;
};

export type PlannedTransition =
  | { kind: "refused"; from: ContentState; to: ContentState }
  | { kind: "internal"; to: ContentState }
  | { kind: "needs-external"; to: ContentState; external: ExternalWork };

/**
 * MIT KÍVÁN EGY ÁTMENET, az engedélyezettségén felül.
 *
 * A `SCHEDULED`-ból KIFELÉ vezető minden út külső munkával jár, kivéve a
 * `SENT`-et: az nem a mi lépésünk, hanem annak a TUDOMÁSULVÉTELE, hogy a poszt
 * kiment. Oda nincs mit visszavonni.
 *
 * AMIT EZ A FÜGGVÉNY NEM CSINÁL, ÉS SZÁNDÉKOSAN: nem hajtja végre a külső
 * munkát. Az írás a Facebook felé külön döntés, és Balázs mai szabálya alatt
 * áll. Ez a típus csak annyit mond ki, hogy egy állapot-átírás ÖNMAGÁBAN nem
 * elegendő -- és épp ez az az állítás, ami ma sehol nem szerepelt.
 */
export function planTransition(
  from: ContentState,
  to: ContentState,
): PlannedTransition {
  if (!canMove(from, to)) return { kind: "refused", from, to };

  if (from === "SCHEDULED" && to !== "SENT") {
    return {
      kind: "needs-external",
      to,
      external: {
        action: "cancel-scheduled-post",
        reason:
          "A poszt ütemezve áll a Facebookon: az ütemezést ott vissza kell vonni, különben a megadott napon kimegy, akkor is, ha nálunk már nem ebben az állapotban van.",
      },
    };
  }

  return { kind: "internal", to };
}

export function allowedMoves(from: ContentState): readonly ContentState[] {
  return TRANSITIONS[from];
}

/**
 * MELYIK LÉPÉS KÍVÁN JÓVÁHAGYÓI JOGOT.
 *
 * A SZABÁLY EGY MONDAT: az `AWAITING_APPROVAL`-ból KIVEZETŐ minden út a
 * jóváhagyó döntése, mert az az állapot kifejezetten RÁ vár (`WAITS_ON`).
 * Ezért nem külön lista ez, hanem a fenti táblából számolt érték: egy második
 * felsorolás egy nap csendben elavulna, és épp a kapunál.
 *
 * MIÉRT AZ ELUTASÍTÁS IS (`AWAITING_APPROVAL -> AWAITING_REVISION`), holott az
 * nem enged ki semmit. Két érv állt szemben, és a döntést a MÉRHETŐ kockázat
 * hozta meg, nem a szimmetria:
 *
 *   AMI MELLETTE SZÓL: az az állapot a jóváhagyóra vár, tehát aki nem ő, annak
 *   nincs dolga a tétellel. Ha az elutasítás `content.manage` joggal menne, egy
 *   szerkesztő KIVEHETNÉ a saját tételét a jóváhagyói sorból -- nem küldené ki,
 *   de a jóváhagyó soha nem látná. Ez a fajta hiba NÉMA: nem történik semmi
 *   rossz, csak nem történik meg a jóváhagyás.
 *
 *   AMI ELLENE SZÓL: az elutasítás visszatart, nem kienged, és Balázs szabálya
 *   a KIMENETELRŐL szól („semmi nem mehet ki nélküle vagy Luca nélkül").
 *
 * A DÖNTÉS AZ ELSŐ MELLETT, mert a két tévedés ára nem egyforma. Ha fölöslegesen
 * kötjük jóváhagyói joghoz, valaki kérni fog egy visszaküldést -- hangos,
 * azonnal kiderül, egy sorral feloldható. Ha fölöslegesen engedjük el, a tétel
 * csendben eltűnik a jóváhagyó listájáról, és senki nem keresi.
 *
 * AMI EZ ALÁ NEM TARTOZIK, ÉS SZÁNDÉKOSAN: a `READY_TO_SEND`-ből kifelé vezető
 * utak (ütemezés, kiküldés). Azok a küldő lépései, a jóváhagyás UTÁN, és a
 * kapu addigra már bezárult mögöttük.
 */
export function requiresApproval(from: ContentState): boolean {
  return WAITS_ON[from] === "approver";
}

/**
 * EGY LÉPÉS, AHOGY A FELÜLET LÁTJA.
 *
 * Mind a három mező a szerver TUDÁSA, nem a felület találgatása: hova lehet
 * lépni, kell-e hozzá jóváhagyói jog, és van-e olyan külső teendő, ami miatt ma
 * nem hajtható végre.
 */
export interface ContentMoveOption {
  to: ContentState;
  /** Jóváhagyói jogot kíván-e (`content.approve`). */
  requiresApproval: boolean;
  /**
   * Ha nem `null`, a lépés ma NEM hajtható végre, és ez az indok -- emberi
   * alakban, mert a felület ezt mutatja meg, mielőtt bárki rákattint.
   */
  blockedByExternalWork: string | null;
  /**
   * EZ AZ A LÉPÉS, AMI A FOLYAMATBAN ELŐRE VISZ. Állapotonként legfeljebb egy.
   *
   * A felület ezt emeli ki, a többit halkítja. A rangsor nem a felületé: ha ott
   * dőlne el, minden képernyő maga találná ki, melyik a kézenfekvő lépés.
   */
  primary: boolean;
  /**
   * HA NEM `null`, EZ A LÉPÉS SZÖVEGET KÍVÁN, és a felület azt kéri be előbb.
   *
   * MIÉRT INNEN JÖN: enélkül a képernyőnek állapotnevekre kellene hivatkoznia
   * (`ha ez elvetés, kérj okot`), és azzal visszakerülne oda egy szabály-másolat,
   * amit ebből a fájlból épp kivettünk. A mező NEVE is itt áll, mert a kérés
   * törzsében ugyanazon a néven megy vissza.
   */
  note: { field: "discardReason" | "revisionNote"; label: string } | null;
}

/**
 * MI A LEHETSÉGES LÉPÉS EGY ÁLLAPOTBÓL, MINDENNEL EGYÜTT, AMIT A HÍVÓNAK TUDNIA
 * KELL.
 *
 * MIÉRT NEM ELÉG AZ `allowedMoves`: az csak a célállapotok neveit adja, és a
 * felület ebből három dolgot NEM tudna meg -- hogy melyik lépéshez kell
 * jóváhagyói jog, hogy melyik fut külső munkába, és hogy mit írjon ki róla. A
 * hiányzó tudást ma a felületnek kellene pótolnia, vagyis lemásolnia; ez a
 * függvény azért van, hogy ne kelljen.
 *
 * AMI EBBŐL A LEGFONTOSABB, ÉS NEM SZÉPSÉGKÉRDÉS: a `blockedByExternalWork`
 * miatt a felület egy `SCHEDULED` tételnél ELŐRE megmondhatja, hogy a lépés ma
 * nem megy. Enélkül felkínálna egy gombot, a szerver elutasítaná, és a
 * felhasználó azt tanulná meg, hogy a gombok néha nem működnek.
 */
/**
 * A FOLYAMAT SORRENDJE, KIZÁRÓLAG AZÉRT, HOGY MEGMONDHASSUK, MELYIK LÉPÉS VISZ
 * ELŐRE.
 *
 * MIÉRT KELL EGYÁLTALÁN: az átmenetek táblája ÉLEKET ír le, nem irányt. Abból,
 * hogy `AWAITING_APPROVAL`-ból a `READY_TO_SEND` és az `AWAITING_REVISION` is
 * megengedett, nem következik, melyik a kézenfekvő -- pedig egy soron, ahol
 * három gomb áll egymás mellett, valamelyiknek ki kell emelkednie.
 *
 * MIÉRT NEM AZ `allowedMoves` SORRENDJÉBŐL: kézenfekvő lenne az első elemet
 * venni, és HAMIS lenne. A táblában két állapotnál (`AWAITING_REVIEW`,
 * `AWAITING_APPROVAL`) épp a VISSZAKÜLDÉS áll elöl. Egy ilyen feltevés némán
 * rossz gombot emelne ki, és semmi nem szólna róla.
 *
 * MI EZ A SZÁM, ÉS MI NEM: a folyamatban elfoglalt hely, semmi más. Az
 * `AWAITING_REVISION` azért áll a lektorálás ELŐTT, mert egy javításra
 * visszaadott tétel újra lektorálásra megy. A `DISCARDED` kívül áll a soron: az
 * elvetés soha nem „előre".
 *
 * A KÉT TÁBLA SZÉTCSÚSZHAT, ÉS EZT MÉRJÜK: a spec állítja, hogy minden
 * állapotnak LEGFELJEBB egy elsődleges lépése van, és hogy ahol van elérhető
 * előrelépés, ott van is egy.
 */
const PROGRESS_ORDER: Record<ContentState, number> = {
  DISCARDED: -1,
  IDEA: 0,
  DRAFTING: 1,
  AWAITING_REVISION: 2,
  AWAITING_REVIEW: 3,
  AWAITING_APPROVAL: 4,
  READY_TO_SEND: 5,
  SCHEDULED: 6,
  SENT: 7,
};

/**
 * MELYIK LÉPÉS KÍVÁN SZÖVEGET, ÉS MILYEN NÉVEN.
 *
 * KETTŐ VAN, ÉS UGYANAZ AZ INDOKUK: mindkettő VISSZATART egy tételt, és aki
 * mellette áll, annak tudnia kell, MIÉRT. „Ok nélkül az elvetve annyit mond,
 * hogy valaki egyszer nemet mondott -- de nem azt, hogy miért, és a következő
 * ember ugyanazt a tételt kezdi újra." Ez a mondat betűre áll a visszaküldésre
 * is, csak sokáig nem alkalmaztuk rá.
 *
 * A MEZŐNÉV AZÉRT VAN ITT, mert a felület ebből tudja, minek nevezze a kérés
 * törzsében -- anélkül, hogy neki magának kellene tudnia, melyik állapot melyik
 * mezőt kívánja.
 */
const NOTE_REQUIRED_FOR: Partial<
  Record<
    ContentState,
    { field: "discardReason" | "revisionNote"; label: string }
  >
> = {
  DISCARDED: { field: "discardReason", label: "Miért vetjük el?" },
  AWAITING_REVISION: {
    field: "revisionNote",
    label: "Mit kell javítani?",
  },
};

export function moveOptions(from: ContentState): readonly ContentMoveOption[] {
  const approvalNeeded = requiresApproval(from);
  const steps = allowedMoves(from).map((to) => {
    const planned = planTransition(from, to);
    return {
      to,
      requiresApproval: approvalNeeded,
      blockedByExternalWork:
        planned.kind === "needs-external" ? planned.external.reason : null,
      note: NOTE_REQUIRED_FOR[to] ?? null,
    };
  });

  // AZ ELSŐDLEGES A LEGKÖZELEBBI ELŐRELÉPÉS, nem a legtávolabbi. A
  // `READY_TO_SEND`-ből a `SENT` áll a legmesszebb, de a kézenfekvő következő
  // lépés az ütemezés -- a kiküldés tudomásulvétele nem az, amit egy ember
  // ilyenkor tenni akar.
  //
  // ÉS EGY BLOKKOLT LÉPÉS SOHA NEM ELSŐDLEGES: egy kiemelt gomb, amit nem lehet
  // megnyomni, rosszabb, mint ha semmi nem lenne kiemelve.
  const here = PROGRESS_ORDER[from];
  const forward = steps
    .filter(
      (step) =>
        step.blockedByExternalWork === null && PROGRESS_ORDER[step.to] > here,
    )
    .sort((a, b) => PROGRESS_ORDER[a.to] - PROGRESS_ORDER[b.to])[0];

  return steps.map((step) => ({ ...step, primary: step === forward }));
}
