import { useMemo, type ReactNode } from "react";
import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";

import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";

/**
 * A KÁRTYA-CSOPORT CÍMKÉJE, EGY HELYEN, A TERV SZERINT.
 *
 * Balázs döntése (2026-09-25 19:02, mobil szál): a Figma terv kártya-
 * címkéje (`MobileLabel`, `exchange/figma-telefon-make-12/src/
 * MobileAppScreen.tsx` 54-60. sor: `text-xs font-semibold text-grey-400
 * uppercase tracking-widest`) MINDEN mobil adatlapon egyformán jelenjen
 * meg -- nem képernyőnként külön másolt stílusként, mert az idővel
 * szétcsúszik (pontosan ez történt: az öt érintett adatlap öt KÜLÖNBÖZŐ
 * `sectionTitle`-t viselt: 16px/900, alapméret/600, 19px/800 stb., egyik
 * sem a terv szerint).
 *
 * EZÉRT KÖZÖS KOMPONENS, NEM CSAK KÖZÖS STÍLUS-KONSTANS: egy
 * `sectionTitle: {...}` bejegyzés minden képernyő saját `createStyles()`-
 * ében ugyanúgy szétcsúszhatna egy következő, csak egy-két lapot érintő
 * javításnál -- egyetlen komponens viszont szerkezetileg kizárja, hogy
 * bármelyik hívóhely a többitől eltérő stílust kapjon.
 *
 * UGYANAZ A MINTA, MINT AZ `OfflineNoticeCard`/`WorksheetAssetPicker`:
 * önálló `useAppTheme()`+`useMemo()` hívás, nem a hívó `styles`
 * zárványából dolgozik.
 */
export function SectionTitle({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return <Text style={[styles.sectionTitle, style]}>{children}</Text>;
}

function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    sectionTitle: {
      color: t.textMuted,
      fontSize: 12,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 1,
    },
  });
}
