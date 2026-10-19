import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, it } from "node:test";

import {
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";

import type {
  ReefClubAccountRecord,
  ReefClubAccountRepository,
  ReefClubIdentityProvider,
} from "./reefclub-account.repository.js";
import {
  ReefClubExternalAuthService,
  reefClubProviderConfigs,
} from "./reefclub-external-auth.service.js";
import type { ReefClubSessionRepository } from "./reefclub-session.repository.js";

/**
 * The service's decisions on an external sign-in, with an in-memory account
 * store that keeps the repository's branch semantics (one external account per
 * ReefClub account and provider; the takeover only while unverified). The
 * tokens are real RS256 tokens checked by the production verifier; the
 * database guarantees (the unique indexes under a race) are the integration
 * spec's.
 */
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const JWK = { ...publicKey.export({ format: "jwk" }), kid: "k1" };
const keys = async (_c: unknown, kid: string) => (kid === "k1" ? JWK : null);
const configs = reefClubProviderConfigs({
  REEFCLUB_GOOGLE_CLIENT_IDS: "google-web, google-ios",
  REEFCLUB_APPLE_CLIENT_IDS: "hu.acropora.reefclub",
});

const NONCE = "apple-nonce-0123456789";

function idToken(
  provider: ReefClubIdentityProvider,
  claims: Record<string, unknown> = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const base =
    provider === "GOOGLE"
      ? { iss: "https://accounts.google.com", aud: "google-web" }
      : {
          iss: "https://appleid.apple.com",
          aud: "hu.acropora.reefclub",
          nonce: createHash("sha256").update(NONCE).digest("hex"),
        };
  const head = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "k1" }),
  ).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({
      ...base,
      sub: "kulso-1",
      email: "vevo@example.com",
      email_verified: true,
      iat: now,
      exp: now + 600,
      ...claims,
    }),
  ).toString("base64url");
  return `${head}.${body}.${sign("RSA-SHA256", Buffer.from(`${head}.${body}`), privateKey).toString("base64url")}`;
}

function store(initial: ReefClubAccountRecord[] = []) {
  const accounts = new Map(initial.map((a) => [a.id, { ...a }]));
  const identities: {
    accountId: string;
    provider: ReefClubIdentityProvider;
    subject: string;
  }[] = [];
  const takenOver: string[] = [];
  const repository = {
    accounts,
    identities,
    takenOver,
    async findByEmail(email: string) {
      return [...accounts.values()].find((a) => a.email === email) ?? null;
    },
    async findByIdentity(provider: ReefClubIdentityProvider, subject: string) {
      const row = identities.find(
        (i) => i.provider === provider && i.subject === subject,
      );
      return row ? (accounts.get(row.accountId) ?? null) : null;
    },
    async createExternal(input: {
      email: string;
      provider: ReefClubIdentityProvider;
      subject: string;
      consentVersion: string;
    }) {
      const id = `acc-${accounts.size + 1}`;
      accounts.set(id, {
        id,
        email: input.email,
        passwordHash: null,
        emailVerifiedAt: new Date(),
        notifyOnRelease: true,
        consentVersion: input.consentVersion,
      });
      identities.push({
        accountId: id,
        provider: input.provider,
        subject: input.subject,
      });
      return id;
    },
    async takeOverUnverified(input: {
      accountId: string;
      provider: ReefClubIdentityProvider;
      subject: string;
      consentVersion: string;
    }) {
      const account = accounts.get(input.accountId);
      if (!account || account.emailVerifiedAt) return false;
      Object.assign(account, {
        passwordHash: null,
        emailVerifiedAt: new Date(),
        consentVersion: input.consentVersion,
      });
      identities.push({
        accountId: input.accountId,
        provider: input.provider,
        subject: input.subject,
      });
      takenOver.push(input.accountId);
      return true;
    },
    async linkIdentity(input: {
      accountId: string;
      provider: ReefClubIdentityProvider;
      subject: string;
    }) {
      const owner = identities.find(
        (i) => i.provider === input.provider && i.subject === input.subject,
      );
      if (owner)
        return owner.accountId === input.accountId
          ? "LINKED"
          : "BOUND_ELSEWHERE";
      if (
        identities.some(
          (i) =>
            i.accountId === input.accountId && i.provider === input.provider,
        )
      )
        return "HAS_OTHER";
      identities.push(input);
      return "LINKED";
    },
  };
  return repository;
}

function service(accounts = store(), providerConfigs = configs) {
  const sessions: string[] = [];
  const svc = new ReefClubExternalAuthService(
    accounts as unknown as ReefClubAccountRepository,
    {
      async create(accountId: string) {
        sessions.push(accountId);
        return new Date(Date.now() + 1000);
      },
    } as unknown as ReefClubSessionRepository,
    keys,
    providerConfigs,
  );
  return { svc, accounts, sessions };
}

