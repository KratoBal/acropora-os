import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { getAsset } from "@/lib/api/assets";
import { listPartnerUnits } from "@/lib/api/partners";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import {
  compareQueuedUpdate,
  rebuildResolvedPatch,
  resolutionIsEmpty,
  type ComparableField,
} from "@/lib/offline/asset-conflict-resolution";
import { readQueuedAssetUpdate } from "@/lib/offline/asset-update-queue";
import { describeQueueError } from "@/lib/offline/queue-inspection";
import { allQueueRows, applyQueueResend } from "@/lib/offline/queue-store";
import {
  queueResendPatch,
  queueResolveEligibility,
} from "@/lib/offline/queue-resend";

/**
 * MELYIK ÉRTÉK MARADJON -- MEZŐNKÉNT.
 *
 * === MIÉRT NEM A JAVÍTÓ KÉPERNYŐ ===
 *
 * Az elakadt FELVITELNÉL a törzset át lehet írni, és újra elküldeni ugyanúgy.
 * Egy elakadt MÓDOSÍTÁSNÁL ez nem működhet: a törzsben álló verzió véglegesen
 * elavult, tehát bármilyen szöveggel ugyanazt a 409-et kapná vissza. Egy javító
 * gomb ott olyat ígérne, ami soha nem tud sikerülni.
 *
 * Itt ezért nem szöveget írunk, hanem VÁLASZTUNK: mezőnként az marad, amit a
 * szerelő mond, és az új törzs a MOST letöltött verzióra hivatkozik.
 *
 * === NINCS ALAPÉRTELMEZETT VÁLASZTÁS, ÉS EZ NEM KÉNYELMETLENSÉG ===
 *
 * Egy előre bejelölt oldal azt jelentené, hogy a döntést a kód hozza meg a
 * szerelő helyett -- és a helyszínen siető ember rá is nyomna a küldésre. A
 * gomb addig tétlen, amíg minden ELTÉRŐ mezőnél nincs válasz.
 *
 * === CSAK AZ ÜTKÖZŐ MEZŐK KÉRDEZNEK (acrobot kikötése, 2026-09-04) ===
 *
 * A lista nem a szerelő ÖSSZES javítását sorolja, hanem azokat, ahol MÁS is
 * hozzányúlt ugyanahhoz a mezőhöz. A többi javítás simán átmegy, és egy
 * összefoglaló sor mondja meg, hány ilyen van -- így a képernyő rövid marad, és
 * a szerelő mégsem hiszi azt, hogy valamit elfelejtett.
 *
 * AZ ELSŐ VÁLTOZAT MINDEN ÁTÍRT MEZŐRŐL KÉRDEZETT, és az rossz kérdés volt: ha
 * a szerelő átírta a gyártót és rajta kívül senki nem nyúlt hozzá, a friss
 * eszközön a régi érték áll, ami eltérésnek látszik. Nincs mit eldönteni -- és
 * ha zavarában a másikat választja, a SAJÁT javítása tűnik el csendben.
 */

