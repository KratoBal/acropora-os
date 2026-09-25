import { useMutation, useQuery } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { useMemo, useState } from "react";
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
import {
  createAquarium,
  searchSelectableAquariumCustomers,
} from "@/lib/api/aquariums";
import {
  buildAquariumCreatePayload,
  emptyAquariumCreateForm,
  emptyAquariumEquipmentForm,
  normalizeDecimalText,
  resolveAquariumVolume,
  type AquariumCreateField,
  type AquariumCreateForm,
  type AquariumEquipmentKind,
  type AquariumOwnershipType,
  type WaterBodyType,
} from "@/lib/aquariums/aquarium-create";
import {
  EQUIPMENT_KIND_OPTIONS,
  OWNERSHIP_LABEL,
  WATER_BODY_LABEL,
} from "@/lib/aquariums/aquarium-labels";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import { enqueueAquariumCreate } from "@/lib/offline/queue-store";
import { saveOrQueue } from "@/lib/offline/save-or-queue";
import { aquariumOperationId } from "@/lib/offline/sync-queue";
import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";

/**
 * ÚJ AKVÁRIUM (VAGY TÓ) A HELYSZÍNRŐL.
 *
 * Balázs 2026-09-24 13:01-i döntése bővítette a telefonra: "az akvarium
 * felvitele, benne az ugyfel helyben felvetele (nev, cim, telefon, e-mail),
 * a meretek es a liter, az eszkozok". A web-oldali kör ugyanezt a
 * `POST /aquariums` végpontot hívja -- ez a képernyő a mobil felvitel,
 * NEM lista/részlet/szerkesztés: a brief szó szerint "felvitelt" kért.
 *
 * === MI SZŰKEBB, MINT A WEBEN, ÉS MIÉRT ===
 *
 * 1. MEGLÉVŐ ÜGYFÉL KERESÉSE 2026-09-24-TŐL MEGY (acrobot 2. tétele): a
 *    `GET /aquariums/customers` -- `aquariums.view` alatt, nem a `/customers`
 *    (amit a `SERVICE` szerepkör nem érne el). A döntés a
 *    `lib/aquariums/aquarium-create.ts`-ben áll (`customerMode`), itt csak a
 *    választó jelenik meg.
 * 2. VÍZTÍPUS, KEZDÉS DÁTUMA, MEGJEGYZÉS NINCS AZ ŰRLAPON: a brief mobil
 *    kiegészítése ("meretek es a liter, az eszkozok") ezeket nem nevezte meg.
 *
 * === OFFLINE SORBAÁLLÍTÁS (2026-09-24, acrobot kérése) ===
 *
 * Ugyanaz a `saveOrQueue`+`queue-store` minta, mint az eszköz, a munkalap és
 * a hibajegy felvitelénél: térerő nélkül a felvitel a helyi sorba kerül, és
 * amint van hálózat, a `useQueueDrain` magától felküldi. Az ÚJ ügyfél
 * (`newCustomer`) EGY hívásban utazik az akváriummal -- nem külön sorba
 * tett lépésként --, mert a szerver `POST /aquariums` egyetlen kérésben
 * kezeli mindkettőt: két sorba tett lépés azt kockáztatná, hogy az akvárium
 * sora a még fel nem ment ügyfélre hivatkozna. A kétszeri küldés ellen a
 * `clientOperationId` véd (lásd `aquariumOperationId` a `sync-queue.ts`-ben
 * és a szerver oldali kettős védelmet az `aquariums.repository.ts`-ben).
 *
 * === A DÖNTÉS A `lib/aquariums/aquarium-create.ts`-BEN VAN ===
 *
 * Mert ott MÉRHETŐ: ebben a fájlban nincs, ami tesztelné.
 *
 * === SZÍNEK: FIGMA TELEFON 12. KÖR, 6. CSOPORT (2026-09-25) ===
 *
 * A korábbi, kézzel írt sötét-kék hexek (`#071827`, `#0d2b40`, `#52d6c7`
 * stb.) helyett `useAppTheme()` -- ugyanaz a minta, mint az `[id].tsx`
 * adatlapon (Balázs döntése, emlék 1816). A tartalom, a mezők, a
 * feltételek és a működés VÁLTOZATLAN -- lásd a fájl fenti fejléceit --,
 * csak a megjelenítő réteg vált tokenre. A terv (`exchange/figma-telefon-
 * make-12/src/MobileAppScreen.tsx`, `UjAkvariumScreen`) ehhez a
 * képernyőhöz nem ad új tartalmat, csak vizuális nyelvet.
 */
