import * as ImagePicker from "expo-image-picker";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { type ReactNode, useEffect, useMemo, useState } from "react";
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
  type CreateAssetInput,
  listAssetOwners,
  uploadAssetDocuments,
  type AssetKind,
  type AssetOwnerOption,
} from "@/lib/api/assets";
import { MAX_FILES_PER_UPLOAD } from "@/lib/api/document-upload";
import { photoPermissionDeniedNotice } from "@/lib/api/photo-permission-notice";
import { toPickedImages, type PickedFile } from "@/lib/api/picked-image";
import {
  describePhotoQueueing,
  planPhotosAfterRecord,
  queuePhotosForRecording,
} from "@/lib/assets/photo-after-record";
import { listPartnerUnits, type PartnerUnit } from "@/lib/api/partners";
import { listPerformanceUnits } from "@/lib/api/units-of-measure";
import { selectableUnitOptions } from "@/lib/partners/site-tree";
import { CollapsedPicker, UnitPicker } from "@/components/assets/unit-picker";
import {
  LabelCodeField,
  useLabelScanner,
} from "@/components/assets/label-code-field";
import { PerformanceField } from "@/components/assets/performance-field";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";

import {
  buildAssetCreatePayload,
  dateFromInput,
  dateInputValue,
  type AssetCreateField,
} from "@/lib/assets/asset-create";
import {
  decideOfflineRecord,
  describeQueueWrite,
} from "@/lib/assets/offline-record";
import { saveOrQueue, type SaveOutcome } from "@/lib/offline/save-or-queue";
import { ApiError } from "@/lib/api/client";
import {
  readCachedAssetByToken,
  readCachedAssets,
} from "@/lib/offline/asset-cache";
import {
  readCachedAssetOwners,
  readCachedPartnerUnits,
  rememberAssetOwners,
  rememberPartnerUnits,
} from "@/lib/offline/asset-form-cache";
import { listFromCacheOrNetwork } from "@/lib/offline/list-source";
import {
  describeCachedDepartmentsNotice,
  describeCachedOwnersNotice,
} from "@/lib/offline/offline-notice";
import { enqueueAssetCreate, enqueuePhoto } from "@/lib/offline/queue-store";
import { filterOwners } from "@/lib/assets/owner-search";
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
  /**
   * A TELJESITMENY-EGYSEGEK. Csak az AKTIVAK jonnek: a kivezetett egyseg a
   * valasztobol esik ki.
   *
   * A HIBA NEM ALLITJA MEG AZ URLAPOT: ha a torzsadat nem tolthető be, a tobbi
   * mezo akkor is kitoltheto, a teljesitmeny-valaszto pedig ures. Egy egesz
   * felvitelt elvenni egy MELLEKES lista miatt nagyobb kar, mint a hianyzo
   * valaszto -- a szerelo a helyszinen all.
   */
  const performanceUnitsQuery = useQuery({
    queryKey: ["performance-units"],
    queryFn: listPerformanceUnits,
    enabled: status === "authenticated",
  });

  const ownersQuery = useQuery({
    queryKey: ["asset-owners"],
    queryFn: listAssetOwners,
    enabled: status === "authenticated" && Boolean(capabilities?.assetsManage),
  });
  const [ownerSearch, setOwnerSearch] = useState("");
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false);
  const [owner, setOwner] = useState<AssetOwnerOption | null>(null);
  const [unitId, setUnitId] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AssetKind>("EQUIPMENT");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [inventoryNumber, setInventoryNumber] = useState("");
  const [labelCode, setLabelCode] = useState("");
  /**
   * A TELJESITMENY ES A MERTEKEGYSEGE -- KET MEZO, EGY ADAT.
   *
   * A ketto EGYUTT megy, vagy egyik sem: a tablan CHECK all rajta. A dontest a
   * `buildAssetCreatePayload` hozza, mert ott MERHETO -- ebben a fajlban nincs,
   * ami tesztelne.
   */
  const [performance, setPerformance] = useState("");
  const [performanceUnitId, setPerformanceUnitId] = useState("");
  // A BEOLVASO A KOZOS ALLVANYBOL JON, ugyanabbol, amit a szerkeszto kepernyo
  // is hasznal. Az indoklas (miert ratet, es miert nem masik kepernyo) ott all.
  const scanner = useLabelScanner(setLabelCode);
  const [installedAt, setInstalledAt] = useState("");
  const [interval, setInterval] = useState("");
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [kindPickerOpen, setKindPickerOpen] = useState(false);
  const [unitPickerOpen, setUnitPickerOpen] = useState(false);
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
  /**
   * A SORBA KERULT FELVITEL UZENETE, KULON AZ ERRORTOL.
   *
   * Nem hiba: a rogzites megtortent, csak meg a telefonon var. Ha ugyanabban a
   * piros dobozban jelenne meg, a kollega azt hinne, hogy elveszett -- es
   * ujra felvinne, most mar ket sorral.
   */
  const [queued, setQueued] = useState<string | null>(null);

  /**
   * A HELYSZINEN KESZULT KEPEK, MEG A MENTES ELOTT.
   *
   * MIERT A MENTES ELOTT VALASZTUNK, ES MIERT NEM UTANA: a pinceben a mentes
   * NEM visz sehova -- a felvitel a sorba kerul, es az eszkoz lapja meg nem
   * letezik, tehat nincs az a keperno, ahol a szerelo utolag ratenne a kepet.
   * Ha itt nem lehet fenykepezni, akkor a helyszinen SEHOL nem lehet.
   */
  const [photos, setPhotos] = useState<PickedFile[]>([]);
  /** Amit a kepekrol mondunk: kihagyott formatum, jog, sorba tetel eredmenye. */
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);

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

  /**
   * A KET LISTA MENTESE, AMIKOR MEGJON.
   *
   * Balazs 2026-09-03-an elesben merte, hogy terero nelkul nem tud eszkozt
   * felvinni: a ROGZITES megy offline, de az URLAP ket listaja halozatrol jott,
   * es e nelkul nincs mit valasztani.
   */
  useEffect(() => {
    const items = ownersQuery.data?.items;
    if (items) void rememberAssetOwners(items);
  }, [ownersQuery.data]);

  useEffect(() => {
    const items = unitsQuery.data?.items;
    if (owner?.id && items) void rememberPartnerUnits(owner.id, items);
  }, [owner?.id, unitsQuery.data]);

  /**
   * A MASOLAT CSAK AKKOR KERUL ELO, HA A HIVAS TENYLEG ELHASALT -- nem akkor,
   * ha a keszulek offline-nak MONDJA magat. Ugyanaz a szabaly, mint a
   * `connectivity.ts` fejleceben.
   */
  const [cachedOwners, setCachedOwners] = useState<{
    items: AssetOwnerOption[];
    syncedAt: string | null;
  }>({ items: [], syncedAt: null });
  const [cachedUnits, setCachedUnits] = useState<{
    items: PartnerUnit[];
    syncedAt: string | null;
  }>({ items: [], syncedAt: null });

  useEffect(() => {
    if (!ownersQuery.isError) return;
    let ervenyes = true;
    void (async () => {
      const masolat = await readCachedAssetOwners();
      if (ervenyes) setCachedOwners(masolat);
    })();
    return () => {
      ervenyes = false;
    };
  }, [ownersQuery.isError]);

  useEffect(() => {
    const partnerId = owner?.id;
    if (!partnerId || !unitsQuery.isError) return;
    let ervenyes = true;
    void (async () => {
      const masolat = await readCachedPartnerUnits(partnerId);
      if (ervenyes) setCachedUnits(masolat);
    })();
    return () => {
      ervenyes = false;
    };
  }, [owner?.id, unitsQuery.isError]);

  const ownersFromCache = ownersQuery.isError;
  const unitsFromCache = unitsQuery.isError;

  /**
   * A HELYSZIN-SOROK EGY FORRASBOL, mert eddig KETTO volt, es a masodik nem
   * ismerte a masolatot.
   *
   * Merve 2026-09-14, Balazs jelentese a 15 szamu buildrol: "A partnerek
   * bejonnek de a helyszin szerintem nem." A partner-lista helyesen esett
   * vissza a mentett masolatra, a helyszin-valaszto viszont KOZVETLENUL a
   * halozati valaszbol epult (`unitsQuery.data`), tehat teren kivul URES
   * tomböt kapott.
   *
   * ES AMIERT NEM LATSZOTT HIBANAK: az ures allapot uzenete ("Ehhez a
   * partnerhez meg nincs felveve helyszin") a `units` listat nezi, az pedig
   * a masolatbol MAR tele volt. Vagyis a valaszto ures maradt, es MELLETTE
   * meg csak magyarazat sem allt.
   *
   * A szerkeszto kepernyo (`assets/edit/[id].tsx`) ugyanezt mar helyesen
   * csinalta (`unitsQuery.data?.items ?? cachedUnits.data?.items ?? []`).
   * Ket kepernyo, ket kulon megoldas ugyanarra a kerdesre: ezert all most
   * egyetlen valtozoban, es ezert hivatkozik ra minden hasznalo.
   */
  const unitRows = useMemo(
    () =>
      listFromCacheOrNetwork({
        failed: unitsFromCache,
        fetched: unitsQuery.data?.items,
        cached: cachedUnits.items,
      }),
    [unitsFromCache, cachedUnits.items, unitsQuery.data],
  );

  const units = useMemo(() => selectableUnitOptions(unitRows), [unitRows]);

  const filteredOwners = useMemo(
    () =>
      filterOwners(
        listFromCacheOrNetwork({
          failed: ownersFromCache,
          fetched: ownersQuery.data?.items,
          cached: cachedOwners.items,
        }),
        ownerSearch,
      ),
    [ownersFromCache, cachedOwners.items, ownerSearch, ownersQuery.data],
  );

  /**
   * A SAV AKKOR SZOL, HA A LISTA MASOLATBOL VAN. A valasztas ITT IRASSA valik:
   * egy idokozben megszunt partner vagy alegyseg a masolatban meg ott all, es a
   * felvitel a szerveren bukna el, jóval kesobb.
   */
  const ownersNotice = ownersFromCache
    ? describeCachedOwnersNotice({
        online: false,
        count: cachedOwners.items.length,
        syncedAt: cachedOwners.syncedAt,
        now: new Date(),
      })
    : null;
  const unitsNotice = unitsFromCache
    ? describeCachedDepartmentsNotice({
        online: false,
        count: cachedUnits.items.length,
        syncedAt: cachedUnits.syncedAt,
        now: new Date(),
      })
    : null;

  /**
   * MENTES: A SZERVERNEK, ES CSAK HALOZATI HIBANAL A SORBA.
   *
   * A dontes a `lib/offline/save-or-queue.ts`-ben van, mert ott MERHETO -- ebben
   * a fajlban nincs, ami tesztelne. Ide csak a HIVAS kerul, es az, hogy a
   * negy kimenet KULON valaszt kap:
   *
   *   saved     -> atlepunk az eszkoz lapjara, ahogy eddig
   *   queued    -> a felvitel a telefonon var; kiirjuk, mihez kepest ellenoriztunk
   *   lost      -> a rogzites SEHOL nincs; ezt HIBAKENT mondjuk, nem zolden
   *   rejected  -> a szerver elutasitotta; nem kerul sorba
   */
  const mutation = useMutation({
    mutationFn: async (payload: CreateAssetInput) => {
      const gyorsitotar = await readCachedAssets();
      const beolvasas = new Date().toISOString();
      const dontes = decideOfflineRecord({
        qrToken: payload.labelCode ?? "",
        scannedAt: beolvasas,
        cached: payload.labelCode
          ? await readCachedAssetByToken(payload.labelCode)
          : null,
        cachedCount: gyorsitotar.items.length,
        syncedAt: gyorsitotar.syncedAt,
      });
      if (dontes.type === "blocked") {
        /**
         * A KOD MAR ALL EGY ESZKOZON: a felvitel itt megall. A kepekkel sincs
         * mit tenni -- nincs mihez kotni oket --, es ugyanazt az alakot adjuk
         * vissza, mint a tobbi ag: egy masik alak itt csendben elvinne a
         * kepekrol szolo mondatot.
         */
        return {
          outcome: {
            type: "rejected" as const,
            message: dontes.message,
          } satisfies SaveOutcome,
          photo: { maradjunk: false, message: null as string | null },
        };
      }
      const outcome = await saveOrQueue({
        save: () => createAsset(payload),
        enqueue: () =>
          enqueueAssetCreate({
            id: dontes.operationId,
            payload,
            createdAt: beolvasas,
          }),
        statusOf: (cause) => (cause instanceof ApiError ? cause.status : null),
        /**
         * A SZOVEG ITT AZ ESZKOZE: a mondat a gyorsitotar-ellenorzest is
         * hordozza (hany eszkoz ellen neztuk meg a kodot). A DONTES kozos, a
         * munkalap ugyanezt a fuggvenyt hivja, mas szoveggel.
         */
        describeWrite: (result) => describeQueueWrite(result, dontes.message),
      });
      /**
       * A KEP SORSA A ROGZITES KIMENETELEBOL KOVETKEZIK, es a dontes a
       * `lib/assets/photo-after-record.ts`-ben all, mert ott MERHETO. Ide
       * csak a VEGREHAJTAS kerul.
       */
      return { outcome, photo: await kepeketElintez(outcome, beolvasas) };
    },
    onSuccess: ({ outcome, photo }) => {
      /**
       * A KEPEKROL SZOLO MONDAT AKKOR IS MEGJELENIK, HA A ROGZITES SIKERULT.
       * Egy kimaradt kep kulon hir: a felvitel attol meg fent van.
       */
      setPhotoNotice(photo.message);
      /**
       * EGY ELBUKOTT KEP-FELTOLTES ITT TART MINKET. A `saved` ag kulonben
       * azonnal atlep az eszkoz lapjara, es a fenti mondat egy mar elhagyott
       * kepernyore kerulne -- a szerelo semmit nem latna abbol, hogy a
       * fenykepe sehol nincs.
       */
      if (outcome.type === "saved" && photo.maradjunk) return;
      if (outcome.type === "saved") {
        router.replace({
          pathname: "/assets/[id]",
          params: { id: outcome.id },
        });
        return;
      }
      if (outcome.type === "queued") {
        setQueued(outcome.message);
        return;
      }
      /**
       * A `lost` ES A `rejected` HIBAKENT jelenik meg, nem zolden. A ket eset
       * kulonbozik (az egyiknel a felvitel SEHOL nincs, a masiknal a szerver
       * tudja es elutasitotta), es a szoveguk is kulon -- de EGYIK SEM siker.
       */
      setError({ field: null, message: outcome.message });
    },
    onError: (cause) =>
      setError({
        field: null,
        message:
          cause instanceof Error ? cause.message : "Az eszköz nem menthető.",
      }),
  });

  if (status !== "authenticated" || !user) return <Redirect href="/login" />;
  if (!capabilities?.assetsManage) return <Redirect href="/assets" />;

  /**
   * A TERV VEGREHAJTASA. Harom eset, harom kulon valasz -- es a `dropped` a
   * legfontosabb: ott a kep a kezunkben marad, es ha hallgatnank rola, a
   * szerelo azt hinne, felment.
   */
  const kepeketElintez = async (
    outcome: SaveOutcome,
    keszult: string,
  ): Promise<{ maradjunk: boolean; message: string | null }> => {
    const terv = planPhotosAfterRecord(outcome, photos);
    if (terv.type === "none") return { maradjunk: false, message: null };
    if (terv.type === "dropped")
      return { maradjunk: false, message: terv.message };

    if (terv.type === "upload") {
      try {
        const feltoltve = await uploadAssetDocuments(terv.ownerId, {
          // A SZAMLA ES A GARANCIALEVEL AZ IRODABOL KERUL FEL; a helyszini kep
          // OTHER, ugyanugy, mint az eszkoz lapjan (`assets/[id].tsx`).
          type: "OTHER",
          files: terv.files,
        });
        return {
          maradjunk: false,
          message: `${feltoltve.length} fénykép feltöltve.`,
        };
      } catch (cause) {
        /**
         * A ROGZITES MAR FENT VAN, tehat ez nem elveszett felvitel -- de a kep
         * NEM ment fel, es EZEN A KEPERNYON KELL MARADNUNK.
         *
         * Enelkul a mondat egy mar elhagyott kepernyore kerulne: a `saved` ag
         * azonnal atlep az eszkoz lapjara, es a szerelo semmit nem latna
         * abbol, hogy a fenykepe sehol nincs. A kivalasztott kepek is
         * megmaradnak, tehat a gomb ujra megnyomhato.
         */
        return {
          maradjunk: true,
          message:
            cause instanceof Error
              ? `A rögzítés felment, a fénykép viszont nem: ${cause.message}. A képek megmaradtak, próbáld újra.`
              : "A rögzítés felment, a fénykép viszont nem. A képek megmaradtak, próbáld újra.",
        };
      }
    }

    /**
     * A CIKLUS IS KIVUL VAN (`photo-after-record.ts`), mert a KIMARADT kep az,
     * amirol hallgatni a legdragabb -- es ezen a kepernyon semmi nem merne.
     */
    return {
      maradjunk: false,
      message: describePhotoQueueing(
        await queuePhotosForRecording({
          recordingOperationId: terv.recordingOperationId,
          files: terv.files,
          createdAt: keszult,
          /**
           * A KEP AZ ESZKOZHOZ TARTOZIK. A sor a gazdabol tudja, melyik
           * vegpontra kuldje: eszkoz-dokumentum vagy munkalap-dokumentum.
           */
          enqueue: (input) => enqueuePhoto({ ...input, entityType: "asset" }),
        }),
      ),
    };
  };

  /**
   * A KEPVALASZTAS EREDMENYE. A FENYKEPEZES AZ ELSODLEGES, a galeria a
   * masodik: a szerelo a helyszinen MOST keszit kepet, nem regit keres
   * (Balazs, 2026-09-02). Ugyanaz a sorrend, mint az eszkoz lapjan.
   */
  const kepeketFelvesz = (assets: ImagePicker.ImagePickerAsset[]) => {
    const { files, skipped } = toPickedImages(assets);
    setPhotos((elozo) => {
      /**
       * UGYANAZ A FAJL KETSZER NEM KET KEP. A valaszto ugyanazt az `uri`-t
       * adja vissza, es ket azonos sor a sorban ket feltoltes lenne.
       */
      const utak = new Set(elozo.map((f) => f.uri));
      return [...elozo, ...files.filter((f) => !utak.has(f.uri))];
    });
    setPhotoNotice(
      skipped.length > 0
        ? `Kimaradt (csak JPEG és PNG megy): ${skipped.join(", ")}.`
        : null,
    );
  };

  const kepetKeszit = async () => {
    setPhotoNotice(null);
    const jog = await ImagePicker.requestCameraPermissionsAsync();
    if (!jog.granted) {
      setPhotoNotice(photoPermissionDeniedNotice("camera"));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
    });
    if (result.canceled) return;
    kepeketFelvesz(result.assets);
  };

  const kepetValaszt = async () => {
    setPhotoNotice(null);
    const jog = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!jog.granted) {
      setPhotoNotice(photoPermissionDeniedNotice("library"));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: MAX_FILES_PER_UPLOAD,
    });
    if (result.canceled) return;
    kepeketFelvesz(result.assets);
  };

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
      labelCode,
      performance,
      performanceUnitId,
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
            {/*
              LEGORDULO, NEM MINDIG NYITOTT LISTA. A partnerek szama nem
              korlatos, es egy allandoan kinyitott lista a telefonon lenyomja a
              tobbi mezot a kepernyo alja ala -- a felviteli urlapon a partner
              EGY dontes, nem bongeszes. Ugyanaz az alak, mint a munkalap-lista
              partner-szurojenel (`app/worksheets/index.tsx`).

              A VALASZTAS UTAN BECSUKODIK: enelkul a lista tovabbra is eltakarna
              a tobbi mezot, es semmi nem jelezne, hogy a valasztas megtortent.
            */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                owner
                  ? `Partner: ${owner.displayName}. Koppints a módosításhoz.`
                  : "Partner választása."
              }
              onPress={() => setOwnerPickerOpen((open) => !open)}
              style={[styles.ownerRow, owner && styles.ownerSelected]}
            >
              <Text style={styles.ownerName}>
                {owner ? owner.displayName : "Válassz partnert"}
              </Text>
              <Text style={styles.ownerMeta}>
                {owner
                  ? `${owner.type === "CUSTOMER" ? "Vevő" : "Partner"} · ${owner.code}`
                  : "Koppints a listához"}
              </Text>
            </Pressable>
            <FieldError error={error} field="owner" />
            {!ownerPickerOpen ? null : (
              <>
                <TextInput
                  value={ownerSearch}
                  onChangeText={setOwnerSearch}
                  placeholder="Szerviz partner keresése"
                  placeholderTextColor="#668798"
                  style={styles.input}
                />
                {ownersQuery.isPending ? (
                  <ActivityIndicator color="#52d6c7" />
                ) : null}
                {/*
                  A MENTETT LISTA KIMONDVA. A valasztas itt IRASSA valik: egy
                  idokozben megszunt partner a masolatban meg ott all, es a
                  felvitel a szerveren bukna el, jóval kesobb.
                */}
                {ownersNotice ? (
                  <View style={styles.cacheNotice}>
                    <Text style={styles.cacheNoticeTitle}>
                      {ownersNotice.title}
                    </Text>
                    <Text style={styles.cacheNoticeBody}>
                      {ownersNotice.message}
                    </Text>
                  </View>
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
                        setOwnerPickerOpen(false);
                      }}
                      style={[
                        styles.ownerRow,
                        selected && styles.ownerSelected,
                      ]}
                    >
                      <Text style={styles.ownerName}>{item.displayName}</Text>
                      <Text style={styles.ownerMeta}>
                        {item.type === "CUSTOMER" ? "Vevő" : "Partner"} ·{" "}
                        {item.code}
                        {item.outsideServiceScope
                          ? " · nem szerviz partner"
                          : ""}
                      </Text>
                    </Pressable>
                  );
                })}
              </>
            )}
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
              {/*
                A MENTETT HELYSZINEK KIMONDVA. A regi szoveg ("nem tolthetok
                be") 2026-09-03-ig IGAZ volt, mert nem volt masolat -- most van,
                tehat a mondat is mast mond: ha van mentett lista, abbol lehet
                valasztani, es a sav megmondja, milyen regi.
              */}
              {unitsNotice ? (
                <View style={styles.cacheNotice}>
                  <Text style={styles.cacheNoticeTitle}>
                    {unitsNotice.title}
                  </Text>
                  <Text style={styles.cacheNoticeBody}>
                    {unitsNotice.message}
                  </Text>
                </View>
              ) : null}
              {!unitsQuery.isPending && units.options.length === 0 ? (
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
              {/*
                LEPCSOS VALASZTO: egy szint egy sor. A teljes utas lista a
                telefonon hosszu, es valasztas kozben nem latszik, hol tart az
                ember -- itt minden szinten csak nehany testver all.

                KOZOS PELDANY A SZERKESZTO KEPERNYOVEL (2026-09-16). Korabban
                ez a blokk CSAK itt allt, es a szerkeszton a regi, mindent
                egyszerre kiterito alak maradt.
              */}
              <UnitPicker
                rows={unitRows}
                value={unitId}
                onChange={setUnitId}
                open={unitPickerOpen}
                onToggle={() => setUnitPickerOpen((open) => !open)}
                hiddenCount={units.hiddenCount}
              />
            </Section>
          ) : null}

          <Section title="Eszközadatok">
            <Field label="Eszköz neve *" value={name} onChangeText={setName} />
            <FieldError error={error} field="name" />
            <Text style={styles.label}>Típus</Text>
            {/*
              LEGORDULO, MINT A PARTNERNEL. Balazs kerese (2026-09-02): "A
              Partner valasztas legorduloje jo, de a tobbi... Ugyanugy kerem
              mint a partnert."

              ES AZ INDOK ITT MAS, MINT A PARTNERNEL -- ezt erdemes kiirni,
              mert kulonben a kovetkezo olvaso a partner indokat vetiti ide. Ott
              a lista KORLATLAN, es egy nyitott lista lenyomja a tobbi mezot.
              Itt ot rogzitett ertek all, tehat nem a hossz a baj: a
              KOVETKEZETESSEG. Egy urlap, amin harom valaszto haromfelekeppen
              nez ki, magaban is az a panasz, amit Balazs leirt.
            */}
            <CollapsedPicker
              summary={
                kinds.find((k) => k.value === kind)?.label ?? "Válassz típust"
              }
              hint="Koppints a listához"
              label="Típus választása"
              open={kindPickerOpen}
              onToggle={() => setKindPickerOpen((open) => !open)}
            >
              <View style={styles.kindGrid}>
                {kinds.map((item) => (
                  <Pressable
                    key={item.value}
                    onPress={() => {
                      setKind(item.value);
                      setKindPickerOpen(false);
                    }}
                    style={[
                      styles.kindButton,
                      kind === item.value && styles.kindSelected,
                    ]}
                  >
                    <Text style={styles.kindText}>{item.label}</Text>
                  </Pressable>
                ))}
              </View>
            </CollapsedPicker>
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
              label="Partner azonosítója"
              value={inventoryNumber}
              onChangeText={setInventoryNumber}
            />
            <PerformanceField
              value={performance}
              unitId={performanceUnitId}
              units={performanceUnitsQuery.data?.items ?? []}
              onChangeValue={setPerformance}
              onChangeUnit={setPerformanceUnitId}
            />
            <LabelCodeField
              value={labelCode}
              onChange={setLabelCode}
              scanner={scanner}
            >
              <Text style={styles.scanNote}>
                A MI matricánk, nem a partneré. A fenti mező a partner saját
                azonosítója; ez az előre nyomtatott, általunk kiadott kód.
              </Text>
            </LabelCodeField>
            <FieldError error={error} field="labelCode" />
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
          <Section title="Fénykép">
            {/*
              A KEP A MENTES ELOTT KESZUL, ES EZ NEM KENYELMI KERDES. A
              pinceben a mentes nem visz sehova: a felvitel a sorba kerul, az
              eszkoz lapja meg nem letezik, tehat nincs az a keperno, ahol a
              szerelo utolag ratenne a kepet. Ha itt nem lehet fenykepezni, a
              helyszinen SEHOL nem lehet.
            */}
            <Text style={styles.hint}>
              A fénykép a rögzítés UTÁN megy fel, magától. Térerő nélkül a
              telefonon vár, ugyanabban a sorban, mint a felvitel.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={kepetKeszit}
              style={styles.scanButton}
            >
              <Text style={styles.scanButtonText}>Fénykép készítése</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={kepetValaszt}
              style={styles.scanButton}
            >
              <Text style={styles.scanButtonText}>Kép a galériából</Text>
            </Pressable>
            {photos.length > 0 ? (
              <View style={styles.photoRow}>
                <Text style={styles.dateValue}>
                  {photos.length} fénykép a felvitelhez
                </Text>
                <Pressable onPress={() => setPhotos([])}>
                  <Text style={styles.clearDate}>Képek törlése</Text>
                </Pressable>
              </View>
            ) : null}
            {photoNotice ? (
              <Text style={styles.hint}>{photoNotice}</Text>
            ) : null}
          </Section>

          {error ? <Text style={styles.error}>{error.message}</Text> : null}
          {/*
            A SORBA KERULT FELVITEL KULON SAVOT KAP, NEM PIROSAT.
            A rogzites megtortent, csak meg a telefonon var. Ugyanabban a piros
            dobozban a kollega elveszettnek hinne, es ujra felvinne.
          */}
          {queued ? <Text style={styles.queued}>{queued}</Text> : null}

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
      {/*
        A KAMERA RATETKENT, AZ URLAP FOLOTT. Nincs navigacio, tehat a mar
        kitoltott mezok megmaradnak -- ez volt az egesz alak indoka.
      */}
      {scanner.overlay}
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
  /**
   * A MATRICAKOD NAGYBETUS. A tarolt alak csak nagybetut fogad, es a
   * normalizalas amugy is felfele alakit -- de ha a billentyuzet kisbetut
   * kinal, a szerelo azt LATJA beirni, amit a mentes utana atir. A ket
   * kepernyo-kep kozotti kulonbseg nem hiba, de bizalmatlansagot szul.
   */
  autoCapitalize?: "none" | "characters";
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        autoCapitalize={props.autoCapitalize}
        value={props.value}
        onChangeText={props.onChangeText}
        keyboardType={props.keyboardType}
        placeholderTextColor="#668798"
        style={styles.input}
      />
    </View>
  );
}

