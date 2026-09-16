import type { Prisma } from "@acropora/database";
import { describeSignerSource } from "./worksheet-signer.js";
import {
  formatWorksheetVersionLabel,
  personDisplayName,
  type WorksheetAssignee,
  type WorksheetDetail,
  type WorksheetListItem,
  type WorksheetSignatureDetail,
  type WorksheetVersionDetail,
  type WorksheetVersionSummary,
} from "@acropora/types";

import type { ComparableWorksheetVersion } from "./worksheet-diff.js";

export const worksheetVersionInclude = {
  lines: {
    // Az ügyfél saját kódja (`inventoryNumber`) ÉLŐ HIVATKOZÁS, akárcsak az
    // eszközszám: a soron nincs másolata, olvasáskor jön az eszközről. A
    // döntés indoka az, hogy ez a kód a funkciót azonosítja, nem a darabot,
    // tehát nem változik. Ha mégis (elgépelés javítása), a javítás a már
    // aláírt lapokon is megjelenik.
    include: {
      asset: { select: { assetNumber: true, inventoryNumber: true } },
    },
    orderBy: { position: "asc" as const },
  },
  createdBy: { select: { displayName: true } },
  closedBy: { select: { displayName: true } },
  signature: { include: { signedBy: { select: { displayName: true } } } },
} satisfies Prisma.WorksheetVersionInclude;

/**
 * A felelősök sorrendje a kiosztás sorrendje, azonos időbélyegnél az
 * azonosító dönt. Determinált sorrend nélkül ugyanaz a lap két lekérdezésen
 * más sorrendben adná vissza ugyanazokat a neveket.
 */
const assigneeOrderBy = [
  { assignedAt: "asc" as const },
  { userId: "asc" as const },
];

export const worksheetAssigneeInclude = {
  assignees: {
    select: {
      userId: true,
      assignedAt: true,
      user: { select: { displayName: true, nickname: true } },
    },
    orderBy: assigneeOrderBy,
  },
} satisfies Prisma.WorksheetInclude;

export const worksheetDetailInclude = {
  ...worksheetAssigneeInclude,
  customer: {
    select: {
      id: true,
      customerNumber: true,
      displayName: true,
      worksheetPartnerCode: true,
    },
  },
  department: {
    select: {
      id: true,
      parentId: true,
      code: true,
      name: true,
      isActive: true,
    },
  },
  createdBy: { select: { displayName: true } },
  /**
   * A HIBAJEGY, AMI ALATT A LAP ALL. `null`, amig nincs - es ez nem kivetel,
   * hanem az egyik rendes ut: a lap keletkezhet elobb, es a jegy nalunk
   * szuletik meg utolag.
   *
   * A SZAM IS KELL, NEM CSAK AZ AZONOSITO: a reszletlapon egy azonosito nem
   * mond semmit annak, aki nezi, a `HJ-2026-001` igen. Kulon lekerdezes nelkul
   * jon, ugyanabban a sorban.
   */
  serviceJob: { select: { id: true, jobNumber: true } },
  /** Both ends of the chain. A link only one side knows about is no use to
   * whoever finds the other side first -- and on a signed sheet the only way
   * onward IS the continuation, so the sheet has to name it. */
  continues: { select: { id: true, number: true } },
  continuedBy: {
    select: { id: true, number: true },
    orderBy: { createdAt: "asc" as const },
  },
  /**
   * AZ ESZKOZOK, AMIKROL A LAP SZOL.
   *
   * MIERT KERULT BE (merve 2026-09-16): a `WorksheetAsset` sorokat 2026-09-15
   * ota IRJUK, es SEMMI nem olvasta vissza. Egyetlen `createMany` all a
   * taroloban, a reszletlap includeja nem tartalmazta, a kozos tipusban nem
   * volt mezo, es a webes munkalap-mappa nulla helyen hivatkozott ra. Aki tehat
   * felvitelkor eszkozt csatolt egy laphoz, azt SEHOL nem latta viszont -- meg
   * a sajat lapjan sem.
   *
   * A `createdAt` IS KIMEGY, nem csak a nev: egy honapja csatolt es egy ma
   * csatolt eszkoz kozott a kezelonek latnia kell a kulonbseget, kulonben nem
   * tudja megitelni, hogy a lista a mai munkarol szol-e.
   */
  assets: {
    select: {
      id: true,
      assetId: true,
      createdAt: true,
      asset: { select: { assetNumber: true, name: true } },
    },
    orderBy: { createdAt: "asc" as const },
  },
  versions: {
    include: worksheetVersionInclude,
    orderBy: { version: "desc" as const },
  },
} satisfies Prisma.WorksheetInclude;

