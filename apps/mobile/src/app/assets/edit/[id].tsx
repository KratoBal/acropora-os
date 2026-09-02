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
  getAsset,
  updateAsset,
  type AssetCriticality,
  type AssetDetail,
} from "@/lib/api/assets";
import { listPartnerUnits } from "@/lib/api/partners";
import {
  assetEditFormFrom,
  buildAssetPatch,
  hasAssetChanges,
  type AssetEditForm,
  type EditableAsset,
} from "@/lib/assets/asset-edit";
import { ASSET_STATUS_OPTIONS } from "@/lib/assets/asset-status";
import { unitLevels } from "@/lib/partners/site-tree";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";

const CRITICALITY_OPTIONS: { value: AssetCriticality; label: string }[] = [
  { value: "LOW", label: "Alacsony" },
  { value: "NORMAL", label: "Normál" },
  { value: "HIGH", label: "Magas" },
  { value: "CRITICAL", label: "Kritikus" },
];

const TEXT_FIELDS: {
  key: keyof AssetEditForm & string;
  label: string;
  multiline?: boolean;
}[] = [
  { key: "manufacturer", label: "Gyártó" },
  { key: "model", label: "Modell" },
  { key: "serialNumber", label: "Sorozatszám" },
  { key: "inventoryNumber", label: "Partner azonosítója" },
  { key: "description", label: "Leírás", multiline: true },
  { key: "notes", label: "Megjegyzés", multiline: true },
];

/**
 * A SZERVER VALASZA A SZERKESZTO MODUL ALAKJARA.
 *
 * Az `AssetDetail` a tulajdonos tipusat `owner.type` neven hordozza, a
 * szerkeszto logika viszont `ownerType` neven kéri -- kotelezoen, hogy ez a
 * leképezés ne maradhasson el csendben.
 */
function editable(asset: AssetDetail): EditableAsset {
  return { ...asset, ownerType: asset.owner.type, unit: asset.unit };
}

