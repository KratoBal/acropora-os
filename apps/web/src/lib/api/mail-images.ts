import { apiAuthHeaders, apiRequest } from "./client";
import { API_PREFIX } from "./api-prefix";

/**
 * A LEVELSABLON KEPEI (2026-09-28). A kep a sablon HTML-jeben
 * `acropora-image:<id>` hivatkozaskent all; a tartalmat a szerkeszto es az
 * elonezet ezen az uton, a sajat hitelesitesevel tolti be. Publikus kep-cim
 * nincs.
 */
export interface MailImage {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  width: number;
  height: number;
  createdAt: string;
}

const base = "/notifications/mail-images";

export const mailImagesApi = {
  list(token: string, options: { signal?: AbortSignal } = {}) {
    return apiRequest<MailImage[]>(base, token, { signal: options.signal });
  },

  upload(token: string, file: File): Promise<MailImage> {
    const form = new FormData();
    form.append("file", file);
    return apiRequest<MailImage>(base, token, { method: "POST", body: form });
  },

  async content(token: string, id: string): Promise<Blob> {
    const response = await fetch(
      `${API_PREFIX}${base}/${encodeURIComponent(id)}/content`,
      { credentials: "same-origin", headers: apiAuthHeaders(token) },
    );
    if (!response.ok) throw new Error("A kép nem tölthető be.");
    return response.blob();
  },
};
