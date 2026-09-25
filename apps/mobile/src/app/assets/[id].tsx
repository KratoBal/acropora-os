import { useQuery } from "@tanstack/react-query";
import type * as ImagePicker from "expo-image-picker";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
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
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  getAsset,
  setAssetDocumentCaption,
  uploadAssetDocuments,
} from "@/lib/api/assets";
import { MAX_FILES_PER_UPLOAD } from "@/lib/api/document-upload";
import {
  describeDocuments,
  describeUnviewableDocument,
  formatDocumentSize,
  isViewableImage,
} from "@/lib/documents/document-view";
import { DocumentImage } from "@/components/documents/DocumentImage";
import { toPickedImages } from "@/lib/api/picked-image";
import {
  pickPhotosFromLibrary,
  takePhotoFromCamera,
  type PhotoPickResult,
} from "@/lib/photos/pick-photos";
import { describeUploadFailure } from "@/lib/api/network-failure";
import { ApiNetworkError } from "@/lib/api/client";
import { ASSET_STATUS_LABELS } from "@/lib/assets/asset-status";
import { ASSET_CRITICALITY_LABELS } from "@/lib/assets/asset-criticality";
import { ASSET_KIND_LABELS } from "@/lib/assets/asset-kind";
import { assetPlacementDetail } from "@/lib/assets/asset-placement";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import { OfflineNoticeCard } from "@/components/offline/OfflineNoticeCard";
import {
  readCachedAsset,
  rememberAssetDetail,
} from "@/lib/offline/asset-cache";
import { useIsOnline } from "@/lib/offline/connectivity";
import { describeOfflineDetailNotice } from "@/lib/offline/offline-notice";
import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";

