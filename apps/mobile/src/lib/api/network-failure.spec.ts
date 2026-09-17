import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeFailureCause,
  describeUploadFailure,
  describeUploadTransportFailure,
  OK_MINTA_HOSSZ,
  uriScheme,
} from "./network-failure";

/** Amit a `client.ts` dob: fix üzenet, és a valódi ok a `cause` mezőn. */
function halozatiHiba(ok: unknown): Error {
  const e = new Error("A szerver jelenleg nem érhető el.");
  e.name = "ApiNetworkError";
  (e as Error & { cause?: unknown }).cause = ok;
  return e;
}

describe("describeFailureCause", () => {
  /**
   * EZ AZ EGÉSZ MODUL LÉTOKA. A `cause` 2026-09-17-ig ott állt az objektumon,
   * és SENKI nem írta ki -- emiatt három körben kerestük vakon, mi hal el.
   */
  it("reads the cause the client already carries", () => {
    assert.equal(
      describeFailureCause(halozatiHiba(new Error("Network request failed"))),
      "Network request failed",
    );
  });

  it("says nothing when there is no cause to show", () => {
    assert.equal(describeFailureCause(new Error("csak ennyi")), null);
    assert.equal(describeFailureCause(null), null);
    assert.equal(describeFailureCause(halozatiHiba(undefined)), null);
    assert.equal(describeFailureCause(halozatiHiba(new Error("   "))), null);
  });

  it("takes a plain string cause too", () => {
    assert.equal(describeFailureCause(halozatiHiba("ENOENT")), "ENOENT");
  });

  /**
   * A NATÍV HIBALÁNC TÖBB SOROS IS LEHET, és a képernyőn szétdobná a mondatot.
   */
  it("collapses newlines and cuts a long chain", () => {
    assert.equal(
      describeFailureCause(halozatiHiba(new Error("a\n\n  b"))),
      "a b",
    );
    const hosszu = describeFailureCause(
      halozatiHiba(new Error("X".repeat(400))),
    );
    assert.ok((hosszu ?? "").length <= OK_MINTA_HOSSZ + 3);
    assert.match(hosszu ?? "", /\.\.\.$/);
  });
});

describe("uriScheme", () => {
  /**
   * A LEGERŐSEBB MAI JELÖLT: a natív réteg nem tudja megnyitni a képválasztó
   * által adott hivatkozást. A séma az az EGY mező, amiből ez eldől -- a teljes
   * út a felhasználó készülékéről szóló adat, és a diagnózishoz nem kell.
   */
  it("names the schemes a picker can hand us", () => {
    assert.equal(uriScheme("file:///var/mobile/kep.jpg"), "file");
    assert.equal(uriScheme("ph://ABC-123/L0/001"), "ph");
    assert.equal(uriScheme("content://media/external/images/1"), "content");
    assert.equal(
      uriScheme("assets-library://asset/asset.JPG"),
      "assets-library",
    );
  });

  it("is not fooled by capitals or by spaces around it", () => {
    assert.equal(uriScheme("  FILE:///a.jpg "), "file");
  });

  /** A SÉMA HIÁNYA ÖNMAGÁBAN LELET, ezért nevet kap, nem üres sztringet. */
  it("names the missing scheme instead of returning nothing", () => {
    assert.equal(uriScheme("/var/mobile/kep.jpg"), "nincs");
    assert.equal(uriScheme(""), "nincs");
  });
});

describe("describeUploadTransportFailure", () => {
  it("carries all three facts the next attempt needs", () => {
    const mondat = describeUploadTransportFailure({
      error: halozatiHiba(new Error("Network request failed")),
      uris: ["ph://ABC/L0/001"],
    });
    assert.match(mondat, /el sem jutott a szerverig/);
    assert.match(mondat, /Network request failed/);
    assert.match(mondat, /ph/);
  });

  /**
   * A HIÁNYZÓ OK IS KI VAN MONDVA. Enélkül a mondat ugyanúgy nézne ki, mint
   * amikor van ok, csak rövidebben -- és senki nem tudná eldönteni, hogy a
   * natív réteg hallgatott, vagy mi felejtettük el kiírni.
   */
  it("says so when the phone gave no reason", () => {
    const mondat = describeUploadTransportFailure({
      error: new Error("semmi"),
      uris: ["file:///a.jpg"],
    });
    assert.match(mondat, /nem mondta meg, miért/);
  });

  /**
   * A SÉMÁK EGYSZER SZEREPELNEK. Tíz képnél tízszer ugyanaz a szó nem
   * információ, hanem zaj -- és a hosszú mondat a telefonon el is tűnne.
   */
  it("lists each scheme once, even for many files", () => {
    const mondat = describeUploadTransportFailure({
      error: halozatiHiba(new Error("x")),
      uris: ["file:///a.jpg", "file:///b.jpg", "ph://C/L0/1"],
    });
    assert.equal(mondat.split("file").length - 1, 1);
    assert.match(mondat, /file, ph/);
  });
});

describe("describeUploadFailure", () => {
  /**
   * A SZERVER ÜZENETE A HELYES, HA VÁLASZOLT. Az megmondja, mi a baj (túl nagy
   * fájl, rossz formátum, nincs jog) -- egy „nem jutott el a szerverig" mondat
   * ott HAZUDNA, és a szerelő a térerőt kezdené keresni.
   */
  it("keeps the server's own message when the server answered", () => {
    assert.equal(
      describeUploadFailure({
        error: new Error("Egyszerre legfeljebb 10 fájl tölthető fel."),
        uris: ["file:///a.jpg"],
        networkFailure: false,
      }),
      "Egyszerre legfeljebb 10 fájl tölthető fel.",
    );
  });

  it("gives the transport diagnosis when the request never left", () => {
    const mondat = describeUploadFailure({
      error: halozatiHiba(new Error("Network request failed")),
      uris: ["ph://ABC/L0/001"],
      networkFailure: true,
    });
    assert.match(mondat, /Network request failed/);
    assert.match(mondat, /ph/);
  });

  it("still says something when the thrown value is not an Error", () => {
    assert.match(
      describeUploadFailure({
        error: "valami",
        uris: [],
        networkFailure: false,
      }),
      /Próbáld újra/,
    );
  });
});
