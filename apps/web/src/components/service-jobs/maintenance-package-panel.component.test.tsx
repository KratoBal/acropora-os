import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import { MaintenancePackagePanel } from "./maintenance-package-panel";

const api = vi.hoisted(() => ({
  download: vi.fn(),
  mailPreview: vi.fn(),
  sendMail: vi.fn(),
}));
vi.mock("@/lib/api/maintenance-package", () => ({
  maintenancePackageApi: api,
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { token: "token-1" } }),
}));

/*
  A "CSOMAG LETÖLTÉSE" HIBÁJA A SZERVER MONDATA (Luca, 2026-11-18 14:39 UTC; acrobot 55959): a 400-as ok ("nincs teljesítési igazolás") megjelenik a gomb fölött, nem egy rögzített mondat.
  MI PIROSÍT: ha a szerver mondata helyett a rögzített "nem tölthető le" áll; ha a hiba nem látszik; ha egy sikeres letöltés után a régi hiba megmarad.
*/
beforeEach(() => {
  api.download.mockReset();
});
afterEach(cleanup);

describe("MaintenancePackagePanel letöltés", () => {
  it("a szerver 400-as oka látszik a gomb fölött", async () => {
    api.download.mockRejectedValue(
      new ApiError(
        "A csomag nem tölthető le: a karbantartási lapnak nincs teljesítési igazolása.",
        400,
      ),
    );
    render(
      <MaintenancePackagePanel serviceJobId="job-1" jobNumber="KT-2026-001" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Csomag letöltése" }));

    await screen.findByText(
      "A csomag nem tölthető le: a karbantartási lapnak nincs teljesítési igazolása.",
    );
    expect(
      screen.queryByText("A karbantartási csomag nem tölthető le."),
    ).toBeNull();
  });
});