export const worksheetSummaryInclude = {
  ...worksheetAssigneeInclude,
  customer: { select: { displayName: true } },
  // AZ AZONOSITO A KOD MELLE: a teljes utat a lista egyetlen kotegben kerdezi
  // le (`unitPathsFor`), es ahhoz az azonosito kell, nem a kod. A kod
  // megmarad, mert az az, amire a felulet visszaesik, ha nincs ut.
  department: { select: { id: true, code: true } },
  versions: {
    select: {
      version: true,
      status: true,
      subject: true,
      grossAmount: true,
    },
    orderBy: { version: "desc" as const },
    take: 1,
  },
  _count: { select: { versions: true } },
} satisfies Prisma.WorksheetInclude;

export type WorksheetDetailRow = Prisma.WorksheetGetPayload<{
  include: typeof worksheetDetailInclude;
}> & {
  /**
   * A HELYSZIN TELJES UTJA, a tarolo teszi melle -- NEM a Prisma `include`
   * eredmenye.
   *
   * MIERT NEM AZ: a helyszin-fa melysege NEM korlatos, tehat egy
   * `parent: { parent: { ... } }` lanc mindig csak addig latna, ameddig valaki
   * megirta, es a hianyzo szint CSENDBEN maradna ki.
   *
   * ELHAGYHATO, es ez szandekos: a leképezés tiszta fuggveny marad, es a
   * meglevo hivok (tesztek hamis sorai) valtozatlanul ervenyesek.
   */
  departmentPath?: string[] | null;
};

export type WorksheetSummaryRow = Prisma.WorksheetGetPayload<{
  include: typeof worksheetSummaryInclude;
}>;

export type WorksheetVersionRow = WorksheetDetailRow["versions"][number];

type WorksheetAssigneeRow = WorksheetDetailRow["assignees"][number];

/**
 * A felelős a felületen a becenevén szerepel, nem a hivatalos nevén: a
 * kiosztás belső munkaszervezés, nem dokumentum-tartalom. A dokumentumra
 * kerülő nevek (aláírás) továbbra is a teljes nevet használják.
 */
function toAssignee(row: WorksheetAssigneeRow): WorksheetAssignee {
  return {
    userId: row.userId,
    name: personDisplayName(row.user),
    assignedAt: row.assignedAt.toISOString(),
  };
}

/** A `@db.Date` oszlop UTC éjfélként jön vissza; a dokumentumon dátum van, nem időpont. */
function toDateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function toSignatureDetail(
  row: WorksheetVersionRow["signature"],
): WorksheetSignatureDetail | null {
  if (!row) return null;
  return {
    decision: row.decision,
    signerName: row.signerName,
    signedByName: row.signedBy?.displayName ?? null,
    signedAt: row.signedAt.toISOString(),
    note: row.note,
    /**
     * A JELZES A SZERVEREN SZULETIK, es a TAROLT allapotbol -- nem abbol, hogy
     * a nev "ugy nez ki", mintha ugyfele lenne. A regi sorokon a forras `null`,
     * es a mondat ott azt mondja meg, hogy NEM TUDJUK, ki irta ala.
     */
    signerNotice: describeSignerSource(row.signerSource ?? null),
  };
}

