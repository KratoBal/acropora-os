import { createHash } from "node:crypto";

import { Logger } from "@nestjs/common";

import { decideQuota } from "../service-assets/document-store/document-quota.js";
import { storageKeyFor } from "../service-assets/document-store/document-storage-key.js";
import type {
  DocumentOwner,
  DocumentStore,
} from "../service-assets/document-store/document-store.js";
import { documentStoreEnabled } from "../service-assets/document-store/document-store.provider.js";
import {
  canonicalMimetypeFor,
  detectUploadedFileKind,
} from "../service-assets/uploaded-file-type.js";

/**
 * A FELTOLTES SZABALYAI, EGY HELYEN, GAZDATOL FUGGETLENUL.
 *
 * === MIERT KOZOS, ES MIERT NEM MASOLAT ===
 *
 * Az eszkoz-dokumentum mogott nem egy "minta" all, hanem egy RENDSZER:
 * tartalom-felismeres a bejelentett tipus ES az elso bajtok egyuttesebol,
 * fajlnev-tisztitas, sha256, keret-ellenorzes az iras ELOTT, kulso tarolo
 * visszaesessel, es a sorrend (eloszor a bajtok, azutan a sor). Ha ezt a
 * munkalapra lemasolnank, a repo KET helyen vinne ugyanazt a szabalyt -- es
 * egyszer az egyik megvaltozna. A tarolo bekapcsolasa 2026-09-02 ota el:
 * kettozve azt is ketszer kellene karbantartani, es a masodik akkor derulne
 * ki, amikor az elso mar mukodik.
 *
 * === AMI ITT NINCS: A JOGOSULTSAG ES A SOR IRASA ===
 *
 * Azt, hogy egy adott gazdahoz szabad-e irni, a HIVO donti el. Egy kozos
 * jogosultsag-ellenorzes itt azt jelentene, hogy a ket modul szabalya egy
 * HARMADIK helyen all -- pontosan az a szetcsuszas, ami ellen ez a modul
 * keszult. A sort is a hivo irja: a ket gazdanak mas a taplaja.
 */

export interface DocumentIntakeInput {
  owner: DocumentOwner;
  ownerId: string;
  documentId: string;
  file: { originalname: string; mimetype: string; buffer: Buffer };
}

export interface DocumentIntakeCommon {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
}

/** A ket elhelyezes KULON ALAK, mert a hivo mast ir a sorba. */
export type DocumentIntakeResult =
  | { placement: "database"; common: DocumentIntakeCommon; content: Buffer }
  | { placement: "store"; common: DocumentIntakeCommon; storageKey: string };

/** A fajl maga nem fogadhato el (tipus vagy tartalom). */
export class DocumentRejected extends Error {}
/** A keret betelt: a feltoltes elutasitva, MIELOTT barmi keletkezett volna. */
export class DocumentOverQuota extends Error {}

export interface DocumentIntakeDeps {
  store: DocumentStore;
  /** A tablabol osszegzett, mar felhasznalt hely. A keret ebbol dol el. */
  usedBytes(): Promise<number>;
  logger?: Logger;
}

/**
 * A FELTOLTES ELOKESZITESE: MINDEN, AMI A SOR IRASA ELOTT TORTENIK.
 *
 * A SORREND ITT DOL EL, ES NEM VALTOZOTT: a bajtok ELOSZOR a taroloba mennek,
 * es csak azutan a sor. Forditva egy elhasalt tarolo-iras ELVESZETT SORT
 * hagyna (a felhasznalo latja a listaban, es a letoltesnel kap hibat); igy
 * legfeljebb egy ELARVULT FAJL marad, amire senki nem hivatkozik.
 */
