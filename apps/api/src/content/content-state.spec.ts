import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  allowedMoves,
  canMove,
  contentBlockers,
  moveOptions,
  planTransition,
  requiresApproval,
  type ContentState,
} from "./content-state.js";

const ALL_STATES: ContentState[] = [
  "IDEA",
  "DRAFTING",
  "AWAITING_REVIEW",
  "AWAITING_REVISION",
  "AWAITING_APPROVAL",
  "READY_TO_SEND",
  "SCHEDULED",
  "SENT",
  "DISCARDED",
];

describe("who a piece of content is waiting on", () => {
  it("names a person for every state that needs one", () => {
    const waiting = ALL_STATES.map(
      (state) =>
        contentBlockers({
          state,
          imageRequired: false,
          imageAttached: false,
        }).waitsOn.on,
    );

    assert.deepEqual(waiting, [
      "nobody",
      "author",
      "reviewer",
      "author",
      "approver",
      "sender",
      "schedule",
      "nobody",
      "nobody",
    ]);
  });

  /**
   * A MODELL LEGFONTOSABB ÁLLÍTÁSA, és a mai fájdalom pontos képe: hat kész
   * szövegű poszt vár kizárólag fotóra.
   *
   * Ha a kép állapot lenne, ez a tétel „képre vár" állapotban állna, és
   * ELVESZNE, hogy a szövege már jóváhagyott. Így mindkettő látszik: a szöveg
   * a kiküldőre vár, a kép Lucára.
   */
  it("keeps an approved text and a missing image as two separate facts", () => {
    const blockers = contentBlockers({
      state: "READY_TO_SEND",
      imageRequired: true,
      imageAttached: false,
    });

    assert.equal(blockers.waitsOn.on, "sender");
    assert.equal(blockers.waitsForImage, true);
  });

  /**
   * EZ AZ AZ ÁLLÍTÁS, AMI A KÉP FÜGGETLENSÉGÉT VALÓBAN MÉRI, és a kalibráció
   * hozta elő: enélkül a suite akkor is zöld maradt, amikor a képet az
   * állapothoz kötöttem (csak `READY_TO_SEND`-nél számít).
   *
   * A többi kép-állítás bemenete MÁS OKBÓL is helyes választ adott: az egyik
   * eleve `READY_TO_SEND`, a másikban a kép megvan, a harmadikban nem is kell.
   * Egyikük sem tudott elbukni azon, hogy a modell az állapothoz kösse a képet.
   *
   * Itt minden más feltétel IGAZ: a kép kell, nincs meg -- és a szöveg még
   * vázlat. Csak az áll fenn, amit mérni akarunk.
   */
  it("waits for an image even while the text is only a draft", () => {
    const blockers = contentBlockers({
      state: "DRAFTING",
      imageRequired: true,
      imageAttached: false,
    });

    assert.equal(blockers.waitsOn.on, "author");
    assert.equal(blockers.waitsForImage, true);
  });

  it("does not claim a missing image when none is needed", () => {
    const blockers = contentBlockers({
      state: "DRAFTING",
      imageRequired: false,
      imageAttached: false,
    });

    assert.equal(blockers.waitsForImage, false);
  });

  /**
   * A KÉP MEGLEHET, MIELŐTT A SZÖVEG ELKÉSZÜL. A két feltétel nem metszi
   * egymást, és ez az irány is mérendő: ha az implementáció a képet az
   * állapothoz kötné, ez az eset pirosodna.
   */
  it("allows an image on a piece whose text is still a draft", () => {
    const blockers = contentBlockers({
      state: "DRAFTING",
      imageRequired: true,
      imageAttached: true,
    });

    assert.equal(blockers.waitsOn.on, "author");
    assert.equal(blockers.waitsForImage, false);
  });
});

