/**
 * THE HOME PAGE CONTENT of the web shop (Balázs, 2026-10-20): every title,
 * subtitle, button, block text, link and image of the home page, and the hero
 * slides, edited here and projected to the shop's `homepage_content` module
 * (commerce #551).
 *
 * === THE CATALOGUE IS THE STOREFRONT'S, COPIED ===
 *
 * `HOMEPAGE_TEXT_FIELDS` is the list of keys the storefront reads
 * (`apps/storefront/src/modules/kezdolap/szovegek.ts` in acropora-commerce; the
 * copy was generated from commit 31a2cc9 of the home page blocks (acropora-commerce #554)), with the
 * label, the field type and the starting value the page shows until a value is
 * written here. Two repositories cannot test each other, so the guard against
 * drift is on the receiving side: the editor shows every key of this list, the
 * API refuses a key that is not in it (a typo never reaches the shop), and a
 * key the shop reads but this list does not know keeps its starting value.
 * When the storefront adds a key, this list gets it in the next change.
 *
 * === ONLY EDITED VALUES ARE STORED ===
 *
 * `texts` holds the overrides: a key that is absent shows the storefront's
 * starting value, a key that is present (even an empty string) is the editor's
 * own value. That distinction is what removes the "sample" marker of an
 * invented fact (a review, an address, opening hours) on the shop: saving the
 * editor without touching a field must not claim the sample as the shop's own.
 * `slides` is `null` (not set, the starting slides show) or the list, at most
 * five; an empty list is a decision (no hero).
 */
export type HomepageFieldType = "text" | "link" | "image";

export interface HomepageTextField {
  key: string;
  group: string;
  label: string;
  type: HomepageFieldType;
  /** What the page shows until a value is written. */
  default: string;
  /** The default is an invented fact (the shop labels it as a sample). */
  sample?: true;
}

