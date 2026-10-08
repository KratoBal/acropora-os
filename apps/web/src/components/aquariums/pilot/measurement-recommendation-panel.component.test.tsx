import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  AquariumMeasurementOccasion,
  MeasurementRecommendationView,
} from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MeasurementRecommendationPanel } from "./measurement-recommendation-panel";

const api = vi.hoisted(() => ({
  measurementRecommendation: vi.fn(),
  requestMeasurementRecommendation: vi.fn(),
  saveMeasurementRecommendation: vi.fn(),
  approveMeasurementRecommendation: vi.fn(),
}));
vi.mock("@/lib/api/aquariums", () => ({ aquariumsApi: api }));
// a panel a pilot-ui gombjait használja (Inter, `next/font/local`)
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

const occasion = {
  id: "2026-10-08T10:00:00.000Z",
  measuredAt: "2026-10-08T10:00:00.000Z",
  values: [],
} as unknown as AquariumMeasurementOccasion;

// kitalált adat
const draft = (
  over: Partial<MeasurementRecommendationView> = {},
): MeasurementRecommendationView => ({
  id: "reco-1",
  occasionId: occasion.id,
  status: "DRAFT",
  aiDraft: "A KH alacsony: {{termek:p1}}.",
  aiModel: "mock",
  aiRequestedAt: "2026-10-08T10:05:00.000Z",
  draftText: "A KH alacsony: {{termek:p1}}.",
  draftSegments: [
    { kind: "text", text: "A KH alacsony: " },
    {
      kind: "product",
      productId: "p1",
      name: "Kitalált KH puffer",
      url: "https://bolt.example.invalid/kh",
    },
    { kind: "text", text: "." },
  ],
  unknownProductIds: [],
  approvedText: null,
  approvedSegments: [],
  approvedAt: null,
  approvedByName: null,
  candidates: [
    {
      productId: "p1",
      name: "Kitalált KH puffer",
      category: "Termékek > Nyomelemek",
      effects: [],
      basis: "CATEGORY",
    },
  ],
  updatedAt: "2026-10-08T10:05:00.000Z",
  ...over,
});

const panel = (canManage = true) =>
  render(
    createElement(MeasurementRecommendationPanel, {
      token: "t",
      aquariumId: "aq-1",
      occasion,
      canManage,
    }),
  );

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe("MeasurementRecommendationPanel (2b3983e1)", () => {
  it("WEB-RECO-REQUEST: no recommendation yet; a request shows the draft with the product linked", async () => {
    api.measurementRecommendation.mockResolvedValue(null);
    api.requestMeasurementRecommendation.mockResolvedValue(draft());
    panel();
    fireEvent.click(
      await screen.findByRole("button", { name: "Ajánlás kérése" }),
    );
    const link = await screen.findByRole("link", {
      name: "Kitalált KH puffer",
    });
    expect(link).toHaveAttribute("href", "https://bolt.example.invalid/kh");
    expect(screen.getByText("Vázlat: a vevő nem látja")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Kitalált KH puffer · kategória, gyártói állítás nélkül/,
      ),
    ).toBeInTheDocument();
  });

  it("WEB-RECO-UNKNOWN: an id outside the candidates shows red, and the approval is off", async () => {
    api.measurementRecommendation.mockResolvedValue(
      draft({
        draftText: "Ez: {{termek:x9}}",
        draftSegments: [
          { kind: "text", text: "Ez: " },
          { kind: "product", productId: "x9", name: null, url: null },
        ],
        unknownProductIds: ["x9"],
      }),
    );
    panel();
    expect(await screen.findByTestId("ismeretlen-termek")).toHaveTextContent(
      "ismeretlen termék (x9)",
    );
    expect(screen.getByRole("button", { name: "Jóváhagyás" })).toBeDisabled();
  });

  it("WEB-RECO-APPROVE: an edited text is saved first, and the approval goes on the saved state", async () => {
    api.measurementRecommendation.mockResolvedValue(draft());
    api.saveMeasurementRecommendation.mockResolvedValue(
      draft({ draftText: "Javítva.", updatedAt: "2026-10-08T10:06:00.000Z" }),
    );
    api.approveMeasurementRecommendation.mockResolvedValue(
      draft({
        status: "APPROVED",
        draftText: "Javítva.",
        approvedText: "Javítva.",
        approvedByName: "Teszt Kolléga",
      }),
    );
    panel();
    fireEvent.change(await screen.findByLabelText("Az ajánlás szövege"), {
      target: { value: "Javítva." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Jóváhagyás" }));
    await waitFor(() =>
      expect(api.approveMeasurementRecommendation).toHaveBeenCalledWith(
        "t",
        "aq-1",
        occasion.id,
        { expectedUpdatedAt: "2026-10-08T10:06:00.000Z" },
      ),
    );
    expect(api.saveMeasurementRecommendation).toHaveBeenCalledWith(
      "t",
      "aq-1",
      occasion.id,
      { text: "Javítva.", expectedUpdatedAt: "2026-10-08T10:05:00.000Z" },
    );
    expect(
      await screen.findByText("Jóváhagyva · Teszt Kolléga"),
    ).toBeInTheDocument();
  });

  it("WEB-RECO-VIEWER: without the manage right, no editor and no buttons", async () => {
    api.measurementRecommendation.mockResolvedValue(draft());
    panel(false);
    expect(
      await screen.findByRole("link", { name: "Kitalált KH puffer" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Az ajánlás szövege")).toBeNull();
    expect(screen.queryByRole("button", { name: "Jóváhagyás" })).toBeNull();
  });
});
