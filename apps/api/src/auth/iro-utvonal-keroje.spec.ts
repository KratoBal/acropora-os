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
 * Egy handler MEGKAPHATJA a kerot, es tovabbadhatja csak az AZONOSITOJAT --
 * aktorkent, nem hatokorkent. Az ATMEGY ezen a halon, es a halo semmit nem
 * allit rola.
 *
 * MERVE 2026-09-21 ESTE: ilyen ma NULLA van (a masodik javitasi kor utan). A
 * nulla viszont a MAI allapot, nem a halo erdeme -- ezt a halmazt SEMMI nem
 * oriz, tehat holnap ujra kelethezhet, es ez a halo nem fog szolni.
 *
 * A szam azert all itt, es nem egy "nehany" szo, mert egy meret csak akkor
 * ellenorizheto, ha ki van mondva.
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
/**
 * BŐVÜLVE 2026-09-25: az `AQUARIUMS_VIEW`/`AQUARIUMS_MANAGE` bekerült a
 * `PARTNER_SERVICE` jogai közé (Balázs döntése, Partner Portál Akváriumok
 * terv). Ez a halmaz-bővülés SZÁNDÉKOS, és pontosan azt a védelmet
 * futtatja végig az új kockázati halmazon, amit ez a fájl fejléce leír:
 * minden `AQUARIUMS_MANAGE` alatt álló író útvonalnak kérőt kell kapnia.
 */
const PARTNERI_JOGOK = [
  "SERVICE_VIEW",
  "SERVICE_MANAGE",
  "AQUARIUMS_VIEW",
  "AQUARIUMS_MANAGE",
  "SERVICE_ASSET_AQUARIUM_ASSIGN",
] as const;

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
  /*
    URES, 2026-09-21 ota -- es ez a lista MAGATOL rovidult.

    Ot elemmel indult (createDepartment, setPartnerCode, addLine, updateLine,
    removeLine). Amikor mind az ot megkapta a kerot, EZ A HALO sult el a sajat
    javitasomra: a halmaz-allitas pirosodott, es a hosszat is at kellett irni.

    Pontosan ezert all itt a hossz allitaskent. Egy uj kivetel nem csuszhat be
    csendben -- at kell irni egy szamot, es az a diffben latszik.

    ES A setPartnerCode NEM JOGKOR-KERDES VOLT. A 866fd6cd kartya ugy allt,
    mintha Balazsra varna (SERVICE_MANAGE vagy PARTNERS_MANAGE). Acrobot
    lemerte: a `SERVICE` szerep SZANDEKOSAN nem kap `PARTNERS_MANAGE` jogot, es
    a mezo a MUNKALAP miatt letezik, nem partner-torzsadatkent. A jog helyes
    volt, a hatokor hianyzott -- ugyanaz az eset, mint a masik negy.
  */
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
  it("a kivétel-lista PONTOSAN ÜRES", () => {
    /*
      A NULLA ITT NEM "nincs mit merni", HANEM EREDMENY. A lista ot elemmel
      indult, es a javitasok kiuritettek. Ha valaha no, ez a sor pirosodik --
      es akkor a felvevonek ki kell mondania, melyik kartya tartja szamon.
    */
    assert.equal(KIVETELEK.length, 0);
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
