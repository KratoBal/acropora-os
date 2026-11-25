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
  /**
   * Az ÜGYFÉL saját eszközkódja. Külön mező, mert külön jelentés.
   *
   * A MEZŐ NEVE 2026-09-23-IG "inventoryNumber" VOLT, és a lapon is
   * "Leltári szám" felirattal jelent meg -- Balázs kérése szerint ez
   * félrevezető volt (lásd az `AssetListItem.partnerInternalCode`
   * jegyzetét).
   */
  partnerInternalCode: string | null;
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
  /**
   * A HATÁRIDŐ (a verzió `dueDate`-je). 2026-09-17 óta NEM került a lapra (lásd fent); Luca kérése (2026-11-18 11:27 UTC, acrobot
   * 55790, Balázs 11:35 UTC: „fontos hogy mielőbb elkészüljön") a jobb oldalra teszi, a kiállítás és a teljesítés mellé. Ha nincs
   * kitöltve, nem áll ki: egy üres „Határidő" sor a vevő előtt kérdést szülne. ELHAGYHATÓ, hogy a régebbi hívók és mérések ne törjenek.
   */
  dueDate?: string | null;
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

/** Egy címkézett mező a lap fejrészében. */
export interface WorksheetSheetField {
  label: string;
  value: string;
}

/** Egy tétel a lap táblázatában. */
export interface WorksheetSheetItem {
  position: number;
  description: string;
  /** A tétel alatti apró sorok: a részlet és a két eszközkód, külön címkével. */
  notes: string[];
  /** A mennyiség-oszlop: darab, alkalom, óra -- a munkaóra csak munkaóra-tételen (`lineAmount`). */
  amount: string;
}

/**
 * A LAP SZERKEZETE, AHOGY A RAJZOLÓ ELRENDEZI (Luca, 2026-11-18 11:27 UTC: „össze vannak csúszva a sorok, nem átlátható";
 * „a teljesítés, kiállítás dátuma, határidő a jobb oldalra húzva, balra pedig a partner, tárgy stb."). Ugyanazok a szabályok, mint a
 * sorokéi: a sorok (`worksheetSheetLines`) ebből készülnek, tehát a kettő nem mondhat mást.
 */
export interface WorksheetSheetLayout {
  /** Nincs aláírva: a lap tetején jelölni kell (`DRAFT_MARK`). */
  draft: boolean;
  /** A munkalapszám, vagy kimondva, hogy még nincs. */
  number: string;
  /** Bal oldal: kivel és mi. */
  left: WorksheetSheetField[];
  /** Jobb oldal: a dátumok. */
  right: WorksheetSheetField[];
  description: string | null;
  items: WorksheetSheetItem[];
  /**
   * AZ ÖSSZES MUNKAÓRA, DE CSAK HA VAN MUNKAÓRA-TÉTEL (Luca: „munkaóra nem szükséges, ha nincs bekattintva akkor nem kell megjeleníteni").
   * Ez felülírja a korábbi „nulla is kiíródik" szabályt: a darab- és alkalom-tételes lapon egy „Összes munkaóra: 0" sor a vevőnek nem
   * mond semmit. Munkaóra-tételnél viszont a nulla is kiíródik, mert ott a hiánya jelent valamit.
   */
  laborTotal: string | null;
  entries: string[];
  signature: string[];
}

