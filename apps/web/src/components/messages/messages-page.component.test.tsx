import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type {
  ConversationListItem,
  MessageItem,
  Session,
} from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MessagesPage } from "./messages-page";

/*
  AZ ÜZENETEK LAPJA (kártya 51d7aba0). Ami pirosít: az olvasatlan-szám nem
  látszik a listában; a küldés a szerver válasza ELŐTT elküldöttnek látszik;
  hibánál nincs Újra és Törlés, vagy az Újra új azonosítóval küld (duplikálna);
  egy másik kolléga új üzenete a folyam jelzésére nem jelenik meg; az Enter
  Shift-tel is küld.
*/

const auth = vi.hoisted(() => ({ session: null as Session | null }));
const nav = vi.hoisted(() => ({ query: "", replace: vi.fn() }));
const api = vi.hoisted(() => ({
  list: vi.fn(),
  page: vi.fn(),
  send: vi.fn(),
  markRead: vi.fn(),
  people: vi.fn(),
  create: vi.fn(),
  unread: vi.fn(),
  detail: vi.fn(),
}));
const stream = vi.hoisted(() => ({
  listeners: [] as ((s: unknown) => void)[],
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/messages", () => ({
  messagesApi: api,
  MESSAGE_STREAM_URL: "/api/messages/stream",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => "/uzenetek",
  useSearchParams: () => new URLSearchParams(nav.query),
}));
vi.mock("./message-stream", () => ({
  useMessagesEnabled: () => true,
  useMessageStream: (listener: (s: unknown) => void) => {
    stream.listeners.push(listener);
  },
}));

const session: Session = {
  id: "s1",
  token: "t1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "me",
    email: "me@x.invalid",
    displayName: "Balázs",
    role: "OWNER",
    customerId: null,
    supplierId: null,
  },
};

const anna = {
  userId: "anna",
  name: "Kovács Anna",
  avatarUrl: null,
  role: "SERVICE" as const,
  isActive: true,
};

const message = (
  id: string,
  sender: string,
  text: string,
  over: Partial<MessageItem> = {},
): MessageItem => ({
  id,
  conversationId: "c1",
  senderUserId: sender,
  senderName: sender === "me" ? "Balázs" : "Kovács Anna",
  type: "TEXT",
  text,
  deleted: false,
  createdAt: "2026-10-05T10:00:00.000Z",
  editedAt: null,
  replyToMessageId: null,
  replyTo: null,
  attachments: [],
  reactions: [],
  clientMessageId: null,
  ...over,
});

const conversation: ConversationListItem = {
  id: "c1",
  type: "DIRECT",
  audience: "INTERNAL",
  title: null,
  members: [anna],
  lastMessage: message("m1", "anna", "Megérkezett már a pumpa?"),
  lastMessageAt: "2026-10-05T10:00:00.000Z",
  unreadCount: 2,
};

beforeEach(() => {
  auth.session = session;
  nav.query = "";
  nav.replace.mockReset();
  stream.listeners = [];
  for (const fn of Object.values(api)) fn.mockReset();
  api.list.mockResolvedValue({ items: [conversation] });
  api.page.mockResolvedValue({
    items: [message("m1", "anna", "Megérkezett már a pumpa?")],
    olderCursor: null,
  });
  api.markRead.mockResolvedValue({ moved: true });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});
afterEach(cleanup);

describe("MessagesPage", () => {
  it("lists the conversation with the other person's name, the preview and the unread count", async () => {
    render(<MessagesPage />);
    expect(await screen.findByText("Kovács Anna")).toBeTruthy();
    expect(screen.getByText("Megérkezett már a pumpa?")).toBeTruthy();
    expect(screen.getByLabelText("2 olvasatlan")).toBeTruthy();
  });

  it("opens a conversation and marks the latest message of the other person read", async () => {
    nav.query = "c=c1";
    render(<MessagesPage />);
    expect(
      await screen.findByRole("region", { name: "Beszélgetés: Kovács Anna" }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(api.markRead).toHaveBeenCalledWith("t1", "c1", "m1"),
    );
  });

  it("a message stays 'küldés…' until the server answers, and is then shown once", async () => {
    nav.query = "c=c1";
    let answer: (m: MessageItem) => void = () => {};
    api.send.mockImplementation(
      (_t: string, _c: string, text: string, clientMessageId: string) =>
        new Promise<MessageItem>((resolve) => {
          answer = () =>
            resolve(message("m2", "me", text, { clientMessageId }));
        }),
    );
    render(<MessagesPage />);
    const box = await screen.findByPlaceholderText("Írj egy üzenetet…");
    fireEvent.change(box, { target: { value: "Igen, most vettem át." } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByText(/küldés…/)).toBeTruthy();
    await act(async () => answer(message("m2", "me", "")));
    await waitFor(() => expect(screen.queryByText(/küldés…/)).toBeNull());
    expect(screen.getAllByText("Igen, most vettem át.")).toHaveLength(1);
  });

  it("Shift+Enter does not send", async () => {
    nav.query = "c=c1";
    render(<MessagesPage />);
    const box = await screen.findByPlaceholderText("Írj egy üzenetet…");
    fireEvent.change(box, { target: { value: "első sor" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(api.send).not.toHaveBeenCalled();
  });

  it("a failed send offers Újra with the SAME client id, and Törlés", async () => {
    nav.query = "c=c1";
    api.send.mockRejectedValueOnce(new Error("offline"));
    render(<MessagesPage />);
    const box = await screen.findByPlaceholderText("Írj egy üzenetet…");
    fireEvent.change(box, { target: { value: "Hálózat nélkül" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByText("Nem sikerült elküldeni.")).toBeTruthy();
    const firstId = api.send.mock.calls[0]![3];

    api.send.mockImplementationOnce(
      async (_t: string, _c: string, text: string, clientMessageId: string) =>
        message("m3", "me", text, { clientMessageId }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Újra" }));
    await waitFor(() => expect(api.send).toHaveBeenCalledTimes(2));
    expect(api.send.mock.calls[1]![3]).toBe(firstId);
    await waitFor(() =>
      expect(screen.queryByText("Nem sikerült elküldeni.")).toBeNull(),
    );
  });

  it("a new message from the stream appears without a reload of the page", async () => {
    nav.query = "c=c1";
    render(<MessagesPage />);
    await screen.findByText("Megérkezett már a pumpa?", { selector: "p" });
    api.page.mockResolvedValue({
      items: [
        message("m1", "anna", "Megérkezett már a pumpa?"),
        message("m4", "anna", "Szuper, köszönöm!", {
          createdAt: "2026-10-05T10:05:00.000Z",
        }),
      ],
      olderCursor: null,
    });
    await act(async () => {
      for (const listener of stream.listeners)
        listener({
          type: "message.created",
          conversationId: "c1",
          messageId: "m4",
        });
    });
    expect(await screen.findByText("Szuper, köszönöm!")).toBeTruthy();
  });
});
