import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
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

import { OfflineNoticeCard } from "@/components/offline/OfflineNoticeCard";
import { MAX_FILES_PER_UPLOAD } from "@/lib/api/document-upload";
import { photoPermissionDeniedNotice } from "@/lib/api/photo-permission-notice";
import { toPickedImages } from "@/lib/api/picked-image";
import {
  getServiceJob,
  moveServiceJob,
  uploadServiceJobPhotos,
  type ServiceJobStatusValue,
} from "@/lib/api/service-jobs";
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
   * A FÉNYKÉP FELTÖLTÉSE -- ÉS EZ A NEGYEDIK PÉLDÁNYA UGYANENNEK A MENETNEK.
   *
   * Mérve 2026-09-16: a `assets/[id].tsx`, a `assets/new.tsx` és a
   * `worksheets/new.tsx` ugyanezt a sort írja (engedély, választó, `toPickedImages`,
   * részleges siker kimondása). A KIEMELÉS külön kártya, mert három BEOLVASZTOTT
   * képernyő viselkedését mozgatná, és ez a kör amúgy is nagy.
   *
   * KIMONDVA ÁLL ITT, mert egy negyedik másolat nem új kockázatot hoz, hanem
   * MEGSOKSZOROZZA a meglévőt -- és épp attól láthatatlan, hogy mind egyforma.
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
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "A feltöltés nem sikerült. Próbáld újra.",
      );
    } finally {
      setUploading(false);
    }
  };

  const takePhoto = async () => {
    if (!id || uploading) return;
    setNotice(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setNotice(photoPermissionDeniedNotice("camera"));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
    });
    if (result.canceled) return;
    await uploadPicked(result.assets);
  };

  const pickPhotos = async () => {
    if (!id || uploading) return;
    setNotice(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setNotice(photoPermissionDeniedNotice("library"));
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
          */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Új munkalap ehhez a jegyhez"
            onPress={() => router.push("/worksheets/new")}
            style={styles.action}
          >
            <Text style={styles.actionText}>Új munkalap</Text>
          </Pressable>
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
  loading: { marginTop: 32 },
  empty: { color: "#9fc4d8", marginTop: 32, padding: 16, textAlign: "center" },
  notice: { color: "#eaf4fa", lineHeight: 20 },
  hint: { color: "#9fc4d8", fontSize: 13, lineHeight: 18 },
});
