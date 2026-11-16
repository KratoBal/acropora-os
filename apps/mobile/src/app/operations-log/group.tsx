import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ConnectivityBanner } from "@/components/offline/ConnectivityBanner";
import {
  FieldRow,
  createRecordStyles,
} from "@/components/operations-log/record-ui";
import { ApiError } from "@/lib/api/client";
import {
  createOperationsEntry,
  uploadOperationsEntryPhoto,
} from "@/lib/api/operations-log";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import { deviceConnectivity, useIsOnline } from "@/lib/offline/connectivity";
import {
  enqueueOperationsEntry,
  enqueuePhoto,
} from "@/lib/offline/queue-store";
import { saveOrQueue, type SaveOutcome } from "@/lib/offline/save-or-queue";
import {
  ENTRY_LIMITS,
  emptyOperationsEntryForm,
} from "@/lib/operations-log/entry-form";
import { handleEntryPhotos } from "@/lib/operations-log/entry-photos";
import {
  assetEntryForm,
  buildGroupEntries,
  commonTemplates,
  emptyGroupForm,
  perAssetFields,
  sharedFields,
  type GroupAsset,
  type GroupEntryForm,
  type GroupFormField,
} from "@/lib/operations-log/group-form";
import {
  loadOperationsColleagues,
  loadOperationsTemplates,
} from "@/lib/operations-log/operations-load";
import { selectableColleagues } from "@/lib/operations-log/participants";
import { operationsPhotoClientKey } from "@/lib/operations-log/photo-key";
import { useAppTheme } from "@/lib/theme/useAppTheme";

/**
 * AZ ÜZEMELTETÉSI NAPLÓ CSOPORTOS RÖGZÍTÉSE (kártya 1a35e8f3; Balázs, 2026-11-15): több azonos sablonú eszköz egy űrlapon. A közös rész
 * (kezdés, résztvevők, belső megjegyzés, a közös vízóra) egyszer áll, az eszközönként eltérő mezők és a rendellenesség eszközönként. Mentéskor
 * eszközönként KÜLÖN bejegyzés készül, közös csoport-azonosítóval (a logika és a validáció a `group-form.ts`-ben, spec-kel): a havi kimutatás
 * a közös vízórát egyszer számolja.
 *
 * OFFLINE: a sablonok eszközönként a mentett másolatból jönnek (`operations-load.ts`), a mentés bejegyzésenként megy (`saveOrQueue`), tehát
 * térerő nélkül MIND sorba áll, egyenként idempotens kulccsal, ugyanazzal a csoport-azonosítóval. Egy részben elküldött csoport újrapróbálása
 * biztonságos: az már felment bejegyzés ugyanazt adja vissza. A KÉPERNYŐT NEM FUTTATTAM TELEFONON (a komponensekre nincs teszt).
 */
