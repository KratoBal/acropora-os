import { fireEvent, render, screen } from "@testing-library/react";
import type { PartnerDeletionPlan } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PartnerDeleteButton } from "./partner-delete-button";

const api = vi.hoisted(() => ({ deletionPlan: vi.fn(), remove: vi.fn() }));

vi.mock("@/lib/api/suppliers", () => ({ suppliersApi: api }));

const blocked: PartnerDeletionPlan = {
  action: "mark-deleted",
  blockedBy: [
    { label: "beszerzési számla", count: 3 },
    { label: "munkalap", count: 1 },
  ],
};

const removable: PartnerDeletionPlan = {
  action: "delete",
  alsoRemoved: [{ label: "beszállítói termékkapcsolat", count: 4 }],
};

function renderButton(onDeleted = vi.fn()) {
  render(
    <PartnerDeleteButton
      token="token-1"
      partnerId="supplier-1"
      partnerName="Fankó Kft."
      onDeleted={onDeleted}
    />,
  );
  return onDeleted;
}

beforeEach(() => {
  api.deletionPlan.mockReset();
  api.remove.mockReset();
});

describe("partner deletion confirmation", () => {
  /**
   * The question is asked only after the server has said what would happen.
   * A general "are you sure?" would fit both branches and would tell the
   * reader neither what is about to be lost nor which one runs.
   */
  it("asks nothing until it knows what would happen", () => {
    renderButton();

    expect(
      screen.getByRole("button", { name: "Partner törlése" }),
    ).toBeInTheDocument();
    expect(api.deletionPlan).not.toHaveBeenCalled();
  });

  it("names what goes with the partner, and calls the deletion final", async () => {
    api.deletionPlan.mockResolvedValue(removable);
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Partner törlése" }));

    expect(
      await screen.findByText(/Véglegesen törlöd: Fankó Kft\.\?/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/4 beszállítói termékkapcsolat/),
    ).toBeInTheDocument();
    expect(screen.getByText(/nem vonható vissza/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Végleges törlés" }),
    ).toBeInTheDocument();
  });

  /**
   * A refused deletion has to say WHAT held it back, not only that it did not
   * happen. The reader can act on "3 purchase invoices"; they can do nothing
   * with "not possible".
   */
  it("says what holds the partner back, and offers the other outcome", async () => {
    api.deletionPlan.mockResolvedValue(blocked);
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Partner törlése" }));

    expect(
      await screen.findByText(/Fankó Kft\. nem törölhető véglegesen/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/3 beszerzési számla, 1 munkalap/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/régi bejegyzéseken továbbra is látszik a neve/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Töröltre jelölés" }),
    ).toBeInTheDocument();
    // The other branch's wording must not appear: the two consequences are
    // different, and a reader who sees both learns neither.
    expect(screen.queryByText(/nem vonható vissza/)).not.toBeInTheDocument();
  });

  it("deletes only after the confirmation, and reports the outcome back", async () => {
    api.deletionPlan.mockResolvedValue(blocked);
    api.remove.mockResolvedValue(blocked);
    const onDeleted = renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Partner törlése" }));
    expect(api.remove).not.toHaveBeenCalled();

    fireEvent.click(
      await screen.findByRole("button", { name: "Töröltre jelölés" }),
    );

    await vi.waitFor(() =>
      expect(api.remove).toHaveBeenCalledWith("token-1", "supplier-1"),
    );
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledWith(blocked));
  });

  it("takes back the question when the reader changes their mind", async () => {
    api.deletionPlan.mockResolvedValue(removable);
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Partner törlése" }));
    fireEvent.click(await screen.findByRole("button", { name: "Mégsem" }));

    expect(
      screen.getByRole("button", { name: "Partner törlése" }),
    ).toBeInTheDocument();
    expect(api.remove).not.toHaveBeenCalled();
  });
});