export default function AssetEditScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;

  const query = useQuery({
    queryKey: ["service-asset", id],
    queryFn: () => getAsset(id!),
    enabled: status === "authenticated" && Boolean(id),
  });

  const [form, setForm] = useState<AssetEditForm | null>(null);
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null);

  /*
   * A HELYSZÍNEK CSAK SZERVIZ PARTNER ESZKÖZÉNÉL. Vevő tulajdonosnál nincs mit
   * betölteni: ott a cím a pontosítás, és a szerver az alegységet el is
   * utasítja.
   */
  const unitsQuery = useQuery({
    queryKey: ["partner-units", query.data?.owner.id],
    queryFn: () => listPartnerUnits(query.data!.owner.id),
    enabled:
      status === "authenticated" && query.data?.owner.type === "SUPPLIER",
  });

  // Fills the form when the asset arrives, and again when a reload brings
  // back a different version - after a conflict, say. Adjusting during
  // render rather than in an effect is deliberate: an effect would let one
  // frame paint with the previous asset's values in the fields.
  //
  // Keyed on `updatedAt`, so once the form is filled, editing owns it. A
  // background refetch that returns the same version will not wipe out
  // what somebody is halfway through typing.
  if (query.data && loadedFrom !== query.data.updatedAt) {
    setLoadedFrom(query.data.updatedAt);
    setForm(assetEditFormFrom(editable(query.data)));
  }

  const save = useMutation({
    mutationFn: () => {
      if (!query.data || !form)
        throw new Error("A szerkesztés nem áll készen.");
      return updateAsset(
        query.data.id,
        buildAssetPatch(editable(query.data), form),
      );
    },
    onSuccess: async (updated) => {
      queryClient.setQueryData(["service-asset", updated.id], updated);
      await queryClient.invalidateQueries({ queryKey: ["service-assets"] });
      router.back();
    },
  });

  if (status !== "authenticated") return <Redirect href="/login" />;
  if (capabilities && !capabilities.assetsManage) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Ehhez nincs jogosultságod</Text>
          <Text style={styles.cardText}>
            Az eszközadatok módosítását a szerver külön ellenőrzi, és a te
            szerepköröd erre nem jogosult.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (query.isPending || !form) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.card}>
          <ActivityIndicator color="#52d6c7" />
          <Text style={styles.cardText}>Eszköz betöltése…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (query.isError || !query.data) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Nem sikerült betölteni</Text>
          <Text style={styles.cardText}>
            {query.error instanceof Error
              ? query.error.message
              : "Ismeretlen hiba."}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void query.refetch()}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>Újrapróbálás</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const asset = query.data;
  /*
   * A MENTES GOMB IS A LEKÉPEZETT ALAKOT KAPJA. E nélkül a gomb tétlen maradna
   * akkor, amikor CSAK a helyszín változott: a fordító pontosan ezt a hívást
   * fogta meg, amikor az `ownerType` kötelező lett.
   */
  const changed = hasAssetChanges(editable(asset), form);
  const conflict = isConflict(save.error);

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.assetNumber}>{asset.assetNumber}</Text>
          <Text style={styles.assetName}>{asset.name}</Text>
        </View>

        {save.isError ? (
          <View style={conflict ? styles.conflictCard : styles.errorCard}>
            <Text style={styles.errorTitle}>
              {conflict
                ? "Valaki más közben módosította"
                : "A mentés nem sikerült"}
            </Text>
            <Text style={styles.errorText}>
              {conflict
                ? "A módosításodat nem mentettük el, hogy ne írja felül a másik változtatást. Töltsd be újra az eszközt, nézd meg mi változott, és írd be újra, amit kell."
                : save.error instanceof Error
                  ? save.error.message
                  : "Ismeretlen hiba."}
            </Text>
            {conflict ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  save.reset();
                  void query.refetch();
                }}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>Újratöltés</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <Choice
          label="Státusz"
          options={ASSET_STATUS_OPTIONS}
          value={form.status}
          onChange={(value) => setForm({ ...form, status: value })}
          collapsible
        />
        <Choice
          label="Kritikusság"
          options={CRITICALITY_OPTIONS}
          value={form.criticality}
          onChange={(value) => setForm({ ...form, criticality: value })}
        />

        {/*
          HELYSZÍN. A felviteli űrlap ugyanezt kínálja; itt a javítás lehetősége
          a tét: egy mező, amit felvinni lehet, de javítani nem, egy elgépelés
          után zsákutca. A kivezetett helyszín itt sem választható, mert a
          szerver elutasítja -- de a kihagyottak száma ki van írva.
        */}
        {asset.owner.type === "SUPPLIER" ? (
          <View style={styles.field}>
            <Text style={styles.label}>Helyszín</Text>
            {unitsQuery.isPending ? (
              <ActivityIndicator color="#52d6c7" />
            ) : null}
            {unitsQuery.isError ? (
              <Text style={styles.cardText}>
                A partner helyszínei nem tölthetők be. A többi mező menthető.
              </Text>
            ) : null}
            <Pressable
              onPress={() => setForm({ ...form, unitId: "" })}
              style={[styles.unitRow, form.unitId === "" && styles.unitRowOn]}
            >
              <Text style={styles.unitText}>Nincs megadva</Text>
            </Pressable>
            {/*
              LEPCSOS VALASZTO, ugyanaz a szabaly, mint a felviteli urlapon.
              ITT SZAMIT IGAZAN a kivezetett helyszin kezelese: ha a szerkesztett
              eszkoz epp ilyenen all, a lanc atmegy rajta, es a sor VALASZTVA
              latszik -- kulonben a beallitott helyszin nemán eltunne, es a
              mentes atirna valami masra.
            */}
            {unitLevels(unitsQuery.data?.items ?? [], form.unitId || null).map(
              (level, depth) =>
                level.options.length === 0 ? null : (
                  <View key={`szint-${depth}`} style={styles.unitLevel}>
                    {level.options.map((option) => {
                      const selected = level.selectedId === option.id;
                      return (
                        <Pressable
                          key={option.id}
                          disabled={!option.isActive && !selected}
                          onPress={() =>
                            setForm({
                              ...form,
                              unitId: selected ? "" : option.id,
                            })
                          }
                          style={[
                            styles.unitRow,
                            selected && styles.unitRowOn,
                            !option.isActive && !selected && styles.unitOff,
                          ]}
                        >
                          <Text style={styles.unitText}>
                            {option.label}
                            {option.isActive ? "" : " (kivezetett)"}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ),
            )}
          </View>
        ) : null}

        {TEXT_FIELDS.map((field) => (
          <View key={field.key} style={styles.field}>
            <Text style={styles.label}>{field.label}</Text>
            <TextInput
              accessibilityLabel={field.label}
              value={form[field.key]}
              onChangeText={(value) => setForm({ ...form, [field.key]: value })}
              multiline={field.multiline}
              style={[styles.input, field.multiline && styles.inputMultiline]}
              placeholderTextColor="#5c7e92"
              placeholder="Nincs megadva"
              editable={!save.isPending}
            />
          </View>
        ))}

        <Text style={styles.hint}>
          A partner, a helyszín és a szülőeszköz módosítása a webes felületen
          történik.
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Módosítások mentése"
          accessibilityState={{ disabled: !changed || save.isPending }}
          disabled={!changed || save.isPending}
          onPress={() => save.mutate()}
          style={({ pressed }) => [
            styles.primaryButton,
            styles.saveButton,
            (!changed || save.isPending) && styles.buttonDisabled,
            pressed && styles.pressed,
          ]}
        >
          {save.isPending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.primaryButtonText}>Mentés</Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * HTTP 409 from the server means the asset changed under us. It is worth
 * telling apart from every other failure: the edit is not lost by
 * accident, it was refused on purpose, and the way out is to reload
 * rather than to try the same save again.
 */
function isConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === 409
  );
}

/**
 * A `collapsible` NEM DISZITES: a statusz OT ertekű, es a csempek a telefonon
 * ket sorba tordelnek, tehat a mezo annyi helyet foglal, mint harom masik.
 * Legorduloként egy sor, es a MOSTANI ertek olvashato rajta.
 *
 * A KRITIKUSSAG CSEMPE MARAD, es ez SZANDEKOS kulonbseg: harom rovid ertek egy
 * sorba fer, es ott a legordulo egy folosleges koppintas. Ha megis egysegesnek
 * kell lennie, egyetlen szo atallitja -- ezert all propkent, nem masolt kodkent.
 */
function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  collapsible = false,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange(value: T): void;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {collapsible ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${current?.label ?? "nincs kiválasztva"}. Koppints a módosításhoz.`}
          onPress={() => setOpen((value) => !value)}
          style={({ pressed }) => [
            styles.choice,
            styles.choiceSelected,
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.choiceText, styles.choiceTextSelected]}>
            {current?.label ?? "Válassz"}
          </Text>
        </Pressable>
      ) : null}
      <View style={styles.choices}>
        {(collapsible && !open ? [] : options).map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={`${label}: ${option.label}`}
              accessibilityState={{ selected }}
              onPress={() => {
                onChange(option.value);
                setOpen(false);
              }}
              style={({ pressed }) => [
                styles.choice,
                selected && styles.choiceSelected,
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.choiceText,
                  selected && styles.choiceTextSelected,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#071827" },
  container: { gap: 16, padding: 20, paddingBottom: 40 },
  hero: { gap: 4 },
  assetNumber: {
    color: "#52d6c7",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  assetName: { color: "#f4fbff", fontSize: 22, fontWeight: "900" },
  field: { gap: 8 },
  unitRow: {
    backgroundColor: "#0d2b40",
    borderColor: "#1c4963",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  unitLevel: { gap: 6, marginBottom: 8 },
  unitOff: { opacity: 0.5 },
  unitRowOn: { backgroundColor: "#123f3b", borderColor: "#1f6b62" },
  unitText: { color: "#f4fbff", fontSize: 14 },
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
  inputMultiline: { minHeight: 84, textAlignVertical: "top" },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: {
    backgroundColor: "#0b263d",
    borderColor: "#164668",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  choiceSelected: { backgroundColor: "#166a7a", borderColor: "#52d6c7" },
  choiceText: { color: "#a9c4d1", fontSize: 13, fontWeight: "700" },
  choiceTextSelected: { color: "#ffffff" },
  hint: { color: "#6f93a8", fontSize: 12, lineHeight: 18 },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#177b74",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  saveButton: { marginTop: 4 },
  primaryButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "800" },
  buttonDisabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
  card: {
    alignItems: "center",
    backgroundColor: "#0d2b40",
    borderColor: "#1c4963",
    borderRadius: 18,
    borderWidth: 1,
    gap: 12,
    margin: 24,
    padding: 24,
  },
  cardTitle: { color: "#f4fbff", fontSize: 17, fontWeight: "800" },
  cardText: {
    color: "#a9c4d1",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  errorCard: {
    backgroundColor: "#3b2b2d",
    borderRadius: 14,
    gap: 10,
    padding: 16,
  },
  conflictCard: {
    backgroundColor: "#3a3324",
    borderColor: "#7a6321",
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  errorTitle: { color: "#ffd0ca", fontSize: 15, fontWeight: "800" },
  errorText: { color: "#dbaea9", fontSize: 13, lineHeight: 20 },
});
