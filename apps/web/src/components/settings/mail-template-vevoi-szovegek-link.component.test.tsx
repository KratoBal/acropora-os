import type { NavigationEntryView } from "@acropora/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MailTemplatePage } from "./mail-template-page";

/*
  A LEVÉLSABLONOK WEBSHOP FÜLÉRŐL VISSZA A VEVŐI SZÖVEGEKRE (kártya 7bfca4eb; Balázs, 2026-11-24: egy felület). MI PIROSÍT: a link
  nem a Vevői szövegek lapra visz; a kapcsoló (webshop-customer-texts) nélkül is megjelenik (a lap ott nincs); a Szerviz fülön is
  ott áll.
*/
const auth = vi.hoisted(() => ({
  navigation: [] as Pick<NavigationEntryView, "id">[],
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      token: "token-1",
      user: { id: "user-1", email: "b@acropora.local", role: "OWNER" },
      navigation: auth.navigation,
    },
  }),
}));

const api = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/api/mail-templates", async () => {
  const valodi = await vi.importActual<
    typeof import("@/lib/api/mail-templates")
  >("@/lib/api/mail-templates");
  return { ...valodi, mailTemplatesApi: api };
});
vi.mock("@/lib/api/mail-images", () => ({
  mailImagesApi: {
    list: vi.fn().mockResolvedValue([]),
    upload: vi.fn(),
    content: vi.fn(),
  },
}));
// the stuck mails block reads the shop; it is not what this test measures
vi.mock("@/components/settings/webshop-stuck-mails", () => ({
  WebshopStuckMails: () => null,
}));

beforeEach(() => {
  auth.navigation = [];
  // the response in its real shape (the editor's own test, mail-template-page.component.test.tsx): a thinner double breaks the page
  api.read.mockReset().mockResolvedValue({
    id: "WORKSHEET_SIGNED",
    source: "default",
    defaultTemplate: { subject: "Tárgy", body: "Törzs" },
    subject: "Tárgy",
    body: "Törzs",
    bodyHtml: null,
    sampleLinks: {},
    variables: [],
  });
  api.list.mockReset().mockResolvedValue([]);
});

const webshopFul = async () => {
  render(<MailTemplatePage />);
  // the template has loaded (as the editor's own test waits): before it the page shows its skeleton
  await waitFor(() => expect(screen.getByLabelText("Törzs")).toBeTruthy());
  fireEvent.click(screen.getByRole("tab", { name: "Webshop" }));
};

describe("a Levélsablonok Webshop füle a Vevői szövegekre mutat", () => {
  it("a kapcsolóval a link ott áll, és a Vevői szövegek lapra visz", async () => {
    auth.navigation = [{ id: "webshop-customer-texts" }];
    await webshopFul();
    const link = await screen.findByRole("link", { name: "Vevői szövegek" });
    expect(link.getAttribute("href")).toBe("/webshop/vevoi-szovegek");
  });

  it("a kapcsoló nélkül nincs link (a lap sincs)", async () => {
    await webshopFul();
    expect(screen.queryByTestId("vevoi-szovegek-link")).toBeNull();
  });

  it("a Szerviz fülön nincs link", async () => {
    auth.navigation = [{ id: "webshop-customer-texts" }];
    render(<MailTemplatePage />);
    await waitFor(() => expect(screen.getByLabelText("Törzs")).toBeTruthy());
    expect(screen.queryByTestId("vevoi-szovegek-link")).toBeNull();
  });
});
