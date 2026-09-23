import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
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
  listAssetCategories,
  listAssetFunctions,
  updateAsset,
  type AssetDetail,
} from "@/lib/api/assets";
import { listPartnerUnits } from "@/lib/api/partners";
import {
  listPerformanceUnits,
  type UnitOfMeasureRow,
} from "@/lib/api/units-of-measure";
import {
  assetEditFormFrom,
  baseValuesFor,
  buildAssetPatch,
  assetLabelEditProblem,
  assetPerformanceEditProblem,
  assetVolumeEditProblem,
  assetPowerConsumptionEditProblem,
  hasAssetChanges,
  PERFORMANCE_PROBLEM_MESSAGES,
  type AssetEditForm,
  type EditableAsset,
} from "@/lib/assets/asset-edit";
import { OfflineNoticeCard } from "@/components/offline/OfflineNoticeCard";
import {
  readCachedAsset,
  rememberAssetDetail,
} from "@/lib/offline/asset-cache";
import { readCachedPartnerUnits } from "@/lib/offline/asset-form-cache";
import { describeOfflineEditNotice } from "@/lib/offline/offline-notice";
import { ASSET_CRITICALITY_OPTIONS } from "@/lib/assets/asset-criticality";
import { ASSET_STATUS_OPTIONS } from "@/lib/assets/asset-status";
import {
  MATRICA_ALAK_UZENET,
  VOLUME_ALAK_UZENET,
  POWER_CONSUMPTION_ALAK_UZENET,
} from "@/lib/assets/asset-create";
import { describeAssetUpdateWrite } from "@/lib/assets/offline-edit";
import { ApiError } from "@/lib/api/client";
import { assetUpdateOperationId } from "@/lib/offline/sync-queue";
import { enqueueAssetUpdate } from "@/lib/offline/queue-store";
import { saveOrQueue, type SaveOutcome } from "@/lib/offline/save-or-queue";
import { UnitPicker } from "@/components/assets/unit-picker";
import { matricaElotoltes } from "@/lib/assets/matrica-elotoltes";
import { CategoryPicker } from "@/components/assets/category-picker";
import { FunctionPicker } from "@/components/assets/function-picker";
import {
  LabelCodeField,
  useLabelScanner,
} from "@/components/assets/label-code-field";
import { PerformanceField } from "@/components/assets/performance-field";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";

