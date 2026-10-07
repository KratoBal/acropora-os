import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Redirect,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  Card,
  RequestPill,
  StatusPill,
} from "@/components/material-requests/MaterialRequestParts";
import { ApiError } from "@/lib/api/client";
import {
  cancelMaterialRequest,
  claimMaterialRequest,
  commentOnMaterialRequest,
  getMaterialRequest,
  listMaterialRequestHandlerOptions,
  orderMaterialRequest,
  reassignMaterialRequest,
  receiveAllMaterialRequest,
  receiveMaterialRequestItems,
  type MaterialRequestFullDetail,
} from "@/lib/api/material-requests";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import {
  MATERIAL_REQUEST_REFRESH_MS,
  PRIMARY_ACTION_LABEL,
  PRIORITY_LABEL,
  cancelConsequence,
  formatNeededBy,
  formatWhen,
  itemQuantity,
  itemState,
  partialReceiptChanges,
  primaryAction,
  procurementSentence,
  requestedLine,
  timeline,
  type PrimaryAction,
} from "@/lib/material-requests/v2-presentation";
import type { ThemeTokens } from "@/lib/theme/tokens";
import { useAppTheme } from "@/lib/theme/useAppTheme";

/**
 * ONE MATERIAL REQUEST ON THE PHONE (Figma 404:431).
 *
 * Every button comes from `detail.actions`, which the server computes with
 * the rules it enforces; the server checks again on every call. The one
 * next step (claim, else order, else receive) sits in the sticky bar at the
 * bottom, as in the Figma; the other allowed steps (partial receipt, the
 * handover, the withdrawal) are in the "Beszerzés" card.
 *
 * After any action the answer IS the new request. On a failure (a lost
 * claim is a 409) the reason is shown and the request is read again, so the
 * screen shows what is true now.
 *
 * This is its own route, not `material-requests/[id]`: that one is the push
 * landing, whose id is the WORKSHEET's (see its header) and which phones on
 * the old bundle still open.
 */
