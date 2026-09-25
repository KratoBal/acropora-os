import { CameraView, useCameraPermissions } from "expo-camera";
import { Redirect, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  describeLabelScanFailure,
  extractAssetLabelCode,
} from "@/lib/assets/scanned-payload";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";

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
 *
 * === SZÍNEK: FIGMA TELEFON 12. KÖR, 6. CSOPORT (2026-09-25) ===
 *
 * A "Kameraengedély szükséges" kártya (nincs kamera-nézet ilyenkor)
 * `useAppTheme()`-ből él, ugyanaz a minta, mint az `aquariums/[id].tsx`
 * adatlapon. A KAMERA-NÉZET RÁTÉTE (`cameraStyles` lent) VISZONT MARAD
 * SÖTÉT, FÜGGETLENÜL A TÉMÁTÓL -- a brief kifejezetten kéri ("a kamera-
 * rátét ... marad sötét"), és élő kameraképen egy világos-módbeli fehér
 * hátterű felirat olvashatatlan lenne a kép fölött. A `no-fixed-hex`
 * teszt (`apps/mobile/src/lib/mobile-figma-round-12/no-fixed-hex.spec.ts`)
 * ezt a kivételt EXPLICIT módon kezeli: csak a `cameraStyles` blokkot
 * hagyja ki a vizsgálatból, a `createStyles`-en belüli fix hexet elkapja.
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
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
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

  if (!permission) return <View style={styles.permissionPage} />;
  if (!permission.granted)
    return (
      <SafeAreaView style={styles.permissionPage}>
        <View style={styles.permissionCard}>
          <Text style={styles.permissionTitle}>Kameraengedély szükséges</Text>
          <Text style={styles.copy}>
            Az eszköz QR-kódjának beolvasásához engedélyezd a kamera
            használatát.
          </Text>
          <Pressable
            style={styles.permissionButton}
            onPress={() => void requestPermission()}
          >
            <Text style={styles.permissionButtonText}>
              Kamera engedélyezése
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );

  return (
    <View style={cameraStyles.page}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={scanned ? undefined : ({ data }) => feldolgoz(data)}
      />
      <SafeAreaView style={cameraStyles.overlay}>
        <Text style={cameraStyles.title}>QR-kód beolvasása</Text>
        <View style={cameraStyles.frame} />
        <View style={cameraStyles.bottom}>
          <Text style={cameraStyles.message}>{message}</Text>

          {/*
            A KEZI BEVITEL MINDIG OTT ALL, nem csak bukas utan. Ha a kamera nem
            lat ra a matricara egy gephazban, ez az EGYETLEN ut -- es egy mezo,
            ami csak hiba utan jelenik meg, akkor kerul elo, amikor a szerelo
            mar feladta.
          */}
          <View style={cameraStyles.manualRow}>
            <TextInput
              accessibilityLabel="Matrica kódja kézzel"
              value={manual}
              onChangeText={setManual}
              placeholder="vagy írd be: D4204"
              placeholderTextColor={CAMERA_MANUAL_PLACEHOLDER}
              autoCapitalize="characters"
              autoCorrect={false}
              style={cameraStyles.manualInput}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Kézzel beírt kód megnyitása"
              accessibilityState={{ disabled: manual.trim() === "" }}
              disabled={manual.trim() === ""}
              style={[
                cameraStyles.button,
                manual.trim() === "" && cameraStyles.disabled,
              ]}
              onPress={() => feldolgoz(manual)}
            >
              <Text style={cameraStyles.buttonText}>Megnyitás</Text>
            </Pressable>
          </View>

          {scanned ? (
            <Pressable
              style={cameraStyles.button}
              onPress={() => {
                setMessage(
                  "Tartsd a QR-kódot vagy a matricát a kereten belül.",
                );
                setScanned(false);
              }}
            >
              <Text style={cameraStyles.buttonText}>Újraolvasás</Text>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
}

/**
 * A KAMERA-RÁTÉT RÖGZÍTETT, SÖTÉT SZÍNKÉSZLETE -- SZÁNDÉKOSAN NEM
 * `useAppTheme()`-ből jön, lásd a fájl fejlécét. Ez a blokk (a lenti
 * `CAMERA_MANUAL_PLACEHOLDER`-től a `cameraStyles` végéig) az EGYETLEN
 * rész ebben a fájlban, amit a `no-fixed-hex` teszt kihagy a
 * vizsgálatból -- a kivétel a NÉVRE szűr, nem "engedd át az egészet":
 * lásd a teszt saját fejlécét (`src/lib/mobile-figma-round-12/
 * no-fixed-hex.spec.ts`).
 */
const CAMERA_MANUAL_PLACEHOLDER = "#89a9bb";

const cameraStyles = StyleSheet.create({
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

/**
 * A KAMERA NÉLKÜLI ÁLLAPOT (nincs engedély) -- EZ VISZONT PLAIN OLDAL,
 * NEM KAMERA-RÁTÉT, tehát `useAppTheme()`-ből él, ugyanúgy, mint a
 * `new.tsx`/`[id].tsx` akvárium-képernyők.
 */
function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    permissionPage: { flex: 1, backgroundColor: t.background },
    permissionCard: {
      margin: 22,
      marginTop: 80,
      borderRadius: 18,
      padding: 20,
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      gap: 14,
    },
    permissionTitle: {
      color: t.textPrimary,
      fontSize: 23,
      fontWeight: "900",
      textAlign: "center",
    },
    copy: { color: t.textSecondary, lineHeight: 21 },
    permissionButton: {
      backgroundColor: t.accent,
      borderRadius: 11,
      paddingHorizontal: 18,
      paddingVertical: 12,
    },
    permissionButtonText: {
      color: t.textOnAccent,
      fontWeight: "900",
      textAlign: "center",
    },
  });
}
