import type { WorksheetDetail } from "@acropora/types";

import type { CreateWorksheetDto } from "./dto/worksheet.dto.js";

/**
 * A MUNKALAP MÁSOLÁSA (kártya a785e580, 2. szelet; Luca 2026-11-19 10:23 UTC: "a kijelölt munkalapokból új példány
 * ugyanazokkal az adatokkal, pl. a következő alkalomhoz"; acrobot 57048 döntése a mezőkről).
 *
 * AMI ÁTJÖN: a szülő (ugyanaz a karbantartási lap vagy hibajegy, vagy önálló marad), a vevő és a helyszín, a tárgy és a
 * leírás, a tételsorok az áraikkal (mennyiség, egység, fajta, létszám, nettó egységár, ÁFA, a sor eszköze), a felelősök és
 * az érintett eszközök.
 *
 * AMI NEM JÖN: a dátumok (kiállítás, teljesítés, határidő: a következő alkalomé még nincs), az aláírás, a sorszám (az új
 * lap a létrehozáskor kap újat), a bejegyzések, a lezárás és a verziók. Az új lap piszkozat.
 *
 * A TÁRGY VÁLTOZATLAN, "(másolat)" nélkül: a következő alkalom lapja ugyanarról a munkáról szól, és az új sorszám
 * különbözteti meg. Egy jelölés minden későbbi nyomtatványon ott maradna.
 *
 * A létrehozás a kézi nyitás útja (`WorksheetsService.create`): ugyanazok az ellenőrzések, ugyanaz a sorszámozás, és a
 * felelős-követő jelző (`followsJobAssignees`) ugyanazzal a szabállyal dől el, mint egy kézzel nyitott új lapnál.
 */
export function worksheetCopyInput(
  source: WorksheetDetail,
  clientOperationId?: string,
): CreateWorksheetDto {
  const version = source.currentVersion;
  return {
    ...(clientOperationId ? { clientOperationId } : {}),
    customerId: source.customer.id,
    departmentId: source.department.id,
    serviceJobId: source.serviceJob?.id ?? null,
    subject: version.subject,
    description: version.description,
    issueDate: null,
    fulfillmentDate: null,
    dueDate: null,
    lines: version.lines.map((line) => ({
      description: line.description,
      detail: line.detail,
      assetId: line.assetId,
      quantity: Number(line.quantity),
      unit: line.unit,
      kind: line.kind,
      workerCount: line.workerCount,
      ...(line.unitNet === null ? {} : { unitNet: Number(line.unitNet) }),
      ...(line.vatRatePercent === null
        ? {}
        : { vatRatePercent: Number(line.vatRatePercent) }),
    })),
    assigneeIds: source.assignees.map((assignee) => assignee.userId),
    assetIds: source.assets.map((asset) => asset.assetId),
  } as CreateWorksheetDto;
}

/**
 * A másolat művelet-azonosítója a kérésé és a lap sorszáma a kérésben: egy újraküldött kérés ugyanazokat a lapokat adja
 * vissza, nem újakat (a `createDraft` a `clientOperationId` ütközésén a meglévőt adja).
 */
export function copyOperationId(
  requestId: string | undefined,
  index: number,
): string | undefined {
  return requestId ? `${requestId}:masolat:${index}` : undefined;
}

export const WORKSHEET_COPY_MAX = 50;
