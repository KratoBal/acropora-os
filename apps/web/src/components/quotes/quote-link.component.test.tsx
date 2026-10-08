import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { QuoteDetailDto } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QuoteAcceptanceLinkCard } from "./quote-link";

const api = vi.hoisted(() => ({
  acceptanceLink: vi.fn(),
  issueAcceptanceLink: vi.fn(),
  revokeAcceptanceLink: vi.fn(),
}));
vi.mock("@/lib/api/quotes", () => ({ quotesApi: api }));

const quote = (status = "SENT") =>
  ({
    id: "q-1",
    status,
    versions: [{ id: "v-1", versionNumber: 1, status: "PUBLISHED" }],
  }) as unknown as QuoteDetailDto;

const issued = {
  id: "l-1",
  versionId: "v-1",
  expiresAt: "2099-12-31T23:00:00.000Z",
  firstOpenedAt: null,
  createdAt: "2026-10-08T10:00:00.000Z",
  path: "/ajanlat/tok-123",
};

describe("Az elfogadó link kártyája (#1582 P4b)", () => {
  beforeEach(() => {
    api.acceptanceLink.mockReset();
    api.issueAcceptanceLink.mockReset();
    api.revokeAcceptanceLink.mockReset();
    api.acceptanceLink.mockResolvedValue({ link: null });
  });

  it("a kiadott link teljes címe egyszer látszik, a webes originnel", async () => {
    api.issueAcceptanceLink.mockResolvedValue(issued);
    render(<QuoteAcceptanceLinkCard token="t" quote={quote()} canManage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Link kiadása" }),
    );
    const address = (await screen.findByLabelText(
      "Az elfogadó link címe",
    )) as HTMLInputElement;
    expect(address.value).toBe(`${window.location.origin}/ajanlat/tok-123`);
    expect(api.issueAcceptanceLink).toHaveBeenCalledWith("t", "q-1", "v-1");
    expect(screen.getByText(/Az ügyfél még nem nyitotta meg/)).toBeTruthy();
  });

  it("a visszavonás után nincs élő link; jog nélkül és lezárt ajánlatnál nincs gomb", async () => {
    api.acceptanceLink.mockResolvedValue({ link: issued });
    api.revokeAcceptanceLink.mockResolvedValue(undefined);
    const { unmount } = render(
      <QuoteAcceptanceLinkCard token="t" quote={quote()} canManage />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Link visszavonása" }),
    );
    await waitFor(() =>
      expect(screen.getByText(/nincs élő link/)).toBeTruthy(),
    );
    unmount();
    const { unmount: second } = render(
      <QuoteAcceptanceLinkCard token="t" quote={quote()} canManage={false} />,
    );
    expect(screen.queryByRole("button", { name: /Link kiadása/ })).toBe(null);
    second();
    render(
      <QuoteAcceptanceLinkCard token="t" quote={quote("ACCEPTED")} canManage />,
    );
    expect(screen.queryByRole("button", { name: /Link kiadása/ })).toBe(null);
  });
});