export function toVersionSummary(
  row: WorksheetVersionRow,
  worksheetNumber: string | null,
): WorksheetVersionSummary {
  return {
    id: row.id,
    version: row.version,
    label: formatWorksheetVersionLabel(worksheetNumber, row.version),
    status: row.status,
    changeReason: row.changeReason,
    createdByName: row.createdBy?.displayName ?? null,
    createdAt: row.createdAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    closedByName: row.closedBy?.displayName ?? null,
    netAmount: row.netAmount.toString(),
    vatAmount: row.vatAmount.toString(),
    grossAmount: row.grossAmount.toString(),
    signature: toSignatureDetail(row.signature),
  };
}

export function toVersionDetail(
  row: WorksheetVersionRow,
  worksheetNumber: string | null,
): WorksheetVersionDetail {
  return {
    ...toVersionSummary(row, worksheetNumber),
    subject: row.subject,
    unitName: row.unitName,
    description: row.description,
    issueDate: toDateOnly(row.issueDate),
    fulfillmentDate: toDateOnly(row.fulfillmentDate),
    dueDate: toDateOnly(row.dueDate),
    currency: row.currency,
    lines: row.lines.map((line) => ({
      id: line.id,
      position: line.position,
      description: line.description,
      detail: line.detail,
      assetId: line.assetId,
      assetNumber: line.asset?.assetNumber ?? null,
      inventoryNumber: line.asset?.inventoryNumber ?? null,
      quantity: line.quantity.toString(),
      unit: line.unit,
      // A HIÁNYZÓ ÁR `null`-ként megy tovább, nem üres szövegként és nem
      // nullaként. Az üres szöveg a felületen kiírható értéknek látszana, a
      // nulla pedig ingyenes munkának - a `null` az egyetlen alak, amiről a
      // hívó tudja, hogy még nincs kitöltve.
      unitNet: line.unitNet?.toString() ?? null,
      vatRatePercent: line.vatRatePercent?.toString() ?? null,
      netAmount: line.netAmount?.toString() ?? null,
      vatAmount: line.vatAmount?.toString() ?? null,
      grossAmount: line.grossAmount?.toString() ?? null,
    })),
  };
}

/** A verziók sorrendje csökkenő, tehát a lap mai állapota az első elem. */
export function currentVersionRow(
  row: WorksheetDetailRow,
): WorksheetVersionRow {
  const current = row.versions[0];
  if (!current) throw new Error("WORKSHEET_WITHOUT_VERSION");
  return current;
}

