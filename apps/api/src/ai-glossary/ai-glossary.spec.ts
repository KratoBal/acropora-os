import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import {
  aiGlossaryClientFromEnv,
  HttpAiGlossaryClient,
  type AiGlossaryClient,
  type AiGlossaryResult,
  type RawGlossaryVersion,
} from "./ai-glossary.client.js";
import { AiGlossaryController } from "./ai-glossary.controller.js";
import {
  aiGlossaryAllowed,
  AiGlossaryService,
  SEED_AUTHOR_NAME,
  UNKNOWN_USER_NAME,
} from "./ai-glossary.service.js";

/*
  AZ AI SZÓJEGYZÉK SZERKESZTŐJE, AZ OS API OLDALA (kártya 7a5ea203, C2). MI PIROSÍT: kapcsoló nélkül az AI-hoz nyúl; a mentő a kérés
  törzséből jön, nem a bejelentkezett felhasználóból (egy hamisított createdBy); a szerver mezői átjutnak; egy elavult alap (409), egy
  elutasított lista (400), egy hitelesítési hiba vagy egy elérhetetlen AI nem a maga szavával jön; a token vagy az AI saját szövege
  kikerül a válaszba; az azonosítók nem nevekké oldódnak (a seed, az ismeretlen felhasználó); a három útvonal bármelyike jog nélkül
  nyitva marad.
*/
const ON = { AI_GLOSSARY_EDITOR: "true" };

const raw = (
  overrides: Partial<RawGlossaryVersion> = {},
): RawGlossaryVersion => ({
  version: 3,
  createdAt: "2026-11-26T18:00:00.000Z",
  createdBy: "user-1",
  note: "ICP jóváhagyva",
  active: true,
  entries: [
    {
      abbreviation: "ATO",
      original: "Automatic Top Off",
      language: "en",
      hungarian: "automatikus párolgás-utántöltő rendszer",
      approved: true,
      approvedBy: "seed",
      approvedAt: "2026-11-26T17:00:00.000Z",
    },
    {
      abbreviation: "ICP",
      original: "Inductively Coupled Plasma",
      language: "en",
      hungarian: "induktív csatolású plazma",
      approved: true,
      approvedBy: "user-9",
      approvedAt: "2026-11-26T18:00:00.000Z",
    },
    {
      abbreviation: "RO",
      original: "Reverse Osmosis",
      language: "en",
      hungarian: "fordított ozmózis",
      approved: false,
      approvedBy: null,
      approvedAt: null,
    },
    {
      abbreviation: "PAR",
      original: "Photosynthetically Active Radiation",
      language: "en",
      hungarian: "fotoszintetikusan aktív sugárzás",
      approved: true,
      approvedBy: "ghost",
      approvedAt: "2026-11-26T18:00:00.000Z",
    },
  ],
  ...overrides,
});

function fakeClient(overrides: Partial<AiGlossaryClient> = {}) {
  const calls: string[] = [];
  const saved: unknown[] = [];
  const client: AiGlossaryClient = {
    listVersions: async () => {
      calls.push("list");
      return {
        ok: true,
        value: [
          {
            version: 3,
            createdAt: "2026-11-26T18:00:00.000Z",
            createdBy: "user-1",
            note: "n",
            entryCount: 4,
            active: true,
          },
          {
            version: 1,
            createdAt: "2026-11-26T17:00:00.000Z",
            createdBy: "seed",
            note: "",
            entryCount: 4,
            active: false,
          },
          {
            version: 2,
            createdAt: "2026-11-26T17:30:00.000Z",
            createdBy: "ghost",
            note: "",
            entryCount: 4,
            active: false,
          },
        ],
      };
    },
    readVersion: async (version) => {
      calls.push(`read:${version}`);
      return { ok: true, value: raw() };
    },
    save: async (input) => {
      calls.push("save");
      saved.push(input);
      return { ok: true, value: { version: 4, takesEffectWithinSeconds: 60 } };
    },
    ...overrides,
  };
  return { client, calls, saved };
}

const NAMES = new Map([
  ["user-1", "Kovács Anna"],
  ["user-9", "Nagy Béla"],
]);
const lookups: string[][] = [];
const names = async (ids: readonly string[]) => {
  lookups.push([...ids]);
  return new Map(
    ids.flatMap((id) => (NAMES.has(id) ? [[id, NAMES.get(id)!] as const] : [])),
  );
};

