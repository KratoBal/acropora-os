import { CameraView, useCameraPermissions } from "expo-camera";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  describeLabelScanFailure,
  extractAssetLabelCode,
} from "@/lib/assets/scanned-payload";
import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";

/**
 * A MATRICAKOD MEZO ES A BEOLVASOJA, EGY PELDANYBAN, MINDKET URLAPNAK.
 *
 * MIERT KELLETT KIEMELNI. A mezo, a beolvaso gomb, a kamera-engedely kezelese
 * es a ratet a FELVITELI kepernyon keszult el, es ott is maradt. Balazs
 * 2026-09-16 10:41-kor kerte, hogy a kod MEGLEVO eszkozre is felvihetó legyen,
 * beirassal vagy beolvasassal -- vagyis a szerkeszto kepernyonek ugyanez kell.
 *
 * NEM MASOLAS, HANEM KOZOS PELDANY. Ugyanaz az indok, amit a
 * `unit-picker.tsx` fejlece kimond: egy masolt kepernyo-blokk ket helyen
 * romolhat el kulon, es a masodikat semmi nem meri. Ott ez ket hetig igy is
 * volt.
 *
 * === MIERT KET DARAB, ES NEM EGY KOMPONENS ===
 *
 * A kamera-ratet `position: "absolute"`, ami a SZULOJEHEZ kepest all. Ha a
 * mezo belsejebol rajzolodna, a MEZOT takarna, nem a kepernyot -- tehat a
 * ratetnek a kepernyo gyokereben kell maradnia, ott, ahol ma is van. A logika
 * viszont igy is egy helyen all: a `useLabelScanner` viszi az engedelyt, az
 * allapotot es magat a ratetet, a kepernyo csak KITESZI, amit kap.
 *
 * Egy `Modal` megoldana a helyezest, de a mobil alkalmazasban ma EGYETLEN
 * `Modal` sincs (merve 2026-09-16), tehat az uj minta lenne, nem a meglevo.
 *
 * ES HA VALAHA MEGIS KELL `Modal`: az KULON DONTES, es MIND A HAROM HELY
 * EGYSZERRE valt at ra (a mezo, a felviteli es a szerkeszto keperno). Egy
 * felig atallitott ratet rosszabb a mainal: ket kulonbozo helyezesi szabaly
 * allna egymas mellett, es a masodikat senki nem merne -- pontosan az az alak,
 * amit ez a fajl azzal kerult el, hogy egy peldanyban all.
 *
 * A FELTETEL, AMI A DONTEST KIVALTJA, es ezert all itt szamszeruen: ha a
 * fenti meres (`Modal` elofordulasa az appban) egyszer nem NULLA, akkor a
 * "uj minta lenne" indok elavult -- ilyenkor ez a bekezdes is valtozik,
 * ugyanabban a korben.
 */

export interface LabelScanner {
  /** A megtagadott engedely vagy a rossz kod mondata. Ures, ha nincs mit mondani. */
  message: string;
  /** A beolvasas inditasa: eloszor engedelyt ker, csak utana nyit kamerat. */
  start(): Promise<void>;
  /** A kepernyo GYOKEREBE valo, nem a mezo melle. `null`, amig zarva van. */
  overlay: ReactNode;
}

export function useLabelScanner(onCode: (code: string) => void): LabelScanner {
  /**
   * A BEOLVASAS UGYANEZEN A KEPERNYON TORTENIK, NEM MASIKON.
   *
   * Egy kulon leolvaso-kepernyore navigalva vissza kellene hozni az erteket --
   * es kozben az urlap TOBBI mezoje elveszne, mert a kepernyo ujra epulne. A
   * szerelo a helyszinen mar kitoltotte oket. Ezert a kamera ratetkent nyilik:
   * navigacio nincs, allapot nem vesz el.
   */
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [permission, requestPermission] = useCameraPermissions();

  const start = useCallback(async () => {
    setMessage("");
    if (!permission?.granted) {
      const kapott = await requestPermission();
      if (!kapott.granted) {
        // A MEGTAGADAS NEM NEMA. Enelkul a gomb ugy nezne ki, mintha
        // elromlott volna: megnyomod, es nem tortenik semmi.
        setMessage("A kamerához nincs engedély. Írd be a kódot kézzel.");
        return;
      }
    }
    setOpen(true);
  }, [permission?.granted, requestPermission]);

  const overlay = open ? (
    <View style={overlayStyles.overlay}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data }) => {
          /*
            EZ A BLOKK AT VAN IRVA, NEM KIEGESZITVE (2026-09-17).

            Itt korabban az allt, hogy a QR TARTALMANAK formajat nem ismerjuk,
            ezert a TELJES beolvasott szoveget ugyanazon az alak-ellenorzesen
            engedjuk at, ami a kezi bevitelt is meri. Az a mondat MA MAR NEM
            IGAZ: Balazs lefenykepezte mind a ket koteget, es a ket alak mert:

              regi koteg (J elotag)   a QR tartalma:  J3049
              uj   koteg (D elotag)   a QR tartalma:  D4204;D4204

            A masodik a MI CSV-alakunk teljes sora. A teljes szovegre illesztes
            tehat epp a kinyomtatott uj koteget utasitotta volna el -- azt az
            otven matricat, ami MA a gepekre megy.

            Ezert mostantol KINYERUNK, nem illesztunk. A szabalyt es a hatarait
            a `lib/assets/scanned-payload.ts` viszi, ahol MERHETO: ket kulonbozo
            kod eseten NEM valasztunk, mert a rossz valasztas fizikai
            kovetkezmennyel jar -- masik gepre kerul a cimke.
          */
          const cimke = extractAssetLabelCode(data);
          if (cimke.kind !== "code") {
            setMessage(describeLabelScanFailure(data, cimke) ?? "");
            setOpen(false);
            return;
          }
          onCode(cimke.code);
          setMessage("");
          setOpen(false);
        }}
      />
      <SafeAreaView style={overlayStyles.panel}>
        <Text style={overlayStyles.panelText}>
          Tartsd a matrica kódját a kamera elé.
        </Text>
        <Pressable
          style={overlayStyles.cancelButton}
          onPress={() => setOpen(false)}
        >
          <Text style={overlayStyles.cancelButtonText}>Mégsem</Text>
        </Pressable>
      </SafeAreaView>
    </View>
  ) : null;

  return { message, start, overlay };
}

