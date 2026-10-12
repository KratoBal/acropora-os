import type {
  SeoLandingOptions,
  SeoLandingPage,
  SeoLandingPageInput,
} from "@acropora/types";
import { apiRequest } from "./client";

/** The SEO landing pages (SEO P1-14), `products.view` to read, `products.manage` to write. */
export const seoLandingPagesApi = {
  list(token: string, signal?: AbortSignal) {
    return apiRequest<SeoLandingPage[]>("/seo/landing-pages", token, {
      signal,
    });
  },
  options(token: string, signal?: AbortSignal) {
    return apiRequest<SeoLandingOptions>("/seo/landing-pages/options", token, {
      signal,
    });
  },
  detail(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<SeoLandingPage>(
      `/seo/landing-pages/${encodeURIComponent(id)}`,
      token,
      { signal },
    );
  },
  create(token: string, input: SeoLandingPageInput) {
    return apiRequest<SeoLandingPage>("/seo/landing-pages", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  update(token: string, id: string, input: SeoLandingPageInput) {
    return apiRequest<SeoLandingPage>(
      `/seo/landing-pages/${encodeURIComponent(id)}`,
      token,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
};