const service = (
  client: AiGlossaryClient | null,
  env: Record<string, string | undefined> = ON,
) => new AiGlossaryService(() => client, env, names);

const body = (overrides: Record<string, unknown> = {}) => ({
  expectedVersion: 3,
  note: "ATO magyar neve",
  entries: [
    {
      abbreviation: "ATO",
      original: "Automatic Top Off",
      language: "en",
      hungarian: "automatikus utántöltő",
      approved: true,
    },
  ],
  ...overrides,
});

describe("az AI szójegyzék szerkesztője, kapcsoló", () => {
  it("csak az AI_GLOSSARY_EDITOR=true mellett él", () => {
    assert.equal(aiGlossaryAllowed({}), false);
    assert.equal(aiGlossaryAllowed({ AI_GLOSSARY_EDITOR: "1" }), false);
    assert.equal(aiGlossaryAllowed({ AI_GLOSSARY_EDITOR: "true" }), true);
  });

  it("kikapcsolva mindhárom 404, és az AI-hoz nem nyúl", async () => {
    const { client, calls } = fakeClient();
    const off = service(client, {});
    await assert.rejects(off.listVersions(), NotFoundException);
    await assert.rejects(off.readVersion("1"), NotFoundException);
    await assert.rejects(off.save(body(), "user-1"), NotFoundException);
    assert.deepEqual(calls, []);
  });

  it("AI-beállítás nélkül 503", async () => {
    await assert.rejects(
      service(null).listVersions(),
      ServiceUnavailableException,
    );
  });
});

describe("az előzmény és egy verzió, nevekkel", () => {
  it("a mentőt névre oldja: a seed rendszer-névre, az ismeretlen azonosító ismeretlen-névre; a seedet nem keresi az adatbázisban", async () => {
    lookups.length = 0;
    const { versions } = await service(fakeClient().client).listVersions();
    assert.deepEqual(
      versions.map((v) => v.createdBy),
      ["Kovács Anna", SEED_AUTHOR_NAME, UNKNOWN_USER_NAME],
    );
    assert.deepEqual(lookups[0]!.sort(), ["ghost", "user-1"]);
  });

  it("a jóváhagyót és a mentőt is névre oldja, a jóváhagyatlan sor jóváhagyója null marad", async () => {
    const version = await service(fakeClient().client).readVersion("3");
    assert.equal(version.createdBy, "Kovács Anna");
    assert.deepEqual(
      version.entries.map((e) => e.approvedBy),
      [SEED_AUTHOR_NAME, "Nagy Béla", null, UNKNOWN_USER_NAME],
    );
    assert.equal(version.entries[1]!.approvedAt, "2026-11-26T18:00:00.000Z");
  });

  it("rossz verziószám 400 és az AI-t nem kérdezi; ismeretlen verzió 404", async () => {
    const { client, calls } = fakeClient({
      readVersion: async () => ({ ok: false, kind: "not-found" }),
    });
    const svc = service(client);
    for (const bad of ["0", "abc", "-1", "1e3", "2.5", ""])
      await assert.rejects(svc.readVersion(bad), BadRequestException, bad);
    assert.deepEqual(calls, []);
    await assert.rejects(svc.readVersion("9"), NotFoundException);
  });
});

