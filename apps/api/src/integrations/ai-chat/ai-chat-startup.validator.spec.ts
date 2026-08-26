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
