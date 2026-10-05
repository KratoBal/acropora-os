import { createHash } from "node:crypto";

export interface ExtractedProblem {
  text: string;
  title: string;
  fingerprint: string;
  repeatKey: string | null;
  attachmentNames: string[];
}
export interface ExtractedReport {
  reportDate: Date;
  problems: ExtractedProblem[];
}
const months = [
  "januar",
  "februar",
  "marcius",
  "aprilis",
  "majus",
  "junius",
  "julius",
  "augusztus",
  "szeptember",
  "oktober",
  "november",
  "december",
];
export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
export function problemFingerprint(text: string): string {
  return createHash("sha256")
    .update(
      fold(text)
        .replace(/\([^)]*\)/g, "")
        .replace(/[^a-z0-9]/g, ""),
    )
    .digest("hex");
}
function repeatKey(text: string): string | null {
  const t = fold(text);
  // 09.24 named it "the isolation tank's biofilter lift motor", 09.26 "the biofilter
  // lift"; the tank name is not always written, so it is not part of the key.
  if (/bio.?szuro/.test(t) && /felnyomo/.test(t))
    return "elkulonito-bioszuro-felnyomo-motor";
  if (/lehabzo/.test(t) && /venturi/.test(t)) return "lehabzo-venturi";
  if (/korallos/.test(t) && /lcd|kijelzo/.test(t)) return "korallos-lcd";
  return null;
}
/** Inline images of a signature or a pasted logo: `[cid:…]`, `<Outlook-….jpg>`. */
const INLINE_IMAGE = /\[cid:[^\]]*\]|<Outlook-[^>\s]*>/gi;
/**
 * The sender's signature block (2026-06-04, 2026-06-06: name, job titles, the
 * zoo's name, its address, Mobile, E-mail). It has no bullet and no section of
 * its own, so without this every line became a draft. The anchor is the zoo's
 * name, a postcode line or a contact field; the name and the job titles stand
 * right above it, in short Title Case lines.
 */
