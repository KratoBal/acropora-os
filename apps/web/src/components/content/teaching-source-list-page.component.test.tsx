import { render, screen } from "@testing-library/react";
import type { TeachingSourceListItem } from "@acropora/types";
import { describe, expect, it, vi } from "vitest";

import { TeachingSourceListPage } from "./teaching-source-list-page";

/*
  THE SOURCE LIST (T5.2, spec v2, point 4). What turns this red: a row that
  does not lead to its source page; an output state the spec names (current,
  stale, differs from the source, over the frame) or the open questions not
  shown; a source without outputs shown as if all were current.
*/
const api = vi.hoisted(() => ({ teachingSources: vi.fn() }));
vi.mock("@/lib/api/content", () => ({ contentApi: api }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { token: "token-1", user: { id: "u1" } } }),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const item = (
  over: Partial<TeachingSourceListItem> = {},
): TeachingSourceListItem => ({
  contentId: "c1",
  title: "Az első hat hét",
  state: "READY_TO_SEND",
  version: 3,
  approvedVersion: 3,
  audience: "INTERNAL",
  openQuestions: 0,
  outputs: {
    total: 0,
    current: 0,
    stale: 0,
    differing: 0,
    overFrame: 0,
    sent: 0,
  },
  updatedAt: "2026-11-15T09:00:00.000Z",
  ...over,
});

// no mockReset here: with a reset, vitest reports a mockRejectedValue as the
// test's own failure even when the page handles it (see the error case)

describe("TeachingSourceListPage", () => {
  it("shows each source with its version, audience and output states, and links to it", async () => {
    api.teachingSources.mockResolvedValue([
      item({
        openQuestions: 2,
        outputs: {
          total: 4,
          current: 2,
          stale: 2,
          differing: 1,
          overFrame: 1,
          sent: 1,
        },
      }),
      item({
        contentId: "c2",
        title: "Vízcsere",
        version: null,
        approvedVersion: null,
        audience: null,
        state: "DRAFTING",
      }),
    ]);
    render(<TeachingSourceListPage />);
    const link = await screen.findByRole("link", { name: "Az első hat hét" });
    expect(link.getAttribute("href")).toBe("/tartalom/c1/forras");
    for (const text of [
      "2 nyitott kérdés",
      "2 naprakész",
      "2 elavult",
      "1 eltér a forrástól",
      "1 keret felett",
      "1 kiment",
    ])
      expect(screen.getByText(text)).toBeTruthy();
    expect(screen.getByText(/3\. verzió · belső/)).toBeTruthy();
    expect(screen.getByText(/még nincs forrása/)).toBeTruthy();
    expect(screen.getByText("nincs kimenet")).toBeTruthy();
  });

  it("says when there is none", async () => {
    api.teachingSources.mockResolvedValue([]);
    render(<TeachingSourceListPage />);
    expect(await screen.findByText(/Még nincs oktatóanyag/)).toBeTruthy();
  });

  it("says when the list cannot load", async () => {
    api.teachingSources.mockRejectedValue(new Error("hálózat"));
    render(<TeachingSourceListPage />);
    expect(await screen.findByText("A lista nem tölthető be")).toBeTruthy();
    expect(screen.getByText("hálózat")).toBeTruthy();
  });
});