export function worksheetSheetLayout(
  input: WorksheetSheetInput,
): WorksheetSheetLayout {
  const field = (
    name: string,
    value: string | null,
  ): WorksheetSheetField | null => (value ? { label: name, value } : null);
  const left = [
    {
      label: "Partner",
      value: input.customerNumber
        ? `${input.customerName} (${input.customerNumber})`
        : input.customerName,
    },
    {
      label: "Helyszín",
      value: `${input.departmentName} (${input.departmentCode})`,
    },
    field("Tárgy", input.subject),
    field("Felvette", input.createdByName),
    input.assigneeNames.length
      ? { label: "Dolgozott rajta", value: input.assigneeNames.join(", ") }
      : null,
    field("Folytatás", input.continuesLabel ?? null),
  ].filter((f): f is WorksheetSheetField => f !== null);
  const right = [
    field("Kiállítás", sheetDate(input.issueDate)),
    field("Teljesítés", sheetDate(input.fulfillmentDate)),
    field("Határidő", sheetDate(input.dueDate ?? null)),
    field("Lezárva", sheetDate(input.closedAt)),
  ].filter((f): f is WorksheetSheetField => f !== null);
  const items = input.lines.map((line) => ({
    position: line.position,
    description: line.description,
    notes: [
      line.detail,
      line.assetNumber ? `Eszköz: ${line.assetNumber}` : null,
      line.partnerInternalCode
        ? `Partner belső kódja: ${line.partnerInternalCode}`
        : null,
    ].filter((n): n is string => !!n),
    amount: lineAmount(line),
  }));
  const signature: string[] = [];
  if (!input.signature) signature.push("Még nincs aláírva.");
  else {
    const decision =
      input.signature.decision === "ACCEPTED" ? "Elfogadva" : "Elutasítva";
    signature.push(
      `${decision}. ${worksheetSignerLabel(input.signature.signerSource)}: ${input.signature.signerName}, ${sheetDate(input.signature.signedAt)}`,
    );
    if (input.signature.signedByName)
      signature.push(`Az aláírást rögzítette: ${input.signature.signedByName}`);
    if (input.signature.note)
      signature.push(`Megjegyzés: ${input.signature.note}`);
  }
  return {
    draft: input.status !== "SIGNED",
    number: input.label ?? "(még nincs száma)",
    left,
    right,
    description: input.description,
    items,
    laborTotal: input.lines.some((line) => line.kind === "LABOR")
      ? input.laborHours
      : null,
    entries: input.entries.map((entry) => {
      const value =
        typeof entry === "string" ? { body: entry, authorName: null } : entry;
      return value.authorName
        ? `${value.body} · ${value.authorName}`
        : value.body;
    }),
    signature,
  };
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
  const layout = worksheetSheetLayout(input);
  const field = (name: string) => {
    const f = [...layout.left, ...layout.right].find((x) => x.label === name);
    return f ? `${f.label}: ${f.value}` : null;
  };
  const out: (string | null)[] = [];

  // A JELÖLÉS MINDEN NEM ALÁÍRT ÁLLAPOTRA ÁLL, NEM CSAK A `DRAFT`-RA: egy aláírásra váró lap sincs aláírva, és épp azt teszi a szerelő
  // az ügyfél elé.
  if (layout.draft) out.push(DRAFT_MARK, "");

  // SZÁM NÉLKÜL IS VAN FEJLÉC, ÉS KIMONDJA, HOGY NINCS SZÁMA: a `${null}` „MUNKALAP null"-t írna, az üres pedig elveszett számot sugallna.
  out.push(`MUNKALAP  ${layout.number}`, "");
  out.push(field("Partner"), field("Helyszín"), field("Tárgy"));
  out.push(layout.description ? `Leírás: ${layout.description}` : null);
  out.push(field("Kiállítás"), field("Teljesítés"), field("Határidő"));
  out.push(field("Felvette"), field("Dolgozott rajta"));
  // A HIBAJEGY SZÁMA NEM KERÜL A LAPRA (acrobot döntése, 2026-09-18 10:56): egy lezárt laphoz utólag is csatolható jegy, a lap viszont
  // pillanatkép. A rendszerben az adatlapon ott marad.
  out.push(field("Lezárva"), field("Folytatás"));

  out.push("", "TÉTELEK");
  if (!layout.items.length) out.push("Ezen a lapon nincs tétel.");
  for (const item of layout.items) {
    out.push(`${item.position}. ${item.description}`);
    for (const note of item.notes) out.push(`   ${note}`);
    out.push(`   ${item.amount}`);
  }
  if (layout.laborTotal !== null)
    out.push("", `Összes munkaóra: ${layout.laborTotal}`);

  // A NAPLÓ-SZAKASZ CSAK AKKOR ÁLL KI, HA VAN BEJEGYZÉS: egy üres „NAPLÓ" fejléc azt állítaná, hogy hiányzik valami.
  if (layout.entries.length) {
    out.push("", "NAPLÓ");
    for (const entry of layout.entries) out.push(`- ${entry}`);
  }

  out.push("", "ALÁÍRÁS", ...layout.signature);
  return out.filter((line): line is string => line !== null);
}