export const HOMEPAGE_TEXT_FIELDS: readonly HomepageTextField[] = [
  {
    key: "hero.tenyek.1.cim",
    group: "Hero",
    label: "Első tény: címsor",
    type: "text",
    default: "Személyes átvétel",
  },
  {
    key: "hero.tenyek.1.szoveg",
    group: "Hero",
    label: "Első tény: szöveg",
    type: "text",
    default: "a budapesti boltban",
  },
  {
    key: "hero.tenyek.2.cim",
    group: "Hero",
    label: "Második tény: címsor",
    type: "text",
    default: "Szakmai tanácsadás",
  },
  {
    key: "hero.tenyek.2.szoveg",
    group: "Hero",
    label: "Második tény: szöveg",
    type: "text",
    default: "vásárlás előtt és után",
  },
  {
    key: "hero.tenyek.3.cim",
    group: "Hero",
    label: "Harmadik tény: címsor (értékelés)",
    type: "text",
    default: "4,9 / 5",
    sample: true,
  },
  {
    key: "hero.tenyek.3.szoveg",
    group: "Hero",
    label: "Harmadik tény: szöveg",
    type: "text",
    default: "312 vásárlói értékelés",
    sample: true,
  },
  {
    key: "mit.cim",
    group: "Mit keresel ma?",
    label: "Címsor",
    type: "text",
    default: "Mit keresel ma?",
  },
  {
    key: "mit.alcim",
    group: "Mit keresel ma?",
    label: "Alcím",
    type: "text",
    default:
      "Négy terület, egy bolt. Ha nem tudod, melyikkel kezdd, írj nekünk, és segítünk.",
  },
  {
    key: "mit.1.cim",
    group: "Mit keresel ma? 1. terület",
    label: "Terület neve",
    type: "text",
    default: "Élőállat",
  },
  {
    key: "mit.1.kep",
    group: "Mit keresel ma? 1. terület",
    label: "Kép",
    type: "image",
    default: "",
  },
  {
    key: "mit.1.l1.felirat",
    group: "Mit keresel ma? 1. terület",
    label: "1. hivatkozás: felirat",
    type: "text",
    default: "Tengeri halak",
  },
  {
    key: "mit.1.l1.link",
    group: "Mit keresel ma? 1. terület",
    label: "1. hivatkozás: cél",
    type: "link",
    default: "/store",
  },
  {
    key: "mit.1.l2.felirat",
    group: "Mit keresel ma? 1. terület",
    label: "2. hivatkozás: felirat",
    type: "text",
    default: "SPS korallok",
  },
  {
    key: "mit.1.l2.link",
    group: "Mit keresel ma? 1. terület",
    label: "2. hivatkozás: cél",
    type: "link",
    default: "/store",
  },
  {
    key: "mit.1.l3.felirat",
    group: "Mit keresel ma? 1. terület",
    label: "3. hivatkozás: felirat",
    type: "text",
    default: "LPS korallok",
  },
  {
    key: "mit.1.l3.link",
    group: "Mit keresel ma? 1. terület",
    label: "3. hivatkozás: cél",
    type: "link",
    default: "/store",
  },
  {
    key: "mit.1.l4.felirat",
    group: "Mit keresel ma? 1. terület",
    label: "4. hivatkozás: felirat",
    type: "text",
    default: "Lágykorallok",
  },
  {
    key: "mit.1.l4.link",
    group: "Mit keresel ma? 1. terület",
    label: "4. hivatkozás: cél",
    type: "link",
    default: "/store",
  },
  {
    key: "mit.1.l5.felirat",
    group: "Mit keresel ma? 1. terület",
    label: "5. hivatkozás: felirat",
    type: "text",
    default: "Gerinctelenek",
  },
  {
    key: "mit.1.l5.link",
    group: "Mit keresel ma? 1. terület",
    label: "5. hivatkozás: cél",
    type: "link",
    default: "/store",
  },
  {
    key: "mit.2.cim",
    group: "Mit keresel ma? 2. terület",
    label: "Terület neve",
    type: "text",
    default: "Technika",
  },
  {
    key: "mit.2.kep",
    group: "Mit keresel ma? 2. terület",
    label: "Kép",
    type: "image",
    default: "",
  },
  {
    key: "mit.2.l1.felirat",
    group: "Mit keresel ma? 2. terület",
    label: "1. hivatkozás: felirat",
    type: "text",
    default: "Világítás",
  },
  {
    key: "mit.2.l1.link",
    group: "Mit keresel ma? 2. terület",
    label: "1. hivatkozás: cél",
    type: "link",
    default: "/store",
  },
  {
    key: "mit.2.l2.felirat",
    group: "Mit keresel ma? 2. terület",
    label: "2. hivatkozás: felirat",
    type: "text",
    default: "Áramoltatók",
  },
  {
    key: "mit.2.l2.link",
    group: "Mit keresel ma? 2. terület",
    label: "2. hivatkozás: cél",
    type: "link",
    default: "/store",
  },
  {
    key: "mit.2.l3.felirat",
    group: "Mit keresel ma? 2. terület",
    label: "3. hivatkozás: felirat",
    type: "text",
    default: "Szűréstechnika",
  },
  {
    key: "mit.2.l3.link",
    group: "Mit keresel ma? 2. terület",
    label: "3. hivatkozás: cél",
    type: "link",
    default: "/store",
  },
  {
    key: "mit.2.l4.felirat",
    group: "Mit keresel ma? 2. terület",
    label: "4. hivatkozás: felirat",
    type: "text",
    default: "Mérés- és vezérléstechnika",
  },
  {
    key: "mit.2.l4.link",
    group: "Mit keresel ma? 2. terület",
    label: "4. hivatkozás: cél",
    type: "link",
    default: "/store",
  },
  {
    key: "mit.2.l5.felirat",
    group: "Mit keresel ma? 2. terület",
    label: "5. hivatkozás: felirat",
    type: "text",
    default: "",
  },
  {
    key: "mit.2.l5.link",
    group: "Mit keresel ma? 2. terület",
    label: "5. hivatkozás: cél",
    type: "link",
    default: "",
  },
  {
    key: "mit.3.cim",
    group: "Mit keresel ma? 3. terület",
    label: "Terület neve",
    type: "text",
    default: "Vegyszer és fogyóanyag",
  },
  {
    key: "mit.3.kep",
    group: "Mit keresel ma? 3. terület",
    label: "Kép",
    type: "image",
    default: "",
  },
  {
    key: "mit.3.l1.felirat",
    group: "Mit keresel ma? 3. terület",
    label: "1. hivatkozás: felirat",
    type: "text",
    default: "Víztesztek",
  },
  {
    key: "mit.3.l1.link",
    group: "Mit keresel ma? 3. terület",
    label: "1. hivatkozás: cél",
    type: "link",
    default: "/store",
  },
  {
    key: "mit.3.l2.felirat",
    group: "Mit keresel ma? 3. terület",
    label: "2. hivatkozás: felirat",
    type: "text",
    default: "Tengeri sók",
  },
  {
    key: "mit.3.l2.link",
    group: "Mit keresel ma? 3. terület",
    label: "2. hivatkozás: cél",
    type: "link",
    default: "/store",
  },
  {
    key: "mit.3.l3.felirat",
    group: "Mit keresel ma? 3. terület",
    label: "3. hivatkozás: felirat",
    type: "text",
    default: "Adalékanyagok",
  },
  {
    key: "mit.3.l3.link",
    group: "Mit keresel ma? 3. terület",
    label: "3. hivatkozás: cél",
    type: "link",
    default: "/store",
  },
  {
    key: "mit.3.l4.felirat",
    group: "Mit keresel ma? 3. terület",
    label: "4. hivatkozás: felirat",
    type: "text",
    default: "Táp",
  },
  {
    key: "mit.3.l4.link",
    group: "Mit keresel ma? 3. terület",
    label: "4. hivatkozás: cél",
    type: "link",
    default: "/store",
  },
  {
    key: "mit.3.l5.felirat",
    group: "Mit keresel ma? 3. terület",
    label: "5. hivatkozás: felirat",
    type: "text",
    default: "",
  },
  {
    key: "mit.3.l5.link",
    group: "Mit keresel ma? 3. terület",
    label: "5. hivatkozás: cél",
    type: "link",
    default: "",
  },
  {
    key: "mit.4.cim",
    group: "Mit keresel ma? 4. terület",
    label: "Terület neve",
    type: "text",
    default: "Szolgáltatások",
  },
  {
    key: "mit.4.kep",
    group: "Mit keresel ma? 4. terület",
    label: "Kép",
    type: "image",
    default: "",
  },
  {
    key: "mit.4.l1.felirat",
    group: "Mit keresel ma? 4. terület",
    label: "1. hivatkozás: felirat",
    type: "text",
    default: "Tervezés és telepítés",
  },
  {
    key: "mit.4.l1.link",
    group: "Mit keresel ma? 4. terület",
    label: "1. hivatkozás: cél",
    type: "link",
    default: "/hamarosan/szolgaltatasok",
  },
  {
    key: "mit.4.l2.felirat",
    group: "Mit keresel ma? 4. terület",
    label: "2. hivatkozás: felirat",
    type: "text",
    default: "Karbantartás",
  },
  {
    key: "mit.4.l2.link",
    group: "Mit keresel ma? 4. terület",
    label: "2. hivatkozás: cél",
    type: "link",
    default: "/hamarosan/szolgaltatasok",
  },
  {
    key: "mit.4.l3.felirat",
    group: "Mit keresel ma? 4. terület",
    label: "3. hivatkozás: felirat",
    type: "text",
    default: "Szerviz",
  },
  {
    key: "mit.4.l3.link",
    group: "Mit keresel ma? 4. terület",
    label: "3. hivatkozás: cél",
    type: "link",
    default: "/hamarosan/szolgaltatasok",
  },
  {
    key: "mit.4.l4.felirat",
    group: "Mit keresel ma? 4. terület",
    label: "4. hivatkozás: felirat",
    type: "text",
    default: "Vízmérés",
  },
  {
    key: "mit.4.l4.link",
    group: "Mit keresel ma? 4. terület",
    label: "4. hivatkozás: cél",
    type: "link",
    default: "/hamarosan/szolgaltatasok",
  },
  {
    key: "mit.4.l5.felirat",
    group: "Mit keresel ma? 4. terület",
    label: "5. hivatkozás: felirat",
    type: "text",
    default: "",
  },
  {
    key: "mit.4.l5.link",
    group: "Mit keresel ma? 4. terület",
    label: "5. hivatkozás: cél",
    type: "link",
    default: "",
  },
  {
    key: "kezdo.felirat",
    group: "Kezdőknek",
    label: "Felirat",
    type: "text",
    default: "Kezdőknek",
  },
  {
    key: "kezdo.cim",
    group: "Kezdőknek",
    label: "Címsor",
    type: "text",
    default: "Most rakod össze az első tengeri akváriumodat?",
  },
  {
    key: "kezdo.szoveg",
    group: "Kezdőknek",
    label: "Bevezető",
    type: "text",
    default:
      "Végigmegyünk veled az egészen: melyik medence, milyen technika, mennyi idő a beüzemelés, és mikor jöhetnek az első lakók.",
  },
  {
    key: "kezdo.1.lepes",
    group: "Kezdőknek",
    label: "1. lépés: sorszám",
    type: "text",
    default: "1. lépés",
  },
  {
    key: "kezdo.1.cim",
    group: "Kezdőknek",
    label: "1. lépés: címsor",
    type: "text",
    default: "Tervezés",
  },
  {
    key: "kezdo.1.szoveg",
    group: "Kezdőknek",
    label: "1. lépés: szöveg",
    type: "text",
    default: "Méret, hely, költségkeret",
  },
  {
    key: "kezdo.2.lepes",
    group: "Kezdőknek",
    label: "2. lépés: sorszám",
    type: "text",
    default: "2. lépés",
  },
  {
    key: "kezdo.2.cim",
    group: "Kezdőknek",
    label: "2. lépés: címsor",
    type: "text",
    default: "Beüzemelés",
  },
  {
    key: "kezdo.2.szoveg",
    group: "Kezdőknek",
    label: "2. lépés: szöveg",
    type: "text",
    default: "4–6 hét türelem",
  },
  {
    key: "kezdo.3.lepes",
    group: "Kezdőknek",
    label: "3. lépés: sorszám",
    type: "text",
    default: "3. lépés",
  },
  {
    key: "kezdo.3.cim",
    group: "Kezdőknek",
    label: "3. lépés: címsor",
    type: "text",
    default: "Első lakók",
  },
  {
    key: "kezdo.3.szoveg",
    group: "Kezdőknek",
    label: "3. lépés: szöveg",
    type: "text",
    default: "Halak és könnyű korallok",
  },
  {
    key: "kezdo.gomb1.felirat",
    group: "Kezdőknek",
    label: "Első gomb: felirat",
    type: "text",
    default: "Kezdő útmutató",
  },
  {
    key: "kezdo.gomb1.link",
    group: "Kezdőknek",
    label: "Első gomb: cél",
    type: "link",
    default: "",
  },
  {
    key: "kezdo.gomb2.felirat",
    group: "Kezdőknek",
    label: "Második gomb: felirat",
    type: "text",
    default: "Időpont tanácsadásra",
  },
  {
    key: "kezdo.gomb2.link",
    group: "Kezdőknek",
    label: "Második gomb: cél",
    type: "link",
    default: "",
  },
  {
    key: "halado.felirat",
    group: "Tapasztaltaknak",
    label: "Felirat",
    type: "text",
    default: "Tapasztaltaknak",
  },
  {
    key: "halado.cim",
    group: "Tapasztaltaknak",
    label: "Címsor",
    type: "text",
    default: "Tudod, mit keresel. Itt megtalálod.",
  },
  {
    key: "halado.1.cim",
    group: "Tapasztaltaknak",
    label: "1. sor: felirat",
    type: "text",
    default: "SPS frag-ok, eredet szerint",
  },
  {
    key: "halado.1.szoveg",
    group: "Tapasztaltaknak",
    label: "1. sor: jobb oldali szöveg",
    type: "text",
    default: "Ausztrália, Indonézia, saját szaporítás",
    sample: true,
  },
  {
    key: "halado.1.link",
    group: "Tapasztaltaknak",
    label: "1. sor: cél",
    type: "link",
    default: "/store",
  },
  {
    key: "halado.2.cim",
    group: "Tapasztaltaknak",
    label: "2. sor: felirat",
    type: "text",
    default: "Laboratóriumi vízmérés",
  },
  {
    key: "halado.2.szoveg",
    group: "Tapasztaltaknak",
    label: "2. sor: jobb oldali szöveg",
    type: "text",
    default: "Mintaleadás a boltban",
  },
  {
    key: "halado.2.link",
    group: "Tapasztaltaknak",
    label: "2. sor: cél",
    type: "link",
    default: "/hamarosan/szolgaltatasok",
  },
  {
    key: "halado.3.cim",
    group: "Tapasztaltaknak",
    label: "3. sor: felirat",
    type: "text",
    default: "Adalékanyagok és nyomelemek",
  },
  {
    key: "halado.3.szoveg",
    group: "Tapasztaltaknak",
    label: "3. sor: jobb oldali szöveg",
    type: "text",
    default: "Fauna Marin, Tropic Marin, Red Sea",
    sample: true,
  },
  {
    key: "halado.3.link",
    group: "Tapasztaltaknak",
    label: "3. sor: cél",
    type: "link",
    default: "/store",
  },
  {
    key: "halado.4.cim",
    group: "Tapasztaltaknak",
    label: "4. sor: felirat",
    type: "text",
    default: "Vezérlés és dózispumpák",
  },
  {
    key: "halado.4.szoveg",
    group: "Tapasztaltaknak",
    label: "4. sor: jobb oldali szöveg",
    type: "text",
    default: "Alkatrész és szerviz is",
  },
  {
    key: "halado.4.link",
    group: "Tapasztaltaknak",
    label: "4. sor: cél",
    type: "link",
    default: "/store",
  },
  {
    key: "halado.gomb.felirat",
    group: "Tapasztaltaknak",
    label: "Gomb: felirat",
    type: "text",
    default: "Friss érkezések",
  },
  {
    key: "halado.gomb.link",
    group: "Tapasztaltaknak",
    label: "Gomb: cél",
    type: "link",
    default: "/store",
  },
  {
    key: "szolg.kep",
    group: "Szolgáltatások",
    label: "Kép",
    type: "image",
    default: "",
  },
  {
    key: "szolg.felirat",
    group: "Szolgáltatások",
    label: "Felirat",
    type: "text",
    default: "Szolgáltatások",
  },
  {
    key: "szolg.cim",
    group: "Szolgáltatások",
    label: "Címsor",
    type: "text",
    default: "Az akváriumod első napjától évekig.",
  },
  {
    key: "szolg.1.cim",
    group: "Szolgáltatások",
    label: "1. szolgáltatás: név",
    type: "text",
    default: "Tervezés és telepítés",
  },
  {
    key: "szolg.1.szoveg",
    group: "Szolgáltatások",
    label: "1. szolgáltatás: leírás",
    type: "text",
    default: "Helyszíni felmérés, technikai terv, összeszerelés és beüzemelés.",
  },
  {
    key: "szolg.1.felirat",
    group: "Szolgáltatások",
    label: "1. szolgáltatás: hivatkozás felirata",
    type: "text",
    default: "Ajánlatot kérek →",
  },
  {
    key: "szolg.1.link",
    group: "Szolgáltatások",
    label: "1. szolgáltatás: cél",
    type: "link",
    default: "/hamarosan/szolgaltatasok",
  },
  {
    key: "szolg.2.cim",
    group: "Szolgáltatások",
    label: "2. szolgáltatás: név",
    type: "text",
    default: "Rendszeres karbantartás",
  },
  {
    key: "szolg.2.szoveg",
    group: "Szolgáltatások",
    label: "2. szolgáltatás: leírás",
    type: "text",
    default:
      "Vízcsere, tisztítás, paraméterek ellenőrzése, heti vagy havi rendben.",
  },
  {
    key: "szolg.2.felirat",
    group: "Szolgáltatások",
    label: "2. szolgáltatás: hivatkozás felirata",
    type: "text",
    default: "Részletek →",
  },
  {
    key: "szolg.2.link",
    group: "Szolgáltatások",
    label: "2. szolgáltatás: cél",
    type: "link",
    default: "/hamarosan/szolgaltatasok",
  },
  {
    key: "szolg.3.cim",
    group: "Szolgáltatások",
    label: "3. szolgáltatás: név",
    type: "text",
    default: "Szerviz",
  },
  {
    key: "szolg.3.szoveg",
    group: "Szolgáltatások",
    label: "3. szolgáltatás: leírás",
    type: "text",
    default: "Szivattyúk, lámpák, fölözők és vezérlők javítása.",
  },
  {
    key: "szolg.3.felirat",
    group: "Szolgáltatások",
    label: "3. szolgáltatás: hivatkozás felirata",
    type: "text",
    default: "Részletek →",
  },
  {
    key: "szolg.3.link",
    group: "Szolgáltatások",
    label: "3. szolgáltatás: cél",
    type: "link",
    default: "/hamarosan/szolgaltatasok",
  },
  {
    key: "szolg.4.cim",
    group: "Szolgáltatások",
    label: "4. szolgáltatás: név",
    type: "text",
    default: "Vízmérés",
  },
  {
    key: "szolg.4.szoveg",
    group: "Szolgáltatások",
    label: "4. szolgáltatás: leírás",
    type: "text",
    default: "Hozd be a mintát, és elmondjuk, mit jelentenek a számok.",
  },
  {
    key: "szolg.4.felirat",
    group: "Szolgáltatások",
    label: "4. szolgáltatás: hivatkozás felirata",
    type: "text",
    default: "Részletek →",
  },
  {
    key: "szolg.4.link",
    group: "Szolgáltatások",
    label: "4. szolgáltatás: cél",
    type: "link",
    default: "/hamarosan/szolgaltatasok",
  },
  {
    key: "markak.felirat",
    group: "Márkák",
    label: "Felirat",
    type: "text",
    default: "Márkák, amelyekkel mi is dolgozunk",
  },
  {
    key: "markak.1",
    group: "Márkák",
    label: "1. márka neve",
    type: "text",
    default: "Red Sea",
    sample: true,
  },
  {
    key: "markak.2",
    group: "Márkák",
    label: "2. márka neve",
    type: "text",
    default: "Tropic Marin",
    sample: true,
  },
  {
    key: "markak.3",
    group: "Márkák",
    label: "3. márka neve",
    type: "text",
    default: "Fauna Marin",
    sample: true,
  },
  {
    key: "markak.4",
    group: "Márkák",
    label: "4. márka neve",
    type: "text",
    default: "Microbe-Lift",
    sample: true,
  },
  {
    key: "markak.osszes.felirat",
    group: "Márkák",
    label: "Összes márka: felirat",
    type: "text",
    default: "Összes márka →",
  },
  {
    key: "markak.osszes.link",
    group: "Márkák",
    label: "Összes márka: cél",
    type: "link",
    default: "",
  },
  {
    key: "velemenyek.cim",
    group: "Vélemények",
    label: "Címsor",
    type: "text",
    default: "Akik már nálunk vásároltak",
    sample: true,
  },
  {
    key: "velemenyek.pont",
    group: "Vélemények",
    label: "Értékelés: pontszám",
    type: "text",
    default: "4,9 / 5",
    sample: true,
  },
  {
    key: "velemenyek.szoveg",
    group: "Vélemények",
    label: "Értékelés: szöveg",
    type: "text",
    default: "312 Google-értékelés",
    sample: true,
  },
  {
    key: "velemenyek.1.idezet",
    group: "Vélemények",
    label: "1. vélemény: idézet",
    type: "text",
    default:
      "„A millepora pontosan olyan színű, mint a fotón. Az átvételnél még tíz percet beszélgettünk az akklimatizálásról.”",
    sample: true,
  },
  {
    key: "velemenyek.1.nev",
    group: "Vélemények",
    label: "1. vélemény: név",
    type: "text",
    default: "Kovács Gergely",
    sample: true,
  },
  {
    key: "velemenyek.1.megjegyzes",
    group: "Vélemények",
    label: "1. vélemény: megjegyzés",
    type: "text",
    default: "egyedi korall vásárlása",
    sample: true,
  },
  {
    key: "velemenyek.2.idezet",
    group: "Vélemények",
    label: "2. vélemény: idézet",
    type: "text",
    default:
      "„Kezdőként jöttem be egy listával, és egy jóval rövidebbel mentem haza. Fél év után sem bántam meg semmit.”",
    sample: true,
  },
  {
    key: "velemenyek.2.nev",
    group: "Vélemények",
    label: "2. vélemény: név",
    type: "text",
    default: "Szabó Anna",
    sample: true,
  },
  {
    key: "velemenyek.2.megjegyzes",
    group: "Vélemények",
    label: "2. vélemény: megjegyzés",
    type: "text",
    default: "első tengeri akvárium",
    sample: true,
  },
  {
    key: "velemenyek.3.idezet",
    group: "Vélemények",
    label: "3. vélemény: idézet",
    type: "text",
    default:
      "„Két éve ők tartják karban a 600 literes rendszerünket. A vízértékekről havonta kapok összefoglalót.”",
    sample: true,
  },
  {
    key: "velemenyek.3.nev",
    group: "Vélemények",
    label: "3. vélemény: név",
    type: "text",
    default: "Tóth Péter",
    sample: true,
  },
  {
    key: "velemenyek.3.megjegyzes",
    group: "Vélemények",
    label: "3. vélemény: megjegyzés",
    type: "text",
    default: "karbantartási szerződés",
    sample: true,
  },
  {
    key: "bolt.felirat",
    group: "A boltunk",
    label: "Felirat",
    type: "text",
    default: "A boltunk",
  },
  {
    key: "bolt.cim",
    group: "A boltunk",
    label: "Címsor",
    type: "text",
    default: "Gyere be, nézd meg élőben.",
  },
  {
    key: "bolt.szoveg",
    group: "A boltunk",
    label: "Bevezető",
    type: "text",
    default:
      "Az élőállatot csak személyesen adjuk át, így biztosan egészségesen és jól csomagolva viszed haza.",
  },
  {
    key: "bolt.cim_felirat",
    group: "A boltunk",
    label: "Cím: felirat",
    type: "text",
    default: "Cím",
  },
  {
    key: "bolt.cim_ertek",
    group: "A boltunk",
    label: "Cím: érték (sortöréssel)",
    type: "text",
    default: "1117 Budapest,\nPélda utca 12.",
    sample: true,
  },
  {
    key: "bolt.nyitva_felirat",
    group: "A boltunk",
    label: "Nyitvatartás: felirat",
    type: "text",
    default: "Nyitvatartás",
  },
  {
    key: "bolt.nyitva_ertek",
    group: "A boltunk",
    label: "Nyitvatartás: érték (sortöréssel)",
    type: "text",
    default: "Hétfő–péntek 10–19\nSzombat 9–14",
    sample: true,
  },
  {
    key: "bolt.gomb.felirat",
    group: "A boltunk",
    label: "Gomb: felirat",
    type: "text",
    default: "Útvonaltervezés",
  },
  {
    key: "bolt.gomb.link",
    group: "A boltunk",
    label: "Gomb: cél (térkép)",
    type: "link",
    default: "",
  },
  {
    key: "bolt.kep",
    group: "A boltunk",
    label: "Kép",
    type: "image",
    default: "",
  },
];

