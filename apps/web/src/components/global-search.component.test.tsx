import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  pathname: "/",
  push: vi.fn(),
}));
const api = vi.hoisted(() => ({ search: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
}));
vi.mock("@/lib/api/search", () => ({ searchApi: api }));

import { GlobalSearch } from "./global-search";

describe("GlobalSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    navigation.pathname = "/";
    navigation.push.mockReset();
    api.search.mockReset().mockResolvedValue({
      tickets: [
        {
          id: "ticket-1",
          title: "Hűtőkör nyomásvesztése",
          subtitle: "HJ-1 · AquaForma",
          path: "/szerviz/hibajegyek/ticket-1",
        },
      ],
    });
  });

  afterEach(() => vi.useRealTimers());

  it("késleltetve kérdez le, majd billentyűzettel megnyitja a találatot", async () => {
    render(<GlobalSearch token="token" />);
    const input = screen.getByRole("searchbox", { name: "Keresés" });

    fireEvent.change(input, { target: { value: "hűtő" } });
    expect(api.search).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(api.search).toHaveBeenCalledWith("token", "hűtő", expect.anything());
    expect(screen.getByRole("heading", { name: "Hibajegyek" })).toBeVisible();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(navigation.push).toHaveBeenCalledWith(
      "/szerviz/hibajegyek/ticket-1",
    );
  });

  it("Esc-re bezárja a találatokat, rövid keresésre pedig nem kérdez", () => {
    render(<GlobalSearch token="token" />);
    const input = screen.getByRole("searchbox", { name: "Keresés" });

    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(api.search).not.toHaveBeenCalled();
  });

  it("érthető üres állapotot mutat, ha nincs találat", async () => {
    api.search.mockResolvedValue({});
    render(<GlobalSearch token="token" />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Keresés" }), {
      target: { value: "nincs" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(screen.getByText("Nincs találat erre: „nincs”.")).toBeVisible();
  });
});
