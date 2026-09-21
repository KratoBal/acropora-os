import {
  worksheetSignerLabel,
  type WorksheetSignerSource,
} from "./worksheet-signer.js";

/**
 * A NYOMTATOTT MUNKALAP TARTALMA -- SOROKKÉNT, PDF NÉLKÜL.
 *
 * === MIÉRT KÜLÖN MODUL, ÉS MIÉRT SOROK ===
 *
 * A PDF-rajzolás (`documents/pdf/minimal-pdf.ts`) bájtokat ad, és a bájtokról
 * csak visszaolvasással lehet állítást tenni. A TARTALOM viszont -- hogy MI áll
 * a lapon és milyen sorrendben -- tiszta függvénnyel eldönthető, és így soronként
 * kalibrálható. Ugyanaz a tagolás, mint a `worksheet-labor.ts`-nél: a szabály ott
 * áll, ahol mérhető.
 *
 * === AMI MÁR ELDŐLT, ÉS AMI MÉG NEM ===
 *
 * Balázs döntése (2026-09-17 16:06:58, majd 22:49:52): a lapon az áll, ami a
 * VEVŐNEK szól; a fájl a lezáráskor keletkezik egyszer; a piszkozat is kap lapot,
 * látható jelöléssel. Az ÁR, az ÁFA és a bruttó SEHOL nem jelenik meg (2026-09-17
 * 19:17 és 19:21, a „b" út).
 *
 * A MARADÉK NYOLC MEZŐ 2026-09-17 23:08-KOR DŐLT EL (acrobot, a döntése a
 * 6c2edc0d kártyán áll):
 *
 *   RÁKERÜL     hibajegy-szám, partner-azonosító, a MI eszközszámunk a
 *               tételeken, az aláírást RÖGZÍTŐ kolléga neve (külön címkével),
 *               az alegység kódja, és az előzmény-lap (csak ha van)
 *   NEM KERÜL   a fizetési határidő, és a tétel fajtája külön oszlopként
 *
 * A HATÁRIDŐ KIMARADÁSÁNAK INDOKA KÜLÖN ÁLL, mert ez a leggyengébb pont: az
 * ár-döntés után egy határidő ÖSSZEG NÉLKÜL többet kérdez, mint amennyit mond.
 * A kihagyás a visszafordítható irány -- ha később mégis kell, egy sor.
 * Fordítva nem: egy értelmetlen dátum a vevő előtt már kiment.
 *
 * A TÉTEL FAJTÁJA azért nem kap oszlopot, mert ott áll mellette a munkaóra, vagy
 * nem áll -- egy külön „fajta" oszlop ugyanazt mondaná kétszer.
 */

/** A lap egy tétele -- csak az, amit a lap kiír. */
export interface WorksheetSheetLine {
  position: number;
  description: string;
  detail: string | null;
  /**
   * A MI eszközszámunk. 2026-09-17 23:08 óta RÁKERÜL: a készüléken ott a
   * matrica, tehát a helyszínen ez azonosítja a gépet, nem csak nálunk.
   */
  assetNumber: string | null;
  /** Az ÜGYFÉL saját eszközkódja. Külön mező, mert külön jelentés. */
  inventoryNumber: string | null;
  quantity: string;
  unit: string;
  kind: "LABOR" | "OTHER";
  workerCount: number;
  laborHours: string;
}

export interface WorksheetSheetEntry {
  body: string;
  authorName: string | null;
}

export interface WorksheetSheetPhoto {
  thumbnail: Uint8Array;
  caption: string | null;
}

