import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BillingIssueConfirmDialog } from "./billing-issue-confirm-dialog";

const props = {
  open: true,
  title: "Biztos, hogy kiállítod a számlát?",
  confirmLabel: "Kiállítom",
  summary: null,
  recipients: [],
  delivery: "NONE" as const,
  send: false,
  onSendChange: vi.fn(),
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

/*
  A LINK CSAK A HIBA MELLE ES CSAK EGY VEVOHOZ KERUL (Luca, 2026-11-12, kartya 7dd76d60). MI PIROSIT: ha vevo nelkul
  (nincs customerHref) is keletkezik link; ha hiba nelkul is megjelenik; ha a hiba szovege eltunik a link miatt.
*/
describe("a számla megerősítő ablaka a vevő adatlapjára visz", () => {
  it("links the page next to the server's reason when a customer is known", () => {
    render(
      <BillingIssueConfirmDialog
        {...props}
        loadError="A partnernek nincs számlázási címe."
        customerHref="/vevok/c-1"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A partnernek nincs számlázási címe.",
    );
    expect(
      screen.getByRole("link", { name: "A vevő adatlapja" }),
    ).toHaveAttribute("href", "/vevok/c-1");
  });

  it("links nothing without a customer, and nothing without an error", () => {
    const { rerender } = render(
      <BillingIssueConfirmDialog
        {...props}
        loadError="A bizonylathoz nincs partner rendelve."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("nincs partner");
    expect(screen.queryByRole("link")).toBeNull();
    rerender(
      <BillingIssueConfirmDialog
        {...props}
        loadError={null}
        customerHref="/vevok/c-1"
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
});