export default function NewAquariumScreen() {
  const router = useRouter();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);

  const [form, setForm] = useState<AquariumCreateForm>(emptyAquariumCreateForm);
  const [error, setError] = useState<{
    field: AquariumCreateField | null;
    message: string;
  } | null>(null);
  /**
   * A SORBA TETT FELVITEL ÜZENETE, KÜLÖN AZ ERRORTÓL. Nem hiba: a felvitel
   * megtörtént, csak még a telefonon vár -- ugyanaz a megkülönböztetés, mint
   * a munkalap és a hibajegy felvitelén.
   */
  const [notice, setNotice] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (
      payload: Extract<
        ReturnType<typeof buildAquariumCreatePayload>,
        { ok: true }
      >["payload"],
    ) => {
      const startedAt = new Date().toISOString();
      const operationId = aquariumOperationId({
        ownershipType: payload.ownershipType,
        startedAt,
      });
      return saveOrQueue({
        save: () =>
          createAquarium({ ...payload, clientOperationId: operationId }),
        enqueue: () =>
          enqueueAquariumCreate({
            id: operationId,
            payload,
            createdAt: startedAt,
          }),
        statusOf: (cause) => (cause instanceof ApiError ? cause.status : null),
        describeWrite: (result) =>
          result.ok
            ? {
                type: "queued",
                operationId: result.operationId,
                message:
                  "Nincs kapcsolat, ezért az akvárium a feltöltésre várók közé került. Amint van térerő, magától felmegy.",
              }
            : {
                type: "queue-failed",
                message: `Az akváriumot nem sikerült elmenteni a készülékre: ${result.error}`,
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
        setForm(emptyAquariumCreateForm());
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
            : "Az akvárium mentése nem sikerült.",
      });
    },
  });

  if (status !== "authenticated" || !user) return <Redirect href="/login" />;
  if (!capabilities?.aquariumsManage) return <Redirect href="/" />;

  function updateDimension(
    field: "lengthCm" | "widthCm" | "heightCm",
    value: string,
  ) {
    setForm((prev) => {
      const next: AquariumCreateForm = { ...prev, [field]: value };
      // ÉLŐ ELŐNÉZET: amíg a felhasználó nem írta át kézzel a litert, a mező
      // a méretekből frissül -- ugyanaz a döntési alak, mint a szerveren
      // (`resolveAquariumVolume`), csak itt a megjelenítést szolgálja.
      if (!prev.volumeManuallyEdited) {
        const volume = resolveAquariumVolume({
          lengthCm: normalizeDecimalText(next.lengthCm),
          widthCm: normalizeDecimalText(next.widthCm),
          heightCm: normalizeDecimalText(next.heightCm),
          volumeLiters: null,
          isManual: false,
        });
        next.volumeLiters =
          volume.systemVolumeLiters != null
            ? String(volume.systemVolumeLiters)
            : "";
      }
      return next;
    });
  }

  function submit() {
    const result = buildAquariumCreatePayload(form);
    if (!result.ok) {
      setError({ field: result.field, message: result.message });
      return;
    }
    setError(null);
    setNotice(null);
    mutation.mutate(result.payload);
  }

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
          <Text style={styles.eyebrow}>AKVÁRIUMOK</Text>
          <Text style={styles.title}>Új akvárium</Text>

          <Segmented<AquariumOwnershipType>
            styles={styles}
            value={form.ownershipType}
            options={["OWN", "CUSTOMER"]}
            label={(value) => OWNERSHIP_LABEL[value]}
            onChange={(ownershipType) =>
              setForm((prev) => ({ ...prev, ownershipType }))
            }
          />

          {form.ownershipType === "CUSTOMER" ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Ügyfél</Text>
              <Segmented<"EXISTING" | "NEW">
                styles={styles}
                value={form.customerMode}
                options={["EXISTING", "NEW"]}
                label={(value) =>
                  value === "EXISTING" ? "Meglévő ügyfél" : "Új ügyfél"
                }
                onChange={(customerMode) =>
                  setForm((prev) => ({ ...prev, customerMode }))
                }
              />

              {form.customerMode === "EXISTING" ? (
                <CustomerPicker
                  styles={styles}
                  tokens={tokens}
                  selectedId={form.selectedCustomerId}
                  selectedLabel={form.selectedCustomerLabel}
                  error={
                    error?.field === "selectedCustomer" ? error.message : null
                  }
                  onSelect={(selectedCustomerId, selectedCustomerLabel) =>
                    setForm((prev) => ({
                      ...prev,
                      selectedCustomerId,
                      selectedCustomerLabel,
                    }))
                  }
                />
              ) : (
                <>
                  <Field
                    styles={styles}
                    tokens={tokens}
                    label="Név"
                    value={form.customerName}
                    onChangeText={(customerName) =>
                      setForm((prev) => ({ ...prev, customerName }))
                    }
                    error={
                      error?.field === "customerName" ? error.message : null
                    }
                  />
                  <Field
                    styles={styles}
                    tokens={tokens}
                    label="Telefonszám"
                    value={form.customerPhone}
                    onChangeText={(customerPhone) =>
                      setForm((prev) => ({ ...prev, customerPhone }))
                    }
                    keyboardType="phone-pad"
                  />
                  <Field
                    styles={styles}
                    tokens={tokens}
                    label="E-mail cím"
                    value={form.customerEmail}
                    onChangeText={(customerEmail) =>
                      setForm((prev) => ({ ...prev, customerEmail }))
                    }
                    keyboardType="email-address"
                  />
                  <Field
                    styles={styles}
                    tokens={tokens}
                    label="Irányítószám"
                    value={form.customerPostalCode}
                    onChangeText={(customerPostalCode) =>
                      setForm((prev) => ({ ...prev, customerPostalCode }))
                    }
                    keyboardType="number-pad"
                  />
                  <Field
                    styles={styles}
                    tokens={tokens}
                    label="Város"
                    value={form.customerCity}
                    onChangeText={(customerCity) =>
                      setForm((prev) => ({ ...prev, customerCity }))
                    }
                  />
                  <Field
                    styles={styles}
                    tokens={tokens}
                    label="Utca, házszám"
                    value={form.customerAddressLine1}
                    onChangeText={(customerAddressLine1) =>
                      setForm((prev) => ({ ...prev, customerAddressLine1 }))
                    }
                    error={
                      error?.field === "customerAddress" ? error.message : null
                    }
                  />
                </>
              )}
            </View>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Az akvárium</Text>
            <Field
              styles={styles}
              tokens={tokens}
              label="Neve"
              value={form.name}
              onChangeText={(name) => setForm((prev) => ({ ...prev, name }))}
              error={error?.field === "name" ? error.message : null}
            />
            <Segmented<WaterBodyType>
              styles={styles}
              value={form.waterBodyType}
              options={["AKVARIUM", "TO"]}
              label={(value) => WATER_BODY_LABEL[value]}
              onChange={(waterBodyType) =>
                setForm((prev) => ({ ...prev, waterBodyType }))
              }
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Méretek és liter</Text>
            <View style={styles.row}>
              <Field
                styles={styles}
                tokens={tokens}
                label="Hossz (cm)"
                value={form.lengthCm}
                onChangeText={(value) => updateDimension("lengthCm", value)}
                keyboardType="decimal-pad"
                style={styles.rowField}
                error={error?.field === "lengthCm" ? error.message : null}
              />
              <Field
                styles={styles}
                tokens={tokens}
                label="Szélesség (cm)"
                value={form.widthCm}
                onChangeText={(value) => updateDimension("widthCm", value)}
                keyboardType="decimal-pad"
                style={styles.rowField}
                error={error?.field === "widthCm" ? error.message : null}
              />
              <Field
                styles={styles}
                tokens={tokens}
                label="Magasság (cm)"
                value={form.heightCm}
                onChangeText={(value) => updateDimension("heightCm", value)}
                keyboardType="decimal-pad"
                style={styles.rowField}
                error={error?.field === "heightCm" ? error.message : null}
              />
            </View>
            <Field
              styles={styles}
              tokens={tokens}
              label="Liter (számolva, vagy írd át kézzel)"
              value={form.volumeLiters}
              onChangeText={(volumeLiters) =>
                setForm((prev) => ({
                  ...prev,
                  volumeLiters,
                  volumeManuallyEdited: true,
                }))
              }
              keyboardType="decimal-pad"
              error={error?.field === "volumeLiters" ? error.message : null}
            />
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Eszközök</Text>
              <Pressable
                onPress={() =>
                  setForm((prev) => ({
                    ...prev,
                    equipment: [
                      ...prev.equipment,
                      emptyAquariumEquipmentForm(),
                    ],
                  }))
                }
                style={styles.addButton}
              >
                <Text style={styles.addButtonText}>+ Eszköz</Text>
              </Pressable>
            </View>

            {form.equipment.length === 0 ? (
              <Text style={styles.empty}>Még nincs felvéve eszköz.</Text>
            ) : null}

            {form.equipment.map((row, index) => (
              <View key={index} style={styles.equipmentRow}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.equipmentIndex}>{index + 1}.</Text>
                  <Pressable
                    onPress={() =>
                      setForm((prev) => ({
                        ...prev,
                        equipment: prev.equipment.filter((_, i) => i !== index),
                      }))
                    }
                  >
                    <Text style={styles.removeText}>Törlés</Text>
                  </Pressable>
                </View>
                <EquipmentKindPicker
                  styles={styles}
                  value={row.kind}
                  onChange={(kind) =>
                    setForm((prev) => ({
                      ...prev,
                      equipment: prev.equipment.map((r, i) =>
                        i === index ? { ...r, kind } : r,
                      ),
                    }))
                  }
                />
                <View style={styles.row}>
                  <Field
                    styles={styles}
                    tokens={tokens}
                    label="Gyártó"
                    value={row.manufacturer}
                    onChangeText={(manufacturer) =>
                      setForm((prev) => ({
                        ...prev,
                        equipment: prev.equipment.map((r, i) =>
                          i === index ? { ...r, manufacturer } : r,
                        ),
                      }))
                    }
                    style={styles.rowField}
                  />
                  <Field
                    styles={styles}
                    tokens={tokens}
                    label="Típus"
                    value={row.model}
                    onChangeText={(model) =>
                      setForm((prev) => ({
                        ...prev,
                        equipment: prev.equipment.map((r, i) =>
                          i === index ? { ...r, model } : r,
                        ),
                      }))
                    }
                    style={styles.rowField}
                  />
                </View>
                {row.kind === "NYOMELEM_ADAGOLO" ? (
                  <Field
                    styles={styles}
                    tokens={tokens}
                    label="Csatornaszám"
                    value={row.channelCount}
                    onChangeText={(channelCount) =>
                      setForm((prev) => ({
                        ...prev,
                        equipment: prev.equipment.map((r, i) =>
                          i === index ? { ...r, channelCount } : r,
                        ),
                      }))
                    }
                    keyboardType="number-pad"
                    error={
                      error?.field === `equipment.${index}.channelCount`
                        ? error.message
                        : null
                    }
                  />
                ) : null}
              </View>
            ))}
          </View>

          {notice ? <Text style={styles.notice}>{notice}</Text> : null}

          {error && error.field === null ? (
            <Text style={styles.error}>{error.message}</Text>
          ) : null}

          <Pressable
            onPress={submit}
            disabled={mutation.isPending}
            style={({ pressed }) => [
              styles.submit,
              (pressed || mutation.isPending) && styles.pressed,
            ]}
          >
            {mutation.isPending ? (
              <ActivityIndicator color={tokens.textOnAccent} />
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
  styles,
  tokens,
  label,
  value,
  onChangeText,
  keyboardType,
  style,
  error,
}: {
  styles: ReturnType<typeof createStyles>;
  tokens: ThemeTokens;
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?:
    "default" | "decimal-pad" | "number-pad" | "phone-pad" | "email-address";
  style?: object;
  error?: string | null;
}) {
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType ?? "default"}
        placeholderTextColor={tokens.textMuted}
        style={styles.input}
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

