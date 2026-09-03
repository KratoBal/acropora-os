import { useMutation, useQuery } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
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
  createWorksheet,
  listSelectableWorksheetPartners,
  listWorksheetDepartments,
  type WorksheetDepartment,
  type WorksheetSelectablePartner,
} from "@/lib/api/worksheets";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
// A `useIsOnline` SZANDEKOSAN nem szerepel itt: a masolat akkor kerul elo, ha a
// hivas TENYLEG elhasalt, nem akkor, ha a keszulek offline-nak mondja magat.
// Ugyanaz a szabaly, mint a `connectivity.ts` fejleceben.
import { describeCachedDepartmentsNotice } from "@/lib/offline/offline-notice";
import {
  readCachedWorksheetDepartments,
  rememberWorksheetDepartments,
} from "@/lib/offline/worksheet-department-cache";
import { ApiError } from "@/lib/api/client";
import { saveOrQueue } from "@/lib/offline/save-or-queue";
import { enqueueWorksheetCreate } from "@/lib/offline/queue-store";
import { worksheetOperationId } from "@/lib/offline/sync-queue";
import {
  buildWorksheetCreatePayload,
  describeWorksheetQueueWrite,
  type WorksheetCreateField,
  type WorksheetCreatePayload,
} from "@/lib/worksheets/worksheet-create";

/**
 * ÚJ MUNKALAP A HELYSZÍNRŐL.
 *
 * === MIÉRT EGY KÉPERNYŐ, ÉS MIÉRT NINCS RAJTA TÉTEL ===
 *
 * A szerver három mezőt kér a lap megnyitásához (partner, helyszín, tárgy); a
 * tételek listája alapértelmezetten ÜRES. Lemérve: a helyszínen nyitott lap
 * tétel nélkül is teljes értékű, tehát a felvitel elfér egyetlen képernyőn, és
 * a tétel-szerkesztő külön szelet lehet.
 *
 * A DÁTUMOK ÉS AZ ÁR NINCSENEK ITT: azok az irodai oldalon dőlnek el (Balázs
 * döntése, 2026-09-02). Egy telefonon kitöltött dátum a lapon ÉRTÉKKÉNT állna,
 * és senki nem tudná megkülönböztetni a szándékostól.
 *
 * === A DÖNTÉS A `lib/worksheets/worksheet-create.ts`-BEN VAN ===
 *
 * Mert ott MÉRHETŐ: ebben a fájlban nincs, ami tesztelné. Ide csak a hívás
 * kerül, és az, hogy a hiba ANNÁL A MEZŐNÉL jelenjen meg, ahol keletkezett.
 */
