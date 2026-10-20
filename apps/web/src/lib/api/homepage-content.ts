import type { HomepageContent, HomepageContentInput } from "@acropora/types";
import { apiRequest } from "./client";

/** A product marked for the home page's "Egyedi korallok" band. */
export interface HomepageFeaturedProduct {
  productId: string;
  name: string;
  sortOrder: number;
}

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
  /** The products marked for the "Egyedi korallok" band, in order. */
  featured(token: string, signal?: AbortSignal) {
    return apiRequest<HomepageFeaturedProduct[]>(
      "/homepage-content/featured",
      token,
      { signal },
    );
  },
  /** Marks or unmarks one product (the product page's checkbox). */
  setFeatured(token: string, productId: string, featured: boolean) {
    return apiRequest<{
      featured: boolean;
      list: HomepageFeaturedProduct[];
      projection: HomepageContentSaved["projection"];
    }>(`/homepage-content/featured/${encodeURIComponent(productId)}`, token, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ featured }),
    });
  },
  /** The administrator's switch: send the content to the shop and allow uploads. */
  setProjection(token: string, enabled: boolean) {
    return apiRequest<{ projectionEnabled: boolean }>(
      "/homepage-content/projection",
      token,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      },
    );
  },
  /** One image to the shop's file storage; the answer is its public address. */
  uploadImage(token: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    return apiRequest<{ url: string }>("/homepage-content/images", token, {
      method: "POST",
      body: form,
    });
  },
  save(token: string, input: HomepageContentInput) {
    return apiRequest<HomepageContentSaved>("/homepage-content", token, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
};
