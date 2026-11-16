import type { AiChatSettings } from "@acropora/types";

import { apiRequest } from "./client";

/**
 * Az AI csevegés beállításai (Beállítások, kártya f5b8f7ba, 4a). A címek kiírva állnak (a repó útvonal-mérője a kliens-fájlokból
 * olvassa ki őket). Olvasni és menteni is az `AI_SETTINGS_MANAGE` jog tud.
 */
export const aiChatSettingsApi = {
  get(token: string, signal?: AbortSignal) {
    return apiRequest<AiChatSettings>("/integrations/ai-chat-settings", token, {
      signal,
    });
  },
  save(token: string, settings: AiChatSettings) {
    return apiRequest<AiChatSettings>("/integrations/ai-chat-settings", token, {
      method: "PUT",
      body: JSON.stringify(settings),
    });
  },
};
