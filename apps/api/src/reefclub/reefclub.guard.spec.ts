import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME } from "../auth/cookie.util.js";
import type { ReefClubSessionRepository } from "./reefclub-session.repository.js";
import {
  REEFCLUB_PUBLIC_KEY,
  ReefClubGuard,
  type ReefClubRequest,
} from "./reefclub.guard.js";

const LIVE_TOKEN = "rc-live-token";

/** Knows exactly one token; records every lookup it was asked for. */
function fakeSessions() {
  const lookups: string[] = [];
  const repository = {
    lookups,
    async findActive(token: string) {
      lookups.push(token);
      return token === LIVE_TOKEN
        ? {
            id: "s1",
            accountId: "acc-1",
            expiresAt: new Date(Date.now() + 1000),
          }
        : null;
    },
  };
  return repository;
}

function context(request: ReefClubRequest, isPublic = false): ExecutionContext {
  const handler = () => undefined;
  if (isPublic) Reflect.defineMetadata(REEFCLUB_PUBLIC_KEY, true, handler);
  return {
    getHandler: () => handler,
    getClass: () => ReefClubGuard,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function guard(sessions = fakeSessions()) {
  return {
    sessions,
    guard: new ReefClubGuard(
      new Reflector(),
      sessions as unknown as ReefClubSessionRepository,
    ),
  };
}

describe("ReefClubGuard", () => {
  it("süti nélkül 401", async () => {
    const { guard: g } = guard();
    await assert.rejects(
      g.canActivate(context({ method: "GET", headers: {} })),
      UnauthorizedException,
    );
  });

  it("a belső Bearer fejlécet nem olvassa: 401, és a táblában sem keres vele", async () => {
    const { guard: g, sessions } = guard();
    await assert.rejects(
      g.canActivate(
        context({
          method: "GET",
          headers: { authorization: `Bearer ${LIVE_TOKEN}` },
        }),
      ),
      UnauthorizedException,
    );
    assert.deepEqual(sessions.lookups, []);
  });

  it("a belső munkamenet-sütit nem olvassa: 401", async () => {
    const { guard: g, sessions } = guard();
    await assert.rejects(
      g.canActivate(
        context({
          method: "GET",
          headers: {
            cookie: `${SESSION_COOKIE_NAME}=${LIVE_TOKEN}; ${CSRF_COOKIE_NAME}=c`,
          },
        }),
      ),
      UnauthorizedException,
    );
    assert.deepEqual(sessions.lookups, []);
  });

  it("élő ReefClub-süti GET-en átenged, és a fiókot a kérésre teszi", async () => {
    const { guard: g } = guard();
    const request: ReefClubRequest = {
      method: "GET",
      headers: { cookie: `rc_session=${LIVE_TOKEN}` },
    };
    assert.equal(await g.canActivate(context(request)), true);
    assert.equal(request.reefClubAccountId, "acc-1");
  });

  it("ismeretlen token 401, a CSRF-fejléc helyessége ezen nem változtat", async () => {
    const { guard: g } = guard();
    await assert.rejects(
      g.canActivate(
        context({
          method: "POST",
          headers: {
            cookie: "rc_session=idegen; rc_csrf=c",
            "x-csrf-token": "c",
          },
        }),
      ),
      UnauthorizedException,
    );
  });

  it("élő munkamenettel állapotváltoztató kérés CSRF nélkül 403, egyező párral átmegy", async () => {
    const { guard: g } = guard();
    await assert.rejects(
      g.canActivate(
        context({
          method: "PATCH",
          headers: { cookie: `rc_session=${LIVE_TOKEN}; rc_csrf=c` },
        }),
      ),
      ForbiddenException,
    );
    await assert.rejects(
      g.canActivate(
        context({
          method: "PATCH",
          headers: {
            cookie: `rc_session=${LIVE_TOKEN}; rc_csrf=c`,
            "x-csrf-token": "mas",
          },
        }),
      ),
      ForbiddenException,
    );
    assert.equal(
      await g.canActivate(
        context({
          method: "PATCH",
          headers: {
            cookie: `rc_session=${LIVE_TOKEN}; rc_csrf=c`,
            "x-csrf-token": "c",
          },
        }),
      ),
      true,
    );
  });

  it("a ReefClubPublic jelölésű útvonalat süti nélkül is átengedi", async () => {
    const { guard: g } = guard();
    assert.equal(
      await g.canActivate(context({ method: "POST", headers: {} }, true)),
      true,
    );
  });
});
