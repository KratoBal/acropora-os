import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { DocumentImage } from "@/components/documents/DocumentImage";
import { AssistantText } from "@/components/messages/AssistantText";
import {
  fileSizeLabel,
  replyPreviewText,
  type PendingUpload,
} from "@/lib/messages/outbox";
import {
  MESSAGE_REACTIONS,
  type MessageAttachmentItem,
  type MessageItem,
  type MessageReactionValue,
} from "@/lib/messages/types";
import type { ThemeTokens } from "@/lib/theme/tokens";

/**
 * AZ ÜZENETEK 2. FÁZISA A TELEFONON (Figma 454:371 és 454:457): a buborék a
 * válasz-idézettel, a csatolmányokkal és a reakciókkal, a hosszú nyomásra
 * nyíló műveleti sáv, a csatolás menüje és a feltöltési sor.
 *
 * A sávok a képernyőn belül, a composer fölött állnak, nem `<Modal>`-ban: az
 * app leírt döntése, hogy `Modal` nincs benne (lásd a
 * `worksheets/send-for-signature/[id].tsx` fejlécét).
 */

/** A csatolmányok gazda-útvonala a letöltő csővezetéknek: `/messages/attachments/:id`. */
const ATTACHMENT_OWNER = "/messages";

export function MessageBubble({
  message,
  own,
  sender,
  tokens,
  onLongPress,
  onToggleReaction,
  onOpenImage,
  highlighted = false,
}: {
  message: MessageItem;
  own: boolean;
  sender: string | null;
  tokens: ThemeTokens;
  onLongPress: (() => void) | null;
  onToggleReaction: (reaction: MessageReactionValue, mine: boolean) => void;
  onOpenImage: (attachment: MessageAttachmentItem) => void;
  /** 3. fázis: az „Ugrás” célja rövid ideig kiemelve. */
  highlighted?: boolean;
}) {
  const styles = bubbleStyles(tokens);
  return (
    <View
      style={[
        styles.column,
        own ? styles.columnOwn : styles.columnOther,
        highlighted && styles.highlighted,
      ]}
    >
      <Pressable
        onLongPress={onLongPress ?? undefined}
        delayLongPress={350}
        accessibilityHint={
          onLongPress ? "Hosszan nyomva: válasz, reakció és több" : undefined
        }
        style={[styles.bubble, own ? styles.bubbleOwn : styles.bubbleOther]}
      >
        {sender ? <Text style={styles.sender}>{sender}</Text> : null}
        {message.forwardedFrom && !message.deleted ? (
          <Text style={styles.forwarded}>
            Továbbítva · {message.forwardedFrom.senderName}
          </Text>
        ) : null}
        {message.replyTo && !message.deleted ? (
          <View style={styles.quote}>
            <Text style={styles.quoteName}>{message.replyTo.senderName}</Text>
            <Text style={styles.quoteText} numberOfLines={2}>
              {replyPreviewText(message.replyTo)}
            </Text>
          </View>
        ) : null}
        {message.deleted ? (
          <Text style={styles.deleted}>Az üzenetet törölték.</Text>
        ) : (
          <>
            {message.attachments.map((attachment) =>
              attachment.kind === "IMAGE" ? (
                <Pressable
                  key={attachment.id}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={`Kép megnyitása: ${attachment.fileName}`}
                  onPress={() => onOpenImage(attachment)}
                  onLongPress={onLongPress ?? undefined}
                >
                  <DocumentImage
                    ownerPath={ATTACHMENT_OWNER}
                    collection="attachments"
                    documentId={attachment.id}
                    variant={attachment.hasThumbnail ? "thumbnail" : "original"}
                    style={styles.thumb}
                    hibaStyle={styles.thumbError}
                    resizeMode="cover"
                    accessibilityLabel={attachment.fileName}
                  />
                </Pressable>
              ) : (
                <View key={attachment.id} style={styles.file}>
                  <Ionicons
                    name="document-text-outline"
                    size={20}
                    color={tokens.textSecondary}
                  />
                  <View style={styles.fileBody}>
                    <Text style={styles.fileName} numberOfLines={1}>
                      {attachment.fileName}
                    </Text>
                    <Text style={styles.fileMeta}>
                      {fileSizeLabel(attachment.sizeBytes)} · a webes felületen
                      nyitható meg
                    </Text>
                  </View>
                </View>
              ),
            )}
            {message.text && message.assistant ? (
              <AssistantText text={message.text} style={styles.text} />
            ) : message.text ? (
              <Text style={styles.text} selectable>
                {message.text}
              </Text>
            ) : null}
          </>
        )}
        <Text style={styles.meta}>
          {new Date(message.createdAt).toLocaleTimeString("hu-HU", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          {message.editedAt && !message.deleted ? " · szerkesztve" : ""}
          {message.pinned && !message.deleted ? " · 📌 kitűzve" : ""}
        </Text>
      </Pressable>
      {message.reactions.length && !message.deleted ? (
        <View style={styles.reactions}>
          {message.reactions.map((r) => (
            <Pressable
              key={r.reaction}
              accessibilityRole="button"
              accessibilityLabel={`${r.reaction} ${r.count}${r.mine ? ", a tiéd is" : ""}`}
              onPress={() => onToggleReaction(r.reaction, r.mine)}
              style={[styles.chip, r.mine && styles.chipMine]}
            >
              <Text style={styles.chipText}>
                {r.reaction} {r.count}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** A pending (még meg nem erősített) saját üzenet buboréka. */
export function PendingBubble({
  text,
  attachmentCount,
  time,
  pending,
  tokens,
}: {
  text: string;
  attachmentCount: number;
  time: string;
  pending: boolean;
  tokens: ThemeTokens;
}) {
  const styles = bubbleStyles(tokens);
  return (
    <View style={[styles.bubble, styles.bubbleOwn]}>
      {attachmentCount ? (
        <Text style={styles.fileMeta}>📎 {attachmentCount} csatolmány</Text>
      ) : null}
      {text ? <Text style={styles.text}>{text}</Text> : null}
      <Text style={styles.meta}>
        {new Date(time).toLocaleTimeString("hu-HU", {
          hour: "2-digit",
          minute: "2-digit",
        })}
        {pending ? " · küldés…" : ""}
      </Text>
    </View>
  );
}

/** A hosszú nyomásra nyíló sáv: reakciók, válasz, és a saját üzeneten szerkesztés és törlés. */
export function MessageActionsPanel({
  message,
  own,
  tokens,
  onReact,
  onReply,
  onForward,
  onTogglePin,
  onEdit,
  onDelete,
  onClose,
}: {
  message: MessageItem;
  own: boolean;
  tokens: ThemeTokens;
  onReact: (reaction: MessageReactionValue, mine: boolean) => void;
  onReply: () => void;
  /** 3. fázis: továbbítás és kitűzés, bárkinek (Balázs, 2026-10-05). */
  onForward: () => void;
  onTogglePin: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const styles = panelStyles(tokens);
  const mine = new Set(
    message.reactions.filter((r) => r.mine).map((r) => r.reaction),
  );
  return (
    <View style={styles.panel} accessibilityLabel="Üzenet műveletei">
      <View style={styles.reactionRow}>
        {MESSAGE_REACTIONS.map((reaction) => (
          <Pressable
            key={reaction}
            accessibilityRole="button"
            accessibilityLabel={`Reakció: ${reaction}`}
            accessibilityState={{ selected: mine.has(reaction) }}
            onPress={() => onReact(reaction, mine.has(reaction))}
            style={[styles.reaction, mine.has(reaction) && styles.reactionMine]}
          >
            <Text style={styles.reactionText}>{reaction}</Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Bezárás"
          onPress={onClose}
          style={styles.close}
        >
          <Ionicons name="close" size={20} color={tokens.textSecondary} />
        </Pressable>
      </View>
      <PanelButton
        label="Válasz"
        icon="arrow-undo"
        tokens={tokens}
        onPress={onReply}
      />
      <PanelButton
        label="Továbbítás"
        icon="arrow-redo"
        tokens={tokens}
        onPress={onForward}
      />
      <PanelButton
        label={message.pinned ? "Kitűzés levétele" : "Kitűzés"}
        icon={message.pinned ? "pin" : "pin-outline"}
        tokens={tokens}
        onPress={onTogglePin}
      />
      {own ? (
        <>
          <PanelButton
            label="Szerkesztés"
            icon="create-outline"
            tokens={tokens}
            onPress={onEdit}
          />
          <PanelButton
            label="Üzenet törlése"
            icon="trash-outline"
            tokens={tokens}
            danger
            onPress={onDelete}
          />
        </>
      ) : null}
    </View>
  );
}

/** A csatolás menüje (Figma 454:457). A „Fájl kiválasztása” új buildet kér, ezért itt még nincs. */
export function AttachPanel({
  tokens,
  onCamera,
  onLibrary,
  onClose,
}: {
  tokens: ThemeTokens;
  onCamera: () => void;
  onLibrary: () => void;
  onClose: () => void;
}) {
  const styles = panelStyles(tokens);
  return (
    <View style={styles.panel} accessibilityLabel="Csatolás">
      <PanelButton
        label="Fotó készítése"
        icon="camera-outline"
        tokens={tokens}
        onPress={onCamera}
      />
      <PanelButton
        label="Fotó választása"
        icon="images-outline"
        tokens={tokens}
        onPress={onLibrary}
      />
      <PanelButton
        label="Mégse"
        icon="close"
        tokens={tokens}
        onPress={onClose}
      />
    </View>
  );
}

/** A feltöltési sor: fájlonként név, haladás vagy méret, hiba, Újra és Eltávolítás. */
export function UploadChips({
  uploads,
  canRetry,
  tokens,
  onRetry,
  onRemove,
}: {
  uploads: readonly PendingUpload[];
  canRetry: (localId: string) => boolean;
  tokens: ThemeTokens;
  onRetry: (localId: string) => void;
  onRemove: (localId: string) => void;
}) {
  const styles = panelStyles(tokens);
  return (
    <View style={styles.uploads} accessibilityLabel="Csatolmányok">
      {uploads.map((upload) => (
        <View
          key={upload.localId}
          style={[
            styles.upload,
            upload.status === "failed" && styles.uploadFailed,
          ]}
        >
          <Text style={styles.uploadName} numberOfLines={1}>
            {upload.fileName}
          </Text>
          <Text
            style={
              upload.status === "failed"
                ? styles.uploadError
                : styles.uploadMeta
            }
            numberOfLines={2}
          >
            {upload.status === "uploading"
              ? `${upload.percent}%`
              : upload.status === "done"
                ? fileSizeLabel(upload.sizeBytes)
                : (upload.error ?? "Hiba")}
          </Text>
          {upload.status === "failed" && canRetry(upload.localId) ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Újra: ${upload.fileName}`}
              onPress={() => onRetry(upload.localId)}
            >
              <Text style={styles.uploadAction}>Újra</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Eltávolítás: ${upload.fileName}`}
            onPress={() => onRemove(upload.localId)}
            hitSlop={8}
          >
            <Ionicons name="close" size={16} color={tokens.textSecondary} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function PanelButton({
  label,
  icon,
  tokens,
  danger = false,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  tokens: ThemeTokens;
  danger?: boolean;
  onPress: () => void;
}) {
  const styles = panelStyles(tokens);
  const color = danger ? tokens.danger : tokens.textPrimary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.button}
    >
      <Ionicons name={icon} size={20} color={color} />
      <Text style={[styles.buttonText, { color }]}>{label}</Text>
    </Pressable>
  );
}

const bubbleStyles = (t: ThemeTokens) =>
  StyleSheet.create({
    column: { maxWidth: "82%", gap: 4 },
    columnOwn: { alignSelf: "flex-end", alignItems: "flex-end" },
    columnOther: { alignSelf: "flex-start", alignItems: "flex-start" },
    bubble: { padding: 12, gap: 6 },
    bubbleOwn: { alignSelf: "flex-end", backgroundColor: t.accentSoft },
    bubbleOther: { backgroundColor: t.surface },
    sender: { color: t.accentSoftText, fontSize: 12, fontWeight: "600" },
    forwarded: { color: t.textMuted, fontSize: 12, fontStyle: "italic" },
    highlighted: { backgroundColor: t.warningSoft, padding: 4 },
    quote: {
      borderLeftWidth: 3,
      borderLeftColor: t.accent,
      paddingLeft: 8,
      gap: 2,
    },
    quoteName: { color: t.accentSoftText, fontSize: 12, fontWeight: "600" },
    quoteText: { color: t.textSecondary, fontSize: 13 },
    deleted: { color: t.textMuted, fontSize: 15, fontStyle: "italic" },
    text: { color: t.textPrimary, fontSize: 15 },
    thumb: { width: 220, height: 165, backgroundColor: t.border },
    thumbError: { alignItems: "center", justifyContent: "center", padding: 8 },
    file: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      padding: 8,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.background,
    },
    fileBody: { flexShrink: 1, gap: 2 },
    fileName: { color: t.textPrimary, fontSize: 14, fontWeight: "500" },
    fileMeta: { color: t.textMuted, fontSize: 12 },
    meta: { color: t.textMuted, fontSize: 12, alignSelf: "flex-end" },
    reactions: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    chip: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface,
    },
    chipMine: { borderColor: t.accentBorder, backgroundColor: t.accentSoft },
    chipText: { color: t.textPrimary, fontSize: 13 },
  });

const panelStyles = (t: ThemeTokens) =>
  StyleSheet.create({
    panel: {
      backgroundColor: t.surface,
      borderTopWidth: 1,
      borderTopColor: t.border,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    reactionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingBottom: 6,
    },
    reaction: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: t.border,
    },
    reactionMine: {
      borderColor: t.accentBorder,
      backgroundColor: t.accentSoft,
    },
    reactionText: { fontSize: 20 },
    close: {
      marginLeft: "auto",
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    button: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 44,
    },
    buttonText: { fontSize: 15 },
    uploads: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      paddingHorizontal: 12,
      paddingTop: 8,
      backgroundColor: t.surface,
    },
    upload: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      maxWidth: "100%",
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: t.border,
    },
    uploadFailed: { borderColor: t.danger },
    uploadName: { color: t.textPrimary, fontSize: 12, maxWidth: 140 },
    uploadMeta: { color: t.textMuted, fontSize: 12 },
    uploadError: { color: t.danger, fontSize: 12, flexShrink: 1 },
    uploadAction: { color: t.accent, fontSize: 12, fontWeight: "600" },
  });