/** Amit a lap a munkalapról és a verzióról kiír. */
export interface WorksheetSheetInput {
  /**
   * A lap azonosítója, ahogy az ügyfél is látja: „BIO-2026-001/1".
   *
   * ELHAGYHATÓ, ÉS EZ NEM ELŐVIGYÁZATOSSÁG: a munkalapszám a LEZÁRÁSKOR
   * keletkezik (a `close()` a tranzakcióban foglalja le, ha még nincs). Egy
   * PISZKOZAT tehát szám nélkül áll -- és piszkozat is kap lapot.
   */
  label: string | null;
  status: "DRAFT" | "AWAITING_SIGNATURE" | "SIGNED" | "REJECTED";
  customerName: string;
  /** A mi vevőkódunk a partnerről. A partner saját rendszerében ez azonosít. */
  customerNumber: string | null;
  departmentName: string;
  departmentCode: string;
  subject: string;
  description: string | null;
  issueDate: string | null;
  fulfillmentDate: string | null;
  createdByName: string | null;
  closedAt: string | null;
  /** Akik dolgoztak rajta. Balázs 2026-09-17 22:49:52: rákerül. */
  assigneeNames: readonly string[];
  /** A munkalap naplója. Balázs ugyanakkor: rákerül. */
  entries: readonly (WorksheetSheetEntry | string)[];
  photos?: readonly WorksheetSheetPhoto[];
  lines: readonly WorksheetSheetLine[];
  laborHours: string;
  signature: {
    decision: "ACCEPTED" | "REJECTED";
    /** Az ÜGYFÉL embere, aki aláírt. */
    signerName: string;
    /**
     * MILYEN MINŐSÉGBEN írta alá. A lap ebből mondja ki, hogy a partner
     * munkatársa, egy helyszínen beírt név, vagy a SAJÁT kollégánk volt.
     *
     * `null`-t is felvehet: a régi sorokon nincs jelölve, és a séma szerint
     * „egy kitalált érték rosszabb, mint egy kétértelmű".
     */
    signerSource: WorksheetSignerSource | null;
    /**
     * A KOLLÉGÁNK, aki az aláírást rögzítette. NEM az aláíró.
     *
     * Két név áll egy helyen, és ez összekeverhető -- de a megoldás a KÜLÖN
     * CÍMKE, nem a mező elhagyása: az aláírás hitelének része, hogy valakinek a
     * jelenlétében született.
     */
    signedByName: string | null;
    signedAt: string;
    note: string | null;
  } | null;
  /** A folytatás lapja, ha ez a munka máshol folytatódik vagy onnan jön. */
  continuesLabel?: string | null;
}

/**
 * A PISZKOZAT JELÖLÉSE A LAP TETEJÉN ÁLL, ÉS NEM A VÉGÉN.
 *
 * Balázs kikötése: a piszkozat lapja is elkészül, de látható jelöléssel, hogy nem
 * a végleges. Egy kinyomtatott papíron a végén álló megjegyzés akkor derül ki,
 * amikor már elolvasták -- és ha valaki csak az első oldalt adja tovább, sosem.
 *
 * MA EGY SOR, MERT A RAJZOLÓ MA SOROKAT TUD. Ha egyszer valódi elrendezés lesz,
 * ez vízjellé válhat; a MÉRCE viszont nem változik: a piszkozat lapja és a
 * véglegesé megkülönböztethető kell legyen.
 */
export const DRAFT_MARK = "PISZKOZAT (nem végleges)";

const HU_DATE = new Intl.DateTimeFormat("hu-HU", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Europe/Budapest",
});

/**
 * DÁTUM A LAPRA, BUDAPESTI NAPTÁR SZERINT.
 *
 * A szerver ISO alakot ad, ami UTC-ben áll. Egy `2026-09-17T22:30:00Z` bélyeg
 * budapesti idő szerint MÁR MÁSNAP van -- tehát a nyers előtag levágása a lapra
 * rossz napot írna. Ezért megy zónával.
 *
 * Ami NEM dátum, azt változatlanul adjuk vissza: a mezők egy része már ma is
 * csupasz nap (`2026-08-27`), és azon nincs mit átszámolni.
 */
export function sheetDate(value: string | null): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return HU_DATE.format(date).replace(/\. /g, "-").replace(/\.$/, "");
}

function label(name: string, value: string | null): string | null {
  return value ? `${name}: ${value}` : null;
}

