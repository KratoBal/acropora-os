import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { PhotoFieldInput } from "@/components/operations-log/PhotoFieldInput";
import {
  ENTRY_LIMITS,
  type OperationsEntryForm,
} from "@/lib/operations-log/entry-form";
import type { OperationsTemplateField } from "@/lib/api/operations-log";
import type { ThemeTokens } from "@/lib/theme/tokens";

/**
 * AZ ÜZEMELTETÉSI NAPLÓ RÖGZÍTŐ KÉPERNYŐINEK KÖZÖS ELEMEI (kártya 1a35e8f3): az egy eszközre szóló `record.tsx` és a csoportos
 * `group.tsx` ugyanazt a mezősort és ugyanazokat a stílusokat használja, hogy a kettő ne szakadjon szét (egy mezőtípus megjelenése
 * egy helyen áll). A `record.tsx`-ből kiemelve, a viselkedés változatlan.
 */
export type RecordStyles = ReturnType<typeof createRecordStyles>;

export function FieldRow(props: {
  field: OperationsTemplateField;
  divider: boolean;
  form: OperationsEntryForm;
  invalid: boolean;
  onValue: (value: string | boolean) => void;
  onPhotos: (files: OperationsEntryForm["photos"][string]) => void;
  styles: RecordStyles;
  tokens: ThemeTokens;
}) {
  const { field, form, styles, tokens } = props;
  const raw = form.values[field.key];
  const label = field.required ? `${field.label} *` : field.label;
  return (
    <View style={[styles.paramRow, props.divider && styles.paramRowDivider]}>
      <Text style={styles.paramRowLabel}>{label}</Text>
      {field.type === "NUMBER" ? (
        <View style={styles.paramRowInputWrap}>
          <TextInput
            value={typeof raw === "string" ? raw : ""}
            onChangeText={props.onValue}
            keyboardType="decimal-pad"
            placeholder="—"
            placeholderTextColor={tokens.textMuted}
            style={[
              styles.paramRowInput,
              props.invalid && styles.paramRowInputError,
            ]}
          />
          {field.unit ? (
            <Text style={styles.paramRowUnit}>{field.unit}</Text>
          ) : null}
        </View>
      ) : field.type === "BOOLEAN" ? (
        <View style={styles.yesNo}>
          {([true, false] as const).map((choice) => (
            <Pressable
              key={String(choice)}
              onPress={() => props.onValue(choice)}
              style={[
                styles.yesNoButton,
                raw === choice && styles.yesNoSelected,
              ]}
            >
              <Text
                style={[
                  styles.yesNoText,
                  raw === choice && styles.yesNoTextSelected,
                ]}
              >
                {choice ? "Igen" : "Nem"}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : field.type === "TEXT" ? (
        <TextInput
          value={typeof raw === "string" ? raw : ""}
          onChangeText={props.onValue}
          placeholder="—"
          placeholderTextColor={tokens.textMuted}
          style={[styles.textInput, props.invalid && styles.paramRowInputError]}
          maxLength={ENTRY_LIMITS.textMax}
          multiline
        />
      ) : (
        <PhotoFieldInput
          files={form.photos[field.key] ?? []}
          onChange={props.onPhotos}
          max={ENTRY_LIMITS.photosPerFieldMax}
        />
      )}
    </View>
  );
}

export function createRecordStyles(t: ThemeTokens) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: t.background },
    flex: { flex: 1 },
    container: { padding: 18, paddingBottom: 48, gap: 14 },
    navBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 18,
      paddingTop: 8,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
      backgroundColor: t.surface,
      gap: 12,
    },
    navCancel: { color: t.accent, fontSize: 14 },
    navTitle: {
      color: t.textPrimary,
      fontSize: 16,
      fontWeight: "800",
      flexShrink: 1,
    },
    navSave: { color: t.accent, fontSize: 14, fontWeight: "800" },
    assetName: { color: t.textPrimary, fontSize: 18, fontWeight: "800" },
    paramCard: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 14,
      overflow: "hidden",
    },
    paramRow: {
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    paramRowDivider: { borderTopWidth: 1, borderTopColor: t.border },
    paramRowLabel: { color: t.textPrimary, fontSize: 14, fontWeight: "700" },
    paramRowInputWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
    paramRowInput: {
      color: t.textPrimary,
      fontSize: 15,
      textAlign: "right",
      minWidth: 96,
      flex: 1,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 6,
      backgroundColor: t.background,
    },
    paramRowInputError: { borderColor: t.danger },
    paramRowUnit: { color: t.textSecondary, fontSize: 12, minWidth: 40 },
    textInput: {
      color: t.textPrimary,
      fontSize: 15,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      minHeight: 44,
      backgroundColor: t.background,
    },
    yesNo: { flexDirection: "row", gap: 8 },
    yesNoButton: {
      flex: 1,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 10,
      paddingVertical: 10,
      alignItems: "center",
      backgroundColor: t.background,
    },
    yesNoSelected: { backgroundColor: t.accent, borderColor: t.accent },
    yesNoText: { color: t.textPrimary, fontSize: 14, fontWeight: "700" },
    yesNoTextSelected: { color: t.textOnAccent },
    section: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 14,
      padding: 14,
      gap: 10,
    },
    sectionTitle: { color: t.textPrimary, fontSize: 15, fontWeight: "800" },
    timeRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    startButton: {
      borderWidth: 1,
      borderColor: t.accent,
      borderRadius: 10,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    startButtonText: { color: t.accent, fontSize: 14, fontWeight: "800" },
    timeValue: { color: t.textPrimary, fontSize: 15 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: {
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: t.background,
    },
    chipSelected: { backgroundColor: t.accent, borderColor: t.accent },
    chipText: { color: t.textPrimary, fontSize: 13 },
    chipTextSelected: { color: t.textOnAccent, fontWeight: "700" },
    switchRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    input: {
      color: t.textPrimary,
      fontSize: 15,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: t.background,
    },
    notesInput: { minHeight: 70, textAlignVertical: "top" },
    hint: { color: t.textSecondary, fontSize: 12 },
    notice: { color: t.accent, fontSize: 13 },
    error: { color: t.danger, fontSize: 13 },
  });
}
