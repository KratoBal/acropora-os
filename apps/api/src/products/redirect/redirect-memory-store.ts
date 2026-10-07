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
}
