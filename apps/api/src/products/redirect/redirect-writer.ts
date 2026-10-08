import type { RedirectReason, SlugEntityType } from "@acropora/database";

import {
  isOwnPath,
  normalizeRedirectPath,
  redirectPathLower,
} from "./redirect-path.js";

/** Egy átirányítás, amennyit az író olvas. `UrlRedirect`. */
export interface RedirectRule {
  id: string;
  sourcePath: string;
  destinationPath: string;
  isActive: boolean;
}

export interface RedirectRuleData {
  sourcePath: string;
  sourcePathLower: string;
  destinationPath: string;
  destinationPathLower: string;
  reason: RedirectReason;
  entityType: SlugEntityType | null;
  entityId: string | null;
  isActive: boolean;
  createdById: string | null;
}

/**
 * Az átirányítások tárolása; a Prisma-változat a `redirect.repository.ts`-ben (egy
 * tranzakción), a memóriabeli a `redirect-memory-store.ts`-ben (a backfill
 * szárazfutása és a tesztek).
 */
export interface RedirectStore {
  /** A szabály a kisbetűs forrás-kulcson, aktív vagy nem. */
  findBySourceLower(sourceLower: string): Promise<RedirectRule | null>;
  /** Az AKTÍV szabályok, amelyek célja kisbetűsen PONTOSAN ez az út. */
  findActiveByDestinationLower(
    destinationLower: string,
  ): Promise<RedirectRule[]>;
  create(data: RedirectRuleData): Promise<RedirectRule>;
  update(
    id: string,
    data: Partial<Omit<RedirectRuleData, "sourcePath" | "sourcePathLower">>,
  ): Promise<void>;
  /** Minden aktív szabály: az invariáns-ellenőrzéshez. */
  listActive(): Promise<RedirectRule[]>;
}

export type RedirectErrorKind =
  | "invalid-path"
  | "foreign-destination"
  | "self-redirect"
  | "cycle"
  | "case-collision";