function isSignatureAnchor(f: string): boolean {
  return (
    /^(budapest zoo\b|fovarosi allat- ?es novenykert)/.test(f) ||
    /^h-?\d{4} /.test(f) ||
    /^(mobile?|mobil|tel|telefon|phone|e-?mail)\s*:/.test(f)
  );
}
const isTitleCaseLine = (line: string) => {
  const words = line.split(/\s+/);
  return (
    words.length <= 5 && words.every((w) => /^\p{Lu}[\p{L}.'’-]*$/u.test(w))
  );
};
/** Index of the first signature line, or the length when there is none. */
function signatureStart(lines: readonly string[]): number {
  const anchor = lines.findIndex((l) => isSignatureAnchor(fold(l.trim())));
  if (anchor < 0) return lines.length;
  let start = anchor;
  for (let i = anchor - 1, taken = 0; i >= 0 && taken < 4; i--) {
    const line = lines[i]!.replace(INLINE_IMAGE, "").trim();
    if (!line) continue;
    if (!isTitleCaseLine(line)) break;
    start = i;
    taken++;
  }
  return start;
}
/** Local template parser: no staff names or report text leave the application for a model. */
export function extractCapasuliReports(body: string): ExtractedReport[] {
  const clean = body.replace(/\r/g, "").replace(/^(?:[ \t]*>[ \t]*)+/gm, "");
  const starts = [
    ...clean.matchAll(
      /C[áa]pasuli\s*:\s*(\d{4})[.\s]+([\p{L}]+|\d{1,2})[.\s]+(\d{1,2})\.?/giu,
    ),
  ];
  return starts.flatMap((m, index) => {
    const month = /^\d+$/.test(m[2]!)
      ? Number(m[2]) - 1
      : months.indexOf(fold(m[2]!));
    const year = Number(m[1]),
      day = Number(m[3]);
    const date = new Date(Date.UTC(year, month, day));
    if (
      month < 0 ||
      month > 11 ||
      date.getUTCDate() !== day ||
      date.getUTCMonth() !== month
    )
      return [];
    const block = clean.slice(
      m.index!,
      starts[index + 1]?.index ?? clean.length,
    );
    let section = "other";
    const items: { text: string; attachmentNames: string[] }[] = [];
    let current: (typeof items)[number] | undefined;
    let workCandidate: (typeof items)[number] | undefined;
    const lines = block.split("\n");
    for (const original of lines.slice(0, signatureStart(lines))) {
      let line = original.trim();
      const f = fold(line);
      // Mail-client signatures end the report. Android Outlook writes
      // "Androidos Outlookból<https://aka.ms/...> küldve", iOS "A(z) iOS Outlook appból küldve".
      if (
        /^(a\(z\) ios outlook|androidos outlook|ios-es outlook|get outlook|sent from|felado:|from:|---)/.test(
          f,
        ) ||
        /outlook.*kuldve$/.test(f)
      )
        break;
      if (/^nap folyam(an|a)n felmerulo hibak/.test(f)) {
        section = "faults";
        current = undefined;
        workCandidate = undefined;
        line = line
          .slice(line.indexOf(":") + 1)
          .replace(/^\s*(nem volt|volt)[, .–-]*/i, "")
          .trim();
      } else if (/^nap soran tortent fontosabb/.test(f)) {
        section = "work";
        current = undefined;
        workCandidate = undefined;
        line = line
          .slice(line.indexOf(":") + 1)
          .replace(/^\s*volt[, .–-]*/i, "")
          .trim();
      } else if (/^(dolgozok|allatallomany|allategeszsegugyi)/.test(f)) {
        section = "other";
        current = undefined;
        workCandidate = undefined;
        continue;
      }
      if (section === "other" || !line) continue;
      const names = [
        ...line.matchAll(/\[([^\]]+\.(?:jpe?g|png|webp|gif|mov|mp4))\]/gi),
      ].map((m) => m[1]!);
      const content = line
        .replace(/\[[^\]]+\.(?:jpe?g|png|webp|gif|mov|mp4)\]/gi, "")
        .replace(INLINE_IMAGE, "")
        .trim();
      if (!content) {
        if (current) current.attachmentNames.push(...names);
        else if (workCandidate) workCandidate.attachmentNames.push(...names);
        continue;
      }
      // Android Outlook renders a list bullet as a line of its own ("  *"); it
      // carries no text, only says that the next line starts a new item.
      if (!/[\p{L}\p{N}]/u.test(content)) {
        current = undefined;
        workCandidate = undefined;
        continue;
      }
      if (/^(nem volt\.?|volt[, .–-]*|\(napi rutin\))$/i.test(content))
        continue;
      if (section === "work") {
        const technical = /szivattyu|motor|szuro|kijelzo|csov|lehabzo/.test(
          fold(content),
        );
        const request = /csere|javit|ker|igeny|hiba|raferne/.test(
          fold(content),
        );
        if (technical && !request) {
          workCandidate = { text: content, attachmentNames: names };
          current = undefined;
          continue;
        }
        if (
          !technical &&
          request &&
          workCandidate &&
          /^(lehet|ez|erre|arra|es|surgos)\b/.test(fold(content))
        ) {
          current = {
            text: workCandidate.text + "\n" + content,
            attachmentNames: [...workCandidate.attachmentNames, ...names],
          };
          items.push(current);
          workCandidate = undefined;
          continue;
        }
        workCandidate = undefined;
        if (!technical || !request) {
          current = undefined;
          continue;
        }
      }
      // Explicit bullets start a new issue; continuation conjunctions stay with the previous issue.
      if (
        current &&
        /^(es\b|illetve\b|valamint\b|a fent|ez\b|surgos\b)/.test(
          fold(content),
        ) &&
        !/^[-•]/.test(content)
      ) {
        current.text += "\n" + content;
        current.attachmentNames.push(...names);
      } else {
        current = { text: content, attachmentNames: names };
        items.push(current);
      }
    }
    const seen = new Set<string>();
    return [
      {
        reportDate: date,
        problems: items
          .map((i) => ({
            ...i,
            title: i.text
              .split("\n")[0]!
              .replace(/\s*\([^)]*\)\s*$/, " ")
              .trim()
              .slice(0, 300),
            fingerprint: problemFingerprint(i.text),
            repeatKey: repeatKey(i.text),
          }))
          .filter((i) => !seen.has(i.fingerprint) && !!seen.add(i.fingerprint)),
      },
    ];
  });
}
