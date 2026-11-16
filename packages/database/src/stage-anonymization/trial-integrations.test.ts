import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, it } from "node:test";

import { buildTrialEnvironment } from "./trial-environment.js";
import {
  assessTrialIntegrations,
  CLOSED_URL,
  closedHostOf,
  TRIAL_RULES,
  type ConnectionSettingState,
  type TrialRule,
} from "./trial-integrations.js";

/*
  THE TRIAL'S INTEGRATION MEASUREMENT. WHAT TURNS THIS RED: an integration that can reach a live third party (a credential set, a URL
  unset or EMPTY so it falls back to the live host, a stub mode that is not stub, a scheduler left on, a stored credential that
  survived, a device token left) and is not named; a finding that carries a VALUE (a key); a rule that names a variable the code never
  reads (a typo protects nothing); a measurement that passes without having read the settings or counted the tokens.
*/
const clean = (): ConnectionSettingState[] =>
  (["UNAS", "NAV", "Számlázz", "Medusa"] as const).map((integration) => ({
    integration,
    credentialMode: "ENV_FALLBACK",
    storedCredentialColumns: 0,
  }));
const baseEnv = () =>
  buildTrialEnvironment({
    databaseUrl: "postgresql://u:p@localhost:5432/stage_anon_tmp_x",
    port: 3999,
  });
const assess = (
  env: Record<string, string | undefined> = baseEnv(),
  settings: ConnectionSettingState[] | undefined = clean(),
  deviceTokens: number | undefined = 0,
) =>
  assessTrialIntegrations({ env, settings, deviceTokens, loadedEnvFiles: [] });
const failing = (checks: { name: string; passed: boolean }[]) =>
  checks.filter((c) => !c.passed);

describe("the environment the trial builds", () => {
  it("passes every integration check with clean stored settings and no device token", () => {
    const checks = assess();
    assert.equal(checks.length, TRIAL_RULES.length);
    assert.deepEqual(failing(checks), []);
  });
});

