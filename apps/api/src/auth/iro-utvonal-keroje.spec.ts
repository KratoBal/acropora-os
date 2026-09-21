import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * MINDEN PARTNER-JOG ALATT ALLO IRO UTVONAL KAPJA MEG A KEROT.
 *
 * === A MERT RES, AMI EZT ELOHOZTA (2026-09-21) ===
 *
 * Harom munkalap-vegpontot (updateDraft, setAssignees, setAssets) egy
 * partner-fiok is elert, barmelyik munkalapon. Ot kod-megjegyzes allitotta,
 * hogy a `SERVICE_MANAGE` jog kizarja a partnert -- a `PARTNER_SERVICE` szerep
 * VISELI a jogot. Kettonek a metodusa a kerot MEG SEM KAPTA, tehat
 * szerkezetileg nem is tudott hatokort szukiteni.
 *
 * === ES AMIERT EGYIK MEGLEVO HALO SEM LATTA ===
 *
 * A `partner-scope-and-branch.spec.ts` azt oriz, hogy a hatokor-szuro `AND`
 * agkent kerul-e be a lekerdezesbe. Az EGY MASIK kerdes: ott a szuro LETEZIK,
 * es a BEEPITESE a kerdes. Itt a szuro EL SEM KESZUL.
 *
 * Ket kulonbozo kerdes, es az elso halo SZERKEZETILEG vak a masodikra. Nem
 * kimaradt eset -- a hatokoren kivul van.
 *
 * === AMIT EZ A HALO NEM FED, ES EZ A LEGFONTOSABB SOR ===
 *
 * A "MEGKAPJA A KEROT" SZUKSEGES, DE NEM ELEGSEGES.
 *
 * Merve ugyanaznap, a TELJES fan, ugyanezzel a kiolvasassal: OT iro utvonal all
 * partner-jog alatt ugy, hogy MEGKAPJA a kerot, es csak az AZONOSITOJAT adja
 * tovabb -- aktorkent, nem hatokorkent:
 *
 *   create, addEntry, updateEntry, continueFrom, close
 *   (mind a worksheets kontrolleren)
 *
 * Ezek mind ATMENNEK ezen a halon, es a halo egyikrol sem allitja, hogy
 * hatokort szukit. A szamuk azert all itt, mert egy "nehany" szo ugyanugy
 * elfedne a meretet, mint egy hianyzo mondat.
 *
 * Egy halo, amirol azt hisszuk, tobbet ved, mint amennyit, ugyanaz a fajta
 * hamis biztonsag, mint egy hamis korlat. Ezert all ez a bekezdes ITT, es nem
 * csak a kartyan: a kovetkezo olvaso ezt latja, nem a kartyat.
 *
 * === A HATOKOR: MIERT A PARTNER-JOG, ES NEM MINDEN IRO UTVONAL ===
 *
 * A fan 133 iro utvonal all, es 40 nem kap kerot. A tobbseg viszont olyan jog
 * alatt fut, amit a partner-fiok NEM kap meg -- ott a kero hianya nem
 * hatokor-kerdes, hanem egy belso vegpont rendes alakja.
 *
 * A KOCKAZATI HALMAZ tehat az, amit a partner JOGA elér: `SERVICE_VIEW` vagy
 * `SERVICE_MANAGE`. Ez a halmaz a jog-modellbol JON, nem valasztas kerdese --
 * ha a `PARTNER_SERVICE` valaha uj jogot kap, ez a halo magatol szelesedik.
 */

const API_GYOKER = "src";

/**
 * A PARTNER_SERVICE JOGAI. Ha ez a lista elavul, a halo hatokore csusszan el --
 * ezert egy allitas kulon meri, hogy a semaval egyezik.
 */
const PARTNERI_JOGOK = ["SERVICE_VIEW", "SERVICE_MANAGE"] as const;

/**
 * A NEVESITETT KIVETELEK -- ES EZ NYILVANTARTAS, NEM MENTSEG.
 *
 * Mindegyik mellett ott all a kartya, ami szamon tartja. Egy kivetel, aminek
 * nincs nyitott kartyaja, nem kivetel, hanem DONTES -- es azt ki kell mondani,
 * nem egy listaba tenni.
 *
 * A LISTA ROVIDUL, ahogy a kartya halad. Ha valaha NO, az a diffben latszik:
 * a hosszat kulon allitas meri.
 */
const KIVETELEK: readonly { handler: string; kartya: string }[] = [
  { handler: "createDepartment", kartya: "9c818503" },
  // A setPartnerCode-ra KULON dontesi kartya all (866fd6cd: melyik jogkor
  // allithat partnerkodot). Ott a mechanika kesz es a SZABALY hianyzik.
  { handler: "setPartnerCode", kartya: "866fd6cd" },
  { handler: "addLine", kartya: "9c818503" },
  { handler: "updateLine", kartya: "9c818503" },
  { handler: "removeLine", kartya: "9c818503" },
];

interface Utvonal {
  fajl: string;
  metodus: string;
  handler: string;
  jogok: string[];
  kapKerot: boolean;
}

function kontrollerek(konyvtar: string): string[] {
  const ki: string[] = [];
  for (const elem of readdirSync(konyvtar, { withFileTypes: true })) {
    const ut = join(konyvtar, elem.name);
    if (elem.isDirectory()) ki.push(...kontrollerek(ut));
    else if (elem.name.endsWith(".controller.ts")) ki.push(ut);
  }
  return ki;
}

