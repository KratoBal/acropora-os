import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthenticatedUser } from "@acropora/types";

import { AiChatController } from "./ai-chat.controller.js";
import type { AiChatService } from "./ai-chat.service.js";

/**
 * THE CONVERSATION BELONGS TO THE SESSION USER (card 7a5ea203). WHAT TURNS IT RED: the controller asks without the session user, so
 * the AI service keeps every OS conversation under its shared fallback key; or it takes the user from anything but the session.
 */
describe("AiChatController.ask", () => {
  it("passes the session user's id with the question, and nothing from the body decides it", async () => {
    const asked: unknown[] = [];
    const service = {
      ask: async (input: unknown) => {
        asked.push(input);
        return {};
      },
    } as unknown as AiChatService;
    const controller = new AiChatController(service);
    await controller.ask(
      {
        message: "Szia",
        conversationId: "6f1d0a2c-1b7e-4a3f-9c2d-8b5e4f7a1c30",
        userId: "valaki-mas",
      } as never,
      { id: "user_7" } as AuthenticatedUser,
    );
    assert.deepEqual(asked, [
      {
        message: "Szia",
        conversationId: "6f1d0a2c-1b7e-4a3f-9c2d-8b5e4f7a1c30",
        userId: "user_7",
      },
    ]);
  });
});
