import type {
  DocumentKey,
  DocumentOwner,
  DocumentStore,
  DocumentStoreStatus,
} from "./document-store.js";

/**
 * MEMÓRIABELI DOKUMENTUM-TÁROLÓ, tesztekhez és fejlesztői futtatáshoz.
 *
 * MIÉRT ÍRÓDIK MEG A FÁJLRENDSZERES ELŐTT: enélkül minden eszköz-teszt vödröt
 * vagy csatolt könyvtárat kívánna, és az új globális előfeltétel lenne az egész
 * csomagnak. Egy tárolót, ami nincs, nem lehet elfelejteni beállítani.
 *
 * A KÉT MÁSOLÁS NEM ÓVATOSKODÁS, HANEM A VISELKEDÉS AZONOSSÁGA. A fájlrendszeres
 * változat a bájtokat kiírja, tehát a hívó által utólag módosított tömb NEM
 * változtatja meg a tárolt tartalmat, és a beolvasott tömb módosítása sem ír
 * vissza a lemezre. Ha a memóriabeli megvalósítás ugyanazt a tömböt adná vissza,
 * amit kapott, akkor a két megvalósítás CSENDBEN térne el: a teszt zöld lenne,
 * az éles út pedig másképp működne. Ezért másol a `put` és a `get` is.
 */
export class InMemoryDocumentStore implements DocumentStore {
  private readonly documents = new Map<string, Uint8Array>();

  async put(key: DocumentKey, bytes: Uint8Array): Promise<void> {
    this.documents.set(serialiseKey(key), Uint8Array.from(bytes));
  }

  async get(key: DocumentKey): Promise<Uint8Array | null> {
    const stored = this.documents.get(serialiseKey(key));
    return stored ? Uint8Array.from(stored) : null;
  }

  /**
   * A TAROLT TOMB HOSSZA. Itt nincs kulon `stat`, tehat a meret ugyanabbol az
   * adatbol jon, amit a `get()` ad vissza -- a ket megvalositas igy ugyanazt
   * allitja ugyanarrol a fajlrol.
   */
  async size(key: DocumentKey): Promise<number | null> {
    const stored = this.documents.get(serialiseKey(key));
    return stored ? stored.byteLength : null;
  }

  async delete(key: DocumentKey): Promise<boolean> {
    return this.documents.delete(serialiseKey(key));
  }

  async *list(): AsyncIterable<DocumentKey> {
    for (const serialised of [...this.documents.keys()]) {
      const [owner, ownerId, documentId] = JSON.parse(serialised) as [
        DocumentOwner,
        string,
        string,
      ];
      yield { owner, ownerId, documentId };
    }
  }

  /**
   * A memóriabeli tároló mindig kész: nincs jelölő fájl és nincs csatolás,
   * amit el lehetne rontani. Ez NEM azt jelenti, hogy a beállítottság kérdése
   * itt eldől -- azt a fájlrendszeres változat méri, a jelölő fájllal.
   */
  async describe(): Promise<DocumentStoreStatus> {
    return { state: "ready" };
  }
}

/**
 * A KULCS KÉT RÉSZE EGY TÉRKÉP-KULCCSÁ, JSON-tömbként.
 *
 * MIÉRT NEM EGYSZERŰ ÖSSZEFŰZÉS EGY ELVÁLASZTÓVAL: az azonosítókban elvileg
 * előfordulhat maga az elválasztó, és akkor két KÜLÖNBÖZŐ kulcs ugyanarra a
 * szövegre képződne le, vagyis az egyik dokumentum felülírná a másikat. Ez a
 * fajta hiba néma: a teszt zöld, a tartalom cserélődik. A JSON-alak a
 * határokat megőrzi, mert az elválasztót magát is idézi.
 */
function serialiseKey(key: DocumentKey): string {
  return JSON.stringify([key.owner, key.ownerId, key.documentId]);
}
