import { normalizeBrandName } from "../../brands/brands.repository.js";

/**
 * A MARKA-TORZS BETOLTOJE -- A TERV RESZE, IRAS NELKUL.
 *
 * === MI EZ A FAJL, ES MIERT A REPOBAN ===
 *
 * A bemenet barracuda meresebol SZARMAZTATOTT fajl, es a repoban all
 * (`brand-master/marka-betolto-bemenet-v1.tsv`). Nem az agens mappajabol
 * olvassuk: ez ADAT, ami a VEVO ELE KERULO neveket hatarozza meg, tehat
 * ugyanolyan atnezest erdemel a diffben, mint egy kodvaltozas. A meresi
 * dokumentum (`markatorzs-v1.tsv`) marad a forras, ahonnan ujragenerálhato.
 *
 * === A NEGY JELOLO, ES A NEGYEDIK SZANDEKOSAN MAS ===
 *
 *   (ures)              onallo marka -> letrejon
 *   kanonikus_meretlen  onallo marka -> LETREJON. A marka LETEZESEBEN biztosak
 *                       vagyunk, csak a nev ALAKJABAN nem. Ezt NEM szabad
 *                       osszemosni a masik harommal.
 *   nem_onallo          nem marka (konyvelesi sor) -> semmi
 *   ellenorizendo       a torzs sajat megjegyzese szerint nem biztos, hogy
 *                       marka -> semmi. A kanonikus nev a VEVO ele kerul, es a
 *                       ket tevedes ara nem egyforma: a kihagyas HANGOS (valaki
 *                       keresni fogja), a felvetel NEMA (ot bizonytalan nev all
 *                       a torzsben, nulla termekkel, es senki nem keresi).
 *   ketertelmu_alias    nem marka, hanem TILTO bejegyzes -> a visszatoltes NEM
 *                       rendelhet hozza markat
 */

export interface BrandMasterRow {
  kanonikus: string;
  aliasok: string[];
  forras: string;
  jelolo: string;
  megjegyzes: string;
}

/** A jelolok, amik NEM eredmenyeznek marka-rekordot. */
const NEM_KELETKEZIK = new Set(["nem_onallo", "ellenorizendo"]);
/** Ez sem marka, de MAS: tiltast eredmenyez a visszatoltesnel. */
export const TILTO_JELOLO = "ketertelmu_alias";

/**
 * A FAJL ERTELMEZESE, ES AZ OSZLOPSZAM SZIGORU.
 *
 * MERVE a mai fajlon: 126 adatsor, MIND pontosan otoszlopos (a forras-torzsben
 * 80 volt otos es 45 hatos). Egy elcsuszott oszlop csendben az aliasok helyere
 * tenne a forrast, ezert az eltero sor NEM figyelmeztetes, hanem hiba.
 */
export function parseBrandMaster(text: string): {
  rows: BrandMasterRow[];
  errors: string[];
} {
  const rows: BrandMasterRow[] = [];
  const errors: string[] = [];
  let fejlecMegvolt = false;

  text.split("\n").forEach((sor, index) => {
    const nyers = sor.replace(/\r$/, "");
    if (!nyers.trim() || nyers.startsWith("#")) return;
    const mezok = nyers.split("\t");
    if (mezok.length !== 5) {
      errors.push(
        `${index + 1}. sor: ${mezok.length} oszlop, de ötöt várunk ` +
          `(kanonikus, aliasok, forras, jelolo, megjegyzes)`,
      );
      return;
    }
    if (!fejlecMegvolt && mezok[0] === "kanonikus") {
      fejlecMegvolt = true;
      return;
    }
    rows.push({
      kanonikus: mezok[0]!.trim(),
      aliasok: mezok[1]!
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean),
      forras: mezok[2]!.trim(),
      jelolo: mezok[3]!.trim(),
      megjegyzes: mezok[4]!.trim(),
    });
  });

  if (!fejlecMegvolt) errors.push("A fejléc sor hiányzik.");
  return { rows, errors };
}

