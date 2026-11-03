/**
 * AZ ÁLLÍTÁS ÁLLAPOTA SZAVAKKAL (UI-áttekintés, 4. csomag, 2026-11-03). Egy helyen áll, hogy az állítás-tár és a
 * következtetések lapja ugyanazt a szót mondja (korábban két külön térkép volt). A kulcsok a Prisma
 * `KnowledgeClaimStatus` felsorolásának értékei; a teszt a séma szövegéből ellenőrzi, hogy mind megvan.
 */
export type ClaimStatus =
  "VERIFIED" | "CANDIDATE" | "WITHDRAWN" | "DISPUTED" | "SUPERSEDED";

export const UNKNOWN_CLAIM_STATUS = "Ismeretlen állapot";

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  VERIFIED: "Ellenőrzött",
  CANDIDATE: "Ellenőrzésre vár",
  WITHDRAWN: "Visszavonva",
  DISPUTED: "Vitatott",
  SUPERSEDED: "Felülírva",
};

/** Az állapot szava; egy ismeretlen értéket (a webnél újabb szerver) szóval jelöl, nem nyers kóddal. */
export function claimStatusLabel(status: string): string {
  return (
    (CLAIM_STATUS_LABELS as Record<string, string>)[status] ??
    UNKNOWN_CLAIM_STATUS
  );
}
