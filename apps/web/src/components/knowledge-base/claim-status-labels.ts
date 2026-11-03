/**
 * AZ ÁLLÍTÁS ÁLLAPOTA SZAVAKKAL (UI-áttekintés, 4. csomag, 2026-11-03). Egy helyen áll, hogy az állítás-tár és a
 * következtetések lapja ugyanazt a szót mondja (korábban két külön térkép volt). A kulcsok a Prisma
 * `KnowledgeClaimStatus` felsorolásának értékei; a teszt a séma szövegéből ellenőrzi, hogy mind megvan.
 */
export type ClaimStatus =
  "VERIFIED" | "CANDIDATE" | "WITHDRAWN" | "DISPUTED" | "SUPERSEDED";

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  VERIFIED: "Ellenőrzött",
  CANDIDATE: "Ellenőrzésre vár",
  WITHDRAWN: "Visszavonva",
  DISPUTED: "Vitatott",
  SUPERSEDED: "Felülírva",
};

/** Az állapot szava; egy ismeretlen értéket (újabb szerver) változatlanul ad, nem találgat. */
export function claimStatusLabel(status: string): string {
  return (CLAIM_STATUS_LABELS as Record<string, string>)[status] ?? status;
}
