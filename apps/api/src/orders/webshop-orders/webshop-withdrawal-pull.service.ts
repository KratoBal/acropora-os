import { Injectable, Optional } from "@nestjs/common";
import { prisma } from "@acropora/database";

import {
  medusaClientFromEnvironment,
  type MedusaAdminClient,
} from "../../integrations/medusa/medusa-admin.client.js";
import { MedusaCredentialProvider } from "../../integrations/medusa/medusa-credential.provider.js";
import { COMPLAINT_SOURCE } from "./webshop-problem-report-pull.js";
import {
  pullWithdrawals,
  type WithdrawalPullReport,
} from "./webshop-withdrawal-pull.js";

/** The Medusa and database side of the withdrawal pull (V0.3); the decision is in `webshop-withdrawal-pull.ts`. */
@Injectable()
export class WebshopWithdrawalPullService {
  constructor(
    private readonly credentials: MedusaCredentialProvider,
    @Optional()
    private readonly clientFactory: (
      apiKey: string,
    ) => MedusaAdminClient = medusaClientFromEnvironment,
  ) {}

  async run(
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<WithdrawalPullReport> {
    const client = this.clientFactory(
      (await this.credentials.resolve()).apiKey,
    );
    return pullWithdrawals(
      {
        list: (limit) => client.listWithdrawals("new", limit),
        order: (id) => client.order(id),
        assigneeActive: async (id) =>
          (await prisma.user.count({ where: { id, isActive: true } })) > 0,
        createTask: async (data) => {
          const result = await prisma.task.createMany({
            data: [
              {
                title: data.title,
                description: data.description,
                linkUrl: data.linkUrl,
                source: COMPLAINT_SOURCE,
                sourceRef: data.sourceRef,
                assigneeId: data.assigneeId,
              },
            ],
            skipDuplicates: true,
          });
          return result.count > 0 ? "created" : "exists";
        },
        markPulled: (id) => client.markWithdrawalPulled(id),
      },
      env,
    );
  }
}
