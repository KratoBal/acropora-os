import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ConversationListItem } from "@acropora/types";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/api/messages", () => ({
  messagesApi: api,
  attachmentUrl: () => "",
}));

import { ForwardDialog } from "./conversation-drawer";

/*
  A TOVÁBBÍTÁS CÉLPONTJAI (bd46ff05). A partneres beszélgetésbe a szerver nem
  enged továbbítani (#1531: 400), tehát a felület fel sem kínálja. MI
  PIROSÍT: ha a partneres beszélgetés a célpontok között áll; ha a belső eltűnik.
*/
const item = (id: string, title: string, audience: "INTERNAL" | "PARTNER") =>
  ({
    id,
    type: "GROUP",
    audience,
    title,
    members: [],
    lastMessage: null,
    lastMessageAt: null,
    unreadCount: 0,
  }) as ConversationListItem;

afterEach(() => cleanup());

describe("forward targets", () => {
  it("a partner conversation is never offered, an internal one is", async () => {
    api.list.mockResolvedValue({
      items: [
        item("i1", "Raktár", "INTERNAL"),
        item("p1", "HJ-2026-0042 · partner", "PARTNER"),
      ],
    });
    render(
      <ForwardDialog
        token="t1"
        currentConversationId="c0"
        onClose={() => undefined}
        onForward={async () => undefined}
      />,
    );
    await waitFor(() => expect(screen.getByText("Raktár")).toBeTruthy());
    expect(screen.queryByText("HJ-2026-0042 · partner")).toBeNull();
  });
});