describe("what makes an integration live", () => {
  const onlyFailed = (
    env: Record<string, string | undefined>,
    settings?: ConnectionSettingState[],
    tokens?: number,
  ) => failing(assess(env, settings, tokens));

  it("fails exactly the integration whose variable is set, naming the variable and never its value", () => {
    const cases: [string, string, string][] = [
      ["UNAS_API_KEY", "integration closed: UNAS", "k-valodi-1"],
      ["NAV_TECHNICAL_USER_PASSWORD", "integration closed: NAV", "k-valodi-2"],
      ["SZAMLAZZ_AGENT_KEY", "integration closed: invoicing", "k-valodi-3"],
      ["GMAIL_TICKET_REFRESH_TOKEN", "integration closed: mail", "k-valodi-4"],
      ["TICKET_MAIL_GAME", "integration closed: mail", "live"],
      ["APNS_PRIVATE_KEY_BASE64", "integration closed: push", "k-valodi-5"],
      ["FCM_SERVICE_ACCOUNT_BASE64", "integration closed: push", "k-valodi-6"],
      [
        "GLS_MYGLS_PASSWORD",
        "integration closed: GLS and Foxpost",
        "k-valodi-7",
      ],
      ["FOXPOST_API_KEY", "integration closed: GLS and Foxpost", "k-valodi-8"],
      ["JATEK_SMTP_PASS", "integration closed: Brevo", "k-valodi-9"],
      ["REEFCLUB_SMTP_PASSWORD", "integration closed: Brevo", "k-valodi-10"],
      ["BREVO_API_KEY", "integration closed: Brevo", "k-valodi-11"],
      ["MEDUSA_ADMIN_API_KEY", "integration closed: Medusa", "k-valodi-12"],
      ["TYPESAFE_API_KEY", "integration closed: AI", "k-valodi-13"],
      ["OTP_EBIZ_API_KEY", "integration closed: AI", "k-valodi-14"],
      ["GLS_COD_MARK_PAID", "integration closed: payment", "auto"],
      ["STRIPE_SECRET_KEY", "integration closed: payment", "k-valodi-15"],
    ];
    for (const [name, check, value] of cases) {
      const found = onlyFailed({ ...baseEnv(), [name]: value });
      const names = found.map((c) => c.name);
      assert.ok(
        names.some((n) => n.startsWith(check)),
        `${name} -> ${check}: ${JSON.stringify(names)}`,
      );
      assert.ok(
        names.some((n) => n.includes(name)),
        `the finding names ${name}`,
      );
      assert.ok(
        !JSON.stringify(found).includes(value) || value.length <= 4,
        `${name}: the value is in the report`,
      );
    }
  });

  it("treats an UNSET or EMPTY closed-URL variable as live (the default is the live host; the Gmail API, Google OAuth and MNB fall back on an empty one too)", () => {
    for (const name of [
      "NAV_API_URL",
      "UNAS_API_URL",
      "VIES_API_URL",
      "MNB_API_URL",
      "GMAIL_API_URL",
      "GOOGLE_OAUTH_TOKEN_URL",
    ]) {
      const unset = { ...baseEnv() };
      delete unset[name];
      assert.equal(onlyFailed(unset).length, 1, `${name} unset`);
      assert.equal(
        onlyFailed({ ...baseEnv(), [name]: "" }).length,
        1,
        `${name} empty`,
      );
      assert.equal(
        onlyFailed({ ...baseEnv(), [name]: "   " }).length,
        1,
        `${name} blank`,
      );
    }
  });

  it("fails a URL that points at a real host, naming the variable and the host only", () => {
    const found = onlyFailed({
      ...baseEnv(),
      NAV_API_URL:
        "https://api.onlineszamla.nav.gov.hu/invoiceService/v3?k=titok",
    });
    assert.equal(found.length, 1);
    assert.match(
      found[0]!.name,
      /^integration closed: NAV \(NAV_API_URL points at a host that is not closed\)$/,
    );
    assert.ok(!found[0]!.name.includes("titok"));
    // a closed address is loopback or .invalid, however written
    for (const closed of [
      CLOSED_URL,
      "http://localhost:1",
      "http://[::1]:9/",
      "http://x.invalid/",
    ])
      assert.notEqual(closedHostOf(closed), null, closed);
    for (const live of [
      "https://api.unas.eu/shop",
      "http://127.0.0.1.evil.com",
      "not a url",
      "",
    ])
      assert.equal(closedHostOf(live), null, live);
  });

  it("requires the stub mode and the scheduler switches to be SET, and refuses a live or auto mode", () => {
    for (const [name, wrong] of [
      ["SZAMLAZZ_AGENT_MODE", "live"],
      ["SZAMLAZZ_AGENT_MODE", ""],
      ["EXTERNAL_INVOICE_PDF_SCHEDULE", "on"],
      ["EXTERNAL_INVOICE_MAIL_PDF_SCHEDULE", "1"],
      ["GLS_API_MODE", "live"],
      ["FOXPOST_API_MODE", "test"],
      ["TICKET_MAIL_MODE", "live"],
    ] as const) {
      assert.equal(
        onlyFailed({ ...baseEnv(), [name]: wrong }).length,
        1,
        `${name}=${wrong}`,
      );
    }
    for (const name of [
      "SZAMLAZZ_AGENT_MODE",
      "EXTERNAL_INVOICE_PDF_SCHEDULE",
      "EXTERNAL_INVOICE_MAIL_PDF_SCHEDULE",
    ]) {
      const unset = { ...baseEnv() };
      delete unset[name];
      assert.equal(
        onlyFailed(unset).length,
        1,
        `${name} unset (a default-on scheduler / no stub)`,
      );
    }
    // the carrier and ticket mail modes default to closed, so unset is fine
    for (const name of [
      "GLS_API_MODE",
      "FOXPOST_API_MODE",
      "TICKET_MAIL_MODE",
    ]) {
      const unset = { ...baseEnv() };
      delete unset[name];
      assert.equal(onlyFailed(unset).length, 0, `${name} unset`);
    }
  });

  it("refuses a ticket mail redirect (even an address): the redirect is only meant to be unset, which blocks", () => {
    assert.equal(
      onlyFailed({ ...baseEnv(), TICKET_MAIL_REDIRECT_TO: "off" }).length,
      1,
    );
    assert.equal(
      onlyFailed({ ...baseEnv(), TICKET_MAIL_REDIRECT_TO: "x@y.hu" }).length,
      1,
    );
  });

  it("fails a stored credential that survived, a settings row that was not read, an uncounted or non-empty device token table", () => {
    for (const integration of ["UNAS", "NAV", "Számlázz", "Medusa"] as const) {
      const survived = clean().map((s) =>
        s.integration === integration
          ? { ...s, storedCredentialColumns: 2 }
          : s,
      );
      assert.equal(onlyFailed(baseEnv(), survived).length, 1, integration);
      const unread = clean().filter((s) => s.integration !== integration);
      assert.equal(
        onlyFailed(baseEnv(), unread).length,
        1,
        `${integration} not read`,
      );
    }
    // called directly: the helper's default parameters would turn an undefined into a clean value
    const direct = (input: Parameters<typeof assessTrialIntegrations>[0]) =>
      failing(assessTrialIntegrations(input));
    assert.equal(
      direct({ env: baseEnv(), deviceTokens: 0, loadedEnvFiles: [] }).length,
      4,
      "no settings at all",
    );
    assert.equal(onlyFailed(baseEnv(), clean(), 3).length, 1);
    // NaN is not zero (a count that came back as no row): `NaN > 0` is false, so only an explicit check fails it
    assert.equal(onlyFailed(baseEnv(), clean(), Number.NaN).length, 1);
    assert.equal(
      onlyFailed(baseEnv(), clean(), Number.POSITIVE_INFINITY).length,
      1,
    );
    assert.equal(
      direct({ env: baseEnv(), settings: clean(), loadedEnvFiles: [] }).length,
      1,
    );
  });

  it("does not flag the variables the trial legitimately sets (the exceptions) and ignores unrelated ones", () => {
    const env = { ...baseEnv(), SOME_OTHER_THING: "x", HOME: "/home/x" };
    assert.deepEqual(failing(assess(env)), []);
  });
});

