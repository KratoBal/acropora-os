import { useMemo, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { MaterialRequestSummary } from "@/lib/api/material-requests";
import {
  MATERIAL_REQUEST_PILL_LABEL,
  MATERIAL_REQUEST_PILL_TONE,
  cardByline,
  cardItemsLine,
  handlerLine,
  type RequestTone,
} from "@/lib/material-requests/v2-presentation";
import type { ThemeTokens } from "@/lib/theme/tokens";
import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { MaterialRequestStatusValue } from "@/lib/worksheets/material-request-presentation";

/**
 * THE ANYAGIGÉNY V2 BUILDING BLOCKS ON THE PHONE (Figma 404:369 / 404:431),
 * on the shared theme tokens, light and dark.
 */

function toneColors(t: ThemeTokens, tone: RequestTone) {
  switch (tone) {
    case "warning":
      return { background: t.warningSoft, color: t.warning };
    case "info":
      return { background: t.infoSoft, color: t.info };
    case "accent":
      return { background: t.accentSoft, color: t.accentSoftText };
    case "success":
      return { background: t.successSoft, color: t.success };
    case "neutral":
      return { background: t.background, color: t.textSecondary };
  }
}

export function RequestPill({
  tone,
  children,
}: {
  tone: RequestTone;
  children: ReactNode;
}) {
  const { tokens } = useAppTheme();
  const colors = toneColors(tokens, tone);
  return (
    <View style={[pillStyles.pill, { backgroundColor: colors.background }]}>
      <Text style={[pillStyles.text, { color: colors.color }]}>{children}</Text>
    </View>
  );
}

export function StatusPill({ status }: { status: MaterialRequestStatusValue }) {
  return (
    <RequestPill tone={MATERIAL_REQUEST_PILL_TONE[status]}>
      {MATERIAL_REQUEST_PILL_LABEL[status]}
    </RequestPill>
  );
}

const pillStyles = StyleSheet.create({
  pill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  text: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
});

/** A white card with the Figma's border and radius. */
export function Card({ children }: { children: ReactNode }) {
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return <View style={styles.card}>{children}</View>;
}

/** Figma 404:369's request card: who, which worksheet, what, who handles it. */
export function RequestCard({
  request,
  now,
  onPress,
}: {
  request: MaterialRequestSummary;
  now: Date;
  onPress: () => void;
}) {
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const handler = handlerLine(request);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${request.customerDisplayName} · ${request.departmentName}, ${MATERIAL_REQUEST_PILL_LABEL[request.status]}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.headerRow}>
        <Text style={styles.title}>
          {request.customerDisplayName} · {request.departmentName}
        </Text>
        <StatusPill status={request.status} />
      </View>
      <Text style={styles.muted}>{cardByline(request, now)}</Text>
      <Text style={styles.items}>{cardItemsLine(request)}</Text>
      <View style={styles.footerRow}>
        {handler ? (
          <Text
            style={[
              styles.handler,
              {
                color:
                  handler.tone === "warning"
                    ? tokens.warning
                    : tokens.accentSoftText,
              },
            ]}
          >
            {handler.text}
          </Text>
        ) : (
          <View />
        )}
        <Text style={styles.chevron}>›</Text>
      </View>
    </Pressable>
  );
}

function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    card: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 14,
      gap: 8,
      padding: 14,
    },
    pressed: { opacity: 0.85 },
    headerRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: 10,
    },
    title: {
      color: t.textPrimary,
      flex: 1,
      fontSize: 15,
      fontWeight: "700",
    },
    muted: { color: t.textSecondary, fontSize: 12 },
    items: { color: t.textSecondary, fontSize: 14 },
    footerRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    handler: { fontSize: 12, fontWeight: "600" },
    chevron: { color: t.textMuted, fontSize: 18 },
  });
}
