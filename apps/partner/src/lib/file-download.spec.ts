import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  REVOKE_DELAY_MS,
  saveBlob,
  showBlob,
  type FileSurface,
} from "./file-download.js";

/**
 * A FÁJL LETÖLTÉSE ÉS MEGNYITÁSA A PARTNER PORTÁLON (2026-09-26).
 *
 * Balázs kérése: a munkalap PDF-je a portálon nem volt letölthető, mert a
 * `DocumentPanel` csak a képeket töltötte be, minden más tételnél a fájlnév
 * állt sima szövegként.
 *
 * Ezek az állítások a VISELKEDÉST mérik egy hamis böngésző-felületen: mi kerül
 * a horgonyra, mikor szabadul fel az objektum-URL, és mi történik, ha a
 * felugró ablakot a böngésző letiltotta. A panel bekötését a
 * `portal-wiring.spec.ts` méri.
 */

type Hivas =
  | { tipus: "url"; blob: Blob; url: string }
  | { tipus: "visszavon"; url: string }
  | { tipus: "kattint"; href: string; download: string };

function hamisFelulet() {
  const hivasok: Hivas[] = [];
  const kesobb: { run: () => void; ms: number }[] = [];
  let n = 0;
  const felulet: FileSurface = {
    createObjectURL(blob) {
      const url = `blob:proba/${++n}`;
      hivasok.push({ tipus: "url", blob, url });
      return url;
    },
    revokeObjectURL(url) {
      hivasok.push({ tipus: "visszavon", url });
    },
    createAnchor() {
      const horgony = {
        href: "",
        download: "",
        click() {
          hivasok.push({
            tipus: "kattint",
            href: horgony.href,
            download: horgony.download,
          });
        },
      };
      return horgony;
    },
    later(run, ms) {
      kesobb.push({ run, ms });
    },
  };
  return { felulet, hivasok, kesobb };
}

/** Az első objektum-URL hívás blobja; a hiánya maga is bukás. */
function elsoBlob(hivasok: Hivas[]): Blob {
  const h = hivasok.find((x) => x.tipus === "url");
  assert.ok(h && h.tipus === "url", "nem jött objektum-URL hívás");
  return h.blob;
}

const PDF = "application/pdf";
const FAJLNEV = "munkalap-BAL-2026-005.pdf";

describe("saveBlob", () => {
  it("a letöltés a tétel EREDETI fájlnevét kapja, és a létrehozott URL-re mutat", () => {
    const { felulet, hivasok } = hamisFelulet();
    saveBlob(new Blob(["%PDF"], { type: PDF }), FAJLNEV, felulet);
    const kattintasok = hivasok.filter((h) => h.tipus === "kattint");
    assert.deepEqual(kattintasok, [
      { tipus: "kattint", href: "blob:proba/1", download: FAJLNEV },
    ]);
  });

  /**
   * A FELSZABADÍTÁS KÉSLELTETVE MEGY, ÉS UGYANARRA AZ URL-RE.
   *
   * MI PIROSÍT: egy `click()` utáni azonnali `revokeObjectURL`. A letöltés
   * aszinkron olvassa az URL-t, és ha a visszavonás megelőzi, üres fájl jön
   * le -- a hiba a partnernél jelenik meg, nálunk semmi nem szól.
   */
  it("az objektum-URL-t csak később vonja vissza, de visszavonja", () => {
    const { felulet, hivasok, kesobb } = hamisFelulet();
    saveBlob(new Blob(["%PDF"], { type: PDF }), FAJLNEV, felulet);
    assert.equal(
      hivasok.filter((h) => h.tipus === "visszavon").length,
      0,
      "a kattintás után azonnal visszavonta",
    );
    assert.equal(kesobb.length, 1);
    const [elhalasztott] = kesobb;
    assert.ok(elhalasztott);
    assert.equal(elhalasztott.ms, REVOKE_DELAY_MS);
    elhalasztott.run();
    assert.deepEqual(hivasok.at(-1), {
      tipus: "visszavon",
      url: "blob:proba/1",
    });
  });
});

describe("showBlob", () => {
  it("a megnyitott lapra irányít, horgony nélkül", () => {
    const { felulet, hivasok, kesobb } = hamisFelulet();
    const lap = { location: { href: "about:blank" } };
    const eredmeny = showBlob(
      lap,
      new Blob(["%PDF"], { type: PDF }),
      PDF,
      FAJLNEV,
      felulet,
    );
    assert.equal(eredmeny, "opened");
    assert.equal(lap.location.href, "blob:proba/1");
    assert.equal(hivasok.filter((h) => h.tipus === "kattint").length, 0);
    assert.equal(kesobb.length, 1, "a lap URL-je nincs felszabadítva");
  });

  /**
   * A TÁROLT TARTALOMTÍPUS KERÜL A BLOBRA.
   *
   * MI PIROSÍT: ha a szerver `application/octet-stream`-et küld, és a blob
   * változatlanul megy a lapra. A böngésző ilyenkor NEM mutatja a PDF-et,
   * hanem letölti -- a „Megnyitás" gomb tehát letöltés lenne.
   *
   * A KONTROLL a második eset: ha a típus már helyes, ugyanaz az objektum megy
   * tovább. Enélkül egy mindig-másoló megvalósítás is zöld lenne, és egy
   * mindig-változatlan is bukna -- a kettőt ez választja szét.
   */
  it("a lapra a TÁROLT tartalomtípussal megy a blob", () => {
    const { felulet, hivasok } = hamisFelulet();
    showBlob(
      { location: { href: "" } },
      new Blob(["%PDF"], { type: "application/octet-stream" }),
      PDF,
      FAJLNEV,
      felulet,
    );
    assert.equal(elsoBlob(hivasok).type, PDF);

    const kontroll = hamisFelulet();
    const helyes = new Blob(["%PDF"], { type: PDF });
    showBlob(
      { location: { href: "" } },
      helyes,
      PDF,
      FAJLNEV,
      kontroll.felulet,
    );
    assert.equal(elsoBlob(kontroll.hivasok), helyes);
  });

  /**
   * LETILTOTT FELUGRÓ ABLAK: A KATTINTÁS NEM VÉGZŐDHET SEMMIBEN.
   *
   * MI PIROSÍT: ha `null` lapnál a függvény csendben visszatér. A partner
   * ilyenkor rákattint, és nem történik semmi -- ugyanaz a tünet, amiből ez
   * a munka indult.
   */
  it("ha nincs lap, letöltésre vált a fájlnévvel", () => {
    const { felulet, hivasok } = hamisFelulet();
    const eredmeny = showBlob(
      null,
      new Blob(["%PDF"], { type: PDF }),
      PDF,
      FAJLNEV,
      felulet,
    );
    assert.equal(eredmeny, "saved");
    assert.deepEqual(
      hivasok.filter((h) => h.tipus === "kattint"),
      [{ tipus: "kattint", href: "blob:proba/1", download: FAJLNEV }],
    );
  });
});