const account = (
  over: Partial<ReefClubAccountRecord> = {},
): ReefClubAccountRecord => ({
  id: "acc-letezo",
  email: "vevo@example.com",
  passwordHash: "scrypt$valami",
  emailVerifiedAt: new Date(),
  notifyOnRelease: true,
  consentVersion: "v1",
  ...over,
});

describe("ReefClub Google- és Apple-belépés", () => {
  it("első belépés szabad e-maillel: új, megerősített, jelszó nélküli fiók, kötött külső fiókkal", async () => {
    const { svc, accounts, sessions } = service();
    const session = await svc.signIn("GOOGLE", idToken("GOOGLE"), {
      consentVersion: "v2",
    });
    assert.ok(session.token);
    const [created] = [...accounts.accounts.values()];
    assert.equal(created!.email, "vevo@example.com");
    assert.equal(created!.passwordHash, null);
    assert.ok(created!.emailVerifiedAt);
    assert.deepEqual(accounts.identities, [
      { accountId: created!.id, provider: "GOOGLE", subject: "kulso-1" },
    ]);
    assert.deepEqual(sessions, [created!.id]);
  });

  it("kötött külső fiók: abba a fiókba lép be, akkor is, ha a token e-mailje más", async () => {
    const accounts = store([
      account({ id: "acc-1", email: "regi@example.com" }),
    ]);
    accounts.identities.push({
      accountId: "acc-1",
      provider: "GOOGLE",
      subject: "kulso-1",
    });
    const { svc, sessions } = service(accounts);
    await svc.signIn(
      "GOOGLE",
      idToken("GOOGLE", { email: "uj@example.com" }),
      {},
    );
    assert.deepEqual(sessions, ["acc-1"]);
  });

  it("párhuzamos első belépés, ami az első olvasás UTÁN véglegesül: belépés, nem 409 (mért verseny)", async () => {
    // The other sign-in of the same Google account commits right after this
    // one's first read, whichever read that is. Deterministic form of the race
    // the integration spec hit in 2 of 5 runs.
    const accounts = store();
    let committed = false;
    const commitOnce = () => {
      if (committed) return;
      committed = true;
      accounts.accounts.set(
        "acc-masik",
        account({ id: "acc-masik", passwordHash: null }),
      );
      accounts.identities.push({
        accountId: "acc-masik",
        provider: "GOOGLE",
        subject: "kulso-1",
      });
    };
    const findByEmail = accounts.findByEmail;
    const findByIdentity = accounts.findByIdentity;
    accounts.findByEmail = async (email: string) => {
      const result = await findByEmail(email);
      commitOnce();
      return result;
    };
    accounts.findByIdentity = async (
      provider: ReefClubIdentityProvider,
      subject: string,
    ) => {
      const result = await findByIdentity(provider, subject);
      commitOnce();
      return result;
    };
    const { svc, sessions } = service(accounts);
    await svc.signIn("GOOGLE", idToken("GOOGLE"), { consentVersion: "v2" });
    assert.deepEqual(sessions, ["acc-masik"]);
  });

  it("megerősített fiók ugyanazzal az e-maillel: 409, nincs összevonás, nincs munkamenet", async () => {
    const accounts = store([account()]);
    const { svc, sessions } = service(accounts);
    await assert.rejects(
      svc.signIn("GOOGLE", idToken("GOOGLE"), { consentVersion: "v2" }),
      ConflictException,
    );
    assert.deepEqual(accounts.identities, []);
    assert.deepEqual(sessions, []);
  });

  it("MEG NEM ERŐSÍTETT fiók ugyanazzal az e-maillel: a szolgáltató által igazolt tulajdonos átveszi", async () => {
    const accounts = store([
      account({ id: "acc-foglalo", emailVerifiedAt: null }),
    ]);
    const { svc, sessions } = service(accounts);
    await svc.signIn("GOOGLE", idToken("GOOGLE"), { consentVersion: "v2" });
    assert.deepEqual(accounts.takenOver, ["acc-foglalo"]);
    const taken = accounts.accounts.get("acc-foglalo")!;
    assert.equal(taken.passwordHash, null, "a foglaló jelszava törlődik");
    assert.equal(taken.consentVersion, "v2", "a hozzájárulás a tulajdonosé");
    assert.deepEqual(sessions, ["acc-foglalo"]);
  });

  it("nem megerősített e-mail a Google-nél: 422, semmi nem jön létre", async () => {
    const accounts = store([
      account({ id: "acc-foglalo", emailVerifiedAt: null }),
    ]);
    const { svc } = service(accounts);
    await assert.rejects(
      svc.signIn("GOOGLE", idToken("GOOGLE", { email_verified: false }), {
        consentVersion: "v2",
      }),
      UnprocessableEntityException,
    );
    assert.deepEqual(accounts.takenOver, []);
    assert.equal(accounts.identities.length, 0);
  });

  it("e-mail nélküli token ismeretlen külső fióknál: 422", async () => {
    const { svc } = service();
    await assert.rejects(
      svc.signIn("APPLE", idToken("APPLE", { email: undefined }), {
        nonce: NONCE,
        consentVersion: "v2",
      }),
      UnprocessableEntityException,
    );
  });

  it("új fiókhoz kell a hozzájárulás: nélküle 422, és nem jön létre fiók", async () => {
    const { svc, accounts } = service();
    await assert.rejects(
      svc.signIn("GOOGLE", idToken("GOOGLE"), {}),
      UnprocessableEntityException,
    );
    assert.equal(accounts.accounts.size, 0);
  });

  it("Apple: a nonce kötelező és egyeznie kell; a helyes nonce-szal belép", async () => {
    const { svc, sessions } = service();
    await assert.rejects(
      svc.signIn("APPLE", idToken("APPLE"), { consentVersion: "v2" }),
      UnauthorizedException,
    );
    await assert.rejects(
      svc.signIn("APPLE", idToken("APPLE"), {
        nonce: "masik-nonce-0123456789",
        consentVersion: "v2",
      }),
      UnauthorizedException,
    );
    assert.deepEqual(sessions, []);
    await svc.signIn("APPLE", idToken("APPLE"), {
      nonce: NONCE,
      consentVersion: "v2",
    });
    assert.equal(sessions.length, 1);
  });

  it("hibás token: 401, egy üzenettel; a Google-token az Apple úton sem megy át", async () => {
    const { svc } = service();
    await assert.rejects(
      svc.signIn("GOOGLE", idToken("GOOGLE", { aud: "masik" }), {
        consentVersion: "v2",
      }),
      UnauthorizedException,
    );
    await assert.rejects(
      svc.signIn("APPLE", idToken("GOOGLE"), {
        nonce: NONCE,
        consentVersion: "v2",
      }),
      UnauthorizedException,
    );
  });

  it("beállított ügyfél-azonosító nélkül a belépési mód ki van kapcsolva: 503", async () => {
    const { svc } = service(store(), reefClubProviderConfigs({}));
    await assert.rejects(
      svc.signIn("GOOGLE", idToken("GOOGLE"), { consentVersion: "v2" }),
      ServiceUnavailableException,
    );
  });
});

