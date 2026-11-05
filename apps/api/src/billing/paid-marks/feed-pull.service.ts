import { Injectable, Logger } from "@nestjs/common";

import {
  pullFromSzamlazz,
  type FeedPullDeps,
  type FeedPullLine,
} from "../feed-pull.js";
import { HttpSzamlazzAgentClient } from "../../integrations/szamlazz/szamlazz-agent.client.js";
import { SzamlazzCredentialProvider } from "../../integrations/szamlazz/szamlazz-credential.provider.js";
import { SzamlazzFeedsRepository } from "../../missing-invoices/szamlazz-feeds.repository.js";
import { SzamlazzFeedsService } from "../../missing-invoices/szamlazz-feeds.service.js";

/**
 * A FEEDBŐL HIÁNYZÓ SZÁMLA BEHÚZÁSA A NAPI JELÖLÉS LAPJÁRÓL (acrobot 43506: élesen nincs shell, a gomb indítja). A
 * szabály és a lekérdező modul alóli kivétel: `feed-pull.ts`. Ez csak a függőségeket köti be, és naplózza, KI kérte és
 * MI LETT (a számok és a kimenetek; a válasz XML-je nem).
 */
@Injectable()
export class FeedPullService {
  private readonly logger = new Logger(FeedPullService.name);

  /** a teszt cseréli; élesen a `live()` köti be (konstruktor-paraméterként a Nest DI feloldaná, és elbukna) */
  deps: FeedPullDeps | null = null;

  constructor(private readonly credentials: SzamlazzCredentialProvider) {}

  async pull(
    numbers: readonly string[],
    apply: boolean,
    userId: string,
  ): Promise<FeedPullLine[]> {
    const lines = await pullFromSzamlazz(
      numbers,
      apply,
      this.deps ?? this.live(),
    );
    this.logger.log(
      `feed-pull ${apply ? "BEHÚZÁS" : "száraz"} (user ${userId}): ${lines
        .map((line) => `${line.number} ${line.outcome}`)
        .join(", ")}`,
    );
    return lines;
  }

  private live(): FeedPullDeps {
    const repository = new SzamlazzFeedsRepository();
    const feeds = new SzamlazzFeedsService(repository, {});
    return {
      agentKey: async () => (await this.credentials.resolve()).agentKey,
      client: new HttpSzamlazzAgentClient(),
      store: (input) => repository.storeRaw({ kind: "SZAMLAKI", ...input }),
      project: (externalId, sha256, body) =>
        feeds.intoBilling(externalId, sha256, body),
    };
  }
}
