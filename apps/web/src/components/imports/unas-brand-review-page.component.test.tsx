import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BrandReviewListResponse, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UnasBrandReviewPage } from "./unas-brand-review-page";

const state = vi.hoisted(() => ({
  params: new URLSearchParams(),
  session: null as Session | null,
}));
const api = vi.hoisted(() => ({
  brandReviews: vi.fn(),
  decideBrandReview: vi.fn(),
  decideBrandReviewsBulk: vi.fn(),
  approve: vi.fn(),
  apply: vi.fn(),
}));
const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/admin/imports/unas/batch-123/review",
  useSearchParams: () => state.params,
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: state.session,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));
vi.mock("@/lib/api/imports", () => ({ importApi: api }));

const owner: Session = {
  id: "s",
  token: "token",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "owner",
    email: "owner@acropora.local",
    displayName: "Owner",
    role: "OWNER",
  },
};
const item = {
  id: "r1",
  sourceRowNumber: 2,
  sku: "REEF-1",
  productName: "Reef Pump",
  status: "PENDING" as const,
  suggestedBrandKey: "tunze",
  confidence: 82,
  reviewReasons: ["LOW_CONFIDENCE" as const],
  candidates: [
    {
      brandKey: "tunze",
      brandName: "Tunze",
      confidence: 82,
      rank: 1,
      sources: ["PRODUCT_NAME" as const],
      evidence: [
        {
          source: "PRODUCT_NAME" as const,
          rawValue: "Tunze pump",
          normalizedValue: "tunze pump",
          matchedPattern: "tunze",
          score: 82,
          reason: "névegyezés",
        },
      ],
      conflicts: [],
      masterData: {
        brandId: "brand-tunze",
        brandName: "Tunze",
        status: "ACTIVE" as const,
        match: "CANONICAL" as const,
      },
    },
  ],
  evidence: [],
  sourceFacts: { explicitBrand: "Tunze", alternativeCategories: [] },
  updatedAt: "2026-07-19T10:00:00.000Z",
};
const response = (
  overrides: Partial<BrandReviewListResponse> = {},
): BrandReviewListResponse => ({
  items: [item],
  page: 1,
  pageSize: 25,
  total: 1,
  totalPages: 1,
  summary: {
    total: 1,
    pending: 1,
    accepted: 0,
    noBrand: 0,
    completionPercent: 0,
    reasons: { LOW_CONFIDENCE: 1 },
    confidenceBands: { high: 1, medium: 0, low: 0, none: 0 },
    batchStatus: "VALIDATED",
    analysisVersion: "v1",
    stale: false,
    validationErrors: 0,
    approvalEligible: false,
    readOnly: false,
  },
  ...overrides,
});

describe("UNAS brand review page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.params = new URLSearchParams();
    state.session = owner;
    api.brandReviews.mockResolvedValue(response());
    api.decideBrandReview.mockResolvedValue(item);
    api.decideBrandReviewsBulk.mockResolvedValue({ updated: 1 });
  });

  it("shows loading and then the populated queue", async () => {
    let resolve!: (value: BrandReviewListResponse) => void;
    api.brandReviews.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<UnasBrandReviewPage batchId="batch-123" />);
    expect(screen.getByLabelText("Betöltés")).toBeInTheDocument();
    resolve(response());
    expect(await screen.findByText("Reef Pump")).toBeInTheDocument();
    expect(screen.getByText("Tunze")).toBeInTheDocument();
    expect(screen.getByText("82%")).toBeInTheDocument();
  });

  it("renders empty queue and filtered no-results variants", async () => {
    api.brandReviews.mockResolvedValueOnce(
      response({
        items: [],
        total: 0,
        summary: {
          ...response().summary,
          total: 0,
          pending: 0,
          completionPercent: 100,
        },
      }),
    );
    render(<UnasBrandReviewPage batchId="batch-123" />);
    expect(await screen.findByText("Nincs review feladat")).toBeInTheDocument();
  });

  it("serializes page and filters to the URL", async () => {
    render(<UnasBrandReviewPage batchId="batch-123" />);
    await screen.findByText("Reef Pump");
    fireEvent.change(screen.getByLabelText("Státusz"), {
      target: { value: "PENDING" },
    });
    expect(router.replace).toHaveBeenCalledWith(
      expect.stringContaining("status=PENDING"),
    );
  });

  it("debounces text search and resets pagination", async () => {
    state.params = new URLSearchParams("page=4");
    render(<UnasBrandReviewPage batchId="batch-123" />);
    await screen.findByText("Reef Pump");
    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText("Keresés"), {
      target: { value: "reef" },
    });
    await vi.advanceTimersByTimeAsync(349);
    expect(router.replace).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(router.replace).toHaveBeenCalledWith(
      expect.stringMatching(/search=reef.*page=1|page=1.*search=reef/),
    );
    vi.useRealTimers();
  });

  it("opens evidence and persists a selected candidate", async () => {
    render(<UnasBrandReviewPage batchId="batch-123" />);
    await screen.findByText("Reef Pump");
    fireEvent.click(screen.getByText("Bizonyíték"));
    expect(
      screen.getByRole("dialog", { name: /Brand bizonyítékok/ }),
    ).toHaveTextContent("Tunze pump");
    fireEvent.click(screen.getByText("Bezárás"));
    fireEvent.click(screen.getByText("Javaslat elfogadása"));
    await waitFor(() =>
      expect(api.decideBrandReview).toHaveBeenCalledWith(
        "token",
        "batch-123",
        "r1",
        expect.objectContaining({
          decision: "ACCEPT",
          brandKey: "tunze",
          expectedUpdatedAt: item.updatedAt,
        }),
      ),
    );
  });

  it("bulk action includes only explicitly selected current-page rows", async () => {
    render(<UnasBrandReviewPage batchId="batch-123" />);
    await screen.findByText("Reef Pump");
    fireEvent.click(screen.getByLabelText("REEF-1 kijelölése"));
    fireEvent.click(screen.getByText("Kijelölt javaslatok elfogadása"));
    expect(screen.getByRole("dialog")).toHaveTextContent("1 kijelölt");
    fireEvent.click(screen.getByText("Megerősítés"));
    await waitFor(() =>
      expect(api.decideBrandReviewsBulk).toHaveBeenCalledWith(
        "token",
        "batch-123",
        expect.objectContaining({ reviewIds: ["r1"] }),
      ),
    );
  });

  it("keeps approval disabled while pending and requires typed confirmation when eligible", async () => {
    const view = render(<UnasBrandReviewPage batchId="batch-123" />);
    expect(await screen.findByText("Batch jóváhagyása")).toBeDisabled();
    view.unmount();
    api.brandReviews.mockResolvedValue(
      response({
        summary: {
          ...response().summary,
          pending: 0,
          accepted: 1,
          completionPercent: 100,
          approvalEligible: true,
        },
      }),
    );
    render(<UnasBrandReviewPage batchId="batch-123" />);
    const approve = await screen.findByText("Batch jóváhagyása");
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    expect(screen.getByText("Megerősítés")).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Írd be/), {
      target: { value: "APPROVE" },
    });
    expect(screen.getByText("Megerősítés")).toBeEnabled();
  });

  it("blocks access without products.manage", () => {
    state.session = { ...owner, user: { ...owner.user, role: "VIEWER" } };
    render(<UnasBrandReviewPage batchId="batch-123" />);
    expect(
      screen.getByText("Nincs hozzáférésed a brand review-hoz"),
    ).toBeInTheDocument();
    expect(api.brandReviews).not.toHaveBeenCalled();
  });
});