describe("how a piece of content may move", () => {
  /**
   * A JÓVÁHAGYÁS KAPU, NEM CÍMKE. Balázs szabálya szó szerint az, hogy egyelőre
   * semmi nem mehet ki nélküle vagy Luca nélkül. Ez az állítás azt méri, hogy a
   * kaput NEM lehet megkerülni: vázlatból nem lehet kiküldésre készt csinálni.
   */
  it("has no path from a draft straight to ready", () => {
    assert.equal(canMove("DRAFTING", "READY_TO_SEND"), false);
    assert.equal(canMove("DRAFTING", "SCHEDULED"), false);
    assert.equal(canMove("DRAFTING", "SENT"), false);
  });

  it("only reaches ready through approval", () => {
    assert.equal(canMove("AWAITING_APPROVAL", "READY_TO_SEND"), true);
    assert.equal(canMove("AWAITING_REVIEW", "READY_TO_SEND"), false);
  });

  /**
   * A VISSZAKÖR ISMÉTELHETŐ. A mai menet mérése szerint egy tételen háromszor is
   * megtörténik, hogy visszakerül javításra, és egy egyirányú modell ezt
   * hazugsággá tenné.
   */
  it("lets review and revision bounce back and forth", () => {
    assert.equal(canMove("AWAITING_REVIEW", "AWAITING_REVISION"), true);
    assert.equal(canMove("AWAITING_REVISION", "AWAITING_REVIEW"), true);
  });

  it("lets an approver send it back for revision", () => {
    assert.equal(canMove("AWAITING_APPROVAL", "AWAITING_REVISION"), true);
  });

  /**
   * AMIT EGYSZER LÁTTAK, AZ NEM LESZ MEG NEM TÖRTÉNT. Egy `SENT -> DISCARDED`
   * átmenet épp azt az egy tényt törölné, amit a legdrágább volt megszerezni --
   * a kiküldés tényét, ami ma egyáltalán nem jut vissza magától.
   */
  it("never moves anything out of sent", () => {
    assert.deepEqual(allowedMoves("SENT"), []);
    for (const state of ALL_STATES) {
      assert.equal(canMove("SENT", state), false);
    }
  });

  /**
   * AZ ÜTEMEZÉS VISSZAVONHATÓ, amíg a poszt nem ment ki. Ez az az út, amin egy
   * ütemezett tétel visszakerül a sorba, mielőtt a lejárata törölné.
   */
  it("can pull a scheduled piece back into the queue", () => {
    assert.equal(canMove("SCHEDULED", "READY_TO_SEND"), true);
  });

  it("can discard from anywhere except sent", () => {
    for (const state of ALL_STATES) {
      if (state === "SENT" || state === "DISCARDED") continue;
      assert.equal(
        canMove(state, "DISCARDED"),
        true,
        `${state} -> DISCARDED legyen megengedett`,
      );
    }
  });

  /**
   * EGY ELVETETT TÉTEL ÚJRAINDÍTHATÓ, de csak a vázlat felé: az elvetés nem
   * megsemmisítés, viszont a jóváhagyás nem öröklődik át rajta.
   */
  it("restarts a discarded piece as a draft, not further along", () => {
    assert.deepEqual(allowedMoves("DISCARDED"), ["DRAFTING"]);
  });
});

