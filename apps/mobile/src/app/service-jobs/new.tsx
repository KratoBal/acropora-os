import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
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

import { getAsset, listAssets } from "@/lib/api/assets";
import {
  createServiceJob,
  uploadServiceJobPhotos,
} from "@/lib/api/service-jobs";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import { ApiError } from "@/lib/api/client";
import {
  describePhotoQueueing,
  planPhotosAfterRecord,
  queuePhotosForRecording,
} from "@/lib/assets/photo-after-record";
import { readCachedAsset } from "@/lib/offline/asset-cache";
import {
  enqueuePhoto,
  enqueueServiceJobCreate,
} from "@/lib/offline/queue-store";
import { saveOrQueue, type SaveOutcome } from "@/lib/offline/save-or-queue";
import { usePhotoAttachments } from "@/lib/photos/use-photo-attachments";
import {
  newServiceJobProblem,
  placementNotice,
} from "@/lib/service-jobs/new-service-job";
import {
  listSelectableWorksheetPartners,
  listWorksheetDepartments,
  type WorksheetSelectablePartner,
} from "@/lib/api/worksheets";
import { ujJegyTorzse } from "@/lib/service-jobs/uj-jegy-torzs";

/**
 * ÚJ HIBAJEGY A GÉPNÉL.
 *
 * === MIÉRT CSAK ESZKÖZBŐL NYÍLIK ===
 *
 * A képernyő `assetId`-vel érkezik: a szerelő egy gép előtt áll, beolvasta vagy
 * megnyitotta. Ebből a partner és a helyszín KÖVETKEZIK, és a levezetést a
 * szerver végzi.
 *
 * Szabad, eszköz nélküli jegynyitás ebben a körben NINCS -- és nem feledékenység:
 * eszköz nélkül a jegynek nem lenne partnere, a partner nélküli jegyet pedig az
 * irodán és a nyitóján kívül SENKI nem látja (a láthatóság a partner
 * helyszíneire szűr). Egy ilyen gomb tehát csendben láthatatlan jegyeket
 * gyártana.
 *
 * === A KÉT MEZŐ ===
 *
 * Cím és leírás. A szerver egyetlen kötelezőt kér (a címet); a többi az
 * eszközből jön. A webes űrlap 575 sora nem a kötelezőségből fakad, hanem abból,
 * hogy ott a partnert, a helyszínt és az eszközöket a SEMMIBŐL kell választani.
 */
