/**
 * A KARBANTARTÁSI CSOMAG LEVELÉNEK SZÖVEGE -- A HIBAJEGYES `handover-mail.content.ts`
 * MINTÁJA: a tárgy ELŐTÖLTÖTT, a kezelő átírhatja; a törzs a kezelő saját
 * szövege, semmi más.
 */

export function maintenancePackageMailDefaultSubject(
  jobNumber: string,
): string {
  return `A ${jobNumber} számú karbantartás dokumentumcsomagját küldjük.`;
}

export function maintenancePackageMailBody(input: { message: string }): string {
  return input.message.trim();
}