export interface LabelCodeFieldProps {
  value: string;
  onChange(value: string): void;
  scanner: LabelScanner;
  editable?: boolean;
  /**
   * A KEPERNYO SAJAT MAGYARAZATA. Szandekosan a hivo adja: a ket urlap MAST
   * mond (a felvitelen uj kod kerul fel, a szerkeszton egy MEGLEVO cserelodhet),
   * es egy kozos mondat az egyiken mindig felrevezetne.
   */
  children?: ReactNode;
}

export function LabelCodeField({
  value,
  onChange,
  scanner,
  editable = true,
  children,
}: LabelCodeFieldProps) {
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>Matrica kódja</Text>
      {children}
      <TextInput
        accessibilityLabel="Matrica kódja"
        value={value}
        onChangeText={onChange}
        editable={editable}
        /**
         * A MATRICAKOD NAGYBETUS. A tarolt alak csak nagybetut fogad, es a
         * normalizalas amugy is felfele alakit -- de ha a billentyuzet kisbetut
         * kinal, a szerelo azt LATJA beirni, amit a mentes utana atir. A ket
         * kepernyo-kep kozotti kulonbseg nem hiba, de bizalmatlansagot szul.
         */
        autoCapitalize="characters"
        placeholder="Nincs megadva"
        placeholderTextColor={tokens.textMuted}
        style={styles.input}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Matrica beolvasása"
        style={styles.button}
        onPress={scanner.start}
        disabled={!editable}
      >
        <Text style={styles.buttonText}>Matrica beolvasása</Text>
      </Pressable>
      {scanner.message ? (
        <Text style={styles.message}>{scanner.message}</Text>
      ) : null}
    </View>
  );
}

/**
 * A SZÍNEK 2026-09-25-TŐL A KÖZÖS `useAppTheme()`-BŐL JÖNNEK -- lásd
 * `category-picker.tsx` fejlécét ugyanerről a jelentésről (Balázs, 2026-09-25
 * 14:48, telefonos fényképek). CSAK A MEZŐ SAJÁT MEGJELENÉSE TOKENIZÁLT: a
 * kamera-ratét (`overlayStyles`, lejjebb) SZÁNDÉKOSAN NEM -- az mindig élő
 * kameraképre kerül, tehát a világos/sötét váltás rá nem értelmezhető,
 * ugyanaz az indok, mint a `DocumentPanel` nagyított-kép takarásánál.
 */
function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    field: { gap: 8 },
    label: { color: t.textSecondary, fontSize: 13, fontWeight: "700" },
    input: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderRadius: 12,
      borderWidth: 1,
      color: t.textPrimary,
      fontSize: 15,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    button: {
      backgroundColor: t.accent,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: "center",
    },
    buttonText: { color: t.textOnAccent, fontWeight: "700" },
    message: { color: t.danger, fontSize: 12 },
  });
}

/**
 * A KAMERA-RATÉT FIX, SÖTÉT MEGJELENÉSE -- SZÁNDÉKOSAN NEM TÉMA-FÜGGŐ.
 * Mindig élő kameraképre kerül, tehát a hátterének és a rajta lévő
 * feliratnak/gombnak a kontrasztja a KAMERAKÉPHEZ kell igazodjon, nem az
 * app aktuális világos/sötét állapotához.
 */
const overlayStyles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#000",
  },
  panel: { flex: 1, justifyContent: "flex-end", padding: 24, gap: 12 },
  panelText: { color: "#f4fbff", fontWeight: "700", textAlign: "center" },
  cancelButton: {
    backgroundColor: "#0f3346",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  cancelButtonText: { color: "#d7f0ff", fontWeight: "700" },
});