export default function MaterialRequestDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status, user } = useAuth();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const capabilities = user ? getServiceCapabilities(user) : null;
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [partialOpen, setPartialOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  /*
    A MEGJEGYZÉS-MEZŐ LÁTSZIK GÉPELÉS KÖZBEN (kártya e45e1dda, Balázs
    2026-10-04): a mező a lap ALJÁN áll, és a billentyűzet ráült. Két rész,
    és mindkettő kell:
      - iOS-en a `KeyboardAvoidingView` (padding) és a ScrollView beszúrása
        húzza fel a tartalmat a billentyűzet fölé (a `worksheets/new` mintája);
      - mindkét rendszeren, amikor a billentyűzet a megjegyzés-mezőhöz nyílt,
        a lap a végére görget: a mező az utolsó elem. Androidon az ablak
        átméreteződik, de a ScrollView magától nem görget a fókuszhoz.
  */
  const scrollRef = useRef<ScrollView>(null);
  const commentFocused = useRef(false);
  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", () => {
      if (commentFocused.current)
        scrollRef.current?.scrollToEnd({ animated: true });
    });
    return () => shown.remove();
  }, []);
  const queryKey = ["material-requests", "detail", id];

  const detail = useQuery({
    queryKey,
    queryFn: () => getMaterialRequest(id),
    enabled: Boolean(
      id && capabilities?.worksheetsView && status === "authenticated",
    ),
    refetchInterval: MATERIAL_REQUEST_REFRESH_MS,
    retry: (failureCount, cause) =>
      !(
        cause instanceof ApiError &&
        (cause.status === 404 || cause.status === 403)
      ) && failureCount < 2,
  });
  const { refetch } = detail;
  useFocusEffect(
    useCallback(() => {
      setNow(new Date());
      void refetch();
    }, [refetch]),
  );

  /** Send, take the authoritative answer, let the list re-read. */
  const run = async (
    step: () => Promise<MaterialRequestFullDetail>,
  ): Promise<boolean> => {
    setBusy(true);
    setActionError(null);
    try {
      const fresh = await step();
      queryClient.setQueryData(queryKey, fresh);
      return true;
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "A művelet nem sikerült.",
      );
      await refetch();
      return false;
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({
        queryKey: ["material-requests", "overview"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["material-requests", "summary"],
      });
    }
  };

  if (status !== "authenticated" || !user || !capabilities)
    return <Redirect href="/login" />;
  if (!capabilities.worksheetsView) return <Redirect href="/" />;

  if (detail.isPending)
    return (
      <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
        <ActivityIndicator color={tokens.accent} style={{ marginTop: 32 }} />
      </SafeAreaView>
    );
  if (detail.isError || !detail.data)
    return (
      <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
        <View style={styles.container}>
          <Text style={styles.error}>
            {detail.error instanceof ApiError &&
            (detail.error.status === 404 || detail.error.status === 403)
              ? "Az anyagigény nem található, vagy nincs jogosultságod megnézni."
              : "Az anyagigény jelenleg nem tölthető be."}
          </Text>
        </View>
      </SafeAreaView>
    );

  const request = detail.data;
  const { actions } = request;
  const primary = primaryAction(actions);
  const sentence = procurementSentence(request, actions.claim);
  const steps = timeline(request.status, request.events, now);
  const runPrimary = (action: PrimaryAction) =>
    void run(() =>
      action === "claim"
        ? claimMaterialRequest(request.id)
        : action === "order"
          ? orderMaterialRequest(request.id)
          : receiveAllMaterialRequest(request.id),
    );
  const confirmCancel = () =>
    Alert.alert("Visszavonod az anyagigényt?", cancelConsequence(request), [
      { text: "Mégsem", style: "cancel" },
      {
        text: "Visszavonás",
        style: "destructive",
        onPress: () => void run(() => cancelMaterialRequest(request.id)),
      },
    ]);
  // the sticky bar holds the primary step; the card offers the rest
  const secondary = {
    order: actions.order && primary !== "order",
    receive: actions.receive && primary !== "receive",
    receiveItems: actions.receiveItems,
    reassign: actions.reassign,
    cancel: actions.cancel,
  };
  const hasSecondary = Object.values(secondary).some(Boolean);

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          refreshControl={
            <RefreshControl
              refreshing={detail.isRefetching}
              onRefresh={() => {
                setNow(new Date());
                void refetch();
              }}
              tintColor={tokens.accent}
            />
          }
        >
          <View style={styles.header}>
            <Text style={styles.title}>Anyagigény</Text>
            <Text style={styles.muted}>
              {request.worksheetNumber ?? "piszkozat munkalap"} ·{" "}
              {request.customerDisplayName}
            </Text>
          </View>

          {actionError ? <Text style={styles.error}>{actionError}</Text> : null}

          <Card>
            <View style={styles.row}>
              <View style={styles.flex}>
                <Text style={styles.cardTitle}>
                  {request.departmentName} · anyagigény
                </Text>
                <Text style={styles.muted}>{requestedLine(request, now)}</Text>
              </View>
              <StatusPill status={request.status} />
            </View>
          </Card>

          <Card>
            <Text style={styles.cardTitle}>Beszerzés</Text>
            <View style={styles.row}>
              <Text
                style={[
                  styles.flex,
                  sentence.tone === "warning" ? styles.warning : styles.body,
                ]}
              >
                {sentence.text}
              </Text>
              {request.handlerId &&
              request.status !== "CANCELLED" &&
              request.status !== "RECEIVED" ? (
                <RequestPill tone="accent">Ő INTÉZI</RequestPill>
              ) : null}
            </View>
            {actions.claim ? (
              <ActionButton
                label={PRIMARY_ACTION_LABEL.claim}
                busy={busy}
                onPress={() => runPrimary("claim")}
                styles={styles}
              />
            ) : null}
            {hasSecondary ? (
              <View style={styles.buttonColumn}>
                {secondary.order ? (
                  <ActionButton
                    label="Megrendeltem"
                    variant="secondary"
                    busy={busy}
                    onPress={() => runPrimary("order")}
                    styles={styles}
                  />
                ) : null}
                {secondary.receiveItems ? (
                  <ActionButton
                    label="Részben beérkezett"
                    variant="secondary"
                    busy={busy}
                    onPress={() => setPartialOpen((open) => !open)}
                    styles={styles}
                  />
                ) : null}
                {secondary.receive ? (
                  <ActionButton
                    label="Beérkezett"
                    variant="secondary"
                    busy={busy}
                    onPress={() => runPrimary("receive")}
                    styles={styles}
                  />
                ) : null}
                {secondary.reassign ? (
                  <ActionButton
                    label="Felelős módosítása"
                    variant="secondary"
                    busy={busy}
                    onPress={() => setReassignOpen((open) => !open)}
                    styles={styles}
                  />
                ) : null}
                {secondary.cancel ? (
                  <ActionButton
                    label="Visszavonás"
                    variant="danger"
                    busy={busy}
                    onPress={confirmCancel}
                    styles={styles}
                  />
                ) : null}
              </View>
            ) : null}
            {partialOpen && actions.receiveItems ? (
              <PartialReceipt
                request={request}
                busy={busy}
                styles={styles}
                onSubmit={(input) =>
                  void run(() =>
                    receiveMaterialRequestItems(request.id, input),
                  ).then((ok) => (ok ? setPartialOpen(false) : undefined))
                }
              />
            ) : null}
            {reassignOpen && actions.reassign ? (
              <Reassign
                request={request}
                busy={busy}
                styles={styles}
                onPick={(handlerId) =>
                  void run(() =>
                    reassignMaterialRequest(request.id, { handlerId }),
                  ).then((ok) => (ok ? setReassignOpen(false) : undefined))
                }
              />
            ) : null}
          </Card>

          <Card>
            <Text style={styles.cardTitle}>Tételek</Text>
            {request.items.map((item) => (
              <View key={item.id} style={styles.itemRow}>
                <View style={styles.flex}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.muted}>
                    {itemState(request.status, item)}
                  </Text>
                </View>
                <Text style={styles.itemQuantity}>{itemQuantity(item)}</Text>
              </View>
            ))}
          </Card>

          <Card>
            <MetaRow
              label="Szükséges"
              value={request.neededBy ? formatNeededBy(request.neededBy) : "—"}
              styles={styles}
            />
            <MetaRow
              label="Prioritás"
              value={request.priority ? PRIORITY_LABEL[request.priority] : "—"}
              styles={styles}
            />
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Munkalap</Text>
              <Pressable
                accessibilityRole="link"
                onPress={() =>
                  router.push({
                    pathname: "/worksheets/[id]",
                    params: { id: request.worksheetId },
                  })
                }
              >
                <Text style={styles.link}>
                  {request.worksheetNumber ?? "Megnyitás"}
                </Text>
              </Pressable>
            </View>
          </Card>

          {request.note ? (
            <Card>
              <Text style={styles.cardTitle}>Megjegyzés</Text>
              <Text style={styles.body}>{request.note}</Text>
            </Card>
          ) : null}

          <Card>
            <Text style={styles.cardTitle}>Státusztörténet</Text>
            {steps.map((step) => (
              <View key={step.key} style={styles.stepRow}>
                <View
                  style={[
                    styles.dot,
                    {
                      backgroundColor:
                        step.kind === "done"
                          ? tokens.accent
                          : step.kind === "current"
                            ? tokens.info
                            : tokens.border,
                    },
                  ]}
                />
                <View style={styles.flex}>
                  <Text
                    style={
                      step.kind === "current" ? styles.stepCurrent : styles.body
                    }
                  >
                    {step.label}
                  </Text>
                  <Text style={styles.muted}>{step.detail}</Text>
                </View>
              </View>
            ))}
          </Card>

          <Comments
            request={request}
            busy={busy}
            now={now}
            styles={styles}
            onAdd={(body) =>
              run(() => commentOnMaterialRequest(request.id, { body }))
            }
            onFocusChange={(focused) => {
              commentFocused.current = focused;
              // ha a billentyűzet már nyitva volt (egy másik mezőből), nincs
              // újabb keyboardDidShow: a görgetés itt is elindul
              if (focused && Keyboard.isVisible())
                scrollRef.current?.scrollToEnd({ animated: true });
            }}
          />
        </ScrollView>

        {primary ? (
          <View style={styles.stickyBar}>
            <ActionButton
              label={PRIMARY_ACTION_LABEL[primary]}
              busy={busy}
              onPress={() => runPrimary(primary)}
              styles={styles}
            />
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type Styles = ReturnType<typeof createStyles>;

function ActionButton({
  label,
  onPress,
  busy,
  variant = "primary",
  styles,
}: {
  label: string;
  onPress: () => void;
  busy: boolean;
  variant?: "primary" | "secondary" | "danger";
  styles: Styles;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={[
        variant === "primary"
          ? styles.primaryButton
          : variant === "danger"
            ? styles.dangerButton
            : styles.secondaryButton,
        busy && styles.disabled,
      ]}
    >
      <Text
        style={
          variant === "primary"
            ? styles.primaryText
            : variant === "danger"
              ? styles.dangerText
              : styles.secondaryText
        }
      >
        {label}
      </Text>
    </Pressable>
  );
}

function MetaRow({
  label,
  value,
  styles,
}: {
  label: string;
  value: string;
  styles: Styles;
}) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

/** Numeric item: the new TOTAL that arrived; text item: "Megjött". */
function PartialReceipt({
  request,
  busy,
  styles,
  onSubmit,
}: {
  request: MaterialRequestFullDetail;
  busy: boolean;
  styles: Styles;
  onSubmit: (input: {
    items: { itemId: string; receivedQuantity?: string; arrived?: boolean }[];
  }) => void;
}) {
  const open = request.items.filter((item) => !item.arrived);
  const [totals, setTotals] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      open.map((item) => [item.id, item.receivedQuantity ?? ""]),
    ),
  );
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const changes = partialReceiptChanges(request.items, totals, marks);
  return (
    <View style={styles.subPanel}>
      {open.map((item) =>
        item.quantityValue !== null ? (
          <View key={item.id} style={styles.metaRow}>
            <Text style={[styles.body, styles.flex]}>
              {item.name} (kért: {item.quantity} {item.unit})
            </Text>
            <TextInput
              accessibilityLabel={`${item.name}: beérkezett összesen`}
              keyboardType="decimal-pad"
              value={totals[item.id] ?? ""}
              onChangeText={(value) =>
                setTotals((all) => ({ ...all, [item.id]: value }))
              }
              style={styles.numberInput}
            />
          </View>
        ) : (
          <View key={item.id} style={styles.metaRow}>
            <Text style={[styles.body, styles.flex]}>
              {item.name} ({item.quantity} {item.unit}) · Megjött
            </Text>
            <Switch
              accessibilityLabel={`${item.name}: megjött`}
              value={marks[item.id] ?? false}
              onValueChange={(value) =>
                setMarks((all) => ({ ...all, [item.id]: value }))
              }
            />
          </View>
        ),
      )}
      <ActionButton
        label="Rögzítés"
        busy={busy || changes === null}
        onPress={() => (changes ? onSubmit(changes) : undefined)}
        styles={styles}
      />
    </View>
  );
}

