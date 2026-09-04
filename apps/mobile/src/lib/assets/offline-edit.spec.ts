import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeAssetUpdateWrite } from "./offline-edit";

/**
 * A MERCE: A SZERELO NE KEZDJEN OLYASMIBE, AMI NEM KELL.
 *
 * A felvitel mondatai („a rögzítés elveszett") egy modositasnal arra
 * vinnenek, hogy ujra felviszi az eszkozt -- holott az ott van a rendszerben,
 * es csak a javitas nem ment fel.
 */

describe("mit lát a szerelő egy sorba tett módosításnál", () => {
  it("a VÁRAKOZÓ módosításnál kimondja, hogy a rendszerben a RÉGI adat áll", () => {
    /*
      EZ A LEGFONTOSABB ALLITAS. Enelkul a szerelo joggal hinne, hogy az iroda
      mar a javitott adatot latja -- pedig a javitas a telefonon all, es orakig
      ott is maradhat.

      MI PIROSIT: egy sima "elmentve" mondat.
    */
    const out = describeAssetUpdateWrite({ ok: true, operationId: "op-1" });

    assert.equal(out.type, "queued");
    assert.match(out.type === "queued" ? out.message : "", /vár feltöltésre/);
    assert.match(out.type === "queued" ? out.message : "", /a régi marad/);
  });

  it("a BUKÁSNÁL nem mondja, hogy elveszett a rögzítés", () => {
    /*
      A felvitel mondata itt HAMIS lenne: az eszkoz megvan, es valtozatlan.
      Amit a szerelonek tennie kell, az az ujraprobalas, nem egy uj felvitel.

      MI PIROSIT: az `offline-record.ts` mondatanak atmasolasa ide.
    */
    const out = describeAssetUpdateWrite({ ok: false, error: "tele a lemez" });

    assert.equal(out.type, "queue-failed");
    const uzenet = out.type === "queue-failed" ? out.message : "";
    assert.doesNotMatch(uzenet, /rögzítés elveszett/);
    assert.match(uzenet, /Az eszköz adata változatlan/);
  });

  it("a bukás OKÁT idézi, nem általánosít", () => {
    /*
      A tarolo sajat okot ad vissza (peldaul "az előző módosítás közben
      elindult a feltöltés"), es a teendo esetenkent MAS: az egyiknel egy
      pillanat mulva ujra, a masiknal a sor-kepernyon kell rendezni. Egy kozos
      "nem sikerült" mindketto helyett ugyanazt mondana.

      MI PIROSIT: ha az uzenet elhagyja a kapott okot.
    */
    const out = describeAssetUpdateWrite({
      ok: false,
      error: "az előző módosítás közben elindult a feltöltés",
    });

    assert.match(
      out.type === "queue-failed" ? out.message : "",
      /az előző módosítás közben elindult a feltöltés/,
    );
  });
});