/** Egy szabály, ami nem írható; a `kind` mondja meg, miért. */
export class RedirectError extends Error {
  constructor(
    readonly kind: RedirectErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export interface WriteRedirectInput {
  source: string;
  destination: string;
  reason: RedirectReason;
  entityType?: SlugEntityType | null;
  entityId?: string | null;
  createdById?: string | null;
  /**
   * Ha a forráson MÁS célú aktív szabály áll: `keep` (a backfill, a kézi írás
   * alapból) a jelentésbe adja, felülírás nélkül; `replace` (a slug-csere)
   * felülírja.
   */
  onExisting: "keep" | "replace";
  /**
   * A cél ÉLŐ oldal (a slug-csere új slugja): a rajta álló szabály megszűnik. Így a
   * termék a SAJÁT régi slugját visszakaphatja (A→B után B→A), kör nélkül.
   */
  destinationIsLive?: boolean;
}

export type WriteRedirectResult =
  | { status: "created" | "updated" | "reactivated"; repointed: number }
  | { status: "unchanged"; repointed: 0 }
  | { status: "conflict"; repointed: 0; existingDestination: string };

const LANC_HATAR = 16;

/**
 * EGY SZABÁLY ÍRÁSA, A LÁNC ÉS A KÖR SZABÁLYÁVAL (C5), egy tárolón (tranzakción).
 *
 * - Új A → B: ha B maga forrás (B → C), az új szabály célja C.
 * - Minden X → A szabály célja a végső célra íródik át.
 * - Kör (A → … → A) és A → A: elutasítás.
 *
 * Az invariáns: egyetlen aktív szabály célja sem forrás (`redirectInvariantViolations`).
 */
export async function writeRedirect(
  store: RedirectStore,
  input: WriteRedirectInput,
): Promise<WriteRedirectResult> {
  const forras = normalizeRedirectPath(input.source);
  const cel = normalizeRedirectPath(input.destination);
  if (!forras || !cel)
    throw new RedirectError(
      "invalid-path",
      `not a path: "${forras ? input.destination : input.source}"`,
    );
  /*
    A CÉL CSAK SAJÁT ÚT LEHET (barracuda, #1597 1.). A kiszolgálás (PR 7) a célt
    `Location`-ként adja ki, és a böngésző a `//idegen.hu/x`-et és a
    `/\idegen.hu/x`-et idegen címnek veszi: nyitott átirányítás lenne a bolt
    címéről. A `/%2F%2Fidegen.hu` dekódolva ugyanez. Egy sémás teljes URL sem cél:
    a domainje csendben elveszne, ezért inkább elutasítva.
  */
  if (/^[a-z][a-z0-9+.-]*:/i.test(input.destination.trim()) || !isOwnPath(cel))
    throw new RedirectError(
      "foreign-destination",
      `the destination must be a path of this shop: "${input.destination}"`,
    );
  const forrasKis = redirectPathLower(forras);
  if (forrasKis === redirectPathLower(cel))
    throw new RedirectError("self-redirect", `${forras} points to itself`);

  // minden ellenőrzés az első írás előtt: a szárazfutás tárolója nem görget vissza
  const meglevo = await store.findBySourceLower(forrasKis);
  if (meglevo && meglevo.sourcePath !== forras)
    throw new RedirectError(
      "case-collision",
      `${forras} differs only in case from the existing source ${meglevo.sourcePath}`,
    );
  let vegso = cel;
  if (input.destinationIsLive) {
    const celen = await store.findBySourceLower(redirectPathLower(cel));
    if (celen?.isActive) await store.update(celen.id, { isActive: false });
  } else {
    const lanc = [forras, cel];
    for (let lepes = 0; ; lepes++) {
      const kovetkezo = await store.findBySourceLower(redirectPathLower(vegso));
      if (!kovetkezo?.isActive) break;
      vegso = kovetkezo.destinationPath;
      lanc.push(vegso);
      if (redirectPathLower(vegso) === forrasKis || lepes >= LANC_HATAR)
        throw new RedirectError("cycle", `cycle: ${lanc.join(" -> ")}`);
    }
  }

  const adat = {
    destinationPath: vegso,
    destinationPathLower: redirectPathLower(vegso),
    reason: input.reason,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    isActive: true,
    createdById: input.createdById ?? null,
  };
  let status: "created" | "updated" | "reactivated";
  if (meglevo?.isActive) {
    if (redirectPathLower(meglevo.destinationPath) === redirectPathLower(vegso))
      return { status: "unchanged", repointed: 0 };
    if (input.onExisting === "keep")
      return {
        status: "conflict",
        repointed: 0,
        existingDestination: meglevo.destinationPath,
      };
    await store.update(meglevo.id, adat);
    status = "updated";
  } else if (meglevo) {
    await store.update(meglevo.id, adat);
    status = "reactivated";
  } else {
    await store.create({
      sourcePath: forras,
      sourcePathLower: forrasKis,
      ...adat,
    });
    status = "created";
  }

  const raMutat = await store.findActiveByDestinationLower(forrasKis);
  for (const szabaly of raMutat)
    await store.update(szabaly.id, {
      destinationPath: vegso,
      destinationPathLower: redirectPathLower(vegso),
    });
  return { status, repointed: raMutat.length };
}

/**
 * AZ INVARIÁNS: az aktív szabályok, amelyek célja egy másik aktív szabály forrása
 * (lánc). Üres listát kell adnia minden írás után.
 */
export async function redirectInvariantViolations(
  store: RedirectStore,
): Promise<RedirectRule[]> {
  const aktiv = await store.listActive();
  const forrasok = new Set(aktiv.map((r) => redirectPathLower(r.sourcePath)));
  return aktiv.filter((r) =>
    forrasok.has(redirectPathLower(r.destinationPath)),
  );
}
