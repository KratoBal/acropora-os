import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type * as ImagePicker from "expo-image-picker";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { OfflineNoticeCard } from "@/components/offline/OfflineNoticeCard";
import { toPickedImages } from "@/lib/api/picked-image";
import {
  pickPhotosFromLibrary,
  takePhotoFromCamera,
  type PhotoPickResult,
} from "@/lib/photos/pick-photos";
import { describeUploadFailure } from "@/lib/api/network-failure";
import { ApiNetworkError } from "@/lib/api/client";
import {
  getServiceJob,
  listServiceJobDocuments,
  moveServiceJob,
  setServiceJobDocumentCaption,
  uploadServiceJobPhotos,
  type ServiceJobStatusValue,
} from "@/lib/api/service-jobs";
import {
  describeDocuments,
  describeUnviewableDocument,
  formatDocumentSize,
  isViewableImage,
} from "@/lib/documents/document-view";
import { useDocumentImageSource } from "@/lib/documents/use-document-image-source";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import { useIsOnline } from "@/lib/offline/connectivity";
import { describeOfflineDetailNotice } from "@/lib/offline/offline-notice";
import {
  readCachedServiceJob,
  rememberServiceJobDetail,
} from "@/lib/offline/service-job-cache";
import { OFFLINE_COPY_NOTICE } from "@/lib/service-jobs/offline-copy-notice";
import {
  serviceJobStatusLabel,
  shortPath,
  worksheetLineLabel,
  worksheetsOf,
} from "@/lib/service-jobs/service-job-status";

/**
 * EGY HIBAJEGY A HELYSZÍNEN.
 *
 * AMIT ITT LEHET: elolvasni, léptetni az állapotot, fényképet tenni rá, és
 * megnyitni a hozzá tartozó munkalapot.
 *
 * AMIT NEM, ÉS A KÉPERNYŐ KI IS MONDJA: partnert váltani, delegálni,
 * csatolmányt törölni, munkalapot leválasztani. Mind iroda-művelet vagy
 * visszafordíthatatlan. Egy hiányzó gomb ugyanúgy néz ki, mint egy elromlott --
 * ezért nem elég kihagyni, meg is kell nevezni.
 *
 * TÉRERŐ NÉLKÜL A LAP OLVASHATÓ, DE NEM LÉPTETHETŐ. A szerver a LÁTOTT
 * állapotra ír feltételesen, tehát egy sorba tett lépés a sor kiürítésekor
 * bukna el, órákkal később -- amikor a szerelő már nincs a gépnél.
 */
