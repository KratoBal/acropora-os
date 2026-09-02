import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasPermission, NAVIGATION_ENTRIES, USER_ROLES } from "@acropora/types";
import type { AuthenticatedUser, Session } from "@acropora/types";

import { AuthController } from "./auth.controller.js";
import type { AuthService } from "./auth.service.js";
import type { AuthenticatedRequest } from "./auth.types.js";
import {
  CSRF_COOKIE_NAME,
  type CookieOptions,
  type CookieResponse,
  SESSION_COOKIE_NAME,
} from "./cookie.util.js";

const testUser: AuthenticatedUser = {
  id: "user-1",
  email: "owner@acropora.hu",
  displayName: "Teszt Owner",
  role: "OWNER",
  customerId: null,
  supplierId: null,
};

function fakeSession(token: string): Session {
  return {
    id: "session-1",
    user: testUser,
    token,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

function fakeCookieResponse(): CookieResponse & {
  cookies: Record<string, string>;
  cleared: string[];
} {
  const cookies: Record<string, string> = {};
  const cleared: string[] = [];
  return {
    cookies,
    cleared,
    cookie(name: string, value: string, _options: CookieOptions) {
      cookies[name] = value;
    },
    clearCookie(name: string, _options: { path: string }) {
      cleared.push(name);
    },
  };
}

describe("AuthController", () => {
  it("web login/password returns only { user } — the token never appears in the JSON body", async () => {
    const authService = {
      loginWithPassword: async () => fakeSession("web-token-abc"),
    } as unknown as AuthService;
    const controller = new AuthController(authService);
    const response = fakeCookieResponse();

    const body = await controller.loginWithPassword(
      { email: testUser.email, password: "secret" },
      response,
    );

    assert.deepEqual(Object.keys(body), ["user"]);
    assert.deepEqual(body.user, testUser);
    assert.equal(JSON.stringify(body).includes("web-token-abc"), false);
    // ...but the httpOnly session cookie and the separate CSRF cookie are
    // still set exactly as before.
    assert.equal(response.cookies[SESSION_COOKIE_NAME], "web-token-abc");
    assert.ok(response.cookies[CSRF_COOKIE_NAME]);
  });

  it("mobile login/password returns a Bearer token in the JSON body and sets no cookies at all", async () => {
    const authService = {
      loginWithPassword: async () => fakeSession("mobile-token-xyz"),
    } as unknown as AuthService;
    const controller = new AuthController(authService);

    const body = await controller.loginMobileWithPassword({
      email: testUser.email,
      password: "secret",
    });

    assert.equal(body.token, "mobile-token-xyz");
    assert.deepEqual(body.user, testUser);
    assert.ok(body.expiresAt);
  });

  it("logout invalidates a Bearer-authenticated session without touching any cookies", async () => {
    let loggedOutToken: string | undefined;
    const authService = {
      logout: async (token: string) => {
        loggedOutToken = token;
      },
    } as unknown as AuthService;
    const controller = new AuthController(authService);
    const response = fakeCookieResponse();
    const request = {
      headers: {},
      authToken: "bearer-token",
      authViaCookie: false,
    } as unknown as AuthenticatedRequest;

    const result = await controller.logout(request, response);

    assert.equal(loggedOutToken, "bearer-token");
    assert.deepEqual(response.cleared, []);
    assert.deepEqual(result, { success: true });
  });

  it("logout invalidates a cookie-authenticated session and clears both cookies", async () => {
    let loggedOutToken: string | undefined;
    const authService = {
      logout: async (token: string) => {
        loggedOutToken = token;
      },
    } as unknown as AuthService;
    const controller = new AuthController(authService);
    const response = fakeCookieResponse();
    const request = {
      headers: {},
      authToken: "cookie-token",
      authViaCookie: true,
    } as unknown as AuthenticatedRequest;

    await controller.logout(request, response);

    assert.equal(loggedOutToken, "cookie-token");
    assert.deepEqual(
      response.cleared.sort(),
      [CSRF_COOKIE_NAME, SESSION_COOKIE_NAME].sort(),
    );
  });

  /**
   * A KIADOTT MENU EGYEZIK A KOZOS FORRASSAL, MINDEN SZEREPRE, MINDKET IRANYBAN.
   *
   * EZ AZ ALLITAS A MAI `mobile-capability-values.spec.ts` LEENDO UTODJA, es
   * SZANDEKOSAN MAR MOST all, mielott az kiesne. A sorrend a terv resze: elobb
   * alljon az uj allitas, csak azutan essen ki a regi -- kulonben van egy kor,
   * amiben semmi nem meri.
   *
   * A VARAKOZAST A TESZT SZAMOLJA KI, NEM A `visibleNavigationFor`-t hivja. Ha
   * onnan kerne, azt allitana, hogy a fuggveny egyenlo onmagaval, es akkor is
   * zold maradna, ha a szures teljesen kiesne. Itt a szabalyt a teszt
   * fuggetlenul ertekeli ki: jog-alapu tetelnel `hasPermission`, szereplistas
   * tetelnel a lista tartalmazasa.
   *
   * MINDKET IRANY KELL. Az "amit lat" onmagaban akkor is teljesul, ha MINDENKI
   * MINDENT lat; a szukitest csak a masodik ciklus meri.
   */
  it("serves each role exactly what the shared source says it may see", () => {
    const controller = new AuthController(
      {} as unknown as ConstructorParameters<typeof AuthController>[0],
    );
    let osszevetes = 0;

    for (const role of USER_ROLES) {
      const user = { ...testUser, role };
      const kiadott = controller.getCurrentUser(user).navigation;
      const kiadottIds = kiadott.map((entry) => entry.id);

      for (const entry of NAVIGATION_ENTRIES) {
        osszevetes += 1;
        const rule = entry.visibility;
        const lathato =
          rule.kind === "roles"
            ? rule.roles.includes(role)
            : hasPermission(role, rule.permission);

        assert.equal(
          kiadottIds.includes(entry.id),
          lathato,
          `${role} / ${entry.id}: a kiadott válasz ${kiadottIds.includes(entry.id)}, ` +
            `a forrás szabálya ${lathato}`,
        );
      }

      // A FELULETEK IS ATMENNEK, nem csak az azonositok. Enelkul a telefon nem
      // tudna megkulonboztetni a "nem ismerem" esetet a "nem nekem valo"-tol.
      for (const entry of kiadott) {
        const forras = NAVIGATION_ENTRIES.find((e) => e.id === entry.id);
        assert.deepEqual(entry.surfaces, forras?.surfaces);
      }
    }

    // KONTROLL: het szerep es huszonhet tetel. Egy ures forras vagy egy elromlott
    // ciklus nulla osszevetest adna, es a ket ciklus zolden menne vegig.
    assert.equal(osszevetes, USER_ROLES.length * NAVIGATION_ENTRIES.length);
  });

  /**
   * A SZEREP-LISTAS AG A SZERVEREN IS UGY VISELKEDIK, MINT A FORRASBAN.
   *
   * ===================================================================
   * AMIT EZ AZ ALLITAS MA NEM TUD MEGFOGNI, ES MIERT NEM HIBA
   * ===================================================================
   *
   * KALIBRALVA 2026-09-02: ha valaki a kiadaskor a szerep-listat
   * `purchasing.view` jogra csereli -- pontosan az a hiba, ami ellen ez a sor
   * all --, EGYETLEN teszt sem valik pirosra. Nem a teszt hibaja: a
   * `purchasing.view` szerep-halmaza MA PONTOSAN a NAV-csempe listaja (OWNER,
   * ADMIN, MANAGER, WAREHOUSE, VIEWER), tehat a ket szabaly azonos kimenetet ad,
   * es kimenetbol nem lehet megkulonboztetni oket.
   *
   * DE AZ ALLITAS NEM HALOTT, CSAK VAR, es ezt is lemertem: ha a SALES szerep
   * megkapja a `purchasing.view` jogot, a ket szabaly SZETVALIK, es MIND A KET
   * itteni allitas azonnal pirosra valt. Vagyis a vedelem pontosan abban a
   * pillanatban lep mukodesbe, amikor a kockazat valora valik.
   *
   * ES EZ AZ EGYIK OK, AMIERT A `retiredBy` MEZO KOTELEZO a forrasban: amig a
   * ket halmaz egybeesik, a kulonbseg csak leirva letezik.
   *
   * Kulon all, mert ez az EGYETLEN tetel, ami nem jog-alapu, es epp ez az, amit
   * egy szerver-oldali "majd itt is leszurom" konnyen maskepp csinalna. A SALES
   * szerepnek van `purchasing.view` joga -- ha valaki a kiadaskor jogra
   * cserelne a szabalyt, a csempe megjelenne nala, es senki nem kotne ehhez a
   * lepeshez.
   */
  it("keeps the role-list entry role-based when it serves it", () => {
    const controller = new AuthController(
      {} as unknown as ConstructorParameters<typeof AuthController>[0],
    );
    const idsFor = (role: (typeof USER_ROLES)[number]) =>
      controller
        .getCurrentUser({ ...testUser, role })
        .navigation.map((entry) => entry.id);

    assert.equal(idsFor("ADMIN").includes("nav-integration-mobile"), true);
    assert.equal(idsFor("SALES").includes("nav-integration-mobile"), false);
    // A KONTROLL, hogy a SALES-nel nem egy ures valasz adja a hamisat:
    assert.ok(idsFor("SALES").length > 0);
  });
});
