import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  getWorksheet,
  listWorksheetSigners,
  signWorksheet,
} from "@/lib/api/worksheets";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import {
  formatWorksheetAmount,
  worksheetLabelOrDraft,
  worksheetStatusLabel,
} from "@/lib/worksheets/worksheet-presentation";
import {
  buildWorksheetSignaturePayload,
  canSignWorksheetVersion,
  worksheetSignatureConfirmation,
  type WorksheetSignatureDecision,
} from "@/lib/worksheets/worksheet-signature";

/**
 * A MUNKALAP ALAIRASA A HELYSZINEN.
 *
 * === EGY GOMB ES EGY MEGEROSITES (Balazs, 2026-09-03 19:42) ===
 *
 * A kepernyo a nevet MEG SEM KERDEZI: nincs nev-mezo. Az elfogadas EGY gomb,
 * utana egy megerosites, ami KIMONDJA, mi tortenik -- nem azt kerdezi, hogy
 * biztos-e. A nevet a kliens tolti ki a bejelentkezett felhasznalobol; a
 * szerver tovabbra is szovegkent varja, tehat ehhez nem kellett szerver-valtozas.
 *
 * AZ ELUTASITAS UTJA MAS, ES SZANDEKOSAN NEM UGYANAZ A GOMB: ott az indok
 * KOTELEZO (Balazs dontese, 2026-08-26), tehat a szerelo ir. Egy indok plusz
 * megerosites. A ket utat osszevonni annyi lenne, mint az elfogadas ele is
 * odatenni egy mezot, amit senki nem tolt ki.
 *
 * A dontesek es a megerosito szovegek a
 * `lib/worksheets/worksheet-signature.ts` modulban allnak, mert ott MERHETOK.
 *
 * === KULON KEPERNYO, ES EZ NEM ELRENDEZESI IZLES ===
 *
 * Ezt a kepernyot a szerelo ODAADJA az ugyfelnek. Ami rajta van, azt az ugyfel
 * olvassa: mit fogad el, mennyiert, es ki irja ala. Ami NINCS rajta -- a
 * tetel-felvitel, a torles, a korabbi verziok, a folytatas-lanc --, azt
 * szandekosan hagytuk le: azok a szerelo munkaeszkozei, es egy atadott
 * telefonon veletlen erintessel is elsulhetnenek.
 *
 * === AMI EZEN A KEPERNYON NINCS: AZ OFFLINE ALAIRAS ===
 *
 * A lap adatlapja MA IS csak halozattal jon be (a `getWorksheet` nem esik
 * gyorsitotarra), tehat az alairas nem szukebb, mint a kepernyo, amirol
 * indul. Ha egyszer a lap adatlapja offline is elerheto lesz, az alairas
 * sorbaallitasa KULON szelet: a `sync_queue` ma `create` muveleteket ismer, es
 * egy kesobb felmeno alairas datuma nem az lenne, amit az ugyfel latott.
 */
