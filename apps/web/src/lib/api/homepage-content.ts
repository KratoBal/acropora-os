import type { HomepageContent, HomepageContentInput } from "@acropora/types";
import { apiRequest } from "./client";

/** What a save answers: the stored content, and what happened to the shop projection. */
export interface HomepageContentSaved {
  content: HomepageContent;
  projection: "off" | "sent" | "unchanged" | "failed";
}

/** The web shop's home page content, `products.view` to read, `products.manage` to write. */
export const homepageContentApi = {
  get(token: string, signal?: AbortSignal) {
    return apiRequest<HomepageContent>("/homepage-content", token, { signal });
  },
  save(token: string, input: HomepageContentInput) {
    return apiRequest<HomepageContentSaved>("/homepage-content", token, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
};
