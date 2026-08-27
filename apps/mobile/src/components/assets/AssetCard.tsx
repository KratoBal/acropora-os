import { Pressable, StyleSheet, Text, View } from "react-native";

import type { AssetListItem } from "@/lib/api/assets";
import { assetPlacementLine } from "@/lib/assets/asset-placement";

const STATUS_LABELS: Record<AssetListItem["status"], string> = {
  ACTIVE: "Aktív",
  OUT_OF_SERVICE: "Nem üzemel",
  IN_REPAIR: "Javítás alatt",
  RETIRED: "Kivezetett",
};

export function AssetCard({
  asset,
  onPress,
}: {
  asset: AssetListItem;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${asset.name} eszköz megnyitása`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.topline}>
        <Text style={styles.number}>{asset.assetNumber}</Text>
        <Text style={styles.status}>{STATUS_LABELS[asset.status]}</Text>
      </View>
      <Text style={styles.name}>{asset.name}</Text>
      <Text style={styles.customer}>{asset.owner.displayName}</Text>
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

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#1c4963",
    backgroundColor: "#0d2b40",
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
    color: "#75e2d5",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  status: {
    color: "#b7d6e5",
    fontSize: 11,
    fontWeight: "700",
  },
  name: { color: "#f4fbff", fontSize: 18, fontWeight: "800" },
  customer: { color: "#d7edf7", fontSize: 14, fontWeight: "600" },
  meta: { color: "#91afbe", fontSize: 12, lineHeight: 18 },
  technical: { color: "#c3d9e4", fontSize: 12, marginTop: 5 },
});
