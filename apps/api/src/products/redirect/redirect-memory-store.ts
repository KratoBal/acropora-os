import { redirectPathLower } from "./redirect-path.js";
import type {
  RedirectRule,
  RedirectRuleData,
  RedirectStore,
} from "./redirect-writer.js";

type Sor = RedirectRule & Partial<RedirectRuleData>;

/**
 * MEMÓRIABELI TÁROLÓ, NAPLÓVAL. A backfill ezen fut le először (a szárazfutás
 * ugyanaz a kód, mint az írás), és a naplóból írja ki a változásokat `--apply`
 * mellett; a tesztek is ezt használják.
 *
 * A napló a VÉGÁLLAPOT: egy új szabály későbbi módosítása az új sorba olvad, tehát
 * minden azonosító egyszer szerepel benne.
 */
export class MemoryRedirectStore implements RedirectStore {
  private readonly sorok = new Map<string, Sor>();
  private readonly ujak = new Set<string>();
  private readonly modositottak = new Map<
    string,
    Partial<Omit<RedirectRuleData, "sourcePath" | "sourcePathLower">>
  >();
  /** A meglévő szabály ÁLLAPOTA az első módosítás előtt: a visszavonás ebből tudja, mi volt a régi cél. */
  private readonly elozo = new Map<string, Sor>();
  private szamlalo = 0;

  constructor(meglevo: readonly RedirectRule[] = []) {
    for (const sor of meglevo) this.sorok.set(sor.id, { ...sor });
  }

  async findBySourceLower(sourceLower: string): Promise<RedirectRule | null> {
    for (const sor of this.sorok.values())
      if (redirectPathLower(sor.sourcePath) === sourceLower) return { ...sor };
    return null;
  }

  async findActiveByDestinationLower(
    destinationLower: string,
  ): Promise<RedirectRule[]> {
    return [...this.sorok.values()]
      .filter(
        (sor) =>
          sor.isActive &&
          redirectPathLower(sor.destinationPath) === destinationLower,
      )
      .map((sor) => ({ ...sor }));
  }

  async create(data: RedirectRuleData): Promise<RedirectRule> {
    const id = `uj-${++this.szamlalo}`;
    this.sorok.set(id, { id, ...data });
    this.ujak.add(id);
    return { id, ...data };
  }

  async update(
    id: string,
    data: Partial<Omit<RedirectRuleData, "sourcePath" | "sourcePathLower">>,
  ): Promise<void> {
    const sor = this.sorok.get(id);
    if (!sor) throw new Error(`no redirect ${id}`);
    if (!this.ujak.has(id) && !this.elozo.has(id))
      this.elozo.set(id, { ...sor });
    Object.assign(sor, data);
    if (!this.ujak.has(id))
      this.modositottak.set(id, { ...this.modositottak.get(id), ...data });
  }

  async listActive(): Promise<RedirectRule[]> {
    return [...this.sorok.values()]
      .filter((sor) => sor.isActive)
      .map((sor) => ({ ...sor }));
  }

  /** Az új szabályok, a végállapotukkal. */
  created(): RedirectRuleData[] {
    return [...this.ujak].map((id) => {
      const { id: _id, ...adat } = this.sorok.get(id)!;
      return adat as RedirectRuleData;
    });
  }

  /** A meglévő szabályok módosításai. */
  updated(): {
    id: string;
    data: Partial<Omit<RedirectRuleData, "sourcePath" | "sourcePathLower">>;
  }[] {
    return [...this.modositottak].map(([id, data]) => ({ id, data }));
  }

  /**
   * A VISSZAVONÁS NYILVÁNTARTÁSA (card f6cb0a51, az éles lánc előtt): minden változás, a régi állapottal együtt.
   * Az új szabály forrással és céllal áll (a `createMany` nem ad azonosítót, a forrás egyedi); a módosítotté
   * a régi (`from`) és az új (`to`) érték, CSAK azokon a mezőkön, amelyeket a terv módosít. A `from` hiányzó értéke `null`.
   * NEM része a terv lenyomatának: a nyilvántartás a tervet nem változtatja.
   */
  changes(): RedirectBatchChanges {
    return {
      created: this.created().map((r) => ({
        source: r.sourcePath,
        destination: r.destinationPath,
      })),
      updated: [...this.modositottak].map(([id, to]) => {
        const regi = this.elozo.get(id)!;
        const from: Record<string, unknown> = {};
        for (const kulcs of Object.keys(to))
          // a betöltött sor nem hordozza a kisbetűs cél-kulcsot: a régi célból számolódik, ahogy az író is számolja
          from[kulcs] =
            kulcs === "destinationPathLower"
              ? redirectPathLower(regi.destinationPath)
              : ((regi as unknown as Record<string, unknown>)[kulcs] ?? null);
        return {
          id,
          source: regi.sourcePath,
          from,
          to: to as Record<string, unknown>,
        };
      }),
    };
  }
}

/** Egy írási köteg változásai, ahogy az AuditLog tárolja (`metadata.changes`). */
export interface RedirectBatchChanges {
  created: { source: string; destination: string }[];
  updated: {
    id: string;
    source: string;
    from: Record<string, unknown>;
    to: Record<string, unknown>;
  }[];
}
