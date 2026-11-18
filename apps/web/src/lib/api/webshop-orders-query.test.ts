import { beforeEach, describe, expect, it, vi } from "vitest";

import { webshopOrdersApi } from "./webshop-orders";

/*
  THE LIST QUERY KEEPS THE SHORTAGE FILTER (card ac167fc2, task t-20261118-keszlethiany-lista). WHAT TURNS IT RED: the shortage filter dropped
  from the request (the list would show every order while the page says it filters), or an unknown parameter let through.
*/
const request = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("./client", () => ({
  apiRequest: request.apiRequest,
  apiAuthHeaders: () => ({}),
}));
vi.mock("./billing-documents", () => ({ pdfBlob: vi.fn() }));

describe("webshopOrdersApi.list", () => {
  beforeEach(() => request.apiRequest.mockReset().mockResolvedValue({}));

  it("sends the shortage filter and drops an unknown parameter", async () => {
    await webshopOrdersApi.list(
      "tok",
      new URLSearchParams("shortage=active&stage=invoice&evil=1"),
    );
    const path = request.apiRequest.mock.calls[0]![0] as string;
    const query = new URLSearchParams(path.split("?")[1]);
    expect(query.get("shortage")).toBe("active");
    expect(query.get("stage")).toBe("invoice");
    expect(query.has("evil")).toBe(false);
  });
});
