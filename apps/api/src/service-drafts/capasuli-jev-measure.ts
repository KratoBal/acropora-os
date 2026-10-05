import { maskEmails } from "@acropora/jev";

import { fold } from "./capasuli-extractor.js";
import { draftFilterState, type CapasuliVerdict } from "./capasuli-filter.js";

/**
 * A CÁPASULI SZŰRÉS VAK MÉRÉSE (brief: "Before it is switched on"). Tiszta
 * rész: a kézi címke, a tétel sorsa és az összesítés. A parancs
 * (`capasuli-jev-measure.cli.ts`) csak olvas és ezt hívja.
 *
 * A KÉZI CÍMKÉK acrobot 2057-es emlékéből (a 09.24-10.03 közötti 10 levél):
 * a szabály a tétel szövegében keresett szótő, ékezet és betűméret nélkül. Ami
 * egyikre sem illik, az CÍMKÉZETLEN: a mérésben külön sor, nem pontszám.
 */
export type HandLabel = "OURS" | "NOT_OURS";

export interface LabelRule {
  readonly name: string;
  readonly label: HandLabel;
  /** Ékezet nélküli, kisbetűs szótövek; bármelyik illeszkedése elég. */
  readonly stems: readonly string[];
}

export const HAND_LABELS: readonly LabelRule[] = [
  { name: "bioszűrő felnyomó motor", label: "OURS", stems: ["felnyomo"] },
  { name: "csöpögő cső a lehabzó felett", label: "OURS", stems: ["csopog"] },
  {
    name: "sókeverő szivattyú szűrőkosár",
    label: "OURS",
    stems: ["sokevero"],
  },
  { name: "venturi szivattyú takarítás", label: "OURS", stems: ["venturi"] },
  {
    name: "LCD kijelző a korallos felett",
    label: "OURS",
    stems: ["lcd", "kijelzo"],
  },
  { name: "AF Power Elixir elfogyott", label: "OURS", stems: ["elixir"] },
  { name: "biodóm ajtó", label: "NOT_OURS", stems: ["biodom", "ajto"] },
  { name: "nyitvatartás", label: "NOT_OURS", stems: ["nyitvatart"] },
  { name: "búvármaszk", label: "NOT_OURS", stems: ["buvar", "maszk"] },
  { name: "tető beázás", label: "NOT_OURS", stems: ["teto", "beaz"] },
];

export function handLabel(
  text: string,
  rules: readonly LabelRule[] = HAND_LABELS,
): LabelRule | null {
  const folded = fold(text);
  return (
    rules.find((rule) => rule.stems.some((s) => folded.includes(s))) ?? null
  );
}

export interface MeasuredItem {
  readonly reportDate: string;
  readonly title: string;
  readonly rule: LabelRule | null;
  readonly verdict: CapasuliVerdict | null;
}

/** Látszik-e a tétel a piszkozatok között ezzel a besorolással és küszöbbel. */
export function shownAsDraft(
  verdict: CapasuliVerdict | null,
  threshold: number,
): boolean {
  return draftFilterState(verdict, threshold) !== "FILTERED";
}

export function measurementReport(
  items: readonly MeasuredItem[],
  threshold: number,
): string {
  const line = (i: MeasuredItem) => {
    const v = i.verdict
      ? `${i.verdict.kind} ${i.verdict.confidence.toFixed(2)}`
      : "NINCS BESOROLÁS";
    const sors = shownAsDraft(i.verdict, threshold) ? "piszkozat" : "kiszűrve";
    const cimke = i.rule ? `${i.rule.label} (${i.rule.name})` : "címkézetlen";
    // a kimenet is ember elé kerül: e-mail-cím itt sem áll
    const cim = maskEmails(i.title).text.slice(0, 90);
    return `  ${i.reportDate}\t${cimke}\t${v}\t${sors}\t${cim}`;
  };
  const ours = items.filter((i) => i.rule?.label === "OURS");
  const notOurs = items.filter((i) => i.rule?.label === "NOT_OURS");
  const unlabeled = items.filter((i) => !i.rule);
  const shown = (i: MeasuredItem) => shownAsDraft(i.verdict, threshold);
  const oursMissed = ours.filter((i) => !shown(i));
  const notOursMissed = notOurs.filter(shown);
  const failed = items.filter((i) => !i.verdict);
  const names = (list: readonly MeasuredItem[]) =>
    list.length
      ? list.map((i) => `${i.reportDate} ${i.rule!.name}`).join("; ")
      : "nincs";
  return [
    `Küszöb: ${threshold}. Tételek: ${items.length} (nekünk szóló ${ours.length}, nem nekünk szóló ${notOurs.length}, címkézetlen ${unlabeled.length}, besorolás nélkül ${failed.length}).`,
    `Nekünk szóló, piszkozat lett: ${ours.length - oursMissed.length} / ${ours.length}. TÉVESEN KISZŰRVE: ${names(oursMissed)}.`,
    `Nem nekünk szóló, kiszűrve: ${notOurs.length - notOursMissed.length} / ${notOurs.length}. TÉVESEN ÁTENGEDVE: ${names(notOursMissed)}.`,
    `Címkézetlen: ${unlabeled.filter(shown).length} piszkozat, ${unlabeled.filter((i) => !shown(i)).length} kiszűrve (szemmel kell nézni, lent a listában).`,
    "Tételenként (nap, kézi címke, Jev, sors, cím):",
    ...items.map(line),
  ].join("\n");
}
