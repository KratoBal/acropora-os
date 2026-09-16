import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

import { getAsset } from "@/lib/api/assets";
import { createServiceJob } from "@/lib/api/service-jobs";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import { ApiError } from "@/lib/api/client";
import { readCachedAsset } from "@/lib/offline/asset-cache";
import { enqueueServiceJobCreate } from "@/lib/offline/queue-store";
import { saveOrQueue, type SaveOutcome } from "@/lib/offline/save-or-queue";
import {
  newServiceJobProblem,
  placementNotice,
} from "@/lib/service-jobs/new-service-job";
import { serviceJobOperationId } from "@/lib/service-jobs/types";

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

  const save = useMutation({
    mutationFn: async (): Promise<SaveOutcome> => {
      const openedAt = new Date().toISOString();
      const operationId = serviceJobOperationId({
        originAssetId: assetId!,
        openedAt,
      });
      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        originAssetId: assetId!,
      };
      return saveOrQueue({
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
    },
    onSuccess: async (outcome) => {
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
        setTitle("");
        setDescription("");
      }
    },
    onError: (error: unknown) =>
      setNotice(
        error instanceof Error
          ? error.message
          : "A hibajegy nyitása nem sikerült.",
      ),
  });

  if (status === "unauthenticated") return <Redirect href="/login" />;
  if (status === "authenticated" && !capabilities?.serviceJobsManage)
    return <Redirect href="/" />;
  if (!assetId) return <Redirect href="/service-jobs" />;

  if (!asset)
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
  const hova = placementNotice({
    owner: asset.owner ? { displayName: asset.owner.displayName } : undefined,
    ownerType: asset.owner?.type,
    unit: asset.unit,
    address: asset.address,
  });

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.page}>
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

        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

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
  loading: { marginTop: 32 },
  empty: { color: "#9fc4d8", marginTop: 32, padding: 16, textAlign: "center" },
});