describe("the .env files the Prisma client would load (barracuda, #2331)", () => {
  const direct = (loadedEnvFiles: readonly string[] | null | undefined) =>
    failing(
      assessTrialIntegrations({
        env: baseEnv(),
        settings: clean(),
        deviceTokens: 0,
        loadedEnvFiles,
      }),
    );
  it("passes when no such file exists, and fails naming the file when one does (a clean environment is not enough if a .env puts keys back)", () => {
    assert.deepEqual(direct([]), []);
    const found = direct(["/srv/acropora/.env"]);
    assert.equal(found.length, 1);
    assert.match(
      found[0]!.name,
      /^integration closed: no \.env file is read into the instance .*\(the Prisma client would load \/srv\/acropora\/\.env\)$/,
    );
    assert.equal(
      direct(["/a/.env", "/b/prisma/.env"])[0]!.name.includes("/b/prisma/.env"),
      true,
    );
  });

  it("fails when it was not measured (null, or not given): a client that stops carrying the block must not read as 'nothing loaded'", () => {
    assert.equal(direct(null).length, 1);
    assert.equal(direct(undefined).length, 1);
    assert.match(direct(null)[0]!.name, /were not measured/);
  });
});

describe("every URL default the code reads from the environment is a rule (barracuda, #2331)", () => {
  /** Environment variables the application reads with a LITERAL http(s) default, found in the code (a constant counts: `?? DEFAULT`). */
  const urlDefaults = (): Map<string, string[]> => {
    const found = new Map<string, string[]>();
    const walk = (dir: URL): void => {
      for (const entry of readdirSync(dir)) {
        if (["node_modules", "dist", "test-dist", ".turbo"].includes(entry))
          continue;
        const next = new URL(
          entry + (statSync(new URL(entry, dir)).isDirectory() ? "/" : ""),
          dir,
        );
        if (statSync(next).isDirectory()) walk(next);
        else if (/\.ts$/.test(entry) && !/\.(spec|test)\.ts$/.test(entry)) {
          const source = readFileSync(next, "utf8");
          const constants = new Map(
            [
              ...source.matchAll(
                /(?:const|let)\s+(\w+)(?::\s*string)?\s*=\s*["'`](https?:\/\/[^"'`]*)["'`]/g,
              ),
            ].map((m) => [m[1]!, m[2]!]),
          );
          for (const m of source.matchAll(
            /(?:process\.)?env(?:ironment)?(?:\.([A-Z][A-Z0-9_]{2,})|\[\s*["']([A-Z][A-Z0-9_]{2,})["']\s*\])(?:\?)?(?:\.trim\(\))?\s*(?:\?\?|\|\|)\s*(?:["'`](https?:\/\/[^"'`]*)["'`]|(\w+))/g,
          )) {
            const name = m[1] ?? m[2]!;
            const value = m[3] ?? constants.get(m[4] ?? "");
            if (value === undefined) continue;
            found.set(name, [...(found.get(name) ?? []), value]);
          }
        }
      }
    };
    walk(new URL("../../../../apps/api/src/", import.meta.url));
    return found;
  };

  /** A URL default that is NOT an external reach, with the reason (the web app's own address, for links and CORS). */
  const NOT_EXTERNAL = new Map([
    ["WEB_URL", "the application's own web address, a localhost default"],
    [
      "REEFCLUB_WEB_URL",
      "the ReefClub web address written into the links of a mail body, never fetched (and the REEFCLUB_ prefix is refused anyway)",
    ],
  ]);

  it("finds each in a rule's closed URLs: a new `process.env.X ?? 'https://...'` that no rule names would be a live client that the clean environment silently leaves live", () => {
    const covered = new Set(
      TRIAL_RULES.flatMap((r) => [
        ...(r.closedUrls ?? []),
        ...(r.closedUrlsIfSet ?? []),
      ]),
    );
    const found = urlDefaults();
    // the control: the six the code was read to have (so the scan cannot pass by finding nothing)
    for (const known of [
      "NAV_API_URL",
      "UNAS_API_URL",
      "VIES_API_URL",
      "MNB_API_URL",
      "GMAIL_API_URL",
      "GOOGLE_OAUTH_TOKEN_URL",
    ])
      assert.ok(found.has(known), `the scan finds ${known}`);
    const uncovered = [...found.keys()].filter(
      (name) => !covered.has(name) && !NOT_EXTERNAL.has(name),
    );
    assert.deepEqual(uncovered, []);
  });
});

describe("the rules themselves", () => {
  const codeTokens = (): Set<string> => {
    const tokens = new Set<string>();
    const roots = [
      new URL("../../../../apps/api/src/", import.meta.url),
      new URL("../../../../packages/", import.meta.url),
    ];
    const walk = (dir: URL): void => {
      for (const entry of readdirSync(dir)) {
        if (
          ["node_modules", "dist", "test-dist", "generated", ".turbo"].includes(
            entry,
          )
        )
          continue;
        const next = new URL(
          entry + (statSync(new URL(entry, dir)).isDirectory() ? "/" : ""),
          dir,
        );
        if (statSync(next).isDirectory()) walk(next);
        else if (/\.ts$/.test(entry) && !/\.(spec|test)\.ts$/.test(entry))
          for (const m of readFileSync(next, "utf8").matchAll(
            /\b[A-Z][A-Z0-9_]{2,}\b/g,
          ))
            tokens.add(m[0]);
      }
    };
    for (const root of roots) walk(root);
    return tokens;
  };

  it("names only variables the code reads, and prefixes some variable starts with (a typo would protect nothing)", () => {
    const tokens = codeTokens();
    const names = (rule: TrialRule): string[] => [
      ...(rule.absent ?? []),
      ...(rule.except ?? []),
      ...Object.keys(rule.mustBe ?? {}),
      ...Object.keys(rule.unsetOr ?? {}),
      ...(rule.closedUrls ?? []),
      ...(rule.closedUrlsIfSet ?? []),
    ];
    const missing: string[] = [];
    for (const rule of TRIAL_RULES) {
      for (const name of names(rule))
        if (!tokens.has(name)) missing.push(`${rule.check}: ${name}`);
      for (const prefix of rule.absentPrefixes ?? [])
        if (![...tokens].some((t) => t.startsWith(prefix)))
          missing.push(`${rule.check}: prefix ${prefix}`);
    }
    assert.deepEqual(missing, []);
  });

  it("has one rule per check name, and a name for every rule", () => {
    const names = TRIAL_RULES.map((r) => r.check);
    assert.equal(new Set(names).size, names.length);
    for (const wanted of [
      "mail",
      "push",
      "invoicing",
      "payment",
      "NAV",
      "GLS and Foxpost",
      "Brevo",
      "UNAS",
    ])
      assert.ok(
        names.some((n) => n.includes(wanted)),
        wanted,
      );
  });
});
