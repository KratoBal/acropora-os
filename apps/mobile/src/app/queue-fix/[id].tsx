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

import { assetFormFromPayloadJson } from "@/lib/assets/asset-payload-form";
import { buildAssetCreatePayload } from "@/lib/assets/asset-create";
import type { AssetCreateForm } from "@/lib/assets/asset-create";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import { allQueueRows, applyQueueResend } from "@/lib/offline/queue-store";
import { describeQueueError } from "@/lib/offline/queue-inspection";
import {
  queueResendEligibility,
  queueResendPatch,
} from "@/lib/offline/queue-resend";

/**
 * EGY ELAKADT FELVITEL JAVITASA, A HELYSZINEN.
 *
 * Egy `conflict` allapotu sornak eddig NEM VOLT KIJARATA: a szerelo latta a
 * sorban, olvasta a hibauzenetet, es nem tudott vele csinalni semmit.
 *
 * === MIERT A JAVITAS ES NEM AZ ELVETES AZ ELSO ===
 *
 * Ha az elvetes keszult volna el eloszor, a keperno EGYETLEN gombja az lenne,
 * hogy a szerelo eldobja a sajat munkajat -- es a helyszinen siető ember meg
 * is nyomna, mert az van ott. Az adat NEMAN veszne el. Igy a rosszabbik eset
 * az, hogy egy utkozes BENT RAGAD, amig az elvetes is meglesz: az LATHATO.
 * (acrobot dontese, 2026-09-03.)
 *
 * === AMIT EZ A KEPERNYO NEM ENGED ATIRNI, ES MIERT ===
 *
 * A tulajdonos, a fajta es a datumok NEM szerkesztheto itt. Nem elfelejtettuk:
 * azok VALASZTOK (partner-lista, helyszin-fa, datumvalaszto), es egy elakadt
 * felvitel javitasa nem az a pillanat, amikor valaki ujra vegigmegy rajtuk.
 * Ami itt all, az a hat SZOVEGES mezo -- koztuk a matricakod, ami a valodi
 * utkozest okozza. Ha egyszer kiderul, hogy a tulajdonost is javitani kell,
 * az kulon szelet, es ez a bekezdes akkor valtozik.
 */

/**
 * CSAK A SZOVEGES MEZOK, ES A TIPUS EZT KI IS KENYSZERITI.
 *
 * Az elso valtozatban `keyof AssetCreateForm` allt itt, es a FORDITO SZOLT: az
 * `owner` nem szoveg, hanem objektum, tehat egy `TextInput` `value` mezojebe
 * nem valo. Ez pontosan az a jelzes, amiert a szuk tipus van -- egy `string`
 * kaszt elnyelte volna, es a hiba a kepernyon jelent volna meg, ures mezokent.
 */
type SzovegesMezo = Extract<
  {
    [K in keyof AssetCreateForm]: AssetCreateForm[K] extends string ? K : never;
  }[keyof AssetCreateForm],
  string
>;

const MEZOK: { key: SzovegesMezo; label: string }[] = [
  { key: "name", label: "Megnevezés" },
  { key: "labelCode", label: "Matricakód" },
  { key: "manufacturer", label: "Gyártó" },
  { key: "model", label: "Modell" },
  { key: "serialNumber", label: "Sorozatszám" },
  { key: "inventoryNumber", label: "Partner azonosítója" },
];

