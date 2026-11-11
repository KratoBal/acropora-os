import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import {
  AI_CHAT_SETTINGS_DEFAULTS,
  type AiChatSettings,
  type AiLinkSource,
  type AiLinkSourceInput,
  type AuthenticatedUser,
} from "@acropora/types";

import type { AiChatSettingsRepository } from "./ai-chat-settings.repository.js";
import { AiChatSettingsService } from "./ai-chat-settings.service.js";

const USER = { id: "user-1", displayName: "Teszt Elek" } as AuthenticatedUser;

function fakeRepository(
  initial: AiChatSettings | null,
  sources: AiLinkSource[] = [],
) {
  const state = {
    row: initial,
    saves: [] as Array<{ settings: AiChatSettings; userId: string | null }>,
    sources: [...sources],
    added: [] as Array<{ input: AiLinkSourceInput; userId: string | null }>,
    removed: [] as Array<{ id: string; userId: string | null }>,
  };
  // the catalogue's brands, in the catalogue's own spelling
  const brands = ["Red Sea", "Tropic Marin"];
  const repository = {
    find: async () => state.row,
    save: async (settings: AiChatSettings, userId: string | null) => {
      state.saves.push({ settings, userId });
      state.row = settings;
    },
    linkSources: async () => state.sources,
    brandName: async (name: string) =>
      brands.find((brand) => brand.toLowerCase() === name.toLowerCase()) ??
      null,
    addLinkSource: async (input: AiLinkSourceInput, userId: string | null) => {
      if (state.sources.some((source) => source.host === input.host))
        return null;
      state.added.push({ input, userId });
      const row = {
        ...input,
        id: `src-${state.sources.length + 1}`,
        createdAt: "2026-11-11T10:00:00.000Z",
      };
      state.sources.push(row);
      return row;
    },
    removeLinkSource: async (id: string, userId: string | null) => {
      const before = state.sources.length;
      state.sources = state.sources.filter((source) => source.id !== id);
      if (state.sources.length === before) return false;
      state.removed.push({ id, userId });
      return true;
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
      linkSources: [],
    });
    const view = JSON.stringify(await service.serviceView());
    assert.equal(view.includes("@"), false);
    assert.equal(view.includes("contactRecipientEmail"), false);
    assert.equal(view.includes("Handled"), false);
  });

  it("the service view of an unsaved row is the defaults' (offer OFF: a setting nobody saved never reads as on)", async () => {
    const { service } = fakeRepository(null);
    assert.deepEqual(await service.serviceView(), {
      offerEnabled: false,
      contactRequestEnabled: false,
      messageRetentionDays: 180,
      linkSources: [],
    });
  });
});

/**
 * THE STORED LINK SOURCES (card 9d060f5c). WHAT TURNS IT RED: the AI service gets a source's note, id or author;
 * a brand is stored in another spelling than the catalogue's (the gate compares it with the hits' brand) or one
 * the catalogue does not have; an addition or a removal is written without the session's user.
 */
describe("AiChatSettingsService: the stored link sources", () => {
  const listed: AiLinkSource = {
    id: "src-1",
    host: "redseafish.com",
    category: "MANUFACTURER_DOCUMENT",
    brand: "Red Sea",
    note: "a gyártó adatlapjai, Kovács Béla kérte",
    createdAt: "2026-11-11T09:00:00.000Z",
  };

  it("the AI service reads host, category and brand of every source, and not the note, the id or the date", async () => {
    const { service } = fakeRepository(null, [
      listed,
      {
        ...listed,
        id: "src-2",
        host: "nebih.gov.hu",
        category: "AUTHORITY",
        brand: null,
        note: null,
      },
    ]);
    const view = await service.serviceView();
    assert.deepEqual(view.linkSources, [
      {
        host: "redseafish.com",
        category: "MANUFACTURER_DOCUMENT",
        brand: "Red Sea",
      },
      { host: "nebih.gov.hu", category: "AUTHORITY", brand: null },
    ]);
    const text = JSON.stringify(view);
    for (const hidden of ["Kovács", "src-1", "2026-11-11", "note", "createdAt"])
      assert.equal(text.includes(hidden), false, hidden);
  });

  it("an addition is checked, the brand stored in the catalogue's spelling, the author is the session's user", async () => {
    const { service, state } = fakeRepository(null);
    const added = await service.addLinkSource(
      {
        host: "RedSeaFish.com",
        category: "MANUFACTURER_DOCUMENT",
        brand: "red sea",
        note: "",
        createdById: "someone-else",
      },
      USER,
    );
    assert.equal(added.brand, "Red Sea");
    assert.deepEqual(state.added, [
      {
        input: {
          host: "redseafish.com",
          category: "MANUFACTURER_DOCUMENT",
          brand: "Red Sea",
          note: null,
        },
        userId: "user-1",
      },
    ]);
  });

  it("a brand the catalogue does not have, and a shape the rule refuses, store NOTHING", async () => {
    const { service, state } = fakeRepository(null);
    for (const bad of [
      {
        host: "redseafish.com",
        category: "MANUFACTURER_DOCUMENT",
        brand: "Red See",
      },
      {
        host: "https://redseafish.com/x",
        category: "MANUFACTURER_DOCUMENT",
        brand: "Red Sea",
      },
      { host: "shop.acropora.hu", category: "AUTHORITY" },
    ])
      await assert.rejects(
        service.addLinkSource(bad, USER),
        BadRequestException,
        JSON.stringify(bad),
      );
    assert.equal(state.added.length, 0);
  });

  it("an authority is stored with no brand lookup", async () => {
    const { service, state } = fakeRepository(null);
    await service.addLinkSource(
      { host: "nebih.gov.hu", category: "AUTHORITY" },
      USER,
    );
    assert.deepEqual(state.added[0]?.input.brand, null);
  });

  it("a host already listed is a conflict, an unknown id on removal is not found", async () => {
    const { service, state } = fakeRepository(null, [listed]);
    await assert.rejects(
      service.addLinkSource(
        { host: "redseafish.com", category: "AUTHORITY" },
        USER,
      ),
      ConflictException,
    );
    await assert.rejects(
      service.removeLinkSource("nincs-ilyen", USER),
      NotFoundException,
    );
    await service.removeLinkSource("src-1", USER);
    assert.deepEqual(state.removed, [{ id: "src-1", userId: "user-1" }]);
    assert.deepEqual((await service.serviceView()).linkSources, []);
  });
});
