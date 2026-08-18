import {
  formatWorksheetNumber,
  WORKSHEET_DEPARTMENT_CODE_PATTERN,
  WORKSHEET_PARTNER_CODE_PATTERN,
} from "@acropora/types";

/**
 * A sorozat éve az üzlet helyi éve, nem a szerver UTC éve. December 31-én
 * 23:30-kor (magyar idő) a lezárás még a régi sorozatba tartozik, pedig UTC
 * szerint már január van - a két érték egy évben egyszer eltér, és pont a
 * sorozat határán.
 */
export const WORKSHEET_TIME_ZONE = "Europe/Budapest";

export function worksheetYear(
  closedAt: Date,
  timeZone: string = WORKSHEET_TIME_ZONE,
): number {
  const formatted = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
    timeZone,
    year: "numeric",
  }).format(closedAt);
  const year = Number.parseInt(formatted, 10);
  if (!Number.isInteger(year)) {
    throw new Error("WORKSHEET_YEAR_UNRESOLVABLE");
  }
  return year;
}

export type WorksheetNumberIssue =
  | "PARTNER_CODE_MISSING"
  | "PARTNER_CODE_INVALID"
  | "DEPARTMENT_CODE_MISSING"
  | "DEPARTMENT_CODE_INVALID";

/**
 * A hiányzó tag nem javítható a szám kiadásakor: ha egy partnernek nincs
 * rövidítése vagy nincs részleg-kódja, kétféle alakú szám keletkezne, és a
 * sorozat onnantól se nem rendezhető, se nem ellenőrizhető. Ezért a lezárás
 * inkább elakad.
 */
export const WORKSHEET_NUMBER_ISSUE_MESSAGES: Record<
  WorksheetNumberIssue,
  string
> = {
  PARTNER_CODE_MISSING:
    "A partnerhez nincs munkalap-rövidítés felvive, ezért a munkalap nem zárható le. Vidd fel a partner rövidítését (pl. FANK) a vevő adatlapján.",
  PARTNER_CODE_INVALID:
    "A partner munkalap-rövidítése érvénytelen: betűvel kezdődő, 2-8 karakteres nagybetűs kód lehet (pl. FANK).",
  DEPARTMENT_CODE_MISSING:
    "A munkalaphoz nincs részleg rendelve, ezért nem zárható le. A részleg-kód a szám kötelező tagja.",
  DEPARTMENT_CODE_INVALID:
    "A részleg kódja érvénytelen: legfeljebb három nagybetű lehet (pl. BIO).",
};

export function worksheetNumberIssue(input: {
  partnerCode: string | null | undefined;
  departmentCode: string | null | undefined;
}): WorksheetNumberIssue | null {
  const partnerCode = input.partnerCode?.trim();
  const departmentCode = input.departmentCode?.trim();
  if (!partnerCode) return "PARTNER_CODE_MISSING";
  if (!WORKSHEET_PARTNER_CODE_PATTERN.test(partnerCode))
    return "PARTNER_CODE_INVALID";
  if (!departmentCode) return "DEPARTMENT_CODE_MISSING";
  if (!WORKSHEET_DEPARTMENT_CODE_PATTERN.test(departmentCode))
    return "DEPARTMENT_CODE_INVALID";
  return null;
}

export interface WorksheetNumberAllocation {
  number: string;
  year: number;
  sequence: number;
}

export function buildWorksheetNumber(input: {
  partnerCode: string;
  departmentCode: string;
  year: number;
  sequence: number;
}): WorksheetNumberAllocation {
  const issue = worksheetNumberIssue(input);
  if (issue) throw new Error(issue);
  if (!Number.isInteger(input.sequence) || input.sequence < 1) {
    throw new Error("WORKSHEET_SEQUENCE_INVALID");
  }
  return {
    number: formatWorksheetNumber(input),
    year: input.year,
    sequence: input.sequence,
  };
}
