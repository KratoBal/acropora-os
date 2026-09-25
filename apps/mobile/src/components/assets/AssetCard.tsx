import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { AssetListItem } from "@/lib/api/assets";
import { assetPlacementLine } from "@/lib/assets/asset-placement";
import { ASSET_STATUS_LABELS } from "@/lib/assets/asset-status";
import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";

export function AssetCard({
  asset,
  onPress,
}: {
  asset: AssetListItem;
  onPress(): void;
}) {
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${asset.name} eszköz megnyitása`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.topline}>
        <Text style={styles.number}>{asset.assetNumber}</Text>
        <Text style={styles.status}>{ASSET_STATUS_LABELS[asset.status]}</Text>
      </View>
      <Text style={styles.name}>{asset.name}</Text>
      <Text style={styles.customer}>{asset.owner.displayName}</Text>
      {/*
        A KATEGÓRIA A FIGMA 7. KÖR TÁBLA-OSZLOPÁT FEDI A KÁRTYÁN: a szerver a
        listasoron is küldi (lásd az `AssetListItem.category` fejlécét), ez
        eddig csak nem jelent meg. Csak akkor sor, ha van érték -- ugyanaz a
        minta, mint a gyártó/modell/sorozatszám sornál lejjebb.
      */}
      {asset.category ? (
        <Text style={styles.meta}>{asset.category}</Text>
      ) : null}
      {/*
        HOL ÁLL, ÉS MIKOR NEM VÁLASZTÁS EREDMÉNYE, AMIT LÁTUNK. Szerviz
        partnernél a cím mindig a partner saját postai címe: alegység nélkül
        tehát nem válasz arra, hogy hol áll az eszköz. A sorban ez látszik a
        legkevésbé, mert minden hely ugyanúgy néz ki -- ezért a hiányt a
        felirat mondja ki (`asset-placement.ts`).
      */}
      <Text style={styles.meta}>
        {assetPlacementLine({
          ownerType: asset.owner.type,
          unit: asset.unit,
          address: asset.address,
        })}
      </Text>
      {asset.parent ? (
        <Text style={styles.meta}>Része: {asset.parent.name}</Text>
      ) : asset.childCount > 0 ? (
        <Text style={styles.meta}>{asset.childCount} részegység</Text>
      ) : null}
      {/*
        A FELIRAT 2026-09-02 OTA "Partner azonosítója" (Balazs): a szam nem a
        MI leltarunk, hanem az ugyfele. A MEZONEV akkor meg kulon kornek
        maradt (sema, migracio, API, web) -- 2026-09-23-an ez a kor lezajlott,
        a mezo mostantol `partnerInternalCode`, ugyanazzal a jelentessel.

        AZ UGYFEL SAJAT KODJA, csak ha van, es FELIRATTAL. A kereses nezi, tehat
        a talalatnak meg kell mutatnia, mire illeszkedett -- a felirat pedig
        azert kell, hogy a sorban ne legyen osszekeverheto a mi eszkozszamunkkal.
      */}
      {asset.partnerInternalCode ? (
        <Text style={styles.meta}>
          Partner azonosítója: {asset.partnerInternalCode}
        </Text>
      ) : null}
      {asset.manufacturer || asset.model || asset.serialNumber ? (
        <Text style={styles.technical}>
          {[asset.manufacturer, asset.model, asset.serialNumber]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * A SZÍNEK 2026-09-25-TŐL A KÖZÖS `useAppTheme()`-BŐL JÖNNEK -- korábban
 * saját, fix sötét hexek voltak (`#0d2b40` stb.), ugyanúgy, ahogy a
 * vízmérés képernyő is állt a saját migrálása előtt. Ez a kártya a
 * "Eszköznyilvántartás" Figma 7. kör része, ami világos ÉS sötét módot kér
 * -- a fix hexekkel ez nem lett volna elérhető.
 */
function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    card: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface,
      padding: 16,
      gap: 4,
    },
    pressed: { opacity: 0.72 },
    topline: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 12,
    },
    number: {
      color: t.accent,
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 0.6,
    },
    /*
      SZÍNES JELVÉNY, UGYANAZZAL A RECEPTTEL, MINT AZ ADATLAP SAJÁT
      "badge" STÍLUSA (`assets/[id].tsx`) -- acrobot kérése, 2026-09-25: a
      terv (`EszközScreen.tsx` `StatuszBadge`) a listán ÉS az adatlapon is
      pill-ként adja az állapotot, a lista eddig sima szürke szöveget adott.
      A hibajegy-lista eltérő alakú jelvénye helyett a SAJÁT (eszköz-)
      adatlap már meglévő mintáját követi, hogy a lista és az adatlap
      egyformán nézzen ki ugyanazon az entitáson.
    */
    status: {
      alignSelf: "flex-start",
      backgroundColor: t.accentSoft,
      borderRadius: 8,
      color: t.accentSoftText,
      fontSize: 11,
      fontWeight: "800",
      paddingHorizontal: 9,
      paddingVertical: 5,
    },
    name: { color: t.textPrimary, fontSize: 18, fontWeight: "800" },
    customer: { color: t.textPrimary, fontSize: 14, fontWeight: "600" },
    meta: { color: t.textSecondary, fontSize: 12, lineHeight: 18 },
    technical: { color: t.textSecondary, fontSize: 12, marginTop: 5 },
  });
}
