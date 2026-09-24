import { StyleSheet, Text, View } from "react-native";

/**
 * KIS JELVÉNY (Tulajdon, Típus, Víztípus) -- A FIGMA-TERV (make-2) SZERKEZETE,
 * a meglévő sötét témával: a `teal` tónus a mai `#177b74` akcentusszínt, a
 * `grey` a mai másodlagos szöveg-tónust viszi tovább, nem a Figma világos
 * palettáját.
 */
export function AquariumBadge({
  children,
  tone = "grey",
}: {
  children: string;
  tone?: "teal" | "grey";
}) {
  return (
    <View style={[styles.badge, tone === "teal" && styles.teal]}>
      <Text style={[styles.text, tone === "teal" && styles.tealText]}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#28536a",
    backgroundColor: "#0d2b40",
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  teal: { backgroundColor: "#0f3a35", borderColor: "#1f6b60" },
  text: { color: "#91afbe", fontSize: 11, fontWeight: "700" },
  tealText: { color: "#6fe0d1" },
});
