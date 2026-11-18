import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ServiceJobDeletePreview } from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ServiceJobDelete, deleteSummary } from "./service-job-delete";

const api = vi.hoisted(() => ({ deletePreview: vi.fn(), deleteJob: vi.fn() }));
vi.mock("@/lib/api/service-jobs", () => ({ serviceJobsApi: api }));

/*
  A HIBAJEGY TÖRLÉSE A FELÜLETEN (Balázs, 2026-11-18: "egy gombnyomással törölni úgy, hogy feldob egy figyelmeztető ablakot"). MI PIROSÍT: ha a kérés a
  megerősítés ELŐTT elmegy; ha az ablak nem mondja ki, MIT töröl (jegyszám, darabszámok, figyelmeztetés); ha egy tiltott jegy ablakot kapna a tiltás mondata
  helyett; ha a "Mégsem" törölne; ha a szerver hibája nem látszik, vagy siker nélkül továbblépne a lap; ha a karbantartási lap szövegében "hibajegy" áll.
*/
const preview = (
  over: Partial<ServiceJobDeletePreview> = {},
): ServiceJobDeletePreview => ({
  jobNumber: "HJ-2026-041",
  kind: "REPAIR",
  title: "Szivattyú",
  deletable: true,
  refusal: null,
  counts: { worksheets: 2, documents: 3, materialRequests: 1 },
  warnings: [],
  ...over,
});

beforeEach(() => {
  api.deletePreview.mockReset();
  api.deleteJob.mockReset();
});
afterEach(cleanup);

describe("deleteSummary", () => {
  it("kimondja a számot és a darabszámokat; nulla darab kimarad; a karbantartási lap lapot mond", () => {
    expect(deleteSummary(preview())).toBe(
      "A(z) HJ-2026-041 hibajegy véglegesen törlődik, vele együtt 2 munkalap, 3 csatolmány és 1 anyagigény.",
    );
    expect(
      deleteSummary(
        preview({
          kind: "MAINTENANCE",
          jobNumber: "KT-2026-003",
          counts: { worksheets: 1, documents: 0, materialRequests: 0 },
        }),
      ),
    ).toBe(
      "A(z) KT-2026-003 karbantartási lap véglegesen törlődik, vele együtt 1 munkalap.",
    );
    expect(
      deleteSummary(
        preview({
          counts: { worksheets: 0, documents: 0, materialRequests: 0 },
        }),
      ),
    ).toBe("A(z) HJ-2026-041 hibajegy véglegesen törlődik.");
  });
});

describe("ServiceJobDelete", () => {
  const props = () => ({ token: "t", jobId: "job-1", onDeleted: vi.fn() });

  it("a gomb megnyomása előnézetet kér és ablakot nyit, de nem töröl; a Mégsem sem töröl", async () => {
    api.deletePreview.mockResolvedValue(
      preview({ warnings: ["1 munkalap aláírásra vár."] }),
    );
    render(<ServiceJobDelete {...props()} />);

    fireEvent.click(screen.getByRole("button", { name: "Törlés" }));
    await screen.findByText(/véglegesen törlődik, vele együtt 2 munkalap/);
    expect(screen.getByText(/1 munkalap aláírásra vár\./)).toBeTruthy();
    expect(api.deleteJob).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Mégsem" }));
    expect(api.deleteJob).not.toHaveBeenCalled();
  });

  it("a megerősítés töröl a jegy azonosítójával, és csak siker után lép tovább", async () => {
    api.deletePreview.mockResolvedValue(preview());
    api.deleteJob.mockResolvedValue({
      deleted: true,
      jobNumber: "HJ-2026-041",
    });
    const p = props();
    render(<ServiceJobDelete {...p} />);

    fireEvent.click(screen.getByRole("button", { name: "Törlés" }));
    await screen.findByText(/véglegesen törlődik/);
    fireEvent.click(screen.getByRole("button", { name: "Végleges törlés" }));

    await waitFor(() => expect(p.onDeleted).toHaveBeenCalledTimes(1));
    expect(api.deleteJob).toHaveBeenCalledWith("t", "job-1");
  });

  it("a tiltott jegy a tiltás mondatát kapja, ablak nélkül", async () => {
    api.deletePreview.mockResolvedValue(
      preview({
        deletable: false,
        refusal:
          "Aláírt munkalap tartozik a hibajegyhez, ezért a hibajegy nem törölhető.",
      }),
    );
    render(<ServiceJobDelete {...props()} />);

    fireEvent.click(screen.getByRole("button", { name: "Törlés" }));
    await screen.findByText(/Aláírt munkalap tartozik/);
    expect(
      screen.queryByRole("button", { name: "Végleges törlés" }),
    ).toBeNull();
    expect(api.deleteJob).not.toHaveBeenCalled();
  });

  it("a szerver hibája (409) látszik, és a lap nem lép tovább", async () => {
    api.deletePreview.mockResolvedValue(preview());
    api.deleteJob.mockRejectedValue(new Error("Közben aláírták a munkalapot."));
    const p = props();
    render(<ServiceJobDelete {...p} />);

    fireEvent.click(screen.getByRole("button", { name: "Törlés" }));
    await screen.findByText(/véglegesen törlődik/);
    fireEvent.click(screen.getByRole("button", { name: "Végleges törlés" }));

    await screen.findByText("Közben aláírták a munkalapot.");
    expect(p.onDeleted).not.toHaveBeenCalled();
  });
});
