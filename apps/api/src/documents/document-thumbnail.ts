import type { Logger } from "@nestjs/common";

import { DOCUMENT_THUMBNAIL_VARIANT } from "@acropora/types";

import type { UploadedFileKind } from "../service-assets/uploaded-file-type.js";

/**
 * A CSEMPE KEPE: EGY KICSI, SZERVER-OLDALON ELOALLITOTT VALTOZAT.
 *
 * === A MERT HIANY, 2026-09-18 ===
 *
 * Belyegkep-ut nem letezett: a galeria minden csempeje a TELJES MERETU fajlbol
 * keszult. Acrobot merese az eles adatbazison (a `0e8abe19` kartyan): egy
 * eszkoz-galeria megnyitasa ATLAGOSAN 5,3 MB letoltes, a legrosszabb 9,9 MB, es
 * a tizenhet rekordbol HAT van 5 MB folott. Osszesen huszonkilenc kep -- vagyis
 * a szam nem attol nagy, hogy sok a kep, hanem attol, hogy mindegyik teljes
 * meretu. Egyetlen munkalap-fenykep 8,85 MB, es az a kep a telefonon,
 * mobilneten, egy csempeben jelenik meg.
 *
 * === A BELYEGKEP NEM HELYETTESITI AZ EREDETIT ===
 *
 * Acrobot megkotese, szo szerint: „a letoltes, a PDF es a hiteles peldany
 * tovabbra is a teljes meretu fajlbol menjen. A belyegkep KIZAROLAG a csempe."
 * Ezert all a valtozat a KERESBEN (`variant=thumbnail`), es ezert nem ir felul
 * semmit: az eredeti bajtok erintetlenek maradnak, a belyegkep KULON oszlop.
 *
 * === MIERT 640 A HATAR, ES NEM KEREK SZAM ===
 *
 * A legnagyobb csempe, amit ki kell szolgalnia, 3x-es kijelzon:
 *
 *   webes galeria   159 x 128 logikai pont  ->  477 x 384 keppont
 *   mobil csempe    104 x 104 logikai pont  ->  312 x 312 keppont
 *
 * A csempek `object-cover` alakuak, tehat a kep ROVIDEBB ele szamit. 640-es
 * felso hatarnal egy 4:3 arányú fenykep 640x480 (fekvo) vagy 480x640 (allo) --
 * a rovidebb el mind a ket allasban 480, ami mindket csempet fedi. 512-nel az
 * allo kep 384 szeles lenne, es a webes csempet 3x-en mar nem fedne.
 *
 * === A MERT ARAK (sajat meres, 2026-09-18, szintetikus kepeken) ===
 *
 *   12 MP fenykep (4032x3024, 10,7 MB)   ->  640x480, ~33 kB, median 115 ms
 *   12 MP allo    (3024x4032, 10,7 MB)   ->  480x640, ~30 kB, median 112 ms
 *   kis kep       (1200x900, 0,95 MB)    ->  640x480, ~100 kB, median 74 ms
 *
 * A HATAR KIMONDVA: a bemenet SZINTETIKUS ZAJ volt, mert a JPEG a zajt rosszul
 * tomoriti. Az IDO ebbol megbizhato, a MERET csak nagysagrendkent -- a valodi
 * szamot a visszamenoleges generalas parancsa meri le, es ki is irja.
 */

/**
 * AMIT A BELYEGKEP-VEGPONT VALASZOL. EGY DEFINICIO, KET VEGEN HASZNALVA: az
 * eloallitas es a kiszolgalas UGYANEBBOL olvassa. Ket kulon sztring eseten egy
 * formatum-valtas csendben rossz fejlecet adna -- a bongeszo sniffelne, a
 * natív kepbetolto pedig nem.
 */
export const THUMBNAIL_CONTENT_TYPE = "image/jpeg";

/** A hosszabb el felso hatara keppontban. Az indoklas a fejlecen all. */
export const THUMBNAIL_MAX_EDGE = 640;

/** A JPEG minoseg. 78 alatt a tipustabla szovege kezd olvashatatlan lenni. */
export const THUMBNAIL_QUALITY = 78;

/**
 * A KERESBEN ALLO VALTOZAT NEVE -- A KOZOS CSOMAGBOL, NEM ITT LEIRVA.
 *
 * Ez a szoveg a HALOZATON megy at: a kliens beirja a keresbe, mi osszevetjuk.
 * Ket kulon leirt sztringnel egy elgepeles NEM hibazna: az eredetit adnank
 * vissza, a csempe tovabbra is a teljes meretu fajlt toltene le, es semmi nem
 * szolna. Egy definicioval ez forditasi kerdesse valik.
 */
