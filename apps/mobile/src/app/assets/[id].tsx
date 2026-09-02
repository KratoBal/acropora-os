import { useQuery } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { getAsset, uploadAssetDocuments } from "@/lib/api/assets";
import { MAX_FILES_PER_UPLOAD } from "@/lib/api/asset-document-upload";
import { photoPermissionDeniedNotice } from "@/lib/api/photo-permission-notice";
import { toPickedImages } from "@/lib/api/picked-image";
import { ASSET_STATUS_LABELS } from "@/lib/assets/asset-status";
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

const KIND_LABELS = {
  SYSTEM: "Rendszer",
  EQUIPMENT: "Berendezés",
  COMPONENT: "Részegység",
  SENSOR: "Szenzor",
  OTHER: "Egyéb",
} as const;

export default function AssetDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;
  const online = useIsOnline();
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
      const created = await uploadAssetDocuments(query.data.id, {
        type: "OTHER",
        files,
      });
      // A KIHAGYOTTAKAT AKKOR IS KIMONDJUK, HA A TÖBBI SIKERÜLT. Egy néma
      // részleges siker azt a hitet hagyná, hogy mind a kép fent van.
      setUploadNotice(
        skipped.length > 0
          ? `${created.length} kép feltöltve. Kimaradt: ${skipped.join(", ")}.`
          : `${created.length} kép feltöltve.`,
      );
      void query.refetch();
    } catch (error) {
      setUploadNotice(
        error instanceof Error
          ? error.message
          : "A feltöltés nem sikerült. Próbáld újra.",
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
  const takeAndUploadPhoto = async () => {
    if (!query.data || uploading) return;
    setUploadNotice(null);

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setUploadNotice(photoPermissionDeniedNotice("camera"));
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
    });
    if (result.canceled) return;
    await uploadPicked(result.assets);
  };

  /** A MÁSODIK ÚT: egy korábban készült kép a galériából. */
  const pickAndUploadPhotos = async () => {
    if (!query.data || uploading) return;
    setUploadNotice(null);

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setUploadNotice(photoPermissionDeniedNotice("library"));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: MAX_FILES_PER_UPLOAD,
    });
    if (result.canceled) return;
    await uploadPicked(result.assets);
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
          <ActivityIndicator color="#52d6c7" />
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
                  {KIND_LABELS[cachedSummary.kind]}
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
                <Text style={styles.badge}>{KIND_LABELS[asset.kind]}</Text>
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
              <Info label="Gyártó" value={asset.manufacturer} />
              <Info label="Modell" value={asset.model} />
              <Info label="Sorozatszám" value={asset.serialNumber} />
              <Info label="Partner azonosítója" value={asset.inventoryNumber} />
              <Info label="Termék" value={asset.product?.name} />
              <Info label="Leírás" value={asset.description} />
            </Section>

            <Section title="Karbantartás">
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

            {asset.ancestors.length > 0 ? (
              <Section title="Rendszerútvonal">
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
              </Section>
            ) : null}

            {asset.children.length > 0 ? (
              <Section title="Részegységek">
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
              </Section>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Info({ label, value }: { label: string; value?: string }) {
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

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#071827" },
  container: { padding: 18, paddingBottom: 40, gap: 14 },
  hero: {
    borderRadius: 22,
    padding: 20,
    backgroundColor: "#0d3146",
    borderWidth: 1,
    borderColor: "#1d536b",
  },
  number: { color: "#52d6c7", fontSize: 11, fontWeight: "900" },
  title: { color: "#f4fbff", fontSize: 27, fontWeight: "900", marginTop: 7 },
  badges: { flexDirection: "row", gap: 8, marginTop: 12 },
  badge: {
    color: "#d3eef4",
    backgroundColor: "#16495e",
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
    fontSize: 11,
    fontWeight: "800",
  },
  section: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#1c4963",
    backgroundColor: "#0d2b40",
    padding: 17,
  },
  sectionTitle: { color: "#f4fbff", fontSize: 16, fontWeight: "900" },
  sectionBody: { marginTop: 8 },
  infoRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#153c52",
  },
  infoLabel: {
    color: "#789cad",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  infoValue: { color: "#e4f3f8", fontSize: 14, lineHeight: 20, marginTop: 3 },
  assetLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  assetLinkLabel: { color: "#e4f3f8", fontSize: 15, fontWeight: "700" },
  assetLinkMeta: { color: "#75a0b2", fontSize: 11, marginTop: 2 },
  chevron: { color: "#52d6c7", fontSize: 26 },
  pressed: { opacity: 0.68 },
  message: { color: "#a9c4d1", lineHeight: 20, marginTop: 8 },
  uploadNotice: {
    color: "#475569",
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 4,
    paddingTop: 8,
  },
  retryButton: {
    alignSelf: "flex-start",
    backgroundColor: "#177b74",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginTop: 14,
  },
  retryText: { color: "#fff", fontWeight: "800" },
});
