import { createHash } from "node:crypto";

import type {
  PartnerMigrationPlan,
  PartnerMigrationRow,
} from "@acropora/types";

/**
 * EGY PARTNERTÖRZS, EGYSZERI ÁTVEZETÉS: A MŰVELETEK DÖNTÉSE (tiszta; az írás a `partner-migration.executor.ts`-ben). A terv
 * sorai közül csak az EGYÉRTELMŰ műveletek hajtódnak végre magukban; a többi kimarad, vagy a kezelő kifejezett döntésére
 * (`--bind`) vár:
 *
 *   CREATE_NEW        új vevő-sor készül (PARTNER- számmal), a partner hozzá kötve
 *   BIND_EXISTING     a partner a meglévő, szabad vevő-sorhoz kötődik
 *   BIND_AMBIGUOUS    csak `--bind KÓD=VEVŐ-AZONOSÍTÓ` döntéssel; döntés nélkül kimarad
 *   MARK_ONLY         nincs írás: a szerep-jelölés a Supplier-kötésből származtatott
 *   MERGE_CANDIDATES  kimarad: az összevonás külön, kifejezett lépés (az állatkert)
 *   SKIP_OWN          kimarad: a saját cégünk
 */
export type MigrationOperation =
  | { kind: "CREATE"; supplierId: string; code: string }
  | { kind: "BIND"; supplierId: string; code: string; customerId: string }
  | { kind: "SKIP"; supplierId: string; code: string; reason: string };

export interface MigrationDecisions {
  operations: MigrationOperation[];
  /** a `--bind` döntések, amik nem illeszkedtek egy partnerhez vagy egy jelölthöz (hiba, nem hallgatás) */
  problems: string[];
  fingerprint: string;
}

/** A kezelő döntései: partner-kód -> vevő-sor azonosító. */
export type BindChoices = Readonly<Record<string, string>>;

const SKIP_REASON: Record<string, string> = {
  MARK_ONLY: "már van vevő-sora: csak a szerep-jelölés (nincs írás)",
  MERGE_CANDIDATES:
    "további vevő-sorok vannak ugyanazon az adószámon: az összevonás külön lépés",
  SKIP_OWN: "a saját cégünk: kimarad",
  BIND_AMBIGUOUS: "több jelölt: kell egy --bind KÓD=VEVŐ-AZONOSÍTÓ döntés",
};

export function decideOperations(
  plan: PartnerMigrationPlan,
  choices: BindChoices = {},
): MigrationDecisions {
  const problems: string[] = [];
  const codes = new Set(plan.rows.map((row) => row.code));
  for (const code of Object.keys(choices))
    if (!codes.has(code))
      problems.push(`A --bind döntés ismeretlen partner-kódra szól: ${code}.`);

  const operations: MigrationOperation[] = plan.rows.map(
    (row: PartnerMigrationRow) => {
      const chosen = choices[row.code];
      if (chosen) {
        // döntés: csak a megengedett jelöltek közül (kulcs szerinti vagy névvel tájékoztatott), kötött partnerre nem
        const allowed = [...row.candidates, ...row.nameCandidates].some(
          (c) => c.id === chosen,
        );
        if (row.linkedCustomer || row.action === "SKIP_OWN" || !allowed) {
          problems.push(
            `A --bind ${row.code}=${chosen} nem megengedett: ${
              row.linkedCustomer
                ? "a partnernek már van kötött vevő-sora"
                : row.action === "SKIP_OWN"
                  ? "a saját cégünk kimarad"
                  : "a vevő-sor nem jelölt ennél a partnernél"
            }.`,
          );
          return {
            kind: "SKIP",
            supplierId: row.supplierId,
            code: row.code,
            reason: "érvénytelen döntés",
          };
        }
        return {
          kind: "BIND",
          supplierId: row.supplierId,
          code: row.code,
          customerId: chosen,
        };
      }
      if (row.action === "CREATE_NEW")
        return { kind: "CREATE", supplierId: row.supplierId, code: row.code };
      if (row.action === "BIND_EXISTING")
        return {
          kind: "BIND",
          supplierId: row.supplierId,
          code: row.code,
          customerId: row.candidates[0]!.id,
        };
      return {
        kind: "SKIP",
        supplierId: row.supplierId,
        code: row.code,
        reason: SKIP_REASON[row.action] ?? row.action,
      };
    },
  );
  return { operations, problems, fingerprint: fingerprintOf(operations) };
}

/**
 * A DÖNTÉSEK LENYOMATA: a próbafuttatás kiírja, az `--apply` visszakéri. Így csak az hajtódik végre, amit az ember (Balázs) a
 * listán látott és jóváhagyott; ha közben egy partner vagy egy vevő-sor változott, a lenyomat más, és az írás megáll.
 */
export function fingerprintOf(
  operations: readonly MigrationOperation[],
): string {
  const ordered = [...operations]
    .map((op) => [
      op.kind,
      op.supplierId,
      op.kind === "BIND" ? op.customerId : "",
    ])
    .sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  return createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
}
