import type { ThemeTokens } from "./tokens";

/**
 * SAJÁT, SZŰK TÍPUS -- NEM `TextStyle` A `react-native`-BŐL.
 *
 * MÉRVE (2026-09-25): egy `import type { TextStyle } from "react-native"`
 * ide, ebbe a NEM-komponens fájlba, a teszt-fordítás EGÉSZ programjába
 * behúzza a React Native globális típusait -- és azok a Node/DOM `FormData`
 * típusát egy szűkebbre cserélik (nincs `.get()`/`.getAll()`), amitől egy
 * TELJESEN FÜGGETLEN spec (`document-upload.spec.ts`) elhasal. Ugyanaz a
 * család, mint a korábban mért `expo-import-tipus-behuzas` eset: a
 * feloldás ott is "require + saját interfész" volt, itt pedig "saját
 * interfész importálás nélkül" -- a mezőnevek megegyeznek a
 * `StyleSheet.create()` várt alakjával, tehát a hívó helyeken a
 * szerkezeti egyezés elég, RN-típus nélkül is.
 */
type FontWeight =
  | "normal"
  | "bold"
  | "100"
  | "200"
  | "300"
  | "400"
  | "500"
  | "600"
  | "700"
  | "800"
  | "900";

interface LabelSize {
  fontSize: number;
  fontWeight: FontWeight;
  letterSpacing: number;
  textTransform?: "uppercase";
}

interface LabelStyle extends LabelSize {
  color: string;
}

interface BadgeStyle {
  backgroundColor: string;
  borderRadius: number;
  color: string;
  fontSize: number;
  fontWeight: FontWeight;
  overflow: "hidden";
  paddingHorizontal: number;
  paddingVertical: number;
}

/**
 * A SZAKASZCÍM ("EYEBROW") KÖZÖS RÉSZE -- EGY HELYEN, NEM KÉPERNYŐNKÉNT
 * ÚJRAÍRVA.
 *
 * acrobot kérése, 2026-09-25 (msg 23921): a badge- és eyebrow-szín hiánya
 * ismétlődő, több képernyős minta volt -- nyolc előfordulás hét fájlban --,
 * és NEM hat külön folt kellett rá, hanem egy közös megoldás.
 *
 * MIÉRT CSAK A SZÍN KÖZÖS, A MÉRET/VASTAGSÁG/BETŰKÖZ NEM: acrobot korábbi
 * döntése (23888) szerint minden képernyő a SAJÁT tervkörét követi a
 * számokban -- a mért esetek 11px/900/1.4, 12px/800/1.2 és 12px/600/1.2
 * (uppercase-szel) formában térnek el, VALÓDI tervkör-különbségek, nem hiba.
 * Ami viszont minden mért előfordulásban egyezett (a `queue-resolve/[id].tsx`
 * SAJÁT, dokumentált kék árnyalatú eyebrow-ját leszámítva, amit ez a
 * függvény ezért nem is használ): a szín `grey-400`, azaz `t.textMuted`.
 */
export function eyebrowStyle(t: ThemeTokens, size: LabelSize): LabelStyle {
  return { color: t.textMuted, ...size };
}

/**
 * A SZÍNES ÁLLAPOT-JELVÉNY KÖZÖS STÍLUSA.
 *
 * Ugyanaz a recept, amit a hibajegy-lista már használt a "Karbantartás"
 * jelzőn (`service-jobs/index.tsx`) -- most a hibajegy STÁTUSZ (lista és
 * adatlap) és a szkenner "Szabad matrica" címkéje is ezt kapja, statuszonként
 * azonos színnel, nem egy új, hattónusú (web-oldali `serviceJobStatusTone`)
 * rendszerrel: a mobil témakészlet ma nem hordoz lila/zöld tokent, és egy
 * teljes szín-parity a webbel önálló döntés lenne, nem ennek a foltnak a
 * tárgya.
 *
 * AZ `alignSelf` SZÁNDÉKOSAN NINCS ITT: a hívó dönti el, a saját
 * elrendezésében kell-e (a hibajegy-lista/adatlap sorban igen, a szkenner
 * középre rendezett kártyáján nem).
 */
export function statusBadgeStyle(t: ThemeTokens): BadgeStyle {
  return {
    backgroundColor: t.accentSoft,
    borderRadius: 999,
    color: t.accentSoftText,
    fontSize: 12,
    fontWeight: "600",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 3,
  };
}
