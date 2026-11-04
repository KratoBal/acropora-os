import { Injectable, Optional } from "@nestjs/common";
import { prisma } from "@acropora/database";

import {
  medusaClientFromEnvironment,
  type MedusaAdminClient,
} from "../../integrations/medusa/medusa-admin.client.js";
import { MedusaCredentialProvider } from "../../integrations/medusa/medusa-credential.provider.js";
import {
  COMPLAINT_SOURCE,
  pullProblemReports,
  type ProblemPullReport,
} from "./webshop-problem-report-pull.js";

/** The Medusa and database side of the problem report pull (V1.2); the decision is in `webshop-problem-report-pull.ts`. */
@Injectable()
export class WebshopProblemReportPullService {
  constructor(
    private readonly credentials: MedusaCredentialProvider,
    @Optional()
    private readonly clientFactory: (
      apiKey: string,
    ) => MedusaAdminClient = medusaClientFromEnvironment,
  ) {}

  async run(env: NodeJS.ProcessEnv = process.env): Promise<ProblemPullReport> {
    const client = this.clientFactory(
      (await this.credentials.resolve()).apiKey,
    );
    return pullProblemReports(
      {
        list: (limit) => client.listProblemReports("new", limit),
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
        markPulled: (id) => client.markProblemReportPulled(id),
      },
      env,
    );
  }
}
