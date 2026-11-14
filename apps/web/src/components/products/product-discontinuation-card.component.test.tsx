import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductDiscontinuationCard } from "./product-discontinuation-card";

const api = vi.hoisted(() => ({
  getDiscontinuation: vi.fn(),
  setDiscontinuation: vi.fn(),
  removeDiscontinuation: vi.fn(),
  list: vi.fn(),
}));

vi.mock("@/lib/api/products", () => ({ productApi: api }));

const mark = (replacement: { id: string; name: string } | null = null) => ({
  productId: "product-1",
  replacement,
  updatedAt: "2026-11-14T20:00:00.000Z",
});

/*
  The answer arrives a macrotask later on purpose: a `mockResolvedValue` settles in the same tick, so the waits
  would "succeed" even if they were written wrong.
*/
const later = <T,>(value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), 0));

const renderCard = (canManage = true) =>
  render(
    <ProductDiscontinuationCard
      token="token-1"
      productId="product-1"
      canManage={canManage}
    />,
  );

describe("ProductDiscontinuationCard", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
  });

  it("an unmarked product says so, and does not confuse it with temporarily unavailable", async () => {
    api.getDiscontinuation.mockReturnValue(later(null));
    renderCard();
    expect(
      await screen.findByText(/Nincs végleg megszűntnek jelölve/),
    ).toBeTruthy();
    expect(screen.getByText(/átmenetileg nem kapható/)).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Megjelölés véglegesen megszűntként",
      }),
    ).toBeTruthy();
  });

  it("without the manage permission there is no button", async () => {
    api.getDiscontinuation.mockReturnValue(later(mark()));
    renderCard(false);
    expect(await screen.findByText(/Ez a termék végleg megszűnt/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("marks the product without a replacement: the body carries a null replacement", async () => {
    api.getDiscontinuation.mockReturnValue(later(null));
    api.setDiscontinuation.mockReturnValue(later(mark()));
    renderCard();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Megjelölés véglegesen megszűntként",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() =>
      expect(api.setDiscontinuation).toHaveBeenCalledWith(
        "token-1",
        "product-1",
        { replacementProductId: null },
      ),
    );
    expect(await screen.findByText(/Nincs helyettesítő/)).toBeTruthy();
  });

  it("picks a replacement from the search (active products only, the product itself left out) and saves its id", async () => {
    api.getDiscontinuation.mockReturnValue(later(null));
    api.list.mockReturnValue(
      later({
        items: [
          { id: "product-1", name: "Maga a termék", primarySku: "A-1" },
          { id: "product-2", name: "Új termék", primarySku: "B-2" },
        ],
      }),
    );
    api.setDiscontinuation.mockReturnValue(
      later(mark({ id: "product-2", name: "Új termék" })),
    );
    renderCard();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Megjelölés véglegesen megszűntként",
      }),
    );
    fireEvent.change(
      screen.getAllByLabelText("Helyettesítő termék keresése")[1]!,
      { target: { value: "új" } },
    );
    const pick = await screen.findByRole("button", { name: /Új termék/ });
    expect(screen.queryByRole("button", { name: /Maga a termék/ })).toBeNull();
    expect(api.list).toHaveBeenCalledWith("token-1", {
      search: "új",
      pageSize: 8,
      active: true,
    });
    fireEvent.click(pick);
    expect(
      screen.getByTestId("discontinuation-replacement").textContent,
    ).toMatch(/Új termék/);
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() =>
      expect(api.setDiscontinuation).toHaveBeenCalledWith(
        "token-1",
        "product-1",
        { replacementProductId: "product-2" },
      ),
    );
  });

  it("clearing the replacement and saving sends null (the whole state, not a patch)", async () => {
    api.getDiscontinuation.mockReturnValue(
      later(mark({ id: "product-2", name: "Új termék" })),
    );
    api.setDiscontinuation.mockReturnValue(later(mark()));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Módosítás" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Helyettesítő törlése" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() =>
      expect(api.setDiscontinuation).toHaveBeenCalledWith(
        "token-1",
        "product-1",
        { replacementProductId: null },
      ),
    );
  });

  it("un-marking asks with the shared dialog first, and only its confirmation calls the API", async () => {
    api.getDiscontinuation.mockReturnValue(later(mark()));
    api.removeDiscontinuation.mockReturnValue(later(undefined));
    renderCard();
    fireEvent.click(
      await screen.findByRole("button", { name: "Jelölés visszavonása" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toMatch(/Visszavonod/);
    expect(api.removeDiscontinuation).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Jelölés visszavonása" }),
    );
    await waitFor(() =>
      expect(api.removeDiscontinuation).toHaveBeenCalledWith(
        "token-1",
        "product-1",
      ),
    );
    expect(
      await screen.findByText(/Nincs végleg megszűntnek jelölve/),
    ).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cancelling the un-mark question calls nothing and keeps the mark", async () => {
    api.getDiscontinuation.mockReturnValue(later(mark()));
    renderCard();
    fireEvent.click(
      await screen.findByRole("button", { name: "Jelölés visszavonása" }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Mégsem",
      }),
    );
    expect(api.removeDiscontinuation).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText(/Ez a termék végleg megszűnt/)).toBeTruthy();
  });

  it("shows the server's refusal and stays in the editor", async () => {
    api.getDiscontinuation.mockReturnValue(later(null));
    // created at CALL time: a promise made at setup rejects before the component attaches a handler, which
    // is an unhandled rejection (the Tests line stays green, the exit code goes to 1)
    api.setDiscontinuation.mockImplementation(
      () =>
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error("A helyettesítő termék maga is végleg megszűnt."),
              ),
            0,
          ),
        ),
    );
    renderCard();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Megjelölés véglegesen megszűntként",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(
      await screen.findByText("A helyettesítő termék maga is végleg megszűnt."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mentés" })).toBeTruthy();
  });
});
