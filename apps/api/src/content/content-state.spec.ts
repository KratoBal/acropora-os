import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  allowedMoves,
  canMove,
  contentBlockers,
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
