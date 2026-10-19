import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  assertReefClubEnvironment,
  forbiddenEnvironmentNames,
  forbiddenReason,
} from "./reefclub-environment.js";

/**
 * Every environment name the INTERNAL code reads (from the sources, not from a
 * hand-kept list) and every name in `.env.example`. Read at test time, so a
 * new internal variable is in the set the moment it is written.
 */
function internalEnvironmentNames(): Set<string> {
  const names = new Set<string>();
  const pattern = /(?:process\.env|environment|env)\.([A-Z][A-Z0-9_]+)/g;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (entry !== "reefclub") walk(path);
      } else if (path.endsWith(".ts") && !entry.startsWith("main-reefclub")) {
        for (const match of readFileSync(path, "utf8").matchAll(pattern))
          names.add(match[1]!);
      }
    }
  };
  walk("src");
  for (const line of readFileSync("../../.env.example", "utf8").split("\n")) {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (match) names.add(match[1]!);
  }
  return names;
}

/**
 * THE INTERNAL NAMES THE REEFCLUB PROCESS MAY STILL CARRY, AS AN EXPLICIT
 * LIST: none of them is a secret (addresses, switches, intervals, release
 * metadata), and a refusal on them would only make the deploy configuration
 * longer. `NEV` and `PELDA_*` are not variables at all: they come from code
 * comments the source scan reads.
 *
 * A NEW INTERNAL NAME THAT THE RULE DOES NOT REFUSE TURNS THE TEST BELOW RED,
 * and the fix is a decision: either the rule refuses it (a secret, an
 * integration), or it is added here with the reason it is harmless.
 */
const NOT_SECRET_INTERNAL_NAMES = new Set([
  "API_KEEP_ALIVE_TIMEOUT_MS",
  "API_URL",
  "APP_URL",
  "AQUARIUM_MEASUREMENT_MAIL_FROM",
  "AQUARIUM_MEASUREMENT_MAIL_FROM_NAME",
  "ASSET_QR_BASE_URL",
  "BILLING_ISSUE_ENABLED",
  "HANDOVER_MAIL_MAX_ATTACHMENT_BYTES",
  "INCOMING_FOREIGN_READ_ENABLED",
  "INCOMING_FOREIGN_READ_INTERVAL_MINUTES",
  "INCOMING_FOREIGN_READ_SINCE",
  "MAINTENANCE_INVOICE_ISSUE_ENABLED",
  "MISSING_INVOICES_DRIVE_FOLDER_URL",
  "MNB_API_URL",
  "NEV",
  "NEXT_PROXY_TIMEOUT_MS",
  "NODE_ENV",
  "OWN_IMAGE_REFERENCE_HOSTS",
  "PAID_MARKS_AUTO_DAYS",
  "PAID_MARKS_AUTO_HOUR",
  "PARTNER_URL",
  "PELDA_KOMMENT",
  "PELDA_KOZVETLEN",
  "PORT",
  "PUSH_REDIRECT_TO_USER_IDS",
  "QUOTES_ENABLED",
  "QUOTES_PILOT_USER_IDS",
  "RELEASE_COMMIT_SHA",
  "RELEASE_EVIDENCE_EXPECTED_REPOSITORY",
  "RELEASE_IMAGE_COMMIT_SHA",
  "RUN_BRAND_INTEGRATION",
  "RUN_DB_INTEGRATION",
  "VIES_API_URL",
  "WEB_URL",
]);

describe("ReefClub környezet-lista (terv v6.1, 2.1)", () => {
  it("a terv négy megnevezett belső titka megállítja az indulást", () => {
    for (const name of [
      "ACROPORA_AI_ACCESS_TOKEN",
      "GMAIL_TICKET_REFRESH_TOKEN",
      "SESSION_SECRET",
      "DATABASE_URL",
    ])
      assert.ok(forbiddenReason(name), `${name} át kellene, hogy essen? nem`);
  });

  it("a forrás minden belső változóját vagy tiltja, vagy kifejezetten nem-titoknak sorolja", () => {
    const names = internalEnvironmentNames();
    // The control on the scan: an empty or truncated set would pass anything.
    assert.ok(names.size > 200, `csak ${names.size} nevet talált a keresés`);
    assert.ok(names.has("GMAIL_TICKET_REFRESH_TOKEN"));

    const unclassified = [...names].filter(
      (name) => !forbiddenReason(name) && !NOT_SECRET_INTERNAL_NAMES.has(name),
    );
    assert.deepEqual(
      unclassified.sort(),
      [],
      "új belső változó, amit a ReefClub-szabály nem tilt és a lista nem sorol be",
    );
  });

  it("a nem-titok lista minden eleme létező belső név, és egyiket sem tiltja a szabály", () => {
    const names = internalEnvironmentNames();
    for (const name of NOT_SECRET_INTERNAL_NAMES) {
      assert.ok(names.has(name), `${name}: már nem olvassa a belső kód`);
      assert.equal(forbiddenReason(name), null, name);
    }
  });

  it("egy új, ismeretlen szolgáltató titka a név alakja miatt megáll", () => {
    for (const name of [
      "NEWVENDOR_API_KEY",
      "NEWVENDOR_ACCESS_TOKEN",
      "WEBHOOK_SIGNING_SECRET",
      "X_PASSWORD",
      "FOO_PRIVATE_PEM",
      "BAR_SERVICE_ACCOUNT_JSON",
      "MASTER_KEY_V2",
    ])
      assert.ok(forbiddenReason(name), name);
  });

  it("a REEFCLUB_ előtag alatti titok megengedett, az az övé", () => {
    for (const name of [
      "REEFCLUB_DATABASE_URL",
      "REEFCLUB_MAIL_CLIENT_SECRET",
      "REEFCLUB_MAIL_REFRESH_TOKEN",
    ])
      assert.equal(forbiddenReason(name), null, name);
  });

  it("minden tiltott nevet egyszerre felsorol, értéket egyet sem", () => {
    const environment = {
      REEFCLUB_DATABASE_URL: "postgresql://rc",
      DATABASE_URL: "postgresql://titkos-belso",
      UNAS_API_KEY: "titkos-unas",
      PATH: "/usr/bin",
    };
    assert.deepEqual(forbiddenEnvironmentNames(environment), [
      "DATABASE_URL (titok alakú név)",
      "UNAS_API_KEY (titok alakú név)",
    ]);
    assert.throws(
      () => assertReefClubEnvironment(environment),
      (error: Error) =>
        error.message.includes("DATABASE_URL") &&
        error.message.includes("UNAS_API_KEY") &&
        !error.message.includes("titkos"),
    );
  });

  it("az üres értékű tiltott név is megállít: a belső .env betöltése maga a jel", () => {
    assert.throws(() => assertReefClubEnvironment({ SESSION_SECRET: "" }));
  });

  it("productionben a saját adatbázis-cím és a webcím nélkül sem indul", () => {
    assert.throws(
      () => assertReefClubEnvironment({ NODE_ENV: "production" }),
      /REEFCLUB_DATABASE_URL, REEFCLUB_WEB_URL/,
    );
    assert.doesNotThrow(() =>
      assertReefClubEnvironment({
        NODE_ENV: "production",
        REEFCLUB_DATABASE_URL: "postgresql://rc",
        REEFCLUB_WEB_URL: "https://reefclub.example",
        PATH: "/usr/bin",
        HOSTNAME: "x",
      }),
    );
  });
});