/** The handover: active purchasers from the server's list, the current one left out. */
function Reassign({
  request,
  busy,
  styles,
  onPick,
}: {
  request: MaterialRequestFullDetail;
  busy: boolean;
  styles: Styles;
  onPick: (handlerId: string) => void;
}) {
  const options = useQuery({
    queryKey: ["material-requests", "handler-options"],
    queryFn: listMaterialRequestHandlerOptions,
  });
  if (options.isPending) return <ActivityIndicator />;
  if (options.isError)
    return (
      <Text style={styles.error}>A kollégák listája nem tölthető be.</Text>
    );
  const others = options.data.items.filter(
    (option) => option.id !== request.handlerId,
  );
  if (others.length === 0)
    return (
      <Text style={styles.muted}>Nincs más kolléga, akinek átadható.</Text>
    );
  return (
    <View style={styles.subPanel}>
      <Text style={styles.muted}>Kinek adod át?</Text>
      {others.map((option) => (
        <ActionButton
          key={option.id}
          label={option.displayName}
          variant="secondary"
          busy={busy}
          onPress={() => onPick(option.id)}
          styles={styles}
        />
      ))}
    </View>
  );
}

function Comments({
  request,
  busy,
  now,
  styles,
  onAdd,
  onFocusChange,
}: {
  request: MaterialRequestFullDetail;
  busy: boolean;
  now: Date;
  styles: Styles;
  onAdd: (body: string) => Promise<boolean>;
  onFocusChange: (focused: boolean) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <Card>
      <Text style={styles.cardTitle}>Megjegyzések</Text>
      {request.comments.length === 0 ? (
        <Text style={styles.muted}>Még nincs megjegyzés.</Text>
      ) : (
        request.comments.map((comment) => (
          <View key={comment.id} style={styles.comment}>
            <Text style={styles.body}>
              <Text style={styles.commentAuthor}>
                {comment.authorName ?? "Kolléga"}:
              </Text>{" "}
              {comment.body}
            </Text>
            <Text style={styles.muted}>
              {formatWhen(comment.createdAt, now)}
            </Text>
          </View>
        ))
      )}
      {request.actions.comment ? (
        <>
          <TextInput
            accessibilityLabel="Új megjegyzés"
            placeholder="Megjegyzés hozzáadása…"
            placeholderTextColor={styles.placeholder.color}
            value={draft}
            maxLength={2000}
            multiline
            onChangeText={setDraft}
            onFocus={() => onFocusChange(true)}
            onBlur={() => onFocusChange(false)}
            style={styles.textArea}
          />
          <ActionButton
            label="Mentés"
            variant="secondary"
            busy={busy || !draft.trim()}
            onPress={() =>
              void onAdd(draft.trim()).then((ok) =>
                ok ? setDraft("") : undefined,
              )
            }
            styles={styles}
          />
        </>
      ) : null}
    </Card>
  );
}