export interface HomepageSlide {
  eyebrow: string;
  title: string;
  text: string;
  cta: string;
  ctaHref: string | null;
  cta2: string;
  cta2Href: string | null;
  caption: string;
  caption2: string;
  imageUrl: string | null;
  imageAlt: string;
}

export interface HomepageContentInput {
  texts: Record<string, string>;
  slides: HomepageSlide[] | null;
}

export interface HomepageContent extends HomepageContentInput {
  updatedAt: string | null;
}

export const HOMEPAGE_LIMITS = {
  textKeys: 400,
  textValue: 2000,
  slides: 5,
  eyebrow: 200,
  title: 300,
  slideText: 1000,
  button: 100,
  caption: 300,
  address: 1000,
  href: 300,
  imageAlt: 300,
} as const;

/**
 * The shop's address rule (commerce #551): one slash, then neither a slash nor
 * a backslash, and no backslash or whitespace anywhere. A browser reads a
 * backslash as a slash in an http(s) address, so `/\evil.example` would leave
 * the shop.
 */
const SHOP_PATH = /^\/(?![/\\])[^\s\\]*$/;
const EXTERNAL = /^https?:\/\/[^\s\\]+$/;

export type HomepageContentParse =
  { ok: true; value: HomepageContentInput } | { ok: false; message: string };