export default function WorksheetSignScreen() {
  /**
   * NEM A DONTEST TAROLJUK, HANEM AZT, HOGY NYITVA VAN-E AZ ELUTASITAS UTJA.
   *
   * A dontes a gomb megnyomasakor SZULETIK, es argumentumkent megy vegig a
   * megerositesen es a kuldesen. Egy tarolt dontes-allapot azt engedne meg,
   * hogy a parbeszed nyitva allasa kozben megvaltozzon, amire epp
   * megerositest kertunk.
   */
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;
  const queryClient = useQueryClient();

  const worksheet = useQuery({
    queryKey: ["worksheet", id],
    queryFn: () => getWorksheet(id),
    enabled: Boolean(
      id && capabilities?.worksheetsView && status === "authenticated",
    ),
  });

  /**
   * A NEV A HOROK KOZOTT SZULETIK, NEM A KULDESKOR.
   *
   * Ugyanaz az ertek megy a kepernyore es a szerverre. Ha a kuldes fuggvenye
   * sajat maga olvasna ki ujra, a ket hely kulon romolhatna el -- es az ugyfel
   * MAS nevet latna, mint ami a lapra kerul.
   */
  /**
   * AKI ALAIRHATJA: a lap partnerenek nyilvantartott munkatarsai.
   *
   * A LISTA A SZERVERTOL JON, es vele egyutt az is, MIERT ures, ha ures. Ket
   * kulonbozo ok van (nincs hozzakotott munkatars kontra a partner torzsadata
   * hianyzik), es a teendojuk MAS -- egy nema ures lista mind a kettore
   * raillik, es a szerelo egyiket sem tudja megoldani a helyszinen.
   */
  const signers = useQuery({
    queryKey: ["worksheet-signers", id],
    queryFn: () => listWorksheetSigners(id),
    enabled: Boolean(
      id && capabilities?.worksheetsView && status === "authenticated",
    ),
  });

  /**
   * KIT VALASZTOTT A SZERELO. `null` = "egyik sem", vagyis a nevet beirja --
   * es a lap ezt KIMONDJA (a jelzes a soron tarolodik, nem a kepernyon).
   */
  const [signerUserId, setSignerUserId] = useState<string | null>(null);
  const [typedName, setTypedName] = useState("");
  const signerName =
    signers.data?.items.find((item) => item.id === signerUserId)?.name ??
    typedName.trim();

  /**
   * A DONTES ARGUMENTUMKENT MEGY BE, NEM ALLAPOTBOL OLVASSUK.
   *
   * A megerosito parbeszed egy visszahivast kap, es az akkor fut le, amikor a
   * felhasznalo megnyomja a gombot -- addigra a keperno allapota MAR MAS lehet.
   * Ami ellen ez ved: a szerelo megnyomja az alairast, a parbeszed all, valaki
   * hozzaer az elutasitas gombjahoz, es az elfogadasnak indult muvelet
   * elutasitaskent menne el. Egy argumentum ezt szerkezetileg kizarja.
   */
  const sign = useMutation({
    mutationFn: async (chosen: WorksheetSignatureDecision) => {
      const built = buildWorksheetSignaturePayload(
        { decision: chosen, note, typedName },
        signerUserId,
      );
      if (!built.ok) throw new Error(built.message);
      return signWorksheet(id, built.payload);
    },
    onSuccess: async () => {
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: ["worksheet", id] });
      await queryClient.invalidateQueries({ queryKey: ["worksheets"] });
      /**
       * `replace`, nem `push`: az alairas VEGLEGES, tehat a vissza gomb nem
       * vihet ujra erre a kepernyore. A masodik kiserlet ugyis a szerver
       * elutasitasaba futna, csak epp az ugyfel elott.
       */
      router.replace({ pathname: "/worksheets/[id]", params: { id } });
    },
    onError: (cause) =>
      setFormError(
        cause instanceof Error ? cause.message : "Az aláírás nem rögzíthető.",
      ),
  });

  /**
   * A MEGEROSITES. Balazs kerese: az alairas egy gomb plusz egy megerosites.
   *
   * A SZOVEG NEM ITT SZULETIK: a `worksheetSignatureConfirmation` adja, mert
   * ott merheto, hogy tenyleg KIMONDJA, mi tortenik -- egy "Biztos vagy
   * benne?" csak annyit ker, hogy nyomd meg megegyszer.
   *
   * A megse gomb a `cancel` szerep, es a megerosito `destructive`: a
   * rendszer-parbeszedben ez az, ami elvalasztja a ket gombot ranezesre is.
   *
   * ES A HELYI ELLENORZES A PARBESZED ELE KERUL, nem moge: egy indok nelkuli
   * elutasitasnal a szerelo NE azt lassa, hogy megerositette a semmit, aztan
   * kapjon hibat. Ugyanaz a fuggveny mond nemet, ami a kuldeskor is.
   */
  const megerosit = (chosen: WorksheetSignatureDecision) => {
    const built = buildWorksheetSignaturePayload(
      { decision: chosen, note, typedName },
      signerUserId,
    );
    if (!built.ok) {
      setFormError(built.message);
      return;
    }
    setFormError(null);
    const kerdes = worksheetSignatureConfirmation({
      decision: chosen,
      signerName,
    });
    Alert.alert(kerdes.title, kerdes.message, [
      { text: "Mégsem", style: "cancel" },
      {
        text: kerdes.confirmLabel,
        style: "destructive",
        onPress: () => sign.mutate(chosen),
      },
    ]);
  };

  if (status !== "authenticated" || !user || !capabilities)
    return <Redirect href="/login" />;
  if (!capabilities.worksheetsView) return <Redirect href="/" />;

  const data = worksheet.data;
  const current = data?.currentVersion;
  const signable = current
    ? canSignWorksheetVersion({
        status: current.status,
        worksheetsManage: capabilities.worksheetsManage,
      })
    : false;

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.eyebrow}>ALÁÍRÁS</Text>

        {worksheet.isPending ? <ActivityIndicator color="#52d6c7" /> : null}

        {worksheet.isError ? (
          <Text style={styles.error}>
            {worksheet.error instanceof Error
              ? worksheet.error.message
              : "A munkalap nem tölthető be."}
          </Text>
        ) : null}

        {data && current ? (
          <>
            <Text style={styles.title}>
              {worksheetLabelOrDraft(current.label)}
            </Text>
            <Text style={styles.subject}>{current.subject}</Text>

            {/*
              AMIT AZ UGYFEL ELFOGAD: a partner, a targy es a BRUTTO osszeg.
              Az osszeg nem diszites: enelkul az alairas arrol szolna, hogy
              "megtortent a munka", nem arrol, hogy mennyiert.
            */}
            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.label}>Partner</Text>
                <Text style={styles.value}>{data.customer.displayName}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Helyszín</Text>
                <Text style={styles.value}>{data.department.name}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Tételek</Text>
                <Text style={styles.value}>{current.lines.length} db</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Fizetendő (bruttó)</Text>
                <Text style={styles.total}>
                  {formatWorksheetAmount(current.grossAmount, current.currency)}
                </Text>
              </View>
            </View>

            {!signable ? (
              /*
                A NEM-ALAIRHATO ESET KIMONDVA, NEM URES KEPERNYO.
                Aki idaig eljutott, azt egy gomb hozta ide; ha kozben megjott a
                dontes vagy visszanyitottak a lapot, azt MEG KELL MONDANI. Egy
                nema visszairanyitas ugy nezne ki, mintha az app akadt volna
                meg -- az ugyfel elott.
              */
              <View style={styles.card}>
                <Text style={styles.blockedTitle}>
                  Ez a lap most nem írható alá.
                </Text>
                <Text style={styles.muted}>
                  {capabilities.worksheetsManage
                    ? `A lap állapota: ${worksheetStatusLabel[current.status]}. Aláírni csak aláírásra váró lapot lehet: a lezárás az irodából történik.`
                    : "Ehhez írási jog kell a szerviz modulhoz. Szólj az irodának."}
                </Text>
                <Pressable
                  onPress={() =>
                    router.replace({
                      pathname: "/worksheets/[id]",
                      params: { id },
                    })
                  }
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.secondaryText}>Vissza a munkalapra</Text>
                </Pressable>
              </View>
            ) : (
              <>
                {/*
                  AZ ALAIRO AZ UGYFEL EMBERE (Balazs, 2026-09-04): a szerelo a
                  lap partnerenek nyilvantartott munkatarsai kozul valaszt.

                  A LISTA GOMBOKBOL ALL, NEM LEGORDULOBOL: ezt a kepernyot a
                  szerelo ODAADJA az ugyfelnek, es egy rendszer-legordulo a
                  telefonon egy tovabbi, teljes kepernyos parbeszedet nyit.
                  Nehany nevnel egy sor gomb kevesebb lepes, es latszik is,
                  hany ember kozul lehet valasztani.
                */}
                <Text style={styles.sectionTitle}>Aláíró</Text>
                <View style={styles.card}>
                  {signers.isPending ? (
                    <ActivityIndicator color="#52d6c7" />
                  ) : null}

                  {signers.data?.items.map((jelolt) => (
                    <Pressable
                      key={jelolt.id}
                      accessibilityRole="button"
                      onPress={() => setSignerUserId(jelolt.id)}
                      style={[
                        styles.signerOption,
                        signerUserId === jelolt.id && styles.signerOptionPicked,
                      ]}
                    >
                      <Text style={styles.signer}>{jelolt.name}</Text>
                    </Pressable>
                  ))}

                  {/*
                    AZ URES LISTA MEGMONDJA, MIERT. Ket kulonbozo ok van, es a
                    teendojuk MAS -- egy nema ures lista mind a kettore raillik,
                    es a szerelo egyiket sem tudja megoldani a helyszinen. A
                    mondat a SZERVERTOL jon, hogy a ket felulet ugyanazt mondja.
                  */}
                  {signers.data?.emptyReason ? (
                    <Text style={styles.muted}>{signers.data.emptyReason}</Text>
                  ) : null}

                  {/*
                    AZ "EGYIK SEM" AG. Balazs kerte, es NEM kiskapu: ez az az
                    ut, amin a szerelo beirja a nevet -- es a lap KIMONDJA, hogy
                    nem a partner nyilvantartott munkatarsa irta ala. A jelzes a
                    soron tarolodik, nem ezen a kepernyon.
                  */}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setSignerUserId(null)}
                    style={[
                      styles.signerOption,
                      signerUserId === null && styles.signerOptionPicked,
                    ]}
                  >
                    <Text style={styles.signer}>Egyik sem</Text>
                  </Pressable>

                  {signerUserId === null ? (
                    <>
                      <TextInput
                        value={typedName}
                        onChangeText={setTypedName}
                        placeholder="Az aláíró neve"
                        placeholderTextColor="#5b7d8f"
                        style={styles.input}
                        accessibilityLabel="Az aláíró neve"
                      />
                      <Text style={styles.muted}>
                        A lapon látszani fog, hogy a nevet te írtad be, és nem a
                        partner nyilvántartott munkatársa írta alá.
                      </Text>
                    </>
                  ) : null}
                </View>

                {formError ? (
                  <Text style={styles.error}>{formError}</Text>
                ) : null}

                {rejecting ? (
                  <>
                    {/*
                      AZ ELUTASITAS UTJA: INDOK PLUSZ MEGEROSITES. Az indok
                      KOTELEZO (Balazs dontese, 2026-08-26), es ez az EGYETLEN
                      hely a kepernyon, ahol a szerelo gepel.
                    */}
                    <Text style={styles.sectionTitle}>
                      Miért nem fogadja el?
                    </Text>
                    <View style={styles.card}>
                      <TextInput
                        value={note}
                        onChangeText={(next) => {
                          setNote(next);
                          setFormError(null);
                        }}
                        multiline
                        numberOfLines={3}
                        placeholder="Például: a szivattyú továbbra is zajos"
                        placeholderTextColor="#5b7d8f"
                        style={[styles.input, styles.noteInput]}
                      />
                      <Text style={styles.muted}>
                        Az indoklás kötelező: enélkül nem derül ki, mit kell
                        javítani.
                      </Text>
                    </View>

                    <Pressable
                      disabled={sign.isPending}
                      onPress={() => megerosit("REJECTED")}
                      style={[
                        styles.rejectButton,
                        sign.isPending && styles.disabled,
                      ]}
                    >
                      <Text style={styles.submitText}>
                        {sign.isPending ? "Rögzítés…" : "Elutasítás rögzítése"}
                      </Text>
                    </Pressable>

                    <Pressable
                      disabled={sign.isPending}
                      onPress={() => {
                        setRejecting(false);
                        setNote("");
                        setFormError(null);
                      }}
                    >
                      <Text style={styles.secondaryLink}>
                        Mégis aláírja az ügyfél
                      </Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    {/*
                      AZ ELFOGADAS: EGY GOMB. Nincs mezo, nincs valaszto -- a
                      megerosites mondja meg, mi tortenik.
                    */}
                    <Pressable
                      disabled={sign.isPending}
                      onPress={() => megerosit("ACCEPTED")}
                      style={[
                        styles.submitButton,
                        sign.isPending && styles.disabled,
                      ]}
                    >
                      <Text style={styles.submitText}>
                        {sign.isPending ? "Rögzítés…" : "Aláírás"}
                      </Text>
                    </Pressable>
                    <Text style={styles.muted}>
                      Az aláírás végleges: a lap ezután nem írható át, a munka
                      folytatása új lapra kerül.
                    </Text>

                    {/*
                      AZ ELUTASITAS NEM EGYENRANGU GOMB. A helyszinen a lap
                      tulnyomo tobbsege alairassal zarul; ket egyforma gomb
                      egymas mellett a ritka esetet ugyanolyan konnyen
                      elerhetove tenne, mint a gyakorit.
                    */}
                    <Pressable
                      disabled={sign.isPending}
                      onPress={() => {
                        setRejecting(true);
                        setFormError(null);
                      }}
                    >
                      <Text style={styles.secondaryLink}>
                        Az ügyfél nem fogadja el
                      </Text>
                    </Pressable>
                  </>
                )}
              </>
            )}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#071827" },
  container: { padding: 18, paddingBottom: 48, gap: 12 },
  eyebrow: {
    color: "#52d6c7",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  title: { color: "#f4fbff", fontSize: 24, fontWeight: "900" },
  subject: { color: "#d9edf7", fontSize: 16, fontWeight: "700" },
  sectionTitle: {
    color: "#f4fbff",
    fontSize: 15,
    fontWeight: "800",
    marginTop: 6,
  },
  card: {
    backgroundColor: "#0d2b40",
    borderColor: "#1c4963",
    borderWidth: 1,
    borderRadius: 16,
    gap: 8,
    padding: 14,
  },
  row: { flexDirection: "row", gap: 12, justifyContent: "space-between" },
  label: { color: "#789cad", fontSize: 12, fontWeight: "700" },
  value: { color: "#f4fbff", flex: 1, fontSize: 14, textAlign: "right" },
  total: {
    color: "#6de0ce",
    flex: 1,
    fontSize: 18,
    fontWeight: "900",
    textAlign: "right",
  },
  muted: { color: "#789cad", fontSize: 12 },
  blockedTitle: { color: "#f4fbff", fontSize: 15, fontWeight: "800" },
  signerOption: {
    backgroundColor: "#071827",
    borderColor: "#123449",
    borderRadius: 10,
    borderWidth: 2,
    marginBottom: 8,
    padding: 12,
  },
  signerOptionPicked: { borderColor: "#52d6c7" },
  signer: { color: "#f4fbff", fontSize: 18, fontWeight: "800" },
  rejectButton: {
    backgroundColor: "#8c2f3f",
    borderRadius: 12,
    marginTop: 4,
    padding: 16,
  },
  secondaryLink: {
    color: "#789cad",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 14,
    textAlign: "center",
    textDecorationLine: "underline",
  },
  input: {
    backgroundColor: "#08192a",
    borderColor: "#17394f",
    borderRadius: 10,
    borderWidth: 1,
    color: "#f4fbff",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noteInput: { minHeight: 80, textAlignVertical: "top" },
  error: {
    color: "#fecaca",
    backgroundColor: "#541b2b",
    padding: 12,
    borderRadius: 10,
  },
  submitButton: {
    backgroundColor: "#177b74",
    borderRadius: 12,
    marginTop: 4,
    padding: 16,
  },
  submitText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
  },
  secondaryButton: {
    borderColor: "#1c4963",
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
    padding: 12,
  },
  secondaryText: { color: "#f4fbff", fontWeight: "800", textAlign: "center" },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.75 },
});
