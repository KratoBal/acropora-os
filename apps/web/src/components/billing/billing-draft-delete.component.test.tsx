import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BillingDraftDelete, deleteOffered } from "./billing-draft-delete";

const api = vi.hoisted(() => ({ deleteDraft: vi.fn() }));
vi.mock("@/lib/api/billing-documents", () => ({ billingDocumentsApi: api }));

/*
  A VÁZLAT TÖRLÉSE A FELÜLETEN (kártya 6a75f15c). MI PIROSÍT: ha a gomb kiállított, sorszámos vagy még el nem mentett vázlaton, vagy
  jog nélkül is megjelenne; ha a megerősítés előtt elmenne a kérés; ha a kérés nem a legutóbb betöltött időbélyeggel menne; ha a
  szerver mondata (409) nem jelenne meg, vagy siker nélkül is továbblépne a lap; ha a "Mégsem" mégis törölne.
*/
beforeEach(() => {
  api.deleteDraft.mockReset();
});
afterEach(cleanup);

describe("deleteOffered", () => {
  const base = {
    documentId: "doc-1",
    status: "DRAFT",
    savedUpdatedAt: "2026-11-16T10:00:00.000Z",
    issued: false,
    canManage: true,
  };

  it("a saved draft, with the right to edit, is offered", () => {
    expect(deleteOffered(base)).toBe(true);
  });

  it("nothing else is: no right, a new unsaved document, another state, an issued one", () => {
    for (const over of [
      { canManage: false },
      { documentId: undefined },
      { savedUpdatedAt: null },
      { status: "ISSUED" },
      { status: "ISSUING" },
      { status: "ISSUE_FAILED" },
      { issued: true },
    ])
      expect(deleteOffered({ ...base, ...over }), JSON.stringify(over)).toBe(
        false,
      );
  });
});

describe("BillingDraftDelete", () => {
  const props = () => ({
    token: "token-1",
    id: "doc-1",
    updatedAt: "2026-11-16T10:00:00.000Z",
    onDeleted: vi.fn(),
  });
  const question = "Biztos, hogy törlöd ezt a vázlatot?";

  it("asks first: nothing is sent before the confirmation", () => {
    render(<BillingDraftDelete {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Vázlat törlése" }));
    expect(screen.getByRole("dialog", { name: question })).toBeInTheDocument();
    expect(api.deleteDraft).not.toHaveBeenCalled();
  });

  it("confirming sends the id with the loaded timestamp, then the page moves on", async () => {
    api.deleteDraft.mockResolvedValue({ deleted: true });
    const p = props();
    render(<BillingDraftDelete {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Vázlat törlése" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: question })).getByRole(
        "button",
        { name: "Törlöm" },
      ),
    );
    await waitFor(() => expect(p.onDeleted).toHaveBeenCalledTimes(1));
    expect(api.deleteDraft).toHaveBeenCalledWith(
      "token-1",
      "doc-1",
      "2026-11-16T10:00:00.000Z",
    );
  });

  it("Mégsem closes the dialog and sends nothing", () => {
    const p = props();
    render(<BillingDraftDelete {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Vázlat törlése" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: question })).getByRole(
        "button",
        { name: "Mégsem" },
      ),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.deleteDraft).not.toHaveBeenCalled();
    expect(p.onDeleted).not.toHaveBeenCalled();
  });

  it("the server's sentence stays under the button, and the page does not move on", async () => {
    api.deleteDraft.mockRejectedValue(
      new Error(
        "Másik bizonylat hivatkozik erre a vázlatra, ezért nem törölhető.",
      ),
    );
    const p = props();
    render(<BillingDraftDelete {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Vázlat törlése" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: question })).getByRole(
        "button",
        { name: "Törlöm" },
      ),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Másik bizonylat hivatkozik erre a vázlatra, ezért nem törölhető.",
    );
    expect(p.onDeleted).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
