import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/lib/auth/AuthProvider";
import { describeCacheAge } from "@/lib/offline/offline-notice";
import {
  QUEUE_SECTIONS,
  toQueueEntries,
  type QueueEntryView,
} from "@/lib/offline/queue-inspection";
import { queueDiscardConfirmation } from "@/lib/offline/queue-discard";
import {
  allQueueRows,
  discardQueueRow,
  retryQueueRow,
} from "@/lib/offline/queue-store";

/**
 * FELTÖLTÉSRE VÁRÓ FELVITELEK -- ÉS AMI MEGÁLLT.
 *
 * === MIÉRT LÉTEZIK EZ A KÉPERNYŐ ===
 *
 * 2026-09-03-tól egy felvitel meg is állhat (a szerver sokadszorra is hibát
 * adott). A sáv kimondja, hogy segítség kell, és eddig nem volt hova menni
 * vele: a megállás zsákutcát csinált. Ez a képernyő a kiút.
 *
 * === AMI ITT NINCS, ÉS MIÉRT ===
 *
 * NINCS ELDOBÁS. A sor a felvitel EGYETLEN létező példánya: egy mellényúlás
 * VÉGLEG és csendben vinné el a helyszíni munkát. A hiánya viszont hangos (a
 * lista tovább mutatja) és bármikor pótolható. A két tévedés ára nem egyforma.
 *
 * NINCS MÁSOLÁS GOMB SEM: az appban nincs vágólap-csomag, és egy új függőség
 * többe kerülne, mint amennyit ér. Helyette a lista MEGMONDJA, amit az irodának
 * el kell mondani: mi az, mikor készült, hányszor próbálta, mi a hiba.
 *
 * A döntések (mit lát, mit lehet újrapróbálni, hogyan fordítjuk a hibát) a
 * `lib/offline/queue-inspection.ts`-ben állnak, mert ott MÉRHETŐK.
 */