describe("a mentés", () => {
  it("a mentő a bejelentkezett felhasználó azonosítója, a kérés törzséből a createdBy elutasított", async () => {
    const { client, saved } = fakeClient();
    const svc = service(client);
    assert.deepEqual(await svc.save(body(), "user-7"), {
      version: 4,
      takesEffectWithinSeconds: 60,
    });
    assert.equal((saved[0] as { createdBy: string }).createdBy, "user-7");
    assert.equal((saved[0] as { expectedVersion: number }).expectedVersion, 3);
    await assert.rejects(
      svc.save(body({ createdBy: "valaki-mas" }), "user-7"),
      BadRequestException,
    );
    assert.equal(saved.length, 1);
  });

  it("hibás törzs 400 magyar mondattal, és az AI-t nem hívja", async () => {
    const { client, calls } = fakeClient();
    const svc = service(client);
    const missing = body();
    delete (missing as Record<string, unknown>).expectedVersion;
    for (const bad of [
      missing,
      body({ entries: [] }),
      body({
        entries: [
          {
            abbreviation: "ATO",
            original: "x",
            language: "en",
            hungarian: "sor\ntörés",
            approved: true,
          },
        ],
      }),
    ]) {
      await assert.rejects(
        svc.save(bad, "user-1"),
        (error: unknown) =>
          error instanceof BadRequestException &&
          /[a-záéíóöőúüű]/i.test(error.message),
      );
    }
    assert.deepEqual(calls, []);
  });

  const failures: Array<
    [string, AiGlossaryResult<never>, new (...args: never[]) => Error]
  > = [
    [
      "409",
      { ok: false, kind: "conflict", activeVersion: 5 },
      ConflictException,
    ],
    [
      "az AI elutasítja a listát",
      {
        ok: false,
        kind: "invalid",
        message: "A(z) 2. sor szövege túl hosszú.",
      },
      BadRequestException,
    ],
    [
      "hitelesítési hiba",
      { ok: false, kind: "unauthorized" },
      BadGatewayException,
    ],
    [
      "időtúllépés",
      { ok: false, kind: "timeout" },
      ServiceUnavailableException,
    ],
    [
      "elérhetetlen",
      { ok: false, kind: "unreachable" },
      ServiceUnavailableException,
    ],
    [
      "váratlan válasz",
      { ok: false, kind: "unavailable" },
      ServiceUnavailableException,
    ],
  ];
  for (const [name, result, exception] of failures) {
    it(`${name}: a megfelelő hibává válik`, async () => {
      const svc = service(
        fakeClient({
          save: async () =>
            result as AiGlossaryResult<{
              version: number;
              takesEffectWithinSeconds: number;
            }>,
        }).client,
      );
      await assert.rejects(svc.save(body(), "user-1"), exception);
    });
  }

  it("a 409 üzenete nevezi az aktív verziót, és megadja a számot is", async () => {
    const svc = service(
      fakeClient({
        save: async () => ({ ok: false, kind: "conflict", activeVersion: 5 }),
      }).client,
    );
    await assert.rejects(svc.save(body(), "user-1"), (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      const response = error.getResponse() as {
        message: string;
        activeVersion: number;
      };
      assert.match(response.message, /5\. verzió/);
      assert.equal(response.activeVersion, 5);
      return true;
    });
  });
});

