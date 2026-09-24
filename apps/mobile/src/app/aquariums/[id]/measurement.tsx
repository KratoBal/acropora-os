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
 */
export default function NewAquariumMeasurementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;

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
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.eyebrow}>VÍZÉRTÉKEK</Text>
          <Text style={styles.title}>Új mérés</Text>

          {aquarium.isPending ? (
            <ActivityIndicator color="#52d6c7" />
          ) : (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Paraméterek</Text>
              {parameters.map((param, index) => (
                <Field
                  key={param.code}
                  label={`${param.label} (${param.unit})`}
                  value={form.values[index]?.text ?? ""}
                  onChangeText={(text) => updateValue(index, text)}
                  keyboardType="decimal-pad"
                  error={
                    error?.field === `values.${index}` ? error.message : null
                  }
                />
              ))}
            </View>
          )}

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

          {error && error.field === "values" ? (
            <Text style={styles.error}>{error.message}</Text>
          ) : null}
          {error && error.field === null ? (
            <Text style={styles.error}>{error.message}</Text>
          ) : null}

          <Pressable
            onPress={submit}
            disabled={mutation.isPending || aquarium.isPending}
            style={({ pressed }) => [
              styles.submit,
              (pressed || mutation.isPending || aquarium.isPending) &&
                styles.pressed,
            ]}
          >
            {mutation.isPending ? (
              <ActivityIndicator color="#071827" />
            ) : (
              <Text style={styles.submitText}>Mentés</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  keyboardType,
  error,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?: "default" | "decimal-pad";
  error?: string | null;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType ?? "default"}
        placeholderTextColor="#668798"
        style={styles.input}
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#071827" },
  flex: { flex: 1 },
  container: { padding: 18, paddingBottom: 48, gap: 14 },
  eyebrow: {
    color: "#52d6c7",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  title: { color: "#f4fbff", fontSize: 28, fontWeight: "900" },
  section: {
    backgroundColor: "#0d2b40",
    borderColor: "#1c4963",
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  sectionTitle: { color: "#f4fbff", fontSize: 15, fontWeight: "800" },
  field: { gap: 6 },
  fieldLabel: { color: "#91afbe", fontSize: 12 },
  fieldError: { color: "#fecaca", fontSize: 12 },
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
  submit: {
    backgroundColor: "#52d6c7",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  pressed: { opacity: 0.85 },
  submitText: { color: "#071827", fontSize: 15, fontWeight: "900" },
});
