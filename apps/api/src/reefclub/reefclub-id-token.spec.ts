import assert from "node:assert/strict";
import { createHash, createHmac, generateKeyPairSync, sign } from "node:crypto";
import { describe, it } from "node:test";

import {
  appleNonceMatches,
  emailIsAuthoritative,
  GOOGLE_ISSUERS,
  ID_TOKEN_MAX_LENGTH,
  type ReefClubIdTokenFailure,
  ReefClubIdTokenError,
  type ReefClubProviderConfig,
  verifyIdToken,
} from "./reefclub-id-token.js";

/**
 * The ID-token check, branch by branch. Each refusal is measured against a
 * token that is valid in every other respect, so a red case names the one
 * check it is about (a token wrong in two ways would pass a broken check).
 */
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "teszt-kulcs-1";
const JWK = {
  ...publicKey.export({ format: "jwk" }),
  kid: KID,
  alg: "RS256",
  use: "sig",
};

const CONFIG: ReefClubProviderConfig = {
  provider: "GOOGLE",
  issuers: GOOGLE_ISSUERS,
  audiences: ["web-kliens.apps.googleusercontent.com", "ios-kliens"],
  jwksUrl: "https://teszt.invalid/keys",
};

const NOW = new Date("2026-10-19T18:00:00Z");
const NOW_S = Math.floor(NOW.getTime() / 1000);

const b64 = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