const FIELD = new Map(HOMEPAGE_TEXT_FIELDS.map((field) => [field.key, field]));

/** A link or image address the shop accepts: a shop path, or http(s). Empty is "none". */
export function isSafeHomepageAddress(value: string): boolean {
  return value === "" || SHOP_PATH.test(value) || EXTERNAL.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SLIDE_FIELDS = [
  "eyebrow",
  "title",
  "text",
  "cta",
  "ctaHref",
  "cta2",
  "cta2Href",
  "caption",
  "caption2",
  "imageUrl",
  "imageAlt",
];

function parseSlide(
  value: unknown,
  index: number,
): { ok: true; value: HomepageSlide } | { ok: false; message: string } {
  const where = `slides[${index}]`;
  if (!isRecord(value)) return { ok: false, message: `${where}: an object` };
  const stray = Object.keys(value).find((key) => !SLIDE_FIELDS.includes(key));
  if (stray) return { ok: false, message: `${where}: unknown field ${stray}` };
  const text = (key: string, max: number): string | null => {
    const v = value[key];
    return typeof v === "string" && v.length <= max ? v : null;
  };
  const shopPath = (key: string): string | null | false => {
    const v = value[key];
    if (v === null || v === undefined || v === "") return null;
    return typeof v === "string" &&
      v.length <= HOMEPAGE_LIMITS.href &&
      SHOP_PATH.test(v)
      ? v
      : false;
  };
  const image = (): string | null | false => {
    const v = value.imageUrl;
    if (v === null || v === undefined || v === "") return null;
    return typeof v === "string" &&
      v.length <= HOMEPAGE_LIMITS.address &&
      (SHOP_PATH.test(v) || EXTERNAL.test(v))
      ? v
      : false;
  };
  const eyebrow = text("eyebrow", HOMEPAGE_LIMITS.eyebrow);
  const title = text("title", HOMEPAGE_LIMITS.title);
  const body = text("text", HOMEPAGE_LIMITS.slideText);
  const cta = text("cta", HOMEPAGE_LIMITS.button);
  const cta2 = text("cta2", HOMEPAGE_LIMITS.button);
  const caption = text("caption", HOMEPAGE_LIMITS.caption);
  const caption2 = text("caption2", HOMEPAGE_LIMITS.caption);
  const imageAlt = text("imageAlt", HOMEPAGE_LIMITS.imageAlt);
  if (
    eyebrow === null ||
    title === null ||
    body === null ||
    cta === null ||
    cta2 === null ||
    caption === null ||
    caption2 === null ||
    imageAlt === null
  )
    return {
      ok: false,
      message: `${where}: every text field is a string within its limit`,
    };
  const ctaHref = shopPath("ctaHref");
  const cta2Href = shopPath("cta2Href");
  const imageUrl = image();
  if (ctaHref === false || cta2Href === false)
    return {
      ok: false,
      message: `${where}: a button target is a shop path (/store), nothing else`,
    };
  if (imageUrl === false)
    return {
      ok: false,
      message: `${where}: the image is an http(s) address or a shop path`,
    };
  return {
    ok: true,
    value: {
      eyebrow,
      title,
      text: body,
      cta,
      ctaHref,
      cta2,
      cta2Href,
      caption,
      caption2,
      imageUrl,
      imageAlt,
    },
  };
}

/**
 * The editor's save. Strict, like the shop's validator: a key that is not in
 * the catalogue, a link or image that is not a shop path or http(s), a sixth
 * slide or an unknown slide field is refused, so what the OS stores is what
 * the shop accepts.
 */
export function parseHomepageContentInput(body: unknown): HomepageContentParse {
  if (!isRecord(body))
    return { ok: false, message: "the content is an object" };
  const stray = Object.keys(body).find(
    (key) => key !== "texts" && key !== "slides",
  );
  if (stray) return { ok: false, message: `unknown field ${stray}` };
  if (!isRecord(body.texts)) return { ok: false, message: "texts: an object" };
  const keys = Object.keys(body.texts);
  if (keys.length > HOMEPAGE_LIMITS.textKeys)
    return {
      ok: false,
      message: `texts: at most ${HOMEPAGE_LIMITS.textKeys}`,
    };
  const texts: Record<string, string> = {};
  for (const key of keys) {
    const field = FIELD.get(key);
    if (!field) return { ok: false, message: `texts: unknown key ${key}` };
    const value = body.texts[key];
    if (typeof value !== "string" || value.length > HOMEPAGE_LIMITS.textValue)
      return {
        ok: false,
        message: `texts.${key}: a string, at most ${HOMEPAGE_LIMITS.textValue} characters`,
      };
    if (field.type !== "text" && !isSafeHomepageAddress(value))
      return {
        ok: false,
        message: `texts.${key}: a shop path (/store) or an http(s) address`,
      };
    texts[key] = value;
  }
  if (body.slides === null) return { ok: true, value: { texts, slides: null } };
  if (!Array.isArray(body.slides))
    return { ok: false, message: "slides: null or a list" };
  if (body.slides.length > HOMEPAGE_LIMITS.slides)
    return {
      ok: false,
      message: `slides: at most ${HOMEPAGE_LIMITS.slides}`,
    };
  const slides: HomepageSlide[] = [];
  for (const [index, raw] of body.slides.entries()) {
    const parsed = parseSlide(raw, index);
    if (!parsed.ok) return parsed;
    slides.push(parsed.value);
  }
  return { ok: true, value: { texts, slides } };
}
