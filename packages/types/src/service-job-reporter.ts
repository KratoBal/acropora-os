/** Shared server/mail presentation; clients receive this same label, including Expo. */
export function serviceJobReporterName(
  openerName: string | null | undefined,
  reporterPersonName: string | null | undefined,
): string | null {
  const opener = openerName ?? null;
  const person = reporterPersonName?.trim();
  return person ? (opener ? `${opener} (${person})` : person) : opener;
}
