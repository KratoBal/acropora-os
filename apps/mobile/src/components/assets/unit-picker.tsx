import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ReactNode } from "react";

import { unitLevels, unitPickerPlan } from "@/lib/partners/site-tree";
import type { PartnerUnitLike } from "@/lib/partners/site-tree";

/**
 * A HELYSZIN-VALASZTO, EGY PELDANYBAN, MINDKET URLAPNAK.
 *
 * MIERT KELLETT KIEMELNI. A lepcsos valaszto (egy szint egyszerre, folotte a
 * mar eldontott lepesek) a FELVITELI kepernyon keszult el, es ott is maradt. A
 * SZERKESZTO kepernyo tovabbra is a regi alakot rajzolta: MINDEN szintet
 * egyszerre kiteritve, teljes szelessegu sorokkent. Balazs kepernyofotokon
 * mutatta meg a kulonbseget 2026-09-16 10:41-kor (Discord, mobilalkalmazas
 * szal), szo szerint: "jo lenne ha a helyszin nem igy jelenne meg mint a kepen,
 * hanem csak a tenyleges helyszin-fa mint a masik kepen".
 *
 * NEM MASOLAS, HANEM KOZOS PELDANY, es ennek mert oka van. A `unitPickerPlan`
 * sajat megjegyzese pontosan errol szol: ott korabban KET helyen allt ugyanaz
 * az ut-szamitas, es a masodikat semmi nem merte. Egy masolt kepernyo-blokk
 * ugyanez lenne, csak nagyobban.
 *
 * AMI SZANDEKOSAN KIVUL MARADT: a gyorsitotar-sav es a "meg nincs helyszin"
 * mondat. Azok a ket kepernyon MAST mondanak (a szerkeszton egy MEGLEVO eszkoz
 * helyszine all, a felvitelen semmi), tehat a hivo adja oket.
 */

/** A mar eldontott lepesek es a soron kovetkezo szint, egy sorban osszefoglalva. */
export interface UnitPickerProps {
  /** A partner osszes helyszine, lapos listaban. A fat ebbol epiti. */
  rows: readonly PartnerUnitLike[];
  /** A jelenleg valasztott helyszin, vagy ures szoveg, ha nincs. */
  value: string;
  onChange(unitId: string): void;
  open: boolean;
  onToggle(): void;
  /**
   * HANY KIVEZETETT HELYSZIN NEM VALASZTHATO. A kihagyas nem nema: aki tudja,
   * hogy annak a partnernek hat helyszine van, es negyet lat, a LISTAT hiszi
   * hibasnak.
   */
  hiddenCount?: number;
}

export function UnitPicker({
  rows,
  value,
  onChange,
  open,
  onToggle,
  hiddenCount = 0,
}: UnitPickerProps) {
  /*
    EGY SZAMITAS AZ OSSZEFOGLALORA ES A LEPCSORE. Ha a ket helyen kulon allna,
    a fejlec mas utat mutathatna, mint amit a lepcso epp kinal.
  */
  const plan = unitPickerPlan(unitLevels(rows, value || null));

  return (
    <CollapsedPicker
      summary={plan.path || "Nincs helyszín kiválasztva"}
      hint="Koppints a listához"
      label="Helyszín választása"
      open={open}
      onToggle={onToggle}
    >
      {plan.steps.map((step) => (
        /*
          A BECSUKOTT SZINT VISSZANYITHATO. Enelkul egy rossz koppintas
          zsakutca lenne: a valasztott elem eltunik a listabol, es nincs mibol
          mast valasztani. A visszalepes a SZULOIG megy, mert a szint listaja a
          szulo gyermekeibol all; a gyokeren ez az ures valasztas.
        */
        <Pressable
          key={`lepes-${step.depth}`}
          onPress={() =>
            onChange(
              step.depth === 0
                ? ""
                : (plan.steps[step.depth - 1]?.option.id ?? ""),
            )
          }
          style={[styles.row, styles.rowSelected]}
        >
          <Text style={styles.name}>{step.option.label}</Text>
          <Text style={styles.meta}>Koppints a módosításhoz</Text>
        </Pressable>
      ))}
      {plan.open === null ? null : (
        <View style={styles.level}>
          {plan.open.options.map((option) => (
            /*
              A KIVEZETETT HELYSZIN LATSZIK, DE NEM VALASZTHATO. Ha egy meglevo
              eszkoz epp ilyenen all, a lanc akkor is felepul rajta (a lepesek
              kozott), kulonben a beallitott helyszin neman eltunne.
            */
            <Pressable
              key={option.id}
              disabled={!option.isActive}
              onPress={() => onChange(option.id)}
              style={[styles.row, !option.isActive && styles.rowOff]}
            >
              <Text style={styles.name}>
                {option.label}
                {option.isActive ? "" : " (kivezetett)"}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {hiddenCount > 0 ? (
        <Text style={styles.hint}>
          {hiddenCount} kivezetett helyszín nem választható.
        </Text>
      ) : null}
    </CollapsedPicker>
  );
}

/**
 * OSSZECSUKOTT VALASZTO: egy sor az eredmennyel, alatta a lista, ha nyitva van.
 *
 * ES AMI ITT MAS, MINT A TIPUS-VALASZTONAL: valasztaskor NEM csukodik be. A
 * lepcsos valasztonal egy koppintas egyben LEFELE LEPES is, tehat a becsukas
 * epp a lefuras kozben venne el a listat.
 */
export function CollapsedPicker({
  summary,
  hint,
  label,
  open,
  onToggle,
  children,
}: {
  summary: string;
  hint: string;
  label: string;
  open: boolean;
  onToggle(): void;
  children: ReactNode;
}) {
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${summary}. Koppints a módosításhoz.`}
        onPress={onToggle}
        style={styles.row}
      >
        <Text style={styles.name}>{summary}</Text>
        <Text style={styles.meta}>{hint}</Text>
      </Pressable>
      {open ? children : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    padding: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#21485e",
    backgroundColor: "#0a2335",
  },
  rowSelected: { borderColor: "#52d6c7", backgroundColor: "#12443f" },
  rowOff: { opacity: 0.5 },
  // Egy szint egy sor: a szintek kozotti tavolsag mutatja, hogy lejjebb leptunk.
  level: { gap: 6, marginBottom: 8 },
  name: { color: "#f4fbff", fontWeight: "800" },
  meta: { color: "#789cad", fontSize: 11, marginTop: 2 },
  hint: { color: "#789cad", fontSize: 12, lineHeight: 17 },
});