/**
 * EGY TÉTEL MENNYISÉG-SORA.
 *
 * A LÉTSZÁM ÉS A MUNKAÓRA CSAK AKKOR ÁLL KI, HA MÁST MOND, MINT A MENNYISÉG --
 * ugyanaz a döntés, mint a telefonos sor-szövegnél, és ugyanabból az okból: egy
 * „2 óra · 2 óra munkaóra" ugyanazt a számot mondaná kétszer, két néven.
 *
 * És a feltétel itt sem a KÉPLETRE épül (hogy egy fő esetén a kettő egyenlő),
 * hanem a két ÉRTÉK összevetésére: ha a szerver képlete valaha változik, ez a sor
 * magától kiírja a különbséget, ahelyett hogy a mennyiséget mutatná munkaóraként.
 */
function lineAmount(line: WorksheetSheetLine): string {
  const parts = [`${line.quantity} ${line.unit}`.trim()];
  if (line.kind === "LABOR") {
    if (line.workerCount > 1) parts.push(`${line.workerCount} fő`);
    if (line.laborHours !== line.quantity)
      parts.push(`${line.laborHours} munkaóra`);
  }
  return parts.join(" · ");
}

/**
 * A LAP SORAI.
 *
 * A visszatérés `readonly string[]`, mert a rajzoló ezt kapja meg -- és mert így
 * a tartalom soronként állítható, PDF nélkül.
 */
