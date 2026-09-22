/**
 * MIT TÖLTÖTTEK FEL VALÓJÁBAN: a bejelentett típus ÉS az első bájtok együtt.
 *
 * MIÉRT NEM ELÉG A BEJELENTETT TÍPUS. A `mimetype` és a kiterjesztés is a
 * KÜLDŐTŐL jön: egy elnevezett fájl akkor is `image/jpeg`-nek mondja magát, ha
 * bármi más van benne. A tartalom első bájtjai viszont a fájl sajátjai.
 *
 * MIÉRT NEM ELÉG A TARTALOM SEM, ÖNMAGÁBAN. Ha csak a bájtokat néznénk, egy
 * PDF-nek nevezett kép csendben átmenne, és a letöltésnél derülne ki, hogy a
 * böngésző nem tudja megnyitni. A kettőnek EGYEZNIE kell: ez az egyetlen alak,
 * ami mindkét irányban véd.
 *
 * A LISTA SZÁNDÉKOSAN RÖVID, és a hiányzókat is megnevezzük:
 *
 * - HEIC/HEIF: az iPhone alapértelmezett formátuma, de a telefonos képválasztók
 *   (az Expo sajátját is beleértve) JPEG-re konvertálnak feltöltés előtt.
 *   Felvenni akkor kell, ha egy MÉRÉS mutat érkező HEIC-et, nem előre.
 * - WebP, AVIF: a szerviz-fotók telefonról vagy fényképezőgépből jönnek, és
 *   egyik sem ezekben ír. Egy formátum, amit soha senki nem küld, csak a
 *   felületet szélesíti.
 * - SVG: szándékosan KIMARAD. Nem fénykép, viszont futtatható tartalmat vihet,
 *   és a letöltésnél a böngésző értelmezné.
 */
export type UploadedFileKind = "pdf" | "jpeg" | "png";

interface Signature {
  kind: UploadedFileKind;
  /** A bejelentett típusok, amiket ehhez a tartalomhoz elfogadunk. */
  mimetypes: readonly string[];
  /**
   * Amit a LETÖLTÉSNÉL válaszolunk. Nem a küldő bejelentett típusa: az
   * `image/jpg` alakot elfogadjuk beérkezéskor, de visszaadni a szabványosat
   * kell, különben a böngésző azon akadna fenn, amit mi engedtünk át.
   */
  canonicalMimetype: string;
  /** A fájl első bájtjai, ahogy a formátum előírja. */
  magic: readonly number[];
}

