import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A HALO: EGYETLEN KULDESI UT SEM KERULHETI MEG A TERITO BURKOT.
 *
 * === MIERT FORRAS-SZINTU, ES MIT VED ===
 *
 * A terites azert all a kuldo BURKABAN, mert igy egyik ut sem tudja
 * megkerulni: mind a harom a `MAIL_SENDER` jelzon at kapja a kuldot. Ez a
 * szerkezet viszont EGY SOR atirasaval megszuntetheto -- es ha valaki egy uj,
 * NEGYEDIK kuldesi utat ir, es abban kozvetlenul a `GmailMailSender`-t keri,
 * az az ut csendben a valodi cimzetthez kuld.
 *
 * Semmi nem hibazna: a fordito zold, a tobbi ut allitasai zoldek, es a hiba
 * csak akkor derulne ki, amikor egy vevo megkapja a probalevelet.
 *
 * === A LISTA A FORRASBOL JON, NEM KEZZEL ===
 *
 * A `mail` mappa fajljait olvassa be, nem egy felsorolast. Egy kezzel irt
 * lista pontosan az UJ utat hagyna ki -- azt, amiert a halo letezik.
 */
/**
 * AZ UTVONAL A CSOMAG GYOKEREHEZ KEPEST ALL, NEM AZ `import.meta.url`-HEZ.
 *
 * MERT RESBOL: az elso alakom `new URL("./", import.meta.url)` volt, es
 * HELYBEN, tsx alatt mukodott. A rendes teszt-parancs viszont a LEFORDITOTT
 * fajlt futtatja a `test-dist` alol -- ott a mappaban `.js` all, a modul pedig
 * `.ts` neven nem is letezik. A ket allitasom UGY bukott el, hogy a kod
 * hibatlan volt.
 *
 * A haz mintaja ugyanez (`label-scan-scope.spec.ts`): a forras-olvaso allitas
 * a CSOMAG munkakonyvtarahoz kepest nyit fajlt.
 */
const MAPPA = "src/notifications/mail";
const MODUL = "src/notifications/notifications.module.ts";

function fajlok(): string[] {
  return readdirSync(MAPPA)
    .filter((nev) => nev.endsWith(".ts") && !nev.endsWith(".spec.ts"))
    .filter(
      (nev) =>
        nev !== "gmail-mail.sender.ts" && nev !== "redirecting-mail.sender.ts",
    );
}

/**
 * A KOMMENTEK NELKUL, ES EZ MERT RESBOL JON, NEM OVATOSSAGBOL.
 *
 * Az elso alakom a nyers szovegre illesztett, es a `handover-mail.service.ts`
 * AZONNAL elbukott rajta -- egy JEGYZETBEN emliti a Gmail-kuldot, nem importban.
 * Egy halo, ami a sajat dokumentaciora ad pirosat, ket hasznalat utan
 * kikapcsolodik, es onnantol a VALODI esetet sem fogja meg.
 */
function kommentNelkul(szoveg: string): string {
  return szoveg.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function torzs(nev: string): string {
  return kommentNelkul(readFileSync(`${MAPPA}/${nev}`, "utf8"));
}

describe("a levélküldő bekötése", () => {
  /**
   * ISMERT POZITIV KONTROLL: a kereses LAT. A `mail` mappaban tobb fajl all, es
   * ha a listazas barmiert uresre esne, az alabbi allitas NEM tudna elbukni --
   * pontosan az a diszlet-alak, amit a hazban mashol elutasitunk.
   */
  it("kontroll: a mappa-olvasás lát fájlokat", () => {
    assert.ok(fajlok().length >= 5, `csak ${fajlok().length} fájlt látok`);
  });

  it("a Gmail-küldőt a BUROKON kívül senki nem importálja", () => {
    const vetkesek = fajlok().filter((nev) =>
      /GmailMailSender/.test(torzs(nev)),
    );

    assert.deepEqual(
      vetkesek,
      [],
      `ezek közvetlenül a Gmail-küldőt kérik, így megkerülnék az átirányítást: ${vetkesek.join(", ")}`,
    );
  });

  /**
   * ES A MODUL A BURKOT KOSSE A JELZOHOZ, NE A GMAILT.
   *
   * A fenti allitas azt fogja meg, ha valaki a Gmailt KERI. Ez azt, ha a MODUL
   * koti vissza -- olyankor a harom ut valtozatlanul a jelzot keri, es megis a
   * Gmail erkezik. A ketto KULON rontassal is elsul, tehat ket kulon allitas.
   */
  it("a modul a terítő burkot köti a MAIL_SENDER jelzőhöz", () => {
    const modul = kommentNelkul(readFileSync(MODUL, "utf8"));

    assert.match(
      modul,
      /provide:\s*MAIL_SENDER,\s*useClass:\s*RedirectingMailSender/,
    );
    assert.doesNotMatch(
      modul,
      /provide:\s*MAIL_SENDER,\s*useClass:\s*GmailMailSender/,
    );
  });

  /**
   * ES PONTOSAN EGY KOTES TARTOZIK A JELZOHOZ -- acrobot elesitese (2026-09-22).
   *
   * MIERT EROSEBB, MINT A FENTI KETTO: azok NEVEKRE szolnak (a Gmail-kuldo
   * neve, a burok neve). Egy MASODIK kotes barmilyen HARMADIK osztallyal
   * atmenne rajtuk -- a `useClass` helyett `useValue`, egy feltételes
   * szolgaltato, vagy egy masik modul, ami felulirja. Ez a darabszamot meri,
   * es a darabszamot nem lehet uj nevvel megkerulni.
   *
   * ES A NULLAT IS MEGFOGJA: ha a kotes eltunik, a szam 0 lesz, nem 1. Enelkul
   * egy torolt sor csendben azt eredmenyezne, hogy a harom ut `null` kuldot kap
   * es minden level `no-sender` okkal kimarad -- ami NEM hiba, csak nema.
   */
  it("a MAIL_SENDER jelzőhöz PONTOSAN EGY kötés tartozik", () => {
    const modul = kommentNelkul(readFileSync(MODUL, "utf8"));
    const kotesek = modul.match(/provide:\s*MAIL_SENDER\b/g) ?? [];

    assert.equal(
      kotesek.length,
      1,
      `${kotesek.length} kötés tartozik a MAIL_SENDER jelzőhöz, nem egy`,
    );
  });
});
