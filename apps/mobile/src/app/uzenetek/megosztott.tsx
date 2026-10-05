import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { DocumentImage } from "@/components/documents/DocumentImage";
import { ScreenHeader, phase3Styles } from "@/components/messages/Phase3Chrome";
import { getSharedAttachments } from "@/lib/api/messages";
import { useAuth } from "@/lib/auth/AuthProvider";
import { fileSizeLabel } from "@/lib/messages/outbox";
import { fileTypeLabel, shortWhen } from "@/lib/messages/phase3";
import { useAppTheme } from "@/lib/theme/useAppTheme";

/**
 * MEGOSZTOTT TARTALMAK (Figma 450:549): Média és Fájlok, a beszélgetés
 * elküldött csatolmányaiból. A „Linkek” fül egy következő lépés (terv, 2.4).
 */
export default function SharedContentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status } = useAuth();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => phase3Styles(tokens), [tokens]);
  const [tab, setTab] = useState<"IMAGE" | "FILE">("IMAGE");
  const shared = useQuery({
    queryKey: ["messages", "shared", id, tab],
    queryFn: () => getSharedAttachments(id!, tab),
    enabled: status === "authenticated" && Boolean(id),
  });

  if (status !== "authenticated") return <Redirect href="/login" />;
  const now = new Date();
  const items = shared.data?.items ?? [];

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <ScreenHeader title="Megosztott tartalmak" tokens={tokens} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.tabs} accessibilityRole="tablist">
          {(
            [
              ["IMAGE", "Média"],
              ["FILE", "Fájlok"],
            ] as const
          ).map(([kind, label]) => (
            <Pressable
              key={kind}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === kind }}
              onPress={() => setTab(kind)}
              style={[styles.tab, tab === kind && styles.tabActive]}
            >
              <Text
                style={[styles.tabText, tab === kind && styles.tabTextActive]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
        {shared.error ? (
          <Text style={styles.error}>A tartalmak nem töltődtek be.</Text>
        ) : null}
        {shared.data && items.length === 0 ? (
          <Text style={styles.lead}>
            {tab === "IMAGE" ? "Még nincs kép." : "Még nincs fájl."}
          </Text>
        ) : null}
        {tab === "IMAGE" ? (
          <View style={styles.grid}>
            {items.map((item) => (
              <View key={item.id} style={styles.tile}>
                <DocumentImage
                  ownerPath="/messages"
                  collection="attachments"
                  documentId={item.id}
                  variant={item.hasThumbnail ? "thumbnail" : "original"}
                  style={{ width: "100%", height: "100%" }}
                  resizeMode="cover"
                  accessibilityLabel={`${item.fileName}, ${shortWhen(item.createdAt, now)}`}
                />
              </View>
            ))}
          </View>
        ) : (
          items.map((item) => (
            <View key={item.id} style={[styles.card, styles.row]}>
              <Ionicons
                name="document-text-outline"
                size={22}
                color={tokens.textSecondary}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.fileName}
                </Text>
                <Text style={styles.cardMeta}>
                  {fileTypeLabel(item.fileName)} ·{" "}
                  {fileSizeLabel(item.sizeBytes)} ·{" "}
                  {shortWhen(item.createdAt, now)}
                </Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
