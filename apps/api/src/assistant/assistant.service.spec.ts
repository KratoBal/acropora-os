import assert from "node:assert/strict";
import { afterEach, it, mock } from "node:test";
import type { AuthenticatedUser, Session } from "@acropora/types";
import { AssistantService } from "./assistant.service.js";
import type { AuthService } from "../auth/auth.service.js";
import type { SessionRepository } from "../auth/session.repository.js";
import type { AssistantBudgetRepository } from "./assistant-budget.repository.js";
const user: AuthenticatedUser = {
  id: "pilot",
  displayName: "Dolgozó",
  email: "pilot@example.invalid",
  role: "SERVICE",
  customerId: null,
  supplierId: null,
};
const savedEnv = { ...process.env };
afterEach(() => {
  mock.restoreAll();
  for (const name of Object.keys(process.env))
    if (!(name in savedEnv)) delete process.env[name];
  Object.assign(process.env, savedEnv);
});
function fixture() {
  Object.assign(process.env, {
    SUTYERAK_ENABLED: "true",
    SUTYERAK_PILOT_USER_IDS: "pilot",
    SUTYERAK_GATEWAY_URL: "http://gateway.invalid",
    SUTYERAK_GATEWAY_SECRET: "test-secret",
  });
  const forwarded: string[] = [];
  let expiry = Date.now() + 600_000;
  let revoked = false;
  let issued = 0;
  mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    forwarded.push(JSON.parse(String(init.body)).token);
    return new Response();
  });
  const service = new AssistantService(
    {
      issueAssistantSession: async () => {
        const serial = ++issued;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return {
          id: String(serial),
          user,
          token: `token-${serial}`,
          expiresAt: new Date(expiry).toISOString(),
        } satisfies Session;
      },
    } as unknown as AuthService,
    {
      findAssistant: async () =>
        revoked ? null : { expiresAt: new Date(expiry) },
    } as unknown as SessionRepository,
    { consume: async () => {} } as unknown as AssistantBudgetRepository,
  );
  return {
    service,
    forwarded,
    issued: () => issued,
    expireSoon: () => {
      expiry = Date.now() + 59_000;
    },
    revoke: () => {
      revoked = true;
    },
  };
}
const input = { question: "Kérdés", context: { page: "/" } };
it("parallel questions share one pending token issuance", async () => {
  const f = fixture();
  await Promise.all(
    Array.from({ length: 5 }, () =>
      f.service.ask(user, "USER", input, new AbortController().signal),
    ),
  );
  assert.equal(f.issued(), 1);
  assert.deepEqual(f.forwarded, Array(5).fill("token-1"));
});
it("renews a cached token when the stored expiry is within one minute", async () => {
  const f = fixture();
  await f.service.ask(user, "USER", input, new AbortController().signal);
  f.expireSoon();
  await f.service.ask(user, "USER", input, new AbortController().signal);
  assert.equal(f.issued(), 2);
  assert.deepEqual(f.forwarded, ["token-1", "token-2"]);
});
it("does not reuse a revoked assistant session", async () => {
  const f = fixture();
  await f.service.ask(user, "USER", input, new AbortController().signal);
  f.revoke();
  await f.service.ask(user, "USER", input, new AbortController().signal);
  assert.equal(f.issued(), 2);
});
