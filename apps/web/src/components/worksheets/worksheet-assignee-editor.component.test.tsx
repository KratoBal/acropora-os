import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WorksheetAssignee, WorksheetDetail } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorksheetAssigneeEditor } from "./worksheet-assignee-editor";

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
    fireEvent.click(screen.getByRole("button", { name: "Felelősök mentése" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Felelősök mentése" }));

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
    const save = screen.getByRole("button", { name: "Felelősök mentése" });
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
    expect(screen.queryByRole("button", { name: "Felelősök mentése" })).toBe(
      null,
    );
    expect(api.assignableUsers).not.toHaveBeenCalled();
  });
});
