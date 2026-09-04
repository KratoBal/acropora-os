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

import {
  listWorksheetEntries,
  updateWorksheetEntry,
} from "@/lib/api/worksheets";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import { describeCacheAge } from "@/lib/offline/offline-notice";
import {
  buildWorksheetEntry,
  worksheetEntryByline,
} from "@/lib/worksheets/worksheet-entry";

/**
 * EGY BEJEGYZES KULON LAPON.
 *
 * Balazs kerese, 2026-09-03: "ha rakattint egyre akkor nyiljon meg kulon lapon
 * (...) Felul vissza gomb a munkalapra."
 *
 * === KET AZONOSITO KELL, ES CSAK AZ EGYIK VAN AZ UTVONALBAN ===
 *
 * Az utvonal a MUNKALAP azonositojara szol, a bejegyzese parameterkent jon. Ez
 * szandekos: a keperno igy a lap teljes naplojat le tudja kerni, es abbol
 * valasztja ki a sort -- vagyis HIDEG INDITASBOL is felall, nem csak akkor, ha
 * a listarol erkezik. Egy csak-bejegyzes-azonositoju utvonalhoz kulon vegpont
 * kellene, amit ezen kivul senki nem hivna.
 *
 * A DONTESEK a `lib/worksheets/worksheet-entry.ts`-ben allnak, mert ott
 * MERHETOK; a szerkesztes JOGA pedig a szerveren, es a valasz `canEdit` mezoje
 * hozza ide -- a keperno nem szamolja ujra.
 */
export default function WorksheetEntryScreen() {
  const { id, entryId } = useLocalSearchParams<{
    id: string;
    entryId?: string;
  }>();
  const router = useRouter();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const entries = useQuery({
    queryKey: ["worksheet-entries", id],
    queryFn: () => listWorksheetEntries(id),
    enabled: Boolean(
      id && capabilities?.worksheetsView && status === "authenticated",
    ),
  });

  const save = useMutation({
    mutationFn: async () => {
      const built = buildWorksheetEntry(draft ?? "");
      if (!built.ok) throw new Error(built.message ?? "A bejegyzés üres.");
      if (!entryId) throw new Error("Nincs megnyitott bejegyzés.");
      return updateWorksheetEntry(id, entryId, built.body);
    },
    onSuccess: async () => {
      setDraft(null);
      setError(null);
      await queryClient.invalidateQueries({
        queryKey: ["worksheet-entries", id],
      });
    },
    onError: (cause) =>
      setError(
        cause instanceof Error ? cause.message : "A bejegyzés nem menthető.",
      ),
  });

  if (status !== "authenticated" || !user || !capabilities)
    return <Redirect href="/login" />;
  if (!capabilities.worksheetsView) return <Redirect href="/" />;

  const entry = entries.data?.items.find((item) => item.id === entryId) ?? null;

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.container}>
        {/*
          A VISSZA GOMB FELUL, es Balazs kifejezetten ezt kerte. A telefon sajat
          visszalepese nem helyettesiti: aki ertesitesbol vagy melylinkbol
          erkezik, annak nincs hova visszalepnie.
        */}
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.push({ pathname: "/worksheets/[id]", params: { id } })
          }
        >
          <Text style={styles.back}>← Vissza a munkalapra</Text>
        </Pressable>
        <Text style={styles.eyebrow}>BEJEGYZÉS</Text>

        {entries.isPending ? <ActivityIndicator color="#52d6c7" /> : null}

        {/*
          A HIANYZO BEJEGYZES KIMONDVA. Ha a lista betoltodott es a sor nincs
          benne, azt NEM ures kepernyovel mondjuk el: torolhettek, vagy rossz
          azonositoval nyilt meg -- a szerelo mindket esetben azt latna, hogy
          "nem tortent semmi".
        */}
        {!entries.isPending && !entry ? (
          <View style={styles.card}>
            <Text style={styles.muted}>
              Ezt a bejegyzést nem találjuk ezen a munkalapon. Lehet, hogy
              időközben megszűnt.
            </Text>
          </View>
        ) : null}

        {entry ? (
          <>
            <View style={styles.card}>
              <Text style={styles.byline}>
                {worksheetEntryByline(entry, (iso) =>
                  describeCacheAge(iso, new Date()),
                )}
              </Text>
              {draft === null ? (
                <Text style={styles.body}>{entry.body}</Text>
              ) : (
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  multiline
                  style={styles.input}
                  accessibilityLabel="A bejegyzés szövege"
                />
              )}
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            {/*
              A SZERKESZTES JOGA A SZERVERTOL JON. A telefon nem szamolja ujra:
              a szabaly (a lap keszitoje vagy a jegy nyitoja) a szerveren all, es
              az a keres is elutasitja. Ket masolat elcsuszhatna.
            */}
            {entry.canEdit ? (
              draft === null ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setDraft(entry.body)}
                  style={styles.button}
                >
                  <Text style={styles.buttonText}>Szerkesztem</Text>
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  disabled={save.isPending}
                  onPress={() => save.mutate()}
                  style={[styles.button, save.isPending && styles.disabled]}
                >
                  <Text style={styles.buttonText}>
                    {save.isPending ? "Mentés…" : "Rögzítés"}
                  </Text>
                </Pressable>
              )
            ) : (
              /*
                A HIANYZO GOMB MAGYARAZATA A SZERVERTOL JON, ES KET KULON ESET
                VAN: van kit megkerni, vagy senki nem szerkesztheti (a lap
                keszitoje es a jegy nyitoja is ismeretlen). Enelkul a hianyzo
                gomb ugy nez ki, mint hiba a programban.
              */
              <Text style={styles.muted}>{entry.editRefusal}</Text>
            )}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#071827" },
  container: { padding: 18, paddingBottom: 48, gap: 14 },
  back: { color: "#52d6c7", fontSize: 15, fontWeight: "700" },
  eyebrow: {
    color: "#52d6c7",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  card: {
    backgroundColor: "#0d2438",
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  byline: { color: "#91afbe", fontSize: 13 },
  body: { color: "#f4fbff", fontSize: 16, lineHeight: 23 },
  muted: { color: "#91afbe", fontSize: 14, lineHeight: 20 },
  error: { color: "#ffb4ab", fontSize: 14 },
  input: {
    backgroundColor: "#071827",
    borderRadius: 10,
    color: "#f4fbff",
    minHeight: 120,
    padding: 12,
    textAlignVertical: "top",
  },
  button: {
    alignItems: "center",
    backgroundColor: "#52d6c7",
    borderRadius: 12,
    padding: 14,
  },
  buttonText: { color: "#04212c", fontSize: 15, fontWeight: "800" },
  disabled: { opacity: 0.6 },
});