export default function QueueScreen() {
  const { status } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();

  const rows = useQuery({
    queryKey: ["offline-queue"],
    queryFn: async () => toQueueEntries(await allQueueRows()),
    enabled: status === "authenticated",
  });

  if (status !== "authenticated") return <Redirect href="/login" />;

  const entries = rows.data ?? [];

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={rows.isFetching}
            onRefresh={() => void rows.refetch()}
            tintColor="#52d6c7"
          />
        }
      >
        <Text style={styles.eyebrow}>OFFLINE</Text>
        <Text style={styles.title}>Feltöltésre váró felvitelek</Text>

        {rows.isPending ? (
          <ActivityIndicator color="#52d6c7" />
        ) : entries.length === 0 ? (
          <Text style={styles.hint}>
            Nincs várakozó felvitel: minden felment a szerverre.
          </Text>
        ) : (
          QUEUE_SECTIONS.map(({ section, title, hint }) => {
            const soron = entries.filter((e) => e.section === section);
            if (soron.length === 0) return null;
            return (
              <View key={section} style={styles.section}>
                <Text style={styles.sectionTitle}>
                  {title} ({soron.length})
                </Text>
                <Text style={styles.sectionHint}>{hint}</Text>
                {soron.map((entry) => (
                  <Entry
                    key={entry.id}
                    entry={entry}
                    onRetry={async () => {
                      await retryQueueRow(entry.id);
                      /**
                       * A LISTA ÉS A KEZDŐLAP SÁVJA IS FRISSÜL. A sáv a
                       * kiürítés üzenetéből számol újra, tehát ha csak ezt a
                       * listát frissítenénk, a kezdőlap tovább mondaná, hogy
                       * megállt valami.
                       */
                      await queryClient.invalidateQueries({
                        queryKey: ["offline-queue"],
                      });
                    }}
                    onFix={() =>
                      router.push({
                        pathname: "/queue-fix/[id]",
                        params: { id: entry.id },
                      })
                    }
                    onDiscard={() => {
                      /**
                       * A MEGEROSITES SZOVEGE A TISZTA MODULBOL JON, mert ott
                       * merheto, hogy tenyleg MEGNEVEZI a tartalmat -- egy
                       * "biztos vagy benne?" ugyanaz a nema veszteseg, csak egy
                       * kattintassal tobb.
                       */
                      const kerdes = queueDiscardConfirmation({
                        kind: entry.kind,
                        title: entry.title,
                      });
                      Alert.alert(kerdes.title, kerdes.message, [
                        { text: "Mégsem", style: "cancel" },
                        {
                          text: kerdes.confirmLabel,
                          style: "destructive",
                          onPress: () => {
                            void (async () => {
                              const eredmeny = await discardQueueRow(entry.id);
                              /**
                               * A NULLA MOZDULT SOR NEM SIKER: a sor kozben
                               * elindulhatott egy masik kiuritessel. Ilyenkor
                               * NEM vetettuk el, es ezt ki kell mondani --
                               * kulonben a szerelo azt hinne, hogy megtortent.
                               */
                              if (!eredmeny.ok || eredmeny.changed === 0)
                                Alert.alert(
                                  "Nem vetettük el",
                                  eredmeny.ok
                                    ? "Ez a felvitel közben elindult, ezért nem vetettük el. Nézd meg a listán, mi lett vele."
                                    : eredmeny.error,
                                );
                              await queryClient.invalidateQueries({
                                queryKey: ["offline-queue"],
                              });
                            })();
                          },
                        },
                      ]);
                    }}
                  />
                ))}
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Entry({
  entry,
  onRetry,
  onFix,
  onDiscard,
}: {
  entry: QueueEntryView;
  onRetry: () => Promise<void>;
  onFix: () => void;
  onDiscard: () => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowTitle}>
        {entry.kind}: {entry.title}
      </Text>
      <Text style={styles.rowMeta}>
        {describeCacheAge(entry.createdAt, new Date())} rögzítve
        {entry.attemptCount > 0
          ? ` · ${entry.attemptCount} feltöltési kísérlet`
          : ""}
      </Text>
      {entry.error.message ? (
        <Text style={styles.rowError}>{entry.error.message}</Text>
      ) : null}
      {/*
        A NYERS SZÖVEG AZ IRODÁNAK SZÓL, nem a szerelőnek: kisebb betűvel, de
        ott van. A fordítás nem viheti el azt az adatot, amivel a hibát meg
        lehet keresni.
      */}
      {entry.error.raw ? (
        <Text style={styles.rowRaw}>{entry.error.raw}</Text>
      ) : null}
      {entry.canRetry ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void onRetry()}
          style={styles.retryButton}
        >
          <Text style={styles.retryText}>Újrapróbálom</Text>
        </Pressable>
      ) : null}
      {/*
        A JAVITAS GOMB AZ ELAKADT SORON, es KIZARJA az ujraprobalast: ott a
        szerverrel van baj, itt a felvitellel. Ugyanaz a keres ugyanazt a
        valaszt kapna, tehat egy "ujraprobalom" gomb itt azt igerne, hogy
        megoldodik.
      */}
      {entry.canFix ? (
        <Pressable
          accessibilityRole="button"
          onPress={onFix}
          style={styles.retryButton}
        >
          <Text style={styles.retryText}>Javítom és újraküldöm</Text>
        </Pressable>
      ) : null}
      {/*
        HA NINCS JAVITAS GOMB EGY ELAKADT SORON, AZT MEG KELL INDOKOLNI.
        Enelkul a szerelo azt latja, hogy baj van, es azt NEM, hogy mit tehet --
        egy magyarazat nelkuli hianyzo gomb ugy nez ki, mint hiba a programban.
        A mondat a `queue-inspection.ts`-bol jon, mert ott merheto.
      */}
      {entry.fixHint ? (
        <Text style={styles.rowHint}>{entry.fixHint}</Text>
      ) : null}
      {/*
        AZ ELVETES NEM EGYENRANGU GOMB, hanem alahuzott szoveg a masik alatt.
        Ez az EGYETLEN gomb az appban, ami a szerelo sajat munkajat dobja el;
        ket egyforma gomb egymas mellett a visszafordithatatlant ugyanolyan
        konnyen elerhetove tenne, mint a javithatot.
      */}
      {entry.canDiscard ? (
        <Pressable accessibilityRole="button" onPress={onDiscard}>
          <Text style={styles.discardText}>Elvetem</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rowHint: { color: "#91afbe", fontSize: 13, lineHeight: 19, marginTop: 8 },
  discardText: {
    color: "#ffb4ab",
    fontSize: 13,
    fontWeight: "800",
    marginTop: 12,
    textAlign: "center",
    textDecorationLine: "underline",
  },
  safeArea: { flex: 1, backgroundColor: "#071827" },
  container: { padding: 18, paddingBottom: 48, gap: 16 },
  eyebrow: {
    color: "#52d6c7",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  title: { color: "#f4fbff", fontSize: 28, fontWeight: "900" },
  hint: { color: "#91afbe", lineHeight: 21 },
  section: {
    backgroundColor: "#0d2233",
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  sectionTitle: { color: "#f4fbff", fontSize: 17, fontWeight: "900" },
  sectionHint: { color: "#91afbe", fontSize: 12, lineHeight: 17 },
  row: {
    backgroundColor: "#08192a",
    borderColor: "#17394f",
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
    padding: 12,
  },
  rowTitle: { color: "#f4fbff", fontSize: 15, fontWeight: "800" },
  rowMeta: { color: "#789cad", fontSize: 12 },
  rowError: { color: "#ffd9a8", fontSize: 13, lineHeight: 18 },
  rowRaw: { color: "#5f7f92", fontSize: 11 },
  retryButton: {
    backgroundColor: "#177b74",
    borderRadius: 10,
    marginTop: 6,
    padding: 11,
  },
  retryText: { color: "#fff", fontWeight: "900", textAlign: "center" },
});
