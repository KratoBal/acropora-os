import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { listAssets } from "@/lib/api/assets";
import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";

/** A választó sorának felirata: ugyanaz a felvitelen és a szerkesztőn. */
export const parentAssetLabelOf = (item: {
  assetNumber: string;
  name: string;
}) => `${item.assetNumber} -- ${item.name}`;

/**
 * A SZÜLŐESZKÖZ-VÁLASZTÓ, A FELVITELEN ÉS A SZERKESZTŐN UGYANAZ (Balázs,
 * 2026-10-02 07:38 UTC; acrobot 26045: „ugyanazzal a választóval, mint
 * létrehozáskor”). A felvitel eddig a képernyőn belül hordozta; innen mindkét
 * képernyő ezt használja.
 *
 * A választható halmaz a helyszín eszközeiből áll (a `listAssets` a
 * `departmentId` részfájára szűr), kereshető és lapozott. A szerkesztő a
 * `excludeSubtreeOf`-ot is átadja: az eszköz maga és a leszármazottai nem
 * kerülnek a listára, mert kört zárnának (a szerver ettől függetlenül
 * elutasítja).
 *
 * KAPCSOLAT NÉLKÜL a lista nem tölthető be (élő lekérdezés), ezt a választó
 * kimondja; a szülő ELTÁVOLÍTÁSA viszont lista nélkül is megy, és a mentés a
 * szokásos módon sorba kerül.
 *
 * A HÍVÓ ADJON `key={unitId}`-t: a nyitott lista, a keresés és a lap a helyszín
 * váltásakor alaphelyzetbe áll, ahogy eddig a felvitelen.
 */
export function ParentAssetPicker({
  unitId,
  value,
  label,
  onChange,
  enabled,
  excludeSubtreeOf,
}: {
  unitId: string;
  /** A választott szülő azonosítója, vagy üres szöveg. */
  value: string;
  /** A választott szülő felirata (`parentAssetLabelOf`). */
  label: string;
  onChange(id: string, label: string): void;
  /** Bejelentkezve és joggal: különben a lista nem kérdez. */
  enabled: boolean;
  excludeSubtreeOf?: string;
}) {
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["szulo-eszkoz", unitId, search, page, excludeSubtreeOf ?? ""],
    queryFn: () =>
      // 100-as lap (Balázs, 2026-10-02 08:23 UTC: hosszabb lista); a lapozó marad
      listAssets(page, 100, search, unitId, "ACTIVE", excludeSubtreeOf ?? ""),
    enabled: enabled && open && Boolean(unitId),
    placeholderData: keepPreviousData,
  });
  const pageCount = query.data?.pagination.totalPages ?? 1;

  return (
    <View style={styles.field}>
      <Text style={styles.label}>Szülőeszköz (opcionális)</Text>
      <Text style={styles.hint}>
        Ha ez a gép egy másik eszköz része, válaszd ki itt a főegységet.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          value
            ? `Szülőeszköz: ${label}. Koppints a módosításhoz.`
            : "Szülőeszköz választása."
        }
        onPress={() => setOpen((nyitva) => !nyitva)}
        style={[styles.row, value ? styles.selected : null]}
      >
        <Text style={styles.name}>
          {value ? label : "Nincs szülőeszköz kiválasztva"}
        </Text>
        <Text style={styles.meta}>Koppints a listához</Text>
      </Pressable>
      {value ? (
        <Pressable onPress={() => onChange("", "")}>
          <Text style={styles.link}>Szülőeszköz eltávolítása</Text>
        </Pressable>
      ) : null}
      {!open ? null : (
        <>
          <TextInput
            value={search}
            onChangeText={(next) => {
              setSearch(next);
              // ÚJ KÉRDÉS, ELSŐ LAP: egy szűkebb keresésnél a harmadik lapon
              // állnánk, ami üresként jelenne meg, mintha nem lenne találat.
              setPage(1);
            }}
            placeholder="Keresés: azonosító, név, gyártó"
            placeholderTextColor={tokens.textMuted}
            style={styles.input}
            autoCorrect={false}
          />
          {query.isPending ? <ActivityIndicator color={tokens.accent} /> : null}
          {query.isError ? (
            <Text style={styles.hint}>
              A lista most nem tölthető be (kapcsolat kell hozzá). A szülőeszköz
              eltávolítása kapcsolat nélkül is menthető.
            </Text>
          ) : null}
          {!query.isPending &&
          !query.isError &&
          !(query.data?.items.length ?? 0) ? (
            <Text style={styles.hint}>
              Ezen a helyszínen ebben a keresésben nincs eszköz.
            </Text>
          ) : null}
          {(query.data?.items ?? []).map((item) => (
            <Pressable
              key={item.id}
              onPress={() => {
                onChange(item.id, parentAssetLabelOf(item));
                setOpen(false);
              }}
              style={[styles.row, value === item.id ? styles.selected : null]}
            >
              <Text style={styles.name}>{parentAssetLabelOf(item)}</Text>
            </Pressable>
          ))}
          {/*
            A LAPOZÓ AKKOR IS OTT ÁLL, HA MA EGY LAP VAN: egy "1 / 2" felirat
            láthatóvá teszi, hogy van tovább, mielőtt bárki hiányt keresne.
          */}
          <View style={styles.pager}>
            <Pressable
              disabled={page <= 1}
              onPress={() => setPage((p) => Math.max(1, p - 1))}
            >
              <Text style={[styles.link, page <= 1 && styles.disabled]}>
                Előző
              </Text>
            </Pressable>
            <Text style={styles.hint}>
              {page} / {pageCount}
            </Text>
            <Pressable
              disabled={page >= pageCount}
              onPress={() => setPage((p) => Math.min(pageCount, p + 1))}
            >
              <Text style={[styles.link, page >= pageCount && styles.disabled]}>
                Következő
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    field: { gap: 5 },
    label: { color: t.textSecondary, fontSize: 12, fontWeight: "800" },
    hint: { color: t.textSecondary, fontSize: 12, lineHeight: 17 },
    input: {
      color: t.textPrimary,
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 11,
    },
    row: {
      padding: 11,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface,
    },
    selected: { borderColor: t.accent, backgroundColor: t.accentSoft },
    name: { color: t.textPrimary, fontWeight: "800" },
    meta: { color: t.textSecondary, fontSize: 11, marginTop: 2 },
    link: { color: t.accent, fontSize: 12, fontWeight: "800" },
    disabled: { opacity: 0.55 },
    pager: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
  });
}
