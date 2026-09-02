import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { ServiceToken } from "@acropora/database";
import { PERMISSIONS, ROLE_PERMISSIONS } from "@acropora/types";
import type { AuthenticatedUser } from "@acropora/types";

import type { AuthUserResolver } from "../auth/auth-user-resolver.js";
import type { ServiceTokenRepository } from "../tasks/service-token.repository.js";
import {
  ContentAgentGuard,
  type ContentAgentRequest,
} from "./content-agent.guard.js";

/**
 * A VARRAT KAPJA A VALODI SZERZODES TIPUSAT, nem a dupla objektuma.
 *
 * A dupla maga `as unknown as` kaszttal megy at -- a repo tobbi orzo-tesztje is
 * igy csinalja --, de a KET ERTEK, ami a duplan atmegy, kiirt tipust kap:
 * `ServiceToken` es `AuthenticatedUser`. Ez a kulonbseg nem stilus. Egy `never`
 * kaszt a fuggvenyeken azt is elfogadna, ha a fixture-bol kimaradna a `userId`,
 * es akkor eppen az az allitas nem merne semmit, ami miatt ez a fajl letezik.
 * Ugyanez a kiirt tipus fogta meg a masik negy spec fixture-jenek elcsuszasat.
 */
const TOKEN_REKORD: ServiceToken = {
  id: "st_1",
  name: "Flotta - murena",
  slug: "murena",
  tokenHash: "hash",
  userId: "u_murena",
  dailyLimit: 200,
  lastUsedAt: null,
  revokedAt: null,
  createdAt: new Date("2026-09-02T08:00:00.000Z"),
};

const AGENS_FELHASZNALO: AuthenticatedUser = {
  id: "u_murena",
  email: "murena@agents.acropora.local",
  displayName: "murena",
  nickname: null,
  role: "CONTENT_AGENT",
  avatarUrl: null,
  customerId: null,
  supplierId: null,
};

/**
 * A FELOLDAS DOBHAT IS, nem csak visszaadhat. Az `AuthUserResolver.resolveById`
 * `UnauthorizedException`-t dob ismeretlen vagy INAKTIV fiokra, es a dupla csak
 * akkor tudja ezt az utat eloallitani, ha a hiba is atfer rajta.
 */
type FeloldasEredmeny = AuthenticatedUser | (() => never);

function orzoVel(
  overrides: {
    token?: ServiceToken | null;
    user?: FeloldasEredmeny;
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  // `undefined`-re esik vissza az alapertelmezes, nem `null`-ra: a `null` az
  // "ilyen token nincs" eset, es azt egy tesztnek meg kell tudnia kerni.
  const token = overrides.token === undefined ? TOKEN_REKORD : overrides.token;
  const user = overrides.user ?? AGENS_FELHASZNALO;
  const tokens = {
    findActive: async (): Promise<ServiceToken | null> => token,
  } as unknown as ServiceTokenRepository;
  const users = {
    resolveById: async (): Promise<AuthenticatedUser> =>
      typeof user === "function" ? user() : user,
  } as unknown as AuthUserResolver;
  const env =
    overrides.env ??
    ({ ACROPORA_CONTENT_AGENT_TOKEN_IDS: "st_1" } as NodeJS.ProcessEnv);
  return new ContentAgentGuard(tokens, users, env);
}

const keres = (authorization = "Bearer nyers-token") => {
  const request: ContentAgentRequest = { headers: { authorization } };
  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext,
  };
};

describe("a gépi tartalom-bejárat őrzője", () => {
  it("átengedi az ágenst, és a saját felhasználóját teszi a kérésre", async () => {
    const { request, context } = keres();

    assert.equal(await orzoVel().canActivate(context), true);
    // EZ A HARMADIK ALLITAS: a szerzo az AGENS sajat fiokja lesz, nem egy kozos.
    assert.equal((request.user as { id: string }).id, "u_murena");
  });

  it("elutasítja azt a tokent, amihez NINCS felhasználó", async () => {
    // A MASODIK ALLITAS. A userId nullazhato, mert a regi tokeneknek nincs
    // ilyenjuk -- es epp ezert nem szabad visszaesni semmilyen alapertelmezett
    // fiokra. Ha ez az allitas zold marad egy rossz kodon is, a regi tokenek
    // hirtelen valaki neveben irnanak.
    const orzo = orzoVel({ token: { ...TOKEN_REKORD, userId: null } });

    await assert.rejects(
      () => orzo.canActivate(keres().context),
      UnauthorizedException,
    );
  });

  it("elutasít mindent, ha az engedélylista beállítatlan", async () => {
    const orzo = orzoVel({ env: {} as NodeJS.ProcessEnv });

    await assert.rejects(
      () => orzo.canActivate(keres().context),
      UnauthorizedException,
    );
  });

  it("elutasítja azt a tokent, ami nincs az engedélylistán", async () => {
    const orzo = orzoVel({ token: { ...TOKEN_REKORD, id: "st_masik" } });

    await assert.rejects(
      () => orzo.canActivate(keres().context),
      UnauthorizedException,
    );
  });

  it("elutasítja, ha a felhasználónak nincs content.manage joga", async () => {
    // A `VIEWER` a legszukebb ember-szerep: van `content.view` joga, `manage`
    // nincs. Igy az allitas a VALODI jogosultsag-tablat meri, nem egy kezzel
    // osszerakott jog-listat, ami a tablatol fuggetlenul is zold maradna.
    const orzo = orzoVel({
      user: { ...AGENS_FELHASZNALO, role: "VIEWER" },
    });

    await assert.rejects(
      () => orzo.canActivate(keres().context),
      UnauthorizedException,
    );
  });

  it("elutasítja, ha a token fiókja nem oldható fel (törölt vagy inaktív)", async () => {
    // A feloldas sajat, MASIK uzenetu hibat dob. Ha az kiszivarogna, a valasz
    // elarulna, hogy a token egy letezo, de kikapcsolt fiokra mutat -- a tobbi
    // ellenorzes pedig szandekosan megkulonboztethetetlen.
    const orzo = orzoVel({
      user: () => {
        throw new UnauthorizedException(
          "Az autentikált felhasználóhoz nem tartozik aktív belső User rekord.",
        );
      },
    });

    await assert.rejects(
      () => orzo.canActivate(keres().context),
      (error) => {
        assert.ok(error instanceof UnauthorizedException);
        assert.equal(error.message, "Érvénytelen token.");
        return true;
      },
    );
  });
});

describe("a szűk szerep határa", () => {
  it("NEM tud jóváhagyni", () => {
    // AZ ELSO ALLITAS. Egy agens nem hagyhatja jova a sajat vazlatat, es ezt a
    // SZEREPNEK kell tartania -- nem annak, hogy a hivo nem probalja meg.
    const jogok = ROLE_PERMISSIONS.CONTENT_AGENT;

    assert.equal(jogok.includes(PERMISSIONS.CONTENT_APPROVE), false);
    assert.equal(jogok.includes(PERMISSIONS.CONTENT_MANAGE), true);
    assert.equal(jogok.includes(PERMISSIONS.CONTENT_VIEW), true);
    // ES SEMMI MAS: a szam az, ami megfogja a kesobbi bovitest.
    assert.equal(jogok.length, 2);
  });
});
