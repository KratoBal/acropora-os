import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PERMISSIONS } from "@acropora/types";

import { AiChatSettingsAdminController } from "./ai-chat-settings.admin.controller.js";
import { AiChatSettingsGuard } from "./ai-chat-settings.guard.js";
import { AiChatSettingsReaderController } from "./ai-chat-settings.reader.controller.js";

/**
 * The wiring a route spec of the whole app would see, read from the decorators' metadata: which permission the admin routes need,
 * and that the AI service's route is public to the session guard but behind its own token guard.
 */
const meta = (key: string, target: object, property?: string | symbol) =>
  property === undefined
    ? Reflect.getMetadata(key, target)
    : Reflect.getMetadata(key, target, property);

describe("the AI chat settings routes", () => {
  it("every admin route (the settings and the link sources) needs AI_SETTINGS_MANAGE, and no other permission", () => {
    for (const name of [
      "settings",
      "save",
      "linkSources",
      "addLinkSource",
      "removeLinkSource",
    ] as const) {
      const handler = AiChatSettingsAdminController.prototype[name];
      const permissions = Object.values(Reflect.getMetadataKeys(handler))
        .map((key) => meta(String(key), handler))
        .flat()
        .filter((value) => typeof value === "string");
      assert.deepEqual(
        [...new Set(permissions)].filter((value) =>
          String(value).includes("ai-test"),
        ),
        [PERMISSIONS.AI_SETTINGS_MANAGE],
        name,
      );
    }
  });

  it("the AI service's route is public to the session and guarded by the settings token guard only", () => {
    const guards = Reflect.getMetadata(
      "__guards__",
      AiChatSettingsReaderController,
    ) as unknown[];
    assert.deepEqual(guards, [AiChatSettingsGuard]);
    const keys = Reflect.getMetadataKeys(AiChatSettingsReaderController).map(
      String,
    );
    assert.ok(
      keys.some((key) => key.toLowerCase().includes("public")),
      `no public marker among ${keys.join(", ")}`,
    );
  });

  it("the two controllers have distinct route prefixes, so the admin route cannot shadow the service route", () => {
    const admin = Reflect.getMetadata("path", AiChatSettingsAdminController);
    const reader = Reflect.getMetadata("path", AiChatSettingsReaderController);
    assert.equal(admin, "integrations/ai-chat-settings");
    assert.equal(reader, "integrations/ai-chat-settings/service");
  });
});
