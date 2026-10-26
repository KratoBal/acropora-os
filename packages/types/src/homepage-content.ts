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
/**
 * `short` (2b-3, Balázs's brief point 4; commerce #571): formatted text in the
 * shared sanitizer's SHORT profile (paragraph, bold, italic, link, lists), at
 * the places the storefront draws as HTML (`ROVID_KULCSOK` there).
 */
export type HomepageFieldType = "text" | "short" | "link" | "image";

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
    type: "short",
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
    type: "short",
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
    type: "short",
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
    type: "short",
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

/**
 * THE HOME PAGE BLOCKS, in the order the storefront draws them today
 * (acropora-commerce 913e882, `app/[countryCode]/(kezdolap)/page.tsx`).
 * Balázs, 2026-10-26 07:50 UTC (msg 1564184455143235585): the admin decides
 * which blocks show and in what order. "kezdo-es-halado" is ONE block because
 * the storefront draws the beginner and the advanced band in one component.
 */
export const HOMEPAGE_BLOCK_KEYS = [
  "hero",
  "mit-keresel",
  "kezdo-es-halado",
  "egyedi-korallok",
  "szolgaltatasok",
  "markak",
  "velemenyek",
  "boltunk",
] as const;
export type HomepageBlockKey = (typeof HOMEPAGE_BLOCK_KEYS)[number];

/** One block of the page: shown or hidden. The list order is the page order. */
export interface HomepageBlock {
  key: HomepageBlockKey;
  visible: boolean;
}

export interface HomepageFooterLink {
  label: string;
  href: string;
}

export interface HomepageFooterColumn {
  title: string;
  links: HomepageFooterLink[];
}

/**
 * THE FOOTER (Balázs, 2026-10-26 07:52 UTC, msg 1564184987555729468): edited
 * in the home page admin, shown on every storefront page (murena,
 * `commerce-fejlec-lablec-aloldalak`).
 *
 * WHAT IS NOT HERE, ON PURPOSE:
 *   contact, opening hours   they come from the "A boltunk" texts, so the page
 *                            never shows two different addresses
 *   legal documents          the storefront always adds them (a legal duty,
 *                            not an editorial choice)
 *
 * `intro` is rich text in the shared sanitizer's `full` profile; the API
 * sanitizes it on save (this package does not depend on the sanitizer).
 */
export interface HomepageFooter {
  intro: string;
  columns: HomepageFooterColumn[];
  social: {
    facebook: string | null;
    instagram: string | null;
    youtube: string | null;
  };
  bottomText: string;
}

export interface HomepageContentInput {
  texts: Record<string, string>;
  slides: HomepageSlide[] | null;
  /**
   * `null`: not set, the storefront's own order with every block shown. A list
   * names EVERY block exactly once. ABSENT in a save means "leave it as it is",
   * so an editor that does not know the field cannot wipe it.
   */
  blocks?: HomepageBlock[] | null;
  /** `null`: the storefront's own footer. Absent in a save: unchanged. */
  footer?: HomepageFooter | null;
}

export interface HomepageContent extends HomepageContentInput {
  blocks: HomepageBlock[] | null;
  footer: HomepageFooter | null;
  /**
   * The image hosts a full-profile text may show (`RICH_TEXT_IMAGE_HOSTS`):
   * the editor and the preview get the SAME list the save uses, so the preview
   * never shows an image the save would drop (barracuda, #1877).
   */
  imageHosts: string[];
  /**
   * The test storefront's origin (`HOMEPAGE_STOREFRONT_URL`), only where the
   * environment allows writing to the shop; `null` elsewhere. The admin's
   * "Előnézet új lapon" and its live preview frame point here.
   */
  storefrontUrl: string | null;
  updatedAt: string | null;
  /**
   * The administrator's switch in the editor: send the content to the web shop
   * (and let the editor upload images to it). It takes effect ONLY where the
   * environment allows it too (`projectionAllowed`).
   */
  projectionEnabled: boolean;
  /**
   * Whether this ENVIRONMENT allows writing to the web shop
   * (`MEDUSA_PROJECT_HOMEPAGE_CONTENT=true`). Production OS has it off, so the
   * switch there does nothing and the editor says so; the commerce exception
   * covers the test shop only (acrobot 33495, barracuda #1721).
   */
  projectionAllowed: boolean;
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
  footerIntro: 4000,
  footerColumns: 4,
  footerLinks: 12,
  footerLabel: 100,
  footerBottomText: 300,
} as const;

/**
 * The shop's address rule (commerce #551): one slash, then neither a slash nor
 * a backslash, and no backslash or whitespace anywhere. A browser reads a
 * backslash as a slash in an http(s) address, so `/\evil.example` would leave
 * the shop.
 */
const SHOP_PATH = /^\/(?![/\\])[^\s\\]*$/;

/** The rule as the user reads it, under the field and in the save's alert. */
export const SHOP_HREF_RULE =
  "csak a webshop egy oldala lehet, perjellel kezdve (pl. /hu/categories/korallok), vagy üresen hagyva; más webhelyre mutató link nem.";
