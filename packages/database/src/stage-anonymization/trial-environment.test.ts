import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildTrialEnvironment,
  databaseNameOfUrl,
} from "./trial-environment.js";

/*
  THE TRIAL'S ENVIRONMENT. WHAT TURNS THIS RED: an environment that is bound to a database that is not a temporary one; a variable
  copied from the operator's shell (a live key); a variable added without anyone deciding it (the key list is pinned); a scheduler or
  a closed address that went missing.
*/
const input = {
  databaseUrl: "postgresql://u:p@localhost:5432/stage_anon_tmp_trial_x",
  port: 3999,
};

describe("buildTrialEnvironment", () => {
  it("binds the instance to the temporary database and the given port, and sets nothing else a person did not decide (the key list is pinned)", () => {
    const env = buildTrialEnvironment(input);
    assert.equal(env.DATABASE_URL, input.databaseUrl);
    assert.equal(env.PORT, "3999");
    assert.deepEqual(Object.keys(env).sort(), [
      "BUYER_TAX_CHECK_ENABLED",
      "DATABASE_URL",
      "EXTERNAL_INVOICE_MAIL_PDF_SCHEDULE",
      "EXTERNAL_INVOICE_PDF_SCHEDULE",
      "FOXPOST_API_MODE",
      "GLS_API_MODE",
      "GMAIL_API_URL",
      "GOOGLE_OAUTH_TOKEN_URL",
      "MEDUSA_ADMIN_URL",
      "MNB_API_URL",
      "NAV_API_URL",
      "NODE_ENV",
      "PARTNER_DUPLICATE_REPORT_ENABLED",
      "PATH",
      "PORT",
      "REDIS_URL",
      "SZAMLAZZ_AGENT_MODE",
      "TICKET_MAIL_MODE",
      "TZ",
      "UNAS_API_URL",
      "VIES_API_URL",
    ]);
    assert.equal(env.NODE_ENV, "staging");
    assert.equal(env.SZAMLAZZ_AGENT_MODE, "stub");
  });

  it("copies NOTHING from the process environment (a live key in the shell must not reach the instance)", () => {
    const saved = { ...process.env };
    process.env.UNAS_API_KEY = "kulcs-ami-nem-mehet";
    process.env.SZAMLAZZ_AGENT_KEY = "masik-kulcs";
    process.env.AUTH_PROVIDER = "development";
    try {
      const env = buildTrialEnvironment({ ...input, path: "/opt/bin" });
      const text = JSON.stringify(env);
      assert.ok(!text.includes("kulcs-ami-nem-mehet"));
      assert.ok(!text.includes("masik-kulcs"));
      assert.equal(env.AUTH_PROVIDER, undefined);
      assert.equal(env.UNAS_API_KEY, undefined);
      assert.equal(
        Object.entries(env).find(([key]) => key === "PATH")?.[1],
        "/opt/bin",
      );
    } finally {
      for (const key of ["UNAS_API_KEY", "SZAMLAZZ_AGENT_KEY", "AUTH_PROVIDER"])
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
    }
  });

  it("refuses a database that is not a temporary one, or a URL with no database, before it builds anything", () => {
    for (const databaseUrl of [
      "postgresql://u:p@host:5432/acropora",
      "postgresql://u:p@host:5432/acropora_stage",
      "postgresql://u:p@host:5432/",
      "postgresql://u:p@host:5432",
      "not a url",
    ])
      assert.throws(
        () => buildTrialEnvironment({ ...input, databaseUrl }),
        /temporary database|names no database/,
        databaseUrl,
      );
  });

  it("reads the database name from the URL path, decoded, ignoring the query", () => {
    assert.equal(
      databaseNameOfUrl(
        "postgresql://u:p@h:5432/stage_anon_tmp_a?schema=public",
      ),
      "stage_anon_tmp_a",
    );
    assert.equal(databaseNameOfUrl("postgresql://u:p@h/"), null);
  });
});