describe("what a transition costs outside our own table", () => {
  /**
   * EZ A MODELL LEGVESZÉLYESEBB PONTJA, és nem a mi táblánkon látszik: egy
   * ütemezett tétel MÁR A FACEBOOKON áll. Ha valaki elveti nálunk, a tábla
   * „elvetve"-t mutat, a poszt pedig a megadott napon kimegy a vevő elé.
   */
  it("says that leaving SCHEDULED needs work outside our table", () => {
    const planned = planTransition("SCHEDULED", "DISCARDED");

    assert.equal(planned.kind, "needs-external");
    if (planned.kind !== "needs-external") return;
    assert.equal(planned.external.action, "cancel-scheduled-post");
  });

  it("says the same for pulling a scheduled piece back into the queue", () => {
    assert.equal(
      planTransition("SCHEDULED", "READY_TO_SEND").kind,
      "needs-external",
    );
  });

  /**
   * A `SENT` A KIVÉTEL, és nem feledékenységből: az nem a mi lépésünk, hanem
   * annak a TUDOMÁSULVÉTELE, hogy a poszt kiment. Oda nincs mit visszavonni.
   *
   * Ez a bemenet az, ami a szabályt MÉRHETŐVÉ teszi: ha a modell egyszerűen
   * minden `SCHEDULED`-ból kifelé vezető utat külsőnek mondana, ez az állítás
   * pirosodna.
   */
  it("needs nothing external when a scheduled post simply went out", () => {
    assert.equal(planTransition("SCHEDULED", "SENT").kind, "internal");
  });

  it("needs nothing external anywhere else", () => {
    assert.equal(
      planTransition("DRAFTING", "AWAITING_REVIEW").kind,
      "internal",
    );
    assert.equal(
      planTransition("AWAITING_APPROVAL", "READY_TO_SEND").kind,
      "internal",
    );
  });

  /**
   * A TILTOTT ÁTMENET NEM „külső munkát kíván", hanem VISSZAUTASÍTOTT. A kettő
   * összemosása azt sugallná, hogy elég elvégezni valamit a Facebookon, és
   * utána mehet -- holott a kapu nem ott van.
   */
  it("refuses a forbidden move instead of pricing it", () => {
    assert.equal(planTransition("SENT", "DISCARDED").kind, "refused");
    assert.equal(planTransition("DRAFTING", "READY_TO_SEND").kind, "refused");
  });
});

describe("which step needs the approver's hand", () => {
  /**
   * A SZABÁLY EGY ÁLLAPOTRA VONATKOZIK, ÉS EZ AZ ÁLLÍTÁS AZT MÉRI, HOGY NEM
   * TÖBBRE. Ha `requiresApproval` egy nap szélesebbre nyílna (mondjuk minden
   * `READY_TO_SEND`-ből kifelé vezető útra), ez pirosodik -- és épp az a baj
   * jönne elő, amit a javítás el akart kerülni: túl sokat zárni be.
   */
  it("asks for it only where the item waits on the approver", () => {
    assert.equal(requiresApproval("AWAITING_APPROVAL"), true);
    for (const state of ALL_STATES) {
      if (state === "AWAITING_APPROVAL") continue;
      assert.equal(
        requiresApproval(state),
        false,
        `${state} ne kívánjon jóváhagyói jogot`,
      );
    }
  });

  /**
   * MINDEN KIVEZETŐ ÚT, NEM CSAK A KIKÜLDÉSRE BOCSÁTÁS. A visszaküldés és az
   * elvetés ugyanúgy a jóváhagyó döntése: az az állapot RÁ vár.
   */
  it("marks every way out of an approval-waiting item", () => {
    const options = moveOptions("AWAITING_APPROVAL");

    assert.ok(options.length > 0, "legyen mit lépni");
    for (const option of options) {
      assert.equal(
        option.requiresApproval,
        true,
        `${option.to} jóváhagyói lépés legyen`,
      );
    }
  });

  it("leaves the ordinary steps alone", () => {
    for (const option of moveOptions("DRAFTING")) {
      assert.equal(option.requiresApproval, false);
    }
  });
});