export async function prepareDocument(
  input: DocumentIntakeInput,
  deps: DocumentIntakeDeps,
): Promise<DocumentIntakeResult> {
  // A BEJELENTETT TIPUS ES A TARTALOM EGYUTT DONT: mindkettonek egyeznie kell.
  const kind = detectUploadedFileKind(input.file.mimetype, input.file.buffer);
  if (kind === null)
    throw new DocumentRejected(
      "Csak érvényes PDF, JPEG vagy PNG fájl tölthető fel.",
    );

  const safeName = input.file.originalname
    .normalize("NFKC")
    .replace(/[\\/\u0000-\u001f\u007f]/g, "-")
    .slice(0, 180);

  const common: DocumentIntakeCommon = {
    id: input.documentId,
    // A TARTALEK NEV NEM MONDHAT TIPUST, amit nem tudunk.
    fileName: safeName || "dokumentum",
    // A TAROLT TIPUS A FELISMERT FAJTABOL JON, nem a kuldo bejelenteseből: egy
    // rossz ertek itt a bongeszonel derulne ki, hetekkel kesobb.
    contentType: canonicalMimetypeFor(kind),
    sizeBytes: input.file.buffer.length,
    sha256: createHash("sha256").update(input.file.buffer).digest("hex"),
  };

  // A KERET A LEGELSO ELLENORZES, MEG AZ IRAS ELOTT. Egy elutasitas utan sem a
  // tarolon, sem a tablaban nem keletkezhet semmi.
  await refuseIfOverQuota(input.file.buffer.length, deps);

  if (!documentStoreEnabled())
    return { placement: "database", common, content: input.file.buffer };

  /**
   * A BEKAPCSOLAS MEG NEM JELENTI, HOGY HASZNALHATO.
   *
   * A legveszelyesebb telepitesi hiba: a gyoker be van allitva, de a kotet
   * nincs csatolva. A konyvtar ilyenkor IRHATO, tehat az iras SIKERUL -- csak
   * epp a konteneri retegre, es a kovetkezo ujratelepites elviszi. Ilyenkor
   * visszaesunk az adatbazisra, ES NAPLOZUNK: nem elutasitas (a rendszernek
   * mennie kell), de nem is csend.
   */
  const status = await deps.store.describe();
  if (status.state !== "ready") {
    deps.logger?.warn(
      `A dokumentum-tarolo be van kapcsolva, de nem hasznalhato (${status.state}: ${status.reason}). A feltoltes az adatbazisba megy.`,
    );
    return { placement: "database", common, content: input.file.buffer };
  }

  const key = {
    owner: input.owner,
    ownerId: input.ownerId,
    documentId: input.documentId,
  };
  await deps.store.put(key, input.file.buffer);
  return { placement: "store", common, storageKey: storageKeyFor(key) };
}

/**
 * A TAROLOBA MAR KIIRT FAJL TAKARITASA, ha a sor irasa elbukott.
 *
 * A TORLES HIBAJAT ELNYELJUK: az EREDETI hiba a fontosabb, azt nem szabad
 * elfednie. Ami legrosszabb esetben marad, az egy arva fajl -- szemet, nem
 * adatvesztes.
 */
export async function discardStoredDocument(
  key: { owner: DocumentOwner; ownerId: string; documentId: string },
  deps: Pick<DocumentIntakeDeps, "store">,
): Promise<void> {
  await deps.store.delete(key).catch(() => undefined);
}

async function refuseIfOverQuota(
  incomingBytes: number,
  deps: DocumentIntakeDeps,
): Promise<void> {
  const limitBytes = Number(process.env.DOCUMENT_STORE_LIMIT_BYTES ?? 0);
  // BEALLITAS NELKUL NINCS KERET, es ez szandekos: egy kitalalt alapertelmezett
  // hatar egy nap csendben elutasitana egy feltoltest, amirol senki nem dontott.
  if (!Number.isFinite(limitBytes) || limitBytes <= 0) return;

  const decision = decideQuota({
    usedBytes: await deps.usedBytes(),
    incomingBytes,
    limitBytes,
  });
  if (decision.state === "reject") throw new DocumentOverQuota(decision.reason);
  // A JELZES NEM ALLITJA MEG A FELTOLTEST, csak naploz: az NEKUNK szol, nem a
  // feltoltonek, aki nem tud rajta segiteni.
  if (decision.state === "warn" && decision.reason)
    deps.logger?.warn(decision.reason);
}