export function worksheetSheetLines(
  input: WorksheetSheetInput,
): readonly string[] {
  const out: (string | null)[] = [];

  // A JELÖLÉS MINDEN NEM ALÁÍRT ÁLLAPOTRA ÁLL, NEM CSAK A `DRAFT`-RA.
  //
  // Balázs a „piszkozat" szót használta, de a mérce az, hogy ne lehessen
  // összekeverni az ALÁÍRT lappal. Egy aláírásra váró lap sincs aláírva: ha
  // csak a `DRAFT`-ot jelölnénk, épp az a lap menne jelöletlenül, amit a
  // szerelő az ügyfél elé tesz.
  if (input.status !== "SIGNED") out.push(DRAFT_MARK, "");

  /*
    SZÁM NÉLKÜL IS VAN FEJLÉC, ÉS KIMONDJA, HOGY NINCS SZÁMA.

    A `${null}` behelyettesítés „MUNKALAP null"-t írna a vevő lapjára. Az üresen
    hagyás pedig azt sugallná, hogy elveszett a szám -- holott még meg sem
    született: a munkalapszámot a lezárás foglalja le.
  */
  out.push(
    input.label ? `MUNKALAP  ${input.label}` : "MUNKALAP  (még nincs száma)",
    "",
  );
  /*
    A VEVŐKÓD A NÉV MELLETT, ZÁRÓJELBEN -- ugyanaz az alak, mint az alegységnél.
    Nem külön sor: a kód a nevet AZONOSÍTJA, nem egy második tény róla.
  */
  out.push(
    input.customerNumber
      ? `Partner: ${input.customerName} (${input.customerNumber})`
      : `Partner: ${input.customerName}`,
  );
  out.push(`Alegység: ${input.departmentName} (${input.departmentCode})`);
  out.push(label("Tárgy", input.subject));
  out.push(label("Leírás", input.description));
  out.push(label("Kiállítás", sheetDate(input.issueDate)));
  out.push(label("Teljesítés", sheetDate(input.fulfillmentDate)));
  out.push(label("Felvette", input.createdByName));
  out.push(
    input.assigneeNames.length
      ? `Dolgozott rajta: ${input.assigneeNames.join(", ")}`
      : null,
  );
  /*
    A HIBAJEGY SZAMA NEM KERUL A LAPRA (acrobot dontese, 2026-09-18 10:56).

    NEM UJ DONTES, hanem ket meglevobol kovetkezik, es epp ezert nem ment
    Balazs ele:

      a kod sajat mondata (`attachable-worksheets.ts`): a lezaras a
        DOKUMENTUMROL szol, a csatolas a BESOROLASROL
      Balazs 2. dontese: a lapon az all, ami a VEVONEK szol

    ES AMI EZT ELDONTOTTE, AZ EGY MERES: egy LEZART laphoz utolag is csatolhato
    hibajegy (a csatolo ut nem nezi a lap allapotat, es a valaszto szuroje
    kifejezetten kimondja, hogy a lezart lap is csatolhato). A jegyszam tehat ma
    az EGYETLEN sor volt a lapon, aminek az erteke a FAGYASZTAS UTAN is
    valtozhat -- minden mas egy lezart verziobol jon. Egy dokumentum, aminek egy
    sora a kiadas utan mozdul, nem pillanatkep tobbe.

    AMIT EZ NEM JELENT: a jegyszam nem tunik el a rendszerbol. A lap adatlapjan
    nalunk tovabbra is ott all -- csak a VEVONEK szant lapra nem kerul ki.

    HA VALAKI VISSZATENNE: eloszor azt kell eldonteni, mi tortenjen az utolagos
    csatolassal, mert a ket dolog egyutt nem lehet igaz.
  */
  out.push(label("Lezárva", sheetDate(input.closedAt)));
  out.push(label("Folytatás", input.continuesLabel ?? null));

  out.push("", "TÉTELEK");
  if (!input.lines.length) {
    out.push("Ezen a lapon nincs tétel.");
  } else {
    for (const line of input.lines) {
      out.push(`${line.position}. ${line.description}`);
      out.push(line.detail ? `   ${line.detail}` : null);
      /*
        A KÉT KÓD KÜLÖN CÍMKÉT KAP, ÉS EZ NEM BŐBESZÉDŰSÉG. A felső a MIENK (a
        készüléken lévő matrica), az alsó az ÜGYFÉLÉ. Két csupasz kód egymás
        alatt pont azt a keveredést hozná, ami ellen a mező külön nevet kapott.
      */
      out.push(line.assetNumber ? `   Eszköz: ${line.assetNumber}` : null);
      out.push(
        line.inventoryNumber
          ? `   Leltári szám: ${line.inventoryNumber}`
          : null,
      );
      out.push(`   ${lineAmount(line)}`);
    }
  }

  // AZ ÖSSZESÍTÉS AKKOR IS KIÍRÓDIK, HA NULLA. Egy elrejtett nulla két állapotot
  // mosna össze: hogy nincs munkaóra-tétel a lapon, és hogy a sor elmaradt.
  out.push("", `Összes munkaóra: ${input.laborHours}`);

  // A NAPLÓ-SZAKASZ CSAK AKKOR ÁLL KI, HA VAN BEJEGYZÉS -- és ez mérésen alapul:
  // az éles adatbázisban ma EGYETLEN bejegyzés van (acrobot mérése, 2026-09-17
  // 23:01). A mező tehát nem egy meglévő szokás, hanem MOSTANTÓL telik meg. Egy
  // üres „NAPLÓ" fejléc a lapok túlnyomó többségén azt állítaná, hogy hiányzik
  // valami.
  if (input.entries.length) {
    out.push("", "NAPLÓ");
    for (const entry of input.entries) {
      const value =
        typeof entry === "string" ? { body: entry, authorName: null } : entry;
      out.push(
        value.authorName
          ? `- ${value.body} · ${value.authorName}`
          : `- ${value.body}`,
      );
    }
  }

  out.push("", "ALÁÍRÁS");
  if (!input.signature) {
    out.push("Még nincs aláírva.");
  } else {
    const decision =
      input.signature.decision === "ACCEPTED" ? "Elfogadva" : "Elutasítva";
    /*
      A MINOSEG A NEV ELOTT ALL, nem utana zarojelben: aki a lapot olvassa, a
      mondat elejen dont arrol, kinek az alairasat latja.
    */
    out.push(
      `${decision}. ` +
        `${worksheetSignerLabel(input.signature.signerSource)}: ` +
        `${input.signature.signerName}, ` +
        `${sheetDate(input.signature.signedAt)}`,
    );
    out.push(label("Az aláírást rögzítette", input.signature.signedByName));
    out.push(label("Megjegyzés", input.signature.note));
  }

  return out.filter((line): line is string => line !== null);
}