describe("what the list tells the screen about a step", () => {
  /**
   * A FELÜLET ELŐRE MEGTUDJA, HOGY EGY LÉPÉS MA NEM MEGY. Enélkül felkínálna
   * egy gombot, a szerver elutasítaná, és a felhasználó azt tanulná meg, hogy a
   * gombok néha nem működnek.
   */
  it("says which step runs into work outside our table", () => {
    const options = moveOptions("SCHEDULED");
    const back = options.find((option) => option.to === "READY_TO_SEND");
    const discard = options.find((option) => option.to === "DISCARDED");

    assert.ok(back?.blockedByExternalWork?.includes("Facebookon"));
    assert.ok(discard?.blockedByExternalWork?.includes("Facebookon"));
  });

  /**
   * ÉS A MÁSIK IRÁNY, KÜLÖNBEN AZ ELŐZŐ ÁLLÍTÁS ATTÓL IS ZÖLD LENNE, HA MINDEN
   * LÉPÉST BLOKKOLTNAK MONDANÁNK: a kiküldés tudomásulvétele `SCHEDULED`-ból is
   * szabad út, mert ott nincs mit visszavonni.
   */
  it("leaves the one scheduled step that has nothing to undo", () => {
    const sent = moveOptions("SCHEDULED").find(
      (option) => option.to === "SENT",
    );

    assert.equal(sent?.blockedByExternalWork, null);
  });

  it("offers nothing at all once a piece went out", () => {
    assert.deepEqual(moveOptions("SENT"), []);
  });

  /**
   * A LISTA UGYANAZ, MINT AMIT AZ `allowedMoves` MOND. Két forrás egy nap
   * szétcsúszna, és a felület a rosszabbikat látná.
   */
  it("names the same targets the closed list does", () => {
    for (const state of ALL_STATES) {
      assert.deepEqual(
        moveOptions(state).map((option) => option.to),
        [...allowedMoves(state)],
        `${state} lépései egyezzenek`,
      );
    }
  });
});

describe("which step the screen should put first", () => {
  /**
   * ÁLLAPOTONKÉNT LEGFELJEBB EGY. Ez a `PROGRESS_ORDER` és a `TRANSITIONS`
   * közötti szétcsúszást méri: ha a sorrend egy nap úgy változna, hogy két
   * célállapot azonos helyre kerül, itt derül ki, nem egy képernyőn.
   */
  it("never marks two steps as the one to take", () => {
    for (const state of ALL_STATES) {
      const primaries = moveOptions(state).filter((option) => option.primary);
      assert.ok(
        primaries.length <= 1,
        `${state}: ${primaries.length} elsődleges lépés`,
      );
    }
  });

  /**
   * ÉS AHOL VAN ELÉRHETŐ ELŐRELÉPÉS, OTT VAN IS EGY. E nélkül az előző állítás
   * attól is zöld maradna, hogy SOHA egyetlen lépés sem elsődleges -- vagyis a
   * felületen semmi nem emelkedne ki, és senki nem tudná meg, miért.
   */
  it("names one wherever the piece can still move forward", () => {
    for (const state of ALL_STATES) {
      if (state === "SENT") continue;
      const options = moveOptions(state);
      assert.equal(
        options.filter((option) => option.primary).length,
        1,
        `${state}: nincs elsődleges lépés`,
      );
    }
  });

  /**
   * A KONKRÉT VÁLASZTÁSOK, NÉV SZERINT. Az első kettő azért áll itt, mert a
   * kézenfekvő megoldás -- „legyen az `allowedMoves` első eleme" -- PONT EZEN A
   * KÉT ÁLLAPOTON adna rossz választ: ott a visszaküldés áll elöl.
   */
  it("picks moving on, not sending back", () => {
    const review = moveOptions("AWAITING_REVIEW").find(
      (option) => option.primary,
    );
    const approval = moveOptions("AWAITING_APPROVAL").find(
      (option) => option.primary,
    );

    assert.equal(review?.to, "AWAITING_APPROVAL");
    assert.equal(approval?.to, "READY_TO_SEND");
  });

  /**
   * A LEGKÖZELEBBI ELŐRELÉPÉS, NEM A LEGTÁVOLABBI. `READY_TO_SEND`-ből a `SENT`
   * áll a sor végén, de amit egy ember ilyenkor tenni akar, az az ütemezés.
   */
  it("takes the next step, not the last one", () => {
    const next = moveOptions("READY_TO_SEND").find((option) => option.primary);

    assert.equal(next?.to, "SCHEDULED");
  });

  /**
   * EGY BLOKKOLT LÉPÉS SOHA NEM ELSŐDLEGES. `SCHEDULED`-ból a visszavonás külső
   * munkát kíván, tehát nem indítható -- egy kiemelt gomb, amit nem lehet
   * megnyomni, rosszabb, mint ha semmi nem lenne kiemelve.
   */
  it("never highlights a step that cannot run today", () => {
    for (const state of ALL_STATES) {
      for (const option of moveOptions(state)) {
        if (option.blockedByExternalWork === null) continue;
        assert.equal(
          option.primary,
          false,
          `${state} -> ${option.to} blokkolt, mégis elsődleges`,
        );
      }
    }
    // ÉS A KONTROLL: van egyáltalán blokkolt lépés, amin ez mérhető. E nélkül a
    // fenti ciklus üresen is zöld lenne.
    assert.ok(
      moveOptions("SCHEDULED").some(
        (option) => option.blockedByExternalWork !== null,
      ),
      "nincs blokkolt lépés, amin az állítás mérhető lenne",
    );
  });

  /**
   * AZ ELVETÉS SOHA NEM ELŐRE. A `DISCARDED` kívül áll a folyamat sorrendjén, és
   * ez nem stílus: egy kiemelt „elvetve" gomb minden soron azt sugallná, hogy ez
   * a kézenfekvő teendő.
   */
  it("never suggests discarding as the way forward", () => {
    for (const state of ALL_STATES) {
      const discard = moveOptions(state).find(
        (option) => option.to === "DISCARDED",
      );
      if (discard) assert.equal(discard.primary, false, `${state}`);
    }
  });
});