function Segmented<T extends string>({
  styles,
  value,
  options,
  label,
  onChange,
}: {
  styles: ReturnType<typeof createStyles>;
  value: T;
  options: readonly T[];
  label: (value: T) => string;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => (
        <Pressable
          key={option}
          onPress={() => onChange(option)}
          style={[
            styles.segmentedOption,
            value === option && styles.segmentedOptionActive,
          ]}
        >
          <Text
            style={[
              styles.segmentedText,
              value === option && styles.segmentedTextActive,
            ]}
          >
            {label(option)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * A MEGLÉVŐ ÜGYFÉL VÁLASZTÓJA -- `GET /aquariums/customers`-re épít, NEM a
 * `/customers`-re (lásd `lib/api/aquariums.ts` fejlécét: a `SERVICE`
 * szerepkör azt nem éri el). Csak akkor tölt listát, amikor a panel
 * kinyílik -- a szerelő nem mindig nyúl hozzá.
 */
function CustomerPicker({
  styles,
  tokens,
  selectedId,
  selectedLabel,
  error,
  onSelect,
}: {
  styles: ReturnType<typeof createStyles>;
  tokens: ThemeTokens;
  selectedId: string | null;
  selectedLabel: string;
  error?: string | null;
  onSelect: (id: string, label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const results = useQuery({
    queryKey: ["aquarium-selectable-customers", search],
    queryFn: () => searchSelectableAquariumCustomers(search),
    enabled: open,
  });

  return (
    <View style={styles.field}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        style={styles.pickerToggle}
      >
        <Text style={styles.pickerToggleText}>
          {selectedId ? selectedLabel : "Válassz ügyfelet"}
        </Text>
      </Pressable>
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
      {open ? (
        <View style={styles.pickerPanel}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Keresés név szerint"
            placeholderTextColor={tokens.textMuted}
            style={styles.input}
          />
          {results.isPending ? (
            <ActivityIndicator color={tokens.accent} />
          ) : null}
          {results.isError ? (
            <Text style={styles.fieldError}>
              Az ügyféllista nem tölthető be.
            </Text>
          ) : null}
          {(results.data?.items ?? []).map((item) => (
            <Pressable
              key={item.id}
              onPress={() => {
                onSelect(
                  item.id,
                  item.city
                    ? `${item.displayName} (${item.city})`
                    : item.displayName,
                );
                setOpen(false);
              }}
              style={styles.pickerRow}
            >
              <Text style={styles.pickerRowText}>{item.displayName}</Text>
              {item.city ? (
                <Text style={styles.pickerRowMeta}>{item.city}</Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function EquipmentKindPicker({
  styles,
  value,
  onChange,
}: {
  styles: ReturnType<typeof createStyles>;
  value: AquariumEquipmentKind;
  onChange: (value: AquariumEquipmentKind) => void;
}) {
  return (
    <View style={styles.kindWrap}>
      {EQUIPMENT_KIND_OPTIONS.map(([kind, kindLabel]) => (
        <Pressable
          key={kind}
          onPress={() => onChange(kind)}
          style={[styles.kindChip, value === kind && styles.kindChipActive]}
        >
          <Text
            style={[
              styles.kindChipText,
              value === kind && styles.kindChipTextActive,
            ]}
          >
            {kindLabel}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: t.background },
    flex: { flex: 1 },
    container: { padding: 18, paddingBottom: 48, gap: 14 },
    /*
      A SZÍN A TERV SZÜRKÉJE (grey-400 -> t.textMuted), NEM AZ AKCENT --
      ugyanaz a rendszerszintű minta, mint amit acrobot kérésére (2026-09-25,
      msg 23917/23921) a többi telefon-listán már javítottunk.
    */
    eyebrow: {
      color: t.textMuted,
      fontSize: 11,
      fontWeight: "900",
      letterSpacing: 1.4,
    },
    title: { color: t.textPrimary, fontSize: 28, fontWeight: "900" },
    section: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 14,
      padding: 14,
      gap: 10,
    },
    sectionTitle: { color: t.textPrimary, fontSize: 15, fontWeight: "800" },
    sectionHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    row: { flexDirection: "row", gap: 10 },
    rowField: { flex: 1 },
    field: { gap: 6 },
    fieldLabel: { color: t.textSecondary, fontSize: 12 },
    fieldError: { color: t.danger, fontSize: 12 },
    input: {
      color: t.textPrimary,
      backgroundColor: t.background,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 11,
    },
    segmented: { flexDirection: "row", gap: 8 },
    segmentedOption: {
      flex: 1,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.border,
      paddingVertical: 10,
      alignItems: "center",
    },
    segmentedOptionActive: {
      backgroundColor: t.accent,
      borderColor: t.accent,
    },
    segmentedText: { color: t.textSecondary, fontWeight: "700" },
    segmentedTextActive: { color: t.textOnAccent },
    pickerToggle: {
      backgroundColor: t.background,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 11,
    },
    pickerToggleText: { color: t.textPrimary, fontWeight: "700" },
    pickerPanel: { marginTop: 8, gap: 8 },
    pickerRow: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 10,
      padding: 10,
    },
    pickerRowText: { color: t.textPrimary, fontWeight: "700" },
    pickerRowMeta: { color: t.textSecondary, fontSize: 12, marginTop: 2 },
    kindWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    kindChip: {
      borderRadius: 20,
      borderWidth: 1,
      borderColor: t.border,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    kindChipActive: { backgroundColor: t.accent, borderColor: t.accent },
    kindChipText: { color: t.textSecondary, fontSize: 12, fontWeight: "700" },
    kindChipTextActive: { color: t.textOnAccent },
    equipmentRow: {
      borderTopWidth: 1,
      borderTopColor: t.border,
      paddingTop: 10,
      gap: 10,
    },
    equipmentIndex: { color: t.textSecondary, fontWeight: "800" },
    addButton: {
      backgroundColor: t.accent,
      borderRadius: 9,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    addButtonText: {
      color: t.textOnAccent,
      fontWeight: "800",
      fontSize: 12,
    },
    removeText: { color: t.danger, fontWeight: "700", fontSize: 12 },
    empty: { color: t.textSecondary },
    notice: {
      color: t.warning,
      backgroundColor: t.warningSoft,
      borderColor: t.warning,
      borderWidth: 1,
      padding: 12,
      borderRadius: 10,
    },
    error: {
      color: t.danger,
      backgroundColor: t.dangerSoft,
      padding: 12,
      borderRadius: 10,
    },
    submit: {
      backgroundColor: t.accent,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: "center",
    },
    pressed: { opacity: 0.75 },
    submitText: { color: t.textOnAccent, fontWeight: "900", fontSize: 15 },
  });
}
