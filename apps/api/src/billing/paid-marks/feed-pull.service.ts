import { Injectable, Logger } from "@nestjs/common";

import { prisma } from "@acropora/database";

import {
  diagnoseQueryFailure,
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

  /** A kontroll bukásának diagnosztikája (csak olvas): lásd `diagnoseQueryFailure`. A hiba itt sem állítja meg a kört. */
  async diagnose(number: string): Promise<string[]> {
    try {
      return await diagnoseQueryFailure(number, this.deps ?? this.live());
    } catch (error) {
      return [
        `a diagnosztika nem futott le (${error instanceof Error ? error.name : "UNKNOWN"})`,
      ];
    }
  }

  private live(): FeedPullDeps {
    const repository = new SzamlazzFeedsRepository();
    const feeds = new SzamlazzFeedsService(repository, {});
    const client = new HttpSzamlazzAgentClient();
    return {
      agentKey: async () => (await this.credentials.resolve()).agentKey,
      client,
      pdf: client,
      // az OS által, ügynökkel kiállított legutóbbi kimenő számla száma (a PDF-lekérés ezeken élesben működik)
      ownIssuedNumber: async () =>
        (
          await prisma.invoice.findFirst({
            where: {
              direction: "OUTBOUND",
              source: "SZAMLAZZ",
              invoiceNumber: { not: null },
              status: "ISSUED",
            },
            orderBy: { createdAt: "desc" },
            select: { invoiceNumber: true },
          })
        )?.invoiceNumber ?? null,
      store: (input) => repository.storeRaw({ kind: "SZAMLAKI", ...input }),
      project: (externalId, sha256, body) =>
        feeds.intoBilling(externalId, sha256, body),
    };
  }
}
