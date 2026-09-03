import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  queueDiscardConfirmation,
  queueDiscardEligibility,
  queueDiscardPatch,
} from "./queue-discard";

/**
 * AZ ELVETES A MASODIK KIJARAT, ES A LEGVESZELYESEBB: ez az egyetlen gomb az
 * appban, ami a szerelo SAJAT munkajat dobja el.
 */

describe("melyik sor vethető el", () => {
  it("az elakadt: igen", () => {
    assert.deepEqual(queueDiscardEligibility({ state: "conflict" }), {
      ok: true,
    });
  });

  it("a várakozó és a megállt: nem", () => {
    /*
      MI PIROSIT: az allapot-feltetel kiszelesitese. Egy varakozo sor MEG UTON
      VAN -- azt nem elvetni kell, hanem megvarni; egy megallt soron a szerverrel
      van baj, es ott az ujraprobalas a teendo. Ha az elvetes ott is megjelenne,
      a szerelo egy MEG FELMENO felvitelt dobna el.
    */
    for (const state of ["pending", "syncing", "failed", "stalled"]) {
      assert.equal(queueDiscardEligibility({ state }).ok, false, state);
    }
  });

  it("a MÁR elvetett sorra más mondatot ad", () => {
    /*
      Ket kulon eset, ket kulon mondat. Egy kozos "nem lehet elvetni" a mar
      elvetett soron ugy hangozna, mintha hiba lenne -- pedig epp az tortent,
      amit a szerelo kert.
    */
    const d = queueDiscardEligibility({ state: "discarded" });
    assert.equal(d.ok, false);
    assert.ok(
      !d.ok && d.message.includes("már elvetetted"),
      !d.ok ? d.message : "",
    );
  });
});

describe("a megerősítés megnevezi, MI vész el", () => {
  const megerosites = queueDiscardConfirmation({
    kind: "Eszköz",
    title: "Szivattyú",
  });

  it("a felvitel FAJTÁJA és NEVE benne áll", () => {
    /*
      EZ A KIKOTES LENYEGE (acrobot, 2026-09-04): nem "biztos vagy benne?",
      hanem MELYIK felvitel es MI van benne. Egy megerosites, ami nem nevezi meg
      a tartalmat, ugyanaz a nema veszteseg, csak egy kattintassal tobb.

      MI PIROSIT: a szoveg lecserelese barmilyen altalanos kerdesre.
    */
    assert.ok(megerosites.message.includes("Eszköz"), megerosites.message);
    assert.ok(megerosites.message.includes("Szivattyú"), megerosites.message);
  });

  it("kimondja, hogy nincs róla másik példány", () => {
    /*
      A KOVETKEZMENY, nem a muvelet. "Elveted?" azt kerdezi, mit nyomsz meg;
      ez azt mondja meg, mi lesz utana: a felvitel SEHOL nem fog letezni.
    */
    assert.ok(
      megerosites.message.includes("nincs róla másik példány"),
      megerosites.message,
    );
  });

  it("a gomb felirata megnevezi a tettet", () => {
    assert.equal(megerosites.confirmLabel, "Elvetem");
  });

  it("a cím kérdés, a törzs állítás", () => {
    /*
      ISMERT POZITIV KONTROLL: a fenti allitasok akkor is teljesulnenek, ha a
      cim es a torzs ugyanaz a szoveg lenne.
    */
    assert.ok(megerosites.title.endsWith("?"), megerosites.title);
    assert.notEqual(megerosites.title, megerosites.message);
  });
});

describe("mit változtat az elvetés a soron", () => {
  it("csak az állapotot", () => {
    assert.deepEqual(queueDiscardPatch(), { state: "discarded" });
  });

  it("a TÖRZS és a HIBAÜZENET NEM szerepel benne, tehát megmarad", () => {
    /*
      MI PIROSIT: ha az elvetes kiuritene a torzset vagy a hibauzenetet. Az
      elvetett sor egyetlen ertelme, hogy megmondja, MI veszett el es MIERT --
      egy ures sor "elvetve" felirattal ugyanannyit mond, mint a semmi.
    */
    assert.deepEqual(Object.keys(queueDiscardPatch()), ["state"]);
  });
});