export const THUMBNAIL_VARIANT = DOCUMENT_THUMBNAIL_VARIANT;

/**
 * A hivo a keres-parametert adja at; minden mas ertek az eredetit jelenti.
 *
 * PONTOS EGYEZES, NEM ELOTAG: egy `thumbnail-xyz` erteknek nem szabad
 * belyegkepet adnia, mert az ugy nezne ki, mintha ertenenk egy parametert,
 * amit nem.
 */
export function wantsThumbnail(variant: string | undefined): boolean {
  return variant === THUMBNAIL_VARIANT;
}

/**
 * KESZULHET-E EBBOL BELYEGKEP.
 *
 * A FELISMERT FAJTABOL DONT, NEM A BEJELENTETT TIPUSBOL -- ugyanaz a szabaly,
 * ami a `contentType`-ot is adja. A PDF-nek nincs csempe-kepe: a galeria a
 * nem-kep csatolmanyt NEV szerint sorolja, nem csempekent.
 */
export function thumbnailable(kind: UploadedFileKind): boolean {
  return kind === "jpeg" || kind === "png";
}

/**
 * A BELYEGKEP ELOALLITASA -- VAGY `null`, HA NEM SIKERULT.
 *
 * === MIERT NEM DOB, ES MIERT DINAMIKUS A BETOLTES ===
 *
 * A `sharp` NATIV binarist visel. Ha az a telepitesben hianyzik vagy rossz
 * valtozatban all, egy MODUL-SZINTU import az egesz API indulasat vinne el --
 * egy CSEMPE-OPTIMALIZACIO miatt. Igy viszont a feltoltes megy tovabb, a
 * csempe visszaesik az eredetire, es a naplo megmondja, miert.
 *
 * ES A HIANY ITT NEM NEMA, mert ket helyen latszik: a naplo szol minden
 * egyes esetnel, ES a `document-thumbnail-backfill.cli` megszamolja, hany
 * kep-sor all belyegkep nelkul. Egy csendes visszaeses kulonben pontosan ugy
 * nezne ki, mint a mai allapot.
 *
 * AZ `EXIF` FORGATAS NEM RESZLETKERDES: a telefonok a kepet nyersen mentik es
 * az allast egy cimkeben jeloljk. A bongeszo es a natív kepbetolto ezt
 * ERTELMEZI, a nyers atmeretezes viszont nem -- enelkul a csempe oldalra
 * fordulna, mikozben a nagy kep allna. A `rotate()` parameter nelkul epp ezt
 * a cimket alkalmazza, es utana torli.
 */
export async function makeThumbnail(
  buffer: Buffer,
  kind: UploadedFileKind,
  logger?: Logger,
): Promise<Buffer | null> {
  if (!thumbnailable(kind)) return null;
  try {
    const { default: sharp } = await import("sharp");
    return await sharp(buffer)
      .rotate()
      .resize({
        width: THUMBNAIL_MAX_EDGE,
        height: THUMBNAIL_MAX_EDGE,
        fit: "inside",
        // A MAR KISEBB KEPET NEM NAGYITJUK FEL: abbol nagyobb fajl lenne,
        // mint az eredeti, es rosszabb kep.
        withoutEnlargement: true,
      })
      .jpeg({ quality: THUMBNAIL_QUALITY, mozjpeg: true })
      .toBuffer();
  } catch (error) {
    logger?.warn(
      `A belyegkep eloallitasa nem sikerult (${kind}): ${error instanceof Error ? error.message : String(error)}. A csempe az eredeti fajlbol keszul.`,
    );
    return null;
  }
}

/**
 * A BELYEGKEP-VALASZ ALAKJA, EGY HELYEN.
 *
 * A HAROM GAZDA VEGPONTJA UGYANEZT A HAROM MEZOT hasznalja (`fileName`,
 * `contentType`, `bytes`), tehat a valasz osszerakasa nem harom helyen all.
 *
 * A FAJLNEV AZ EREDETIE MARAD, es ez szandekos: a csempe nem ment fajlt, a
 * nev pedig a naplokban es a fejlecben ugyanarrol a csatolmanyrol szol. Egy
 * kitalalt `-thumb` utotag ket kulonbozo nevet adna ugyanannak a sornak.
 */
export function thumbnailResponse(row: {
  fileName: string;
  thumbnail: Uint8Array;
}): { fileName: string; contentType: string; bytes: Buffer } {
  return {
    fileName: row.fileName,
    contentType: THUMBNAIL_CONTENT_TYPE,
    bytes: Buffer.from(row.thumbnail),
  };
}