/**
 * BECSUKOTT VALASZTO, EGY OSSZEGZO SORRAL.
 *
 * A partner-valaszto alakjat altalanositja: egy sor, ami MEGMONDJA a jelenlegi
 * valasztast, es koppintasra kinyilik. Balazs kerese (2026-09-02): a felviteli
 * urlapon minden valaszto igy nezzen ki.
 *
 * A KOMPONENS NEM DONTI EL, MIKOR CSUKODIK BE -- azt a hivo mondja meg. A tipusnal
 * a valasztas egy lepes, tehat becsukodik; a helyszinnel a koppintas egyben
 * lefele lepes is, tehat nyitva marad. Egy komponens, ami ezt magatol dontene el,
 * a ket eset kozul az egyiket elrontana.
 */
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#071827" },
  flex: { flex: 1 },
  fieldError: { color: "#fecaca", fontSize: 12, fontWeight: "700" },
  scanNote: { color: "#789cad", fontSize: 12, lineHeight: 17 },
  scanButton: {
    backgroundColor: "#0f3346",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  scanButtonText: { color: "#52d6c7", fontWeight: "800" },
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
  /** Nem piros: a felvitel megvan, csak var. Lasd a kiiras helyet. */
  queued: {
    color: "#e6d5b0",
    backgroundColor: "#3a2a12",
    borderColor: "#8a6a2a",
    borderWidth: 1,
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
  cacheNotice: {
    backgroundColor: "#0b2f3f",
    borderRadius: 10,
    gap: 4,
    marginTop: 8,
    padding: 12,
  },
  cacheNoticeTitle: { color: "#f4fbff", fontSize: 13, fontWeight: "900" },
  cacheNoticeBody: { color: "#a9c4d1", fontSize: 12, lineHeight: 17 },
  photoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
