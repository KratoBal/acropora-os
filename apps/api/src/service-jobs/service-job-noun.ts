/**
 * A LAP NEVE A MONDATBAN, A FAJTA SZERINT (hibajegy-maradek lista, acrobot 56117; Balázs 2026-11-18: "a karbantartásnak semmi köze a hibajegyekhez"). A KT-lap a saját nevén szerepel a
 * hibaüzenetekben és a naplósorokban, a javítási jegy "hibajegy" marad. A ragos alakok kiírva (gépi ragozás nincs).
 */
export interface ServiceJobNoun {
  /** "hibajegy" / "karbantartási lap" */
  nominative: string;
  /** "hibajegyet" / "karbantartási lapot" */
  accusative: string;
  /** "Hibajegyet" / "Karbantartási lapot": a mondat elején */
  accusativeCapital: string;
  /** "hibajegyről" / "karbantartási lapról": -ról/-ről (a lezárási kapu tanácsa, acrobot 56118) */
  delative: string;
  /** "jegy" / "lap": a rövid, már megnevezett lapra */
  short: string;
}

export function serviceJobNoun(
  kind: string | null | undefined,
): ServiceJobNoun {
  return kind === "MAINTENANCE"
    ? {
        nominative: "karbantartási lap",
        accusative: "karbantartási lapot",
        accusativeCapital: "Karbantartási lapot",
        delative: "karbantartási lapról",
        short: "lap",
      }
    : {
        nominative: "hibajegy",
        accusative: "hibajegyet",
        accusativeCapital: "Hibajegyet",
        delative: "hibajegyről",
        short: "jegy",
      };
}
