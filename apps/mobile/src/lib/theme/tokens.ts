/**
 * A VILÁGOS ÉS SÖTÉT SZÍN-TOKENEK -- a Figma 4. kör tervéből
 * (`exchange/figma-akvariumok-make-4/src/SzinekScreen.tsx`), Balázs
 * 2026-09-24 15:59-i döntése alapján (emlék 1816): ez az app-szintű
 * színrendszer ALAPJA, nem csak az akvárium-képernyőké.
 *
 * EBBEN A KÖRBEN CSAK AZ AKVÁRIUM-KÉPERNYŐK ÉPÜLNEK RÁ (lista, adatlap, új
 * vízmérés, Nincs kapcsolat sáv). A telefon többi képernyője MA SÖTÉT, és
 * SZÁNDÉKOSAN nem ezekből a tokenekből él -- ha egyszer átépül, ugyanezt a
 * fájlt bővíti, nem egy másikat.
 *
 * A DARK KÉSZLET NEM AZONOS A KORÁBBI (make-2 köri) EGYEDI HEX-EKKEL
 * (#071827 stb.): ez a Figma SAJÁT, tudatosan tervezett sötét skálája
 * (grey-50 = #0f1c20), nem a korábbi kör rögtönzött sötétje. A "maradjon
 * helyes sötétben" (acrobot kérése) tehát nem bitre-azonos megjelenést kér,
 * hanem hogy a sötét mód TOVÁBBRA IS sötét és olvasható maradjon -- ez az.
 *
 * KÉT TOKEN NINCS A FIGMA-FORRÁSBAN: `danger`/`dangerSoft`. A `SzinekScreen`
 * csak szürke/teal/felület/amber táblát ad, piros hibaszínt nem -- ezeket
 * a mai app piros hibaszíneinek (#fecaca/#fca5a5/#541b2b) szellemében,
 * a design rendszer többi tokenjének mintáját követve (sötétben fényesebb
 * árnyalat, telt alfa-hátterű "soft" pár) saját belátásból választottam.
 */

export interface ThemeTokens {
  /** Az oldal háttere. */
  background: string;
  /** Kártyák, fejléc-sáv, alsó tabsor. */
  surface: string;
  /** Egy szinttel a `surface` fölött -- ma nincs mobil felhasználója
   * (nincs drawer/dialog a natív `Alert.alert` mellett), de a közös
   * tokenkészlet része, a webbel egyező névvel. */
  surfaceRaised: string;
  /** Keret és elválasztó -- a Figma-rendszerben ugyanaz a token mindkettőre
   * (`grey-200`, "Elválasztók, keret (ring)"). */
  border: string;
  /** Legfontosabb szöveg, fejlécek. */
  textPrimary: string;
  /** Másodlagos szöveg (feliratok, meta-sorok). */
  textSecondary: string;
  /** Halvány szöveg, placeholder, "nincs adat" jellegű sorok. */
  textMuted: string;
  /** Szöveg az akcent-színű felületeken (pl. elsődleges gomb felirata). */
  textOnAccent: string;
  /** A teal akcent, elsődleges gombok és aktív állapotok háttere. */
  accent: string;
  /** Nyomva tartott/aktív állapot a `accent` fölött. */
  accentPressed: string;
  /** Jelvény/chip halvány háttere. */
  accentSoft: string;
  /** Szöveg az `accentSoft` háttéren. */
  accentSoftText: string;
  /** Keret az `accentSoft` jelvényeken. */
  accentBorder: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
}

export const LIGHT_THEME: ThemeTokens = {
  background: "#f7f8fa",
  surface: "#ffffff",
  surfaceRaised: "#ffffff",
  border: "#e2e5e9",
  textPrimary: "#0f1a1c",
  textSecondary: "#4f5a68",
  textMuted: "#9ba3ae",
  textOnAccent: "#ffffff",
  accent: "#0b7a6e",
  accentPressed: "#0a5148",
  accentSoft: "#f0faf8",
  accentSoftText: "#0a6359",
  accentBorder: "#a3e0d6",
  warning: "#d97706",
  warningSoft: "#fffbeb",
  danger: "#dc2626",
  dangerSoft: "#fef2f2",
};

export const DARK_THEME: ThemeTokens = {
  background: "#0f1c20",
  surface: "#162028",
  surfaceRaised: "#1e2c36",
  border: "#1e3038",
  textPrimary: "#e5f0f3",
  textSecondary: "#8db5c6",
  textMuted: "#486070",
  textOnAccent: "#ffffff",
  accent: "#0fb3a4",
  accentPressed: "#6dddd5",
  accentSoft: "#0b2e2a",
  accentSoftText: "#3cc9bc",
  accentBorder: "#175248",
  warning: "#f59e0b",
  warningSoft: "rgba(120, 70, 0, 0.25)",
  danger: "#f87171",
  dangerSoft: "rgba(153, 27, 27, 0.25)",
};

export type ColorScheme = "light" | "dark";

export function themeTokensFor(scheme: ColorScheme): ThemeTokens {
  return scheme === "light" ? LIGHT_THEME : DARK_THEME;
}
