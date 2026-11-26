import {
  worksheetDisplayStatus,
  worksheetDisplayStatusLabel,
  type WorksheetVersionStatus,
} from "@acropora/types";

/**
 * A MUNKALAP FOLYAMATSÁVJA (picasso képernyő-leltár 3.1; acrobot 62184).
 *
 * A három első lépés a jelvény szavaival szól, UGYANABBÓL A FORRÁSBÓL (`worksheetDisplayStatusLabel`): ha a jelvény szava egyszer
 * változik, a sáv vele változik, egy helyen. A szavak Balázs 2026-08-26-i állapotsora (Új, Folyamatban, Elkészült, Lezárva); a
 * negyedik lépés az átadás, ami KÜLÖN jelölés (`handedOverAt`), és bármikor rögzíthető, akár az aláírás előtt is: a sáv ezért
 * kipipálja, ha rögzítve van, a sorrendtől függetlenül.
 *
 * Az elutasított lap a harmadik lépésen áll, "Elutasítva" szóval: onnan a webes felületen nincs tovább (új verziót a lap nem ad).
 */
export type WorksheetProgressState = "done" | "current" | "todo" | "rejected";

export interface WorksheetProgressStep {
  key: "open" | "completed" | "closed" | "handedOver";
  label: string;
  state: WorksheetProgressState;
}

export function worksheetProgressSteps(
  status: WorksheetVersionStatus,
  lineCount: number,
  handedOver: boolean,
): WorksheetProgressStep[] {
  const display = worksheetDisplayStatus(status, lineCount);
  const order = { DRAFT: 0, AWAITING_SIGNATURE: 1, SIGNED: 2, REJECTED: 2 };
  const at = order[status];
  const stateOf = (index: number): WorksheetProgressState =>
    index < at ? "done" : index === at ? "current" : "todo";
  return [
    {
      key: "open",
      // a piszkozat a saját szavával (Új vagy Folyamatban), utána a "Folyamatban" mint megtett lépés
      label:
        status === "DRAFT"
          ? worksheetDisplayStatusLabel[display]
          : worksheetDisplayStatusLabel.IN_PROGRESS,
      state: stateOf(0),
    },
    {
      key: "completed",
      label: worksheetDisplayStatusLabel.COMPLETED,
      state: stateOf(1),
    },
    {
      key: "closed",
      label:
        status === "REJECTED"
          ? worksheetDisplayStatusLabel.REJECTED
          : worksheetDisplayStatusLabel.CLOSED,
      state:
        status === "REJECTED"
          ? "rejected"
          : status === "SIGNED"
            ? "done"
            : stateOf(2),
    },
    {
      key: "handedOver",
      label: "Átadva",
      state: handedOver ? "done" : status === "SIGNED" ? "current" : "todo",
    },
  ];
}

/**
 * HIBA-E, HOGY AZ ÁTADÁS NINCS RÖGZÍTVE (picasso 3.1). A hibajegy alatti lapnál hiányzó lépés: a hibajegy lezárásának kapuja
 * (`worksheet-signature-gate.ts`, `worksheetsBlockingTicketClose`) minden lapjától megköveteli az átadást. A karbantartási lapnál és az
 * önálló lapnál nem kötelező: ott semmi nem vár rá. Rögzített átadásnál `null`.
 */
export function handoverNote(input: {
  handedOver: boolean;
  serviceJob: { jobNumber: string; kind?: "REPAIR" | "MAINTENANCE" } | null;
}): { required: boolean; text: string } | null {
  if (input.handedOver) return null;
  // a jegy fajtája a régi válaszból hiányozhat: akkor hibajegy (`serviceJobRef` ugyanígy dönt)
  if (input.serviceJob && input.serviceJob.kind !== "MAINTENANCE")
    return {
      required: true,
      text: `A ${input.serviceJob.jobNumber} hibajegy csak az átadás rögzítése után zárható le.`,
    };
  return {
    required: false,
    text: "Ennél a lapnál az átadás rögzítése nem kötelező.",
  };
}
