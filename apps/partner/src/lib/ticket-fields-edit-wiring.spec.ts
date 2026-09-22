import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * A BEJELENTES-JAVITAS BEKOTESE -- A KODRA MERVE, NEM A FAJL SZOVEGERE.
 *
 * Ennek az appnak nincs komponens-teszt keretrendszere (csak `lib/*.spec.ts`,
 * `node:test`), tehat a felulet viselkedeset itt nem lehet renderelessel merni.
 * Amit merni LEHET, es ami a legtobbet er: hogy a szerkeszto a HELYES
 * feltetelhez van kotve, es hogy a kliens a helyes vegpontra kuld.
 *
 * A KOMMENT-KISZEDES ALAPERTELMEZES, nem kivetel (`portal-wiring.spec.ts`
 * fejlece mondja el, miert): a sajat magyarazo szovegem ugyanazokat a szavakat
 * hasznalja, amiket a meres keres. Az also kontroll ezt bizonyitja is.
 */

const GYOKER = join(process.cwd(), "src");
const LAP = join(GYOKER, "components", "ticket-detail.tsx");
const SZERKESZTO = join(GYOKER, "components", "ticket-fields-editor.tsx");
const KLIENS = join(GYOKER, "lib", "api.ts");

const olvas = (ut: string) => readFileSync(ut, "utf8");
const kod = (ut: string) =>
  olvas(ut)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("a bejelentés javításának bekötése", () => {
  it("POZITÍV KONTROLL: mind a három fájl olvasható és nem üres", () => {
    for (const ut of [LAP, SZERKESZTO, KLIENS])
      assert.ok(kod(ut).length > 500, `${ut}: üres vagy gyanúsan rövid`);
  });

  /**
   * MI PIROSIT: ha a szerkeszto feltetel NELKUL kerul a lapra. Akkor a
   * bejelento olyan jegyen is javitast kezdene, amin mar all munkalap -- a
   * szerver elutasitana, de csak a mentes utan, a beirt szoveg elvesztesevel.
   */
  it("a szerkesztő a MUNKALAP HIÁNYÁHOZ van kötve", () => {
    assert.match(
      kod(LAP),
      /worksheets\.length === 0 \?\s*\(?\s*<TicketFieldsEditor/,
    );
  });

  /**
   * MI PIROSIT: ha a kliens `POST`-tal kuld. A `POST /service/jobs` a
   * FELVITEL utvonala -- egy javitas igy UJ jegyet nyitna ugyanarrol a
   * hibarol, es a bejelento ketto kozul nem tudna, melyik az ervenyes.
   */
  it("a kliens PATCH-csel küld, a jegy saját útvonalára", () => {
    const s = kod(KLIENS);
    assert.match(s, /updateTicket:/);
    assert.match(
      s,
      /`\/service\/jobs\/\$\{encodeURIComponent\(id\)\}`,\s*\{\s*method: "PATCH"/,
    );
  });

  /**
   * MI PIROSIT: ha az ures leiras URES SZOVEGKENT megy ki. A semaban a leiras
   * `String?`, es a "nincs leiras" allapot a `null` -- egy ures szoveg
   * harmadik allapotot csinalna ugyanabbol a kettobol.
   */
  it("az üres leírás null-ként megy ki", () => {
    assert.match(
      kod(SZERKESZTO),
      /description:\s*leiras\.trim\(\) === "" \? null :/,
    );
  });

  /**
   * KONTROLL A MERESRE MAGARA: a komment-kiszedes MUKODIK.
   *
   * A szerkeszto fejleceben all a "REJTETT munkalap" kifejezes, es SEHOL a
   * kodjaban. Ha ez a kiszedett szovegben is megvan, akkor a fenti negy
   * allitas barmelyiket kielegithetne egy komment -- vagyis nem a kodot
   * mernenk.
   */
  it("KONTROLL: a komment-kiszedés tényleg kiveszi a magyarázatot", () => {
    assert.match(
      olvas(SZERKESZTO),
      /REJTETT munkalap/,
      "a fejléc szövege ott van",
    );
    assert.doesNotMatch(kod(SZERKESZTO), /REJTETT munkalap/);
  });
});
