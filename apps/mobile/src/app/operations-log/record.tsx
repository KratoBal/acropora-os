import { useQuery, useMutation } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ConnectivityBanner } from "@/components/offline/ConnectivityBanner";
import { PhotoFieldInput } from "@/components/operations-log/PhotoFieldInput";
import { ApiError } from "@/lib/api/client";
import {
  createOperationsEntry,
  uploadOperationsEntryPhoto,
  type OperationsTemplateField,
} from "@/lib/api/operations-log";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import { deviceConnectivity, useIsOnline } from "@/lib/offline/connectivity";
import {
  enqueueOperationsEntry,
  enqueuePhoto,
} from "@/lib/offline/queue-store";
import { saveOrQueue } from "@/lib/offline/save-or-queue";
import {
  buildOperationsEntry,
  emptyOperationsEntryForm,
  ENTRY_LIMITS,
  type OperationsEntryForm,
  type OperationsEntryFormField,
} from "@/lib/operations-log/entry-form";
import { handleEntryPhotos } from "@/lib/operations-log/entry-photos";
import {
  loadOperationsColleagues,
  loadOperationsTemplates,
} from "@/lib/operations-log/operations-load";
import { operationsPhotoClientKey } from "@/lib/operations-log/photo-key";
import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";

/**
 * ÜZEMELTETÉSI NAPLÓ BEJEGYZÉS RÖGZÍTÉSE (task os-uzemeltetesi-naplo, S2c).
 *
 * A KÉPERNYŐ A `aquariums/[id]/measurement.tsx` MINTÁJÁRA ÁLL (Balázs feltétele: a képernyők illeszkedjenek a jelenlegi designba):
 * Mégse / cím / Kész fejléc, kártyákba rendezett mezők, ugyanaz a téma és ugyanaz az offline sorba állítás (`saveOrQueue`). Az
 * eszközt az eszköz lapjáról (vagy a QR-kód beolvasása után az eszköz lapjáról) nyitjuk: az `assetId` és a sablon a paraméter.
 *
 * AZ IDŐ A TELEFONÉ, NEM GÉPELT: a „Kezdés” gomb a kezdést, a „Kész” a befejezést rögzíti (`entry-form.ts`). Amíg a Kezdés nem volt
 * megnyomva, a „Kész” nem küld, és megmondja, miért.
 *
 * A MEZŐK A SABLONBÓL JÖNNEK: szám (egységgel), igen/nem, szöveg és fénykép. A sablon és a kollégák listája térerő nélkül a legutóbb
 * betöltött másolatból jön (`operations-load.ts`), és a képernyő kimondja, ha másolatot lát. A képek a rögzítés UTÁN mennek
 * (`entry-photos.ts`): térerő nélkül a sorban várnak, a rögzítéssel együtt.
 *
 * AMIT A KÉPERNYŐ MA NEM TUD, és ez szándékos szűkítés: a megkezdett (de be nem fejezett) rögzítés nem éli túl az alkalmazás
 * újraindítását (a Kezdés ideje a képernyő állapota), és a bejegyzés utólag a telefonról nem szerkeszthető (a webes napló dolga).
 */
