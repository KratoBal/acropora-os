/**
 * A WEBSHOP VEVŐI SZÖVEGEI (kártya 7bfca4eb; Balázs, 2026-11-24: „minden a vevőknek szóló email és egyéb kommunikáció
 * szövegeit mi szeretnénk szerkeszthetőben látni”, és „ne összevissza legyenek … logikusan felépített felület”). A kirakat
 * szövegei a vevő útja szerinti csoportokban; a webshop tárolja a felülírást kulcsonként és nyelvenként (commerce #888), és
 * az alapérték a kirakat szótára (a webshop küldi, az OS nem tart másolatot).
 */

export const WEBSHOP_CUSTOMER_TEXT_LOCALES = ["hu", "en"] as const;
export type WebshopCustomerTextLocale =
  (typeof WEBSHOP_CUSTOMER_TEXT_LOCALES)[number];

/** A webshop határa (commerce `CUSTOMER_TEXT_MAX_LENGTH`): egy bemásolt oldal nem vevői szöveg. */
export const WEBSHOP_CUSTOMER_TEXT_MAX_LENGTH = 4000;

/**
 * A LAP CSOPORTJAI A VEVŐ ÚTJA SZERINT, a lap sorrendjében (acrobot 60632). A `levelek` csoport nem a webshop szövege: a
 * webshop levelei az OS Levélsablonjai között élnek, a csoport oda visz. A többi azonosítója a webshop katalógusáé.
 */
export const WEBSHOP_CUSTOMER_TEXT_GROUPS = [
  {
    id: "penztar",
    title: "Pénztár",
    description:
      "A kosár, a kosár-menü és a pénztár lépései: szállítás, fizetés, összesítés.",
  },
  {
    id: "rendeles-leadva",
    title: "Rendelés leadva",
    description: "A köszönő oldal a rendelés leadása után.",
  },
  {
    id: "rendeles-allapota",
    title: "Rendelés állapota",
    description:
      "A rendelés megtekintése belépés nélkül: keresés, állapot, fizetés, számla, visszatérítés.",
  },
  {
    id: "levelek",
    title: "Levelek",
    description:
      "A webshop vevőnek küldött levelei: a Levélsablonok webshop csoportjában szerkeszthetők.",
  },
  {
    id: "elallas",
    title: "Elállás és visszatérítés",
    description: "Az elállási nyilatkozat űrlapja és a visszaigazolása.",
  },
  {
    id: "hibabejelentes",
    title: "Hibabejelentés",
    description: "A hibás vagy hiányos termék bejelentése.",
  },
  {
    id: "fiok",
    title: "Fiók",
    description: "Belépés, regisztráció, rendelések, adatok, címek, jelszó.",
  },
  {
    id: "hirlevel",
    title: "Hírlevél és készletfigyelő",
    description:
      "Feliratkozás, megerősítés, leiratkozás, a „szólj, ha jön” és az érkező állatok.",
  },
  {
    id: "suti",
    title: "Süti-hozzájárulás",
    description: "A süti-ablak és a beállításai.",
  },
] as const;
export type WebshopCustomerTextGroup =
  (typeof WEBSHOP_CUSTOMER_TEXT_GROUPS)[number]["id"];

/** Hová visz a `levelek` csoport: a Levélsablonok webshop füle. */
export const WEBSHOP_CUSTOMER_MAIL_TEMPLATES_HREF =
  "/beallitasok/levelsablonok?csoport=webshop";

/** Egy szöveg: a kulcsa, a csoportja, a szótár alapértéke és a tárolt felülírás nyelvenként (`null`: nincs, az alap áll). */
export type WebshopCustomerText = {
  key: string;
  group: string;
  defaults: Record<WebshopCustomerTextLocale, string>;
  overrides: Record<WebshopCustomerTextLocale, string | null>;
};

export type WebshopCustomerTexts = { texts: WebshopCustomerText[] };

/** Egy mentés: egy kulcs egy nyelven; a `null` a felülírás törlése (vissza az alapértékre). */
export type WebshopCustomerTextInput = {
  key: string;
  locale: WebshopCustomerTextLocale;
  value: string | null;
};

