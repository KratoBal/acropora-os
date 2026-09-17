import { CameraView, useCameraPermissions } from "expo-camera";
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  describeLabelScanFailure,
  extractAssetLabelCode,
} from "@/lib/assets/scanned-payload";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";

/**
 * ESZKOZ MEGNYITASA BEOLVASASSAL -- KET AZONOSITOVAL, NEM EGGYEL.
 *
 * === A MERT HIBA, 2026-09-17 ===
 *
 * Ez a kepernyo 2026-09-17-ig CSAK a `qrToken`-t ismerte: uuid, 128 bites
 * veletlen, amit a rendszer minden eszkoznek ad. Egy elore nyomtatott MATRICA
 * soha nem fog ennek latszani, tehat a matricaval nem lehetett megtalalni a
 * gepet, amire fel van ragasztva -- holott a matrica pont ezert kerul ra.
 *
 * A szerveren a visszakereso vegpont 2026-09-02 ota all
 * (`GET service/assets/scan-label/:code`), es egyetlen hivoja a WEB volt. Nem
 * hianyzo kepesseg volt, hanem be nem kotott.
 *
 * === A SORREND NEM MINDEGY, ES EZ NEM IZLES ===
 *
 * ELOSZOR a `qrToken`, es CSAK UTANA a matricakod. Egy uuid hexadecimalis, tehat
 * tartalmazhat `a1234` alaku reszletet -- forditott sorrendben egy ervenyes
 * QR-kodbol csendben matricakodot nyernenk ki, es MASIK eszkozt nyitnank meg.
 *
 * === A KEZI BEVITEL NEM KENYELMI FUNKCIO ===
 *
 * Balazs harmadik mondata ("ha kezzel beirom a szamat") azt mutatta, hogy
 * KERESTE a kezi utat. Ha a kamera nem lat ra a matricara egy gephazban, a
 * kezi mezo az EGYETLEN ut.
 */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function qrToken(value: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value.trim());
  } catch {
    return null;
  }
  if (UUID.test(decoded)) return decoded;
  const match = decoded.match(/\/assets\/scan\/([0-9a-f-]{36})(?:[/?#]|$)/i);
  return match?.[1] && UUID.test(match[1]) ? match[1] : null;
}

export default function AssetScannerScreen() {
  const router = useRouter();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [manual, setManual] = useState("");
  const [message, setMessage] = useState(
    "Tartsd a QR-kódot vagy a matricát a kereten belül.",
  );

  /**
   * A BEOLVASOTT SZOVEG FELDOLGOZASA, EGY HELYEN.
   *
   * A kamera es a kezi mezo UGYANEZT hivja: kulonben a ket ut kulon romolhatna
   * el, es a masodikat semmi nem merne.
   */
  const feldolgoz = (data: string) => {
    const token = qrToken(data);
    if (token) {
      setScanned(true);
      router.replace({ pathname: "/assets/scan/[token]", params: { token } });
      return;
    }
    /**
     * CSAK A QR UTAN A MATRICA. Forditva egy ervenyes uuid hexadecimalis
     * reszletebol nyernenk ki kodot, es MASIK eszkozt nyitnank meg.
     */
    const cimke = extractAssetLabelCode(data);
    if (cimke.kind === "code") {
      setScanned(true);
      router.replace({
        pathname: "/assets/scan/[token]",
        params: { token: cimke.code, kind: "label" },
      });
      return;
    }
    setScanned(true);
    /**
     * A HIBAUZENET MEGMONDJA, MIT OLVASOTT. 2026-09-17-ig csak annyit mondott,
     * hogy "ez nem az" -- es epp emiatt kellett a gazdanak lefenykepeznie a
     * matricat ahhoz, hogy megtudjuk, mi all rajta.
     */
    setMessage(describeLabelScanFailure(data, cimke) ?? "");
  };

  if (status !== "authenticated" || !user) return <Redirect href="/login" />;
  if (!capabilities?.assetsView) return <Redirect href="/" />;

  if (!permission) return <View style={styles.page} />;
  if (!permission.granted)
    return (
      <SafeAreaView style={styles.page}>
        <View style={styles.permissionCard}>
          <Text style={styles.title}>Kameraengedély szükséges</Text>
          <Text style={styles.copy}>
            Az eszköz QR-kódjának beolvasásához engedélyezd a kamera
            használatát.
          </Text>
          <Pressable
            style={styles.button}
            onPress={() => void requestPermission()}
          >
            <Text style={styles.buttonText}>Kamera engedélyezése</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );

  return (
    <View style={styles.page}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={scanned ? undefined : ({ data }) => feldolgoz(data)}
      />
      <SafeAreaView style={styles.overlay}>
        <Text style={styles.title}>QR-kód beolvasása</Text>
        <View style={styles.frame} />
        <View style={styles.bottom}>
          <Text style={styles.message}>{message}</Text>

          {/*
            A KEZI BEVITEL MINDIG OTT ALL, nem csak bukas utan. Ha a kamera nem
            lat ra a matricara egy gephazban, ez az EGYETLEN ut -- es egy mezo,
            ami csak hiba utan jelenik meg, akkor kerul elo, amikor a szerelo
            mar feladta.
          */}
          <View style={styles.manualRow}>
            <TextInput
              accessibilityLabel="Matrica kódja kézzel"
              value={manual}
              onChangeText={setManual}
              placeholder="vagy írd be: D4204"
              placeholderTextColor="#89a9bb"
              autoCapitalize="characters"
              autoCorrect={false}
              style={styles.manualInput}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Kézzel beírt kód megnyitása"
              accessibilityState={{ disabled: manual.trim() === "" }}
              disabled={manual.trim() === ""}
              style={[styles.button, manual.trim() === "" && styles.disabled]}
              onPress={() => feldolgoz(manual)}
            >
              <Text style={styles.buttonText}>Megnyitás</Text>
            </Pressable>
          </View>

          {scanned ? (
            <Pressable
              style={styles.button}
              onPress={() => {
                setMessage(
                  "Tartsd a QR-kódot vagy a matricát a kereten belül.",
                );
                setScanned(false);
              }}
            >
              <Text style={styles.buttonText}>Újraolvasás</Text>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#071827" },
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-between",
    padding: 28,
  },
  title: {
    color: "#fff",
    fontSize: 23,
    fontWeight: "900",
    textAlign: "center",
  },
  frame: {
    width: 250,
    height: 250,
    borderWidth: 4,
    borderColor: "#52d6c7",
    borderRadius: 24,
  },
  message: {
    color: "#fff",
    backgroundColor: "#071827cc",
    padding: 12,
    borderRadius: 12,
    textAlign: "center",
  },
  permissionCard: {
    margin: 22,
    marginTop: 80,
    borderRadius: 18,
    padding: 20,
    backgroundColor: "#0d2b40",
    gap: 14,
  },
  copy: { color: "#a9c4d1", lineHeight: 21 },
  button: {
    backgroundColor: "#177b74",
    borderRadius: 11,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  buttonText: { color: "#fff", fontWeight: "900", textAlign: "center" },
  bottom: { alignSelf: "stretch", gap: 12 },
  manualRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  manualInput: {
    flex: 1,
    backgroundColor: "#071827cc",
    borderColor: "#17394f",
    borderRadius: 11,
    borderWidth: 1,
    color: "#fff",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  disabled: { opacity: 0.5 },
});