export default function NewWorksheetScreen() {
  const router = useRouter();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;

  const [partner, setPartner] = useState<WorksheetSelectablePartner | null>(
    null,
  );
  const [partnerPickerOpen, setPartnerPickerOpen] = useState(true);
  const [departmentId, setDepartmentId] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<{
    field: WorksheetCreateField | null;
    message: string;
  } | null>(null);
  /**
   * A SORBA KERULT LAP UZENETE, KULON AZ ERRORTOL. Nem hiba: a felvitel
   * megtortent, csak meg a telefonon var. Ugyanabban a piros dobozban a
   * kollega elveszettnek hinne, es ujra felvinne.
   */
  const [queued, setQueued] = useState<string | null>(null);

  const partnersQuery = useQuery({
    queryKey: ["worksheet-partners"],
    queryFn: listSelectableWorksheetPartners,
    enabled:
      status === "authenticated" && Boolean(capabilities?.worksheetsManage),
  });

  /**
   * A HELYSZÍNEK A PARTNERTŐL FÜGGNEK, ezért a lekérdezés is.
   *
   * A `customerId` a munkalapé, nem a partneré, és a végpont is ezen a néven
   * kéri -- a `partners.ts` alegység-hívása MÁS azonosítóra megy, tehát nem
   * cserélhető fel vele.
   */
  const departmentsQuery = useQuery({
    queryKey: ["worksheet-departments", partner?.customerId],
    queryFn: () => listWorksheetDepartments(partner!.customerId),
    enabled: Boolean(partner?.customerId),
  });

  /**
   * A FRISS LISTÁT MENTJÜK, hogy a pincében legyen miből választani. A helyszín
   * KÖTELEZŐ mező: e nélkül a másolat nélkül a helyszíni felvitel pont ott nem
   * működne, ahol a legtöbbet érne.
   */
  useEffect(() => {
    const customerId = partner?.customerId;
    const items = departmentsQuery.data?.items;
    if (!customerId || !items) return;
    void rememberWorksheetDepartments(customerId, items);
  }, [partner?.customerId, departmentsQuery.data]);

  /**
   * A MENTETT MÁSOLAT CSAK AKKOR KERÜL ELŐ, HA A HÍVÁS TÉNYLEG ELHASALT -- nem
   * akkor, ha a készülék offline-nak MONDJA magát. Ugyanaz a szabály, mint a
   * `connectivity.ts` fejlécében: egy rosszul jelentő jelzés nem tarthat vissza
   * egy működő lekérdezést.
   */
  const [cached, setCached] = useState<{
    items: WorksheetDepartment[];
    syncedAt: string | null;
  }>({ items: [], syncedAt: null });

  useEffect(() => {
    const customerId = partner?.customerId;
    if (!customerId || !departmentsQuery.isError) return;
    let ervenyes = true;
    void (async () => {
      const masolat = await readCachedWorksheetDepartments(customerId);
      if (ervenyes) setCached(masolat);
    })();
    return () => {
      ervenyes = false;
    };
  }, [partner?.customerId, departmentsQuery.isError]);

  const fromCache = departmentsQuery.isError;
  const departments = useMemo(
    () =>
      (fromCache ? cached.items : (departmentsQuery.data?.items ?? [])).filter(
        (d) => d.isActive,
      ),
    [fromCache, cached.items, departmentsQuery.data],
  );

  /**
   * A SÁV AKKOR SZÓL, HA A LISTA MÁSOLATBÓL VAN. A választás ITT ÍRÁSSÁ válik:
   * egy időközben törölt helyszín a másolatban még ott áll, és a lap küldése a
   * szerveren bukna el, jóval később.
   */
  const cacheNotice = fromCache
    ? describeCachedDepartmentsNotice({
        online: false,
        count: departments.length,
        syncedAt: cached.syncedAt,
        now: new Date(),
      })
    : null;

  /**
   * MENTES: A SZERVERNEK, ES CSAK HALOZATI HIBANAL A SORBA.
   *
   * A dontes a `lib/offline/save-or-queue.ts`-ben van, mert ott MERHETO --
   * ebben a fajlban nincs, ami tesztelne. Ugyanaz a fuggveny fut, mint az
   * eszkoz-felvitelnel; a SZOVEG kulon, mert a munkalapnal nincs
   * gyorsitotar-ellenorzes, amit a mondat hordozhatna.
   */
  const mutation = useMutation({
    mutationFn: async (payload: WorksheetCreatePayload) => {
      const nyitas = new Date().toISOString();
      return saveOrQueue({
        save: () => createWorksheet(payload),
        enqueue: () =>
          enqueueWorksheetCreate({
            /**
             * A KULCS A TARTALOMBOL SZULETIK, es UGYANEZ megy fel a szervernek
             * `clientOperationId` neven: egy megszakadt kuldes ujrakuldese a
             * MEGLEVO lapot adja vissza, nem masodikat hoz letre.
             */
            id: worksheetOperationId({
              customerId: payload.customerId,
              startedAt: nyitas,
            }),
            payload,
            createdAt: nyitas,
          }),
        statusOf: (cause) => (cause instanceof ApiError ? cause.status : null),
        describeWrite: describeWorksheetQueueWrite,
      });
    },
    onSuccess: (outcome) => {
      if (outcome.type === "saved") {
        router.replace({
          pathname: "/worksheets/[id]",
          params: { id: outcome.assetId },
        });
        return;
      }
      if (outcome.type === "queued") {
        setQueued(outcome.message);
        return;
      }
      /**
       * A `lost` ES A `rejected` HIBAKENT jelenik meg, nem zolden. A ket eset
       * kulonbozik (az egyiknel a lap SEHOL nincs, a masiknal a szerver tudja
       * es elutasitotta), de EGYIK SEM siker.
       */
      setError({ field: null, message: outcome.message });
    },
    onError: (cause) =>
      setError({
        field: null,
        message:
          cause instanceof Error
            ? cause.message
            : "A munkalap nem hozható létre.",
      }),
  });

  if (status !== "authenticated" || !user) return <Redirect href="/login" />;
  if (!capabilities?.worksheetsManage) return <Redirect href="/worksheets" />;

  const submit = () => {
    setError(null);
    const result = buildWorksheetCreatePayload({
      customerId: partner?.customerId ?? "",
      departmentId,
      subject,
      description,
    });
    if (!result.ok) {
      setError({ field: result.field, message: result.message });
      return;
    }
    mutation.mutate(result.payload);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <Text style={styles.eyebrow}>MUNKALAPOK</Text>
          <Text style={styles.title}>Új munkalap</Text>
          <Text style={styles.subtitle}>
            A helyszínen nyitott lapra a tételek és az ár később, az irodából
            kerülnek fel.
          </Text>

          <Section title="Partner">
            <Pressable
              accessibilityRole="button"
              onPress={() => setPartnerPickerOpen((open) => !open)}
              style={[styles.pickerRow, partner && styles.pickerSelected]}
            >
              <Text style={styles.pickerName}>
                {partner ? partner.name : "Válassz partnert"}
              </Text>
              <Text style={styles.pickerMeta}>
                {partner ? partner.partnerCode : "Koppints a listához"}
              </Text>
            </Pressable>
            <FieldError error={error} field="customer" />
            {!partnerPickerOpen ? null : partnersQuery.isPending ? (
              <ActivityIndicator color="#52d6c7" />
            ) : partnersQuery.isError ? (
              <Text style={styles.hint}>
                A partnerlista nem töltődött be. Húzd le a listát a
                munkalapoknál, vagy próbáld újra.
              </Text>
            ) : (
              <View style={styles.list}>
                {(partnersQuery.data?.items ?? []).map((item) => (
                  <Pressable
                    key={item.customerId}
                    onPress={() => {
                      setPartner(item);
                      setPartnerPickerOpen(false);
                      /**
                       * A HELYSZÍN A PARTNERHEZ TARTOZIK: partnerváltásnál a
                       * korábbi választás ÉRVÉNYTELEN. Enélkül egy másik
                       * partner alegysége maradna a mezőben, és a szerver
                       * utasítaná el a küldést -- a felhasználó pedig nem
                       * értené, mit ír el.
                       */
                      setDepartmentId("");
                    }}
                    style={[
                      styles.listRow,
                      partner?.customerId === item.customerId &&
                        styles.listRowOn,
                    ]}
                  >
                    <Text style={styles.listName}>{item.name}</Text>
                    <Text style={styles.listMeta}>{item.partnerCode}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </Section>

          <Section title="Helyszín">
            {!partner ? (
              <Text style={styles.hint}>
                Előbb válassz partnert: a helyszínek hozzá tartoznak.
              </Text>
            ) : departmentsQuery.isPending ? (
              <ActivityIndicator color="#52d6c7" />
            ) : departments.length === 0 ? (
              /**
               * AZ ÜRES LISTA OKÁT KIMONDJUK. Egy néma üres doboz mellett a
               * szerelő azt hinné, rosszul választott partnert -- holott a
               * partnernek egyszerűen nincs még felvitt helyszíne, és azt az
               * irodából lehet pótolni.
               */
              <Text style={styles.hint}>
                {fromCache
                  ? "Nincs mentett helyszín ehhez a partnerhez a telefonon."
                  : "Ehhez a partnerhez még nincs helyszín felvéve. Az irodából lehet hozzáadni, addig a lap nem nyitható meg."}
              </Text>
            ) : (
              <View style={styles.list}>
                {departments.map((unit: WorksheetDepartment) => (
                  <Pressable
                    key={unit.id}
                    onPress={() => setDepartmentId(unit.id)}
                    style={[
                      styles.listRow,
                      departmentId === unit.id && styles.listRowOn,
                    ]}
                  >
                    <Text style={styles.listName}>{unit.name}</Text>
                    <Text style={styles.listMeta}>{unit.code}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {cacheNotice ? (
              <View style={styles.notice}>
                <Text style={styles.noticeTitle}>{cacheNotice.title}</Text>
                <Text style={styles.noticeBody}>{cacheNotice.message}</Text>
              </View>
            ) : null}
            <FieldError error={error} field="department" />
          </Section>

          <Section title="A munka">
            <View style={styles.field}>
              <Text style={styles.label}>Tárgy</Text>
              <TextInput
                value={subject}
                onChangeText={setSubject}
                placeholder="Mi a munka (például: szivattyú csere)"
                placeholderTextColor="#5b7d8f"
                style={styles.input}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Leírás (elhagyható)</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Amit a helyszínen érdemes rögzíteni"
                placeholderTextColor="#5b7d8f"
                multiline
                style={[styles.input, styles.multiline]}
              />
            </View>
            <FieldError error={error} field="subject" />
          </Section>

          {/*
            A HIBA A GOMB MELLETT IS. Ugyanaz a mért ok, mint az eszköz-űrlapon:
            a mezőnél megjelenő üzenet a képernyő tetején lehet, a gomb viszont
            az alján van, és aki megnyomta, semmit nem lát.
          */}
          {error ? <Text style={styles.error}>{error.message}</Text> : null}
          {queued ? <Text style={styles.queued}>{queued}</Text> : null}

          <Pressable
            disabled={mutation.isPending}
            onPress={submit}
            style={[styles.saveButton, mutation.isPending && styles.disabled]}
          >
            <Text style={styles.saveText}>
              {mutation.isPending ? "Mentés…" : "Munkalap megnyitása"}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function FieldError({
  error,
  field,
}: {
  error: { field: WorksheetCreateField | null; message: string } | null;
  field: WorksheetCreateField;
}) {
  if (!error || error.field !== field) return null;
  return <Text style={styles.fieldError}>{error.message}</Text>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#071827" },
  flex: { flex: 1 },
  container: { padding: 18, paddingBottom: 48, gap: 16 },
  eyebrow: {
    color: "#52d6c7",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  title: { color: "#f4fbff", fontSize: 28, fontWeight: "900" },
  subtitle: { color: "#91afbe", lineHeight: 21 },
  section: {
    backgroundColor: "#0d2233",
    borderRadius: 14,
    padding: 14,
  },
  sectionTitle: { color: "#f4fbff", fontSize: 17, fontWeight: "900" },
  sectionBody: { marginTop: 12, gap: 10 },
  field: { gap: 5 },
  label: { color: "#a9c4d1", fontSize: 12, fontWeight: "800" },
  input: {
    backgroundColor: "#08192a",
    borderColor: "#17394f",
    borderRadius: 10,
    borderWidth: 1,
    color: "#f4fbff",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  multiline: { minHeight: 90, textAlignVertical: "top" },
  pickerRow: {
    backgroundColor: "#08192a",
    borderColor: "#17394f",
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
  },
  pickerSelected: { borderColor: "#52d6c7", backgroundColor: "#12443f" },
  pickerName: { color: "#f4fbff", fontWeight: "800" },
  pickerMeta: { color: "#789cad", fontSize: 11, marginTop: 2 },
  list: {
    backgroundColor: "#08192a",
    borderColor: "#17394f",
    borderRadius: 10,
    borderWidth: 1,
    padding: 6,
    gap: 2,
  },
  listRow: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9 },
  listRowOn: { backgroundColor: "#123f3b" },
  listName: { color: "#f4fbff", fontSize: 14 },
  listMeta: { color: "#789cad", fontSize: 11, marginTop: 2 },
  hint: { color: "#789cad", fontSize: 12, lineHeight: 17 },
  notice: {
    backgroundColor: "#0b2f3f",
    borderRadius: 10,
    gap: 4,
    padding: 12,
  },
  noticeTitle: { color: "#f4fbff", fontSize: 13, fontWeight: "900" },
  noticeBody: { color: "#a9c4d1", fontSize: 12, lineHeight: 17 },
  fieldError: { color: "#fecaca", fontSize: 12, fontWeight: "700" },
  error: {
    backgroundColor: "#3a1a1a",
    borderRadius: 10,
    color: "#ffb4ab",
    padding: 12,
  },
  queued: {
    backgroundColor: "#0b2f3f",
    borderRadius: 10,
    color: "#a9e7dd",
    padding: 12,
  },
  saveButton: { backgroundColor: "#177b74", borderRadius: 12, padding: 15 },
  saveText: {
    color: "#fff",
    fontWeight: "900",
    textAlign: "center",
    fontSize: 15,
  },
  disabled: { opacity: 0.55 },
});
