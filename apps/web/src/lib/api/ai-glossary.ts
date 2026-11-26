import type {
  AiGlossarySaveInput,
  AiGlossarySaveResult,
  AiGlossaryVersion,
  AiGlossaryVersionInfo,
} from "@acropora/types";

import { apiRequest } from "./client";

/** Az AI szolgáltatás szójegyzékének szerkesztője (kártya 7a5ea203, C3). Csak ott él, ahol az `AI_GLOSSARY_EDITOR` kapcsoló be van kapcsolva. */
export const aiGlossaryApi = {
  versions(token: string, signal?: AbortSignal) {
    return apiRequest<{ versions: AiGlossaryVersionInfo[] }>(
      "/ai-glossary/versions",
      token,
      { signal },
    );
  },
  version(token: string, version: number, signal?: AbortSignal) {
    return apiRequest<AiGlossaryVersion>(
      `/ai-glossary/versions/${version}`,
      token,
      { signal },
    );
  },
  save(token: string, input: AiGlossarySaveInput) {
    return apiRequest<AiGlossarySaveResult>("/ai-glossary", token, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },
};
