/**
 * EGY KIMENŐ VÁZLAT TÖRLÉSE (kártya 6a75f15c; Balázs kérdése 2026-11-16: "miért nem lehet piszkozatot törölni?"). A szabály egy helyen, tisztán:
 * CSAK a VÁZLAT (`DRAFT`) törölhető, sorszám nélkül, és ha nem hivatkozik rá másik bizonylat. A kiállítás alatt álló (`ISSUING`, a kimenete ismeretlen),
 * a kiállított (`ISSUED`) és a Számlázz.hu által elutasított (`ISSUE_FAILED`: már volt hívás) sor nem törölhető, és a sztornózott számla sem (az kiállított).
 * Az `ISSUE_FAILED` szándékosan kimarad: a kiállítás elindult és a Számlázz.hu válaszolt, a nyoma számít; az javítható és újra kiállítható.
 */
export type DraftDeleteRefusalCode =
  "NOT_FOUND" | "NOT_DRAFT" | "REFERENCED" | "STALE";

export interface DraftDeleteRefusal {
  code: DraftDeleteRefusalCode;
  message: string;
}

const NOT_DRAFT: Record<string, string> = {
  ISSUING:
    "A kiállítás elindult, és a kimenete még nem ismert, ezért a bizonylat nem törölhető.",
  ISSUED: "Kiállított bizonylat nem törölhető. Ha hibás, sztornózni lehet.",
  ISSUE_FAILED:
    "A Számlázz.hu elutasította a kiállítást, ezért a bizonylat nem törölhető. Javítsd, és állítsd ki újra.",
};

export function draftDeleteRefusal(
  row: { status: string; invoiceNumber: string | null; updatedAt: Date },
  referencedBy: number,
  expectedUpdatedAt: Date,
): DraftDeleteRefusal | null {
  if (row.status !== "DRAFT")
    return {
      code: "NOT_DRAFT",
      message:
        NOT_DRAFT[row.status] ??
        "Csak vázlat törölhető: ez a bizonylat már nem vázlat.",
    };
  if (row.invoiceNumber !== null)
    return {
      code: "NOT_DRAFT",
      message: "Sorszámmal rendelkező bizonylat nem törölhető.",
    };
  if (referencedBy > 0)
    return {
      code: "REFERENCED",
      message:
        "Másik bizonylat hivatkozik erre a vázlatra, ezért nem törölhető.",
    };
  if (row.updatedAt.getTime() !== expectedUpdatedAt.getTime())
    return {
      code: "STALE",
      message:
        "A vázlatot időközben más is mentette. Töltsd újra, és nézd meg, mi változott.",
    };
  return null;
}