export default function NewServiceJobScreen() {
  const params = useLocalSearchParams<{ assetId: string | string[] }>();
  const assetId = Array.isArray(params.assetId)
    ? params.assetId[0]
    : params.assetId;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * A SORBA TETT JEGY MUVELET-AZONOSITOJA -- EBBOL LESZ A KOVETKEZO LEPES.
   *
   * Balazs kerese szo szerint: "Sot lehet, hogy munkalapot is nyitna rogton."
   * A jegynek meg nincs szerver-oldali azonositoja, tehat a lap CSAK erre a
   * kulcsra tud hivatkozni -- a valodi azonositot a sor irja be, amint a jegy
   * felment.
   */
  const [sorbanAlloJegy, setSorbanAlloJegy] = useState<string | null>(null);
  /**
   * A KEP-VALASZTAS KOZOS HOROGBAN ALL. Balazs kerese szo szerint: "meg akarja
   * nyitni a hibajegyet es fotot is alar hozza rogziteni" -- terero nelkul is.
   */
  const {
    photos,
    notice: photoNotice,
    setNotice: setPhotoNotice,
    clear: kepeketTorol,
    takePhoto: kepetKeszit,
    pickPhotos: kepetValaszt,
  } = usePhotoAttachments();

  /**
   * AZ ESZKÖZ A SZERVERRŐL, VAGY A MENTETT MÁSOLATBÓL.
   *
   * Térerő nélkül is kell: a jegynyitás ilyenkor a sorba megy, de a szerelőnek
   * AKKOR IS látnia kell, melyik gépről szól és hova fog kerülni.
   */
  const query = useQuery({
    queryKey: ["service-asset", assetId],
    queryFn: () => getAsset(assetId!),
    enabled: status === "authenticated" && Boolean(assetId),
  });

  const cached = useQuery({
    queryKey: ["offline-asset", assetId],
    queryFn: () => readCachedAsset(assetId!),
    enabled: status === "authenticated" && Boolean(assetId),
  });

  const asset =
    query.data ?? cached.data?.detail ?? cached.data?.summary ?? null;

  /**
   * A PARTNER ES A HELYSZIN CSAK GEP NELKUL KERDES.
   *
   * Gep mellol a szerver vezeti le mind a kettot, tehat ezek a lekerdezesek el
   * sem indulnak -- a szerelo egy gep elott allva egy folosleges kort sem fizet
   * erte, tereró nelkul pedig egy folosleges hibat sem lat.
   */
  const [partner, setPartner] = useState<WorksheetSelectablePartner | null>(
    null,
  );
  const [departmentId, setDepartmentId] = useState("");
  const [partnerValasztoNyitva, setPartnerValasztoNyitva] = useState(false);
  const [helyszinValasztoNyitva, setHelyszinValasztoNyitva] = useState(false);
  /*
    A VALASZTOTT ESZKOZOK AZONOSITOSTUL ES NEVESTUL.

    Nem eleg az azonosito-lista: a valasztott eszkoz egy KESOBBI lapon vagy egy
    szukebb keresesben mar nem latszik, es a szerelo akkor csak egy szamot
    latna. A nev a valasztas PILLANATABAN ismert, tehat ott is tesszuk el.
  */
  const [valasztottEszkozok, setValasztottEszkozok] = useState<
    { id: string; nev: string }[]
  >([]);
  const [eszkozValasztoNyitva, setEszkozValasztoNyitva] = useState(false);
  const [eszkozKereses, setEszkozKereses] = useState("");
  const [eszkozOldal, setEszkozOldal] = useState(1);
  const partnerek = useQuery({
    queryKey: ["uj-jegy-partnerek"],
    queryFn: listSelectableWorksheetPartners,
    enabled: !assetId && status === "authenticated",
  });
  const helyszinek = useQuery({
    queryKey: ["uj-jegy-helyszinek", partner?.customerId],
    queryFn: () => listWorksheetDepartments(partner!.customerId),
    enabled: !assetId && status === "authenticated" && Boolean(partner),
  });
  /**
   * A HELYSZIN ESZKOZEI -- ES A SZURES A SZERVEREN FUT.
   *
   * A lista LAPOZOTT, es ez nem elmeleti ovatossag: elesen merve 2026-09-21-en
   * a legnagyobb reszfa 49 eszkoz, a lapmeret 50. Ma tehat befer, es PONT
   * EZERT veszelyes -- egy uj eszkoz barmelyik alegysegbe atviszi a hataron, es
   * onnantol a valaszto CSENDBEN hianyos lenne. A lapozo ezt vagja el.
   *
   * ES CSAK HELYSZINNEL EGYUTT INDUL EL: a szerver a jegyhez csatolt eszkozt
   * ugyanugy csak helyszinnel egyutt fogadja el. Egy helyszin nelkuli lista a
   * partner OSSZES eszkozet adna, amibol a bejelento nem tud valasztani.
   */
  const eszkozok = useQuery({
    queryKey: ["uj-jegy-eszkozok", departmentId, eszkozKereses, eszkozOldal],
    queryFn: () => listAssets(eszkozOldal, 50, eszkozKereses, departmentId),
    enabled:
      !assetId &&
      status === "authenticated" &&
      eszkozValasztoNyitva &&
      Boolean(departmentId),
    placeholderData: keepPreviousData,
  });

  const save = useMutation({
    mutationFn: async () => {
      const openedAt = new Date().toISOString();
      /**
       * A TORZS ES A KULCS EGY HELYEN DOL EL, ket utra (gep elol, gep nelkul).
       * A modul ugyanazt a ket szabalyt orzi, amit a szerver, es a gep nelkuli
       * kulcsba a FELHASZNALOT is beveszi -- lasd a modul fejlecet.
       */
      const torzs = ujJegyTorzse({
        cim: title,
        leiras: description,
        originAssetId: assetId ?? null,
        customerId: partner?.customerId ?? null,
        departmentId: departmentId || null,
        assetIds: valasztottEszkozok.map((item) => item.id),
        userId: user?.id ?? "ismeretlen",
        openedAt,
      });
      if (!torzs.ok) throw new Error(torzs.hiba);
      const { operationId, payload } = torzs;
      const outcome = await saveOrQueue({
        save: () =>
          createServiceJob({ ...payload, clientOperationId: operationId }),
        enqueue: () =>
          enqueueServiceJobCreate({
            id: operationId,
            payload,
            createdAt: openedAt,
          }),
        statusOf: (error) => (error instanceof ApiError ? error.status : null),
        /**
         * A SORBA TÉTEL MONDATA A JEGYRŐL SZÓL, nem az eszközről. A közös
         * szöveg itt kevesebbet mondana: a szerelőnek azt kell tudnia, hogy a
         * BEJELENTÉSE megvan, és magától fel fog menni.
         */
        describeWrite: (result) =>
          result.ok
            ? {
                type: "queued",
                operationId: result.operationId,
                message:
                  "Nincs kapcsolat, ezért a hibajegy a feltöltésre várók közé került. Amint van térerő, magától felmegy.",
              }
            : {
                type: "queue-failed",
                message: `A hibajegyet nem sikerült elmenteni a készülékre: ${result.error}`,
              },
      });
      /**
       * A KEP SORSA A JEGY KIMENETELEBOL KOVETKEZIK, es a dontes a
       * `lib/assets/photo-after-record.ts`-ben all, mert ott MERHETO (nincs
       * benne halozat es adatbazis). Ide csak a VEGREHAJTAS kerul.
       */
      return { outcome, photo: await kepeketElintez(outcome, openedAt) };
    },
    onSuccess: async ({ outcome, photo }) => {
      /**
       * A KEPEKROL SZOLO MONDAT AKKOR IS MEGJELENIK, HA A JEGY SIKERULT. Egy
       * kimaradt kep kulon hir: a jegy attol meg fent van.
       */
      setPhotoNotice(photo.message);
      /**
       * EGY ELBUKOTT KEP-FELTOLTES ITT TART MINKET. A `saved` ag kulonben
       * azonnal atlep a jegy lapjara, es a fenti mondat egy mar elhagyott
       * kepernyore kerulne -- a szerelo semmit nem latna abbol, hogy a
       * fenykepe sehol nincs.
       */
      if (outcome.type === "saved" && photo.maradjunk) return;
      if (outcome.type === "saved") {
        await queryClient.invalidateQueries({ queryKey: ["service-jobs"] });
        router.replace(`/service-jobs/${outcome.id}`);
        return;
      }
      /**
       * A SORBA TETT JEGYNEK MEG NINCS LAPJA. Nem navigalunk sehova -- a
       * mondat itt marad, es a szerelo latja, hogy a bejelentese megvan.
       */
      setNotice(outcome.message);
      if (outcome.type === "queued") {
        setSorbanAlloJegy(outcome.operationId);
        setTitle("");
        setDescription("");
        kepeketTorol();
      }
    },
    onError: (error: unknown) =>
      setNotice(
        error instanceof Error
          ? error.message
          : "A hibajegy nyitása nem sikerült.",
      ),
  });

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
        const feltoltve = await uploadServiceJobPhotos(
          terv.ownerId,
          terv.files,
        );
        return {
          maradjunk: false,
          message: `${feltoltve.length} fénykép feltöltve.`,
        };
      } catch (cause) {
        /**
         * A JEGY MAR FENT VAN, tehat ez nem elveszett bejelentes -- de a kep
         * NEM ment fel, es ezen a kepernyon KELL maradnunk.
         */
        return {
          maradjunk: true,
          message:
            cause instanceof Error
              ? `A hibajegy felment, a fénykép viszont nem: ${cause.message}. A képek megmaradtak, próbáld újra.`
              : "A hibajegy felment, a fénykép viszont nem. A képek megmaradtak, próbáld újra.",
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
           * A KEP A JEGYHEZ TARTOZIK. A sor a gazdabol tudja, melyik vegpontra
           * kuldje, tehat egy jegy-kep sosem kerulhet egy eszkoz ala -- a
           * szetosztas kimerito, `never`-re futo agsal (`use-queue-drain.ts`).
           */
          enqueue: (input) =>
            enqueuePhoto({ ...input, entityType: "service-job" }),
        }),
      ),
    };
  };

  if (status === "unauthenticated") return <Redirect href="/login" />;
  if (status === "authenticated" && !capabilities?.serviceJobsManage)
    return <Redirect href="/" />;
  /*
    GEP NELKUL IS BEENGEDUNK (Balazs kerese: "legyen olyan hibajegy, amihez nem
    tartozik eszkoz"). A szerver ezt MAR fogadja: az `originAssetId`, a
    `customerId` es a `departmentId` egyarant opcionalis, es a WEBES felvitel
    ma is igy mukodik. Ez a kepernyo tehat nem uj utat nyit, hanem a meglevot
    hasznalja a telefonrol is.
  */
  /*
    A LISTA ES A LAPSZAM EGY HELYEN, hogy a render ne ismetelje. A lapszam
    alapertelmezese 1, nem 0: egy "1 / 0" felirat elromlott lapozonak latszik,
    holott csak meg nem jott meg a valasz.
  */
  const eszkozLista = eszkozok.data?.items ?? [];
  const eszkozOldalakSzama = eszkozok.data?.pagination.totalPages ?? 1;

  if (assetId && !asset)
    return (
      <SafeAreaView style={styles.safeArea}>
        {query.isPending ? (
          <ActivityIndicator style={styles.loading} />
        ) : (
          <Text style={styles.empty}>
            Ezt a gépet nem tudom betölteni, ezért nem tudom, hova tartozna a
            jegy. Térerőnél nyisd meg egyszer az eszköz adatlapját.
          </Text>
        )}
      </SafeAreaView>
    );

  /**
   * A CIM IS ATMEGY, ES EZ MERESEN ALL: vevo gepehez ALEGYSEG SOHA nem
   * rendelheto (`assetDepartmentRefusal` -> `CUSTOMER_OWNER`), ott a cim a
   * pontositas. Alegyseg nelkul tehat nem hianyt kell kiirni, hanem a cimet.
   */
  const hova = asset
    ? placementNotice({
        owner: asset.owner
          ? { displayName: asset.owner.displayName }
          : undefined,
        ownerType: asset.owner?.type,
        unit: asset.unit,
        address: asset.address,
      })
    : null;

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.page}>
        {asset && hova ? (
          <>
            <View style={styles.block}>
              <Text style={styles.sectionTitle}>A gép</Text>
              <Text style={styles.rowText}>
                {asset.assetNumber} -- {asset.name}
              </Text>
            </View>

            {/*
              HOVA KERUL A JEGY -- KIIRVA, NEM VALASZTVA.
              Egy ures mezo harom kulon dolgot jelenthet (nincs, nem latod, nem
              toltodott be), es a felulet ezeket egybemossa.
            */}
            <View style={styles.block}>
              <Text style={styles.sectionTitle}>Hova kerül</Text>
              <Text style={styles.meta}>Partner: {hova.partner}</Text>
              <Text style={styles.meta}>Helyszín: {hova.helyszin}</Text>
              {hova.figyelmeztetes ? (
                <Text style={styles.warning}>{hova.figyelmeztetes}</Text>
              ) : null}
            </View>
          </>
        ) : (
          /*
            GEP NELKUL A SZERELO VALASZT -- ES CSAK AZT, AMIT A SZERVER IS
            ELFOGAD.

            A sorrend a szerver harom orzojenek az alakja, nem sajat otlet:
            helyszin CSAK partnerrel egyutt adhato meg. Ezert a helyszin-valaszto
            addig nem is jelenik meg, amig nincs partner -- egy olyan mezo, amit
            ugyis elutasitanak, csak a helyszinen derulne ki.

            MIND A KETTO ELHAGYHATO: a cim onmagaban eleg. A partner nelkuli
            jegy ervenyes allapot (a sema ket oszlopa nullazhato), es epp ez volt
            a keres -- olyan bejelentes, ami meg nem kotodik senkihez.
          */
          <View style={styles.block}>
            <Text style={styles.sectionTitle}>Kihez tartozik</Text>
            <Text style={styles.meta}>
              Ha már tudod, válaszd ki. Ha nem, a jegy enélkül is felvihető, és
              a partnert később az irodában lehet megadni.
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                partner
                  ? `Partner: ${partner.name}. Koppints a módosításhoz.`
                  : "Partner választása"
              }
              onPress={() => setPartnerValasztoNyitva((open) => !open)}
              style={({ pressed }) => [
                styles.picker,
                pressed && styles.pressed,
              ]}
              testID="partner-valaszto"
            >
              <Text style={styles.rowText}>
                {partner ? `Partner: ${partner.name}` : "Partner: nincs"}
              </Text>
            </Pressable>

            {partnerValasztoNyitva ? (
              <View style={styles.pickerList}>
                {partnerek.isPending ? (
                  <ActivityIndicator color="#52d6c7" />
                ) : null}
                <Pressable
                  onPress={() => {
                    setPartner(null);
                    setDepartmentId("");
                    setValasztottEszkozok([]);
                    setEszkozKereses("");
                    setEszkozOldal(1);
                    setPartnerValasztoNyitva(false);
                  }}
                  style={({ pressed }) => [
                    styles.pickerRow,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.rowText}>Nincs</Text>
                </Pressable>
                {(partnerek.data?.items ?? []).map((item) => (
                  <Pressable
                    key={item.customerId}
                    onPress={() => {
                      setPartner(item);
                      /* Partnert valtva a regi helyszin MAR NEM az ove -- es
                         vele a helyszinhez kotott eszkozok sem. */
                      setDepartmentId("");
                      setValasztottEszkozok([]);
                      setEszkozKereses("");
                      setEszkozOldal(1);
                      setPartnerValasztoNyitva(false);
                    }}
                    style={({ pressed }) => [
                      styles.pickerRow,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.rowText}>{item.name}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {partner ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Helyszín választása"
                  onPress={() => setHelyszinValasztoNyitva((open) => !open)}
                  style={({ pressed }) => [
                    styles.picker,
                    pressed && styles.pressed,
                  ]}
                  testID="helyszin-valaszto"
                >
                  <Text style={styles.rowText}>
                    {departmentId
                      ? `Helyszín: ${
                          helyszinek.data?.items?.find(
                            (item) => item.id === departmentId,
                          )?.name ?? departmentId
                        }`
                      : "Helyszín: nincs"}
                  </Text>
                </Pressable>

                {helyszinValasztoNyitva ? (
                  <View style={styles.pickerList}>
                    {helyszinek.isPending ? (
                      <ActivityIndicator color="#52d6c7" />
                    ) : null}
                    <Pressable
                      onPress={() => {
                        setDepartmentId("");
                        setHelyszinValasztoNyitva(false);
                        setValasztottEszkozok([]);
                        setEszkozKereses("");
                        setEszkozOldal(1);
                      }}
                      style={({ pressed }) => [
                        styles.pickerRow,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.rowText}>Nincs</Text>
                    </Pressable>
                    {(helyszinek.data?.items ?? []).map((item) => (
                      <Pressable
                        key={item.id}
                        onPress={() => {
                          setDepartmentId(item.id);
                          setHelyszinValasztoNyitva(false);
                          /*
                            HELYSZINT VALTVA A REGI ESZKOZOK MAR NEM ITT
                            ALLNAK. A szerver a helyszin (reszfastul) eszkozeit
                            fogadja el: egy ottfelejtett valasztas a TELJES
                            felvitelt elutasittatna, es a szerelo a helyszinen
                            egy olyan sor miatt allna meg, amit nem is lat.
                          */
                          setValasztottEszkozok([]);
                          setEszkozKereses("");
                          setEszkozOldal(1);
                        }}
                        style={({ pressed }) => [
                          styles.pickerRow,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text style={styles.rowText}>{item.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                {/*
                  AZ ESZKOZ-VALASZTO CSAK HELYSZINNEL EGYUTT JELENIK MEG.

                  Ugyanaz a sorrend, mint a helyszinnel: a szerver az eszkozt
                  CSAK helyszinnel egyutt fogadja el, mert a kert halmaz maga a
                  helyszin (reszfastul) eszkozeibol all. Egy mezo, amit ugyis
                  elutasitanak, csak a helyszinen derulne ki.
                */}
                {departmentId ? (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Eszköz választása a helyszínről"
                      onPress={() => setEszkozValasztoNyitva((open) => !open)}
                      style={({ pressed }) => [
                        styles.picker,
                        pressed && styles.pressed,
                      ]}
                      testID="eszkoz-valaszto"
                    >
                      <Text style={styles.rowText}>
                        {valasztottEszkozok.length
                          ? `Eszközök: ${valasztottEszkozok
                              .map((item) => item.nev)
                              .join(", ")}`
                          : "Eszközök: nincs"}
                      </Text>
                    </Pressable>

                    {eszkozValasztoNyitva ? (
                      <View style={styles.pickerList}>
                        <TextInput
                          accessibilityLabel="Eszköz keresése"
                          value={eszkozKereses}
                          onChangeText={(ertek) => {
                            setEszkozKereses(ertek);
                            /* UJ KERDES, ELSO LAP. Enelkul egy szukebb
                               keresesnel a harmadik lapon allnank, ami
                               ureskent jelenne meg -- ugy, mintha nem lenne
                               talalat. */
                            setEszkozOldal(1);
                          }}
                          style={styles.input}
                          placeholder="Keresés: azonosító, név, gyártó"
                          placeholderTextColor="#5c7e92"
                          autoCorrect={false}
                          testID="eszkoz-kereso"
                        />
                        {eszkozok.isPending ? (
                          <ActivityIndicator color="#52d6c7" />
                        ) : null}
                        {!eszkozok.isPending && !eszkozLista.length ? (
                          <Text style={styles.meta}>
                            Ezen a helyszínen ebben a keresésben nincs eszköz.
                          </Text>
                        ) : null}
                        {eszkozLista.map((item) => {
                          const valasztott = valasztottEszkozok.some(
                            (valasztas) => valasztas.id === item.id,
                          );
                          return (
                            <Pressable
                              key={item.id}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: valasztott }}
                              onPress={() =>
                                setValasztottEszkozok((eddigi) =>
                                  valasztott
                                    ? eddigi.filter(
                                        (valasztas) => valasztas.id !== item.id,
                                      )
                                    : [
                                        ...eddigi,
                                        {
                                          id: item.id,
                                          nev: `${item.assetNumber} -- ${item.name}`,
                                        },
                                      ],
                                )
                              }
                              style={({ pressed }) => [
                                styles.pickerRow,
                                pressed && styles.pressed,
                              ]}
                            >
                              <Text style={styles.rowText}>
                                {valasztott ? "\u2713 " : ""}
                                {item.assetNumber} -- {item.name}
                              </Text>
                            </Pressable>
                          );
                        })}
                        {/*
                          A LAPOZO AKKOR IS OTT ALL, HA MA EGY LAP VAN.

                          A legnagyobb reszfa ma 49 eszkoz, a lapmeret 50 --
                          egyetlen uj eszkoz atviszi a hataron. A lapszam
                          kiirasa ezt LATHATOVA teszi: egy "1 / 2" felirat
                          megmondja, hogy van tovabb, mielott barki hianyt
                          keresne.
                        */}
                        <View style={styles.pager}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Előző oldal"
                            disabled={eszkozOldal <= 1}
                            onPress={() =>
                              setEszkozOldal((oldal) => Math.max(1, oldal - 1))
                            }
                            style={[
                              styles.pagerButton,
                              eszkozOldal <= 1 && styles.pagerDisabled,
                            ]}
                          >
                            <Text style={styles.rowText}>Előző</Text>
                          </Pressable>
                          <Text style={styles.meta}>
                            {eszkozOldal} / {eszkozOldalakSzama}
                          </Text>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Következő oldal"
                            disabled={eszkozOldal >= eszkozOldalakSzama}
                            onPress={() =>
                              setEszkozOldal((oldal) =>
                                Math.min(eszkozOldalakSzama, oldal + 1),
                              )
                            }
                            style={[
                              styles.pagerButton,
                              eszkozOldal >= eszkozOldalakSzama &&
                                styles.pagerDisabled,
                            ]}
                          >
                            <Text style={styles.rowText}>Következő</Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}
          </View>
        )}

        <View style={styles.block}>
          <Text style={styles.sectionTitle}>Mi a hiba</Text>
          <TextInput
            accessibilityLabel="Mi a hiba"
            value={title}
            onChangeText={setTitle}
            style={styles.input}
            placeholder="pl. Zúg a szivattyú"
            placeholderTextColor="#5c7e92"
            editable={!save.isPending}
          />
          <TextInput
            accessibilityLabel="Leírás"
            value={description}
            onChangeText={setDescription}
            style={[styles.input, styles.inputMultiline]}
            placeholder="Részletek (elhagyható)"
            placeholderTextColor="#5c7e92"
            multiline
            editable={!save.isPending}
          />
        </View>

        {/*
          A FENYKEP ITT KESZUL, A JEGY MELLE -- ES OFFLINE IS.

          Balazs kerese szo szerint: "siman lehet hogy terero nelkul a
          pinceben eszrevesz egy hibat, meg akarja nyitni a hibajegyet es fotot
          is alar hozza rogziteni". A kep sorsa a jegy sorsat koveti: ha a jegy
          felment, a kep is; ha a jegy a sorba kerult, a kep MOGE all a
          sorban, es csak azutan megy fel, hogy a jegy megkapta az
          azonositojat.
        */}
        <View style={styles.block}>
          <Text style={styles.sectionTitle}>Fénykép</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fénykép készítése"
            onPress={() => void kepetKeszit()}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>Fénykép készítése</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Kép választása"
            onPress={() => void kepetValaszt()}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>Kép választása</Text>
          </Pressable>
          {photos.length > 0 ? (
            <View style={styles.photoRow}>
              <Text style={styles.meta}>{photos.length} fénykép a jegyhez</Text>
              <Pressable accessibilityRole="button" onPress={kepeketTorol}>
                <Text style={styles.clear}>Mind eldobása</Text>
              </Pressable>
            </View>
          ) : null}
          {photoNotice ? <Text style={styles.meta}>{photoNotice}</Text> : null}
        </View>

        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        {/*
          A LANC HARMADIK SZEME: MUNKALAP A SORBAN ALLO JEGY ALA.

          Balazs kerese szo szerint: "Sot lehet, hogy munkalapot is nyitna
          rogton." A jegynek MEG NINCS szerver-oldali azonositoja, ezert a lap a
          jegy MUVELET-azonositojara hivatkozik, es a sor oldja fel, amint a jegy
          felment.

          CSAK A SORBA TETT JEGY UTAN LATSZIK: ha a jegy felment, a kepernyo mar
          atlepett a jegy adatlapjara, es ott all ugyanez a gomb -- a szerver
          azonositojaval.
        */}
        {sorbanAlloJegy ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Munkalap nyitása ehhez a jegyhez"
            onPress={() =>
              router.push({
                pathname: "/worksheets/new",
                params: { serviceJobOperationId: sorbanAlloJegy },
              })
            }
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>
              Munkalap nyitása ehhez a jegyhez
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Hibajegy nyitása"
          accessibilityState={{ disabled: save.isPending }}
          disabled={save.isPending}
          onPress={() => {
            const baj = newServiceJobProblem({ title, description });
            if (baj) {
              setNotice(baj);
              return;
            }
            setNotice(null);
            save.mutate();
          }}
          style={styles.action}
        >
          <Text style={styles.actionText}>
            {save.isPending ? "Mentés..." : "Hibajegy nyitása"}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: "#06202e", flex: 1 },
  page: { gap: 12, padding: 16 },
  block: { backgroundColor: "#0d2a3a", borderRadius: 12, gap: 8, padding: 14 },
  sectionTitle: { color: "#eaf4fa", fontWeight: "600" },
  rowText: { color: "#eaf4fa" },
  /* A gep nelkuli felvitel valasztoi. Ugyanaz az alak, mint a
     munkalap-listaban: ugyanaz a mozdulat, ugyanaz a kinezet. */
  picker: {
    backgroundColor: "#06202e",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pickerList: { backgroundColor: "#06202e", borderRadius: 10, padding: 8 },
  pickerRow: {
    borderBottomColor: "#123b50",
    borderBottomWidth: 1,
    paddingVertical: 10,
  },
  /*
    A LAPOZO A VALASZTO ALJAN. Ugyanaz az alak, mint az eszkoz-listan
    (`app/assets/index.tsx`): ott mar bevalt, es ket kulonbozo lapozo ugyanabban
    az alkalmazasban ket kulonbozo mozdulatot tanitana.
  */
  pager: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    paddingTop: 10,
  },
  pagerButton: {
    backgroundColor: "#164057",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  pagerDisabled: { opacity: 0.5 },
  pressed: { opacity: 0.7 },
  meta: { color: "#9fc4d8", fontSize: 13 },
  warning: { color: "#f0c674", fontSize: 13, lineHeight: 18 },
  input: {
    backgroundColor: "#06202e",
    borderRadius: 10,
    color: "#eaf4fa",
    padding: 12,
  },
  inputMultiline: { minHeight: 96, textAlignVertical: "top" },
  action: {
    backgroundColor: "#12384c",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  actionText: { color: "#eaf4fa", textAlign: "center" },
  notice: { color: "#eaf4fa", lineHeight: 20 },
  secondary: {
    backgroundColor: "#0b3247",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  secondaryText: { color: "#cfe8f4", textAlign: "center" },
  photoRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  clear: { color: "#f0c674", fontSize: 13 },
  loading: { marginTop: 32 },
  empty: { color: "#9fc4d8", marginTop: 32, padding: 16, textAlign: "center" },
});
