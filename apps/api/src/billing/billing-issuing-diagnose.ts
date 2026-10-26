/**
 * A KIÁLLÍTÁS VÉSZÁLLAPOTAI: MELY KIMENŐ BIZONYLAT ÁLL ISSUING-BEN, ÉS MIÉRT (kártya 38e9271d, acrobot
 * 2026-10-26: "előbb mérés, csak valós esetre épül feloldás"). CSAK OLVAS, tiszta függvények.
 *
 * A KÓDBÓL KIOLVASHATÓ ÚT (a main fején mérve, `billing-document-issue.service.ts` és
 * `billing-document-preview.service.ts`): az ISSUING-ből NINCS kivezető út. A kiállítás gombja
 * 409-et ad (`status === "ISSUING"`), a mentés csak DRAFT-on megy, és ISSUED-re csak a kiállítás saját
 * folyamata írhat. Az ISSUING-be hat út vezet, és mindegyik a `syncError` szövegében hagy nyomot:
 *   - NO_REPLY        a hívás kivételt dobott (időtúllépés, hálózat, HTTP-hiba): a bizonylat LEHET, hogy létrejött
 *   - UNCLEAR_REPLY   a válaszban se hibakód, se szám: a bizonylat LEHET, hogy létrejött
 *   - RECORDING_FAILED a Számlázz.hu kiállította, a rögzítés nálunk bukott: a bizonylat LÉTEZIK, a száma a szövegben
 *   - STRAY_PREVIEW   egy előnézet-kérés valódi bizonylatot hozott létre: LÉTEZIK, a száma a szövegben
 *   - NO_NOTE         a foglalás (DRAFT -> ISSUING) megtörtént, a kimenet nincs leírva: a folyamat megszakadt
 *                     (újraindítás, kilövés) a hívás körül; a bizonylat LEHET, hogy létrejött
 *   - OTHER           ismeretlen szöveg
 * A "létezik" két fajtánál a szám is megvan, ezért ott a feloldás egyértelmű; a többinél a Számlázz.hu a forrás.
 */
export const ISSUING_KINDS = [
  "RECORDING_FAILED",
  "STRAY_PREVIEW",
  "NO_REPLY",
  "UNCLEAR_REPLY",
  "NO_NOTE",
  "OTHER",
] as const;
export type IssuingKind = (typeof ISSUING_KINDS)[number];

export interface StuckRow {
  id: string;
  documentType: string;
  status: string;
  syncError: string | null;
  invoiceNumber: string | null;
  issueAttemptCount: number;
  updatedAt: Date;
}

export interface Classified {
  id: string;
  documentType: string;
  kind: IssuingKind;
  /** A Számlázz.hu-n VAN bizonylat, és a száma a szövegben áll (RECORDING_FAILED, STRAY_PREVIEW). */
  knownNumber: string | null;
  /** A bizonylat biztosan létezik a Számlázz.hu-n (nem csak lehet). */
  existsForSure: boolean;
  attempts: number;
  ageHours: number;
  note: string | null;
}

/** A szövegben álló Számlázz.hu-szám: a kiállított bizonylat száma, a mondat két ismert alakjából. */
export function numberInNote(note: string): string | null {
  const recorded = /Számlázz\.hu kiállította a\(z\) (\S+) bizonylatot/.exec(
    note,
  );
  if (recorded) return recorded[1]!;
  const stray =
    /valódi bizonylatot hozott létre a Számlázz\.hu-n: (\S+?)\.(?:\s|$)/.exec(
      note,
    );
  return stray ? stray[1]! : null;
}

export function classifyIssuing(row: StuckRow, now: Date): Classified {
  const note = row.syncError;
  let kind: IssuingKind = "OTHER";
  if (!note || note.trim() === "") kind = "NO_NOTE";
  else if (note.includes("a rögzítése nálunk nem sikerült"))
    kind = "RECORDING_FAILED";
  else if (
    note.startsWith("Egy előnézet-kérés valódi bizonylatot hozott létre")
  )
    kind = "STRAY_PREVIEW";
  else if (note.includes("válasza nem érkezett meg")) kind = "NO_REPLY";
  else if (note.includes("nem mondta meg egyértelműen")) kind = "UNCLEAR_REPLY";
  const knownNumber = note ? numberInNote(note) : null;
  return {
    id: row.id,
    documentType: row.documentType,
    kind,
    knownNumber,
    existsForSure: kind === "RECORDING_FAILED" || kind === "STRAY_PREVIEW",
    attempts: row.issueAttemptCount,
    ageHours:
      Math.round(((now.getTime() - row.updatedAt.getTime()) / 3_600_000) * 10) /
      10,
    note,
  };
}

export interface Summary {
  issuing: number;
  failed: number;
  byKind: Record<IssuingKind, number>;
  existForSure: number;
}

export function summarize(
  rows: readonly StuckRow[],
  now: Date,
): { summary: Summary; stuck: Classified[] } {
  const stuck = rows
    .filter((row) => row.status === "ISSUING")
    .map((row) => classifyIssuing(row, now))
    .sort((a, b) => b.ageHours - a.ageHours);
  const byKind = Object.fromEntries(ISSUING_KINDS.map((k) => [k, 0])) as Record<
    IssuingKind,
    number
  >;
  for (const row of stuck) byKind[row.kind] += 1;
  return {
    summary: {
      issuing: stuck.length,
      failed: rows.filter((row) => row.status === "ISSUE_FAILED").length,
      byKind,
      existForSure: stuck.filter((row) => row.existsForSure).length,
    },
    stuck,
  };
}

/** A jelentés szövege: összesítő elöl, utána soronként az ISSUING-ben állók. Személyes adat nincs benne. */
export function report(rows: readonly StuckRow[], now: Date): string {
  const { summary, stuck } = summarize(rows, now);
  const head = [
    "CSAK OLVASÁS: kimenő bizonylatok a kiállítás végállapotában",
    `ISSUING: ${summary.issuing} (ebből biztosan létező bizonylat: ${summary.existForSure}), ISSUE_FAILED: ${summary.failed} (az újra kiállítható, nem végállapot)`,
    ...ISSUING_KINDS.map((k) => `  ${k}: ${summary.byKind[k]}`),
  ];
  if (stuck.length === 0)
    return `${head.join("\n")}\nNincs ISSUING-ben álló bizonylat.\n`;
  const lines = stuck.map(
    (row) =>
      `${row.id}  ${row.documentType}  ${row.kind}  ${row.knownNumber ? `szám: ${row.knownNumber}  ` : ""}${row.ageHours} óra  próba: ${row.attempts}`,
  );
  return `${head.join("\n")}\n\n${lines.join("\n")}\n`;
}