/**
 * AHOL EGY TETEL KELETKEZHET, ONNAN TOVABB IS KELL TUDNI LEPNI.
 *
 * A LETREHOZAS NEM ATMENET: a tarolo kozvetlenul ir, tehat a `canMove` tablazat
 * nem all utban egy kezdoallapotnak. Epp ezert a kezdoallapot MEGVALASZTASA a
 * hivo felelossege, es semmi nem szol, ha olyat valaszt, amibol nincs kiut.
 *
 * HAROM BEJARAT LETEZIK, harom kulon nevesitett lepessel: az emberi urlap
 * (`DRAFTING`), az otlet (`IDEA`) es a gepi beadas (`AWAITING_REVIEW`). Ez az
 * allitas azt koti le, hogy egyikbol se lehessen zsakutca -- egy olyan tetel,
 * ami letrejon, es utana semmit nem lehet vele csinalni.
 *
 * A `DISCARDED` NEM SZAMIT KIUTNAK ebben az allitasban: az elvetes mindenhonnan
 * elerheto, tehat ha beleszamitana, minden allapot atmenne rajta, es a mercer
 * nem tudna elbukni. Ami itt szamit, az a MUNKA folytatasa.
 */
describe("where an item may be born", () => {
  const ENTRY_STATES: ContentState[] = ["DRAFTING", "IDEA", "AWAITING_REVIEW"];

  it("lets the work continue from every entry state", () => {
    for (const state of ENTRY_STATES) {
      const forward = allowedMoves(state).filter((to) => to !== "DISCARDED");
      assert.ok(
        forward.length > 0,
        `A ${state} kezdoallapotbol nincs tovabbi ut az elvetesen kivul.`,
      );
    }
  });

  /**
   * ES A GEPI BEJARAT ALLAPOTA NEV SZERINT: a lektor mindket iranyba tud
   * lepni, tovabb a jovahagyashoz es vissza javitasra. Ha barmelyik ut
   * eltunne, a gepi tetel egy fel-folyamatban rekedne.
   */
  it("lets a machine-submitted item go forward and back", () => {
    assert.equal(canMove("AWAITING_REVIEW", "AWAITING_APPROVAL"), true);
    assert.equal(canMove("AWAITING_REVIEW", "AWAITING_REVISION"), true);
  });
});
