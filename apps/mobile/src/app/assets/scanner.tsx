import { CameraView, useCameraPermissions } from "expo-camera";
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";

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
  const [message, setMessage] = useState("Tartsd a QR-kódot a kereten belül.");

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
        onBarcodeScanned={
          scanned
            ? undefined
            : ({ data }) => {
                const token = qrToken(data);
                if (!token) {
                  setScanned(true);
                  setMessage("Ez nem Acropora OS eszközazonosító.");
                  return;
                }
                setScanned(true);
                router.replace({
                  pathname: "/assets/scan/[token]",
                  params: { token },
                });
              }
        }
      />
      <SafeAreaView style={styles.overlay}>
        <Text style={styles.title}>QR-kód beolvasása</Text>
        <View style={styles.frame} />
        <Text style={styles.message}>{message}</Text>
        {scanned ? (
          <Pressable
            style={styles.button}
            onPress={() => {
              setMessage("Tartsd a QR-kódot a kereten belül.");
              setScanned(false);
            }}
          >
            <Text style={styles.buttonText}>Újraolvasás</Text>
          </Pressable>
        ) : null}
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
});