export default function QueueFixScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;

  const [draft, setDraft] = useState<AssetCreateForm | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sor = useQuery({
    queryKey: ["queue-row", id],
    queryFn: async () => {
      const rows = await allQueueRows();
      return rows.find((r) => r.id === id) ?? null;
    },
    enabled: Boolean(id && status === "authenticated"),
  });

  /**
   * AZ URLAP A TAROLT TORZSBOL INDUL, DE AMINT A SZERELO GEPEL, AZ OVE.
   *
   * NINCS `useEffect`, es ez nem stilus: egy effektbol allitott allapot itt
   * ket bajt hozna. Egy render kesest (az elso kepen meg ures urlap all), es
   * egy fuggoseg-csapdat -- ha a sor barmiert ujra betoltodne, az effekt
   * visszaallitana a MENTETT torzset a szerelo ala, gepeles kozben. Igy a
   * piszkozat hianya EGYSZERUEN azt jelenti, hogy meg nem nyult hozza.
   */
  const form =
    draft ?? (sor.data ? assetFormFromPayloadJson(sor.data.payloadJson) : null);

  const mentes = useMutation({
    mutationFn: async () => {
      if (!form) throw new Error("Ezt a felvitelt nem lehet megnyitni.");
      const built = buildAssetCreatePayload(form);
      if (!built.ok) throw new Error(built.message);
      const result = await applyQueueResend(
        id,
        queueResendPatch(JSON.stringify(built.payload)),
      );
      if (!result.ok) throw new Error(result.error);
      /**
       * NULLA MOZDULT SOR NEM SIKER. A keperno megnyitasa es a mentes kozott a
       * sor elindulhatott egy masik kiuritessel: ilyenkor a torzset MAR NEM
       * szabad atirni, es ezt ki kell mondani, nem elnyelni.
       */
      if (result.changed === 0)
        throw new Error(
          "Ez a felvitel közben elindult, ezért nem írtuk át. Nézd meg a listán, mi lett vele.",
        );
      return result;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["queue"] });
      await queryClient.invalidateQueries({ queryKey: ["queue-row", id] });
      router.replace("/queue");
    },
    onError: (cause) =>
      setError(
        cause instanceof Error ? cause.message : "A javítás nem menthető.",
      ),
  });

  if (status !== "authenticated" || !user || !capabilities)
    return <Redirect href="/login" />;
  if (!capabilities.assetsManage) return <Redirect href="/" />;

  const row = sor.data;
  const jogosult = row
    ? queueResendEligibility({
        state: row.state,
        operation: row.operation,
        entityType: row.entityType,
      })
    : null;

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.eyebrow}>ELAKADT FELVITEL</Text>

        {sor.isPending ? <ActivityIndicator color="#52d6c7" /> : null}

        {sor.data === null && !sor.isPending ? (
          <Text style={styles.error}>
            Ez a felvitel már nincs a soron: vagy felment, vagy törölték.
          </Text>
        ) : null}

        {row && jogosult && !jogosult.ok ? (
          <View style={styles.card}>
            <Text style={styles.muted}>{jogosult.message}</Text>
          </View>
        ) : null}

        {row && jogosult?.ok ? (
          <>
            {/*
              AMI A SZERVER SZERINT A BAJ. Ez az EGYETLEN adat, amibol a szerelo
              megtudja, MIT kell atirnia -- a felette allo mezok magukban nem
              mondjak meg, melyik utkozik.
            */}
            <View style={styles.card}>
              <Text style={styles.label}>A szerver ezt válaszolta</Text>
              <Text style={styles.value}>
                {describeQueueError(row.lastError).message ??
                  "Nincs részletes üzenet."}
              </Text>
            </View>

            {form === null ? (
              <Text style={styles.error}>
                Ezt a felvitelt nem lehet megnyitni: a mentett tartalma hiányos.
                Szólj az irodának, ők a sorból ki tudják venni.
              </Text>
            ) : (
              <>
                {MEZOK.map((mezo) => (
                  <View key={mezo.key} style={styles.card}>
                    <Text style={styles.label}>{mezo.label}</Text>
                    <TextInput
                      value={form[mezo.key]}
                      onChangeText={(next) => {
                        setDraft({ ...form, [mezo.key]: next });
                        setError(null);
                      }}
                      placeholderTextColor="#5b7d8f"
                      style={styles.input}
                    />
                  </View>
                ))}

                <Text style={styles.muted}>
                  A partner, a fajta és a dátumok itt nem módosíthatók: azokat a
                  felvitel képernyőjén lehet megadni.
                </Text>

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <Pressable
                  disabled={mentes.isPending}
                  onPress={() => mentes.mutate()}
                  style={[
                    styles.submitButton,
                    mentes.isPending && styles.disabled,
                  ]}
                >
                  <Text style={styles.submitText}>
                    {mentes.isPending ? "Mentés…" : "Javítás és újraküldés"}
                  </Text>
                </Pressable>
                <Text style={styles.muted}>
                  A felvitel visszakerül a sorba, és a következő kapcsolatnál
                  újra elindul.
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
  card: {
    backgroundColor: "#0d2b40",
    borderColor: "#1c4963",
    borderWidth: 1,
    borderRadius: 16,
    gap: 6,
    padding: 14,
  },
  label: { color: "#789cad", fontSize: 12, fontWeight: "700" },
  value: { color: "#f4fbff", fontSize: 14 },
  muted: { color: "#789cad", fontSize: 12 },
  input: {
    backgroundColor: "#08192a",
    borderColor: "#17394f",
    borderRadius: 10,
    borderWidth: 1,
    color: "#f4fbff",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
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
  disabled: { opacity: 0.55 },
});
