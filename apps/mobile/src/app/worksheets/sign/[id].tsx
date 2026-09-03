import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { getWorksheet, signWorksheet } from "@/lib/api/worksheets";
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
  worksheetSignerName,
  type WorksheetSignatureDecision,
} from "@/lib/worksheets/worksheet-signature";

/**
 * A MUNKALAP ALAIRASA A HELYSZINEN.
 *
 * === A LAP A SZERELO NEVEBEN ZARUL (Balazs dontese, 2026-09-03) ===
 *
 * A nev a BEJELENTKEZETT felhasznaloe, es a kepernyo NEM engedi atirni. A
 * szerelo nem az ugyfel nevet gepeli be. A dontes indoka a
 * `lib/worksheets/worksheet-signature.ts` fejleceben all, a szerver-oldali
 * hatarokkal egyutt.
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
  const [decision, setDecision] =
    useState<WorksheetSignatureDecision>("ACCEPTED");
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
  const signerName = user ? worksheetSignerName(user) : "";

  const sign = useMutation({
    mutationFn: async () => {
      const built = buildWorksheetSignaturePayload(
        { decision, note },
        signerName,
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
                <Text style={styles.sectionTitle}>Az ügyfél döntése</Text>
                <View style={styles.card}>
                  {/*
                    KET NAGY GOMB, NEM LEGORDULO LISTA. Ezt a kepernyot az
                    ugyfel kapja a kezebe: egy legorduloben a valasztas rejtve
                    van, es a nyitott lista alatt a dontes nem is latszik.
                  */}
                  <Pressable
                    onPress={() => {
                      setDecision("ACCEPTED");
                      setFormError(null);
                    }}
                    style={[
                      styles.choice,
                      decision === "ACCEPTED" && styles.choiceOn,
                    ]}
                  >
                    <Text
                      style={[
                        styles.choiceText,
                        decision === "ACCEPTED" && styles.choiceTextOn,
                      ]}
                    >
                      Elfogadom
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setDecision("REJECTED");
                      setFormError(null);
                    }}
                    style={[
                      styles.choice,
                      decision === "REJECTED" && styles.choiceOffOn,
                    ]}
                  >
                    <Text
                      style={[
                        styles.choiceText,
                        decision === "REJECTED" && styles.choiceTextOn,
                      ]}
                    >
                      Nem fogadom el
                    </Text>
                  </Pressable>
                </View>

                <Text style={styles.sectionTitle}>
                  {decision === "REJECTED"
                    ? "Miért nem fogadja el?"
                    : "Megjegyzés"}
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
                    placeholder={
                      decision === "REJECTED"
                        ? "Például: a szivattyú továbbra is zajos"
                        : "Nem kötelező"
                    }
                    placeholderTextColor="#5b7d8f"
                    style={[styles.input, styles.noteInput]}
                  />
                  {decision === "REJECTED" ? (
                    <Text style={styles.muted}>
                      Elutasításnál az indoklás kötelező: enélkül nem derül ki,
                      mit kell javítani.
                    </Text>
                  ) : null}
                </View>

                {/*
                  A NEV, ZARVA. Nem `editable={false}` mezoben, hanem sima
                  szovegkent: egy letiltott beviteli mezo ugy nez ki, mint egy
                  mezo, amit "valamiert" nem lehet szerkeszteni, es az elso
                  kerdes az lesz, hogyan lehetne megis.
                */}
                <Text style={styles.sectionTitle}>Aláíró</Text>
                <View style={styles.card}>
                  <Text style={styles.signer}>{signerName}</Text>
                  <Text style={styles.muted}>
                    A lap a bejelentkezett szerelő nevében zárul. A név nem
                    módosítható.
                  </Text>
                </View>

                {formError ? (
                  <Text style={styles.error}>{formError}</Text>
                ) : null}

                <Pressable
                  disabled={sign.isPending}
                  onPress={() => sign.mutate()}
                  style={[
                    styles.submitButton,
                    sign.isPending && styles.disabled,
                  ]}
                >
                  <Text style={styles.submitText}>
                    {sign.isPending ? "Rögzítés…" : "Döntés rögzítése"}
                  </Text>
                </Pressable>
                <Text style={styles.muted}>
                  A rögzítés végleges: a lap ezután nem írható át, a munka
                  folytatása új lapra kerül.
                </Text>
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
  signer: { color: "#f4fbff", fontSize: 18, fontWeight: "800" },
  choice: {
    alignItems: "center",
    backgroundColor: "#08192a",
    borderColor: "#17394f",
    borderRadius: 12,
    borderWidth: 2,
    padding: 16,
  },
  choiceOn: { backgroundColor: "#123f3b", borderColor: "#52d6c7" },
  choiceOffOn: { backgroundColor: "#4a1f2b", borderColor: "#ff8f80" },
  choiceText: { color: "#a8c4d2", fontSize: 16, fontWeight: "800" },
  choiceTextOn: { color: "#f4fbff" },
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
