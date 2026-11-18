import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { WorksheetDeletePreview } from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorksheetDelete, worksheetDeleteSummary } from "./worksheet-delete";

const api = vi.hoisted(() => ({
  deletePreview: vi.fn(),
  deleteWorksheet: vi.fn(),
}));
vi.mock("@/lib/api/worksheets", () => ({ worksheetsApi: api }));

/*
  AZ ÖNÁLLÓ MUNKALAP TÖRLÉSE A FELÜLETEN (a hibajegy-törlés 2. szelete). MI PIROSÍT: ha a kérés a megerősítés ELŐTT elmegy; ha az ablak nem mondja ki, MIT töröl (a lap neve, darabszámok,
  figyelmeztetés); ha a tiltott lap ablakot kapna a tiltás mondata helyett; ha a "Mégsem" törölne; ha a szerver hibája nem látszik, vagy siker nélkül továbblépne a lap.
*/
const preview = (
  over: Partial<WorksheetDeletePreview> = {},
): WorksheetDeletePreview => ({
  label: "Szivattyú csere",
  deletable: true,
  refusal: null,
  counts: { documents: 2, materialRequests: 1 },
  warnings: [],
  ...over,
});

beforeEach(() => {
  api.deletePreview.mockReset();
  api.deleteWorksheet.mockReset();
});
afterEach(cleanup);

describe("worksheetDeleteSummary", () => {
  it("kimondja a lap nevét és a darabszámokat; nulla darab kimarad", () => {
    expect(worksheetDeleteSummary(preview())).toBe(
      "A(z) Szivattyú csere munkalap véglegesen törlődik, vele együtt 2 csatolmány és 1 anyagigény.",
    );
    expect(
      worksheetDeleteSummary(
        preview({ counts: { documents: 0, materialRequests: 0 } }),
      ),
    ).toBe("A(z) Szivattyú csere munkalap véglegesen törlődik.");
  });
});

describe("WorksheetDelete", () => {
  const props = () => ({ token: "t", worksheetId: "ws-1", onDeleted: vi.fn() });

  it("a gomb előnézetet kér és ablakot nyit, de nem töröl; a Mégsem sem töröl", async () => {
    api.deletePreview.mockResolvedValue(
      preview({ warnings: ["A munkalap aláírásra vár."] }),
    );
    render(<WorksheetDelete {...props()} />);

    fireEvent.click(screen.getByRole("button", { name: "Törlés" }));
    await screen.findByText(/véglegesen törlődik, vele együtt 2 csatolmány/);
    expect(screen.getByText(/A munkalap aláírásra vár\./)).toBeTruthy();
    expect(api.deleteWorksheet).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Mégsem" }));
    expect(api.deleteWorksheet).not.toHaveBeenCalled();
  });

  it("a megerősítés töröl a lap azonosítójával, és csak siker után lép tovább", async () => {
    api.deletePreview.mockResolvedValue(preview());
    api.deleteWorksheet.mockResolvedValue({ deleted: true });
    const p = props();
    render(<WorksheetDelete {...p} />);

    fireEvent.click(screen.getByRole("button", { name: "Törlés" }));
    await screen.findByText(/véglegesen törlődik/);
    fireEvent.click(screen.getByRole("button", { name: "Végleges törlés" }));

    await waitFor(() => expect(p.onDeleted).toHaveBeenCalledTimes(1));
    expect(api.deleteWorksheet).toHaveBeenCalledWith("t", "ws-1");
  });

  it("a tiltott lap a tiltás mondatát kapja, ablak nélkül", async () => {
    api.deletePreview.mockResolvedValue(
      preview({ deletable: false, refusal: "Aláírt munkalap nem törölhető." }),
    );
    render(<WorksheetDelete {...props()} />);

    fireEvent.click(screen.getByRole("button", { name: "Törlés" }));
    await screen.findByText("Aláírt munkalap nem törölhető.");
    expect(
      screen.queryByRole("button", { name: "Végleges törlés" }),
    ).toBeNull();
    expect(api.deleteWorksheet).not.toHaveBeenCalled();
  });

  it("a szerver hibája (409) látszik, és a lap nem lép tovább", async () => {
    api.deletePreview.mockResolvedValue(preview());
    api.deleteWorksheet.mockRejectedValue(new Error("Közben aláírták."));
    const p = props();
    render(<WorksheetDelete {...p} />);

    fireEvent.click(screen.getByRole("button", { name: "Törlés" }));
    await screen.findByText(/véglegesen törlődik/);
    fireEvent.click(screen.getByRole("button", { name: "Végleges törlés" }));

    await screen.findByText("Közben aláírták.");
    expect(p.onDeleted).not.toHaveBeenCalled();
  });
});
