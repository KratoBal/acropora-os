import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WebshopStuckMails } from "./webshop-stuck-mails";

/*
  THE STUCK WEBSHOP MAILS (no fallback mail, Balazs 2026-10-05 20:11 UTC).
  WHAT TURNS RED: a stuck mail does not show its reason; the retry does not
  go out or does not reload; a refused retry is swallowed; an unreadable queue
  breaks the page instead of saying so.
*/
const api = vi.hoisted(() => ({ stuck: vi.fn(), retry: vi.fn() }));
vi.mock("@/lib/api/webshop-mail-outbox", () => ({ webshopMailOutboxApi: api }));

const MAIL = {
  id: "wmout_1",
  template: "order-shipped",
  display_id: 38,
  resource_id: "order_38",
  to: "vevo@example.hu",
  attempts: 1,
  failure_kind: "permanent" as const,
  last_error:
    "A(z) WEBSHOP_ORDER_SHIPPED sablonban ismeretlen változó áll: {{x}}.",
  created_at: "2026-10-05T20:00:00.000Z",
  next_attempt_at: null,
  alerted_at: "2026-10-05T20:00:01.000Z",
};

beforeEach(() => {
  api.stuck.mockReset().mockResolvedValue({ items: [MAIL], count: 1 });
  api.retry
    .mockReset()
    .mockResolvedValue({ ...MAIL, failure_kind: "transient" });
});

describe("WebshopStuckMails", () => {
  it("shows the mail, its template and the render endpoint's own reason", async () => {
    render(<WebshopStuckMails token="t" onOpenTemplate={() => undefined} />);
    expect(await screen.findByText("Elakadt webshop levelek (1)")).toBeTruthy();
    expect(screen.getByText("Csomag átadva a szállítónak")).toBeTruthy();
    expect(screen.getByText("Sablon-hiba")).toBeTruthy();
    expect(screen.getByText(MAIL.last_error)).toBeTruthy();
  });

  it("the template name opens that template", async () => {
    const open = vi.fn();
    render(<WebshopStuckMails token="t" onOpenTemplate={open} />);
    fireEvent.click(await screen.findByText("Csomag átadva a szállítónak"));
    expect(open).toHaveBeenCalledWith("WEBSHOP_ORDER_SHIPPED");
  });

  it("retry puts it back and reloads the list", async () => {
    render(<WebshopStuckMails token="t" onOpenTemplate={() => undefined} />);
    api.stuck.mockResolvedValueOnce({ items: [], count: 0 });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Újra sorba: Csomag átadva a szállítónak #38",
      }),
    );
    await waitFor(() => expect(api.retry).toHaveBeenCalledWith("t", "wmout_1"));
    await waitFor(() =>
      expect(screen.queryByText("Elakadt webshop levelek (1)")).toBeNull(),
    );
  });

  it("a refused retry says why, next to the mail", async () => {
    api.retry.mockRejectedValue(
      new Error("Ez a levél már kiment, nem kell újra sorba tenni."),
    );
    render(<WebshopStuckMails token="t" onOpenTemplate={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: /Újra sorba/ }));
    expect(
      await screen.findByText(
        "Ez a levél már kiment, nem kell újra sorba tenni.",
      ),
    ).toBeTruthy();
  });

  it("an unreadable queue is one quiet line, and nothing stuck shows nothing", async () => {
    api.stuck.mockRejectedValueOnce(
      new Error("A webshop levél-sora most nem érhető el (HTTP 404)."),
    );
    const { unmount } = render(
      <WebshopStuckMails token="t" onOpenTemplate={() => undefined} />,
    );
    expect(
      await screen.findByText(
        /most nem olvashatók: A webshop levél-sora most nem érhető el/,
      ),
    ).toBeTruthy();
    unmount();
    api.stuck.mockResolvedValueOnce({ items: [], count: 0 });
    const { container } = render(
      <WebshopStuckMails token="t" onOpenTemplate={() => undefined} />,
    );
    await waitFor(() => expect(api.stuck).toHaveBeenCalledTimes(2));
    expect(container.textContent).toBe("");
  });
});