const EXTERNAL = /^https?:\/\/[^\s\\]+$/;

export type HomepageContentParse =
  { ok: true; value: HomepageContentInput } | { ok: false; message: string };

const FIELD = new Map(HOMEPAGE_TEXT_FIELDS.map((field) => [field.key, field]));

/**
 * WHETHER A VALUE IS SHORT-PROFILE HTML, by the storefront's own test (commerce
 * #571, `htmlAlaku`): a tag of the short profile anywhere. Only such a value is
 * cleaned as HTML; plain text stays plain, because cleaning would escape it
 * (`a < b` -> `a &lt; b`) and the storefront shows a non-HTML value as text.
 */
export const SHORT_HTML_TAG =
  /<\/?(p|br|strong|b|em|i|ul|ol|li|a)(\s[^>]*)?\/?>/i;

export function looksLikeShortHtml(value: string): boolean {
  return SHORT_HTML_TAG.test(value);
}

/** The catalogue keys whose value is short-profile formatted text. */
export function isShortTextKey(key: string): boolean {
  return FIELD.get(key)?.type === "short";
}

/** Whether a button target passes: empty ("no button") or a shop path. */
export function isShopHref(value: string): boolean {
  return value === "" || SHOP_PATH.test(value);
}

/**
 * A BUTTON TARGET AS THE EDITOR ACCEPTS IT, IN THE SHOP'S OWN FORM (Balázs,
 * 2026-10-26, Commerce thread, msg 1564310966211055778; acrobot 36371). The
 * stored and sent form stays the shop's rule (commerce `cta_href`, the same
 * `SHOP_PATH` on both sides); this only brings what people type to it:
 *
 * - a full address on the shop's own host (`shopHosts`, e.g. the test shop)
 *   becomes its path: `https://shop/hu/categories/x?y#z` -> `/hu/categories/x?y#z`;
 * - a path typed without its first slash gets one: `hu/categories/x`;
 * - anything else stays as it is, so the check refuses it by name: another
 *   site's address, `//host`, `javascript:`, a backslash or whitespace.
 *
 * Empty stays empty ("no button").
 */
