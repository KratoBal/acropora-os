import { useMutation, useQuery } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { type ReactNode, useMemo, useState } from "react";
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

import {
  createAsset,
  listAssetOwners,
  type AssetKind,
  type AssetOwnerOption,
} from "@/lib/api/assets";
import { listPartnerUnits } from "@/lib/api/partners";
import { selectableUnitOptions, unitLevels } from "@/lib/partners/site-tree";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";

import {
  buildAssetCreatePayload,
  dateFromInput,
  dateInputValue,
  type AssetCreateField,
} from "@/lib/assets/asset-create";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";

const kinds: { value: AssetKind; label: string }[] = [
  { value: "SYSTEM", label: "Rendszer" },
  { value: "EQUIPMENT", label: "Berendezés" },
  { value: "COMPONENT", label: "Részegység" },
  { value: "SENSOR", label: "Szenzor" },
  { value: "OTHER", label: "Egyéb" },
];

export default function NewAssetScreen() {
  const router = useRouter();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;
  const ownersQuery = useQuery({
    queryKey: ["asset-owners"],
    queryFn: listAssetOwners,
    enabled: status === "authenticated" && Boolean(capabilities?.assetsManage),
  });
  const [ownerSearch, setOwnerSearch] = useState("");
  const [owner, setOwner] = useState<AssetOwnerOption | null>(null);
  const [unitId, setUnitId] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AssetKind>("EQUIPMENT");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [inventoryNumber, setInventoryNumber] = useState("");
  const [installedAt, setInstalledAt] = useState("");
  const [interval, setInterval] = useState("");
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  /**
   * A hiba MEZŐSTÜL. A `field` azt mondja meg, hol kell megmutatni; `null`
   * annyit tesz, hogy a szervertől jött, tehát nem köthető egy mezőhöz.
   *
   * Ez a mért hiba javítása (2026-08-25): eddig egyetlen hibasáv volt, a
   * képernyő TETEJÉN, a mentés gomb pedig az űrlap alján. Aki a gombot
   * megnyomta, semmit nem látott, és a gomb NÉMÁNAK tűnt.
   */
  const [error, setError] = useState<{
    field: AssetCreateField | null;
    message: string;
  } | null>(null);

  /*
   * A PARTNER HELYSZÍNEI. Csak szerviz partnernél van mit betölteni: vevő
   * tulajdonosnál a cím a pontosítás, és a szerver az alegységet ott el is
   * utasítja. A lista ugyanarról a végpontról jön, amit a partner képernyője
   * és a webes eszköz-űrlap is használ (`partners.view`, ami a szerelőnek is
   * megvan).
   */
  const unitsQuery = useQuery({
    queryKey: ["partner-units", owner?.id],
    queryFn: () => listPartnerUnits(owner!.id),
    enabled:
      status === "authenticated" &&
      Boolean(capabilities?.assetsManage) &&
      owner?.type === "SUPPLIER",
  });

  const units = useMemo(
    () => selectableUnitOptions(unitsQuery.data?.items ?? []),
    [unitsQuery.data],
  );

  const filteredOwners = useMemo(() => {
    const needle = ownerSearch.trim().toLocaleLowerCase("hu");
    return (ownersQuery.data?.items ?? [])
      .filter((item) =>
        !needle
          ? true
          : `${item.displayName} ${item.code}`
              .toLocaleLowerCase("hu")
              .includes(needle),
      )
      .slice(0, 20);
  }, [ownerSearch, ownersQuery.data]);

  const mutation = useMutation({
    mutationFn: createAsset,
    onSuccess: (created) =>
      router.replace({ pathname: "/assets/[id]", params: { id: created.id } }),
    onError: (cause) =>
      setError({
        field: null,
        message:
          cause instanceof Error ? cause.message : "Az eszköz nem menthető.",
      }),
  });

  if (status !== "authenticated" || !user) return <Redirect href="/login" />;
  if (!capabilities?.assetsManage) return <Redirect href="/assets" />;

  const submit = () => {
    setError(null);
    /**
     * A döntés a `lib/assets/asset-create.ts`-ben van, mert ott MÉRHETŐ: ebben
     * a fájlban nincs, ami tesztelné. A dátumot ugyanott normalizáljuk, mert a
     * kézzel írt magyar alak (`2026.08.25`) a szerver ISO-ellenőrzésén elbukott.
     */
    const result = buildAssetCreatePayload({
      owner: owner ? { type: owner.type, id: owner.id } : null,
      unitId,
      name,
      kind,
      manufacturer,
      model,
      serialNumber,
      inventoryNumber,
      installedAt,
      interval,
    });

    if (!result.ok) {
      setError({ field: result.field, message: result.message });
      return;
    }

    mutation.mutate(result.payload);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      {/*
        A BILLENTYŰZET NE TAKARJA EL, AMIBE ÍRNAK. A bejelentés szó szerint az
        volt, hogy a Sorozatszám és az alatta lévő mezők „már nem látszanak, ha
        írni akarok bele". Az appban eddig egyetlen képernyő kezelte ezt, a
        bejelentkezés; itt hiányzott, és a görgetett tartalom alsó térköze
        (48 pont) a billentyűzet magasságához képest semmi.
      */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <Text style={styles.eyebrow}>ESZKÖZNYILVÁNTARTÁS</Text>
          <Text style={styles.title}>Új eszköz</Text>
          <Text style={styles.subtitle}>
            Mentés után az adatlapról azonnal nyomtatható a 30×30 mm-es
            QR-címke.
          </Text>

          <Section title="Partner">
            <TextInput
              value={ownerSearch}
              onChangeText={setOwnerSearch}
              placeholder="Szerviz partner keresése"
              placeholderTextColor="#668798"
              style={styles.input}
            />
            <FieldError error={error} field="owner" />
            {ownersQuery.isPending ? (
              <ActivityIndicator color="#52d6c7" />
            ) : null}
            {filteredOwners.map((item) => {
              const selected =
                owner?.type === item.type && owner.id === item.id;
              return (
                <Pressable
                  key={`${item.type}:${item.id}`}
                  onPress={() => {
                    setOwner(item);
                    // A helyszín a partnerhez tartozik: partnerváltásnál a
                    // korábbi választás egy MÁSIK partner fájából való lenne, és
                    // a szerver azt el is utasítaná a mentés végén.
                    setUnitId("");
                  }}
                  style={[styles.ownerRow, selected && styles.ownerSelected]}
                >
                  <Text style={styles.ownerName}>{item.displayName}</Text>
                  <Text style={styles.ownerMeta}>
                    {item.type === "CUSTOMER" ? "Vevő" : "Partner"} ·{" "}
                    {item.code}
                    {item.outsideServiceScope ? " · nem szerviz partner" : ""}
                  </Text>
                </Pressable>
              );
            })}
          </Section>

          {/*
            A HELYSZÍN CSAK SZERVIZ PARTNERNÉL JELENIK MEG. Vevő tulajdonosnál
            nem választható: ott a cím a pontosítás, és a szerver az alegységet
            el is utasítja. Egy mező, amit ki lehet tölteni, de a mentés
            visszadob, rosszabb, mint a hiányzó mező.
          */}
          {owner?.type === "SUPPLIER" ? (
            <Section title="Helyszín">
              <Text style={styles.hint}>
                Melyik egységnél áll az eszköz. Elhagyható, de a szerelő ebből
                találja meg a helyszínen.
              </Text>
              {unitsQuery.isPending ? (
                <ActivityIndicator color="#52d6c7" />
              ) : null}
              {unitsQuery.isError ? (
                <Text style={styles.unitError}>
                  A partner helyszínei nem tölthetők be. Az eszköz helyszín
                  nélkül is menthető.
                </Text>
              ) : null}
              {!unitsQuery.isPending &&
              !unitsQuery.isError &&
              units.options.length === 0 ? (
                <Text style={styles.hint}>
                  Ehhez a partnerhez még nincs felvéve helyszín.
                </Text>
              ) : null}
              {/*
                LEPCSOS VALASZTO: egy szint egy sor. A teljes utas lista a
                telefonon hosszu, es valasztas kozben nem latszik, hol tart az
                ember -- itt minden szinten csak nehany testver all.

                A KIVEZETETT HELYSZIN LATSZIK, DE NEM VALASZTHATO. Ha egy meglevo
                eszkoz epp ilyenen all, a lanc akkor is felepul rajta: kulonben a
                beallitott helyszin nemán eltunne. Uj eszkoznel ez nem all elo,
                de a ket urlap ugyanazt a szabalyt kovesse.
              */}
              {unitLevels(unitsQuery.data?.items ?? [], unitId || null).map(
                (level, depth) =>
                  level.options.length === 0 ? null : (
                    <View key={`szint-${depth}`} style={styles.unitLevel}>
                      {level.options.map((option) => {
                        const selected = level.selectedId === option.id;
                        return (
                          <Pressable
                            key={option.id}
                            disabled={!option.isActive && !selected}
                            onPress={() => setUnitId(selected ? "" : option.id)}
                            style={[
                              styles.ownerRow,
                              selected && styles.ownerSelected,
                              !option.isActive && !selected && styles.unitOff,
                            ]}
                          >
                            <Text style={styles.ownerName}>
                              {option.label}
                              {option.isActive ? "" : " (kivezetett)"}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ),
              )}
              {/*
                A KIHAGYÁS NEM NÉMA. Aki tudja, hogy annak a partnernek hat
                helyszíne van, és négyet lát, a listát hiszi hibásnak.
              */}
              {units.hiddenCount > 0 ? (
                <Text style={styles.hint}>
                  {units.hiddenCount} kivezetett helyszín nem választható.
                </Text>
              ) : null}
            </Section>
          ) : null}

          <Section title="Eszközadatok">
            <Field label="Eszköz neve *" value={name} onChangeText={setName} />
            <FieldError error={error} field="name" />
            <Text style={styles.label}>Típus</Text>
            <View style={styles.kindGrid}>
              {kinds.map((item) => (
                <Pressable
                  key={item.value}
                  onPress={() => setKind(item.value)}
                  style={[
                    styles.kindButton,
                    kind === item.value && styles.kindSelected,
                  ]}
                >
                  <Text style={styles.kindText}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
            <Field
              label="Gyártó"
              value={manufacturer}
              onChangeText={setManufacturer}
            />
            <Field label="Modell" value={model} onChangeText={setModel} />
            <Field
              label="Sorozatszám"
              value={serialNumber}
              onChangeText={setSerialNumber}
            />
            {/*
              A PARTNER SAJÁT AZONOSÍTÓJA. A gépen gyakran ez a matrica van
              rajta, és a szerelő akkor látja, amikor előtte áll. A mező eddig
              csak a szerkesztő képernyőn volt meg, tehát utólag, az irodából
              lehetett pótolni -- egy külön kör telefonálással.
            */}
            <Field
              label="Leltári szám"
              value={inventoryNumber}
              onChangeText={setInventoryNumber}
            />
            {/*
              A RENDSZER SAJÁT DÁTUMVÁLASZTÓJA (Balázs döntése, 2026-08-25).
              A mező mögött ugyanaz az `ÉÉÉÉ-HH-NN` szöveg marad, amit a kérés
              is visz: a választó nem új adatfajtát hoz, csak megbízhatóbb
              bevitelt.
            */}
            <View style={styles.field}>
              <Text style={styles.label}>Telepítés dátuma</Text>
              <Pressable
                onPress={() => setDatePickerOpen(true)}
                style={styles.input}
              >
                <Text
                  style={installedAt ? styles.dateValue : styles.datePrompt}
                >
                  {installedAt || "Válassz dátumot"}
                </Text>
              </Pressable>
              {installedAt ? (
                <Pressable onPress={() => setInstalledAt("")}>
                  <Text style={styles.clearDate}>Dátum törlése</Text>
                </Pressable>
              ) : null}
            </View>
            {datePickerOpen ? (
              <DateTimePicker
                value={dateFromInput(installedAt)}
                mode="date"
                onChange={(event: DateTimePickerEvent, picked?: Date) => {
                  /**
                   * Androidon a választó magától bezárul, iOS-en a felhasználó
                   * görgeti. A `dismissed` ág külön van: ott NEM írjuk felül a
                   * mezőt, mert a kilépés nem választás.
                   */
                  if (Platform.OS !== "ios") setDatePickerOpen(false);
                  if (event.type === "dismissed" || !picked) return;
                  setInstalledAt(dateInputValue(picked));
                }}
              />
            ) : null}
            {datePickerOpen && Platform.OS === "ios" ? (
              <Pressable onPress={() => setDatePickerOpen(false)}>
                <Text style={styles.clearDate}>Kész</Text>
              </Pressable>
            ) : null}
            <FieldError error={error} field="installedAt" />
            <Field
              label="Karbantartási intervallum (nap)"
              value={interval}
              onChangeText={setInterval}
              keyboardType="number-pad"
            />
            <FieldError error={error} field="interval" />
          </Section>

          {/*
          A HIBA A GOMB MELLETT IS. Ahol megnyomták, ott kell látszania: a
          mezőnél megjelenő üzenet a képernyő tetején lehet, a gomb viszont az
          alján van. Ez a két hely együtt zárja ki azt az állapotot, amiből a
          bejelentés született: „ha megnyomom a mentés gombot, nem történik
          semmi".
        */}
          {error ? <Text style={styles.error}>{error.message}</Text> : null}

          <Pressable
            disabled={mutation.isPending}
            onPress={submit}
            style={[styles.saveButton, mutation.isPending && styles.disabled]}
          >
            <Text style={styles.saveText}>
              {mutation.isPending ? "Mentés…" : "Eszköz létrehozása"}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** A mezőhöz tartozó hibaüzenet, ott, ahol a hiba keletkezett. */
function FieldError({
  error,
  field,
}: {
  error: { field: AssetCreateField | null; message: string } | null;
  field: AssetCreateField;
}) {
  if (!error || error.field !== field) return null;
  return <Text style={styles.fieldError}>{error.message}</Text>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChangeText(value: string): void;
  keyboardType?: "default" | "number-pad";
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        keyboardType={props.keyboardType}
        placeholderTextColor="#668798"
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#071827" },
  flex: { flex: 1 },
  fieldError: { color: "#fecaca", fontSize: 12, fontWeight: "700" },
  dateValue: { color: "#f4fbff" },
  datePrompt: { color: "#668798" },
  clearDate: { color: "#52d6c7", fontSize: 12, fontWeight: "800" },
  container: { padding: 18, paddingBottom: 48, gap: 16 },
  eyebrow: {
    color: "#52d6c7",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  title: { color: "#f4fbff", fontSize: 28, fontWeight: "900" },
  subtitle: { color: "#91afbe", lineHeight: 21 },
  error: {
    color: "#fecaca",
    backgroundColor: "#541b2b",
    padding: 12,
    borderRadius: 10,
  },
  section: {
    backgroundColor: "#0d2b40",
    borderColor: "#1c4963",
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
  },
  sectionTitle: { color: "#f4fbff", fontSize: 17, fontWeight: "900" },
  sectionBody: { marginTop: 12, gap: 10 },
  field: { gap: 5 },
  label: { color: "#a9c4d1", fontSize: 12, fontWeight: "800" },
  input: {
    color: "#f4fbff",
    backgroundColor: "#071f31",
    borderColor: "#28536a",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  ownerRow: {
    padding: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#21485e",
    backgroundColor: "#0a2335",
  },
  ownerSelected: { borderColor: "#52d6c7", backgroundColor: "#12443f" },
  // Egy szint egy sor: a szintek kozotti tavolsag mutatja, hogy lejjebb leptunk.
  unitLevel: { gap: 6, marginBottom: 8 },
  unitOff: { opacity: 0.5 },
  hint: { color: "#789cad", fontSize: 12, lineHeight: 17 },
  unitError: { color: "#ffb4ab", fontSize: 12, lineHeight: 17 },
  ownerName: { color: "#f4fbff", fontWeight: "800" },
  ownerMeta: { color: "#789cad", fontSize: 11, marginTop: 2 },
  kindGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kindButton: {
    backgroundColor: "#164057",
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  kindSelected: { backgroundColor: "#177b74" },
  kindText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  saveButton: { backgroundColor: "#177b74", borderRadius: 12, padding: 15 },
  saveText: {
    color: "#fff",
    textAlign: "center",
    fontWeight: "900",
    fontSize: 15,
  },
  disabled: { opacity: 0.55 },
});