describe("a jogosultság", () => {
  it("mindhárom útvonal SETTINGS_MANAGE-et kér", () => {
    for (const name of ["versions", "version", "save"] as const) {
      const permissions = Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        AiGlossaryController.prototype[name],
      );
      assert.deepEqual(permissions, [PERMISSIONS.SETTINGS_MANAGE], name);
    }
  });
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const TOKEN = "titkos-token-123";

describe("a HTTP kliens", () => {
  const info = {
    version: 3,
    createdAt: "t",
    createdBy: "u",
    note: "",
    entryCount: 1,
    active: true,
  };

  it("a tokent viszi, a megfelelő útvonalakat hívja, a törzset JSON-ként küldi", async () => {
    const seen: Array<{
      url: string;
      method: string;
      auth: string;
      body: unknown;
    }> = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      seen.push({
        url,
        method: String(init.method),
        auth: String((init.headers as Record<string, string>).authorization),
        body:
          init.body === undefined ? undefined : JSON.parse(String(init.body)),
      });
      if (url.endsWith("/versions")) return json({ versions: [info] });
      if (url.endsWith("/versions/3"))
        return json({ ...info, entryCount: undefined, entries: raw().entries });
      return json({ version: 4, takesEffectWithinSeconds: 60 });
    }) as unknown as typeof fetch;
    const client = new HttpAiGlossaryClient("http://ai.test", TOKEN, fetcher);
    assert.equal((await client.listVersions()).ok, true);
    assert.equal((await client.readVersion(3)).ok, true);
    assert.equal(
      (
        await client.save({
          expectedVersion: 3,
          entries: [],
          createdBy: "u",
          note: "",
        })
      ).ok,
      true,
    );
    assert.deepEqual(
      seen.map((s) => [s.method, s.url]),
      [
        ["GET", "http://ai.test/v1/glossary/versions"],
        ["GET", "http://ai.test/v1/glossary/versions/3"],
        ["PUT", "http://ai.test/v1/glossary"],
      ],
    );
    assert.ok(seen.every((s) => s.auth === `Bearer ${TOKEN}`));
    assert.deepEqual(seen[2]!.body, {
      expectedVersion: 3,
      entries: [],
      createdBy: "u",
      note: "",
    });
  });

  const statuses: Array<[number, unknown, unknown]> = [
    [401, {}, { ok: false, kind: "unauthorized" }],
    [404, {}, { ok: false, kind: "not-found" }],
    [
      409,
      { error: "version_conflict", activeVersion: 7 },
      { ok: false, kind: "conflict", activeVersion: 7 },
    ],
    [
      400,
      { error: "invalid glossary", message: "a 2. sor hibás" },
      { ok: false, kind: "invalid", message: "a 2. sor hibás" },
    ],
    [
      503,
      { error: "glossary store unavailable" },
      { ok: false, kind: "unavailable" },
    ],
    [500, { error: "x" }, { ok: false, kind: "unavailable" }],
  ];
  for (const [status, answer, expected] of statuses) {
    it(`HTTP ${status} a megfelelő hibakategória`, async () => {
      const client = new HttpAiGlossaryClient(
        "http://ai.test",
        TOKEN,
        (async () => json(answer, status)) as unknown as typeof fetch,
      );
      assert.deepEqual(
        await client.save({
          expectedVersion: 1,
          entries: [],
          createdBy: "u",
          note: "",
        }),
        expected,
      );
    });
  }

  it("a hálózati hiba elérhetetlen, az időtúllépés időtúllépés, és a token nincs a hibában", async () => {
    const down = new HttpAiGlossaryClient(
      "http://ai.test",
      TOKEN,
      (async () => {
        throw new TypeError(`fetch failed ${TOKEN}`);
      }) as unknown as typeof fetch,
    );
    const slow = new HttpAiGlossaryClient(
      "http://ai.test",
      TOKEN,
      (async () => {
        throw Object.assign(new Error("t"), { name: "TimeoutError" });
      }) as unknown as typeof fetch,
    );
    const first = await down.listVersions();
    assert.deepEqual(first, { ok: false, kind: "unreachable" });
    assert.ok(!JSON.stringify(first).includes(TOKEN));
    assert.deepEqual(await slow.listVersions(), { ok: false, kind: "timeout" });
  });

  it("a szerződést sértő törzs unavailable, soha nem félig kitöltött érték", async () => {
    for (const bad of [
      { versions: [{ version: "x" }] },
      { versions: "nem lista" },
      null,
      { versions: [{ ...info, active: "igen" }] },
    ]) {
      const client = new HttpAiGlossaryClient(
        "http://ai.test",
        TOKEN,
        (async () => json(bad)) as unknown as typeof fetch,
      );
      assert.deepEqual(await client.listVersions(), {
        ok: false,
        kind: "unavailable",
      });
    }
    const brokenEntry = {
      ...info,
      entries: [{ ...raw().entries[0], language: "fr" }],
    };
    const client = new HttpAiGlossaryClient(
      "http://ai.test",
      TOKEN,
      (async () => json(brokenEntry)) as unknown as typeof fetch,
    );
    assert.deepEqual(await client.readVersion(3), {
      ok: false,
      kind: "unavailable",
    });
    const noSave = new HttpAiGlossaryClient(
      "http://ai.test",
      TOKEN,
      (async () => json({ version: 0 })) as unknown as typeof fetch,
    );
    assert.deepEqual(
      await noSave.save({
        expectedVersion: 1,
        entries: [],
        createdBy: "u",
        note: "",
      }),
      { ok: false, kind: "unavailable" },
    );
  });

  it("a környezetből: mindkét fél kell, a záró perjel nem számít", () => {
    assert.equal(aiGlossaryClientFromEnv({}), null);
    assert.equal(
      aiGlossaryClientFromEnv({ ACROPORA_AI_BASE_URL: "http://ai.test" }),
      null,
    );
    assert.equal(
      aiGlossaryClientFromEnv({ ACROPORA_AI_ACCESS_TOKEN: TOKEN }),
      null,
    );
    assert.ok(
      aiGlossaryClientFromEnv({
        ACROPORA_AI_BASE_URL: "http://ai.test/",
        ACROPORA_AI_ACCESS_TOKEN: TOKEN,
      }),
    );
  });
});