export default function AssetDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;
  const online = useIsOnline();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const query = useQuery({
    queryKey: ["service-asset", id],
    queryFn: () => getAsset(id!),
    enabled:
      status === "authenticated" && Boolean(id && capabilities?.assetsView),
  });

  const cached = useQuery({
    queryKey: ["offline-asset", id],
    queryFn: () => readCachedAsset(id!),
    enabled:
      status === "authenticated" && Boolean(id && capabilities?.assetsView),
  });

  // Amit térerővel megnyitottak, az offline is TELJES lap marad. Enélkül a
  // készüléken csak a listasor lenne meg, és a leírás, a beszerelés dátuma meg
  // a részegységek felsorolása a helyszínen hiányozna.
  useEffect(() => {
    if (!query.data) return;
    void rememberAssetDetail(query.data);
  }, [query.data]);

  const [uploading, setUploading] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);

  /** Melyik kep van epp nagyban. Ratet, nem `Modal` -- ebben az appban ma nulla
   * `Modal` all, es a bevezetese kulon dontes lenne, minden ratettel egyszerre. */
  const [nagyKep, setNagyKep] = useState<string | null>(null);
  /*
    A FELIRAT PISZKOZATA ES A MENTES ALLAPOTA.

    A piszkozat a SZERVER SZERINTI ertekbol indul, valahanyszor egy kep
    nagyban megnyilik -- nem az elozo kep mellol. Enelkul az egyik kep
    felirata atlatszana a masikra, es a szerelo azt irna felul, amit lat.
  */
  const [felirat, setFelirat] = useState("");
  const [feliratHiba, setFeliratHiba] = useState<string | null>(null);
  const [feliratMentes, setFeliratMentes] = useState(false);
  // AZ UTVONAL A KLIENS SAJAT `BASE`-EVEL EGYEZIK, nem a kepernyo mappajaval.
  // A hibajegynel elso alakom a mappanevet hasznalta, es a hiba NEMA lett
  // volna: a csempek megjelennek, es minden kep "nem tolthető be".
  //
  // A BAJTOKAT INNENTOL A `DocumentImage` KERI LE, a tokennel egyutt, es helyi
  // fajlba irja: a nativ betolto Authorization fejlecet NEM kuld, es ezen a
  // ket lapon eddig ugyanaz a 401 allt, mint a hibajegyen.
  const gazdaUtvonal = id ? `/service/assets/${encodeURIComponent(id)}` : null;

  /**
   * FÉNYKÉP AZ ESZKÖZHÖZ, A HELYSZÍNRŐL. KÉT BEMENET, EGY ÚT.
   *
   * A FÉNYKÉPEZÉS AZ ELSŐDLEGES, A GALÉRIA A MÁSODIK, és ez nem esztétikai
   * sorrend: a szerelő a helyszínen MOST készít képet, nem régit keres
   * (Balázs, 2026-09-02). Aki a gombokat "kiegyensúlyozottabb" elrendezés
   * kedvéért megcserélné, a napi munkát fordítaná meg.
   *
   * A KÉT BEMENET UGYANABBA A SORBA KERÜL: ugyanaz a típus-felismerés, ugyanaz
   * a feltöltés, ugyanazok az üzenetek. Két külön út két helyen romlana el.
   *
   * CSAK KÉP, NEM DOKUMENTUM. A számla és a garancialevél az irodából kerül
   * fel, ahol a webes felület már tud fájlt fogadni.
   */
  const uploadPicked = async (assets: ImagePicker.ImagePickerAsset[]) => {
    // A VÁLASZTÁS EREDMÉNYÉT NEM KÜLDJÜK EL VAKON. A szerver a bejelentett
    // típust és a fájl első bájtjait együtt nézi, tehát egy formátum, amit nem
    // ismerünk fel, biztos elutasítás lenne - azt inkább itt hagyjuk ki, és
    // megnevezzük, minthogy a szerelő egy hálózati kör után lássa.
    const { files, skipped } = toPickedImages(assets);
    if (files.length === 0) {
      setUploadNotice(
        "Egyik kiválasztott kép sem tölthető fel: csak JPEG és PNG megy.",
      );
      return;
    }
    if (!query.data) return;

    setUploading(true);
    try {
      // A FAJTAT NEM MI DONTJUK EL: a szerver a fajl bajtjaibol allapitja meg,
      // fajlonkent (kep -> PHOTO, minden mas -> OTHER). Ide beirni egy allando
      // erteket azt jelentene, hogy a fajta nem a fajlrol allit valamit, hanem
      // arrol, melyik kepernyorol indult a feltoltes.
      const created = await uploadAssetDocuments(query.data.id, { files });
      // A KIHAGYOTTAKAT AKKOR IS KIMONDJUK, HA A TÖBBI SIKERÜLT. Egy néma
      // részleges siker azt a hitet hagyná, hogy mind a kép fent van.
      setUploadNotice(
        skipped.length > 0
          ? `${created.length} kép feltöltve. Kimaradt: ${skipped.join(", ")}.`
          : `${created.length} kép feltöltve.`,
      );
      void query.refetch();
    } catch (error) {
      /**
       * A BUKAS MEGMONDJA, MI TORTENT. A halozati agon a mai mondat ("a
       * szerver nem erheto el") ELHALLGATJA, mit panaszol a telefon -- es
       * emiatt kerestuk harom korben vakon, mi hal el.
       */
      setUploadNotice(
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
   * AZ ELSŐDLEGES ÚT: MOST KÉSZÜL A KÉP.
   *
   * A MEGTAGADOTT JOG NEM ZSÁKUTCA. Ha a szerelő nem ad kamera-hozzáférést (a
   * telefon beállításaiban letiltva, vagy egyszer rányomott a "Ne engedd"
   * gombra), akkor nem egy hibaüzenetet kap és semmi mást: az üzenet
   * megmondja, hol állítható, ÉS ott marad a galéria mint járható út.
   */
  /**
   * A HAROM ALLAPOT SZETVALASZTVA, ES EZ NEM KOZMETIKA.
   *
   * A megszakitas NEM uzenet: a szerelo tudja, hogy o lepett vissza. A
   * megtagadas viszont IGEN, mert kulonben egy letiltott kamera ugyanugy nez
   * ki, mint a sajat visszalepese -- semmi nem tortenik.
   */
  const feltoltAValasztasbol = async (eredmeny: PhotoPickResult) => {
    if (eredmeny.kind === "denied") {
      setUploadNotice(eredmeny.notice);
      return;
    }
    if (eredmeny.kind === "cancelled") return;
    await uploadPicked(eredmeny.assets);
  };

  const takeAndUploadPhoto = async () => {
    if (!query.data || uploading) return;
    setUploadNotice(null);
    await feltoltAValasztasbol(await takePhotoFromCamera());
  };

  /*
    A FELIRAT MENTESE. A KEPERNYON MA NINCS `useMutation`, es nem is hozok be
    egyet: a feltoltes is sajat allapottal es `query.refetch()`-csel dolgozik,
    es ket kulonbozo frissitesi minta egy lapon azt jelentene, hogy a kettonek
    MAS a viselkedese -- holott ugyanaz.
  */
  const feliratMentese = async (documentId: string) => {
    if (feliratMentes) return;
    setFeliratMentes(true);
    setFeliratHiba(null);
    try {
      /*
        AZ URES MEZO TORLEST JELENT, es `null`-kent megy le -- nem ures
        stringkent. Ket alak mellett a "nincs felirat" es a "szandekosan ures
        felirat" megkulonboztethetetlen lenne, es a szerver ugyanezt a
        szabalyt mondja ki.
      */
      await setAssetDocumentCaption(
        id!,
        documentId,
        felirat.trim() ? felirat.trim() : null,
      );
      void query.refetch();
    } catch (cause) {
      setFeliratHiba(
        cause instanceof Error ? cause.message : "A felirat nem menthető.",
      );
    } finally {
      setFeliratMentes(false);
    }
  };

  /** A MÁSODIK ÚT: egy korábban készült kép a galériából. */
  const pickAndUploadPhotos = async () => {
    if (!query.data || uploading) return;
    setUploadNotice(null);
    await feltoltAValasztasbol(await pickPhotosFromLibrary());
  };

  if (status !== "authenticated" || !user) return <Redirect href="/login" />;
  if (!capabilities?.assetsView) return <Redirect href="/" />;

  /*
   * A MENTETT LAP CSAK AKKOR KERÜL ELŐ, HA A SZERVER NEM VÁLASZOLT, és akkor is
   * két különböző dolog lehet: a térerővel megnyitott TELJES lap, vagy csak az
   * a sor, ami a listán átjött. A kettő nem ugyanaz, és a sáv kimondja, melyik.
   */
  const cachedDetail = cached.data?.detail ?? null;
  const cachedSummary = cached.data?.summary ?? null;
  const asset = query.data ?? cachedDetail;
  const fromCache = !query.data && Boolean(cachedDetail ?? cachedSummary);

  /*
    A CSATOLMANYOK A MAR LEKERT VALASZBOL JONNEK, nem masodik hivasbol.
    A `loading`/`error` a MEGLEVO lekerdezes allapota: ha az bukik, a lap sem
    all ossze, tehat a szakasz nem tud kulon elromlani.
  */
  const csatolmanyok = asset?.documents ?? [];
  const kepek = csatolmanyok.filter((d) => isViewableImage(d.contentType));
  const egyebek = csatolmanyok.filter((d) => !isViewableImage(d.contentType));
  /*
    A NAGYBAN NYITOTT KEP SORA. A ratet eddig csak az AZONOSITOT tartotta, es a
    kephez ennyi eleg is volt -- a felirathoz viszont a SOR kell, mert az
    hordozza a mai erteket es azt, amit a mentes utan vissza kell olvasni.
  */
  const nagyKepSor = csatolmanyok.find((d) => d.id === nagyKep) ?? null;
  const csatolmanyNotice = describeDocuments({
    loading: query.isPending && !asset,
    error: query.isError && !asset,
    total: csatolmanyok.length,
    images: kepek.length,
  });
  const notice = fromCache
    ? describeOfflineDetailNotice({
        online: online && !query.isError,
        hasFullCopy: Boolean(cachedDetail),
        syncedAt: cached.data?.syncedAt ?? null,
        now: new Date(),
      })
    : null;

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.container}>
        {notice ? <OfflineNoticeCard notice={notice} /> : null}
        {query.isPending && !fromCache ? (
          <ActivityIndicator color={tokens.accent} />
        ) : null}
        {query.isError && !fromCache ? (
          <MessageCard
            title="Az eszköz nem tölthető be"
            message={
              query.error instanceof Error
                ? query.error.message
                : "Ismeretlen hiba történt."
            }
            onRetry={() => void query.refetch()}
          />
        ) : null}
        {/*
          CSAK A LISTASOR VAN MEG. Ilyenkor a teljes adatlapot nem lehet
          összerakni -- a részegységek felsorolása, a leírás és a dátumok nem
          jöttek át a listán --, és a hiányzó mezőket a repó szabálya szerint
          nem üres sorként mutatjuk. A sáv fölötte mondja ki, miért hiányoznak.
        */}
        {!asset && cachedSummary ? (
          <>
            <View style={styles.hero}>
              <Text style={styles.number}>{cachedSummary.assetNumber}</Text>
              <Text style={styles.title}>{cachedSummary.name}</Text>
              <View style={styles.badges}>
                <Text style={styles.badge}>
                  {ASSET_KIND_LABELS[cachedSummary.kind]}
                </Text>
                <Text style={styles.badge}>
                  {ASSET_STATUS_LABELS[cachedSummary.status]}
                </Text>
              </View>
            </View>

            <Section title="Elhelyezés">
              <Info
                label="Tulajdonos"
                value={cachedSummary.owner.displayName}
              />
              <Info label="Partnerkód" value={cachedSummary.owner.code} />
              {/*
                A MENTETT LISTASOR IS HORDOZZA AZ ALEGYSÉGET, tehát a hiányos,
                offline lapon is meg tudjuk mondani, hol áll az eszköz. A
                korábban mentett másolatokban is ott van: a másolat a szerver
                nyers válaszát tárolja, nem a típus szerinti szűkítést.
              */}
              <Info
                label="Alegység"
                value={assetPlacementDetail({
                  ownerType: cachedSummary.owner.type,
                  unit: cachedSummary.unit,
                  address: cachedSummary.address,
                })}
              />
              <Info label="Akvárium" value={cachedSummary.aquarium?.name} />
            </Section>

            <Section title="Azonosítás">
              <Info label="Gyártó" value={cachedSummary.manufacturer} />
              <Info label="Modell" value={cachedSummary.model} />
              <Info label="Sorozatszám" value={cachedSummary.serialNumber} />
              <Info
                label="Kritikusság"
                value={ASSET_CRITICALITY_LABELS[cachedSummary.criticality]}
              />
            </Section>

            <Section title="Karbantartás">
              <Info
                label="Következő szerviz"
                value={formatDate(cachedSummary.nextServiceAt)}
              />
              <Info
                label="Részegység"
                value={
                  cachedSummary.childCount > 0
                    ? `${cachedSummary.childCount} darab, a felsorolásuk csak térerővel`
                    : undefined
                }
              />
            </Section>
          </>
        ) : null}
        {asset ? (
          <>
            <View style={styles.hero}>
              <Text style={styles.number}>{asset.assetNumber}</Text>
              <Text style={styles.title}>{asset.name}</Text>
              <View style={styles.badges}>
                <Text style={styles.badge}>
                  {ASSET_KIND_LABELS[asset.kind]}
                </Text>
                <Text style={styles.badge}>
                  {ASSET_STATUS_LABELS[asset.status]}
                </Text>
              </View>
            </View>

            <Section title="Elhelyezés">
              <Info label="Tulajdonos" value={asset.owner.displayName} />
              <Info label="Partnerkód" value={asset.owner.code} />
              {/*
                AZ ALEGYSÉG A VÁLASZTOTT HELY, a cím a VISSZAESÉS. Partner
                tulajdonosnál a cím MINDIG a partner saját postai címe, tehát
                alegység nélkül nem válasz arra, hol áll az eszköz -- és a kettő
                ugyanúgy néz ki. A megkülönböztetés az `asset-placement.ts`
                modulban áll, ugyanazokkal a szavakkal, mint a weben.
              */}
              <Info
                label="Alegység"
                value={assetPlacementDetail({
                  ownerType: asset.owner.type,
                  unit: asset.unit,
                  address: asset.address,
                })}
              />
              <Info label="Akvárium" value={asset.aquarium?.name} />
            </Section>

            <Section title="Műszaki adatok">
              {/*
                A KATEGORIA ES A FUNKCIO EDDIG NEM JELENT MEG AZ ADATLAPON,
                holott a felvitel/szerkesztes urlap mar 2026-09-22 ota kerte
                oket, es a valasz mindig hordozta a feloldott nevet
                (`AssetDetail.category`/`.function`, lasd a tipus jegyzetet).
                Nautilus osszevetese, 2026-09-24 (Figma 7. kor elozetes),
                acrobot dontese: ez tiszta adat-megjelenites, nem var a
                Figma-elrendezesre.
              */}
              <Info label="Kategória" value={asset.category} />
              <Info label="Funkció" value={asset.function} />
              {/*
                A KRITIKUSSAG EDDIG SEHOL NEM JELENT MEG A MOBILON, holott a
                webes adatlap mar mutatja (`assetCriticalityLabel[asset.
                criticality]`). Barracuda lefedettsegi listaja (2026-09-25,
                exchange/figma-eszkozok-make-7-lefedettseg.md) es acrobot
                dontese: a mai felulet altal ismert mezok maradnak akkor is,
                ha a Figma-terv nem rajzolja oket -- ez a legkozelebbi kartya.
              */}
              <Info
                label="Kritikusság"
                value={ASSET_CRITICALITY_LABELS[asset.criticality]}
              />
              <Info label="Gyártó" value={asset.manufacturer} />
              <Info label="Modell" value={asset.model} />
              <Info label="Sorozatszám" value={asset.serialNumber} />
              <Info
                label="Partner azonosítója"
                value={asset.partnerInternalCode}
              />
              {/*
                A MATRICAKOD A BEGEPELT AZONOSITOK KOZE VALO, NEM A QR MELLE.

                A ketto MAS FAJTA kod: a matricakod az, amit a szerelo a
                matricarol leolvas es beir, a QR-token pedig a kirajzolt kod
                sajat azonositoja. Egy panelbe teve osszemosodnanak, es a
                szerelo azt hinne, hogy ugyanannak ket alakja.

                UGYANEZ A DONTES ALL A WEBES ADATLAPON (a sajat kommentemmel,
                2026-09-17), es szandekosan ugyanoda kerult ott is.

                ES CSAK EBBEN AZ AGBAN ALL, A MENTETT MASOLATEBAN NEM: a
                `cachedSummary` tipusa `AssetListItem`, ami a `labelCode`-ot NEM
                hordozza (merve a kozos tipusokon). Ha valaki odateszi,
                `undefined` lesz belole, hibauzenet nelkul -- a mobil sajat
                tipus-masolatai miatt ott nincs fordito-szintu kapcsolat.
              */}
              <Info label="Matricakód" value={asset.labelCode} />
              {/*
                A TELJESITMENY EGY MEZOBEN, az ertekevel es a jelevel. A
                szerkeszto ket mezobe keri be, mert ott ket dolgot kell
                megadni; itt EGY adat all, es ket sorra bontva a szam
                elszakadna a jeletol.

                A MERTEKEGYSEG A VALASZBAN JON, kiirva -- nem az azonositoja.
                Ez nem veletlen: kulonben a telefonnak kulon le kellene kernie
                a torzsadatot egyetlen jel kiirasahoz, es TERERO NELKUL ezt nem
                tudna megtenni. A mentett masolatbol allo lap ilyenkor szam
                melle ures helyet mutatna.
              */}
              <Info
                label="Teljesítmény"
                value={
                  asset.performance
                    ? asset.performanceUnit
                      ? `${asset.performance} ${asset.performanceUnit.code}`
                      : asset.performance
                    : undefined
                }
              />
              {/*
                A TERFOGAT ES A FOGYASZTAS -- FUGGETLEN A TELJESITMENYTOL.
                Kanban 8c77cf3e, 2026-09-23: 136 eszkozon EGYSZERRE all
                teljesitmeny (m3/h) ES fogyasztas (kW), tehat kulon adat,
                kulon sor. Mindketto MINDIG fix egysegben ertendo (m3,
                illetve kW), nincs kulon mertekegyseg.
              */}
              <Info
                label="Térfogat"
                value={asset.volume ? `${asset.volume} m³` : undefined}
              />
              <Info
                label="Fogyasztás"
                value={
                  asset.powerConsumption
                    ? `${asset.powerConsumption} kW`
                    : undefined
                }
              />
              {/*
                AZ EREDETI FOGYASZTAS-SZOVEG, HA ELTER A KIIRT SZAMTOL.
                Balazs kerese (2026-09-23): a fogyasztast ossze akarja adni,
                tehat a `powerConsumption` szamma valt -- ez a mezo orzi, mi
                allt eredetileg a cellaban (pl. "6,15/5,5").
              */}
              {asset.powerConsumptionRaw &&
              asset.powerConsumptionRaw !== asset.powerConsumption ? (
                <Info
                  label="Fogyasztás (eredeti)"
                  value={asset.powerConsumptionRaw}
                />
              ) : null}
              {/*
                A TABLAZAT ELSO OSZLOPA. Balazs kerese, 2026-09-23 (kanban
                8c77cf3e): "kapjon sajat mezot". A FELIRAT MASODSZOR
                VALTOZOTT MEG UGYANAZON A NAPON: "MAT kod" csak az
                LSS-lapok cimkeje, a Biodom lapjai "FP kod"-ot hasznalnak --
                a mai 16 eszkoz mind Biodom, tehat mind FP.
              */}
              <Info label="FP / Elektromos" value={asset.electricalCode} />
              <Info label="Termék" value={asset.product?.name} />
              <Info label="Leírás" value={asset.description} />
            </Section>

            <Section title="Karbantartás">
              <Info
                label="Telepítés dátuma"
                value={formatDate(asset.installedAt)}
              />
              {/*
                A GARANCIA LEJARATA EDDIG NEM JELENT MEG AZ ADATLAPON, holott
                az adatbazis mezoje (`Asset.warrantyExpiresAt`) mar regota
                letezik, es a valasz mindig hordozta -- ugyanaz a lelet, mint
                a Kategoria/Funkcio fentebb, ugyanazzal a dontessel.
              */}
              <Info
                label="Garancia lejárata"
                value={formatDate(asset.warrantyExpiresAt)}
              />
              <Info
                label="Következő karbantartás"
                value={formatDate(asset.nextServiceAt)}
              />
              <Info
                label="Utolsó karbantartás"
                value={formatDate(asset.lastServicedAt)}
              />
              <Info
                label="Intervallum"
                value={
                  asset.serviceIntervalDays
                    ? `${asset.serviceIntervalDays} nap`
                    : undefined
                }
              />
              <Info label="Megjegyzés" value={asset.notes} />
            </Section>

            {/*
              A HIBAJEGY A KIVÉTEL A KÖVETKEZŐ SZAKASZ SZABÁLYA ALÓL, ÉS EZ
              SZÁNDÉKOS.

              A szerkesztés és a fénykép szervert kíván, ezért mentett lapon
              eltűnik. A jegynyitás NEM: hálózati hibánál a sorba kerül, és a
              képernyő KIMONDJA, hogy oda került. Balázs kérése pont ez volt --
              „siman lehet hogy terero nelkul a pinceben eszrevesz egy hibat,
              meg akarja nyitni a hibajegyet".

              Ezért itt NINCS `!fromCache` feltétel. Aki később „egységesítené"
              a három szakaszt, pont azt az utat venné el, amiért a sor épült.
            */}
            {capabilities?.serviceJobsManage ? (
              <Section title="Hibajegy">
                <AssetLink
                  label="Hibajegy nyitása erről a gépről"
                  meta="A partner és a helyszín a gépből következik"
                  onPress={() =>
                    router.push({
                      pathname: "/service-jobs/new",
                      params: { assetId: asset.id },
                    })
                  }
                />
              </Section>
            ) : null}

            {/*
              A SZERKESZTÉS ÉS A CÍMKENYOMTATÁS SZERVERT KÍVÁN, tehát mentett
              lapon nem jelenik meg. A gomb, ami offline nem csinál semmit,
              rosszabb, mint a hiányzó gomb: a szerelő azt hiszi, elmentette.
            */}
            {capabilities?.assetsManage && !fromCache ? (
              <Section title="Szerkesztés">
                <AssetLink
                  label="Eszközadatok módosítása"
                  meta="Státusz, gyártó, sorozatszám, megjegyzés"
                  onPress={() =>
                    router.push({
                      pathname: "/assets/edit/[id]",
                      params: { id: asset.id },
                    })
                  }
                />
              </Section>
            ) : null}

            {/*
              A CSATOLMANYOK A `manage` KAPUN KIVUL ALLNAK, mint a munkalapon es
              a hibajegyen: a MEGNEZES `assetsView` ala tartozik (a lap maga is
              azon all), a FELTOLTES `assetsManage` ala. Ha a galeria a feltolto
              szakasz kapujan belul allna, a nezo epp azt nem latna, amiert a
              kepek felkerultek.

              ES KULON HIVAS NELKUL: a lista MAR ITT VAN. Az `AssetDetail`
              hordozza a `documents` mezot (merve a kozos tipusokon), es a
              kepernyo azt a valaszt ugyis lekeri. A #781-ben most keszult
              `@Get(":id/documents")` vegpont a WEBES oldalnak kell -- a mobil
              nem igenyel masodik kort.

              A MENTETT MASOLATON A CSEMPEK MEGJELENNEK, A KEPEK NEM: a lista az
              elmentett valaszbol jon, a kep-bajtok viszont halozatot kivannak.
              Ezert a hianyzo forras NEM nema, hanem kiirja, hogy nem tolthető be
              -- egy ures csempe pontosan ugy nezne ki, mint egy elromlott kep.
            */}
            {csatolmanyok.length > 0 || csatolmanyNotice ? (
              <Section title={`Csatolmányok (${csatolmanyok.length})`}>
                {csatolmanyNotice ? (
                  <Text style={styles.uploadNotice}>{csatolmanyNotice}</Text>
                ) : null}

                {kepek.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.galeria}>
                      {kepek.map((kep) => {
                        return (
                          <Pressable
                            key={kep.id}
                            accessibilityRole="imagebutton"
                            accessibilityLabel={`${kep.fileName} megnyitása nagyban`}
                            onPress={() => {
                              setNagyKep(kep.id);
                              // A PISZKOZAT A SZERVER SZERINTI ALLAPOTBOL
                              // INDUL, nem az elozo kepe mellol.
                              setFelirat(kep.caption ?? "");
                              setFeliratHiba(null);
                            }}
                            style={({ pressed }) => [
                              styles.csempe,
                              pressed && styles.pressed,
                            ]}
                          >
                            {/*
                              A HIANYZO FORRAS ES A BETOLTESI HIBA KET KULON
                              MONDAT. Eddig egy kozos "nem tölthető be" allt
                              itt, ami pontosan azt a kulonbseget torolte el,
                              amit merni akarunk -- es a csempe TILTOTT is
                              volt, tehat a szerelo nagyban sem tudta
                              megnezni, mi a baj.
                            */}
                            <DocumentImage
                              ownerPath={gazdaUtvonal}
                              documentId={kep.id}
                              variant="thumbnail"
                              style={styles.csempeKep}
                              hibaStyle={styles.csempeHiba}
                              resizeMode="cover"
                              accessibilityLabel={kep.fileName}
                            />
                            {/*
                              A FELIRAT A MERET FOLOTT ALL, es ez nem
                              elrendezesi izles: a felirat azt mondja meg, MIT
                              LATUNK, a meret csak azt, mekkora a fajl. A
                              kettobol az elso az, amit a szerelo keres. Ha
                              nincs felirat, a sor sem all ott -- egy ures sor
                              helyet foglalna a 104 pontos csempen.
                            */}
                            {kep.caption ? (
                              <Text
                                style={styles.csempeFelirat}
                                numberOfLines={2}
                              >
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
                  <Text key={doc.id} style={styles.uploadNotice}>
                    {describeUnviewableDocument(doc)}
                  </Text>
                ))}
              </Section>
            ) : null}

            {/*
              A FELTÖLTÉS SZERVERT KÍVÁN, tehát mentett lapon nem jelenik meg,
              ugyanabból az okból, amiért a szerkesztés sem: egy gomb, ami
              offline nem csinál semmit, rosszabb a hiányzó gombnál.

              A telefon ma offline OLVASNI tud, RÖGZÍTENI nem - a várakozó sor
              táblája elkészült, de senki nem tölti fel.
            */}
            {capabilities?.assetsManage && !fromCache ? (
              <Section title="Fényképek">
                {/*
                  A SORREND SZÁNDÉK, NEM ELRENDEZÉS. A fényképezés áll elöl,
                  mert a szerelő a helyszínen MOST készít képet, nem régit
                  keres. Aki megcserélné "kiegyensúlyozottabb" elrendezésért,
                  a napi munkát fordítaná meg.
                */}
                <AssetLink
                  label={uploading ? "Feltöltés…" : "Fénykép készítése"}
                  meta="A kamerával, itt és most"
                  onPress={() => void takeAndUploadPhoto()}
                />
                <AssetLink
                  label={uploading ? "Feltöltés…" : "Kép a galériából"}
                  meta={`Korábban készült kép, egyszerre legfeljebb ${MAX_FILES_PER_UPLOAD}`}
                  onPress={() => void pickAndUploadPhotos()}
                />
                {uploadNotice ? (
                  <Text style={styles.uploadNotice}>{uploadNotice}</Text>
                ) : null}
              </Section>
            ) : null}

            {/*
              EGY KÖZÖS "ESZKÖZHIERARCHIA" KÁRTYA, FŐEGYSÉG/RÉSZEGYSÉGEK
              ALCÍMEKKEL -- eddig ez a mobilon KÉT külön kártya volt
              ("Rendszerútvonal", "Részegységek"), funkcionálisan lefedte a
              Figma "Eszközhierarchia" kártyáját, csak nem egy közös
              kártyaként. Acrobot kérése, 2026-09-25 (Balázs aznap reggeli
              design-kérése nyomán): vonjuk össze, a Figma elrendezését
              követve.

              A "FŐEGYSÉG" NÁLUNK TÖBB ELEMŰ LEHET (`ancestors`, a teljes
              lánc a gyökérig), a Figma mock csak EGY közvetlen szülőt
              rajzol -- ez a mai adat GAZDAGABB, tehát megmarad, csak az
              alcím alá kerül.
            */}
            {asset.ancestors.length > 0 || asset.children.length > 0 ? (
              <Section title="Eszközhierarchia">
                {asset.ancestors.length > 0 ? (
                  <>
                    <Text style={styles.hierarchySubheading}>Főegység</Text>
                    {asset.ancestors.map((ancestor) => (
                      <AssetLink
                        key={ancestor.id}
                        label={ancestor.name}
                        meta={ancestor.assetNumber}
                        onPress={() =>
                          router.push({
                            pathname: "/assets/[id]",
                            params: { id: ancestor.id },
                          })
                        }
                      />
                    ))}
                  </>
                ) : null}
                {asset.children.length > 0 ? (
                  <>
                    <Text style={styles.hierarchySubheading}>Részegységek</Text>
                    {asset.children.map((child) => (
                      <AssetLink
                        key={child.id}
                        label={child.name}
                        meta={child.assetNumber}
                        onPress={() =>
                          router.push({
                            pathname: "/assets/[id]",
                            params: { id: child.id },
                          })
                        }
                      />
                    ))}
                  </>
                ) : null}
              </Section>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      {nagyKep ? (
        <View style={overlayStyles.nagyRatet}>
          <DocumentImage
            ownerPath={gazdaUtvonal}
            documentId={nagyKep}
            variant="original"
            style={overlayStyles.nagyKep}
            hibaStyle={overlayStyles.nagyKepHiba}
            resizeMode="contain"
            accessibilityLabel="A csatolmány nagyban"
          />
          {/*
            A FELIRAT ITT ALL, ES NEM A CSEMPEN.

            A csempe 104 pont szeles: ott egy beviteli mezo hasznalhatatlan
            lenne, es a kep sem latszana mellette. Nagyban viszont EPP az a kep
            van a szerelo elott, amit meg akar nevezni.
          */}
          {nagyKepSor?.caption ? (
            <Text style={overlayStyles.nagyFelirat}>{nagyKepSor.caption}</Text>
          ) : null}

          {/*
            A SZERKESZTO A JOGON ES A HALOZATON MULIK, ES A HIANY NEM LETILTOTT
            GOMB: ha nincs joga vagy mentett masolatot lat, a mezo NEM all ott.
            Egy letiltott gomb azt igerne, hogy van mit megnyomni -- offline
            pedig epp az a baj, hogy nincs.
          */}
          {capabilities?.assetsManage && !fromCache && nagyKepSor ? (
            <>
              <TextInput
                accessibilityLabel="A kép felirata"
                value={felirat}
                onChangeText={setFelirat}
                style={overlayStyles.feliratMezo}
                placeholder="Mit látunk a képen?"
                placeholderTextColor="#5c7e92"
                maxLength={500}
                editable={!feliratMentes}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Felirat mentése"
                disabled={feliratMentes}
                onPress={() => void feliratMentese(nagyKepSor.id)}
                style={({ pressed }) => [
                  overlayStyles.bezaro,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={overlayStyles.bezaroText}>
                  {feliratMentes ? "Mentés folyamatban…" : "Felirat mentése"}
                </Text>
              </Pressable>
              {feliratHiba ? (
                <Text style={overlayStyles.error}>{feliratHiba}</Text>
              ) : null}
            </>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Kép bezárása"
            onPress={() => {
              setNagyKep(null);
              setFeliratHiba(null);
            }}
            style={({ pressed }) => [
              overlayStyles.bezaro,
              pressed && styles.pressed,
            ]}
          >
            <Text style={overlayStyles.bezaroText}>Bezárás</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

/**
 * `Section`/`Info`/`AssetLink`/`MessageCard` MODUL-SZINTEN ÁLLNAK, NEM A
 * FŐ KOMPONENSBEN -- ezért nem tudnak a fő komponens `styles`
 * változójából zárványként dolgozni. Mindegyik ÖNÁLLÓAN hívja a
 * `useAppTheme()`-et és a KÖZÖS `createStyles()`-t: ez több apró,
 * egyformán olcsó számítást jelent render soronként (egy adatlapon
 * néhány tucat sor), cserébe egyetlen stílus-forrás marad, és egyetlen
 * hívóhelyet sem kell `styles` propon átvezetni.
 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Info({ label, value }: { label: string; value?: string }) {
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  if (!value) return null;
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function AssetLink({
  label,
  meta,
  onPress,
}: {
  label: string;
  meta: string;
  onPress(): void;
}) {
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.assetLink, pressed && styles.pressed]}
    >
      <View>
        <Text style={styles.assetLinkLabel}>{label}</Text>
        <Text style={styles.assetLinkMeta}>{meta}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function MessageCard({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry(): void;
}) {
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      <Pressable onPress={onRetry} style={styles.retryButton}>
        <Text style={styles.retryText}>Újrapróbálás</Text>
      </Pressable>
    </View>
  );
}

function formatDate(value?: string) {
  return value
    ? new Intl.DateTimeFormat("hu-HU", { dateStyle: "medium" }).format(
        new Date(value),
      )
    : undefined;
}

/**
 * A SZÍNEK 2026-09-25-TŐL A KÖZÖS `useAppTheme()`-BŐL JÖNNEK -- ez a
 * képernyő is saját, fix sötét hexekkel élt eddig (`#071827` stb.),
 * ugyanúgy, ahogy a lista (`assets/index.tsx`) is állt a saját
 * migrálása előtt. Az "Eszköznyilvántartás" Figma 7. kör része, ami
 * világos ÉS sötét módot kér.
 */
function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: t.background },
    container: { padding: 18, paddingBottom: 40, gap: 14 },
    hero: {
      borderRadius: 22,
      padding: 20,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
    },
    number: { color: t.accent, fontSize: 11, fontWeight: "900" },
    title: {
      color: t.textPrimary,
      fontSize: 27,
      fontWeight: "900",
      marginTop: 7,
    },
    badges: { flexDirection: "row", gap: 8, marginTop: 12 },
    badge: {
      color: t.accentSoftText,
      backgroundColor: t.accentSoft,
      borderRadius: 8,
      paddingHorizontal: 9,
      paddingVertical: 5,
      fontSize: 11,
      fontWeight: "800",
    },
    section: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface,
      padding: 17,
    },
    sectionTitle: { color: t.textPrimary, fontSize: 16, fontWeight: "900" },
    sectionBody: { marginTop: 8 },
    infoRow: {
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    infoLabel: {
      color: t.textSecondary,
      fontSize: 11,
      fontWeight: "800",
      textTransform: "uppercase",
    },
    infoValue: {
      color: t.textPrimary,
      fontSize: 14,
      lineHeight: 20,
      marginTop: 3,
    },
    /** Az "Eszközhierarchia" kártya "Főegység"/"Részegységek" alcíme. */
    hierarchySubheading: {
      color: t.textSecondary,
      fontSize: 11,
      fontWeight: "800",
      textTransform: "uppercase",
      marginTop: 4,
      marginBottom: 2,
    },
    assetLink: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 10,
    },
    assetLinkLabel: { color: t.textPrimary, fontSize: 15, fontWeight: "700" },
    assetLinkMeta: { color: t.textSecondary, fontSize: 11, marginTop: 2 },
    chevron: { color: t.accent, fontSize: 26 },
    pressed: { opacity: 0.68 },
    message: { color: t.textSecondary, lineHeight: 20, marginTop: 8 },
    galeria: { flexDirection: "row", gap: 10, paddingVertical: 4 },
    csempe: { gap: 4, width: 104 },
    csempeKep: {
      width: 104,
      height: 104,
      borderRadius: 10,
      backgroundColor: t.background,
      borderColor: t.border,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    csempeFelirat: { color: t.textPrimary, fontSize: 11, textAlign: "center" },
    /*
      A HIBA-DOBOZ KERETE A CSEMPEN ES NAGYBAN MAS MERET. A csempe 104 pont
      szeles: ott csak annyi fer ki, hogy MERES, es aki azt latja, rakoppint. A
      teljes szoveg a nagy nezetben olvashato, ahol van hely.
    */
    csempeHiba: { padding: 4 },
    csempeMeret: { color: t.textSecondary, fontSize: 11, textAlign: "center" },
    uploadNotice: {
      color: t.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      paddingHorizontal: 4,
      paddingTop: 8,
    },
    retryButton: {
      alignSelf: "flex-start",
      backgroundColor: t.accent,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 9,
      marginTop: 14,
    },
    retryText: { color: t.textOnAccent, fontWeight: "800" },
  });
}

/**
 * A NAGYBAN NYITOTT KÉP RÁTÉTJE SZÁNDÉKOSAN NEM TÉMA-FÜGGŐ.
 *
 * Ez egy fényképnéző, ami a kép fölé sötét háttérként ül -- ugyanúgy,
 * ahogy egy fotógaléria világos módban is sötét hátteret ad a képnek a
 * kontraszt miatt. Ha ez a réteg a világos módban is fehér hátterű lenne,
 * a kép kontrasztja romlana, és a rátéten álló "Bezárás"/"Felirat
 * mentése" gombok is a világos módú tokenekkel olvashatatlanná válnának
 * a mögöttük álló, változatlanul sötét képen.
 */
const overlayStyles = StyleSheet.create({
  nagyKepHiba: {
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  nagyFelirat: { color: "#d7e7ef", fontSize: 15, textAlign: "center" },
  feliratMezo: {
    backgroundColor: "#0d2430",
    borderColor: "#1d4356",
    borderRadius: 10,
    borderWidth: 1,
    color: "#e8f3f8",
    paddingHorizontal: 12,
    paddingVertical: 10,
    width: "100%",
  },
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
  bezaro: {
    backgroundColor: "#12384c",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  bezaroText: { color: "#eaf4fa", textAlign: "center" },
  error: {
    color: "#fca5a5",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
});
