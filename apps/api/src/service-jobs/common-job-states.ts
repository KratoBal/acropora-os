import type { PrismaClient } from "@acropora/database";
import {
  commonJobStatus,
  type CommonJobWorksheetFacts,
  type CommonServiceState,
} from "@acropora/types";

import { needsWorksheetFacts } from "./common-status-where.js";

/**
 * A JEGYEK MUNKALAP-TÉNYEI A KÖZÖS ÁLLAPOTHOZ, EGY KÖTEGBEN (kártya 7f23785c).
 *
 * UGYANAZ A TÉNY, MINT A SZŰRŐÉ (`common-status-where.ts`): a legutolsó verzió a `WorksheetLatestVersion` nézetből, a rejtett lap is
 * (ahogy a lezárás kapujánál, `worksheetSignatureStates`). Szabad függvény, nem a hibajegy-repository metódusa, mert a lista és az
 * adatlap mellett a műszerfal, a Feladataim és a beszélgetés-kártya is ezt olvassa, és mindegyiknek saját repository-ja van.
 */
export async function readCommonWorksheetFacts(
  database: PrismaClient,
  serviceJobIds: readonly string[],
): Promise<Map<string, CommonJobWorksheetFacts[]>> {
  const facts = new Map<string, CommonJobWorksheetFacts[]>();
  if (serviceJobIds.length === 0) return facts;
  const rows = await database.worksheet.findMany({
    where: { serviceJobId: { in: [...serviceJobIds] } },
    select: {
      serviceJobId: true,
      handedOverAt: true,
      latestVersion: { select: { status: true } },
    },
  });
  for (const row of rows) {
    if (row.serviceJobId === null) continue;
    const list = facts.get(row.serviceJobId) ?? [];
    list.push({
      currentVersionStatus: row.latestVersion?.status ?? null,
      handedOver: row.handedOverAt !== null,
    });
    facts.set(row.serviceJobId, list);
  }
  return facts;
}

/**
 * JEGYEK KÖZÖS ÁLLAPOTA, EGY KÖTEGBEN: a tényeket csak azoknak a soroknak olvassa, amelyeké függ tőlük (`needsWorksheetFacts`: az
 * IN_PROGRESS hibajegy és a karbantartás), és a közös `commonJobStatus`-t hívja, ahogy a lista.
 */
export async function commonJobStates(
  database: PrismaClient,
  rows: readonly {
    id: string;
    status: Parameters<typeof commonJobStatus>[0];
    kind: "REPAIR" | "MAINTENANCE";
  }[],
): Promise<Map<string, CommonServiceState>> {
  const facts = await readCommonWorksheetFacts(
    database,
    rows.filter(needsWorksheetFacts).map((row) => row.id),
  );
  return new Map(
    rows.map((row) => [
      row.id,
      commonJobStatus(row.status, facts.get(row.id) ?? [], row.kind),
    ]),
  );
}