function token(
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
  key = privateKey,
): string {
  const head = b64({ alg: "RS256", kid: KID, typ: "JWT", ...header });
  const body = b64({
    iss: "https://accounts.google.com",
    aud: "web-kliens.apps.googleusercontent.com",
    sub: "1100220033",
    email: "Vevo@Example.COM ",
    email_verified: true,
    iat: NOW_S - 10,
    exp: NOW_S + 3600,
    ...claims,
  });
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${head}.${body}`),
    key,
  ).toString("base64url");
  return `${head}.${body}.${signature}`;
}

const keys = async (_config: ReefClubProviderConfig, kid: string) =>
  kid === KID ? JWK : null;

async function refused(
  raw: string,
  failure: ReefClubIdTokenFailure,
  config = CONFIG,
) {
  await assert.rejects(
    verifyIdToken(raw, config, keys, NOW),
    (error: unknown) =>
      error instanceof ReefClubIdTokenError && error.failure === failure,
    `várt: ${failure}`,
  );
}

describe("ReefClub ID-token ellenőrzés", () => {
  it("egy érvényes token átmegy, az e-mail kisbetűs és levágott", async () => {
    const claims = await verifyIdToken(token(), CONFIG, keys, NOW);
    assert.deepEqual(claims, {
      provider: "GOOGLE",
      subject: "1100220033",
      email: "vevo@example.com",
      emailVerified: true,
      hostedDomain: null,
      nonce: null,
      issuedAt: NOW_S - 10,
    });
  });

  it("a második közönség-azonosító és a tömb alakú aud is a miénk", async () => {
    assert.equal(
      (await verifyIdToken(token({ aud: "ios-kliens" }), CONFIG, keys, NOW))
        .subject,
      "1100220033",
    );
    assert.equal(
      (
        await verifyIdToken(
          token({ aud: ["mas", "ios-kliens"] }),
          CONFIG,
          keys,
          NOW,
        )
      ).subject,
      "1100220033",
    );
  });

  it('az email_verified szöveges "true" is megerősített, minden más nem', async () => {
    assert.equal(
      (
        await verifyIdToken(
          token({ email_verified: "true" }),
          CONFIG,
          keys,
          NOW,
        )
      ).emailVerified,
      true,
    );
    assert.equal(
      (await verifyIdToken(token({ email_verified: false }), CONFIG, keys, NOW))
        .emailVerified,
      false,
    );
    assert.equal(
      (
        await verifyIdToken(
          token({ email_verified: undefined }),
          CONFIG,
          keys,
          NOW,
        )
      ).emailVerified,
      false,
    );
  });

  it("a token nem választhat algoritmust: none és HS256 elutasítva", async () => {
    const [, body] = token().split(".");
    await refused(`${b64({ alg: "none", kid: KID })}.${body}.`, "ALGORITHM");
    // HS256 with the PUBLIC key as the secret: the classic confusion
    const head = b64({ alg: "HS256", kid: KID });
    const mac = createHmac(
      "sha256",
      publicKey.export({ format: "pem", type: "spki" }),
    )
      .update(`${head}.${body}`)
      .digest("base64url");
    await refused(`${head}.${body}.${mac}`, "ALGORITHM");
  });

  it("ismeretlen vagy hiányzó kid: UNKNOWN_KEY", async () => {
    await refused(token({}, { kid: "nincs-ilyen" }), "UNKNOWN_KEY");
    await refused(token({}, { kid: undefined }), "UNKNOWN_KEY");
  });

  it("más kulccsal aláírt vagy utólag átírt token: SIGNATURE", async () => {
    await refused(token({}, {}, other.privateKey), "SIGNATURE");
    const [head, , sig] = token().split(".");
    await refused(
      `${head}.${b64({ iss: "https://accounts.google.com", aud: CONFIG.audiences[0], sub: "masvalaki", iat: NOW_S, exp: NOW_S + 3600 })}.${sig}`,
      "SIGNATURE",
    );
  });

  it("idegen kibocsátó: ISSUER", async () => {
    await refused(token({ iss: "https://appleid.apple.com" }), "ISSUER");
    await refused(token({ iss: undefined }), "ISSUER");
  });

  it("más ügyfélnek szóló token, vagy üres saját lista: AUDIENCE", async () => {
    await refused(token({ aud: "masik-alkalmazas" }), "AUDIENCE");
    await refused(token({ aud: undefined }), "AUDIENCE");
    await refused(token(), "AUDIENCE", { ...CONFIG, audiences: [] });
  });

  it("lejárt token a türés után: EXPIRED; a türésen belül még él", async () => {
    await refused(token({ exp: NOW_S - 61 }), "EXPIRED");
    await refused(token({ exp: undefined }), "EXPIRED");
    assert.ok(
      await verifyIdToken(token({ exp: NOW_S - 30 }), CONFIG, keys, NOW),
    );
  });

  it("jövőbeli kiállítás a türés után: NOT_YET_VALID", async () => {
    await refused(token({ iat: NOW_S + 120 }), "NOT_YET_VALID");
  });

  it("hiányzó vagy üres sub: SUBJECT", async () => {
    await refused(token({ sub: undefined }), "SUBJECT");
    await refused(token({ sub: "" }), "SUBJECT");
  });

  it("nem három részes, nem JSON vagy túl hosszú: MALFORMED", async () => {
    await refused("egy.ketto", "MALFORMED");
    await refused("nem-json.nem-json.x", "MALFORMED");
    await refused("a".repeat(ID_TOKEN_MAX_LENGTH + 1), "MALFORMED");
  });
});

describe("Apple nonce", () => {
  const raw = "veletlen-nonce-1234567890";
  const hashed = createHash("sha256").update(raw).digest("hex");
  const claims = (nonce: string | null) => ({
    provider: "APPLE" as const,
    subject: "001.apple",
    email: null,
    emailVerified: false,
    hostedDomain: null,
    nonce,
    issuedAt: null,
  });

  it("a token a nyers nonce SHA-256-ját viseli: egyezik", () => {
    assert.equal(appleNonceMatches(claims(hashed), raw), true);
  });

  it("más nonce, hiányzó nonce: nem egyezik", () => {
    assert.equal(
      appleNonceMatches(claims(hashed), "masik-nonce-1234567890"),
      false,
    );
    assert.equal(appleNonceMatches(claims(null), raw), false);
  });

  it("a token saját nonce-mezőjét visszaküldeni nem elég (a tokent birtokló nem ismeri a nyerset)", () => {
    assert.equal(appleNonceMatches(claims(hashed), hashed), false);
  });
});

describe("a cím hitelessége", () => {
  const google = (
    email: string | null,
    emailVerified: boolean,
    hostedDomain: string | null = null,
  ) => ({
    provider: "GOOGLE" as const,
    subject: "1",
    email,
    emailVerified,
    hostedDomain,
    nonce: null,
    issuedAt: null,
  });

  it("Google: gmail.com és googlemail.com igen, más tartomány hd nélkül nem", () => {
    assert.equal(emailIsAuthoritative(google("a@gmail.com", true)), true);
    assert.equal(emailIsAuthoritative(google("a@googlemail.com", true)), true);
    assert.equal(emailIsAuthoritative(google("a@ceg.hu", true)), false);
  });

  it("Google: a cím tartományával egyező hd igen, más hd vagy aldomain nem", () => {
    assert.equal(
      emailIsAuthoritative(google("a@ceg.hu", true, "ceg.hu")),
      true,
    );
    assert.equal(
      emailIsAuthoritative(google("a@ceg.hu", true, "masik.hu")),
      false,
    );
    assert.equal(
      emailIsAuthoritative(google("a@resz.ceg.hu", true, "ceg.hu")),
      false,
    );
  });

  it("igazolatlan vagy hiányzó cím soha", () => {
    assert.equal(emailIsAuthoritative(google("a@gmail.com", false)), false);
    assert.equal(emailIsAuthoritative(google(null, true)), false);
    assert.equal(
      emailIsAuthoritative({ ...google("a@ceg.hu", false), provider: "APPLE" }),
      false,
    );
  });

  it("Apple: az igazolt cím bármely tartományban", () => {
    assert.equal(
      emailIsAuthoritative({
        ...google("a@privaterelay.appleid.com", true),
        provider: "APPLE",
      }),
      true,
    );
  });

  it("a hd mezőt kisbetűsen olvassa ki a tokenből", async () => {
    const claims = await verifyIdToken(
      token({ email: "a@Ceg.hu", hd: "CEG.HU" }),
      CONFIG,
      keys,
      NOW,
    );
    assert.equal(claims.hostedDomain, "ceg.hu");
    assert.equal(emailIsAuthoritative(claims), true);
  });
});
