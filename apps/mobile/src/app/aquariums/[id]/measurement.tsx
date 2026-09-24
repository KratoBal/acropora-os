import { useMutation, useQuery } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ConnectivityBanner } from "@/components/offline/ConnectivityBanner";
import { ApiError } from "@/lib/api/client";
import { createAquariumMeasurement, getAquarium } from "@/lib/api/aquariums";
import {
  aquariumMeasurementParametersFor,
  buildAquariumMeasurementPayload,
  emptyAquariumMeasurementForm,
  type AquariumMeasurementForm,
} from "@/lib/aquariums/aquarium-measurement-create";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import { useIsOnline } from "@/lib/offline/connectivity";
import { enqueueAquariumMeasurement } from "@/lib/offline/queue-store";
import { saveOrQueue } from "@/lib/offline/save-or-queue";
import { aquariumMeasurementOperationId } from "@/lib/offline/sync-queue";

/**
 * ÚJ VÍZMÉRÉSI ALKALOM FELVITELE.
 *
 * Ugyanaz az offline sorba-állítási minta, mint az akvárium saját felvitele
 * (`aquariums/new.tsx`): térerő nélkül a `saveOrQueue` a helyi sorba teszi,
 * és a `useQueueDrain` küldi fel, amint van hálózat.
 *
 * === MIÉRT KÜLÖN KÉPERNYŐ, NEM AZ ADATLAPBA ÉPÍTVE ===
 *
 * Az eszköz-felvitel az adatlapba fér (néhány mező), a vízmérés viszont a
 * VÍZTÍPUSTÓL FÜGGŐ, akár tucatnyi paraméterű űrlap -- ugyanaz a döntés, ami
 * az akvárium saját felvitelét is külön képernyőre tette.
 *
 * === A VÍZTÍPUS AZ AKVÁRIUMTÓL JÖN, NEM AZ ŰRLAP MEZŐJE ===
 *
 * A paraméter-sorok az akvárium `waterType`-jától függenek
 * (`aquariumMeasurementParametersFor`), ezért ez a képernyő ELŐSZÖR lekéri
 * magát az akváriumot, és csak utána építi fel az űrlapot -- addig egy üres,
 * víztípus NÉLKÜLI (tehát teljes paraméterlistás) alak látszana egy
 * pillanatra, ami félrevezető lenne egy tengeri akváriumnál (édesvízi
 * mezőket is mutatna).
 *
 * === CSAK A KITÖLTÖTT PARAMÉTEREK MENTŐDNEK -- lásd a döntést a
 * `lib/aquariums/aquarium-measurement-create.ts`-ben, mert ott MÉRHETŐ.
 *
 * === A FEJLÉC ÉS A PARAMÉTER-SOROK (2026-09-24, acrobot kérése) ===
 *
 * A Figma-terv (`exchange/figma-akvariumok-make-2`) "Új vízmérés" mobil
 * képernyőjének szerkezetét követi (Mégse/cím/Mentés fejléc, egy kártyába
 * rendezett paraméter-sorok), a mai sötét témával. A "Mérés ideje" mező
 * SZÁNDÉKOSAN hiányzik onnan: a Figma azt szerkeszthetőnek szánja, itt viszont
 * a `measuredAt` a MENTÉS PILLANATÁBAN keletkezik (lásd lent, a `mutationFn`
 * elején) -- egy hosszan nyitva tartott űrlapon egy előre felvitt időpont
 * elavulna, mire a mentés megtörténik.
 */
