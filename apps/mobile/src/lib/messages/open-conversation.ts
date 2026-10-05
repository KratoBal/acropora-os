/**
 * MELYIK BESZÉLGETÉS VAN ÉPP NYITVA (3. fázis, a prompt 21. pontja). A
 * beszélgetés-képernyő írja, amíg fókuszban van; az értesítés-kezelő olvassa,
 * hogy a nyitott beszélgetésről ne jöjjön külön sáv. Modul-szintű, mert a
 * kezelő a komponens-fán kívül, a gyökér-elrendezésben regisztrál.
 */
let open: string | null = null;

export function setOpenConversation(id: string | null): void {
  open = id;
}

export function openConversationId(): string | null {
  return open;
}
