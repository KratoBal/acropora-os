import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@acropora/database";
import {
  AI_CHAT_SETTINGS_DEFAULTS,
  type AiChatSettings,
} from "@acropora/types";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import {
  AI_CHAT_SETTING_ID,
  AiChatSettingsRepository,
} from "./ai-chat-settings.repository.js";

/**
 * THE OFF-TOPIC THRESHOLD IN THE DATABASE (card f5b8f7ba; Balázs 2026-11-11 08:51: 5, settable in the Settings). WHAT TURNS IT
 * RED: a saved threshold does not come back; the column's default is not 5 (a row saved before this column must read 5); the
 * database takes a 1 or a 21 when the server's rule is bypassed. The one settings row is put back as it was.
 */
const gate = integrationDatabaseGate(process.env);
describe(
  "AI chat settings: the off-topic threshold against the database",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new AiChatSettingsRepository();
    let original: AiChatSettings | null = null;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      original = await repository.find();
    });

    after(async () => {
      if (original) await repository.save(original, null);
      else
        await prisma.aiChatSetting.deleteMany({
          where: { id: AI_CHAT_SETTING_ID },
        });
    });

    it("a saved threshold comes back, and a row written without it reads Balázs's 5", async () => {
      await repository.save(
        { ...AI_CHAT_SETTINGS_DEFAULTS, offTopicFirmAt: 7 },
        null,
      );
      assert.equal((await repository.find())?.offTopicFirmAt, 7);

      // a row as an older writer leaves it: the column's own default decides
      await prisma.aiChatSetting.deleteMany({
        where: { id: AI_CHAT_SETTING_ID },
      });
      await prisma.$executeRaw`INSERT INTO "AiChatSetting" ("id", "updatedAt") VALUES (${AI_CHAT_SETTING_ID}, NOW())`;
      assert.equal((await repository.find())?.offTopicFirmAt, 5);
    });

    it("the database refuses a threshold outside 2 to 20 even when the server's rule is bypassed", async () => {
      for (const value of [1, 21])
        await assert.rejects(
          prisma.aiChatSetting.upsert({
            where: { id: AI_CHAT_SETTING_ID },
            create: { id: AI_CHAT_SETTING_ID, offTopicFirmAt: value },
            update: { offTopicFirmAt: value },
          }),
          /AiChatSetting_offTopicFirmAt_range/,
          String(value),
        );
    });
  },
);