export default function NewAquariumMeasurementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;
  const online = useIsOnline();

  const aquarium = useQuery({
    queryKey: ["aquarium", id],
    queryFn: () => getAquarium(id),
    enabled: Boolean(
      id && capabilities?.aquariumsManage && status === "authenticated",
    ),
  });

  const [form, setForm] = useState<AquariumMeasurementForm>(() =>
    emptyAquariumMeasurementForm(null),
  );
  const [error, setError] = useState<{
    field: string | null;
    message: string;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * EGYSZERI ÚJRAÉPÍTÉS, AMINT AZ AKVÁRIUM VÍZTÍPUSA MEGÉRKEZIK -- a `ref`
   * őrzi, hogy ez csak EGYSZER fusson: egy későbbi háttér-frissítés
   * (`useQuery` refetch) ne írja felül a felhasználó időközben megkezdett
   * gépelését.
   */
  const initialized = useRef(false);
  useEffect(() => {
    if (aquarium.data && !initialized.current) {
      initialized.current = true;
      setForm(emptyAquariumMeasurementForm(aquarium.data.waterType ?? null));
    }
  }, [aquarium.data]);

  const mutation = useMutation({
    mutationFn: async (
      payload: Extract<
        ReturnType<typeof buildAquariumMeasurementPayload>,
        { ok: true }
      >["payload"],
    ) => {
      const measuredAt = new Date().toISOString();
      const operationId = aquariumMeasurementOperationId({
        aquariumId: id,
        measuredAt,
      });
      return saveOrQueue({
        save: () =>
          createAquariumMeasurement(id, {
            ...payload,
            measuredAt,
            clientOperationId: operationId,
          }),
        enqueue: () =>
          enqueueAquariumMeasurement({
            id: operationId,
            aquariumId: id,
            payload: { ...payload, measuredAt },
            createdAt: measuredAt,
          }),
        statusOf: (cause) => (cause instanceof ApiError ? cause.status : null),
        describeWrite: (result) =>
          result.ok
            ? {
                type: "queued",
                operationId: result.operationId,
                message:
                  "Nincs kapcsolat, ezért a mérés a feltöltésre várók közé került. Amint van térerő, magától felmegy.",
              }
            : {
                type: "queue-failed",
                message: `A mérést nem sikerült elmenteni a készülékre: ${result.error}`,
              },
      });
    },
    onSuccess: (outcome) => {
      if (outcome.type === "saved") {
        router.back();
        return;
      }
      if (outcome.type === "queued") {
        setNotice(outcome.message);
        setForm(emptyAquariumMeasurementForm(aquarium.data?.waterType ?? null));
        return;
      }
      // "rejected" vagy "lost": az űrlap tartalma megmarad, a szerelő
      // javíthat és újra próbálkozhat.
      setError({ field: null, message: outcome.message });
    },
    onError: (cause: unknown) => {
      setError({
        field: null,
        message:
          cause instanceof ApiError || cause instanceof Error
            ? cause.message
            : "A mérés mentése nem sikerült.",
      });
    },
  });

  if (status !== "authenticated" || !user) return <Redirect href="/login" />;
  if (!capabilities?.aquariumsManage) return <Redirect href="/" />;

  function updateValue(index: number, text: string) {
    setForm((prev) => ({
      ...prev,
      values: prev.values.map((row, i) =>
        i === index ? { ...row, text } : row,
      ),
    }));
  }

  function submit() {
    const result = buildAquariumMeasurementPayload(form);
    if (!result.ok) {
      setError({ field: result.field, message: result.message });
      return;
    }
    setError(null);
    setNotice(null);
    mutation.mutate(result.payload);
  }

  const parameters = aquariumMeasurementParametersFor(
    aquarium.data?.waterType ?? null,
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.navBar}>
          <Pressable
            onPress={() => router.back()}
            disabled={mutation.isPending}
          >
            <Text style={styles.navCancel}>Mégse</Text>
          </Pressable>
          <Text style={styles.navTitle}>Új vízmérés</Text>
          <Pressable
            onPress={submit}
            disabled={mutation.isPending || aquarium.isPending}
          >
            {mutation.isPending ? (
              <ActivityIndicator color="#52d6c7" />
            ) : (
              <Text style={styles.navSave}>Mentés</Text>
            )}
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          {!online ? <ConnectivityBanner /> : null}

          {aquarium.isPending ? (
            <ActivityIndicator color="#52d6c7" />
          ) : (
            <View style={styles.paramCard}>
              {parameters.map((param, index) => {
                const rowError = error?.field === `values.${index}`;
                const filled = (form.values[index]?.text ?? "").trim() !== "";
                return (
                  <View
                    key={param.code}
                    style={[
                      styles.paramRow,
                      index > 0 && styles.paramRowDivider,
                    ]}
                  >
                    <Text
                      style={[
                        styles.paramRowLabel,
                        filled && styles.paramRowLabelFilled,
                      ]}
                    >
                      {param.label}
                    </Text>
                    <View style={styles.paramRowInputWrap}>
                      <TextInput
                        value={form.values[index]?.text ?? ""}
                        onChangeText={(text) => updateValue(index, text)}
                        keyboardType="decimal-pad"
                        placeholder="—"
                        placeholderTextColor="#4a6a7d"
                        style={[
                          styles.paramRowInput,
                          rowError && styles.paramRowInputError,
                        ]}
                      />
                      <Text style={styles.paramRowUnit}>{param.unit}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
          {error && error.field?.startsWith("values") ? (
            <Text style={styles.error}>{error.message}</Text>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Megjegyzés</Text>
            <TextInput
              value={form.notes}
              onChangeText={(notes) => setForm((prev) => ({ ...prev, notes }))}
              placeholder="Például: vízcsere után"
              placeholderTextColor="#668798"
              style={[styles.input, styles.notesInput]}
              multiline
            />
          </View>

          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          {error && error.field === null ? (
            <Text style={styles.error}>{error.message}</Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#071827" },
  flex: { flex: 1 },
  container: { padding: 18, paddingBottom: 48, gap: 14 },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1c4963",
    backgroundColor: "#0d2b40",
  },
  navCancel: { color: "#52d6c7", fontSize: 14 },
  navTitle: { color: "#f4fbff", fontSize: 16, fontWeight: "800" },
  navSave: { color: "#52d6c7", fontSize: 14, fontWeight: "800" },
  paramCard: {
    backgroundColor: "#0d2b40",
    borderColor: "#1c4963",
    borderWidth: 1,
    borderRadius: 14,
    overflow: "hidden",
  },
  paramRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  paramRowDivider: { borderTopWidth: 1, borderTopColor: "#132f42" },
  paramRowLabel: { color: "#91afbe", fontSize: 14, flexShrink: 1 },
  paramRowLabelFilled: { color: "#f4fbff", fontWeight: "700" },
  paramRowInputWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  paramRowInput: {
    color: "#f4fbff",
    fontSize: 15,
    textAlign: "right",
    minWidth: 64,
    borderWidth: 1,
    borderColor: "#1c4963",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: "#071827",
  },
  paramRowInputError: { borderColor: "#fca5a5" },
  paramRowUnit: { color: "#789cad", fontSize: 11, minWidth: 40 },
  section: {
    backgroundColor: "#0d2b40",
    borderColor: "#1c4963",
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  sectionTitle: { color: "#f4fbff", fontSize: 15, fontWeight: "800" },
  input: {
    color: "#f4fbff",
    fontSize: 15,
    borderWidth: 1,
    borderColor: "#1c4963",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#071827",
  },
  notesInput: { minHeight: 70, textAlignVertical: "top" },
  notice: { color: "#52d6c7", fontSize: 13 },
  error: { color: "#fecaca", fontSize: 13 },
});