export default function QueueResolveScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;

  const [dontes, setDontes] = useState<
    Partial<Record<ComparableField, "mine" | "theirs">>
  >({});
  const [error, setError] = useState<string | null>(null);

  const sor = useQuery({
    queryKey: ["queue-row", id],
    queryFn: async () => {
      const rows = await allQueueRows();
      return rows.find((r) => r.id === id) ?? null;
    },
    enabled: Boolean(id && status === "authenticated"),
  });

  const row = sor.data ?? null;
  const payload = row ? readQueuedAssetUpdate(row.payloadJson) : null;

  /**
   * A FRISS ESZKÖZ, ÉS EZ A KÉPERNYŐ EGYETLEN HÁLÓZATI FÜGGŐSÉGE.
   *
   * Enélkül nincs mihez hasonlítani, és nincs friss verzió sem, amire az új
   * törzs hivatkozhatna. Ha nincs térerő, a képernyő ezt KIMONDJA -- egy
   * gyorsítótárazott másolat itt hamis biztonságot adna: pont az a kérdés,
   * hogy MOST mi áll a szerveren.
   */
  const eszkoz = useQuery({
    queryKey: ["service-asset", row?.entityId],
    queryFn: () => getAsset(row!.entityId!),
    enabled: Boolean(row?.entityId && status === "authenticated"),
  });

  /**
   * A HELYSZÍNEK NEVE. Csak szerviz partner eszközénél van mit betölteni, és a
   * hiánya NEM állítja meg a képernyőt: a nevek nélkül az azonosító látszik,
   * ami csúnyább, de igaz.
   */
  const helyszinek = useQuery({
    queryKey: ["partner-units", eszkoz.data?.owner.id],
    queryFn: () => listPartnerUnits(eszkoz.data!.owner.id),
    enabled:
      status === "authenticated" && eszkoz.data?.owner.type === "SUPPLIER",
  });

  const mentes = useMutation({
    mutationFn: async () => {
      if (!payload || !eszkoz.data)
        throw new Error("Ez a módosítás nem nyitható meg.");
      const uj = rebuildResolvedPatch({
        patch: payload.patch,
        /**
         * A NEM ÜTKÖZŐ JAVÍTÁSOK AUTOMATIKUSAN MENNEK. Nem a szerelő
         * hanyagsága, hogy nem döntött róluk: nincs is miről. Ha kimaradnának,
         * a feloldás elvenné a saját javításait.
         */
        keepMine: sorok
          .filter((s) => !s.conflicting || dontes[s.field] === "mine")
          .map((s) => s.field),
        freshUpdatedAt: eszkoz.data.updatedAt,
      });
      if (resolutionIsEmpty(uj))
        throw new Error(
          "Minden mezőnél a másik értéket hagytad meg, tehát nincs mit elküldeni. A listán vesd el ezt a módosítást.",
        );
      const result = await applyQueueResend(
        id!,
        queueResendPatch(
          JSON.stringify({ assetName: payload.assetName, patch: uj }),
        ),
      );
      if (!result.ok) throw new Error(result.error);
      /**
       * NULLA MOZDULT SOR NEM SIKER, ugyanúgy, mint a javító képernyőn: a sor
       * közben elindulhatott egy másik kiürítéssel, és ilyenkor a törzset MÁR
       * NEM szabad átírni.
       */
      if (result.changed === 0)
        throw new Error(
          "Ez a módosítás közben elindult, ezért nem írtuk át. Nézd meg a listán, mi lett vele.",
        );
      return result;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["queue"] });
      await queryClient.invalidateQueries({ queryKey: ["queue-row", id] });
      router.replace("/queue");
    },
    onError: (cause) =>
      setError(
        cause instanceof Error ? cause.message : "A feloldás nem menthető.",
      ),
  });

  if (status !== "authenticated" || !user || !capabilities)
    return <Redirect href="/login" />;
  if (!capabilities.assetsManage) return <Redirect href="/" />;

  const jogosult = row
    ? queueResolveEligibility({
        state: row.state,
        operation: row.operation,
        entityType: row.entityType,
      })
    : null;

  const unitNames: Record<string, string> = {};
  for (const unit of helyszinek.data?.items ?? [])
    unitNames[unit.id] = unit.name;

  const sorok =
    payload && eszkoz.data
      ? compareQueuedUpdate({
          patch: payload.patch,
          current: {
            ...eszkoz.data,
            unit: eszkoz.data.unit
              ? { id: eszkoz.data.unit.id, name: eszkoz.data.unit.name }
              : null,
          },
          unitNames,
        })
      : [];

  const eldontendo = sorok.filter((s) => s.conflicting);
  const magatolAtmegy = sorok.filter((s) => !s.conflicting);
  const keszEnDontesem = eldontendo.every((s) => dontes[s.field] !== undefined);

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.eyebrow}>ELAKADT MÓDOSÍTÁS</Text>

        {sor.isPending || eszkoz.isPending ? (
          <ActivityIndicator color="#52d6c7" />
        ) : null}

        {sor.data === null && !sor.isPending ? (
          <Text style={styles.error}>
            Ez a módosítás már nincs a soron: vagy felment, vagy elvetették.
          </Text>
        ) : null}

        {row && jogosult && !jogosult.ok ? (
          <View style={styles.card}>
            <Text style={styles.muted}>{jogosult.message}</Text>
          </View>
        ) : null}

        {row && payload === null ? (
          <Text style={styles.error}>
            Ennek a módosításnak a törzse olvashatatlan, ezért nem lehet
            feloldani. A listán elvetheted.
          </Text>
        ) : null}

        {/*
          A HÁLÓZAT HIÁNYÁT KI KELL MONDANI. E nélkül a képernyő üres listával
          állna, és az úgy nézne ki, mintha nem lenne mit eldönteni.
        */}
        {row && eszkoz.isError ? (
          <View style={styles.card}>
            <Text style={styles.label}>A mostani állapot nem tölthető be</Text>
            <Text style={styles.value}>
              A feloldáshoz látni kell, mi áll MOST a szerveren. Ehhez térerő
              kell: próbáld újra, amint van.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void eszkoz.refetch()}
              style={styles.primary}
            >
              <Text style={styles.primaryText}>Újrapróbálás</Text>
            </Pressable>
          </View>
        ) : null}

        {row && jogosult?.ok && payload && eszkoz.data ? (
          <>
            <View style={styles.card}>
              <Text style={styles.label}>{payload.assetName}</Text>
              <Text style={styles.value}>
                {describeQueueError(row.lastError).message ??
                  "A szerver nem küldött részletes üzenetet."}
              </Text>
            </View>

            {/*
              EGY SOR A TOBBIROL. A kepernyo rovid marad, es a szerelo megis
              latja, hogy a javitasai nem vesztek el -- egy nema kihagyas ott
              ugyanugy nezne ki, mint egy elfelejtett mezo.
            */}
            {magatolAtmegy.length > 0 ? (
              <View style={[styles.card, styles.cardMuted]}>
                <Text style={styles.value}>
                  {magatolAtmegy.length === 1
                    ? "Egy további mezőt írtál át, ahhoz más nem nyúlt: az változatlanul átmegy."
                    : `${magatolAtmegy.length} további mezőt írtál át, azokhoz más nem nyúlt: változatlanul átmennek.`}
                </Text>
                <Text style={styles.muted}>
                  {magatolAtmegy.map((mezo) => mezo.label).join(", ")}
                </Text>
              </View>
            ) : null}

            {eldontendo.map((mezo) => (
              <View key={mezo.field} style={styles.card}>
                <Text style={styles.label}>{mezo.label}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setDontes({ ...dontes, [mezo.field]: "mine" })}
                  style={[
                    styles.choice,
                    dontes[mezo.field] === "mine" && styles.choiceOn,
                  ]}
                >
                  <Text style={styles.choiceTitle}>Az enyém maradjon</Text>
                  <Text style={styles.choiceValue}>{mezo.mine}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    setDontes({ ...dontes, [mezo.field]: "theirs" })
                  }
                  style={[
                    styles.choice,
                    dontes[mezo.field] === "theirs" && styles.choiceOn,
                  ]}
                >
                  <Text style={styles.choiceTitle}>
                    Maradjon, ami most a rendszerben van
                  </Text>
                  <Text style={styles.choiceValue}>{mezo.theirs}</Text>
                </Pressable>
              </View>
            ))}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              accessibilityRole="button"
              disabled={!keszEnDontesem || mentes.isPending}
              onPress={() => {
                setError(null);
                mentes.mutate();
              }}
              style={[
                styles.primary,
                (!keszEnDontesem || mentes.isPending) && styles.primaryOff,
              ]}
            >
              <Text style={styles.primaryText}>
                {keszEnDontesem
                  ? "Feloldás és újraküldés"
                  : `Még ${eldontendo.filter((s) => dontes[s.field] === undefined).length} mezőnél kell döntened`}
              </Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: "#071827", flex: 1 },
  container: { gap: 12, padding: 16 },
  eyebrow: {
    color: "#7fb2d4",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
  },
  card: {
    backgroundColor: "#0b263d",
    borderRadius: 14,
    gap: 8,
    padding: 16,
  },
  cardMuted: { opacity: 0.6 },
  label: { color: "#f4fbff", fontSize: 15, fontWeight: "700" },
  value: { color: "#c6e2f5", fontSize: 13, lineHeight: 20 },
  muted: { color: "#9fc3dc", fontSize: 13, lineHeight: 20 },
  choice: {
    backgroundColor: "#0f3350",
    borderColor: "#1d4a70",
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
    padding: 12,
  },
  choiceOn: { borderColor: "#52d6c7", borderWidth: 2 },
  choiceTitle: { color: "#9fc3dc", fontSize: 12, fontWeight: "700" },
  choiceValue: { color: "#f4fbff", fontSize: 15 },
  primary: {
    alignItems: "center",
    backgroundColor: "#52d6c7",
    borderRadius: 12,
    padding: 14,
  },
  primaryOff: { opacity: 0.4 },
  primaryText: { color: "#04212b", fontSize: 15, fontWeight: "800" },
  error: { color: "#ffb4ab", fontSize: 13, lineHeight: 20 },
});
