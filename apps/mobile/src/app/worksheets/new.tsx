import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
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
  createWorksheetDepartment,
  listSelectableWorksheetPartners,
  listWorksheetDepartments,
  uploadWorksheetDocuments,
  type WorksheetDepartment,
  type WorksheetSelectablePartner,
} from "@/lib/api/worksheets";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
// A `useIsOnline` SZANDEKOSAN nem szerepel itt: a masolat akkor kerul elo, ha a
// hivas TENYLEG elhasalt, nem akkor, ha a keszulek offline-nak mondja magat.
// Ugyanaz a szabaly, mint a `connectivity.ts` fejleceben.
import { describeCachedDepartmentsNotice } from "@/lib/offline/offline-notice";
import { usePhotoAttachments } from "@/lib/photos/use-photo-attachments";
import {
  readCachedWorksheetDepartments,
  rememberWorksheetDepartments,
} from "@/lib/offline/worksheet-department-cache";

import { ApiError } from "@/lib/api/client";
import {
  describePhotoQueueing,
  planPhotosAfterRecord,
  queuePhotosForRecording,
} from "@/lib/assets/photo-after-record";
import {
  enqueuePhoto,
  enqueueWorksheetCreate,
} from "@/lib/offline/queue-store";
import { saveOrQueue } from "@/lib/offline/save-or-queue";
import {
  mustQueue,
  ticketLinkFromParams,
  ticketNotice,
} from "@/lib/worksheets/worksheet-under-ticket";
import { worksheetOperationId } from "@/lib/offline/sync-queue";
import { getServiceJob } from "@/lib/api/service-jobs";
import {
  partnerLezarva,
  prefillFromTicket,
} from "@/lib/worksheets/worksheet-prefill-from-ticket";
import {
  oroklendoEszkozok,
  oroklendoFelelosok,
  oroklesUzenete,
} from "@/lib/worksheets/worksheet-inherit-from-ticket";
import { listAssignableWorksheetUsers } from "@/lib/api/worksheets";
import { jegyOroklendo } from "@/lib/service-jobs/jegy-alak";
import {
  kezdoValaszto,
  valasztasUtan,
  valasztoraKoppint,
  type NyitottValaszto,
} from "@/lib/worksheets/worksheet-pickers";
import {
  buildWorksheetCreatePayload,
  describeWorksheetQueueWrite,
  missingWorksheetFields,
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
  const queryClient = useQueryClient();
  /**
   * A HIBAJEGY, AMI ALA A LAP KERUL -- KET ALAKBAN JOHET, ES A KETTO NEM
   * CSEREHETO FEL. A dontes a `lib/worksheets/worksheet-under-ticket.ts`-ben
   * all, mert ott MERHETO; ide csak az atadas kerul.
   */
  const jegy = ticketLinkFromParams(
    useLocalSearchParams<{
      serviceJobId?: string;
      serviceJobOperationId?: string;
    }>(),
  );
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;

  const [partner, setPartner] = useState<WorksheetSelectablePartner | null>(
    null,
  );
  /**
   * EGY ALLAPOT, NEM KETTO -- ES EZ SZERKEZETI, NEM STILUS.
   *
   * Ket fuggetlen jelzo megengedne, hogy a partner- ES a helyszin-lista
   * egyszerre alljon nyitva; epp az a kep, amire Balazs jelentese szol. A
   * dontes a `worksheet-pickers.ts` modulban all, mert ebben az appban nincs
   * komponens-teszt.
   *
   * ZARVA INDUL. Jegy alatt a partner amugy sem valaszthato (`partnerLezarva`),
   * ott ZART MEZO a helyes alak, nem csukott valaszto.
   */
  const [nyitottValaszto, setNyitottValaszto] =
    useState<NyitottValaszto>(kezdoValaszto());
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
  /**
   * A HIANYZO KOTELEZO MEZOK NEVE, KULDESKOR (acrobot dontese, 2026-09-25,
   * Figma 8. kor): a gomb marad mindig aktiv (a mai mobil mintaja), de egy
   * sikertelen kuldes utan a gomb FELETT megjelenik, MELYIK mezo(k)
   * hianyoznak -- ugyanazzal a "Kötelező: X, Y" szoveggel, mint a weben. Nem
   * folyamatosan szamolt: csak a kuldes PILLANATABAN, a `submit()`-ben.
   */
  const [missingFields, setMissingFields] = useState<string[]>([]);
  /**
   * A HELYSZINEN KESZULT KEPEK, MEG A MENTES ELOTT.
   *
   * Ugyanaz az indok, mint az eszkoz-urlapon: terero nelkul a mentes nem visz
   * sehova (a lap a sorba kerul, es az adatlapja meg nem letezik), tehat nincs
   * az a keperno, ahol a szerelo utolag ratenne a kepet.
   */
  /**
   * A KEP-VALASZTAS KOZOS HOROGBAN ALL (`lib/photos/use-photo-attachments.ts`).
   * Ugyanez a nehany kezelo harom kepernyon allt volna beture azonosan.
   */
  const {
    photos,
    notice: photoNotice,
    setNotice: setPhotoNotice,
    clear: kepeketTorol,
    takePhoto: kepetKeszit,
    pickPhotos: kepetValaszt,
  } = usePhotoAttachments();

  const partnersQuery = useQuery({
    queryKey: ["worksheet-partners"],
    queryFn: listSelectableWorksheetPartners,
    enabled:
      status === "authenticated" && Boolean(capabilities?.worksheetsManage),
  });

  /**
   * A JEGY A SZERVERTOL JON, NEM A CIMBOL -- ES EZ NEM KERULOUT.
   *
   * A navigacio csak a jegy AZONOSITOJAT adja at. A partnert egy params-ban
   * atadott `customerId` egyszerubben hozna, de azt barki atirhatna, es a
   * vegpont (`mayWorksheetJoinTicket`) utana visszautasitana a lapot. A web
   * ugyanezert kerdezi le a jegyet.
   */
  const jegyQuery = useQuery({
    queryKey: [
      "worksheet-new-ticket",
      jegy.kind === "server" ? jegy.serviceJobId : null,
    ],
    queryFn: () =>
      getServiceJob(jegy.kind === "server" ? jegy.serviceJobId : ""),
    enabled: jegy.kind === "server" && status === "authenticated",
  });

  /**
   * MIT VESZ AT A LAP A JEGYBOL. A dontes tiszta modulban all
   * (`worksheet-prefill-from-ticket.ts`), mert ebben az appban nincs
   * komponens-teszt: ami ide kerulne, azt soha senki nem merne le.
   */
  /*
    A JEGY PARTNER-ALAKBAN IS ERKEZHET, ES AKKOR NINCS MIT OROKOLNI.

    A `jegyOroklendo` EGY dontest ker (van-e mit orokolni), nem negyet: ha a
    negy mezot kulon-kulon kerdeznenk, a negyedik helyen elfelejtenenk. Merve
    2026-09-22: ez a kepernyo addig FELTETEL NELKUL olvasta mind a negyet, es
    partner-alaknal `undefined` erteket vett at -- a lap a jegy vevoje,
    helyszine es felelose NELKUL jott volna letre. A jegy adatlapja HANGOSAN
    halt meg ugyanettol; ez CSENDBEN rontott volna.
  */
  const jegyAdatai = jegyQuery.data ? jegyOroklendo(jegyQuery.data) : null;
  const elotoltes = prefillFromTicket({
    link: jegy,
    jegy: jegyAdatai
      ? {
          customerId: jegyAdatai.customerId,
          customerName: jegyAdatai.customerName,
          departmentId: jegyAdatai.departmentId,
        }
      : null,
    betoltes: jegyQuery.isPending,
    hiba: jegyQuery.isError,
    partnerek: partnersQuery.data?.items ?? [],
  });

  /**
   * A KIOSZTHATO KOLLEGAK -- CSAK JEGY ALATT, mert csak ott van kit orokolni.
   *
   * A jegy felelose NEM feltetlenul oszthato ki a lapra: a ket lista mas jogra
   * szur. Egyetlen nem kioszthato nev az EGESZ lapot elutasittatna, tehat a
   * metszetet kuldjuk -- es ahhoz ez a lista kell.
   */
  const kioszthatokQuery = useQuery({
    queryKey: ["worksheet-assignable-users"],
    queryFn: listAssignableWorksheetUsers,
    enabled: jegy.kind === "server" && status === "authenticated",
  });

  /**
   * AZ ELOTOLTES SZARMAZTATOTT ERTEK, NEM MASOLT ALLAPOT.
   *
   * Az elso valtozatom egy `useEffect`-ben irta at a ket allapotot, es a mobil
   * lint ELUTASITOTTA: "Calling setState synchronously within an effect can
   * trigger cascading renders". A szabaly itt nem formasag -- egy masolt allapot
   * KET forrast csinal ugyanabbol az adatbol, es a ketto elcsuszhat.
   *
   * Szarmaztatva nincs mit elcsusztatni: jegy alatt a jegy partnere ER, minden
   * mas esetben a szerelo valasztasa. A helyszinnel ugyanez, azzal a
   * kulonbseggel, hogy ott a szerelo felul tudja irni -- a sajat valasztasa
   * nyer, amint megtortent.
   */
  const partnerHatasos =
    elotoltes.kind === "kesz" ? elotoltes.partner : partner;
  const departmentIdHatasos =
    departmentId ||
    (elotoltes.kind === "kesz" ? (elotoltes.departmentId ?? "") : "");

  /**
   * AMIT A JEGYBOL OROKOL A LAP. A szabalyok a
   * `worksheet-inherit-from-ticket.ts` modulban allnak, mert a szerver ket
   * ellenorzesehez igazodnak -- es egy elutasitott letrehozas a telefonon nem
   * piros doboz, hanem egy lap, ami a SORBAN ragad.
   */
  const jegyEszkozok = jegyQuery.data?.assets ?? [];
  const oroklendoEszkozIdk = oroklendoEszkozok({
    jegyEszkozok,
    jegyDepartmentId: jegyAdatai?.departmentId ?? null,
    lapDepartmentId: departmentIdHatasos,
  });
  const oroklendoFelelosIdk = oroklendoFelelosok({
    jegyFelelosok: jegyAdatai?.assignees ?? [],
    kioszthatok: kioszthatokQuery.data?.items ?? [],
  });
  const oroklesSzoveg = oroklesUzenete({
    jegyEszkozok,
    oroklendoEszkozok: oroklendoEszkozIdk,
    oroklendoFelelosok: oroklendoFelelosIdk,
  });

  const departmentsQuery = useQuery({
    queryKey: ["worksheet-departments", partnerHatasos?.customerId],
    queryFn: () => listWorksheetDepartments(partnerHatasos!.customerId),
    enabled: Boolean(partnerHatasos?.customerId),
  });

  /**
   * A FRISS LISTÁT MENTJÜK, hogy a pincében legyen miből választani. A helyszín
   * KÖTELEZŐ mező: e nélkül a másolat nélkül a helyszíni felvitel pont ott nem
   * működne, ahol a legtöbbet érne.
   */
  useEffect(() => {
    const customerId = partnerHatasos?.customerId;
    const items = departmentsQuery.data?.items;
    if (!customerId || !items) return;
    void rememberWorksheetDepartments(customerId, items);
  }, [partnerHatasos?.customerId, departmentsQuery.data]);

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
    const customerId = partnerHatasos?.customerId;
    if (!customerId || !departmentsQuery.isError) return;
    let ervenyes = true;
    void (async () => {
      const masolat = await readCachedWorksheetDepartments(customerId);
      if (ervenyes) setCached(masolat);
    })();
    return () => {
      ervenyes = false;
    };
  }, [partnerHatasos?.customerId, departmentsQuery.isError]);

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
   * UJ ALEGYSEG FELVITELE, INLINE (acrobot dontese, 2026-09-25, Figma 8.
   * kor): "harom mezo, nem er meg egy kulon kepernyot". A "Szulo helyszin"
   * a MAR BETOLTOTT `departments` listabol valaszthato -- nincs kulon
   * lekerdezes hozza, es a valasztas garantaltan ugyanahhoz a partnerhez
   * tartozik, mint amit a szerver ugyis ellenoriz.
   */
  const [ujAlegysegNyitva, setUjAlegysegNyitva] = useState(false);
  const [ujAlegysegSzuloId, setUjAlegysegSzuloId] = useState("");
  const [ujAlegysegKod, setUjAlegysegKod] = useState("");
  const [ujAlegysegNev, setUjAlegysegNev] = useState("");
  const [ujAlegysegHiba, setUjAlegysegHiba] = useState<string | null>(null);

  const createDepartmentMutation = useMutation({
    mutationFn: async () => {
      if (!partnerHatasos)
        throw new Error("Előbb válassz partnert az alegység felvitele előtt.");
      return createWorksheetDepartment(partnerHatasos.customerId, {
        parentId: ujAlegysegSzuloId || undefined,
        code: ujAlegysegKod.trim(),
        name: ujAlegysegNev.trim(),
      });
    },
    onMutate: () => setUjAlegysegHiba(null),
    onSuccess: async (uj) => {
      /**
       * A FRISS ALEGYSEG AZONNAL KIVALASZTODIK, es a lista UJRA lekerdezodik
       * -- kulonben a szerelo felvitte volna, de az urlap tovabbra is a
       * regi listat mutatna, es ujra kellene nyitnia a valasztot, hogy
       * lassa.
       */
      setDepartmentId(uj.id);
      setUjAlegysegNyitva(false);
      setUjAlegysegSzuloId("");
      setUjAlegysegKod("");
      setUjAlegysegNev("");
      if (partnerHatasos)
        await queryClient.invalidateQueries({
          queryKey: ["worksheet-departments", partnerHatasos.customerId],
        });
    },
    onError: (cause) =>
      setUjAlegysegHiba(
        cause instanceof Error
          ? cause.message
          : "Az alegység nem hozható létre.",
      ),
  });

  /**
   * MENTES: A SZERVERNEK, ES CSAK HALOZATI HIBANAL A SORBA.
   *
   * A dontes a `lib/offline/save-or-queue.ts`-ben van, mert ott MERHETO --
   * ebben a fajlban nincs, ami tesztelne. Ugyanaz a fuggveny fut, mint az
   * eszkoz-felvitelnel; a SZOVEG kulon, mert a munkalapnal nincs
   * gyorsitotar-ellenorzes, amit a mondat hordozhatna.
   */
  /**
   * A KEP SORSA A LAP KIMENETELEBOL KOVETKEZIK, es a dontes a kozos modulban
   * all (`lib/assets/photo-after-record.ts`) -- ugyanaz, ami az eszkoznel fut.
   */
  const kepeketElintez = async (
    outcome: Awaited<ReturnType<typeof saveOrQueue>>,
    keszult: string,
  ): Promise<{ maradjunk: boolean; message: string | null }> => {
    const terv = planPhotosAfterRecord(outcome, photos);
    if (terv.type === "none") return { maradjunk: false, message: null };
    if (terv.type === "dropped")
      return { maradjunk: false, message: terv.message };

    if (terv.type === "upload") {
      try {
        const feltoltve = await uploadWorksheetDocuments(terv.ownerId, {
          files: terv.files,
        });
        return {
          maradjunk: false,
          message: `${feltoltve.length} fénykép feltöltve.`,
        };
      } catch (cause) {
        /**
         * A LAP MAR FENT VAN, tehat ez nem elveszett munkalap -- de a kep NEM
         * ment fel, es ezen a kepernyon KELL maradnunk: a `saved` ag kulonben
         * azonnal atlep a lap adatlapjara, es a mondat egy mar elhagyott
         * kepernyore kerulne.
         */
        return {
          maradjunk: true,
          message:
            cause instanceof Error
              ? `A munkalap felment, a fénykép viszont nem: ${cause.message}. A képek megmaradtak, próbáld újra.`
              : "A munkalap felment, a fénykép viszont nem. A képek megmaradtak, próbáld újra.",
        };
      }
    }

    return {
      maradjunk: false,
      message: describePhotoQueueing(
        await queuePhotosForRecording({
          recordingOperationId: terv.recordingOperationId,
          files: terv.files,
          createdAt: keszult,
          /**
           * A KEP A MUNKALAPHOZ TARTOZIK. A sor a gazdabol tudja, melyik
           * vegpontra kuldje, tehat egy munkalap-kep sosem kerulhet egy eszkoz
           * ala.
           */
          enqueue: (input) =>
            enqueuePhoto({ ...input, entityType: "worksheet" }),
        }),
      ),
    };
  };

  const mutation = useMutation({
    mutationFn: async (payload: WorksheetCreatePayload) => {
      const nyitas = new Date().toISOString();
      const outcome = await saveOrQueue({
        /**
         * A SORBAN ALLO JEGY ALATT A SZERVERT MEG SEM PROBALJUK. A hivas
         * sikerulne -- csak `serviceJobId` nelkul, es a lap soha nem kerulne a
         * jegy ala. Se hiba, se uzenet.
         */
        queueOnly: mustQueue(jegy),
        save: () =>
          createWorksheet(
            jegy.kind === "server"
              ? { ...payload, serviceJobId: jegy.serviceJobId }
              : payload,
          ),
        enqueue: () =>
          enqueueWorksheetCreate({
            /**
             * A FELMENT JEGY AZONOSITOJA A TORZSBE MEGY; a sorban alloe MEG NEM
             * LETEZIK, tehat ott a sor a jegy MUVELET-azonositojara var, es az
             * ertek a feloldaskor kerul a payloadba.
             */
            dependsOnServiceJobOperationId:
              jegy.kind === "queued" ? jegy.operationId : null,
            /**
             * A KULCS A TARTALOMBOL SZULETIK, es UGYANEZ megy fel a szervernek
             * `clientOperationId` neven: egy megszakadt kuldes ujrakuldese a
             * MEGLEVO lapot adja vissza, nem masodikat hoz letre.
             */
            id: worksheetOperationId({
              customerId: payload.customerId,
              startedAt: nyitas,
            }),
            payload:
              jegy.kind === "server"
                ? { ...payload, serviceJobId: jegy.serviceJobId }
                : payload,
            createdAt: nyitas,
          }),
        statusOf: (cause) => (cause instanceof ApiError ? cause.status : null),
        describeWrite: describeWorksheetQueueWrite,
      });
      return { outcome, photo: await kepeketElintez(outcome, nyitas) };
    },
    onSuccess: ({ outcome, photo }) => {
      setPhotoNotice(photo.message);
      /**
       * EGY ELBUKOTT KEP-FELTOLTES ITT TART MINKET, kulonben a mondat egy mar
       * elhagyott kepernyore kerulne.
       */
      if (outcome.type === "saved" && photo.maradjunk) return;
      if (outcome.type === "saved") {
        router.replace({
          pathname: "/worksheets/[id]",
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
      customerId: partnerHatasos?.customerId ?? "",
      departmentId: departmentIdHatasos,
      subject,
      description,
      assetIds: oroklendoEszkozIdk,
      assigneeIds: oroklendoFelelosIdk,
    });
    if (!result.ok) {
      setError({ field: result.field, message: result.message });
      setMissingFields(
        missingWorksheetFields({
          customerId: partnerHatasos?.customerId ?? "",
          departmentId: departmentIdHatasos,
          subject,
        }),
      );
      return;
    }
    setMissingFields([]);
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

          {/*
            A JEGY MONDATA ELORE ALL, NEM A KULDES UTAN.

            A szerver a jegy partneret a lapehoz meri (mayWorksheetJoinTicket),
            es elteres eseten elutasit. Ha ezt csak a kuldes utan mondanank el,
            a szerelo egy kesz lapot latna elakadva a sorban, orakkal kesobb, a
            helyszintol tavol -- es a partner-valasztas addigra mar megtortent.
          */}
          {ticketNotice(jegy) ? (
            <View style={styles.notice}>
              <Text style={styles.noticeTitle}>Hibajegy alá kerül</Text>
              <Text style={styles.noticeBody}>{ticketNotice(jegy)}</Text>
            </View>
          ) : null}

          {/*
            AMIT ATVESZ A LAP -- A KULDES ELOTT, nem utana. A telefonon a ket
            lista nem valaszthato, tehat ez az EGYETLEN visszajelzes arrol, mi
            kerul a lapra. Es az ELMARADT orokles oka is ide tartozik: enelkul
            a szerelo annyit latna, hogy az eszkoz "eltunt".
          */}
          {oroklesSzoveg ? (
            <View style={styles.notice}>
              <Text style={styles.noticeTitle}>A hibajegyről</Text>
              <Text style={styles.noticeBody}>{oroklesSzoveg}</Text>
            </View>
          ) : null}

          <Section title="Partner">
            <Pressable
              accessibilityRole="button"
              disabled={partnerLezarva(elotoltes)}
              onPress={() =>
                setNyitottValaszto((nyitott) =>
                  valasztoraKoppint(nyitott, "partner"),
                )
              }
              style={[
                styles.pickerRow,
                partnerHatasos && styles.pickerSelected,
              ]}
            >
              <Text style={styles.pickerName}>
                {partnerHatasos
                  ? partnerHatasos.name
                  : elotoltes.kind === "toltes"
                    ? "A hibajegy partnere töltődik…"
                    : "Válassz partnert"}
              </Text>
              <Text style={styles.pickerMeta}>
                {partnerHatasos
                  ? partnerLezarva(elotoltes)
                    ? "A hibajegyről — nem módosítható"
                    : partnerHatasos.partnerCode
                  : "Koppints a listához"}
              </Text>
            </Pressable>
            {/*
              A KET ALLAPOT KET KULON MONDAT, es nem egy kozos "nem sikerult".
              A betoltesi hibanal UJRA lehet probalni; partner nelkuli jegynel a
              JEGYET kell rendbe tenni, es addig a lap sehogy nem mehet fel.
            */}
            {elotoltes.kind === "hiba" || elotoltes.kind === "nincs-partner" ? (
              <Text style={styles.hint}>{elotoltes.uzenet}</Text>
            ) : null}
            <FieldError error={error} field="customer" />
            {partnerLezarva(elotoltes) ||
            nyitottValaszto !== "partner" ? null : partnersQuery.isPending ? (
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
                      setNyitottValaszto(valasztasUtan());
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
                      partnerHatasos?.customerId === item.customerId &&
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
            {/*
              A HELYSZIN IS FEJSORT KAP, ES EZ A JELENTES MASIK FELE. Eddig ez a
              szekcio nem ismert nyitott/zart allapotot: a teljes listat MINDIG
              kiirta, valasztas utan is. A partner utan igy rogton a helyszinek
              teljes listaja nyilt ki alatta -- kivulrol ugyanaz a kep, mintha a
              partner-lista maradt volna ott.
            */}
            {partnerHatasos ? (
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  setNyitottValaszto((nyitott) =>
                    valasztoraKoppint(nyitott, "helyszin"),
                  )
                }
                style={[
                  styles.pickerRow,
                  departmentIdHatasos && styles.pickerSelected,
                ]}
              >
                <Text style={styles.pickerName}>
                  {departments.find((d) => d.id === departmentIdHatasos)
                    ?.name ?? "Válassz helyszínt"}
                </Text>
                <Text style={styles.pickerMeta}>
                  {departments.find((d) => d.id === departmentIdHatasos)
                    ?.code ?? "Koppints a listához"}
                </Text>
              </Pressable>
            ) : null}
            {!partnerHatasos ? (
              <Text style={styles.hint}>
                Előbb válassz partnert: a helyszínek hozzá tartoznak.
              </Text>
            ) : nyitottValaszto !==
              "helyszin" ? null : departmentsQuery.isPending ? (
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
                    onPress={() => {
                      setDepartmentId(unit.id);
                      setNyitottValaszto(valasztasUtan());
                    }}
                    style={[
                      styles.listRow,
                      departmentIdHatasos === unit.id && styles.listRowOn,
                    ]}
                  >
                    <Text style={styles.listName}>{unit.name}</Text>
                    <Text style={styles.listMeta}>{unit.code}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            {/*
              "+ UJ ALEGYSEG HOZZAADASA", INLINE (acrobot dontese,
              2026-09-25, Figma 8. kor). Csak akkor van ertelme, ha mar van
              partner: az alegyseg a partner ala kerul, es a szerver ezt is
              ellenorzi (`customerId` az utvonalban).
            */}
            {partnerHatasos && !fromCache ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setUjAlegysegNyitva((nyitva) => !nyitva);
                    setUjAlegysegHiba(null);
                  }}
                >
                  <Text style={styles.toggleLink}>
                    {ujAlegysegNyitva ? "− Mégsem" : "+ Új alegység hozzáadása"}
                  </Text>
                </Pressable>

                {ujAlegysegNyitva ? (
                  <View style={styles.subForm}>
                    <View style={styles.field}>
                      <Text style={styles.label}>Szülő helyszín</Text>
                      <View style={styles.list}>
                        <Pressable
                          onPress={() => setUjAlegysegSzuloId("")}
                          style={[
                            styles.listRow,
                            ujAlegysegSzuloId === "" && styles.listRowOn,
                          ]}
                        >
                          <Text style={styles.listName}>
                            Nincs (legfelső szint)
                          </Text>
                        </Pressable>
                        {departments.map((unit) => (
                          <Pressable
                            key={unit.id}
                            onPress={() => setUjAlegysegSzuloId(unit.id)}
                            style={[
                              styles.listRow,
                              ujAlegysegSzuloId === unit.id && styles.listRowOn,
                            ]}
                          >
                            <Text style={styles.listName}>{unit.name}</Text>
                            <Text style={styles.listMeta}>{unit.code}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                    <View style={styles.field}>
                      <Text style={styles.label}>Új alegység kódja</Text>
                      <TextInput
                        value={ujAlegysegKod}
                        onChangeText={setUjAlegysegKod}
                        placeholder="pl. CAP-UJ"
                        placeholderTextColor="#5b7d8f"
                        autoCapitalize="characters"
                        style={styles.input}
                      />
                    </View>
                    <View style={styles.field}>
                      <Text style={styles.label}>Új alegység neve</Text>
                      <TextInput
                        value={ujAlegysegNev}
                        onChangeText={setUjAlegysegNev}
                        placeholder="pl. Hátsó medence"
                        placeholderTextColor="#5b7d8f"
                        style={styles.input}
                      />
                    </View>
                    {ujAlegysegHiba ? (
                      <Text style={styles.fieldError}>{ujAlegysegHiba}</Text>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      disabled={createDepartmentMutation.isPending}
                      onPress={() => createDepartmentMutation.mutate()}
                      style={[
                        styles.pickerRow,
                        createDepartmentMutation.isPending && styles.disabled,
                      ]}
                    >
                      <Text style={styles.pickerName}>
                        {createDepartmentMutation.isPending
                          ? "Létrehozás…"
                          : "Alegység létrehozása"}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
              </>
            ) : null}

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
              {/*
                "MEGJEGYZÉS", NEM "LEÍRÁS (ELHAGYHATÓ)" (acrobot döntése,
                2026-09-25, Figma 8. kör): a leírás és a terv is ezt a szót
                használja -- ugyanaz a mező, ami a részletes lapon is
                megjelenik.
              */}
              <Text style={styles.label}>Megjegyzés</Text>
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

          <Section title="Fénykép">
            {/*
              A KEP A LAP MEGNYITASA ELOTT KESZUL, ugyanabbol az okbol, mint az
              eszkoznel: terero nelkul a mentes nem visz sehova, es nincs az a
              keperno, ahol utolag ra lehetne tenni.

              A SZERVEREN A KEP A LAPHOZ tartozik, nem a verziohoz -- es alairas
              utan is felkerulhet, mert a bizonyitek gyakran keson erkezik.
            */}
            <Text style={styles.hint}>
              A fénykép a munkalap mellé kerül, és térerő nélkül is vár a
              telefonon, amíg fel nem megy.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={kepetKeszit}
              style={styles.pickerRow}
            >
              <Text style={styles.pickerName}>Fénykép készítése</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={kepetValaszt}
              style={styles.pickerRow}
            >
              <Text style={styles.pickerName}>Kép a galériából</Text>
            </Pressable>
            {photos.length > 0 ? (
              <View style={styles.photoRow}>
                <Text style={styles.pickerName}>
                  {photos.length} fénykép a munkalaphoz
                </Text>
                <Pressable onPress={kepeketTorol}>
                  <Text style={styles.clearPhotos}>Képek törlése</Text>
                </Pressable>
              </View>
            ) : null}
            {photoNotice ? (
              <Text style={styles.hint}>{photoNotice}</Text>
            ) : null}
          </Section>

          {/*
            A HIBA A GOMB MELLETT IS. Ugyanaz a mért ok, mint az eszköz-űrlapon:
            a mezőnél megjelenő üzenet a képernyő tetején lehet, a gomb viszont
            az alján van, és aki megnyomta, semmit nem lát.
          */}
          {error ? <Text style={styles.error}>{error.message}</Text> : null}
          {queued ? <Text style={styles.queued}>{queued}</Text> : null}

          {/*
            "KÖTELEZŐ: X, Y" A GOMB FELETT, KÜLDÉSKOR (acrobot döntése,
            2026-09-25, Figma 8. kör) -- ugyanaz a szöveg-alak, mint a webes
            eszköz-felvitelen (pilot-asset-create-page.tsx). A gomb NEM
            tiltott: a mai mobil mintája marad, ez csak egy sikertelen küldés
            UTÁN mondja meg, melyik kötelező mező hiányzik.
          */}
          {missingFields.length > 0 ? (
            <Text style={styles.missingFields}>
              Kötelező: {missingFields.join(", ")}
            </Text>
          ) : null}

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
  toggleLink: {
    color: "#52d6c7",
    fontSize: 13,
    fontWeight: "800",
  },
  subForm: {
    backgroundColor: "#08192a",
    borderColor: "#17394f",
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  photoRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  clearPhotos: { color: "#52d6c7", fontSize: 12, fontWeight: "800" },
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
  missingFields: { color: "#789cad", fontSize: 12, textAlign: "center" },
  saveButton: { backgroundColor: "#177b74", borderRadius: 12, padding: 15 },
  saveText: {
    color: "#fff",
    fontWeight: "900",
    textAlign: "center",
    fontSize: 15,
  },
  disabled: { opacity: 0.55 },
});