export type WebshopCustomerTextParse =
  { ok: true; value: WebshopCustomerTextInput } | { ok: false; error: string };

/** A `{név}` helyek, rendezve, egyszer: ezeket tölti ki a kirakat (rendelésszám, hivatkozás). A webshop szabályával egyezik. */
export const customerTextSlots = (text: string): string[] =>
  [...new Set(text.match(/\{[A-Za-z_][A-Za-z0-9_]*\}/g) ?? [])].sort();

/**
 * MIÉRT NEM MENTHETŐ EGY SZÖVEG, vagy `null` (a webshop ugyanígy dönt, és ott is elutasítaná; itt az ember nyelvén áll). A
 * `{név}` helyeknek egyezniük kell az alapértékével: egy elhagyott `{id}` a vevő hivatkozását tüntetné el, egy kitalált
 * `{valami}` szó szerint látszana.
 */
export function customerTextProblem(
  defaultText: string,
  value: string,
): string | null {
  const trimmed = value.trim();
  if (!trimmed)
    return "Üres szöveg nem menthető; az alapértékhez a „Vissza az alapra” visz.";
  if (trimmed.length > WEBSHOP_CUSTOMER_TEXT_MAX_LENGTH)
    return `Legfeljebb ${WEBSHOP_CUSTOMER_TEXT_MAX_LENGTH} karakter lehet.`;
  const want = customerTextSlots(defaultText);
  const got = customerTextSlots(trimmed);
  if (want.join() !== got.join())
    return want.length
      ? `A szövegben pontosan ezeknek a helyeknek kell állniuk: ${want.join(", ")}.`
      : "Ebben a szövegben nem lehet {…} hely.";
  return null;
}

/** Egy mentés alakja (az API bemenete): ismert nyelv, nem üres kulcs, szöveg vagy `null`, a határon belül. */
export function parseWebshopCustomerTextInput(
  raw: unknown,
): WebshopCustomerTextParse {
  if (!raw || typeof raw !== "object")
    return { ok: false, error: "Hiányzik a mentendő szöveg." };
  const { key, locale, value } = raw as Record<string, unknown>;
  if (typeof key !== "string" || !key.trim() || key.length > 200)
    return { ok: false, error: "Hiányzik a szöveg azonosítója." };
  if (
    typeof locale !== "string" ||
    !(WEBSHOP_CUSTOMER_TEXT_LOCALES as readonly string[]).includes(locale)
  )
    return { ok: false, error: "A nyelv csak hu vagy en lehet." };
  if (value !== null && typeof value !== "string")
    return { ok: false, error: "A szöveg hiányzik." };
  if (typeof value === "string") {
    if (!value.trim())
      return {
        ok: false,
        error:
          "Üres szöveg nem menthető; az alapértékhez a „Vissza az alapra” visz.",
      };
    if (value.trim().length > WEBSHOP_CUSTOMER_TEXT_MAX_LENGTH)
      return {
        ok: false,
        error: `Legfeljebb ${WEBSHOP_CUSTOMER_TEXT_MAX_LENGTH} karakter lehet.`,
      };
  }
  return {
    ok: true,
    value: {
      key,
      locale: locale as WebshopCustomerTextLocale,
      value: typeof value === "string" ? value.trim() : null,
    },
  };
}

const fold = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * A KERESŐ (acrobot 60632: „688 szöveg egy listában használhatatlan”): a kulcsban, az alapértékben és a felülírásban keres,
 * mindkét nyelven, kis- és nagybetűtől és ékezettől függetlenül. Üres kérdésre minden szöveg.
 */
export function searchWebshopCustomerTexts(
  texts: readonly WebshopCustomerText[],
  query: string,
): WebshopCustomerText[] {
  const q = fold(query.trim());
  if (!q) return [...texts];
  return texts.filter((text) =>
    [
      text.key,
      text.defaults.hu,
      text.defaults.en,
      text.overrides.hu ?? "",
      text.overrides.en ?? "",
    ].some((field) => fold(field).includes(q)),
  );
}