const TEXT_FIELDS: {
  key: keyof AssetEditForm & string;
  label: string;
  multiline?: boolean;
}[] = [
  { key: "manufacturer", label: "Gyártó" },
  { key: "model", label: "Modell" },
  { key: "serialNumber", label: "Sorozatszám" },
  { key: "inventoryNumber", label: "Partner azonosítója" },
  /**
   * A FOGYASZTAS MOSTANTOL OSSZEADHATO SZAM, tehat NEM ide kerul: annak
   * decimalis billentyuzete es sajat alak-ellenorzese van, lasd lejjebb, a
   * terfogat melletti bespoke mezot. Kanban 8c77cf3e, 2026-09-23.
   *
   * A tabla EREDETI cellaja (`powerConsumptionRaw`) viszont szabad szoveg,
   * tehat AZ illik a generikus mintaba.
   */
  { key: "powerConsumptionRaw", label: "Fogyasztás (eredeti bejegyzés)" },
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
  const params = useLocalSearchParams<{
    id: string | string[];
    labelCode?: string | string[];
  }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  /**
   * A BEOLVASOTT SZABAD MATRICAKOD, HA A SZERELO ONNAN ERKEZETT.
   *
   * A FEL 2 folyamat kuldi ide: a beolvasas utan a szerelo a „hozzaadas
   * meglevo eszkozhoz" gombot valasztotta, kikereste az eszkozt, es a kod
   * az utvonalon jon vele.
   */
  const utvonalKod = Array.isArray(params.labelCode)
    ? params.labelCode[0]
    : params.labelCode;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;

  const query = useQuery({
    queryKey: ["service-asset", id],
    queryFn: () => getAsset(id!),
    enabled: status === "authenticated" && Boolean(id),
  });

  /**
   * A MENTETT MASOLAT, ES EZ A KEPERNYO EDDIG NEM OLVASTA.
   *
   * === A LANC FELIG ALLT ===
   *
   * Az adatlap MAR eltárolja a teljes lapot (`rememberAssetDetail`), es olvassa
   * is offline. A szerkeszto viszont CSAK a halozatot hivta: a szerelo
   * megnyitotta az eszkozt, koppintott a Szerkesztesre, es a pinceben ez a lap
   * nem toltott be -- pedig az adat masodpercekkel korabban rakerult a
   * telefonra. A MENTES mar sorba ment (#547), a BETOLTES nem.
   *
   * === MIERT MOST BIZTONSAGOS, ES KORABBAN MIERT NEM VOLT AZ ===
   *
   * A masolatbol inditott szerkesztes ELAVULT alapallapotrol indul. 2026-09-04
   * delelottjeig ez azt jelentette volna, hogy a mentes SOR-szintu utkozesbe
   * fut, es a szerelo munkaja bent ragad. A lanc azota kezeli: a szerver
   * MEZONKENT utkoztet (#541), a sor viszi a szerkesztest (#547), es az elakadt
   * modositasnal a szerelo mezonkent eldonti, melyik ertek maradjon (#554).
   *
   * Vagyis az elavult alap ma KEZELT allapot, nem kockazat -- es ezt a sav ki
   * is mondja a szerelonek.
   */
  const cached = useQuery({
    queryKey: ["offline-asset", id],
    queryFn: () => readCachedAsset(id!),
    enabled: status === "authenticated" && Boolean(id),
  });

  const [form, setForm] = useState<AssetEditForm | null>(null);
  /**
   * A SORBA TETEL ES A VESZTES KULON ALLAPOT, MERT KULON SZINU.
   *
   * A varakozo modositas NEM hiba: elmentodott, csak nem a szerveren. Az
   * elveszett viszont az, es ha egy kozos „uzenet" mezoben allna, ugyanabban a
   * dobozban jelenne meg a ketto.
   */
  const [queued, setQueued] = useState<string | null>(null);
  const [lost, setLost] = useState<string | null>(null);
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null);
  /**
   * A MONDAT A MATRICA-MEZO MELLETT, ha a beolvasott kod MAS, mint ami az
   * eszkozon all. `null`, ha nincs mit mondani -- nem ures szoveg: az helyet
   * foglalna a kepernyon.
   */
  const [matricaUzenet, setMatricaUzenet] = useState<string | null>(null);
  /**
   * A HELYSZIN-VALASZTO NYITVA VAN-E.
   *
   * CSUKOTTAN INDUL, ugyanugy, mint a felviteli urlapon: a szerkeszto tobbsege
   * NEM a helyszint jon javitani, es egy mindig nyitott fa lenyomja a tobbi
   * mezot a kepernyo alja ala. A csukott sor kiirja a teljes utat, tehat aki
   * csak ellenorizni akarta, azonnal latja.
   */
  const [unitPickerOpen, setUnitPickerOpen] = useState(false);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>(
    [],
  );
  /**
   * A KATEGORIA-LISTA BETOLTESE -- ES A HIBAJA NEM ALLITJA MEG A SZERKESZTEST.
   *
   * Ugyanaz a jegyzet all a felviteli kepernyon: ha a lista nem jon (terero
   * nincs, a szerver nem valaszol), a valaszto URES marad, es minden mas mezo
   * menthető.
   *
   * ES ITT VAN EGY TOBBLET, AMI A FELVITELEN NINCS: a MOSTANI kategoria neve a
   * MENTETT LAPBOL jon (`asset.category`), nem ebbol a listabol. Terero nelkul
   * tehat a szerelo akkor is LATJA, mi all az eszkozon -- csak masikat nem tud
   * valasztani. A ket dolog kulon romlik el, es ez szandekos.
   */
  useEffect(() => {
    if (status !== "authenticated") return;
    let elo = true;
    void listAssetCategories()
      .then((valasz) => {
        if (elo) setCategories(valasz.items);
      })
      .catch(() => {
        /* szandekosan nema: lasd a fenti jegyzetet */
      });
    return () => {
      elo = false;
    };
  }, [status]);
  const [functionPickerOpen, setFunctionPickerOpen] = useState(false);
  const [functions, setFunctions] = useState<{ id: string; name: string }[]>(
    [],
  );
  /**
   * A FUNKCIO-LISTA UGYANUGY, ES FUGGETLENUL A KATEGORIATOL toltodik be --
   * lasd a fenti jegyzetet. Kanban 68add892, 2026-09-22.
   */
  useEffect(() => {
    if (status !== "authenticated") return;
    let elo = true;
    void listAssetFunctions()
      .then((valasz) => {
        if (elo) setFunctions(valasz.items);
      })
      .catch(() => {
        /* szandekosan nema: lasd a fenti jegyzetet */
      });
    return () => {
      elo = false;
    };
  }, [status]);
  /**
   * A BEOLVASO UGYANAZ, MINT A FELVITELI KEPERNYON, es ez nem kenyelem: Balazs
   * kifejezetten a BEFOTOZAST kerte a telefonra (2026-09-16 10:42), a webre
   * pedig csak a beirast. A kozos allvany azt zarja ki, hogy a ket kepernyo
   * kulon romoljon el.
   *
   * A `setForm` ag a `form` meglete miatt ovatos: a kepernyo a betoltes elott
   * `null`-lal all, es egy beolvasas ilyenkor nem irhat bele.
   */
  const scanner = useLabelScanner((kod) =>
    setForm((elozo) => (elozo ? { ...elozo, labelCode: kod } : elozo)),
  );

  /*
   * A HELYSZÍNEK CSAK SZERVIZ PARTNER ESZKÖZÉNÉL. Vevő tulajdonosnál nincs mit
   * betölteni: ott a cím a pontosítás, és a szerver az alegységet el is
   * utasítja.
   */
  /**
   * AMIBOL A KEPERNYO DOLGOZIK: a friss lap, ha van, kulonben a mentett masolat.
   *
   * A SORREND NEM MINDEGY. A halozati valasz nyer, mert az a mai allapot; a
   * masolat csak akkor lep be, ha nincs mas. Forditva egy meglevo terero
   * mellett is regi ertekeket szerkesztenenk.
   */
  const betoltott = query.data ?? cached.data?.detail ?? null;
  const masolatbol = !query.data && betoltott !== null;

  /**
   * AKI IDE ERKEZIK ELOSZOR (peldaul ertesitesbol), ANNAK IS LEGYEN MASOLATA.
   * Az adatlap ugyanezt teszi; e nelkul a szerkesztobol indulo szerelo a
   * kovetkezo alkalommal ures gyorsitotarat talalna.
   */
  useEffect(() => {
    if (!query.data) return;
    void rememberAssetDetail(query.data);
  }, [query.data]);

  const unitsQuery = useQuery({
    queryKey: ["partner-units", betoltott?.owner.id],
    queryFn: () => listPartnerUnits(betoltott!.owner.id),
    enabled: status === "authenticated" && betoltott?.owner.type === "SUPPLIER",
  });

  /**
   * A HELYSZINEK MENTETT LISTAJA. A felviteli keperno mar hasznalja; itt a
   * hianya NEM allitja meg a szerkesztest, csak a valaszto marad ures -- es
   * akkor a szerelo a tobbi mezot attol meg javithatja.
   */
  /**
   * A TELJESITMENY-EGYSEGEK. Csak az AKTIVAK jonnek a listaban -- az eszkozon
   * MAR allo egyseget a valasz hozza magaval (`performanceUnit`), es alabb
   * hozzatesszuk. Enelkul egy kivezetett egyseg eltunne a valasztobol, a
   * szerelo pedig nem latna, mi all a gepen.
   */
  const performanceUnitsQuery = useQuery({
    queryKey: ["performance-units"],
    queryFn: listPerformanceUnits,
    enabled: status === "authenticated",
  });

  const cachedUnits = useQuery({
    queryKey: ["offline-partner-units", betoltott?.owner.id],
    queryFn: () => readCachedPartnerUnits(betoltott!.owner.id),
    enabled: status === "authenticated" && betoltott?.owner.type === "SUPPLIER",
  });

  // Fills the form when the asset arrives, and again when a reload brings
  // back a different version - after a conflict, say. Adjusting during
  // render rather than in an effect is deliberate: an effect would let one
  // frame paint with the previous asset's values in the fields.
  //
  // Keyed on `updatedAt`, so once the form is filled, editing owns it. A
  // background refetch that returns the same version will not wipe out
  // what somebody is halfway through typing.
  /**
   * AZ ELOTOLTES UGYANEBBEN AZ AGBAN ALL, ES EZ NEM STILUS.
   *
   * MERVE (a c63638c9 kartya 4888-as kommentje): ez a sor a formot UJRAEPITI a
   * szerverrol, valahanyszor a betoltott verzio valtozik. Ha a beolvasott kod
   * elotoltese egy KULON helyen (peldaul sajat `useEffect`-ben) allna be, ez a
   * sor CSENDBEN letorolne. Gyors halozaton a sorrend kedvezo lehet, es a hiba
   * nem jelentkezik; lassun a szerelo beolvassa a kodot, megnyilik a
   * szerkeszto, es a mezo URES.
   *
   * Ezert az elotoltes UGYANARRA A KULCSRA (`loadedFrom`) kotve tortenik: ami
   * a szerverrol jon, es ami az utvonalrol, EGYSZERRE all ossze.
   *
   * A DONTES maga tiszta fuggvenyben all (`matricaElotoltes`), mert a mobilon
   * nincs komponens-teszt -- es ott all a magyarazat is, hogy egy MAR ALLO
   * matricat miert nem irunk felul csendben.
   */
  if (betoltott && loadedFrom !== betoltott.updatedAt) {
    setLoadedFrom(betoltott.updatedAt);
    const alap = assetEditFormFrom(editable(betoltott));
    const elotoltes = matricaElotoltes({
      eszkozKodja: betoltott.labelCode,
      utvonalKod,
    });
    setForm({ ...alap, labelCode: elotoltes.mezoErteke });
    setMatricaUzenet(elotoltes.uzenet ?? null);
  }

  const save = useMutation({
    mutationFn: async (): Promise<SaveOutcome> => {
      if (!betoltott || !form) throw new Error("A szerkesztés nem áll készen.");
      /**
       * AZ ELOZO KOR UZENETE ELTUNIK, MIELOTT AZ UJ ELINDUL. E nelkul egy
       * sikeres masodik probalkozas mellett is ott allna a „vár feltöltésre"
       * doboz, es a szerelo azt hinne, hogy megint nem ment fel.
       */
      setQueued(null);
      setLost(null);
      /**
       * A ROSSZ ALAK ITT AKAD EL, NEM A SZERVEREN -- ES EZ AZ OFFLINE SOR MIATT SZAMIT.
       *
       * Kapcsolat nelkul a mentes SORBA kerul, nem a szerverhez: egy hibas kod
       * igy csak a sor kiuritesekor bukna el, akar orakkal kesobb, amikor a
       * szerelo mar nincs a gepnel. A felviteli kepernyo eddig is itt, a keres
       * ELOTT dontott -- ugyanazzal a kozos fuggvennyel es ugyanezzel a
       * mondattal.
       */
      if (assetLabelEditProblem(form)) throw new Error(MATRICA_ALAK_UZENET);
      /**
       * A TELJESITMENY-PAR UGYANITT, ES UGYANAZERT: offline a mentes SORBA
       * kerul, tehat egy fel par csak a sor kiuritesekor bukna el -- orakkal
       * kesobb, amikor a szerelo mar nincs a gepnel.
       *
       * A MONDAT MEGNEVEZI A HIANYZO FELET: a ket eset ket kulon teendo
       * (egyseget valasztani kontra szamot irni).
       */
      const teljesitmenyBaj = assetPerformanceEditProblem(form);
      if (teljesitmenyBaj)
        throw new Error(PERFORMANCE_PROBLEM_MESSAGES[teljesitmenyBaj]);
      /**
       * A TERFOGAT ALAKJA UGYANITT, ES UGYANAZERT -- de par nelkul, lasd az
       * `assetVolumeEditProblem` fejleceit.
       */
      if (assetVolumeEditProblem(form)) throw new Error(VOLUME_ALAK_UZENET);
      /**
       * A FOGYASZTAS ALAKJA UGYANITT, ES UGYANAZERT -- lasd az
       * `assetPowerConsumptionEditProblem` fejleceit. Kanban 8c77cf3e,
       * 2026-09-23.
       */
      if (assetPowerConsumptionEditProblem(form))
        throw new Error(POWER_CONSUMPTION_ALAK_UZENET);
      const asset = betoltott;
      const patch = buildAssetPatch(editable(asset), form);
      /**
       * A SZERVER ELUTASITASAT AZ EREDETI HIBAVAL DOBJUK TOVABB, NEM A
       * SZOVEGEVEL.
       *
       * A `saveOrQueue` a `rejected` agon csak a MONDATOT adja vissza -- a
       * kivetel maga elveszik. Ezen a kepernyon viszont a 409-nek SAJAT
       * kartyaja van („Valaki más közben módosította"), es azt a `isConflict`
       * a hiba `status` mezojebol ismeri fel. Egy sima `Error` mellett a
       * mezo-szintu utkozes ugyanugy nezne ki, mint egy elgepeles, es a
       * szerelo nem kapna Ujratoltés gombot.
       */
      let utolsoHiba: unknown = null;
      const outcome = await saveOrQueue({
        save: async () => {
          try {
            return await updateAsset(asset.id, patch);
          } catch (cause) {
            utolsoHiba = cause;
            throw cause;
          }
        },
        enqueue: () =>
          enqueueAssetUpdate({
            id: assetUpdateOperationId({
              assetId: asset.id,
              expectedUpdatedAt: patch.expectedUpdatedAt,
            }),
            assetId: asset.id,
            /**
             * AZ ALAPERTEK IS BEKERUL, ES CSAK ITT LEHET FELVENNI: a feloldo
             * keperno ebbol tudja megkulonboztetni, hogy MAS is hozzanyult-e a
             * mezohoz, vagy egyedul a szerelo irta at. A sorba tetel utan ez az
             * allapot mar sehol nincs meg.
             */
            payload: {
              assetName: asset.name,
              patch,
              base: baseValuesFor(editable(asset), patch),
            },
            createdAt: new Date().toISOString(),
          }),
        statusOf: (cause) => (cause instanceof ApiError ? cause.status : null),
        describeWrite: describeAssetUpdateWrite,
      });
      if (outcome.type === "rejected")
        throw utolsoHiba ?? new Error(outcome.message);
      return outcome;
    },
    onSuccess: async (outcome) => {
      if (outcome.type === "queued") {
        /**
         * A SORBA TETT MODOSITASNAL NEM FRISSITUNK GYORSITOTARAT, ES EZ NEM
         * FELEDEKENYSEG.
         *
         * A szerveren MEG a regi adat all: ha a helyi masolatot mar a javitott
         * ertekre allitanank, a szerelo ket kulonbozo igazsagot latna
         * (telefonon az uj, az irodaban a regi), es semmi nem mondana meg,
         * melyik ment fel. A sor-kepernyo az egyetlen hely, ahol ez a kulonbseg
         * lathato -- es a mondat is oda mutat.
         */
        setQueued(outcome.message);
        return;
      }
      if (outcome.type === "lost") {
        setLost(outcome.message);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["service-asset", id] });
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

  if ((query.isPending && !betoltott) || !form) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.card}>
          <ActivityIndicator color="#52d6c7" />
          <Text style={styles.cardText}>Eszköz betöltése…</Text>
        </View>
      </SafeAreaView>
    );
  }

  /**
   * IDE MAR CSAK AKKOR JUTUNK, HA A MASOLAT SINCS MEG. Korabban a halozati
   * hiba maga elvitte a kepernyot, akkor is, ha a lap ott volt a telefonon.
   */
  if (!betoltott) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Nem sikerült betölteni</Text>
          <Text style={styles.cardText}>
            {query.error instanceof Error
              ? `${query.error.message} Mentett másolat sincs erről az eszközről: nyisd meg egyszer térerővel, és utána offline is szerkeszthető.`
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

  const asset = betoltott;
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
        {/*
          A SAV A LAP TETEJEN ALL, ES NEM A DEVNOTE-BAN: a szerelo a pinceben nem
          fog jegyzetet olvasni (acrobot kikotese, 2026-09-04). Egy elavult
          ertek, amirol nem tudja, hogy elavult, rosszabb, mint egy ures
          keperno -- az uresnel tudja, hogy nincs adata.
        */}
        {masolatbol ? (
          <OfflineNoticeCard
            notice={describeOfflineEditNotice({
              online: false,
              syncedAt: cached.data?.syncedAt ?? null,
              now: new Date(),
            })!}
          />
        ) : null}
        <View style={styles.hero}>
          <Text style={styles.assetNumber}>{asset.assetNumber}</Text>
          <Text style={styles.assetName}>{asset.name}</Text>
        </View>

        {/*
          A VARAKOZO MODOSITAS SAJAT DOBOZT KAP, ES NEM LEPUNK VISSZA VELE.
          A felviteli kepernyo ugyanigy marad allva a `queued` agon: ha
          visszalepnenk, a mondat egy mar elhagyott kepernyore kerulne, es a
          szerelo semmit nem latna abbol, hogy az iroda meg a REGI adatot latja.
        */}
        {queued ? (
          <View style={styles.queuedCard}>
            <Text style={styles.errorTitle}>A módosítás vár feltöltésre</Text>
            <Text style={styles.errorText}>{queued}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.back()}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>Rendben</Text>
            </Pressable>
          </View>
        ) : null}

        {lost ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>A módosítás nem mentődött el</Text>
            <Text style={styles.errorText}>{lost}</Text>
          </View>
        ) : null}

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
          options={ASSET_CRITICALITY_OPTIONS}
          value={form.criticality}
          onChange={(value) => setForm({ ...form, criticality: value })}
        />

        {/*
          KATEGORIA. A telefonon eddig FELVINNI lehetett (a felviteli urlapon
          van valaszto), MEGVALTOZTATNI nem -- egy mezo, amit felvinni lehet es
          javitani nem, egy elgepeles utan zsakutca. Ugyanaz az indok, amiert a
          helyszin 2026-08-27-en bekerult ide.

          MINDEN TULAJDONOSNAL LATSZIK, ellentetben a helyszinnel: a kategoria
          torzsadat, ami minden eszkozon ertelmes. A helyszint a szerver vevo
          tulajdonosnal elutasitja, a kategoriat nem.

          A MOSTANI ERTEK AKKOR IS KIIRODIK, HA KIVEZETTEK -- a valaszto ezt a
          `currentName` mezoben kapja. Enelkul a csukott sor „Nincs megadva"
          feliratot mutatna egy olyan eszkozon, aminek VAN kategoriaja, es a
          szerelo vakon irna felul. Ezt a hibat a matricakodnal mar egyszer
          megfizettuk.
        */}
        <View style={styles.field}>
          <Text style={styles.label}>Kategória</Text>
          <CategoryPicker
            options={categories}
            value={form.categoryId}
            currentName={asset.category}
            open={categoryPickerOpen}
            onChange={(categoryId) => {
              setForm({ ...form, categoryId });
              setCategoryPickerOpen(false);
            }}
            onToggle={() => setCategoryPickerOpen((nyitva) => !nyitva)}
          />
        </View>

        {/*
          FUNKCIO -- FUGGETLEN A KATEGORIATOL, SZO SZERINT UGYANAZ A MINTA.
          Kanban 68add892, 2026-09-22.
        */}
        <View style={styles.field}>
          <Text style={styles.label}>Funkció</Text>
          <FunctionPicker
            options={functions}
            value={form.functionId}
            currentName={asset.function}
            open={functionPickerOpen}
            onChange={(functionId) => {
              setForm({ ...form, functionId });
              setFunctionPickerOpen(false);
            }}
            onToggle={() => setFunctionPickerOpen((nyitva) => !nyitva)}
          />
        </View>

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
            {/*
              UGYANAZ A VALASZTO, MINT A FELVITELI URLAPON, es mostantol
              ugyanaz a PELDANY is. Itt korabban a regi alak allt: MINDEN
              szintet egyszerre kiteritve, teljes szelessegu sorokkent -- egy
              par szintes fanal ez egy egesz kepernyo, es valasztas kozben nem
              latszik, hol tart az ember. Balazs kepernyofotokon mutatta meg a
              kulonbseget (2026-09-16 10:41, Discord, mobilalkalmazas szal).

              A "NINCS MEGADVA" SOR ELTUNT, ES EZ NEM VESZTESEG: a lepcsos
              valaszton a legfelso mar eldontott lepesre koppintva ures lesz a
              helyszin, tehat a torles utja megvan -- csak nem egy kulon sor
              viszi.
            */}
            <UnitPicker
              rows={unitsQuery.data?.items ?? cachedUnits.data?.items ?? []}
              value={form.unitId}
              onChange={(unitId) => setForm({ ...form, unitId })}
              open={unitPickerOpen}
              onToggle={() => setUnitPickerOpen((nyitva) => !nyitva)}
            />
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

        {/*
          A VALASZTHATO EGYSEGEK KOZE BEKERUL AZ IS, AMI MAR AZ ESZKOZON ALL.
          A valaszto az AKTIVAKAT kinalja; ha az eszkozon egy azota KIVEZETETT
          egyseg all, es a lista nem tartalmazna, a szerelo ures valasztot
          latna egy kitoltott mezo mellett -- es a mentes elbukna, latszolag
          ok nelkul.
        */}
        <PerformanceField
          value={form.performance}
          unitId={form.performanceUnitId}
          units={teljesitmenyEgysegek(
            performanceUnitsQuery.data?.items ?? [],
            betoltott?.performanceUnit,
          )}
          onChangeValue={(value) => setForm({ ...form, performance: value })}
          onChangeUnit={(unitId) =>
            setForm({ ...form, performanceUnitId: unitId })
          }
          editable={!save.isPending}
        />

        {/*
          A TERFOGAT -- FUGGETLEN A TELJESITMENYTOL, NINCS PAR. Kanban
          8c77cf3e, 2026-09-23. A `TEXT_FIELDS` generikus mintaja nem
          tamogat decimalis billentyuzetet, ezert ez bespoke mezo.
        */}
        <View style={styles.field}>
          <Text style={styles.label}>Térfogat (m³)</Text>
          <TextInput
            accessibilityLabel="Térfogat (m³)"
            value={form.volume}
            onChangeText={(value) => setForm({ ...form, volume: value })}
            keyboardType="decimal-pad"
            style={styles.input}
            placeholderTextColor="#5c7e92"
            placeholder="Nincs megadva"
            editable={!save.isPending}
          />
        </View>

        {/*
          A FOGYASZTAS -- OSSZEADHATO SZAM, ugyanazert bespoke, mint a
          terfogat. Az EREDETI cella (powerConsumptionRaw) a TEXT_FIELDS
          generikus listajaban all, lasd feljebb. Kanban 8c77cf3e,
          2026-09-23.
        */}
        <View style={styles.field}>
          <Text style={styles.label}>Fogyasztás (kW)</Text>
          <TextInput
            accessibilityLabel="Fogyasztás (kW)"
            value={form.powerConsumption}
            onChangeText={(value) =>
              setForm({ ...form, powerConsumption: value })
            }
            keyboardType="decimal-pad"
            style={styles.input}
            placeholderTextColor="#5c7e92"
            placeholder="Nincs megadva"
            editable={!save.isPending}
          />
        </View>

        <LabelCodeField
          value={form.labelCode}
          onChange={(value) => setForm({ ...form, labelCode: value })}
          scanner={scanner}
          editable={!save.isPending}
        >
          {/*
            A BEOLVASOTT KOD ES A MEGLEVO KOZOTTI KULONBSEG KIMONDVA.
            Csak akkor all itt, ha TENYLEG mas a ketto -- a `matricaElotoltes`
            dönti el, es a fuggveny fejlece leirja, miert nem irjuk felul
            csendben a mar allo matricat.
          */}
          {matricaUzenet ? (
            <Text style={styles.matricaFigyelmeztetes}>{matricaUzenet}</Text>
          ) : null}
          <Text style={styles.hint}>
            A MI matricánk, nem a partneré. Ha már áll rajta kód, az itt
            látszik: másikat beírva a régi visszakerül a szabad készletbe. A
            mező kiürítése nem szedi le a matricát.
          </Text>
        </LabelCodeField>

        <Text style={styles.hint}>
          A partner és a szülőeszköz módosítása a webes felületen történik.
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
      {scanner.overlay}
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
  /*
    A FIGYELMEZTETES SZINE ELTER A SIMA SUGOTOL: amit itt irunk, az nem
    magyarazat, hanem egy KULONBSEG, amirol dontenie kell.
  */
  matricaFigyelmeztetes: {
    color: "#ffd479",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
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
  /*
    A VARAKOZO MODOSITAS NEM PIROS. A javitas elmentodott, csak nem a
    szerveren -- egy hibaszinu doboz azt mondana, hogy elveszett, es a szerelo
    ujra beirna mindent.
  */
  queuedCard: {
    backgroundColor: "#23383a",
    borderColor: "#2f6f6a",
    borderRadius: 14,
    borderWidth: 1,
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

/**
 * A VALASZTHATO EGYSEGEK: AZ AKTIVAK, PLUSZ AMI MAR AZ ESZKOZON ALL.
 *
 * A kivezetes a VALASZTEKOT szukiti, nem a MULTAT irja at. Ha a mostani egyseg
 * kiesne a listabol, a szerelo egy kitoltott szam mellett ures egyseget latna,
 * es a mentes fel parkent bukna el -- latszolag ok nelkul.
 */
function teljesitmenyEgysegek(
  aktivak: UnitOfMeasureRow[],
  mostani: { id: string; code: string; name: string } | undefined,
): UnitOfMeasureRow[] {
  if (!mostani) return aktivak;
  if (aktivak.some((unit) => unit.id === mostani.id)) return aktivak;
  return [...aktivak, { ...mostani, isActive: false, sortOrder: 0 }];
}