const SIGNATURES: readonly Signature[] = [
  {
    kind: "pdf",
    mimetypes: ["application/pdf"],
    canonicalMimetype: "application/pdf",
    // "%PDF-"
    magic: [0x25, 0x50, 0x44, 0x46, 0x2d],
  },
  {
    kind: "jpeg",
    // A `image/jpg` nem szabványos, de a régebbi klienseknél előfordul, és a
    // tartalom-ellenőrzés úgyis külön véd: elfogadni olcsóbb, mint egy valódi
    // fényképet elutasítani egy elgépelt fejléc miatt.
    mimetypes: ["image/jpeg", "image/jpg"],
    canonicalMimetype: "image/jpeg",
    magic: [0xff, 0xd8, 0xff],
  },
  {
    kind: "png",
    mimetypes: ["image/png"],
    canonicalMimetype: "image/png",
    magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
];

/**
 * A felismert fajta, vagy `null`, ha a bejelentett típus és a tartalom nem
 * egyezik. A hívó dolga eldönteni, mit kezd a `null`-lal - itt nem dobunk,
 * mert a hibaüzenet a végponté, és az tudja, mit szabad kimondania.
 */
export function detectUploadedFileKind(
  mimetype: string,
  buffer: Buffer,
): UploadedFileKind | null {
  const declared = mimetype.trim().toLowerCase();
  for (const signature of SIGNATURES) {
    if (!signature.mimetypes.includes(declared)) continue;
    const head = buffer.subarray(0, signature.magic.length);
    if (head.equals(Buffer.from(signature.magic))) return signature.kind;
    // A BEJELENTETT TÍPUS EGYEZETT, A TARTALOM NEM. Nem próbálunk másik
    // aláírást: az a fájl nem az, aminek mondja magát, és ez a válasz.
    return null;
  }
  return null;
}

/** Amit a feltöltő felületnek fel szabad kínálnia, egy `accept` attribútumhoz. */
export const ACCEPTED_UPLOAD_MIMETYPES: readonly string[] = SIGNATURES.flatMap(
  (signature) => signature.mimetypes,
);

/**
 * A LETÖLTÉSKOR VISSZAADANDÓ TÍPUS. Külön áll a felismeréstől, mert a tárolt
 * sor ezt őrzi meg: a feltöltés eldönti, MI a fájl, és a letöltés ebből
 * mondja meg a böngészőnek, mit kezdjen vele.
 *
 * Ez a lépés korábban hiányzott: a sor `application/pdf` értéket kapott
 * FÜGGETLENÜL a tartalomtól. PDF-nél igaz volt, és épp ezért nem tűnt fel.
 */
export function canonicalMimetypeFor(kind: UploadedFileKind): string {
  const signature = SIGNATURES.find((entry) => entry.kind === kind);
  // A `kind` unió zárt, tehát ide nem lehet eljutni - de ha egy új fajta
  // bekerül a típusba és kimarad a táblából, jobb hangosan elhasalni, mint
  // csendben egy rossz típust adni a letöltőnek.
  if (!signature) throw new Error(`Ismeretlen fájlfajta: ${kind}`);
  return signature.canonicalMimetype;
}

/**
 * MELYIK DOKUMENTUM-FAJTA LEGYEN, HA A FELTOLTO NEM MONDTA MEG.
 *
 * === A SZABALY ===
 *
 *     kep (jpeg, png)   ->  PHOTO
 *     minden mas        ->  OTHER
 *
 * === MIERT A BAJTOKBOL, ES NEM A BEJELENTETT TIPUSBOL ===
 *
 * Mert a `Content-Type` fejlecet a FELTOLTO GEPE mondja, a partner-lathatosag
 * viszont EMBERI dontesen all (Balazs, 2026-09-22: a partner lassa a
 * fenykepeket, a szamlat ne). Ha a fajtat a bejelentett tipus adna, a "PHOTO"
 * nev valojaban azt jelentene, hogy "a kliens ezt irta a fejlecbe" -- es az a
 * nev hazudni fogna, amint valaki mast ir bele.
 *
 * A `detectUploadedFileKind` a bejelentett tipust ES az elso bajtokat EGYUTT
 * nezi, tehat az eredmenye nem a kliens allitasa.
 *
 * === ES AMI AKKOR TORTENIK, HA A KLIENS HAZUDIK ===
 *
 * Semmi, es ezt merni lehet, nem remelni: a kozos feltoltesi mag ugyanezzel a
 * fuggvennyel ellenorzi a fajlt, es `null` eseten ELUTASITJA
 * (`document-intake.ts`, `DocumentRejected`). Vagyis egy hamis fejleccel erkezo
 * fajlbol SOR SEM KELETKEZIK -- tehat mindegy, milyen fajtat mondtunk ra. Az
 * `OTHER` visszaeses igy nem "biztos, ami biztos", hanem a ZART alapertelmezes:
 * amirol nincs allitasunk, azt a partner nem latja.
 *
 * === A PAR, AMI EZT A SZABALYT MASHOL IS VISELI -- ES NEM UGYANAZ ===
 *
 * A `20260922164700_asset_document_photo_backfill` migracio SQL alakban dont
 * ugyanerrol a kerdesrol: `type = 'OTHER' AND contentType LIKE 'image/%'`.
 *
 * EZ A BEKEZDES 2026-09-22-EN AT LETT IRVA, ES KET DOLOG VOLT BENNE HAMIS.
 * Egy REGI, atnevezes elotti migracio-nevre hivatkozott (`...142100_...`, ami
 * ma nem letezik), es azt allitotta, hogy "ugyanez a predikatum" -- holott a
 * ketto NEM azonos:
 *
 *     a MIGRACIO    csak a bejelentett (tarolt) tipust nezi
 *     a FELTOLTES   a bejelentett tipust ES az elso bajtokat, EGYEZESSEL
 *
 * A KULONBSEG IRANYA A LENYEG, ES EGYIRANYU: amit EZ a fuggveny kepnek mond,
 * azt a migracio is atengedte volna. FORDITVA NEM: egy `image/jpeg`-nek
 * MONDOTT, de nem JPEG tartalmu sor a migracioban PHOTO-t kapott volna, itt
 * viszont `OTHER`-t kap. A mai adatban ezert LEHET olyan PHOTO sor, amit a mai
 * feltoltesi ut nem adott volna -- ez nem hiba, csak nem allithatjuk rola
 * ugyanazt.
 *
 * === ES AMIERT EZ A KET FELTETEL NEM VONHATO OSSZE (acrobot kikotese,
 * 2026-09-22 20:20) ===
 *
 * Az osszevonas a leheto legartatlanabb alakban fog erkezni: ket majdnem
 * egyforma feltetel egy helyre huzva, "az egyseg kedveert". Ha a migracio
 * tagabb alakja kerul ide, az TAGITAS -- a hamis fejleccel erkezo fajl PHOTO-t
 * kapna, es a partner latna. A masik irany (ez a szabaly a migracioba) szinten
 * ertelmetlen: az EGYSZER futott, a multat rogzitette, es nincs mit ujraszamolni.
 *
 * Vagyis a ket feltetel kulonallasa NEM mulasztas, es az orzo csak ITT allhat:
 * a migracio mar alkalmazva van.
 */
export function assetDocumentKindForUpload(file: {
  mimetype: string;
  buffer: Buffer;
}): "PHOTO" | "OTHER" {
  const kind = detectUploadedFileKind(file.mimetype, file.buffer);
  return kind === "jpeg" || kind === "png" ? "PHOTO" : "OTHER";
}

/**
 * A TAROLT TIPUSBOL VISSZA A FAJTAHOZ -- vagy `null`, ha nem a mienk.
 *
 * MIERT KELL: a MAR TAROLT sorokrol (visszamenoleges belyegkep-generalas,
 * egyeztetes) csak a `contentType` all rendelkezesre, a felismeres eredmenye
 * nem. Enelkul a hivo egy SAJAT listat tartana arrol, mi szamit kepnek -- es az
 * a lista egyszer elcsuszna ettol a tablatol.
 *
 * A KANONIKUS ALAKRA ILLESZT, nem a bejelentettre: a tarolt sor mindig azt
 * viseli (a `canonicalMimetypeFor` irja bele), tehat az `image/jpg` alak itt
 * SZANDEKOSAN nem ad talalatot -- ha megis elofordulna, az maga a lelet.
 */
export function kindForStoredMimetype(
  contentType: string,
): UploadedFileKind | null {
  const alak = contentType.trim().toLowerCase();
  return (
    SIGNATURES.find((signature) => signature.canonicalMimetype === alak)
      ?.kind ?? null
  );
}
