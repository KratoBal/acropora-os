import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ServiceDraftsService,
  requireDraftAdmin,
} from "./service-drafts.service.js";
import type { ServiceDraftsRepository } from "./service-drafts.repository.js";
import type { CapasuliGmailClient } from "./capasuli-gmail.client.js";
import type { ServiceJobsService } from "../service-jobs/service-jobs.service.js";
import type { NotificationsService } from "../notifications/notifications.service.js";
import type { AuthenticatedUser } from "@acropora/types";
import { CapasuliItemJevService } from "./capasuli-item-jev.service.js";
const admin: AuthenticatedUser = {
  id: "admin",
  email: "admin@example.test",
  displayName: "Admin",
  role: "ADMIN",
  customerId: null,
  supplierId: null,
};
describe("Draft review service authorization and notifications", () => {
  it("rejects managers, partners and partner-bound admin roles", () => {
    for (const u of [
      { ...admin, role: "MANAGER" as const },
      { ...admin, role: "PARTNER_SERVICE" as const, customerId: "customer" },
      { ...admin, customerId: "customer" },
    ])
      assert.throws(() => requireDraftAdmin(u));
    requireDraftAdmin(admin);
  });
  it("calls existing opened notifications only for a newly accepted job", async () => {
    let created = true,
      calls = 0;
    const repo = {
      decide: async () => ({
        serviceJobId: "job",
        created,
        title: "title",
        openedById: "capasuli",
      }),
    } as unknown as ServiceDraftsRepository;
    const jobs = {
      notifyAcceptedDraft: async (
        id: string,
        title: string,
        opener: string,
      ) => {
        assert.equal(id, "job");
        assert.equal(title, "title");
        assert.equal(opener, "capasuli");
        calls++;
      },
    } as unknown as ServiceJobsService;
    const s = new ServiceDraftsService(
      repo,
      {} as CapasuliGmailClient,
      jobs,
      {} as NotificationsService,
      new CapasuliItemJevService({}),
    );
    await s.decide("draft", admin, "accept", "dep");
    created = false;
    await s.decide("draft", admin, "accept", "dep");
    assert.equal(calls, 1);
  });
  it("never calls the repository for unauthorized review", async () => {
    let calls = 0;
    const s = new ServiceDraftsService(
      {
        decide: async () => {
          calls++;
        },
      } as unknown as ServiceDraftsRepository,
      {} as CapasuliGmailClient,
      {} as ServiceJobsService,
      {} as NotificationsService,
      new CapasuliItemJevService({}),
    );
    await assert.rejects(() =>
      s.decide("draft", { ...admin, role: "MANAGER" }, "accept", "dep"),
    );
    assert.equal(calls, 0);
  });
});

it("sends one review notification per new mail, not per item or rerun", async () => {
  const keys = [
    "GMAIL_CAPASULI_SYNC_ENABLED",
    "GMAIL_CAPASULI_CLIENT_ID",
    "GMAIL_CAPASULI_CLIENT_SECRET",
    "GMAIL_CAPASULI_REFRESH_TOKEN",
  ] as const;
  const previous = keys.map((k) => process.env[k]);
  keys.forEach(
    (k) => (process.env[k] = k.endsWith("ENABLED") ? "true" : "test"),
  );
  try {
    const seen = new Set<string>();
    const notices: unknown[] = [];
    type RepositoryMethods =
      "hasMessage" | "ingest" | "reviewer" | "markNotified";
    const repo: {
      [K in RepositoryMethods]: (
        ...args: Parameters<ServiceDraftsRepository[K]>
      ) => Promise<Awaited<ReturnType<ServiceDraftsRepository[K]>>>;
    } = {
      hasMessage: async (_s, _m, id) => (seen.has(id) ? { id } : null),
      ingest: async (message) => {
        seen.add(message.id);
        return { mailId: message.id, added: 2 };
      },
      reviewer: async () => ({ id: "admin" }),
      markNotified: async () =>
        ({}) as Awaited<ReturnType<ServiceDraftsRepository["markNotified"]>>,
    };
    const gmail: Pick<CapasuliGmailClient, "listMessageIds" | "getMessage"> = {
      listMessageIds: async () => ["mail", "malformed"],
      getMessage: async (id) => {
        if (id === "malformed")
          throw new Error("Private report text must never be logged");
        return {
          id,
          subject: "report",
          text: "",
          receivedAt: null,
          attachments: [],
        };
      },
    };
    const notification = {
      deliverServiceDraftsArrived: async (notice: unknown) => {
        notices.push(notice);
      },
    };
    const s = new ServiceDraftsService(
      repo as unknown as ServiceDraftsRepository,
      gmail as CapasuliGmailClient,
      {} as ServiceJobsService,
      notification as unknown as NotificationsService,
      new CapasuliItemJevService({}),
    );
    assert.deepEqual(await s.sync(), { added: 2, processed: 1 });
    assert.deepEqual(await s.sync(), { added: 0, processed: 0 });
    assert.equal(s.status(admin).lastError, "CAPASULI_SYNC_FAILED");
    assert.deepEqual(notices, [
      { mailId: "mail", userIds: ["admin"], count: 2 },
    ]);
  } finally {
    keys.forEach((k, i) => {
      if (previous[i] === undefined) delete process.env[k];
      else process.env[k] = previous[i];
    });
  }
});
