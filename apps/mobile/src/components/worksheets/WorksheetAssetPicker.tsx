import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { listAssets } from "@/lib/api/assets";
import {
  describeSelectableAssets,
  toggleWorksheetAsset,
} from "@/lib/worksheets/worksheet-assets";
import {
  keresesNullaTalalatUzenet,
  lathatoReszlet,
  partitionEszkozokAValasztohoz,
} from "@/lib/worksheets/worksheet-asset-picker";
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
 * MIÉRT KÜLÖN KOMPONENS, ÉS MIÉRT NEM MÁSOLAT: a `[id].tsx` és a `new.tsx`
 * saját, egymástól különböző keretbe (mentés azonnal vs. az egész űrlap
 * egyben) ágyazza ezt a listát -- azt a keretet (mentés/mégsem gomb,
 * "csak olvasható" felirat, mentett-másolat zárolás) mindkét képernyő
 * MEGTARTJA saját magánál. Ami közös, az KIZÁRÓLAG a jelöltek lekérdezése,
 * a sorok kirajzolása, a keresés, a rendezés és a kijelölés-váltás -- ez a
 * szelet került ide.
 *
 * A HÍVÓ FELELŐSSÉGE ELDÖNTENI, MIKOR JELENIK MEG EGYÁLTALÁN: ha nincs
 * `departmentId` (az új-munkalap űrlapon helyszín-választás előtt), ez a
 * komponens NEM tölt semmit (`enabled` a lekérdezésen), de a hívónak kell
 * eldöntenie, hogy egyáltalán kiírja-e ("Előbb válassz helyszínt" jellegű
 * szöveggel) -- ugyanaz a minta, mint a `new.tsx` saját Helyszín-szekciója,
 * ami `!partnerHatasos`-nál sem rajzolja ki a választót, hanem szöveget ír.
 *
 * A HÍVÓ ADJON `key={departmentId}`-t A JSX-BEN: a keresés- és a
 * "továbbiak"-állapot ennek a komponensnek a SAJÁT belső állapota, és
 * helyszín-váltáskor (`new.tsx`-en ez lehetséges) ennek nulláznia kell --
 * a React-kulcs cseréje ezt a teljes komponens újramontírozásával oldja
 * meg, effektus és külön reset-logika nélkül.
 *
 * === MÁSODIK KÖR, 2026-09-25 16:15, Balázs telefonos képe ===
 *
 * Két hiba jelentkezett élesben, miután a választó kikerült a telefonokra
 * (#1139): (1) a "kiválasztva" FELIRAT kilógott a kártyából jobbra, mert a
 * név+kód oszlopnak nem volt `flex`-je, és a felirat a sor natív
 * szélességét vette fel -- egy hosszabb név mellett a felirat egyszerűen
 * nem fért el, és `flexWrap` nélkül a sor kicsordult. (2) a helyszín TELJES
 * eszközlistája egy vég nélküli, kereső nélküli listaként jelent meg,
 * kijelölt tétel nélküli rendezésben -- egy tucatnyi eszközös helyszínen
 * (BIO/ETB) ez használhatatlan görgetést jelentett.
 *
 * A JAVÍTÁS: a felirat helyett egy FIX MÉRETŰ pipa-jelvény (nem nő a
 * szöveggel), a név+kód oszlop `flex: 1` és egysoros csonkolással, egy
 * kereső mező (név, azonosító, partner kód), a kijelölt tételek MINDIG a
 * lista tetején (a keresés csak a KIJELÖLETLEN részt szűri -- a már
 * kiválasztott tétel akkor is látszik, ha épp nem illeszkedik a
 * keresésre, mert a szerelő így mindig látja, mi van kiválasztva), és egy
 * "első N + Továbbiak" határ a kijelöletlen részen, hogy egy nagy
 * helyszínen ne kelljen tucatnyi sort görgetni.
 */

const ELSO_RESZLET = 20;

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
  const [kereses, setKereses] = useState("");
  const [tobbitMutat, setTobbitMutat] = useState(false);

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

  const osszes = candidateAssets.data?.items ?? [];

  const { kivalasztottak, kijeloletlenTalalatok } =
    partitionEszkozokAValasztohoz({
      osszes,
      kivalasztottIdk: selectedIds,
      kereses,
    });

  const { lathato: lathatoKijeloletlen, rejtettSzam: elrejtettSzam } =
    lathatoReszlet(kijeloletlenTalalatok, ELSO_RESZLET, tobbitMutat);

  const keresesUzenet = keresesNullaTalalatUzenet({
    vanEszkozAHelyszinen: osszes.length > 0,
    kereses,
    kivalasztottakSzama: kivalasztottak.length,
    kijeloletlenTalalatokSzama: kijeloletlenTalalatok.length,
  });

  function sor(jelolt: (typeof osszes)[number], kivalasztva: boolean) {
    return (
      <Pressable
        key={jelolt.id}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: kivalasztva }}
        accessibilityLabel={jelolt.name}
        onPress={() => onChange(toggleWorksheetAsset(selectedIds, jelolt.id))}
        style={({ pressed }) => [
          styles.row,
          kivalasztva && styles.rowOn,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.rowContent}>
          <Text style={styles.name} numberOfLines={1}>
            {jelolt.name}
          </Text>
          <Text style={styles.code} numberOfLines={1}>
            {jelolt.assetNumber}
          </Text>
        </View>
        {kivalasztva ? (
          <View style={styles.checkBadge}>
            <Text style={styles.checkBadgeText}>✓</Text>
          </View>
        ) : null}
      </Pressable>
    );
  }

  return (
    <View>
      {osszes.length > 0 ? (
        <TextInput
          value={kereses}
          onChangeText={setKereses}
          placeholder="Keresés: név, azonosító, partner kód"
          placeholderTextColor={tokens.textMuted}
          style={styles.search}
        />
      ) : null}

      {notice ? <Text style={styles.muted}>{notice}</Text> : null}
      {!notice && keresesUzenet ? (
        <Text style={styles.muted}>{keresesUzenet}</Text>
      ) : null}

      {kivalasztottak.map((jelolt) => sor(jelolt, true))}
      {lathatoKijeloletlen.map((jelolt) => sor(jelolt, false))}

      {elrejtettSzam > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setTobbitMutat(true)}
          style={({ pressed }) => [styles.tobbGomb, pressed && styles.pressed]}
        >
          <Text style={styles.tobbGombText}>
            {elrejtettSzam === 1
              ? "1 további eszköz mutatása"
              : `${elrejtettSzam} további eszköz mutatása`}
          </Text>
        </Pressable>
      ) : null}
    </View>
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
    muted: { color: t.textSecondary, fontSize: 12, marginTop: 6 },
    search: {
      backgroundColor: t.background,
      borderColor: t.border,
      borderRadius: 10,
      borderWidth: 1,
      color: t.textPrimary,
      marginBottom: 6,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    row: {
      alignItems: "center",
      backgroundColor: t.background,
      borderColor: t.border,
      borderRadius: 10,
      borderWidth: 1,
      flexDirection: "row",
      gap: 10,
      marginTop: 6,
      padding: 12,
    },
    rowOn: { borderColor: t.accent },
    /*
      A `flex: 1` A MULT KOR HIBAJANAK JAVITASA: enelkul ez a View a sajat
      natur szelesseget vette fel, es a pipa-jelveny (vagy korabban a
      "kivalasztva" felirat) kicsordult a karyabol. Egysoros csonkolassal
      egyutt (`numberOfLines={1}` a Text elemeken) egy hosszu nev sem
      tolhatja ki a sort.
    */
    rowContent: { flex: 1, minWidth: 0 },
    name: { color: t.textPrimary, fontSize: 14 },
    code: { color: t.textSecondary, fontFamily: "monospace", fontSize: 12 },
    /*
      FIX MERETU JELVENY, NEM SZOVEG -- a regi "kivalasztva" felirat a
      nevvel egy sorban allt es a hosszaval nott; ez a jelveny mindig
      ugyanakkora, fuggetlenul attol, milyen hosszu a nev mellette.
    */
    checkBadge: {
      alignItems: "center",
      backgroundColor: t.accent,
      borderRadius: 11,
      flexShrink: 0,
      height: 22,
      justifyContent: "center",
      width: 22,
    },
    checkBadgeText: { color: t.textOnAccent, fontSize: 13, fontWeight: "800" },
    tobbGomb: {
      alignItems: "center",
      borderColor: t.border,
      borderRadius: 10,
      borderWidth: 1,
      marginTop: 6,
      paddingVertical: 10,
    },
    tobbGombText: { color: t.accent, fontSize: 13, fontWeight: "700" },
    pressed: { opacity: 0.75 },
  });
}
