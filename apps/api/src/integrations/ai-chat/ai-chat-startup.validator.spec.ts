import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AI_CHAT_BASE_URL_ENV, AI_CHAT_TOKEN_ENV } from "./ai-chat.config.js";
import { AiChatStartupValidator } from "./ai-chat-startup.validator.js";

/**
 * A naplo-sorokat olvassuk vissza, nem azt, hogy "lefutott".
 *
 * Az egesz osztaly ertelme EGYETLEN mondat tartalma: megmondja-e, MELYIK fele
 * hianyzik. Egy teszt, ami csak annyit allit, hogy figyelmeztetett, pontosan
 * azt hagyna ki, amiert megirtuk.
 */
const capture = (environment: NodeJS.ProcessEnv) => {
  const validator = new AiChatStartupValidator(environment);
  const lines: string[] = [];

  // A Nest loggere peldany-szintu; a valos hivast fogjuk el rajta.
  (validator as unknown as { logger: { warn(message: string): void } }).logger =
    {
      warn: (message: string) => lines.push(message),
    };

  validator.onModuleInit();

  return lines;
};

const TOKEN = "ai-access-token-that-must-never-leak";
const BASE_URL = "https://ai-stage.example";

describe("AiChatStartupValidator", () => {
  it("hallgat, ha mindketto megvan", () => {
    assert.deepEqual(
      capture({
        [AI_CHAT_BASE_URL_ENV]: BASE_URL,
        [AI_CHAT_TOKEN_ENV]: TOKEN,
      }),
      [],
    );
  });

  it("megnevezi a hianyzo TOKENT, nem csak azt, hogy valami hianyzik", () => {
    // Ez a mai eles eset: a cim ki van toltve, a token nem.
    const lines = capture({ [AI_CHAT_BASE_URL_ENV]: BASE_URL });

    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /ACROPORA_AI_ACCESS_TOKEN/);
    assert.doesNotMatch(lines[0]!, /ACROPORA_AI_BASE_URL/);
  });

  it("megnevezi a hianyzo CIMET is, ha az hianyzik", () => {
    const lines = capture({ [AI_CHAT_TOKEN_ENV]: TOKEN });

    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /ACROPORA_AI_BASE_URL/);
    assert.doesNotMatch(lines[0]!, /ACROPORA_AI_ACCESS_TOKEN/);
  });

  it("mindkettot megnevezi, ha egyik sincs beallitva", () => {
    const lines = capture({});

    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /ACROPORA_AI_BASE_URL/);
    assert.match(lines[0]!, /ACROPORA_AI_ACCESS_TOKEN/);
  });

  it("az ures es a csak-szokozos erteket is hianynak veszi", () => {
    // A beallitas-olvaso is trimmel, tehat a ketto egyutt mozog: ami ott
    // hianynak szamit, annak itt is annak kell.
    const lines = capture({
      [AI_CHAT_BASE_URL_ENV]: "   ",
      [AI_CHAT_TOKEN_ENV]: "",
    });

    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /ACROPORA_AI_BASE_URL/);
    assert.match(lines[0]!, /ACROPORA_AI_ACCESS_TOKEN/);
  });

  it("SOHA nem irja a naploba a token erteket", () => {
    /**
     * A hianyzo valtozok NEVE mehet ki, az ERTEKUK nem. Itt a token JELEN VAN
     * es a cim hianyzik - vagyis van mit kiszivarogtatni, es a sornak megsem
     * szabad tartalmaznia.
     */
    const lines = capture({ [AI_CHAT_TOKEN_ENV]: TOKEN });

    assert.equal(lines.join("\n").includes(TOKEN), false);
  });

  it("nem dob, mert egy belso mero-eszkoz nem allithatja meg az APIt", () => {
    // A rendeles, a szamlazas es a raktar mukodik akkor is, ha az AI-felulet
    // nem tud hivni. Egy valaszto, ami emiatt megfogja az indulast, nagyobb
    // kart okoz, mint amit megelozne.
    assert.doesNotThrow(() => capture({}));
  });
});

describe("AiChatStartupValidator hasonlo nevu valtozok", () => {
  it("megnevezi azt a valtozot, ami UGYANARRA VEGZODIK, mint a hianyzo", () => {
    /**
     * A 2026-08-27 hajnali eset pontos alakja. Az ertek nem hianyzott: az AI
     * oldali API_ACCESS_TOKEN nevet masoltak at oda, ahol
     * ACROPORA_AI_ACCESS_TOKEN a helyes. A puszta "hianyzik" sor ilyenkor
     * IGAZ, es megis azt valtja ki, hogy "dehogy hianyzik, felvettem".
     */
    const lines = capture({
      [AI_CHAT_BASE_URL_ENV]: BASE_URL,
      API_ACCESS_TOKEN: TOKEN,
    });

    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /ACROPORA_AI_ACCESS_TOKEN/);
    assert.match(lines[0]!, /API_ACCESS_TOKEN/);
  });

  it("SOHA nem irja ki a hasonlo nevu valtozo ERTEKET sem", () => {
    // A nev nem titok, az ertek az. Itt van mit kiszivarogtatni: a
    // hasonlo nevu valtozo epp a valos tokent tartalmazza.
    const lines = capture({
      [AI_CHAT_BASE_URL_ENV]: BASE_URL,
      API_ACCESS_TOKEN: TOKEN,
    });

    assert.equal(lines.join("\n").includes(TOKEN), false);
  });

  it("nem emlit olyat, ami URES, mert az nem magyarazna semmit", () => {
    const lines = capture({
      [AI_CHAT_BASE_URL_ENV]: BASE_URL,
      API_ACCESS_TOKEN: "   ",
    });

    assert.equal(lines.length, 1);
    assert.doesNotMatch(lines[0]!, /API_ACCESS_TOKEN/);
  });

  it("nem talal ki hasonlosagot ott, ahol nincs", () => {
    const lines = capture({
      [AI_CHAT_BASE_URL_ENV]: BASE_URL,
      DATABASE_URL: "postgres://x",
      REDIS_URL: "redis://y",
    });

    assert.equal(lines.length, 1);
    assert.doesNotMatch(lines[0]!, /DATABASE_URL/);
    assert.doesNotMatch(lines[0]!, /REDIS_URL/);
  });

  it("legfeljebb harmat sorol fel, mert egy hosszu lista mar zaj", () => {
    const lines = capture({
      [AI_CHAT_BASE_URL_ENV]: BASE_URL,
      A_ACCESS_TOKEN: "1",
      B_ACCESS_TOKEN: "2",
      C_ACCESS_TOKEN: "3",
      D_ACCESS_TOKEN: "4",
      E_ACCESS_TOKEN: "5",
    });

    const mentioned = ["A", "B", "C", "D", "E"].filter((prefix) =>
      lines[0]!.includes(`${prefix}_ACCESS_TOKEN`),
    );

    assert.equal(mentioned.length, 3);
  });
});