export default function RecordOperationsGroupScreen() {
  const { assets: assetsParam } = useLocalSearchParams<{ assets?: string }>();
  const router = useRouter();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user) : null;
  const online = useIsOnline();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createRecordStyles(tokens), [tokens]);

  const assets = useMemo<GroupAsset[]>(() => {
    try {
      const parsed: unknown = JSON.parse(assetsParam ?? "[]");
      return Array.isArray(parsed)
        ? parsed
            .filter(
              (item): item is { id: string; name?: string } =>
                typeof item === "object" &&
                item !== null &&
                typeof (item as { id?: unknown }).id === "string",
            )
            .map((item) => ({
              id: item.id,
              label: item.name?.trim() || "eszköz",
            }))
        : [];
    } catch {
      return [];
    }
  }, [assetsParam]);

  const enabled = Boolean(
    assets.length >= 2 &&
    capabilities?.operationsLogRecord &&
    status === "authenticated",
  );
  const templateQueries = useQueries({
    queries: assets.map((asset) => ({
      queryKey: ["operations-templates", asset.id],
      queryFn: () => loadOperationsTemplates(asset.id),
      enabled,
    })),
  });
  const colleagues = useQuery({
    queryKey: ["operations-colleagues"],
    queryFn: loadOperationsColleagues,
    enabled,
  });

  const [chosenTemplateId, setChosenTemplateId] = useState<string | null>(null);
  const [form, setForm] = useState<GroupEntryForm>(() =>
    emptyGroupForm(assets),
  );
  const [error, setError] = useState<{
    field: GroupFormField | null;
    message: string;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loading = templateQueries.some((query) => query.isPending);
  const failed = templateQueries.some((query) => query.isError);
  const common = useMemo(
    () =>
      loading || failed
        ? []
        : commonTemplates(
            templateQueries.map((query) => query.data?.items ?? []),
          ),
    [loading, failed, templateQueries],
  );
  const template =
    common.length === 1
      ? common[0]
      : common.find((item) => item.id === chosenTemplateId);
  const fromCache =
    templateQueries.some((query) => query.data?.fromCache === true) ||
    colleagues.data?.fromCache === true;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!template) throw new Error("A sablon nem található.");
      const finishedAt = new Date();
      const built = buildGroupEntries({
        template,
        assets,
        form,
        now: finishedAt,
      });
      if (!built.ok) return { kind: "rejected", problem: built } as const;
      // MIND érvényes: eszközönként külön bejegyzés, egyenként a saját kulcsával (egy félig küldött csoport újrapróbálása ugyanazt adja vissza)
      const results: {
        label: string;
        outcome: SaveOutcome | { type: "queue-failed"; message: string };
        photoMessage: string | null;
      }[] = [];
      for (const entry of built.entries) {
        const { queueTitle: _queueTitle, ...input } = entry.payload;
        const outcome = await saveOrQueue({
          connectivity: deviceConnectivity,
          save: async () => {
            const created = await createOperationsEntry(input);
            return { id: created.entry.id };
          },
          enqueue: () =>
            enqueueOperationsEntry({
              id: entry.operationId,
              payload: entry.payload,
              createdAt: input.startedAt,
            }),
          statusOf: (cause) =>
            cause instanceof ApiError ? cause.status : null,
          describeWrite: (result) =>
            result.ok
              ? {
                  type: "queued",
                  operationId: result.operationId,
                  message:
                    "Nincs kapcsolat, ezért a rögzítések a feltöltésre várók közé kerültek.",
                }
              : {
                  type: "queue-failed",
                  message: `A rögzítést nem sikerült elmenteni a készülékre: ${result.error}`,
                },
        });
        const photoMessage = await handleEntryPhotos({
          outcome,
          photos: entry.photos,
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
        results.push({ label: entry.assetLabel, outcome, photoMessage });
      }
      return { kind: "done", results } as const;
    },
    onSuccess: (result) => {
      if (result.kind === "rejected") {
        setError({
          field: result.problem.field,
          message: result.problem.message,
        });
        return;
      }
      const bad = result.results.filter(
        (item) =>
          item.outcome.type !== "saved" && item.outcome.type !== "queued",
      );
      if (bad.length > 0) {
        // az űrlap megmarad: az újrapróbálás biztonságos, a már felment bejegyzés ugyanazt adja vissza
        setError({
          field: null,
          message: bad
            .map(
              (item) =>
                `${item.label}: ${"message" in item.outcome ? item.outcome.message : "nem sikerült."}`,
            )
            .join(" "),
        });
        return;
      }
      const queued = result.results.filter(
        (item) => item.outcome.type === "queued",
      ).length;
      const photoMessages = result.results
        .map((item) => item.photoMessage)
        .filter(Boolean);
      if (queued === 0 && photoMessages.length === 0) {
        router.back();
        setForm(emptyGroupForm(assets));
        return;
      }
      setNotice(
        [
          queued > 0
            ? `${queued} bejegyzés a feltöltésre várók közé került, amint van térerő, magától felmegy.`
            : "A rögzítések felmentek.",
          ...photoMessages,
        ].join(" "),
      );
      setForm(emptyGroupForm(assets));
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

  const selectableList = selectableColleagues(
    colleagues.data?.items ?? [],
    user.id,
  );
  const startedLabel = form.startedAt
    ? form.startedAt.toLocaleTimeString("hu-HU", { timeStyle: "short" })
    : null;

  function setShared(key: string, value: string | boolean) {
    setForm((prev) => ({ ...prev, shared: { ...prev.shared, [key]: value } }));
  }
  function updatePart(
    assetId: string,
    change: (
      part: GroupEntryForm["perAsset"][string],
    ) => GroupEntryForm["perAsset"][string],
  ) {
    setForm((prev) => ({
      ...prev,
      perAsset: {
        ...prev.perAsset,
        [assetId]: change(prev.perAsset[assetId]!),
      },
    }));
  }
  function toggleParticipant(id: string) {
    setForm((prev) => ({
      ...prev,
      participantIds: prev.participantIds.includes(id)
        ? prev.participantIds.filter((item) => item !== id)
        : [...prev.participantIds, id],
    }));
  }

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
            {template
              ? `${template.name} (${assets.length})`
              : "Csoportos rögzítés"}
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

          {assets.length < 2 ? (
            <Text style={styles.error}>
              A csoportos rögzítéshez legalább két eszközt jelölj ki az
              eszközlistán.
            </Text>
          ) : loading ? (
            <ActivityIndicator color={tokens.accent} />
          ) : failed ? (
            <Text style={styles.error}>
              Egy eszköz sablonjai nem töltődtek be, és a készüléken nincs
              mentett másolat. Nyisd meg az eszközt térerővel, és próbáld újra.
            </Text>
          ) : common.length === 0 ? (
            <Text style={styles.error}>
              A kijelölt eszközöknek nincs közös üzemeltetési sablonja: csak
              azonos sablonú eszközök rögzíthetők együtt.
            </Text>
          ) : !template ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Melyik sablon?</Text>
              {common.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => setChosenTemplateId(item.id)}
                  style={styles.chip}
                >
                  <Text style={styles.chipText}>{item.name}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <>
              <Text style={styles.assetName}>
                {assets.map((asset) => asset.label).join(", ")}
              </Text>
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

              {sharedFields(template).length > 0 ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Közös vízóra</Text>
                  <Text style={styles.hint}>
                    A mérés az egész sorra egyszer vonatkozik: minden eszköz
                    bejegyzésére rákerül.
                  </Text>
                  <View style={styles.paramCard}>
                    {sharedFields(template).map((field, index) => (
                      <FieldRow
                        key={field.key}
                        field={field}
                        divider={index > 0}
                        form={{
                          ...emptyOperationsEntryForm(),
                          values: form.shared,
                        }}
                        invalid={error?.field === `shared:${field.key}`}
                        onValue={(value) => setShared(field.key, value)}
                        onPhotos={() => undefined}
                        styles={styles}
                        tokens={tokens}
                      />
                    ))}
                  </View>
                  {error && error.field?.startsWith("shared:") ? (
                    <Text style={styles.error}>{error.message}</Text>
                  ) : null}
                </View>
              ) : null}

              {assets.map((asset) => {
                const part = form.perAsset[asset.id]!;
                const own = perAssetFields(template);
                const assetForm = assetEntryForm(form, asset.id);
                const invalidKey = (key: string) =>
                  error?.field === `asset:${asset.id}:${key}`;
                return (
                  <View key={asset.id} style={styles.section}>
                    <Text style={styles.sectionTitle}>{asset.label}</Text>
                    {own.length > 0 ? (
                      <View style={styles.paramCard}>
                        {own.map((field, index) => (
                          <FieldRow
                            key={field.key}
                            field={field}
                            divider={index > 0}
                            form={assetForm}
                            invalid={invalidKey(field.key)}
                            onValue={(value) =>
                              updatePart(asset.id, (prev) => ({
                                ...prev,
                                values: { ...prev.values, [field.key]: value },
                              }))
                            }
                            onPhotos={(files) =>
                              updatePart(asset.id, (prev) => ({
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
                    <View style={styles.switchRow}>
                      <Text style={styles.paramRowLabel}>Rendellenesség</Text>
                      <Switch
                        value={part.anomaly}
                        onValueChange={(anomaly) =>
                          updatePart(asset.id, (prev) => ({ ...prev, anomaly }))
                        }
                      />
                    </View>
                    {part.anomaly ? (
                      <TextInput
                        value={part.anomalyNote}
                        onChangeText={(anomalyNote) =>
                          updatePart(asset.id, (prev) => ({
                            ...prev,
                            anomalyNote,
                          }))
                        }
                        placeholder="Mi a rendellenesség? (a hibajegybe kerül)"
                        placeholderTextColor={tokens.textMuted}
                        style={[styles.input, styles.notesInput]}
                        maxLength={ENTRY_LIMITS.noteMax}
                        multiline
                      />
                    ) : null}
                    {error && error.field?.startsWith(`asset:${asset.id}:`) ? (
                      <Text style={styles.error}>{error.message}</Text>
                    ) : null}
                  </View>
                );
              })}

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Résztvevők</Text>
                <Text style={styles.hint}>
                  Te automatikusan szerepelsz. Ki dolgozott még veled?
                </Text>
                {selectableList.length > 0 ? (
                  <View style={styles.chips}>
                    {selectableList.map((colleague) => {
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
                <Text style={styles.sectionTitle}>Belső megjegyzés</Text>
                <TextInput
                  value={form.internalNote}
                  onChangeText={(internalNote) =>
                    setForm((prev) => ({ ...prev, internalNote }))
                  }
                  placeholder="Ezt a partner nem látja (minden bejegyzésre rákerül)"
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
          {error && (error.field === null || error.field === "group") ? (
            <Text style={styles.error}>{error.message}</Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
