import { createHash } from "node:crypto";

import type {
  MedusaAdminClient,
  MedusaUrlRedirect,
} from "./medusa-admin.client.js";

/**
 * AZ ÁTIRÁNYÍTÁS-LISTA VETÍTÉSE A BOLTBA (SEO P0 PR 7b). Az OS a gazda
 * (`UrlRedirect`, PR 6), a commerce `url_redirect` modulja a kiszolgáló olvasata
 * (PR 7a). A lista EGYBEN megy, teljes cserével; a commerce ugyanazt az
 * ujjlenyomatot számolja, tehát egy kör egy `GET`, és `PUT` csak eltérésnél.
 */

const kis = (r: MedusaUrlRedirect) => r.source_path.toLowerCase();

/**
 * A LISTA UJJLENYOMATA, BETŰRE A COMMERCE `redirectsHash`-E
 * (`apps/backend/src/api/admin/url-redirects/helpers.ts`): a kisbetűs forrás
 * szerint, JS-sorrendben rendezve, `[forrás, cél, státusz]` sorok JSON-ja,
 * sha256. A két oldal közös tesztvektora a specben áll.
 */
export function urlRedirectsHash(rows: readonly MedusaUrlRedirect[]): string {
  const rendezett = [...rows].sort((a, b) =>
    kis(a) < kis(b) ? -1 : kis(a) > kis(b) ? 1 : 0,
  );
  return createHash("sha256")
    .update(
      JSON.stringify(
        rendezett.map((r) => [r.source_path, r.destination_path, r.status]),
      ),
    )
    .digest("hex");
}

/** Az aktív szabályok, a bolt szerződésének alakjában. */
export interface RedirectSource {
  activeRedirects(): Promise<
    { sourcePath: string; destinationPath: string; httpStatus: number }[]
  >;
}

export type RedirectProjectionOutcome =
  | { status: "unchanged"; count: number; hash: string }
  | {
      status: "sent" | "would-send";
      count: number;
      hash: string;
      remoteCount: number;
      remoteHash: string;
    }
  | { status: "refused"; reason: string };

/**
 * EGY VETÍTÉS. Lánc esetén NEM küld: a bolt egy ugrást követ, és a commerce
 * validátora úgyis elutasítaná; a jelentés megnevezi az első láncszemet.
 */
export async function projectUrlRedirects(
  client: Pick<MedusaAdminClient, "fetchUrlRedirects" | "replaceUrlRedirects">,
  source: RedirectSource,
  apply: boolean,
): Promise<RedirectProjectionOutcome> {
  const sorok: MedusaUrlRedirect[] = (await source.activeRedirects()).map(
    (r) => ({
      source_path: r.sourcePath,
      destination_path: r.destinationPath,
      status: r.httpStatus,
    }),
  );
  const forrasok = new Set(sorok.map(kis));
  const lanc = sorok.find((r) =>
    forrasok.has(r.destination_path.toLowerCase()),
  );
  if (lanc)
    return {
      status: "refused",
      reason: `chain: ${lanc.source_path} -> ${lanc.destination_path}, which is itself a source`,
    };
  const hash = urlRedirectsHash(sorok);
  const bolt = await client.fetchUrlRedirects();
  if (bolt.hash === hash)
    return { status: "unchanged", count: sorok.length, hash };
  if (apply) await client.replaceUrlRedirects(sorok);
  return {
    status: apply ? "sent" : "would-send",
    count: sorok.length,
    hash,
    remoteCount: bolt.count,
    remoteHash: bolt.hash,
  };
}

export function describeRedirectProjection(
  outcome: RedirectProjectionOutcome,
): string {
  switch (outcome.status) {
    case "refused":
      return `Atiranyitasok: NEM KULDTEM, ${outcome.reason}`;
    case "unchanged":
      return `Atiranyitasok: valtozatlan (${outcome.count} szabaly)`;
    default:
      return (
        `Atiranyitasok: ${outcome.status === "sent" ? "ELKULDVE" : "kuldendo"} ` +
        `${outcome.count} szabaly (a bolt: ${outcome.remoteCount})`
      );
  }
}
