import { CameraView, useCameraPermissions } from "expo-camera";
import { useCallback, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { normalizeAssetLabelCode } from "@/lib/assets/asset-label-mirror";

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
    <View style={styles.overlay}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data }) => {
          /*
            AMIT A MATRICA HORDOZ, AZT NEM TALALJUK KI. A kod alakjat ismerjuk
            (egy betu es negy szam), a QR TARTALMANAK formajat nem: sehol nincs
            leirva, hogy a matrica a puszta kodot viszi-e vagy valami kore
            csomagolva. Ezert a beolvasott szoveget UGYANAZON az
            alak-ellenorzesen engedjuk at, ami a kezi bevitelt is meri -- ha nem
            illik ra, megmondjuk, es a kezi mezo mindig ott marad mellette.
          */
          const kod = normalizeAssetLabelCode(data);
          if (!kod) {
            setMessage(
              "Ez nem matricakód. Írd be kézzel, vagy olvass be másikat.",
            );
            setOpen(false);
            return;
          }
          onCode(kod);
          setMessage("");
          setOpen(false);
        }}
      />
      <SafeAreaView style={styles.panel}>
        <Text style={styles.panelText}>
          Tartsd a matrica kódját a kamera elé.
        </Text>
        <Pressable style={styles.button} onPress={() => setOpen(false)}>
          <Text style={styles.buttonText}>Mégsem</Text>
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
        placeholderTextColor="#668798"
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

const styles = StyleSheet.create({
  field: { gap: 8 },
  label: { color: "#9ab8ca", fontSize: 13, fontWeight: "700" },
  input: {
    backgroundColor: "#0b263d",
    borderColor: "#164668",
    borderRadius: 12,
    borderWidth: 1,
    color: "#f4fbff",
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  button: {
    backgroundColor: "#0f3346",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  buttonText: { color: "#d7f0ff", fontWeight: "700" },
  message: { color: "#ffb4a2", fontSize: 12 },
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
});
