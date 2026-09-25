import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { UnitOfMeasureRow } from "@/lib/api/units-of-measure";
import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";

/**
 * A TELJESÍTMÉNY ÉS A MÉRTÉKEGYSÉGE, EGY PÉLDÁNYBAN -- MINDKÉT KÉPERNYŐRE.
 *
 * MIÉRT KÖZÖS KOMPONENS: a felviteli és a szerkesztő képernyő ugyanazt a párt
 * kezeli, és két másolat KÜLÖN romlik el. A matricakód mezőjénél ez már egyszer
 * megtörtént volna, és ott is egy példány lett belőle.
 *
 * A KETTŐ EGYMÁS MELLETT ÁLL, és ez nem elrendezési kérdés: egy „500"
 * mértékegység nélkül nem információ, hanem találgatásra hívás. Külön helyen a
 * szerelő nem látná, hogy összetartoznak -- a mentés viszont elutasítaná.
 *
 * A LEGÖRDÜLŐ HELYETT GOMBSOR: az appban nincs egyetlen `Modal` sem, és a
 * natív választó bevezetése önálló döntés lenne. Egy-két tucat egységnél a
 * kinyíló sor elég, és ugyanúgy néz ki, mint a helyszín-választó.
 */
export interface PerformanceFieldProps {
  value: string;
  unitId: string;
  /**
   * A VÁLASZTHATÓ EGYSÉGEK. Az eszközön MÁR álló egységet a hívó teszi bele,
   * akkor is, ha kivezették -- különben a szerelő nem látná, mi áll a gépen.
   */
  units: UnitOfMeasureRow[];
  onChangeValue(value: string): void;
  onChangeUnit(unitId: string): void;
  editable?: boolean;
}

export function PerformanceField({
  value,
  unitId,
  units,
  onChangeValue,
  onChangeUnit,
  editable = true,
}: PerformanceFieldProps) {
  const [open, setOpen] = useState(false);
  const selected = units.find((unit) => unit.id === unitId);
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>Teljesítmény</Text>
      <TextInput
        accessibilityLabel="Teljesítmény"
        value={value}
        onChangeText={onChangeValue}
        // A TIZEDESVESSZO A MAGYAR ALAK, es a kozos normalizalo forditja
        // pontra. A billentyuzet ezert decimalis, nem sima szam.
        keyboardType="decimal-pad"
        style={styles.input}
        placeholderTextColor={tokens.textMuted}
        placeholder="Nincs megadva"
        editable={editable}
      />

      <Text style={styles.label}>Mértékegység</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Mértékegység választása"
        accessibilityState={{ expanded: open, disabled: !editable }}
        disabled={!editable}
        onPress={() => setOpen((nyitva) => !nyitva)}
        style={styles.picker}
      >
        <Text style={styles.pickerText}>
          {selected ? `${selected.code} -- ${selected.name}` : "Nincs megadva"}
        </Text>
      </Pressable>

      {open ? (
        <View style={styles.options}>
          {/*
            A "NINCS MEGADVA" IS VALASZTHATO, es ez nem dísz: a par CSAK
            EGYUTT torolheto, tehat a szerelonek kell egy ut, amivel az
            egyseget is leveszi. Enelkul egy kiurített szam mellett ottmaradna
            az egyseg, es a mentes elbukna -- latszolag ok nelkul.
          */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Nincs megadva"
            onPress={() => {
              onChangeUnit("");
              setOpen(false);
            }}
            style={styles.option}
          >
            <Text style={styles.optionText}>Nincs megadva</Text>
          </Pressable>
          {units.map((unit) => (
            <Pressable
              key={unit.id}
              accessibilityRole="button"
              accessibilityLabel={`${unit.code} -- ${unit.name}`}
              onPress={() => {
                onChangeUnit(unit.id);
                setOpen(false);
              }}
              style={styles.option}
            >
              <Text style={styles.optionText}>
                {unit.code} -- {unit.name}
                {unit.isActive ? "" : " (kivezetve)"}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * A SZÍNEK 2026-09-25-TŐL A KÖZÖS `useAppTheme()`-BŐL JÖNNEK -- lásd
 * `category-picker.tsx` fejlécét ugyanerről a jelentésről (Balázs, 2026-09-25
 * 14:48, telefonos fényképek).
 *
 * AZ EREDETI ALAK NEM VISELT KERETET (`borderWidth`/`borderColor`) az
 * `input`/`picker`/`options` dobozokon, csak hátteret -- sötét módban ez nem
 * tűnt fel, mert a háttér és a doboz szándékosan két közeli sötét árnyalat
 * volt. Világos módban a `t.surface` fehér, tehát KERET NÉLKÜL a doboz
 * láthatatlanná válna a fehér lap hátterén -- ez lett volna a KÖVETKEZŐ
 * jelentett hiba, ha csak a hátteret tokenizálom. Ezért itt `t.border`
 * keretet is kapnak, ugyanazt a mintát követve, mint a többi mobil-űrlap
 * mezője (pl. `worksheets/new.tsx` `input` stílusa).
 */
function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    field: { gap: 6 },
    label: { color: t.textSecondary, fontSize: 13 },
    input: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 10,
      color: t.textPrimary,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    picker: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    pickerText: { color: t.textPrimary },
    options: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 10,
      overflow: "hidden",
    },
    option: { paddingHorizontal: 12, paddingVertical: 12 },
    optionText: { color: t.textPrimary },
  });
}
