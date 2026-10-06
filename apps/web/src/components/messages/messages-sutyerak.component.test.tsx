import { act, cleanup, render, screen, within } from "@testing-library/react";
import type {
  ConversationListItem,
  MessageItem,
  Session,
} from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MessagesPage } from "./messages-page";
import { NewConversationDialog } from "./new-conversation-dialog";

/*
  SUTYERÁK AZ ÜZENETEKBEN, A WEBEN (4. pont, B; szerződés:
  agents/murena/megosztas/sutyerak-4-pont-B-vegpontok.md). Ami pirosít:
  - Sutyerák nem a kollégaválasztó elején áll, vagy monogramot kap figura helyett;
  - Sutyerák üzenete nyers szövegként jelenik meg, vagy HTML-t injektálhat;
  - az acrobot adta válasz nincs jelölve;
  - a „gondolkodik” jelzés nem jön az eseményre, nem megy el a végére, egy MÁSIK
    beszélgetés eseményére is megjelenik, vagy újratöltés után elveszik.
*/

const auth = vi.hoisted(() => ({ session: null as Session | null }));
const nav = vi.hoisted(() => ({ query: "c=c1", replace: vi.fn() }));
const api = vi.hoisted(() => ({
  list: vi.fn(),
  page: vi.fn(),
  send: vi.fn(),
  markRead: vi.fn(),
  message: vi.fn(),
  edit: vi.fn(),
  remove: vi.fn(),
  react: vi.fn(),
  unreact: vi.fn(),
  around: vi.fn(),
  newer: vi.fn(),
  search: vi.fn(),
  shared: vi.fn(),
  pins: vi.fn(),
  pin: vi.fn(),
  unpin: vi.fn(),
  forward: vi.fn(),
  detail: vi.fn(),
  setNotification: vi.fn(),
  people: vi.fn(),
  addMembers: vi.fn(),
  leave: vi.fn(),
  linkContext: vi.fn(),
  unlinkContext: vi.fn(),
}));
const lists = vi.hoisted(() => ({ worksheets: vi.fn(), serviceJobs: vi.fn() }));
const upload = vi.hoisted(() => ({ fn: vi.fn() }));
const stream = vi.hoisted(() => ({
  listeners: [] as ((s: unknown) => void)[],
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/messages", () => ({
  messagesApi: api,
  MESSAGE_STREAM_URL: "/api/messages/stream",
  attachmentUrl: (id: string, variant?: string) =>
    `/api/messages/attachments/${id}${variant ? `?variant=${variant}` : ""}`,
  uploadMessageAttachment: (...args: unknown[]) => upload.fn(...args),
}));
vi.mock("@/lib/api/worksheets", () => ({
  worksheetsApi: { list: (...args: unknown[]) => lists.worksheets(...args) },
}));
vi.mock("@/lib/api/service-jobs", () => ({
  serviceJobsApi: { list: (...args: unknown[]) => lists.serviceJobs(...args) },
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

const message = (
  id: string,
  sender: string,
  text: string | null,
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
  members: [
    {
      userId: "anna",
      name: "Kovács Anna",
      avatarUrl: null,
      role: "SERVICE",
      isActive: true,
    },
  ],
  lastMessage: null,
  lastMessageAt: null,
  unreadCount: 0,
};

const sutyerak = {
  userId: "sutyerak",
  name: "Sutyerák",
  avatarUrl: null,
  role: "SERVICE" as const,
  isActive: true,
  kind: "assistant" as const,
};
const withSutyerak: ConversationListItem = {
  ...conversation,
  members: [sutyerak],
};
const detailWith = (thinking: boolean) => ({
  ...withSutyerak,
  description: null,
  createdByUserId: "me",
  lastReadMessageId: null,
  notification: { notify: "ALL", mutedUntil: null },
  assistantThinking: thinking,
});
const question = message("q1", "me", "Hol tart a BIO-2026-001?");
const answer = message(
  "a1",
  "sutyerak",
  "**Folyamatban**\n- a pumpa megjött\n<img src=x onerror=alert(1)>",
  { senderName: "Sutyerák", assistant: { viaAcrobot: false } },
);
const handoff = message("a2", "sutyerak", "A számlát holnap küldik.", {
  senderName: "Sutyerák",
  assistant: { viaAcrobot: true },
});
const emit = (signal: unknown) =>
  act(() => stream.listeners.forEach((listener) => listener(signal)));

beforeEach(() => {
  auth.session = session;
  stream.listeners = [];
  for (const fn of Object.values(api)) fn.mockReset();
  api.list.mockResolvedValue({ items: [withSutyerak] });
  api.page.mockResolvedValue({
    items: [question, answer, handoff],
    olderCursor: null,
  });
  api.markRead.mockResolvedValue({ moved: true });
  api.pins.mockResolvedValue({ items: [] });
  api.detail.mockResolvedValue(detailWith(false));
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Sutyerák az Üzenetekben (web)", () => {
  it("his answer is Markdown with no HTML, and acrobot's answer is labelled", async () => {
    render(<MessagesPage />);
    const own = await screen.findByTestId("message-a1");
    expect(within(own).getByText("Folyamatban").tagName).toBe("STRONG");
    expect(within(own).getByText("a pumpa megjött").tagName).toBe("LI");
    expect(own.querySelector("img[src='x']")).toBeNull();
    const relayed = await screen.findByTestId("message-a2");
    expect(
      within(relayed).getByText("Sutyerák, Acrobot válaszával"),
    ).toBeInTheDocument();
    expect(
      within(own).queryByText("Sutyerák, Acrobot válaszával"),
    ).not.toBeInTheDocument();
    // a dolgozó saját üzenete marad sima szöveg
    expect(
      (await screen.findByTestId("message-q1")).querySelector(
        "[data-testid='assistant-text']",
      ),
    ).toBeNull();
  });

  it("the conversation shows his figure, not a monogram", async () => {
    render(<MessagesPage />);
    await screen.findByTestId("message-a1");
    expect(screen.getAllByTestId("sutyerak-avatar").length).toBeGreaterThan(0);
  });

  it("'thinking' follows the event of THIS conversation, and survives a reload through the detail", async () => {
    render(<MessagesPage />);
    await screen.findByTestId("message-a1");
    expect(screen.queryByTestId("sutyerak-thinking")).not.toBeInTheDocument();
    emit({ type: "assistant.thinking", conversationId: "other", active: true });
    expect(screen.queryByTestId("sutyerak-thinking")).not.toBeInTheDocument();
    emit({ type: "assistant.thinking", conversationId: "c1", active: true });
    expect(screen.getByTestId("sutyerak-thinking")).toHaveTextContent(
      "Sutyerák gondolkodik",
    );
    emit({ type: "assistant.thinking", conversationId: "c1", active: false });
    expect(screen.queryByTestId("sutyerak-thinking")).not.toBeInTheDocument();
    cleanup();

    stream.listeners = [];
    api.detail.mockResolvedValue(detailWith(true));
    render(<MessagesPage />);
    expect(await screen.findByTestId("sutyerak-thinking")).toBeInTheDocument();
  });

  it("the picker puts Sutyerák first, with his figure and no role label", async () => {
    api.people.mockResolvedValue({
      items: [
        {
          userId: "anna",
          name: "Kovács Anna",
          avatarUrl: null,
          role: "SERVICE",
          isActive: true,
        },
        sutyerak,
      ],
    });
    render(
      <NewConversationDialog
        token="t1"
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );
    const list = await screen.findByRole("list", { name: "Kollégák" });
    await within(list).findByText("Sutyerák");
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Sutyerák");
    expect(rows[0]).toHaveTextContent("Segéd, kérdezd bármiről");
    expect(within(rows[0]!).getByTestId("sutyerak-avatar")).toBeInTheDocument();
    expect(within(rows[1]!).queryByTestId("sutyerak-avatar")).toBeNull();
  });
});