export default function RecordOperationsEntryScreen() {
  const { assetId, assetName, templateId } = useLocalSearchParams<{
    assetId: string;
    assetName?: string;
    templateId: string;
  }>();
  const router = useRouter();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user) : null;
  const online = useIsOnline();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);

  const enabled = Boolean(
    assetId && capabilities?.operationsLogRecord && status === "authenticated",
  );
  const templates = useQuery({
    queryKey: ["operations-templates", assetId],
    queryFn: () => loadOperationsTemplates(assetId),
    enabled,
  });
  const colleagues = useQuery({
    queryKey: ["operations-colleagues"],
    queryFn: loadOperationsColleagues,
    enabled,
  });
  const template = templates.data?.items.find((item) => item.id === templateId);

  const [form, setForm] = useState<OperationsEntryForm>(() =>
    emptyOperationsEntryForm(),
  );
  const [error, setError] = useState<{
    field: OperationsEntryFormField | null;
    message: string;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!template) throw new Error("A sablon nem található.");
      const finishedAt = new Date();
      const built = buildOperationsEntry({
        template,
        assetId,
        assetLabel: assetName?.trim() || "eszköz",
        form,
        now: finishedAt,
      });
      if (!built.ok) return { kind: "rejected", problem: built } as const;
      // a `queueTitle` csak a sor listájának szól, a szervernek nem megy
      const { queueTitle: _queueTitle, ...input } = built.payload;
      const outcome = await saveOrQueue({
        connectivity: deviceConnectivity,
        save: async () => {
          const created = await createOperationsEntry(input);
          return { id: created.entry.id };
        },
        enqueue: () =>
          enqueueOperationsEntry({
            id: built.operationId,
            payload: built.payload,
            createdAt: input.startedAt,
          }),
        statusOf: (cause) => (cause instanceof ApiError ? cause.status : null),
        describeWrite: (result) =>
          result.ok
            ? {
                type: "queued",
                operationId: result.operationId,
                message:
                  "Nincs kapcsolat, ezért a rögzítés a feltöltésre várók közé került. Amint van térerő, magától felmegy.",
              }
            : {
                type: "queue-failed",
                message: `A rögzítést nem sikerült elmenteni a készülékre: ${result.error}`,
              },
      });
      const photoMessage = await handleEntryPhotos({
        outcome,
        photos: built.photos,
        createdAt: finishedAt.toISOString(),
        deps: {
          upload: (entryId, photo, rowId) =>
            uploadOperationsEntryPhoto(entryId, {
              file: photo.file,
              fieldKey: photo.fieldKey,
              clientOperationId: operationsPhotoClientKey(rowId),
            }),
          enqueue: (item) =>
            enqueuePhoto({ ...item, entityType: "operations-entry" }),
        },
      });
      return { kind: "done", outcome, photoMessage } as const;
    },
    onSuccess: (result) => {
      if (result.kind === "rejected") {
        setError({
          field: result.problem.field,
          message: result.problem.message,
        });
        return;
      }
      const { outcome, photoMessage } = result;
      if (outcome.type === "saved") {
        // a rögzítés fent van; a képekről szóló mondat a következő képernyőn már nem látszana, ezért itt maradunk, ha volt mit mondani
        if (photoMessage) setNotice(`A rögzítés felment. ${photoMessage}`);
        else router.back();
        setForm(emptyOperationsEntryForm());
        return;
      }
      if (outcome.type === "queued") {
        setNotice([outcome.message, photoMessage].filter(Boolean).join(" "));
        setForm(emptyOperationsEntryForm());
        return;
      }
      // "rejected" vagy "lost": az űrlap tartalma megmarad, a szerelő javíthat és újra próbálkozhat.
      setError({ field: null, message: outcome.message });
    },
    onError: (cause: unknown) => {
      setError({
        field: null,
        message:
          cause instanceof ApiError || cause instanceof Error
            ? cause.message
            : "A rögzítés mentése nem sikerült.",
      });
    },
  });

  if (status !== "authenticated" || !user) return <Redirect href="/login" />;
  if (!capabilities?.operationsLogRecord) return <Redirect href="/" />;

  function setValue(key: string, value: string | boolean) {
    setForm((prev) => ({ ...prev, values: { ...prev.values, [key]: value } }));
  }

  function toggleParticipant(id: string) {
    setForm((prev) => ({
      ...prev,
      participantIds: prev.participantIds.includes(id)
        ? prev.participantIds.filter((item) => item !== id)
        : [...prev.participantIds, id],
    }));
  }

  const startedLabel = form.startedAt
    ? form.startedAt.toLocaleTimeString("hu-HU", { timeStyle: "short" })
    : null;
  const fromCache =
    templates.data?.fromCache === true || colleagues.data?.fromCache === true;

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
          <Text style={styles.navTitle} numberOfLines={1}>
            {template?.name ?? "Üzemeltetési napló"}
          </Text>
          <Pressable
            onPress={() => {
              setError(null);
              setNotice(null);
              mutation.mutate();
            }}
            disabled={mutation.isPending || !template}
          >
            {mutation.isPending ? (
              <ActivityIndicator color={tokens.accent} />
            ) : (
              <Text style={styles.navSave}>Kész</Text>
            )}
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          {!online ? <ConnectivityBanner /> : null}
          {fromCache ? (
            <Text style={styles.hint}>
              A sablon és a kollégák listája a legutóbbi betöltésből való
              (térerő nélkül nem frissíthető).
            </Text>
          ) : null}

          {templates.isPending ? (
            <ActivityIndicator color={tokens.accent} />
          ) : templates.isError ? (
            <Text style={styles.error}>
              A sablonok nem töltődtek be, és a készüléken nincs mentett
              másolat. Nyisd meg az eszközt térerővel, és próbáld újra.
            </Text>
          ) : !template ? (
            <Text style={styles.error}>
              Ez a sablon már nem érhető el ehhez az eszközhöz.
            </Text>
          ) : (
            <>
              {assetName ? (
                <Text style={styles.assetName}>{assetName}</Text>
              ) : null}
              {template.description ? (
                <Text style={styles.hint}>{template.description}</Text>
              ) : null}

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Idő</Text>
                <View style={styles.timeRow}>
                  <Pressable
                    onPress={() => {
                      setError(null);
                      setForm((prev) => ({ ...prev, startedAt: new Date() }));
                    }}
                    style={styles.startButton}
                  >
                    <Text style={styles.startButtonText}>
                      {startedLabel ? "Újrakezdés" : "Kezdés"}
                    </Text>
                  </Pressable>
                  <Text style={styles.timeValue}>
                    {startedLabel
                      ? `Kezdve: ${startedLabel}`
                      : "Nincs elkezdve"}
                  </Text>
                </View>
                {error && error.field === "startedAt" ? (
                  <Text style={styles.error}>{error.message}</Text>
                ) : null}
              </View>

              {template.fields.length > 0 ? (
                <View style={styles.paramCard}>
                  {template.fields.map((field, index) => (
                    <FieldRow
                      key={field.key}
                      field={field}
                      divider={index > 0}
                      form={form}
                      invalid={error?.field === `field:${field.key}`}
                      onValue={(value) => setValue(field.key, value)}
                      onPhotos={(files) =>
                        setForm((prev) => ({
                          ...prev,
                          photos: { ...prev.photos, [field.key]: files },
                        }))
                      }
                      styles={styles}
                      tokens={tokens}
                    />
                  ))}
                </View>
              ) : null}
              {error && error.field?.startsWith("field:") ? (
                <Text style={styles.error}>{error.message}</Text>
              ) : null}

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Résztvevők</Text>
                <Text style={styles.hint}>
                  Te automatikusan szerepelsz. Ki dolgozott még veled?
                </Text>
                {colleagues.data && colleagues.data.items.length > 0 ? (
                  <View style={styles.chips}>
                    {colleagues.data.items.map((colleague) => {
                      const selected = form.participantIds.includes(
                        colleague.id,
                      );
                      return (
                        <Pressable
                          key={colleague.id}
                          onPress={() => toggleParticipant(colleague.id)}
                          style={[styles.chip, selected && styles.chipSelected]}
                        >
                          <Text
                            style={[
                              styles.chipText,
                              selected && styles.chipTextSelected,
                            ]}
                          >
                            {colleague.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : colleagues.isPending ? (
                  <ActivityIndicator color={tokens.accent} />
                ) : (
                  <Text style={styles.hint}>
                    A kollégák listája most nem érhető el, a rögzítés csak a te
                    nevedre készül.
                  </Text>
                )}
                {error && error.field === "participants" ? (
                  <Text style={styles.error}>{error.message}</Text>
                ) : null}
              </View>

              <View style={styles.section}>
                <View style={styles.switchRow}>
                  <Text style={styles.sectionTitle}>Rendellenesség</Text>
                  <Switch
                    value={form.anomaly}
                    onValueChange={(anomaly) =>
                      setForm((prev) => ({ ...prev, anomaly }))
                    }
                  />
                </View>
                {form.anomaly ? (
                  <Text style={styles.hint}>
                    A leírásból hibajegy nyílik, amelyet a partner is láthat:
                    ide ne kerüljön belső megjegyzés (az a lenti mezőbe való).
                  </Text>
                ) : null}
                {form.anomaly ? (
                  <TextInput
                    value={form.anomalyNote}
                    onChangeText={(anomalyNote) =>
                      setForm((prev) => ({ ...prev, anomalyNote }))
                    }
                    placeholder="Mi a rendellenesség? (a hibajegybe kerül)"
                    placeholderTextColor={tokens.textMuted}
                    style={[styles.input, styles.notesInput]}
                    maxLength={ENTRY_LIMITS.noteMax}
                    multiline
                  />
                ) : null}
                {error && error.field === "anomalyNote" ? (
                  <Text style={styles.error}>{error.message}</Text>
                ) : null}
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Belső megjegyzés</Text>
                <TextInput
                  value={form.internalNote}
                  onChangeText={(internalNote) =>
                    setForm((prev) => ({ ...prev, internalNote }))
                  }
                  placeholder="Ezt a partner nem látja"
                  placeholderTextColor={tokens.textMuted}
                  style={[styles.input, styles.notesInput]}
                  maxLength={ENTRY_LIMITS.noteMax}
                  multiline
                />
                {error && error.field === "internalNote" ? (
                  <Text style={styles.error}>{error.message}</Text>
                ) : null}
              </View>
            </>
          )}

          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          {error && error.field === null ? (
            <Text style={styles.error}>{error.message}</Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function FieldRow(props: {
  field: OperationsTemplateField;
  divider: boolean;
  form: OperationsEntryForm;
  invalid: boolean;
  onValue: (value: string | boolean) => void;
  onPhotos: (files: OperationsEntryForm["photos"][string]) => void;
  styles: ReturnType<typeof createStyles>;
  tokens: ThemeTokens;
}) {
  const { field, form, styles, tokens } = props;
  const raw = form.values[field.key];
  const label = field.required ? `${field.label} *` : field.label;
  return (
    <View style={[styles.paramRow, props.divider && styles.paramRowDivider]}>
      <Text style={styles.paramRowLabel}>{label}</Text>
      {field.type === "NUMBER" ? (
        <View style={styles.paramRowInputWrap}>
          <TextInput
            value={typeof raw === "string" ? raw : ""}
            onChangeText={props.onValue}
            keyboardType="decimal-pad"
            placeholder="—"
            placeholderTextColor={tokens.textMuted}
            style={[
              styles.paramRowInput,
              props.invalid && styles.paramRowInputError,
            ]}
          />
          {field.unit ? (
            <Text style={styles.paramRowUnit}>{field.unit}</Text>
          ) : null}
        </View>
      ) : field.type === "BOOLEAN" ? (
        <View style={styles.yesNo}>
          {([true, false] as const).map((choice) => (
            <Pressable
              key={String(choice)}
              onPress={() => props.onValue(choice)}
              style={[
                styles.yesNoButton,
                raw === choice && styles.yesNoSelected,
              ]}
            >
              <Text
                style={[
                  styles.yesNoText,
                  raw === choice && styles.yesNoTextSelected,
                ]}
              >
                {choice ? "Igen" : "Nem"}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : field.type === "TEXT" ? (
        <TextInput
          value={typeof raw === "string" ? raw : ""}
          onChangeText={props.onValue}
          placeholder="—"
          placeholderTextColor={tokens.textMuted}
          style={[styles.textInput, props.invalid && styles.paramRowInputError]}
          maxLength={ENTRY_LIMITS.textMax}
          multiline
        />
      ) : (
        <PhotoFieldInput
          files={form.photos[field.key] ?? []}
          onChange={props.onPhotos}
          max={ENTRY_LIMITS.photosPerFieldMax}
        />
      )}
    </View>
  );
}

function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: t.background },
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
      borderBottomColor: t.border,
      backgroundColor: t.surface,
      gap: 12,
    },
    navCancel: { color: t.accent, fontSize: 14 },
    navTitle: {
      color: t.textPrimary,
      fontSize: 16,
      fontWeight: "800",
      flexShrink: 1,
    },
    navSave: { color: t.accent, fontSize: 14, fontWeight: "800" },
    assetName: { color: t.textPrimary, fontSize: 18, fontWeight: "800" },
    paramCard: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 14,
      overflow: "hidden",
    },
    paramRow: {
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    paramRowDivider: { borderTopWidth: 1, borderTopColor: t.border },
    paramRowLabel: { color: t.textPrimary, fontSize: 14, fontWeight: "700" },
    paramRowInputWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
    paramRowInput: {
      color: t.textPrimary,
      fontSize: 15,
      textAlign: "right",
      minWidth: 96,
      flex: 1,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 6,
      backgroundColor: t.background,
    },
    paramRowInputError: { borderColor: t.danger },
    paramRowUnit: { color: t.textSecondary, fontSize: 12, minWidth: 40 },
    textInput: {
      color: t.textPrimary,
      fontSize: 15,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      minHeight: 44,
      backgroundColor: t.background,
    },
    yesNo: { flexDirection: "row", gap: 8 },
    yesNoButton: {
      flex: 1,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 10,
      paddingVertical: 10,
      alignItems: "center",
      backgroundColor: t.background,
    },
    yesNoSelected: { backgroundColor: t.accent, borderColor: t.accent },
    yesNoText: { color: t.textPrimary, fontSize: 14, fontWeight: "700" },
    yesNoTextSelected: { color: t.textOnAccent },
    section: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 14,
      padding: 14,
      gap: 10,
    },
    sectionTitle: { color: t.textPrimary, fontSize: 15, fontWeight: "800" },
    timeRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    startButton: {
      borderWidth: 1,
      borderColor: t.accent,
      borderRadius: 10,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    startButtonText: { color: t.accent, fontSize: 14, fontWeight: "800" },
    timeValue: { color: t.textPrimary, fontSize: 15 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: {
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: t.background,
    },
    chipSelected: { backgroundColor: t.accent, borderColor: t.accent },
    chipText: { color: t.textPrimary, fontSize: 13 },
    chipTextSelected: { color: t.textOnAccent, fontWeight: "700" },
    switchRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    input: {
      color: t.textPrimary,
      fontSize: 15,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: t.background,
    },
    notesInput: { minHeight: 70, textAlignVertical: "top" },
    hint: { color: t.textSecondary, fontSize: 12 },
    notice: { color: t.accent, fontSize: 13 },
    error: { color: t.danger, fontSize: 13 },
  });
}
