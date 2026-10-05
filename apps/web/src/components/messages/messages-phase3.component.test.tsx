import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  ConversationListItem,
  MessageItem,
  Session,
} from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MessagesPage } from "./messages-page";

/*
  A 3. FÁZIS A WEBEN (terv: uzenetek-3-fazis-terv.md; Figma 453:491, 450:260,
  453:244). A fejléc (mockok, fixtúrák) a 2. fázis tesztjének mintája. Ami pirosít:
  - más üzenetén nincs Továbbítás vagy Kitűzés;
  - a továbbítás nem a kiválasztott beszélgetésbe megy, vagy egy újrapróbálás
    ÚJ clientMessageId-vel menne (duplikálna); a mostani beszélgetés cél lehet;
  - a kitűzés nem a szerverre megy, vagy a kitűzött üzeneten nem a levétel áll;
  - a keresés „Ugrás”-a egy be nem töltött üzenethez nem a köré nyíló oldalt kéri;
  - a beállításokban „Csak említések” választható, vagy a mentés nem a
    kiválasztott módot küldi;
  - a továbbított üzenetről nem látszik az eredeti szerző.
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
}));
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

const theirs = message("m1", "anna", "Megérkezett már a pumpa?");
const mine = message("m2", "me", "Igen, most vettem át.");

beforeEach(() => {
  auth.session = session;
  stream.listeners = [];
  for (const fn of Object.values(api)) fn.mockReset();
  upload.fn.mockReset();
  api.list.mockResolvedValue({ items: [conversation] });
  api.page.mockResolvedValue({ items: [theirs, mine], olderCursor: null });
  api.markRead.mockResolvedValue({ moved: true });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const row = (id: string) => screen.findByTestId(`message-${id}`);

beforeEach(() => {
  api.pins.mockResolvedValue({ items: [] });
  api.detail.mockResolvedValue({
    ...conversation,
    description: null,
    createdByUserId: "me",
    lastReadMessageId: null,
    notification: { notify: "ALL", mutedUntil: null },
  });
  api.shared.mockResolvedValue({ items: [], olderCursor: null });
});

describe("forward and pin in the menu", () => {
  it("someone else's message has Továbbítás and Kitűzés, but not Szerkesztés", async () => {
    render(<MessagesPage />);
    const other = within(await row("m1"));
    expect(other.getByRole("button", { name: "Továbbítás" })).toBeTruthy();
    expect(other.getByRole("button", { name: "Kitűzés" })).toBeTruthy();
    expect(other.queryByRole("button", { name: "Szerkesztés" })).toBeNull();
  });

  it("forwarding goes to the chosen conversation, the current one is not offered, and a retry keeps the client id", async () => {
    const other: ConversationListItem = {
      ...conversation,
      id: "c2",
      type: "GROUP",
      title: "Zoo szerviz",
    };
    api.list.mockResolvedValue({ items: [conversation, other] });
    api.forward
      .mockRejectedValueOnce(new Error("Nincs kapcsolat."))
      .mockResolvedValueOnce(message("m9", "me", "Megérkezett már a pumpa?"));
    render(<MessagesPage />);
    fireEvent.click(
      within(await row("m1")).getByRole("button", { name: "Továbbítás" }),
    );
    const dialog = within(
      await screen.findByRole("dialog", { name: "Továbbítás" }),
    );
    const targets = await dialog.findAllByRole("radio");
    expect(targets).toHaveLength(1);
    fireEvent.click(targets[0]!);
    fireEvent.click(dialog.getByRole("button", { name: "Továbbítás" }));
    expect(await dialog.findByRole("alert")).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "Továbbítás" }));
    await waitFor(() => expect(api.forward).toHaveBeenCalledTimes(2));
    const [first, second] = api.forward.mock.calls;
    expect(first![1]).toBe("m1");
    expect(first![2].conversationId).toBe("c2");
    expect(second![2].clientMessageId).toBe(first![2].clientMessageId);
    expect(await screen.findByText("Továbbítva: Zoo szerviz")).toBeTruthy();
  });

  it("pin goes to the server, and the pinned message offers the unpin", async () => {
    api.pin.mockResolvedValue({ ...theirs, pinned: true });
    api.unpin.mockResolvedValue({ ...theirs, pinned: false });
    render(<MessagesPage />);
    fireEvent.click(
      within(await row("m1")).getByRole("button", { name: "Kitűzés" }),
    );
    await waitFor(() => expect(api.pin).toHaveBeenCalledWith("t1", "m1"));
    const unpin = await within(await row("m1")).findByRole("button", {
      name: "Kitűzés levétele",
    });
    fireEvent.click(unpin);
    await waitFor(() => expect(api.unpin).toHaveBeenCalledWith("t1", "m1"));
  });

  it("a forwarded message names its original author", async () => {
    api.page.mockResolvedValue({
      items: [
        message("m5", "me", "eredeti szöveg", {
          forwardedFrom: { senderName: "Nagy Péter" },
        }),
      ],
      olderCursor: null,
    });
    render(<MessagesPage />);
    expect(
      within(await row("m5")).getByTestId("forwarded-from").textContent,
    ).toBe("Továbbítva · Nagy Péter");
  });
});

describe("the search and pins drawer", () => {
  it("a hit not loaded yet opens the page around it, and the hit is highlighted", async () => {
    api.search.mockResolvedValue({
      total: 1,
      totalCapped: false,
      items: [
        {
          messageId: "m0",
          senderName: "Kovács Anna",
          createdAt: "2026-10-01T09:00:00.000Z",
          snippet: "…a tartalék pumpa a raktárban van.",
        },
      ],
    });
    api.around.mockResolvedValue({
      items: [message("m0", "anna", "A tartalék pumpa a raktárban van.")],
      olderCursor: null,
      newerCursor: "kurzor-1",
    });
    render(<MessagesPage />);
    await row("m1");
    fireEvent.click(
      screen.getByRole("button", { name: "Keresés és kitűzött elemek" }),
    );
    const drawer = within(
      await screen.findByRole("complementary", {
        name: "Keresés és kitűzött elemek",
      }),
    );
    fireEvent.change(
      drawer.getByRole("textbox", { name: "Keresés a beszélgetésben" }),
      {
        target: { value: "pumpa" },
      },
    );
    expect(
      await drawer.findByText("1 találat", undefined, { timeout: 2000 }),
    ).toBeTruthy();
    expect(api.search).toHaveBeenCalledWith(
      "t1",
      "c1",
      "pumpa",
      expect.anything(),
    );
    fireEvent.click(drawer.getByRole("button", { name: "Ugrás" }));
    await waitFor(() =>
      expect(api.around).toHaveBeenCalledWith("t1", "c1", "m0"),
    );
    expect((await row("m0")).getAttribute("data-highlighted")).toBe("true");
  });

  it("an empty pin list says so", async () => {
    render(<MessagesPage />);
    await row("m1");
    fireEvent.click(
      screen.getByRole("button", { name: "Keresés és kitűzött elemek" }),
    );
    expect(await screen.findByTestId("pins-empty")).toBeTruthy();
  });
});

describe("the details drawer", () => {
  it("settings offer no 'Csak említések', and saving sends the chosen mode", async () => {
    api.setNotification.mockResolvedValue({
      notify: "ALL",
      mutedUntil: "2099-01-01T07:00:00.000Z",
    });
    render(<MessagesPage />);
    await row("m1");
    fireEvent.click(screen.getByRole("button", { name: "Beszélgetés adatai" }));
    const drawer = within(
      await screen.findByRole("complementary", { name: "Beszélgetés adatai" }),
    );
    fireEvent.click(drawer.getByRole("tab", { name: "Beállítások" }));
    expect(drawer.queryByText("Csak említések")).toBeNull();
    fireEvent.click(drawer.getByRole("radio", { name: /Némítás holnapig/ }));
    fireEvent.click(
      drawer.getByRole("button", { name: "Beállítások mentése" }),
    );
    await waitFor(() =>
      expect(api.setNotification).toHaveBeenCalledWith(
        "t1",
        "c1",
        "MUTE_UNTIL_MORNING",
      ),
    );
    expect(await drawer.findByText("A beállítás elmentve.")).toBeTruthy();
  });
});
