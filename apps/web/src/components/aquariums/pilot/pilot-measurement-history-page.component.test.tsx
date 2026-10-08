import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PilotMeasurementHistoryPage } from "./pilot-measurement-history-page";

const aquariums = vi.hoisted(() => ({
  detail: vi.fn(),
  listMeasurements: vi.fn(),
  downloadMeasurementReportPdf: vi.fn(),
  downloadMeasurementsXlsx: vi.fn(),
  sendMeasurementEmail: vi.fn(),
}));

vi.mock("next/font/local", () => ({
  default: () => ({
    className: "font",
    style: { fontFamily: "Inter" },
    variable: "--font",
  }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/akvariumok/aq-1/meresek",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/navigation-history", () => ({
  useReturnTo: () => ({ href: "/akvariumok/aq-1", fromWithinApp: false }),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      id: "s1",
      token: "token-1",
      expiresAt: "2099-01-01T00:00:00.000Z",
      user: {
        id: "user-1",
        email: "b@acropora.local",
        displayName: "Balázs",
        role: "OWNER",
        customerId: null,
        supplierId: null,
      },
    },
  }),
}));
vi.mock("@/lib/api/aquariums", () => ({ aquariumsApi: aquariums }));

const OCCASION = {
  id: "occ-1",
  measuredAt: "2026-10-08T08:45:00.000Z",
  values: [{ parameterCode: "PH", value: 7.94 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  aquariums.detail.mockResolvedValue({
    id: "aq-1",
    name: "Korall medence",
    waterType: "TENGERI",
    targets: [],
    equipment: [],
    maintainers: [],
  });
  aquariums.listMeasurements.mockResolvedValue({ occasions: [OCCASION] });
  aquariums.downloadMeasurementReportPdf.mockResolvedValue(undefined);
});

/** Card 77767969: the measurement report PDF of one occasion, from its row. */
describe("PilotMeasurementHistoryPage", () => {
  it("an occasion's row downloads its measurement report PDF", async () => {
    render(<PilotMeasurementHistoryPage aquariumId="aq-1" />);
    fireEvent.click(await screen.findByText("PDF letöltése"));
    await waitFor(() =>
      expect(aquariums.downloadMeasurementReportPdf).toHaveBeenCalledWith(
        "token-1",
        "aq-1",
        "occ-1",
        "meresi-eredmenyek-2026-10-08.pdf",
      ),
    );
  });
});
