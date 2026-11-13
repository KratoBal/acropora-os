import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { toPickedImages, type PickedFile } from "@/lib/api/picked-image";
import {
  pickPhotosFromLibrary,
  takePhotoFromCamera,
} from "@/lib/photos/pick-photos";
import { useAppTheme } from "@/lib/theme/useAppTheme";

/**
 * EGY FÉNYKÉP MEZŐ AZ ÜZEMELTETÉSI NAPLÓ RÖGZÍTŐ ŰRLAPJÁN (task os-uzemeltetesi-naplo, S2c): fényképezés és galéria, a kiválasztott
 * képek száma, törlés. A képek NEM itt töltődnek fel: a rögzítés után mennek (`lib/operations-log/entry-photos.ts`), térerő nélkül a
 * sorban várnak. A választás szabályai (csak JPEG és PNG, ugyanaz a fájl egyszer, a kihagyottak kimondva) ugyanazok, mint a
 * `use-photo-attachments.ts` horogban; ide külön áll, mert a horog EGY listát vezet, ez a mező-nkénti listát a szülő űrlapban.
 */
export function PhotoFieldInput(props: {
  files: readonly PickedFile[];
  onChange: (files: PickedFile[]) => void;
  max: number;
}) {
  const { tokens } = useAppTheme();
  const styles = createStyles(tokens);
  const [notice, setNotice] = useState<string | null>(null);

  function take(result: Awaited<ReturnType<typeof takePhotoFromCamera>>): void {
    if (result.kind === "denied") {
      setNotice(result.notice);
      return;
    }
    if (result.kind === "cancelled") return;
    const { files, skipped } = toPickedImages(result.assets);
    const known = new Set(props.files.map((file) => file.uri));
    const merged = [
      ...props.files,
      ...files.filter((file) => !known.has(file.uri)),
    ];
    props.onChange(merged.slice(0, props.max));
    const parts: string[] = [];
    if (skipped.length > 0)
      parts.push(`Kimaradt (csak JPEG és PNG megy): ${skipped.join(", ")}.`);
    if (merged.length > props.max)
      parts.push(`Legfeljebb ${props.max} kép adható meg.`);
    setNotice(parts.length > 0 ? parts.join(" ") : null);
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          onPress={async () => {
            setNotice(null);
            take(await takePhotoFromCamera());
          }}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Fénykép készítése</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={async () => {
            setNotice(null);
            take(await pickPhotosFromLibrary());
          }}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Galéria</Text>
        </Pressable>
      </View>
      {props.files.length > 0 ? (
        <View style={styles.row}>
          <Text style={styles.count}>{props.files.length} kép kiválasztva</Text>
          <Pressable onPress={() => props.onChange([])}>
            <Text style={styles.clear}>Képek törlése</Text>
          </Pressable>
        </View>
      ) : null}
      {notice ? <Text style={styles.hint}>{notice}</Text> : null}
    </View>
  );
}

function createStyles(t: ReturnType<typeof useAppTheme>["tokens"]) {
  return StyleSheet.create({
    wrap: { gap: 8, flex: 1 },
    row: { flexDirection: "row", gap: 8, alignItems: "center" },
    button: {
      flex: 1,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 10,
      paddingVertical: 10,
      alignItems: "center",
      backgroundColor: t.background,
    },
    buttonText: { color: t.accent, fontSize: 13, fontWeight: "700" },
    count: { color: t.textPrimary, fontSize: 13, flex: 1 },
    clear: { color: t.accent, fontSize: 13, fontWeight: "700" },
    hint: { color: t.textSecondary, fontSize: 12 },
  });
}
