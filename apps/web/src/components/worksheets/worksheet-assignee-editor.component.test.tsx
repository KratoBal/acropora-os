import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WorksheetAssignee, WorksheetDetail } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorksheetAssigneeEditor } from "./worksheet-assignee-editor";

/**
 * A `next/font/local` HÍVÁSA A NEXT.JS FORDÍTÓI MAKRÓJA -- vitest alatt,
 * Next build nélkül nem futtatható, `TypeError: default is not a
 * function`-nal bukik. Ez a modul csak a `PilotCard`/`PilotCardHeader`-en
 * keresztül, TRANZITÍVEN kerül ide (`pilot-ui.tsx` importálja
 * `pilot-font.ts`-ből) -- lásd ugyanezt a mockot a
 * `pilot-theme-root.component.test.tsx`-ben.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

const api = vi.hoisted(() => ({
  assignableUsers: vi.fn(),
  setAssignees: vi.fn(),
}));

vi.mock("@/lib/api/worksheets", () => ({ worksheetsApi: api }));

const assignees: WorksheetAssignee[] = [
  {
    userId: "user-sanyi",
    name: "Sanyi",
    assignedAt: "2026-08-19T09:30:00.000Z",
  },
];

describe("WorksheetAssigneeEditor", () => {
  beforeEach(() => {
    api.assignableUsers.mockReset().mockResolvedValue({
      items: [
        { id: "user-sanyi", name: "Sanyi", role: "SERVICE" },
        { id: "user-peter", name: "Kiss Péter", role: "SERVICE" },
      ],
    });
    api.setAssignees
      .mockReset()
      .mockResolvedValue({ id: "worksheet-1" } as WorksheetDetail);
  });

  it("sends the whole list, not just the person that was ticked", async () => {
    render(
      <WorksheetAssigneeEditor
        worksheetId="worksheet-1"
        token="token-1"
        assignees={assignees}
        canManage
        onSaved={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByLabelText("Kiss Péter"));
    fireEvent.click(screen.getByRole("button", { name: "Felelős mentése" }));

    await waitFor(() => expect(api.setAssignees).toHaveBeenCalled());
    expect(api.setAssignees.mock.calls[0]?.[2]).toEqual({
      userIds: ["user-sanyi", "user-peter"],
    });
  });

  // Üres lista kimondott szándék: egy tévesen kiosztott lapot vissza kell
  // tudni venni. Ezért a mentés akkor is aktív, ha mindenkit levettünk.
  it("lets the last person be taken off the worksheet", async () => {
    render(
      <WorksheetAssigneeEditor
        worksheetId="worksheet-1"
        token="token-1"
        assignees={assignees}
        canManage
        onSaved={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByLabelText("Sanyi"));
    fireEvent.click(screen.getByRole("button", { name: "Felelős mentése" }));

    await waitFor(() => expect(api.setAssignees).toHaveBeenCalled());
    expect(api.setAssignees.mock.calls[0]?.[2]).toEqual({ userIds: [] });
  });

  it("keeps the save button quiet until something actually changed", async () => {
    render(
      <WorksheetAssigneeEditor
        worksheetId="worksheet-1"
        token="token-1"
        assignees={assignees}
        canManage
        onSaved={vi.fn()}
      />,
    );

    await screen.findByLabelText("Sanyi");
    const save = screen.getByRole("button", { name: "Felelős mentése" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the names but no editor to someone who may only look", async () => {
    render(
      <WorksheetAssigneeEditor
        worksheetId="worksheet-1"
        token="token-1"
        assignees={assignees}
        canManage={false}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByText("Sanyi")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Felelős mentése" })).toBe(
      null,
    );
    expect(api.assignableUsers).not.toHaveBeenCalled();
  });

  /*
    A FELSOROLÁS ÉS A CÍMKÉK NEM DUPLÁZNAK (picasso a stage-képen: ugyanaz a név háromszor, a felsorolásban, a címkén és a jelölőnégyzetnél).
    MI PIROSÍT: ha szerkesztéskor a külön felsorolás is megmarad a választó címkéi mellett; ha olvasáskor (nincs szerkesztési jog) eltűnik;
    ha a "még nincs kiosztva senki" mondat egy üres lapon elmarad.
  */
  it("while editing the names stand once as chips; a reader gets the plain list; an empty sheet says so", async () => {
    const view = render(
      <WorksheetAssigneeEditor
        worksheetId="worksheet-1"
        token="token-1"
        assignees={assignees}
        canManage
        onSaved={vi.fn()}
      />,
    );
    await screen.findByLabelText("Kiss Péter");
    // the chip row names the assigned person once; no plain <ul> list of the saved names beside it
    expect(
      screen.getByRole("list", { name: "Kiválasztott felelősök" }),
    ).toBeTruthy();
    expect(screen.getAllByRole("list")).toHaveLength(1);
    view.unmount();

    const reader = render(
      <WorksheetAssigneeEditor
        worksheetId="worksheet-1"
        token="token-1"
        assignees={assignees}
        canManage={false}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("listitem").length).toBe(assignees.length);
    expect(screen.queryByLabelText("Felelős keresése")).toBeNull();
    reader.unmount();

    render(
      <WorksheetAssigneeEditor
        worksheetId="worksheet-1"
        token="token-1"
        assignees={[]}
        canManage
        onSaved={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Erre a munkalapra még nincs kiosztva senki."),
    ).toBeTruthy();
  });
});
