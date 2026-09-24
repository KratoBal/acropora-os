/**
 * A Számlázz.hu Agent Key kapcsolat MEGOSZTOTT típusai: amit az API kiad, és
 * amit a Beállítások-felület megjeleníthet.
 *
 * A Medusa kapcsolat mintáját követi (lásd medusa-connection.ts), egy
 * szándékos eltéréssel: nincs `state`/`verification` mező. A Medusánál ezt
 * egy ártalmatlan, ingyenes olvasó próba tölti fel; a Számlázz.hu Agent
 * API-nak nincs ilyen próba-végpontja -- az egyetlen módja a kulcs
 * kipróbálásának egy VALÓDI `generating_invoice` hívás, amit a
 * piszkozat-készítés indít, nem egy Beállítások-oldali "Teszt" gomb.
 */

export interface SzamlazzConnectionCredentialInput {
  agentKey: string;
}

export interface SzamlazzConnectionView {
  configured: boolean;
  masked: "••••••••" | null;
  modifiedAt: string | null;
}