export function normalizeShopHref(
  value: string,
  shopHosts: readonly string[],
): string {
  const v = value.trim();
  if (v === "" || v.startsWith("/")) return v;
  if (/^https?:\/\//i.test(v)) {
    try {
      const url = new URL(v);
      const host = url.hostname.toLowerCase();
      if (shopHosts.some((own) => own.toLowerCase() === host))
        return `${url.pathname}${url.search}${url.hash}` || "/";
    } catch {
      return v;
    }
    return v;
  }
  // a scheme or a host-looking first segment is not a path
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) || /^[^/]+\.[a-z]{2,}(\/|$)/i.test(v))
    return v;
  return `/${v}`;
}

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
  // the user reads these (the save's alert), so they name the slide and the
  // field in Hungarian (acrobot 36371)
  const slideNo = `${index + 1}. dia`;
  if (ctaHref === false || cta2Href === false)
    return {
      ok: false,
      message: `${slideNo}, ${ctaHref === false ? "első" : "második"} gomb célja: ${SHOP_HREF_RULE}`,
    };
  if (imageUrl === false)
    return {
      ok: false,
      message: `${slideNo}, kép címe: http(s) cím vagy a webshop egy útvonala lehet.`,
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

/** Every block exactly once, nothing else; the list order is the page order. */
function parseBlocks(
  value: unknown,
):
  { ok: true; value: HomepageBlock[] | null } | { ok: false; message: string } {
  if (value === null) return { ok: true, value: null };
  if (!Array.isArray(value))
    return { ok: false, message: "blocks: null or a list" };
  const blocks: HomepageBlock[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of value.entries()) {
    const where = `blocks[${index}]`;
    if (!isRecord(raw)) return { ok: false, message: `${where}: an object` };
    const stray = Object.keys(raw).find(
      (key) => key !== "key" && key !== "visible",
    );
    if (stray)
      return { ok: false, message: `${where}: unknown field ${stray}` };
    const key = raw.key;
    if (
      typeof key !== "string" ||
      !(HOMEPAGE_BLOCK_KEYS as readonly string[]).includes(key)
    )
      return { ok: false, message: `${where}: unknown block` };
    if (seen.has(key))
      return { ok: false, message: `${where}: ${key} is listed twice` };
    if (typeof raw.visible !== "boolean")
      return { ok: false, message: `${where}: visible is true or false` };
    seen.add(key);
    blocks.push({ key: key as HomepageBlockKey, visible: raw.visible });
  }
  const missing = HOMEPAGE_BLOCK_KEYS.find((key) => !seen.has(key));
  if (missing) return { ok: false, message: `blocks: ${missing} is missing` };
  return { ok: true, value: blocks };
}

const optionalExternal = (v: unknown): string | null | false => {
  if (v === null || v === undefined || v === "") return null;
  return typeof v === "string" &&
    v.length <= HOMEPAGE_LIMITS.href &&
    EXTERNAL.test(v)
    ? v
    : false;
};

function parseFooter(
  value: unknown,
): { ok: true; value: HomepageFooter | null } | { ok: false; message: string } {
  if (value === null) return { ok: true, value: null };
  if (!isRecord(value))
    return { ok: false, message: "footer: null or an object" };
  const stray = Object.keys(value).find(
    (key) => !["intro", "columns", "social", "bottomText"].includes(key),
  );
  if (stray) return { ok: false, message: `footer: unknown field ${stray}` };
  const { intro, columns, social, bottomText } = value;
  if (typeof intro !== "string" || intro.length > HOMEPAGE_LIMITS.footerIntro)
    return {
      ok: false,
      message: `footer.intro: a string, at most ${HOMEPAGE_LIMITS.footerIntro} characters`,
    };
  if (
    typeof bottomText !== "string" ||
    bottomText.length > HOMEPAGE_LIMITS.footerBottomText
  )
    return {
      ok: false,
      message: `footer.bottomText: a string, at most ${HOMEPAGE_LIMITS.footerBottomText} characters`,
    };
  if (!Array.isArray(columns) || columns.length > HOMEPAGE_LIMITS.footerColumns)
    return {
      ok: false,
      message: `footer.columns: a list, at most ${HOMEPAGE_LIMITS.footerColumns}`,
    };
  const parsedColumns: HomepageFooterColumn[] = [];
  for (const [index, column] of columns.entries()) {
    const where = `footer.columns[${index}]`;
    if (!isRecord(column)) return { ok: false, message: `${where}: an object` };
    const strayColumn = Object.keys(column).find(
      (key) => key !== "title" && key !== "links",
    );
    if (strayColumn)
      return { ok: false, message: `${where}: unknown field ${strayColumn}` };
    if (
      typeof column.title !== "string" ||
      !column.title.trim() ||
      column.title.length > HOMEPAGE_LIMITS.footerLabel
    )
      // non-empty, like the commerce validator (#564, barracuda 36073)
      return {
        ok: false,
        message: `${where}.title: a short, non-empty string`,
      };
    if (
      !Array.isArray(column.links) ||
      column.links.length > HOMEPAGE_LIMITS.footerLinks
    )
      return {
        ok: false,
        message: `${where}.links: a list, at most ${HOMEPAGE_LIMITS.footerLinks}`,
      };
    const links: HomepageFooterLink[] = [];
    for (const [linkIndex, link] of column.links.entries()) {
      const at = `${where}.links[${linkIndex}]`;
      if (
        !isRecord(link) ||
        Object.keys(link).some((key) => key !== "label" && key !== "href")
      )
        return { ok: false, message: `${at}: { label, href }` };
      if (
        typeof link.label !== "string" ||
        !link.label.trim() ||
        link.label.length > HOMEPAGE_LIMITS.footerLabel
      )
        return { ok: false, message: `${at}.label: a short, non-empty string` };
      if (
        typeof link.href !== "string" ||
        !link.href ||
        link.href.length > HOMEPAGE_LIMITS.href ||
        !isSafeHomepageAddress(link.href)
      )
        return {
          ok: false,
          message: `${at}.href: a shop path (/store) or an http(s) address`,
        };
      links.push({ label: link.label, href: link.href });
    }
    parsedColumns.push({ title: column.title, links });
  }
  if (!isRecord(social))
    return { ok: false, message: "footer.social: an object" };
  const straySocial = Object.keys(social).find(
    (key) => !["facebook", "instagram", "youtube"].includes(key),
  );
  if (straySocial)
    return {
      ok: false,
      message: `footer.social: unknown field ${straySocial}`,
    };
  const facebook = optionalExternal(social.facebook);
  const instagram = optionalExternal(social.instagram);
  const youtube = optionalExternal(social.youtube);
  if (facebook === false || instagram === false || youtube === false)
    return {
      ok: false,
      message: "footer.social: every link is an http(s) address or empty",
    };
  return {
    ok: true,
    value: {
      intro,
      columns: parsedColumns,
      social: { facebook, instagram, youtube },
      bottomText,
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
    (key) => !["texts", "slides", "blocks", "footer"].includes(key),
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
    if (
      (field.type === "link" || field.type === "image") &&
      !isSafeHomepageAddress(value)
    )
      return {
        ok: false,
        message: `texts.${key}: a shop path (/store) or an http(s) address`,
      };
    texts[key] = value;
  }
  /* ABSENT blocks / footer: the save leaves the stored value as it is. */
  const extra: Pick<HomepageContentInput, "blocks" | "footer"> = {};
  if ("blocks" in body) {
    const blocks = parseBlocks(body.blocks);
    if (!blocks.ok) return blocks;
    extra.blocks = blocks.value;
  }
  if ("footer" in body) {
    const footer = parseFooter(body.footer);
    if (!footer.ok) return footer;
    extra.footer = footer.value;
  }
  if (body.slides === null)
    return { ok: true, value: { texts, slides: null, ...extra } };
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
  return { ok: true, value: { texts, slides, ...extra } };
}
