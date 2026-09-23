import { Pressable, StyleSheet, Text, View } from "react-native";

import { CollapsedPicker } from "./unit-picker";
import {
  functionPickerPlan,
  type FunctionOption,
} from "@/lib/assets/function-picker-rows";

/**
 * A FUNKCIO-VALASZTO, EGY PELDANYBAN, MINDKET URLAPNAK -- SZO SZERINT A
 * `CategoryPicker` SZERKEZETE, mas torzsadaton. Lasd ott a teljes indoklast
 * (a kivezetett-de-most-is-ervenyes eset ugyanaz a hiba, amit a matricakodnal
 * mar egyszer megfizettunk).
 *
 * Kanban 68add892, 2026-09-22: Balazs kerese szerint "ugyanugy legordulo
 * menube" kerul, mint a kategoria -- FUGGETLENUL tole.
 */
export function FunctionPicker({
  options,
  value,
  currentName,
  onChange,
  open,
  onToggle,
}: {
  /** A valaszthato (aktiv) funkciok, ahogy a szerver adta. */
  options: readonly FunctionOption[];
  /** A most valasztott azonosito, vagy ures szoveg. */
  value: string;
  /**
   * AMI MOST AZ ESZKOZON ALL, NEVEN NEVEZVE -- akkor is, ha a lista nem
   * ismeri. A felviteli urlap nem ad at semmit (ott nincs „mostani"), a
   * szerkeszto viszont igen.
   */
  currentName?: string;
  onChange(functionId: string): void;
  open: boolean;
  onToggle(): void;
}) {
  const terv = functionPickerPlan({ options, value, currentName });

  return (
    <CollapsedPicker
      summary={terv.summary}
      hint="Koppints a listához"
      label="Funkció választása"
      open={open}
      onToggle={onToggle}
    >
      <View style={styles.grid}>
        <Pressable
          accessibilityRole="button"
          onPress={() => onChange("")}
          style={[styles.button, value === "" && styles.selected]}
        >
          <Text style={styles.text}>Nincs megadva</Text>
        </Pressable>
        {terv.rows.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            onPress={() => onChange(item.id)}
            style={[styles.button, value === item.id && styles.selected]}
          >
            <Text style={styles.text}>{item.name}</Text>
          </Pressable>
        ))}
      </View>
    </CollapsedPicker>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  button: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#21485e",
    backgroundColor: "#0a2335",
  },
  selected: { borderColor: "#52d6c7", backgroundColor: "#12443f" },
  text: { color: "#f4fbff", fontWeight: "700" },
});