/** A ROUTE-DEKORATOROK A FORRASBOL -- kezzel irt lista epp az ujat hagyna ki. */
function utvonalak(): Utvonal[] {
  const ki: Utvonal[] = [];
  for (const fajl of kontrollerek(API_GYOKER)) {
    const sorok = readFileSync(fajl, "utf8").split("\n");
    const helyek: { sor: number; metodus: string }[] = [];
    sorok.forEach((sor, i) => {
      const m = /^\s*@(Get|Post|Put|Patch|Delete)\(/.exec(sor);
      if (m) helyek.push({ sor: i, metodus: m[1]! });
    });
    helyek.forEach((hely, k) => {
      if (hely.metodus === "Get") return;
      const vege = helyek[k + 1]?.sor ?? sorok.length;
      const torzs = sorok.slice(hely.sor, vege).join("\n");
      const handler = /\n\s+(?:async\s+)?([a-zA-Z]+)\(/.exec(torzs)?.[1] ?? "?";
      ki.push({
        fajl,
        metodus: hely.metodus,
        handler,
        jogok: [
          ...new Set(
            [...torzs.matchAll(/PERMISSIONS\.([A-Z_]+)/g)].map((m) => m[1]!),
          ),
        ],
        kapKerot: torzs.includes("@CurrentUser()"),
      });
    });
  }
  return ki;
}

const MIND = utvonalak();
const KOCKAZATI = MIND.filter((u) =>
  u.jogok.some((jog) => (PARTNERI_JOGOK as readonly string[]).includes(jog)),
);

describe("minden partner-jog alatt álló író útvonal megkapja a kérőt", () => {
  /**
   * POZITIV KONTROLL, KET IRANYBAN.
   *
   * Egy ures halmaz barmit allit. Ez azt meri, hogy a kiolvasas LAT: talal iro
   * utvonalat, talal partner-jog alattit, es talal olyat is, amelyik MEGKAPJA a
   * kerot -- vagyis a `kapKerot` mezo nem mindig hamis.
   */
  it("POZITÍV KONTROLL: a kiolvasás lát útvonalat, jogot és kérőt is", () => {
    assert.ok(MIND.length >= 100, `iro utvonal: ${MIND.length}`);
    assert.ok(KOCKAZATI.length >= 10, `kockazati: ${KOCKAZATI.length}`);
    assert.ok(
      KOCKAZATI.some((u) => u.kapKerot),
      "egyetlen kockazati utvonal sem kap kerot -- a kiolvasas gyanus",
    );
  });

  /**
   * ES A HATOKOR-LISTA EGYEZZEN A JOG-MODELLEL.
   *
   * Ha a `PARTNER_SERVICE` uj jogot kap es ez a lista nem koveti, a halo
   * CSENDBEN szukebb lesz -- pont azt az utvonalat hagyna ki, ami az uj joggal
   * valna elerhetove.
   */
  it("a partneri jogok listája egyezik a szerep jogaival", () => {
    const auth = readFileSync("../../packages/types/src/auth.ts", "utf8");
    const sor = /PARTNER_SERVICE:\s*\[([^\]]*)\]/.exec(auth);
    assert.ok(sor, "nincs PARTNER_SERVICE a szerep-táblában");
    const semaban = [...(sor[1] ?? "").matchAll(/PERMISSIONS\.([A-Z_]+)/g)]
      .map((m) => m[1]!)
      .sort();
    assert.deepEqual(semaban, [...PARTNERI_JOGOK].sort());
  });

  /**
   * A LISTA HOSSZA ALLITAS, NEM DISZ.
   *
   * Enelkul egy uj kivetel CSENDBEN becsuszna: valaki felvenne a listara, es a
   * halo tovabbra is zold maradna. Igy at kell irni a szamot -- es az a
   * diffben latszik.
   */
  it("a kivétel-lista PONTOSAN öt elemű", () => {
    assert.equal(KIVETELEK.length, 5);
  });

  it("minden kivételhez tartozik kártya", () => {
    for (const kivetel of KIVETELEK)
      assert.match(
        kivetel.kartya,
        /^[0-9a-f]{8}$/,
        `${kivetel.handler}: kártya nélküli kivétel`,
      );
  });

  /**
   * ES A LENYEG: UJ UTVONAL NEM CSUSZHAT BE.
   *
   * MI PIROSIT: egy uj iro vegpont partner-jog alatt, ami nem kapja meg a
   * kerot. Nem a mai otot javitja -- a HATODIKAT fogja meg, azt, amit meg
   * senki nem irt meg.
   */
  it("a kérőt nem kapó útvonalak PONTOSAN a nevesített kivételek", () => {
    const nincsKero = KOCKAZATI.filter((u) => !u.kapKerot)
      .map((u) => u.handler)
      .sort();
    assert.deepEqual(
      nincsKero,
      KIVETELEK.map((k) => k.handler).sort(),
      `eltérés:\n${KOCKAZATI.filter((u) => !u.kapKerot)
        .map((u) => `  ${u.metodus} ${u.handler} (${u.fajl})`)
        .join("\n")}`,
    );
  });
});
