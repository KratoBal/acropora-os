import type { DocumentStore } from "./document-store.js";
import { FilesystemDocumentStore } from "./filesystem-document-store.js";
import { InMemoryDocumentStore } from "./in-memory-document-store.js";

/**
 * MELYIK TÁROLÓ FUT: a környezet dönti el, egyetlen változóval.
 *
 * `DOCUMENT_STORE_ROOT` beállítva -> a fájlrendszeres tároló arra a gyökérre.
 * Nincs beállítva            -> a memóriabeli.
 *
 * MIÉRT A MEMÓRIABELI AZ ALAPÉRTELMEZÉS, ÉS MIÉRT NEM HIBA A HIÁNY: a
 * telepítési oldal (kötet, jelölő fájl, jogosultság) külön, később következő
 * lépés, és addig a fejlesztői futtatásnak és a teszteknek működnie kell. Egy
 * kötelező változó itt azt jelentené, hogy a mai, adatbázisban tárolt sorokat
 * kiszolgáló alkalmazás sem indul el anélkül, hogy bárki használná a tárolót.
 *
 * AMI EZT NEM TESZI VESZÉLYESSÉ: a memóriabeli tároló nem tud CSENDBEN a
 * fájlrendszeres helyébe lépni. Írni csak akkor írnánk bele, ha az írási út
 * be van kötve, és az a lépés a beállítottságot (`describe()`) külön kérdezi
 * meg -- a `not-configured` állapot pedig épp azt mondja meg, hogy a kötet
 * hiányzik. A hiányzó változó tehát látható marad, nem néma.
 */
export const DOCUMENT_STORE = Symbol("DOCUMENT_STORE");

export function createDocumentStore(
  env: NodeJS.ProcessEnv = process.env,
): DocumentStore {
  const root = env.DOCUMENT_STORE_ROOT?.trim();
  return root ? new FilesystemDocumentStore(root) : new InMemoryDocumentStore();
}

export const documentStoreProvider = {
  provide: DOCUMENT_STORE,
  useFactory: () => createDocumentStore(),
};