function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: t.background },
    container: { padding: 16, paddingBottom: 32, gap: 12 },
    header: { gap: 2, marginBottom: 4 },
    title: { color: t.textPrimary, fontSize: 28, fontWeight: "800" },
    flex: { flex: 1 },
    row: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: 10,
    },
    cardTitle: { color: t.textPrimary, fontSize: 15, fontWeight: "700" },
    body: { color: t.textSecondary, fontSize: 14 },
    muted: { color: t.textSecondary, fontSize: 12 },
    warning: { color: t.warning, fontSize: 14 },
    error: {
      color: t.danger,
      backgroundColor: t.dangerSoft,
      padding: 12,
      borderRadius: 10,
    },
    itemRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: t.background,
      borderRadius: 9,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    itemName: { color: t.textPrimary, fontSize: 14, fontWeight: "700" },
    itemQuantity: { color: t.textPrimary, fontSize: 14, fontWeight: "700" },
    metaRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 12,
    },
    metaLabel: { color: t.textSecondary, fontSize: 12 },
    metaValue: {
      color: t.textPrimary,
      fontSize: 14,
      fontWeight: "700",
      textAlign: "right",
    },
    link: { color: t.accentSoftText, fontSize: 14, fontWeight: "700" },
    stepRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    dot: { width: 10, height: 10, borderRadius: 5 },
    stepCurrent: { color: t.textPrimary, fontSize: 14, fontWeight: "700" },
    buttonColumn: { gap: 8 },
    subPanel: {
      backgroundColor: t.background,
      borderRadius: 10,
      gap: 8,
      padding: 10,
    },
    numberInput: {
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 8,
      color: t.textPrimary,
      minWidth: 80,
      paddingHorizontal: 8,
      paddingVertical: 6,
      textAlign: "right",
    },
    comment: { gap: 2 },
    commentAuthor: { color: t.textPrimary, fontWeight: "700" },
    textArea: {
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 9,
      color: t.textPrimary,
      minHeight: 72,
      padding: 10,
      textAlignVertical: "top",
    },
    placeholder: { color: t.textMuted },
    stickyBar: {
      backgroundColor: t.surface,
      borderTopColor: t.border,
      borderTopWidth: 1,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    primaryButton: {
      backgroundColor: t.accent,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    primaryText: {
      color: t.textOnAccent,
      fontSize: 15,
      fontWeight: "700",
      textAlign: "center",
    },
    secondaryButton: {
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 11,
    },
    secondaryText: {
      color: t.textPrimary,
      fontSize: 14,
      fontWeight: "700",
      textAlign: "center",
    },
    dangerButton: {
      borderColor: t.danger,
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 11,
    },
    dangerText: {
      color: t.danger,
      fontSize: 14,
      fontWeight: "700",
      textAlign: "center",
    },
    disabled: { opacity: 0.55 },
  });
}
