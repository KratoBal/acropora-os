import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ForbiddenException, UnauthorizedException } from "@nestjs/common";

import { hashPassword } from "../users/password.util.js";
import type { OutgoingMail } from "../notifications/mail/mail.port.js";
import type {
  ReefClubAccountRecord,
  ReefClubAccountRepository,
} from "./reefclub-account.repository.js";
import { ReefClubAuthService } from "./reefclub-auth.service.js";
import type { ReefClubSessionRepository } from "./reefclub-session.repository.js";

const PASSWORD = "helyes jelszo 123";

/**
 * An in-memory account store with the repository's branch semantics:
 * replacing credentials only works while unverified. The database-level
 * guarantees (one-use tokens under concurrency, the unique e-mail) are the
 * integration spec's; this file measures the service's decisions.
 */
function fakeAccounts(initial: ReefClubAccountRecord[] = []) {
  const accounts = new Map(initial.map((a) => [a.email, { ...a }]));
  const calls: string[] = [];
  const repository = {
    accounts,
    calls,
    async findByEmail(email: string) {
      return accounts.get(email) ?? null;
    },
    async findById(id: string) {
      return [...accounts.values()].find((a) => a.id === id) ?? null;
    },
    async createUnverified(input: {
      email: string;
      passwordHash: string;
      consentVersion: string;
    }) {
      calls.push("create");
      const id = `acc-${accounts.size + 1}`;
      accounts.set(input.email, {
        id,
        email: input.email,
        passwordHash: input.passwordHash,
        emailVerifiedAt: null,
        notifyOnRelease: true,
        consentVersion: input.consentVersion,
      });
      return id;
    },
    async replaceUnverifiedCredentials(input: { accountId: string }) {
      calls.push("replace");
      const account = await repository.findById(input.accountId);
      return Boolean(account && !account.emailVerifiedAt);
    },
    async issuePasswordReset() {
      calls.push("reset");
    },
  };
  return repository;
}

function fakeSessions() {
  const created: string[] = [];
  return {
    created,
    async create(accountId: string) {
      created.push(accountId);
      return new Date(Date.now() + 1000);
    },
  };
}

function service(accounts = fakeAccounts()) {
  const sent: OutgoingMail[] = [];
  const sessions = fakeSessions();
  const svc = new ReefClubAuthService(
    accounts as unknown as ReefClubAccountRepository,
    sessions as unknown as ReefClubSessionRepository,
    {
      async send(mail) {
        sent.push(mail);
      },
    },
  );
  return { svc, sent, sessions, accounts };
}

async function verified(email: string): Promise<ReefClubAccountRecord> {
  return {
    id: "acc-v",
    email,
    passwordHash: await hashPassword(PASSWORD),
    emailVerifiedAt: new Date(),
    notifyOnRelease: true,
    consentVersion: "v1",
  };
}

describe("ReefClubAuthService: regisztráció", () => {
  it("új címre fiókot nyit és megerősítő levelet küld, kisbetűsített címmel", async () => {
    const { svc, sent, accounts } = service();
    svc.register("  Uj@Pelda.HU ", PASSWORD, "v1");
    await svc.settled();
    assert.deepEqual(accounts.calls, ["create"]);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0]!.to, ["uj@pelda.hu"]);
    assert.match(sent[0]!.text, /email-megerosites#token=/);
  });

  it("megerősített fióknál semmit nem módosít, a levél mást mond", async () => {
    const { svc, sent, accounts } = service(
      fakeAccounts([await verified("van@pelda.hu")]),
    );
    svc.register("van@pelda.hu", "masik jelszo 456", "v2");
    await svc.settled();
    assert.deepEqual(accounts.calls, []);
    assert.equal(sent.length, 1);
    assert.doesNotMatch(sent[0]!.text, /token=/);
    assert.match(sent[0]!.text, /már van ReefClub-fiók/);
  });

  it("megerősítetlen fióknál a hitelesítő adatot cseréli és új linket küld", async () => {
    const account = {
      ...(await verified("felig@pelda.hu")),
      emailVerifiedAt: null,
    };
    const { svc, sent, accounts } = service(fakeAccounts([account]));
    svc.register("felig@pelda.hu", PASSWORD, "v1");
    await svc.settled();
    assert.deepEqual(accounts.calls, ["replace"]);
    assert.match(sent[0]!.text, /email-megerosites#token=/);
  });

  it("a válasz előtt nem vár a háttérmunkára (a válaszidő nem árulja el a fiókot)", () => {
    const { svc, sent } = service();
    svc.register("gyors@pelda.hu", PASSWORD, "v1");
    // Synchronously after the call nothing has been sent yet: the work runs
    // after the controller has answered.
    assert.equal(sent.length, 0);
  });

  it("ismeretlen címre jelszó-visszaállítást nem küld, ismertre igen", async () => {
    const { svc, sent, accounts } = service(
      fakeAccounts([await verified("van@pelda.hu")]),
    );
    svc.requestPasswordReset("nincs@pelda.hu");
    svc.requestPasswordReset("VAN@pelda.hu");
    await svc.settled();
    assert.deepEqual(accounts.calls, ["reset"]);
    assert.equal(sent.length, 1);
    assert.match(sent[0]!.text, /jelszo-visszaallitas#token=/);
  });

  it("a levélküldés hibája nem dobódik tovább", async () => {
    const accounts = fakeAccounts();
    const svc = new ReefClubAuthService(
      accounts as unknown as ReefClubAccountRepository,
      fakeSessions() as unknown as ReefClubSessionRepository,
      {
        async send() {
          throw new Error("TICKET_MAIL_NOT_CONFIGURED");
        },
      },
    );
    svc.register("hiba@pelda.hu", PASSWORD, "v1");
    await svc.settled();
    assert.deepEqual(accounts.calls, ["create"]);
  });
});

describe("ReefClubAuthService: belépés", () => {
  it("ismeretlen cím és rossz jelszó ugyanazt a 401-et adja", async () => {
    const { svc } = service(fakeAccounts([await verified("van@pelda.hu")]));
    const unknown = await svc.login("nincs@pelda.hu", PASSWORD).catch((e) => e);
    const wrong = await svc
      .login("van@pelda.hu", "rossz jelszo")
      .catch((e) => e);
    assert.ok(unknown instanceof UnauthorizedException);
    assert.ok(wrong instanceof UnauthorizedException);
    assert.equal(unknown.message, wrong.message);
  });

  it("megerősítetlen e-maillel nem lép be (helyes jelszóval sem)", async () => {
    const account = {
      ...(await verified("felig@pelda.hu")),
      emailVerifiedAt: null,
    };
    const { svc, sessions } = service(fakeAccounts([account]));
    await assert.rejects(
      svc.login("felig@pelda.hu", PASSWORD),
      ForbiddenException,
    );
    assert.deepEqual(sessions.created, []);
  });

  it("megerősített fiókkal munkamenetet nyit", async () => {
    const { svc, sessions } = service(
      fakeAccounts([await verified("van@pelda.hu")]),
    );
    const session = await svc.login(" VAN@pelda.hu", PASSWORD);
    assert.ok(session.token.length > 30);
    assert.deepEqual(sessions.created, ["acc-v"]);
  });

  it("jelszó nélküli fiók (csak külső belépés) jelszóval nem léphet be", async () => {
    const account = {
      ...(await verified("kulso@pelda.hu")),
      passwordHash: null,
    };
    const { svc } = service(fakeAccounts([account]));
    await assert.rejects(
      svc.login("kulso@pelda.hu", PASSWORD),
      UnauthorizedException,
    );
  });
});
