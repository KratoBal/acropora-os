import { Pressable, StyleSheet, Text, View } from "react-native";

import { CollapsedPicker } from "./unit-picker";
import {
  categoryPickerPlan,
  type CategoryOption,
} from "@/lib/assets/category-picker-rows";

/**
 * A KATEGORIA-VALASZTO, EGY PELDANYBAN, MINDKET URLAPNAK.
 *
 * Ugyanaz az indok, ami a helyszin-valaszto kiemelese folott all: ott a
 * lepcsos alak a FELVITELI kepernyon keszult el, es a SZERKESZTO kepernyo
 * honapokig a regi alakot rajzolta -- senki nem vette eszre, mert ket kulon
 * blokk volt. Egy masolt kepernyo-reszlet ugyanigy romlana szet.
 *
 * ES AMI ITT TOBB, MINT A FELVITELEN: a SZERKESZTON allhat az eszkozon olyan
 * kategoria, ami azota KIVEZETESRE kerult. A valaszto a torzsadat AKTIV sorait
 * kinalja, tehat a kivezetett nem lenne benne -- a csukott sor „Nincs megadva"
 * feliratot mutatna, es a szerelo azt hinne, nincs beallitva semmi. Aztan
 * valasztana egyet, es egy ervenyes erteket irna felul vakon.
 *
 * Ezt a hibat a matricakodnal MAR EGYSZER megfizettuk (ott az ures doboz
 * allitotta, hogy nincs matrica). Ezert all itt a `currentName`: a hivo
 * atadja, mi all MOST az eszkozon, es a valaszto akkor is kiirja, ha a lista
 * nem ismeri.
 */
export function CategoryPicker({
  options,
  value,
  currentName,
  onChange,
  open,
  onToggle,
}: {
  /** A valaszthato (aktiv) kategoriak, ahogy a szerver adta. */
  options: readonly CategoryOption[];
  /** A most valasztott azonosito, vagy ures szoveg. */
  value: string;
  /**
   * AMI MOST AZ ESZKOZON ALL, NEVEN NEVEZVE -- akkor is, ha a lista nem
   * ismeri. A felviteli urlap nem ad at semmit (ott nincs „mostani"), a
   * szerkeszto viszont igen.
   */
  currentName?: string;
  onChange(categoryId: string): void;
  open: boolean;
  onToggle(): void;
}) {
  /*
    A DONTES TISZTA FUGGVENYBEN ALL (`categoryPickerPlan`), es nem kenyelembol:
    a mobilon NINCS komponens-teszt keretrendszer, tehat ami itt marad, azt
    semmi nem tudja megmerni. A kivezetett kategoria kezelese pont olyan
    szabaly, aminek merese van.
  */
  const terv = categoryPickerPlan({ options, value, currentName });

  return (
    <CollapsedPicker
      summary={terv.summary}
      hint="Koppints a listához"
      label="Kategória választása"
      open={open}
      onToggle={onToggle}
    >
      <View style={styles.grid}>
        {/*
          AZ URES VALASZTAS IS GOMB. A kategoria elhagyhato, es aki tevedesbol
          valasztott, annak vissza kell tudnia venni.
        */}
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