export function toWorksheetDetail(row: WorksheetDetailRow): WorksheetDetail {
  const current = currentVersionRow(row);
  return {
    id: row.id,
    number: row.number,
    numberYear: row.numberYear,
    sequence: row.sequence,
    customer: {
      id: row.customer.id,
      customerNumber: row.customer.customerNumber,
      displayName: row.customer.displayName,
      worksheetPartnerCode: row.customer.worksheetPartnerCode,
    },
    department: {
      id: row.department.id,
      parentId: row.department.parentId,
      code: row.department.code,
      name: row.department.name,
      // A TELJES UT, HA A TAROLO MELLETETTE. A mezo elhagyhato, es a
      // leképezés tiszta marad: a betoltes a tarolo dolga.
      ...(row.departmentPath ? { path: row.departmentPath } : {}),
      isActive: row.department.isActive,
    },
    createdByName: row.createdBy?.displayName ?? null,
    serviceJob: row.serviceJob
      ? { id: row.serviceJob.id, jobNumber: row.serviceJob.jobNumber }
      : null,
    assignees: row.assignees.map(toAssignee),
    assets: row.assets.map((link) => ({
      id: link.id,
      assetId: link.assetId,
      assetNumber: link.asset.assetNumber,
      assetName: link.asset.name,
      attachedAt: link.createdAt.toISOString(),
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    continues: row.continues ?? null,
    continuedBy: row.continuedBy,
    currentVersion: toVersionDetail(current, row.number),
    versions: row.versions.map((version) =>
      toVersionSummary(version, row.number),
    ),
  };
}

/**
 * A TELJES UT PARAMETER, NEM LEKERDEZES -- es ez ugyanaz a reteg-rend, ami az
 * `unitPathFor` kliens-parametereben all. A leado egy KOTEGBEN kerdezi le az
 * egesz oldal utjait, ez a fuggveny pedig tiszta marad: sor be, sor ki.
 *
 * Ha az ut hianyzik a terkepbol, `null` kerul a mezobe, nem ures tomb. A
 * felulet ilyenkor a kodra esik vissza, es az a viselkedes ugyanaz, mint a mai.
 */
export function toWorksheetListItem(
  row: WorksheetSummaryRow,
  departmentPaths?: Map<string, string[]>,
): WorksheetListItem {
  const current = row.versions[0];
  if (!current) throw new Error("WORKSHEET_WITHOUT_VERSION");
  return {
    id: row.id,
    number: row.number,
    label: formatWorksheetVersionLabel(row.number, current.version),
    customerName: row.customer.displayName,
    departmentCode: row.department.code,
    departmentPath: departmentPaths?.get(row.department.id) ?? null,
    subject: current.subject,
    status: current.status,
    version: current.version,
    versionCount: row._count.versions,
    grossAmount: current.grossAmount.toString(),
    assigneeNames: row.assignees.map((assignee) =>
      personDisplayName(assignee.user),
    ),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toComparableVersion(
  row: WorksheetVersionRow,
): ComparableWorksheetVersion {
  return {
    subject: row.subject,
    unitName: row.unitName,
    description: row.description,
    issueDate: toDateOnly(row.issueDate),
    fulfillmentDate: toDateOnly(row.fulfillmentDate),
    dueDate: toDateOnly(row.dueDate),
    currency: row.currency,
    netAmount: row.netAmount.toString(),
    vatAmount: row.vatAmount.toString(),
    grossAmount: row.grossAmount.toString(),
    lines: row.lines.map((line) => ({
      position: line.position,
      description: line.description,
      detail: line.detail,
      /**
       * AZ ÜGYFÉL SAJÁT KÓDJA SZÁNDÉKOSAN NINCS ITT.
       *
       * Az összehasonlítás ugyanannak a lapnak két verziója között fut, és
       * mindkét oldal ÉLŐ hivatkozással olvassa ugyanazt az eszközt. Ha a sor
       * ugyanarra az eszközre mutat, a két kód azonos; ha másikra, azt már az
       * `assetNumber` eltérése jelenti. Felvéve tehát ugyanazt a változást
       * jelentené be másodszor, más néven.
       */
      assetNumber: line.asset?.assetNumber ?? null,
      quantity: line.quantity.toString(),
      unit: line.unit,
      unitNet: line.unitNet?.toString() ?? null,
      vatRatePercent: line.vatRatePercent?.toString() ?? null,
      netAmount: line.netAmount?.toString() ?? null,
    })),
  };
}

/**
 * Egy sor-művelet kimenete.
 *
 * A három kimenetet azért kell szétválasztani, mert MÁS a helyes válasz
 * rájuk: a hiányzó verzió és a hiányzó sor hibát érdemel, az `alreadyPresent`
 * viszont nem - az egy újraküldött művelet, ami már megtörtént. A helyszíni
 * rögzítés sorba áll és újraküld, tehát ez nem ritka eset, hanem a normál
 * működés része.
 */
export type WorksheetLineWriteResult =
  | { outcome: "ok"; alreadyPresent: boolean }
  | { outcome: "version-gone" }
  | { outcome: "line-gone" };
