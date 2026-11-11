import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  AI_CHAT_SETTINGS_DEFAULTS,
  type AiChatSettings,
  type AuthenticatedUser,
} from "@acropora/types";

import type { AiChatSettingsRepository } from "./ai-chat-settings.repository.js";
import { AiChatSettingsService } from "./ai-chat-settings.service.js";

const USER = { id: "user-1", displayName: "Teszt Elek" } as AuthenticatedUser;

function fakeRepository(initial: AiChatSettings | null) {
  const state = {
    row: initial,
    saves: [] as Array<{ settings: AiChatSettings; userId: string | null }>,
  };
  const repository = {
    find: async () => state.row,
    save: async (settings: AiChatSettings, userId: string | null) => {
      state.saves.push({ settings, userId });
      state.row = settings;
    },
  } as unknown as AiChatSettingsRepository;
  return { state, service: new AiChatSettingsService(repository) };
}

const body = {
  offerEnabled: true,
  contactRequestEnabled: true,
  contactRecipientEmail: "ugyfel@acropora.hu",
  messageRetentionDays: 120,
  contactHandledRetentionDays: 30,
  contactUnhandledRetentionDays: 60,
};

describe("AiChatSettingsService", () => {
  it("before the first save it reads the plan's proposed defaults (nothing to load after the deploy)", async () => {
    const { service } = fakeRepository(null);
    assert.deepEqual(await service.settings(), AI_CHAT_SETTINGS_DEFAULTS);
  });

  it("a save is checked by the shared rule, stored with the session's user, and returned", async () => {
    const { service, state } = fakeRepository(null);
    const saved = await service.save(
      { ...body, updatedById: "someone-else" },
      USER,
    );
    assert.deepEqual(saved, body);
    assert.deepEqual(state.saves, [{ settings: body, userId: "user-1" }]);
  });

  it("S4: a value outside the limits is refused with the rule's sentence and NOTHING is stored", async () => {
    const { service, state } = fakeRepository(null);
    for (const bad of [
      { messageRetentionDays: 6 },
      { messageRetentionDays: 366 },
      { contactHandledRetentionDays: 181 },
      { contactRequestEnabled: true, contactRecipientEmail: null },
    ]) {
      await assert.rejects(
        service.save({ ...body, ...bad }, USER),
        BadRequestException,
        JSON.stringify(bad),
      );
    }
    assert.equal(state.saves.length, 0);
  });

  it("the AI service's view holds the three values it acts on and NOTHING else (the recipient never leaves the OS)", async () => {
    const { service } = fakeRepository(body);
    assert.deepEqual(await service.serviceView(), {
      offerEnabled: true,
      contactRequestEnabled: true,
      messageRetentionDays: 120,
    });
    const view = JSON.stringify(await service.serviceView());
    assert.equal(view.includes("@"), false);
    assert.equal(view.includes("contactRecipientEmail"), false);
    assert.equal(view.includes("Handled"), false);
  });

  it("the service view of an unsaved row is the defaults', so the AI service reads something sane before anybody saved", async () => {
    const { service } = fakeRepository(null);
    assert.deepEqual(await service.serviceView(), {
      offerEnabled: true,
      contactRequestEnabled: false,
      messageRetentionDays: 180,
    });
  });
});