export default function ServiceJobDetailScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;
  const online = useIsOnline();

  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const query = useQuery({
    queryKey: ["service-job", id],
    queryFn: () => getServiceJob(id!),
    enabled: status === "authenticated" && Boolean(id),
  });

  const cached = useQuery({
    queryKey: ["offline-service-job", id],
    queryFn: () => readCachedServiceJob(id!),
    enabled: status === "authenticated" && Boolean(id),
  });

  /**
   * A CSATOLMANYOK -- ES A LEKERDEZES A `view` KAPU ALATT ALL, NEM A `manage`
   * ALATT.
   *
   * Ez nem elhelyezesi izles: a MEGNEZES `service.view` alatt all, a FELTOLTES
   * `service.manage` alatt. Ha a galeria a feltolto szakasz kapujan BELUL allna,
   * a szerelo-nezo epp azt nem latna, amiert a kepek felkerultek -- es a
   * munkalap kepernyoje ugyanezt a dontest hordozza, sajat kommenttel.
   *
   * ES AMIERT MOST KERULT IDE, EGY MONDATBAN: a feltoltes 2026-09-17-ig SOHA nem
   * ment at a telefonrol (a futtato `fetch`-e eldobta a torzs fajl-reszet), tehat
   * ezen a lapon egyetlen kep sem volt, amit meg lehetett volna nezni. A
   * feltoltes aznap javult meg; ez a szakasz a masik fele.
   */
  const documents = useQuery({
    queryKey: ["service-job-documents", id],
    queryFn: () => listServiceJobDocuments(id!),
    enabled: Boolean(
      id && capabilities?.serviceJobsView && status === "authenticated",
    ),
  });

  /**
   * MELYIK KEP VAN EPP NAGYBAN. `null`, amig egyikre sem koppintottak.
   *
   * RATET, NEM `Modal`: ebben az appban ma nulla `Modal` all, es a bevezetese
   * KULON dontes lenne, minden ratettel egyszerre. Nem hozom meg itt.
   */
  const [nagyKep, setNagyKep] = useState<string | null>(null);
  /**
   * A FELIRAT PISZKOZATA -- CSAK A NAGYBAN NYITOTT KEPE.
   *
   * Egyszerre EGY kep felirata szerkesztheto, mert egyszerre egy kep van
   * nagyban. Csempenkenti allapot nem kell, es nem is lenne jo: ket nyitott
   * mezo mellett a szerelo nem latna, melyiket mentette.
   */
  const [felirat, setFelirat] = useState("");
  const [feliratHiba, setFeliratHiba] = useState<string | null>(null);
  const kepForras = useDocumentImageSource(
    /*
      AZ UTVONAL A KLIENS SAJAT `BASE`-EVEL EGYEZIK (`/service/jobs`), NEM a
      kepernyo mappanevevel. Elso alakom `/service/service-jobs` volt, a
      mappa utan -- es az a hiba NEMA lett volna: a lista betoltodik, a
      csempek megjelennek, es minden kep "nem tolthető be" felirattal all.
    */
    id ? `/service/jobs/${encodeURIComponent(id)}` : null,
  );

  useEffect(() => {
    if (!query.data) return;
    void rememberServiceJobDetail(query.data);
  }, [query.data]);

  const step = useMutation({
    mutationFn: (to: ServiceJobStatusValue) => moveServiceJob(id!, to, note),
    onSuccess: async (moved) => {
      setNote("");
      setNotice(`A jegy állapota: ${serviceJobStatusLabel(moved.status)}.`);
      await rememberServiceJobDetail(moved);
      queryClient.setQueryData(["service-job", id], moved);
      /**
       * A LISTA IS ELAVUL A LÉPÉSSEL. Enélkül a szerelő visszalép a listára, és
       * ott a RÉGI állapot áll -- ami úgy néz ki, mintha a mentés nem ment
       * volna át.
       */
      await queryClient.invalidateQueries({ queryKey: ["service-jobs"] });
    },
    onError: (error: unknown) =>
      setNotice(
        error instanceof Error
          ? error.message
          : "A léptetés nem ment át. Próbáld újra.",
      ),
  });

  /**
   * A FELIRAT MENTESE -- ES UTANA A LISTA UJRATOLT.
   *
   * Nem a helyi allapotot irjuk at: a csempe a SZERVER szerinti allapotot
   * mutassa. Egy elutasitott mentes utan kulonben a sajat begepelt szoveg
   * allna tovabb a kepernyon, mintha mentve lenne.
   *
   * A MEZO CSAK SIKER UTAN URUL: ha a hivas elbukik, a begepelt szoveg
   * OTTMARAD. Egy elveszett felirat ujra leirando, es a masodik nekifutas
   * ugyanolyan hosszu lenne, mint az elso -- kesztyuben, a gepnel.
   */
  const feliratMentes = useMutation({
    mutationFn: (bemenet: { documentId: string; caption: string | null }) =>
      setServiceJobDocumentCaption(id!, bemenet.documentId, bemenet.caption),
    onSuccess: async () => {
      setFeliratHiba(null);
      await queryClient.invalidateQueries({
        queryKey: ["service-job-documents", id],
      });
    },
    onError: (error: unknown) => {
      setFeliratHiba(
        error instanceof ApiNetworkError
          ? "A felirat nem ment el: a szerver most nem érhető el."
          : error instanceof Error
            ? error.message
            : "A felirat mentése nem sikerült.",
      );
    },
  });

  /**
   * A FÉNYKÉP FELTÖLTÉSE -- ÉS EZ MARAD A KÉPERNYŐN, SZÁNDÉKOSAN.
   *
   * A készülék felé néző fél (engedély, választó, megszakítás) 2026-09-17 óta a
   * `lib/photos/pick-photos.ts`-ben áll, és ez a képernyő volt az utolsó, ami
   * kézzel írta. A KÉPEK SORSA viszont nem költözik oda: ez egy MÁR LÉTEZŐ lap,
   * tehát a kép azonnal felmegy, és a hívás a jegy azonosítóját meg a jegy saját
   * lista-kulcsát használja.
   *
   * ÉS EZÉRT NEM A `usePhotoAttachments` HOROG JÁR IDE. Az GYŰJT: állapotban
   * tartja a képeket, amíg a rekord el nem készül. Egy ilyen már létező lapon a
   * gyűjtés a BUKÁSNÁL romlana el -- egy sikertelen feltöltés után a képek bent
   * maradnának, és a következő választás MEGINT elküldené őket, tehát két
   * példány kerülne ugyanabból a képből. A `pick-photos.ts` fejléce ezt a két
   * fajtát külön is megnevezi.
   */
  const uploadPicked = async (assets: ImagePicker.ImagePickerAsset[]) => {
    const { files, skipped } = toPickedImages(assets);
    if (files.length === 0) {
      setNotice(
        "Egyik kiválasztott kép sem tölthető fel: csak JPEG és PNG megy.",
      );
      return;
    }
    if (!id) return;

    setUploading(true);
    try {
      const created = await uploadServiceJobPhotos(id, files);
      // A KIHAGYOTTAKAT AKKOR IS KIMONDJUK, ha a többi sikerült: egy néma
      // részleges siker azt a hitet hagyná, hogy minden kép fent van.
      setNotice(
        skipped.length > 0
          ? `${created.length} kép feltöltve. Kimaradt: ${skipped.join(", ")}.`
          : `${created.length} kép feltöltve.`,
      );

      /**
       * ES A LISTA IS FRISSUL, KULONBEN A FRISS KEP NEM JELENIK MEG.
       *
       * Enelkul a szerelo PONTOSAN azt latna, amit a mai hianynal: feltoltott,
       * es nincs sehol. A galeria-szakasz epp ezert keszult, tehat a feltoltes
       * ervenytelenitese nem kiegeszites, hanem a szakasz resze.
       */
      await queryClient.invalidateQueries({
        queryKey: ["service-job-documents", id],
      });
    } catch (error) {
      /**
       * A BUKAS MEGMONDJA, MI TORTENT -- lasd `lib/api/network-failure.ts`.
       */
      setNotice(
        describeUploadFailure({
          error,
          uris: files.map((f) => f.uri),
          networkFailure: error instanceof ApiNetworkError,
        }),
      );
    } finally {
      setUploading(false);
    }
  };

  /**
   * A HÁROM ÁLLAPOT SZÉTVÁLASZTVA, ÉS EZ NEM KOZMETIKA.
   *
   * A megszakítás NEM üzenet: a szerelő tudja, hogy ő lépett vissza. A
   * megtagadás viszont IGEN, mert különben egy letiltott kamera ugyanúgy néz
   * ki, mint a saját visszalépése -- semmi nem történik.
   */
  const feltoltAValasztasbol = async (eredmeny: PhotoPickResult) => {
    if (eredmeny.kind === "denied") {
      setNotice(eredmeny.notice);
      return;
    }
    if (eredmeny.kind === "cancelled") return;
    await uploadPicked(eredmeny.assets);
  };

  /** AZ ELSŐDLEGES ÚT: most készül a kép, a helyszínen. */
  const takePhoto = async () => {
    if (!id || uploading) return;
    setNotice(null);
    await feltoltAValasztasbol(await takePhotoFromCamera());
  };

  /** A MÁSODIK ÚT: egy korábban készült kép a galériából. */
  const pickPhotos = async () => {
    if (!id || uploading) return;
    setNotice(null);
    await feltoltAValasztasbol(await pickPhotosFromLibrary());
  };

  if (status === "unauthenticated") return <Redirect href="/login" />;
  if (status === "authenticated" && !capabilities?.serviceJobsView)
    return <Redirect href="/" />;

  /**
   * A MENTETT LAP CSAK AKKOR KERÜL ELŐ, HA A SZERVER NEM VÁLASZOLT -- és akkor
   * is KIMONDJUK, hogy másolatot néz. Egy csendes visszaesés a tegnapi adatra
   * pontosan úgy nézne ki, mint a mai.
   */
  const detail = query.data ?? cached.data?.detail ?? null;
  const masolatbol = !query.data && detail !== null;

  /*
    A CSATOLMANYOK SZARMAZTATOTT ERTEKEI. A kepek es a NEM megnezheto fajlok
    kulon allnak: a natív kepbetolto nem rajzol ki PDF-et, es egy torott csempe
    ugyanugy nez ki, mint egy elromlott kep.
  */
  const csatolmanyok = documents.data?.items ?? [];
  const kepek = csatolmanyok.filter((d) => isViewableImage(d.contentType));
  /** A nagyban nyitott kep SORA, nem csak az azonositoja: a felirat is kell. */
  const nagyKepSor = csatolmanyok.find((d) => d.id === nagyKep) ?? null;
  const egyebek = csatolmanyok.filter((d) => !isViewableImage(d.contentType));
  const csatolmanyNotice = describeDocuments({
    loading: documents.isPending,
    error: documents.isError,
    total: csatolmanyok.length,
    images: kepek.length,
  });
  const offlineNotice = describeOfflineDetailNotice({
    online: online && !query.isError,
    hasFullCopy: detail !== null,
    syncedAt: cached.data?.syncedAt ?? null,
    now: new Date(),
  });

  if (!detail)
    return (
      <SafeAreaView style={styles.safeArea}>
        {query.isPending ? (
          <ActivityIndicator style={styles.loading} />
        ) : (
          <Text style={styles.empty}>
            {online
              ? "Ez a hibajegy nem tölthető be."
              : "Nincs kapcsolat, és ez a jegy nincs mentve erre a készülékre. Térerőnél nyisd meg egyszer."}
          </Text>
        )}
      </SafeAreaView>
    );

  const lephet = masolatbol ? [] : detail.allowedSteps;

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.page}>
        {offlineNotice ? <OfflineNoticeCard notice={offlineNotice} /> : null}

        <View style={styles.block}>
          <Text style={styles.number}>{detail.jobNumber}</Text>
          <Text style={styles.title}>{detail.title}</Text>
          <Text style={styles.status}>
            {serviceJobStatusLabel(detail.status)}
          </Text>
          {detail.customerName ? (
            <Text style={styles.meta}>{detail.customerName}</Text>
          ) : null}
          {shortPath(detail.departmentPath) ? (
            <Text style={styles.meta}>{shortPath(detail.departmentPath)}</Text>
          ) : null}
          {detail.description ? (
            <Text style={styles.description}>{detail.description}</Text>
          ) : null}
        </View>

        {detail.assets.length > 0 ? (
          <View style={styles.block}>
            <Text style={styles.sectionTitle}>Érintett eszközök</Text>
            {detail.assets.map((asset) => (
              <Pressable
                key={asset.id}
                accessibilityRole="button"
                accessibilityLabel={`${asset.assetNumber} ${asset.assetName}`}
                // AZ `assetId`, NEM AZ `id`: az utobbi a CSATOLAS sora, es egy
                // nem letezo eszkoz-lapra vinne.
                onPress={() => router.push(`/assets/${asset.assetId}`)}
                style={styles.row}
              >
                <Text style={styles.rowText}>
                  {asset.assetNumber} -- {asset.assetName}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={styles.block}>
          <Text style={styles.sectionTitle}>Munkalapok</Text>
          {/*
            A MUNKALAPOK AZ IDOVONALBOL JONNEK, nem egy `worksheets` mezobol: a
            valaszban olyan kulcs NINCS. Az elso alakom azt olvasta, es a lap
            `undefined.length`-en omlott ossze, MEGNYITASKOR.
          */}
          {worksheetsOf(detail.timeline).length === 0 ? (
            <Text style={styles.meta}>Még nincs munkalap ezen a jegyen.</Text>
          ) : (
            worksheetsOf(detail.timeline).map((sheet) => (
              <Pressable
                key={sheet.id}
                accessibilityRole="button"
                accessibilityLabel={`Munkalap: ${worksheetLineLabel(sheet)}`}
                onPress={() => router.push(`/worksheets/${sheet.id}`)}
                style={styles.row}
              >
                <Text style={styles.rowText}>{worksheetLineLabel(sheet)}</Text>
              </Pressable>
            ))
          )}
          {/*
            AZ ÚJ MUNKALAP A MEGLÉVŐ KÉPERNYŐRE VISZ, nem ide épül újra: a
            felvitel ott már kész, offline sorral együtt. Egy második űrlap
            KÜLÖN romlana el.

            A JEGY AZONOSÍTÓJA MOSTANTÓL ÁTMEGY, és ez egy néma hiányt zár be:
            a gomb címkéje eddig is azt ígérte, hogy „ehhez a jegyhez", a
            navigáció viszont üres űrlapot nyitott, és a lap a jegy NÉLKÜL jött
            létre. A hiba nem hibázott: a lap felkerült, csak sehol nem
            hivatkozott a bejelentésre.
          */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Új munkalap ehhez a jegyhez"
            onPress={() =>
              router.push({
                pathname: "/worksheets/new",
                params: { serviceJobId: id },
              })
            }
            style={styles.action}
          >
            <Text style={styles.actionText}>Új munkalap</Text>
          </Pressable>
        </View>

        {/*
          A CSATOLMANYOK A `manage` KAPUN KIVUL ALLNAK -- lasd a lekerdezes
          kommentjet. Aki a lapot latja, a hozza tartozo kepeket is lathatja.
        */}
        <View style={styles.block}>
          <Text style={styles.sectionTitle}>
            Csatolmányok ({csatolmanyok.length})
          </Text>
          {csatolmanyNotice ? (
            <Text style={styles.meta}>{csatolmanyNotice}</Text>
          ) : null}

          {kepek.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.galeria}>
                {kepek.map((kep) => {
                  const forras = kepForras.csempe(kep.id);
                  return (
                    <Pressable
                      key={kep.id}
                      accessibilityRole="imagebutton"
                      accessibilityLabel={`${kep.fileName} megnyitása nagyban`}
                      disabled={forras === null}
                      onPress={() => {
                        setNagyKep(kep.id);
                        // A PISZKOZAT A SZERVER SZERINTI ALLAPOTBOL INDUL, nem
                        // az elozo kepe mellol: kulonben az egyik kep felirata
                        // atlatszana a masikra.
                        setFelirat(kep.caption ?? "");
                        setFeliratHiba(null);
                      }}
                      style={({ pressed }) => [
                        styles.csempe,
                        pressed && styles.pressed,
                      ]}
                    >
                      {forras ? (
                        <Image
                          source={forras}
                          style={styles.csempeKep}
                          resizeMode="cover"
                          accessibilityLabel={kep.fileName}
                        />
                      ) : (
                        /*
                          A HIANYZO FORRAS NEM NEMA. Enelkul egy ures csempe
                          allna itt, ami pontosan ugy nez ki, mint egy elromlott
                          kep -- es epp az a hiba, amit ez a szakasz javit.
                        */
                        <View style={styles.csempeKep}>
                          <Text style={styles.meta}>nem tölthető be</Text>
                        </View>
                      )}
                      {/*
                        A FELIRAT A MERET FOLOTT ALL, es ez nem elrendezesi
                        izles: a felirat azt mondja meg, MIT LATUNK, a meret
                        csak azt, mekkora a fajl. A kettobol az elso az, amit a
                        szerelo keres. Ha nincs felirat, a sor sem all ott --
                        egy ures sor helyet foglalna a csempen.
                      */}
                      {kep.caption ? (
                        <Text style={styles.csempeFelirat} numberOfLines={2}>
                          {kep.caption}
                        </Text>
                      ) : null}
                      <Text style={styles.csempeMeret}>
                        {formatDocumentSize(kep.sizeBytes)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          ) : null}

          {egyebek.map((doc) => (
            <Text key={doc.id} style={styles.meta}>
              {describeUnviewableDocument(doc)}
            </Text>
          ))}
        </View>

        {capabilities?.serviceJobsManage ? (
          <View style={styles.block}>
            <Text style={styles.sectionTitle}>Állapot léptetése</Text>
            {masolatbol ? (
              <Text style={styles.meta}>{OFFLINE_COPY_NOTICE.step}</Text>
            ) : lephet.length === 0 ? (
              <Text style={styles.meta}>
                Ebből az állapotból nincs több lépés.
              </Text>
            ) : (
              <>
                <TextInput
                  accessibilityLabel="Megjegyzés a lépéshez"
                  value={note}
                  onChangeText={setNote}
                  style={styles.input}
                  placeholder="Megjegyzés (elhagyható)"
                  placeholderTextColor="#5c7e92"
                  multiline
                  editable={!step.isPending}
                />
                {lephet.map((to) => (
                  <Pressable
                    key={to}
                    accessibilityRole="button"
                    accessibilityLabel={serviceJobStatusLabel(to)}
                    disabled={step.isPending}
                    onPress={() => step.mutate(to)}
                    style={styles.action}
                  >
                    <Text style={styles.actionText}>
                      {serviceJobStatusLabel(to)}
                    </Text>
                  </Pressable>
                ))}
              </>
            )}
          </View>
        ) : null}

        {capabilities?.serviceJobsManage ? (
          /*
            A SZAKASZ OFFLINE IS ITT ALL, A GOMBOK TILTVA -- NEM TUNIK EL.
            Az elso alakjaban `!masolatbol` mellett a TELJES szakasz kiesett,
            egyetlen szo nelkul, mikozben a leptetes KIMONDTA, miert nem megy.
            Ket kihagyas egy kepernyon, ket kulonbozo viselkedessel -- es a
            sajat szabalyunk (a mentett masolat soha nem nema) az elsore allt,
            a masodikra nem.
          */
          <View style={styles.block}>
            <Text style={styles.sectionTitle}>Fénykép</Text>
            {masolatbol ? (
              <Text style={styles.meta}>{OFFLINE_COPY_NOTICE.photo}</Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Fénykép készítése"
              accessibilityState={{ disabled: uploading || masolatbol }}
              disabled={uploading || masolatbol}
              onPress={() => void takePhoto()}
              style={[styles.action, masolatbol && styles.actionDisabled]}
            >
              <Text style={styles.actionText}>Fénykép készítése</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Kép választása a galériából"
              accessibilityState={{ disabled: uploading || masolatbol }}
              disabled={uploading || masolatbol}
              onPress={() => void pickPhotos()}
              style={[styles.action, masolatbol && styles.actionDisabled]}
            >
              <Text style={styles.actionText}>Kép a galériából</Text>
            </Pressable>
          </View>
        ) : null}

        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        {/*
          A KIHAGYÁSOK KIMONDVA. A szerelő ne azt higgye, hogy elromlott valami,
          amikor egy művelet nincs itt -- és ne is keresse hiába.
        */}
        <Text style={styles.hint}>
          Partnert váltani, delegálni, csatolmányt törölni és munkalapot
          leválasztani a webes felületen lehet.
        </Text>
      </ScrollView>

      {/*
        RATETKENT NYILIK, NEM MASIK KEPERNYON: masik lapra navigalva a
        kepernyo allapota (a beirt jegyzet, a feltoltes-jelzes) ELVESZNE, mert
        ujra epulne.
      */}
      {nagyKep ? (
        <View style={styles.nagyRatet}>
          {(() => {
            const forras = kepForras.teljes(nagyKep);
            return forras ? (
              <Image
                source={forras}
                style={styles.nagyKep}
                resizeMode="contain"
                accessibilityLabel="A csatolmány nagyban"
              />
            ) : (
              <Text style={styles.meta}>A kép most nem tölthető be.</Text>
            );
          })()}
          {/*
            A FELIRAT ITT ALL, ES NEM A CSEMPEN.
            
            A csempe 104 pont szeles: ott egy beviteli mezo hasznalhatatlan
            lenne, es a kep sem latszana mellette. Nagyban viszont EPP az a kep
            van a szerelo elott, amit meg akar nevezni.
          */}
          {nagyKepSor?.caption ? (
            <Text style={styles.nagyFelirat}>{nagyKepSor.caption}</Text>
          ) : null}

          {capabilities?.serviceJobsManage && nagyKepSor ? (
            masolatbol ? (
              <Text style={styles.meta}>{OFFLINE_COPY_NOTICE.caption}</Text>
            ) : (
              <>
                <TextInput
                  accessibilityLabel="A kép felirata"
                  value={felirat}
                  onChangeText={setFelirat}
                  style={styles.input}
                  placeholder="Mit látunk a képen?"
                  placeholderTextColor="#5c7e92"
                  maxLength={500}
                  editable={!feliratMentes.isPending}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Felirat mentése"
                  disabled={feliratMentes.isPending}
                  onPress={() =>
                    feliratMentes.mutate({
                      documentId: nagyKepSor.id,
                      /*
                        AZ URES MEZO TORLEST JELENT, es `null`-kent megy le --
                        nem ures stringkent. Ket alak mellett a "nincs felirat"
                        es a "szandekosan ures felirat" megkulonboztethetetlen
                        lenne, es a szerver ugyanezt a szabalyt mondja ki.
                      */
                      caption: felirat.trim() ? felirat.trim() : null,
                    })
                  }
                  style={({ pressed }) => [
                    styles.action,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.actionText}>
                    {feliratMentes.isPending
                      ? "Mentés folyamatban…"
                      : "Felirat mentése"}
                  </Text>
                </Pressable>
                {feliratHiba ? (
                  <Text style={styles.meta}>{feliratHiba}</Text>
                ) : null}
              </>
            )
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Kép bezárása"
            onPress={() => {
              setNagyKep(null);
              setFeliratHiba(null);
            }}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Text style={styles.actionText}>Bezárás</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: "#06202e", flex: 1 },
  page: { gap: 12, padding: 16 },
  block: { backgroundColor: "#0d2a3a", borderRadius: 12, gap: 8, padding: 14 },
  number: { color: "#9fc4d8", fontSize: 13 },
  title: { color: "#eaf4fa", fontSize: 18, fontWeight: "600" },
  status: { color: "#9fc4d8" },
  meta: { color: "#9fc4d8", fontSize: 13 },
  description: { color: "#eaf4fa", lineHeight: 20 },
  sectionTitle: { color: "#eaf4fa", fontWeight: "600" },
  row: { paddingVertical: 8 },
  rowText: { color: "#eaf4fa" },
  action: {
    backgroundColor: "#12384c",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  actionText: { color: "#eaf4fa", textAlign: "center" },
  /** A tiltott gomb LATSZIK, csak halvanyabb: a hianyzo gomb nem magyaraz. */
  actionDisabled: { opacity: 0.45 },
  input: {
    backgroundColor: "#06202e",
    borderRadius: 10,
    color: "#eaf4fa",
    minHeight: 64,
    padding: 12,
  },
  galeria: { flexDirection: "row", gap: 10, paddingVertical: 4 },
  csempe: { gap: 4, width: 104 },
  csempeKep: {
    width: 104,
    height: 104,
    borderRadius: 10,
    backgroundColor: "#08192a",
    borderColor: "#17394f",
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  csempeFelirat: { color: "#eaf4fa", fontSize: 12, textAlign: "center" },
  csempeMeret: { color: "#789cad", fontSize: 11, textAlign: "center" },
  nagyFelirat: { color: "#eaf4fa", fontSize: 15, textAlign: "center" },
  nagyRatet: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#03101acc",
    justifyContent: "center",
    gap: 16,
    padding: 20,
  },
  nagyKep: { flex: 1, width: "100%", borderRadius: 12 },
  pressed: { opacity: 0.75 },
  loading: { marginTop: 32 },
  empty: { color: "#9fc4d8", marginTop: 32, padding: 16, textAlign: "center" },
  notice: { color: "#eaf4fa", lineHeight: 20 },
  hint: { color: "#9fc4d8", fontSize: 13, lineHeight: 18 },
});
