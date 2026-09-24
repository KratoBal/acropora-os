import { StyleSheet, Text, View } from "react-native";

/**
 * "NINCS KAPCSOLAT" SÁV -- a Figma-terv (make-2, mobil szekció) szerkezete,
 * a meglévő `OfflineNoticeCard` "offline" tónusának színeivel.
 *
 * NEM UGYANAZ, MINT AZ `OfflineNoticeCard`: az egy MENTETT MÁSOLAT korát írja
 * le, cache-adatból építve. Az akvárium-képernyőknek nincs mentett
 * másolatuk -- ez a sáv egyetlen, fix szövegű jelzés, ami közvetlenül a
 * készülék `useIsOnline()` állapotát mutatja.
 */
export function ConnectivityBanner() {
  return (
    <View style={styles.banner}>
      <Text style={styles.text}>Nincs kapcsolat, a mérés később megy el</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: "#1f3348",
    borderColor: "#2f5b7d",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  text: {
    color: "#d9edf7",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
});