export interface BrandMasterPlan {
  /** Amit letre kell hozni: kanonikus nev plusz a sajat aliasai. */
  create: {
    name: string;
    aliases: string[];
    forras: string;
    jelolo: string;
  }[];
  /** Ami MAR all az adatbazisban -- egy masodik futasban ez lesz minden sor. */
  alreadyThere: string[];
  /** Amit szandekosan nem hozunk letre, jelolovel egyutt. */
  skipped: { name: string; jelolo: string }[];
  /** A visszatoltes szamara tiltott ERTEKEK (nyers alak). */
  blockedValues: string[];
}

/**
 * A TERV. Nem ir: bemenet a sorok es a MA letezo markak normalizalt kulcsai.
 *
 * A MASODIK FUTAS SZOTLAN: ami mar all (kanonikus nev VAGY alias szerint), az a
 * `alreadyThere` listaba kerul, es nem lesz belole `create`. Ha ez nem allna,
 * nem betolto lenne, hanem egyszer hasznalhato parancs.
 */
export function planBrandMaster(
  rows: readonly BrandMasterRow[],
  existingKeys: readonly string[],
): BrandMasterPlan {
  const megvan = new Set(existingKeys);
  const plan: BrandMasterPlan = {
    create: [],
    alreadyThere: [],
    skipped: [],
    blockedValues: [],
  };

  for (const row of rows) {
    if (row.jelolo === TILTO_JELOLO) {
      plan.blockedValues.push(row.kanonikus);
      continue;
    }
    if (NEM_KELETKEZIK.has(row.jelolo)) {
      plan.skipped.push({ name: row.kanonikus, jelolo: row.jelolo });
      continue;
    }
    if (megvan.has(normalizeBrandName(row.kanonikus))) {
      plan.alreadyThere.push(row.kanonikus);
      continue;
    }
    plan.create.push({
      name: row.kanonikus,
      aliases: row.aliasok,
      forras: row.forras,
      jelolo: row.jelolo,
    });
  }
  return plan;
}

export function describeBrandMasterPlan(plan: BrandMasterPlan): string {
  const sorok = [
    `Létrehozandó márka-rekord: ${plan.create.length}`,
    `Már áll, érintetlen: ${plan.alreadyThere.length}`,
    `Kihagyva (nem márka vagy ellenőrizendő): ${plan.skipped.length}`,
    `Tiltó bejegyzés (a visszatöltés nem rendelhet hozzá): ${plan.blockedValues.length}`,
  ];

  if (plan.skipped.length) {
    sorok.push("", "Kihagyva, és MIÉRT:");
    for (const s of plan.skipped) sorok.push(`  ${s.name} -- ${s.jelolo}`);
  }
  if (plan.blockedValues.length) {
    sorok.push("", "Tiltott értékek (a visszatöltés ezekre NEM ír márkát):");
    for (const v of plan.blockedValues) sorok.push(`  ${v}`);
  }

  /**
   * A FORRAS ATVITELE NEM DISZ, ES A SZAM ITT ALL, hogy lassa, aki a lapot
   * olvassa: ma 126 sorbol 9 all gyartoi forrason. Ha ez nem kerul at a
   * rekordba, holnap mind egyformán biztosnak latszik.
   */
  const forrasok = new Map<string, number>();
  for (const c of plan.create)
    forrasok.set(c.forras, (forrasok.get(c.forras) ?? 0) + 1);
  if (forrasok.size) {
    sorok.push("", "A létrehozandók FORRÁSA (ez a rekordba is átmegy):");
    for (const [forras, db] of [...forrasok.entries()].sort(
      (a, b) => b[1] - a[1],
    ))
      sorok.push(`  ${forras} -- ${db}`);
  }

  sorok.push(
    "",
    "AMIT EZ A SZÁM NEM MOND MEG: hogy a kanonikus ÍRÁSMÓD helyes-e. A forrás " +
      "oszlop mondja meg, melyik név állt gyártói bizonyítékon és melyik csak " +
      "a mezőből vagy a termék nevéből -- ezért megy át a rekordba.",
    "Ez a parancs CSAK a márka-törzset írja: terméket nem érint.",
  );
  return sorok.join("\n") + "\n";
}
