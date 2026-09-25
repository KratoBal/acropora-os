import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { listAssets } from "@/lib/api/assets";
import {
  describeSelectableAssets,
  toggleWorksheetAsset,
} from "@/lib/worksheets/worksheet-assets";
import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";

/**
 * AZ "ÉRINTETT ESZKÖZÖK" JELÖLŐLISTA, EGY PÉLDÁNYBAN, KÉT URLAPNAK.
 *
 * Balázs 2026-09-25 15:46-i jelentése: az új munkalap felviteli űrlapon
 * eddig nem lehetett eszközt hozzáadni, csak a hibajegyről öröklődő lista
 * ment fel, láthatatlanul és szerkeszthetetlenül. Ez a komponens a
 * `worksheets/[id].tsx` adatlapon MÁR MŰKÖDŐ szerkesztő listája -- ugyanaz
 * a lekérdezés (helyszín szerint szűrt, aktív eszközök, `listAssets(1, 100,
 * "", departmentId, "ACTIVE")`), ugyanaz a jelölés/kijelölés-váltás
 * (`toggleWorksheetAsset`), ugyanaz az üres/hiba/töltés-üzenet
 * (`describeSelectableAssets`).
 *
 * NINCS BENNE SZABAD SZÖVEGES KERESŐ VAGY KÜLÖN HELYSZÍN-VÁLASZTÓ: a
 * `[id].tsx` MEGLÉVŐ szerkesztője sem ismer ilyet -- a "helyszín-szűrő" a
 * `departmentId` paraméter, amit a hívó ad át (a lap saját helyszíne). Egy
 * itt kitalált keresőmező a tervnél TÖBBET adna annál, amit a referencia-
 * megvalósítás ma tud.
 *
 * MIÉRT KÜLÖN KOMPONENS, ÉS MIÉRT NEM MÁSOLAT: a `[id].tsx` és a `new.tsx`
 * saját, egymástól különböző keretbe (mentés azonnal vs. az egész űrlap
 * egyben) ágyazza ezt a listát -- azt a keretet (mentés/mégsem gomb,
 * "csak olvasható" felirat, mentett-másolat zárolás) mindkét képernyő
 * MEGTARTJA saját magánál. Ami közös, az KIZÁRÓLAG a jelöltek lekérdezése,
 * a sorok kirajzolása és a kijelölés-váltás -- ez a szelet került ide.
 *
 * A HÍVÓ FELELŐSSÉGE ELDÖNTENI, MIKOR JELENIK MEG EGYÁLTALÁN: ha nincs
 * `departmentId` (az új-munkalap űrlapon helyszín-választás előtt), ez a
 * komponens NEM tölt semmit (`enabled` a lekérdezésen), de a hívónak kell
 * eldöntenie, hogy egyáltalán kiírja-e ("Előbb válassz helyszínt" jellegű
 * szöveggel) -- ugyanaz a minta, mint a `new.tsx` saját Helyszín-szekciója,
 * ami `!partnerHatasos`-nál sem rajzolja ki a választót, hanem szöveget ír.
 */
export function WorksheetAssetPicker({
  departmentId,
  selectedIds,
  onChange,
  enabled = true,
}: {
  departmentId: string;
  selectedIds: readonly string[];
  onChange: (next: string[]) => void;
  enabled?: boolean;
}) {
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);

  const candidateAssets = useQuery({
    queryKey: ["worksheet-candidate-assets", departmentId],
    queryFn: () => listAssets(1, 100, "", departmentId, "ACTIVE"),
    enabled: enabled && Boolean(departmentId),
  });

  const notice = describeSelectableAssets({
    loading: candidateAssets.isPending,
    error: candidateAssets.isError,
    count: candidateAssets.data?.items.length ?? 0,
  });

  return (
    <>
      {notice ? <Text style={styles.muted}>{notice}</Text> : null}
      {(candidateAssets.data?.items ?? []).map((jelolt) => {
        const kivalasztva = selectedIds.includes(jelolt.id);
        return (
          <Pressable
            key={jelolt.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: kivalasztva }}
            accessibilityLabel={jelolt.name}
            onPress={() =>
              onChange(toggleWorksheetAsset(selectedIds, jelolt.id))
            }
            style={({ pressed }) => [
              styles.row,
              kivalasztva && styles.rowOn,
              pressed && styles.pressed,
            ]}
          >
            <View>
              <Text style={styles.name}>{jelolt.name}</Text>
              <Text style={styles.code}>{jelolt.assetNumber}</Text>
            </View>
            {kivalasztva ? <Text style={styles.check}>kiválasztva</Text> : null}
          </Pressable>
        );
      })}
    </>
  );
}

/**
 * SAJÁT STÍLUS, NEM ÁTVETT OBJEKTUM. A `[id].tsx`-ben ugyanez a sor-forma
 * (`assigneeRow`/`assigneeName`/`assigneeCheck`) a FELELŐSÖK választójával
 * KÖZÖS stílusobjektum -- azt a widgetet ez a kör nem érinti, tehát nem
 * szabad onnan elvenni. A két hely UGYANAZOKBÓL a tokenekből építkezik,
 * csak külön-külön, ahogy minden képernyő saját `createStyles`-e is teszi.
 */
function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    muted: { color: t.textSecondary, fontSize: 12 },
    row: {
      alignItems: "center",
      backgroundColor: t.background,
      borderColor: t.border,
      borderRadius: 10,
      borderWidth: 1,
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 6,
      padding: 12,
    },
    rowOn: { borderColor: t.accent },
    name: { color: t.textPrimary, fontSize: 14 },
    code: { color: t.textSecondary, fontFamily: "monospace", fontSize: 12 },
    check: { color: t.accentSoftText, fontSize: 12, fontWeight: "800" },
    pressed: { opacity: 0.75 },
  });
}