describe("ReefClub külső fiók hozzáadása", () => {
  it("a belépett fiókhoz köti; ugyanazt újra hozzáadni nem hiba", async () => {
    const accounts = store([account({ id: "acc-1" })]);
    const { svc } = service(accounts);
    await svc.link("acc-1", "GOOGLE", idToken("GOOGLE"), {});
    await svc.link("acc-1", "GOOGLE", idToken("GOOGLE"), {});
    assert.deepEqual(accounts.identities, [
      { accountId: "acc-1", provider: "GOOGLE", subject: "kulso-1" },
    ]);
  });

  it("másik fiókhoz kötött külső fiók: 409", async () => {
    const accounts = store([
      account({ id: "acc-1" }),
      account({ id: "acc-2", email: "mas@example.com" }),
    ]);
    accounts.identities.push({
      accountId: "acc-2",
      provider: "GOOGLE",
      subject: "kulso-1",
    });
    const { svc } = service(accounts);
    await assert.rejects(
      svc.link("acc-1", "GOOGLE", idToken("GOOGLE"), {}),
      ConflictException,
    );
  });

  it("szolgáltatónként egy: második, más Google-fiók 409", async () => {
    const accounts = store([account({ id: "acc-1" })]);
    accounts.identities.push({
      accountId: "acc-1",
      provider: "GOOGLE",
      subject: "kulso-masik",
    });
    const { svc } = service(accounts);
    await assert.rejects(
      svc.link("acc-1", "GOOGLE", idToken("GOOGLE"), {}),
      ConflictException,
    );
  });

  it("Apple hozzáadásánál is kötelező a nonce", async () => {
    const accounts = store([account({ id: "acc-1" })]);
    const { svc } = service(accounts);
    await assert.rejects(
      svc.link("acc-1", "APPLE", idToken("APPLE"), {}),
      UnauthorizedException,
    );
    await svc.link("acc-1", "APPLE", idToken("APPLE"), { nonce: NONCE });
    assert.equal(accounts.identities.length, 1);
  });
});
