import { createHash } from "node:crypto";

import { Injectable } from "@nestjs/common";

import {
  inspectImageBytes,
  type InspectedImage,
} from "../../common/image-inspect.js";
import {
  MailImageRepository,
  type MailImageSummary,
} from "./mail-image.repository.js";

/**
 * A LEVELSABLON KEPENEK FELTOLTESE (Balazs kerese, 2026-09-28 07:39 UTC).
 *
 * === A FAJTA A TARTALOMBOL DOL EL, NEM A NEVBOL ===
 *
 * A bongeszo altal kuldott `mimetype` es a fajlnev a hivo allitasa. A kep a
 * vevo levelezojeben jelenik meg, tehat itt a `sharp` olvassa ki a valodi
 * formatumot. Az SVG szandekosan NINCS a listan: az szoveg, amiben szkript
 * allhat.
 *
 * === A JPEG UJRAKODOLVA KERUL TAROLASRA ===
 *
 * Telefonrol feltoltott fotonal az EXIF-ben a keszites helye (GPS) is ott
 * lehet, es a kep minden vevonek kimegy. Az ujrakodolas a metaadatot eldobja,
 * es az elforgatast a kepre alkalmazza. A PNG, GIF es WebP valtozatlanul marad:
 * az atmeretezes nelkuli ujrakodolas ott csak az animaciot vagy az atlatszosagot
 * kockaztatna.
 */

/** A feltoltheto kep felso hatara. A level meretet a kep adja, nem a szoveg. */
export const MAIL_IMAGE_MAX_BYTES = 1024 * 1024;

/**
 * A keppontok felso hatara oldalankent. Egy 1 MB-os fajl is kitomorithet egy
 * oriasi vaszonra; a levelben ugyis 600 pont a legszelesebb megjelenes.
 */
export const MAIL_IMAGE_MAX_EDGE = 5000;

/** The mail's image check: the shared one, with the mail's own limits. */
export type InspectedMailImage = InspectedImage;

/**
 * A FELTOLTOTT BAJTOK VIZSGALATA ES A TAROLANDO ALAK. Tiszta fuggveny a
 * halozat es az adatbazis nelkul, hogy egyseg-szinten merheto legyen. A
 * vizsgalat maga 2026-10-26 ota kozos (`common/image-inspect.ts`), a cikk-kepek
 * is azt hasznaljak; itt a level hatarai allnak.
 *
 * Megnevezett okkal dob, es az ok a felhasznalonak szol.
 */
export function inspectMailImage(
  bytes: Uint8Array,
): Promise<InspectedMailImage> {
  return inspectImageBytes(bytes, {
    maxBytes: MAIL_IMAGE_MAX_BYTES,
    maxEdge: MAIL_IMAGE_MAX_EDGE,
    formats: ["png", "jpeg", "gif", "webp"],
  });
}

/**
 * A FAJLNEV A LEVELBEN FEJLECBE KERUL (`Content-Disposition`), tehat csak
 * ASCII betu, szam, pont, kotojel es alahuzas marad. A fejlec-orzo egy
 * sortoresre amugy is dobna; itt az a cel, hogy egy ekezetes nev ne allitsa meg
 * a levelet.
 */
export function safeMailImageFileName(name: string): string {
  const alap = name.split(/[\\/]/).pop() ?? "";
  const tiszta = alap
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._]+/, "")
    .slice(0, 100);
  return tiszta || "kep";
}

@Injectable()
export class MailImageService {
  constructor(private readonly repository: MailImageRepository) {}

  /**
   * UGYANAZ A FAJL MASODSZOR FELTOLTVE A MEGLEVO KEPET ADJA VISSZA. A logo igy
   * nem szaporodik, es a szerkeszto ugyanazt a hivatkozast kapja.
   */
  async upload(
    file: { originalname: string; buffer: Buffer },
    uploadedById: string | null,
  ): Promise<MailImageSummary> {
    const bytes = new Uint8Array(file.buffer);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const meglevo = await this.repository.findBySha256(sha256);
    if (meglevo) return meglevo;

    const kep = await inspectMailImage(bytes);
    return this.repository.create({
      fileName: safeMailImageFileName(file.originalname),
      contentType: kep.contentType,
      width: kep.width,
      height: kep.height,
      sha256,
      bytes: kep.bytes,
      uploadedById,
    });
  }

  list(): Promise<readonly MailImageSummary[]> {
    return this.repository.list();
  }
}
