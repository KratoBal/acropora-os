import {
  act,
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
  A 2. FÁZIS A WEBEN (kártya 51d7aba0, Figma 453:287). Ami pirosít:
  - a válasz nem viszi a `replyToMessageId`-t, vagy az előnézet küldés után ott marad;
  - más üzenetén is van Szerkesztés vagy Törlés;
  - a szerkesztés, a törlés vagy a reakció nem a szerverre megy, vagy az
    eredmény nem frissíti az üzenetet;
  - a saját reakció újrakattintása nem veszi le;
  - feltöltés közben küldeni lehet, a kész feltöltés azonosítója nem megy a
    küldéssel, a hibás feltöltés nem próbálható újra UGYANAZZAL a fájllal;
  - csatolmány szöveg nélkül nem küldhető;
  - a `message.updated` jelzés nem olvassa újra az üzenetet;
  - a törölt üzenetnek van művelet-sávja.
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
  // 4. fázis: a nézet a kapcsolt kártyáért a beszélgetés adatait is kéri
  detail: vi.fn(),
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
  api.detail.mockResolvedValue({ ...conversation, context: null });
  api.page.mockResolvedValue({ items: [theirs, mine], olderCursor: null });
  api.markRead.mockResolvedValue({ moved: true });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const row = (id: string) => screen.findByTestId(`message-${id}`);
const box = () => screen.findByRole("textbox", { name: "Üzenet" });

describe("message actions", () => {
  it("only my own message has Szerkesztés and Üzenet törlése", async () => {
    render(<MessagesPage />);
    const own = within(await row("m2"));
    const other = within(await row("m1"));
    expect(own.getByRole("button", { name: "Szerkesztés" })).toBeTruthy();
    expect(own.getByRole("button", { name: "Üzenet törlése" })).toBeTruthy();
    expect(other.queryByRole("button", { name: "Szerkesztés" })).toBeNull();
    expect(other.queryByRole("button", { name: "Üzenet törlése" })).toBeNull();
    expect(other.getByRole("button", { name: "Válasz" })).toBeTruthy();
  });

  it("a reply carries the original's id, and the preview goes away after sending", async () => {
    api.send.mockImplementation(
      async (
        _t: string,
        _c: string,
        input: { text?: string; clientMessageId: string },
      ) =>
        message("m3", "me", input.text ?? "", {
          clientMessageId: input.clientMessageId,
        }),
    );
    render(<MessagesPage />);
    fireEvent.click(
      within(await row("m1")).getByRole("button", { name: "Válasz" }),
    );
    expect((await screen.findByTestId("reply-preview")).textContent).toContain(
      "Kovács Anna",
    );
    fireEvent.change(await box(), { target: { value: "Rendben" } });
    fireEvent.keyDown(await box(), { key: "Enter" });
    await waitFor(() => expect(api.send).toHaveBeenCalled());
    expect(api.send.mock.calls[0]![2]).toMatchObject({
      text: "Rendben",
      replyToMessageId: "m1",
    });
    expect(screen.queryByTestId("reply-preview")).toBeNull();
  });

  it("an edit goes to the server and the message shows it was edited", async () => {
    api.edit.mockResolvedValue(
      message("m2", "me", "Igen, átvettem.", {
        editedAt: "2026-10-05T10:05:00.000Z",
      }),
    );
    render(<MessagesPage />);
    fireEvent.click(
      within(await row("m2")).getByRole("button", { name: "Szerkesztés" }),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Az üzenet új szövege" }),
      {
        target: { value: "Igen, átvettem." },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() =>
      expect(api.edit).toHaveBeenCalledWith("t1", "m2", "Igen, átvettem."),
    );
    expect((await row("m2")).textContent).toContain("szerkesztve");
  });

  it("a delete asks first, then the message reads as deleted and has no actions", async () => {
    api.remove.mockResolvedValue({ deleted: true });
    api.message.mockResolvedValue(message("m2", "me", null, { deleted: true }));
    render(<MessagesPage />);
    const askDelete = async () =>
      fireEvent.click(
        within(await row("m2")).getByRole("button", {
          name: "Üzenet törlése",
        }),
      );

    // a „Mégsem” nem töröl
    await askDelete();
    const first = screen.getByRole("dialog", { name: "Törlöd az üzenetet?" });
    fireEvent.click(within(first).getByRole("button", { name: "Mégsem" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.remove).not.toHaveBeenCalled();

    await askDelete();
    const second = screen.getByRole("dialog", { name: "Törlöd az üzenetet?" });
    fireEvent.click(within(second).getByRole("button", { name: "Törlés" }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith("t1", "m2"));
    expect(api.remove).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(async () =>
      expect((await row("m2")).textContent).toContain("Az üzenetet törölték."),
    );
    expect(within(await row("m2")).queryByRole("toolbar")).toBeNull();
  });

  it("a reaction is added, and my own is taken back by clicking it again", async () => {
    api.react.mockResolvedValue(
      message("m1", "anna", theirs.text, {
        reactions: [{ reaction: "👍", count: 1, mine: true }],
      }),
    );
    api.unreact.mockResolvedValue(message("m1", "anna", theirs.text));
    render(<MessagesPage />);
    fireEvent.click(
      within(await row("m1")).getByRole("button", { name: "Reakció: 👍" }),
    );
    await waitFor(() =>
      expect(api.react).toHaveBeenCalledWith("t1", "m1", "👍"),
    );
    fireEvent.click(
      await within(await row("m1")).findByRole("button", { name: "👍 1" }),
    );
    await waitFor(() =>
      expect(api.unreact).toHaveBeenCalledWith("t1", "m1", "👍"),
    );
  });

  it("a message.updated signal re-reads that one message", async () => {
    api.message.mockResolvedValue(
      message("m1", "anna", "Megjött a pumpa!", {
        editedAt: "2026-10-05T10:06:00.000Z",
      }),
    );
    render(<MessagesPage />);
    await row("m1");
    await act(async () => {
      for (const listener of stream.listeners)
        listener({
          type: "message.updated",
          conversationId: "c1",
          messageId: "m1",
        });
    });
    await waitFor(() => expect(api.message).toHaveBeenCalledWith("t1", "m1"));
    expect((await row("m1")).textContent).toContain("Megjött a pumpa!");
  });
});

describe("attachments", () => {
  const file = new File([new Uint8Array(1000)], "zoo-pumpa.jpg", {
    type: "image/jpeg",
  });

  it("no send while uploading; a file alone may go, with its id", async () => {
    let finish: () => void = () => {};
    upload.fn.mockImplementation(
      (_t: string, _c: string, _f: File, onProgress: (p: number) => void) =>
        new Promise((resolve) => {
          onProgress(40);
          finish = () =>
            resolve({
              id: "f1",
              kind: "IMAGE",
              fileName: "zoo-pumpa.jpg",
              contentType: "image/jpeg",
              sizeBytes: 1000,
              hasThumbnail: true,
            });
        }),
    );
    api.send.mockImplementation(
      async (_t: string, _c: string, input: { clientMessageId: string }) =>
        message("m4", "me", null, { clientMessageId: input.clientMessageId }),
    );
    render(<MessagesPage />);
    fireEvent.change(await screen.findByTestId("attachment-input"), {
      target: { files: [file] },
    });
    expect(await screen.findByText("40%")).toBeTruthy();
    const sendButton = screen.getByRole("button", {
      name: "Küldés",
    }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);
    await act(async () => finish());
    await waitFor(() => expect(sendButton.disabled).toBe(false));
    fireEvent.click(sendButton);
    await waitFor(() => expect(api.send).toHaveBeenCalled());
    expect(api.send.mock.calls[0]![2]).toMatchObject({ attachmentIds: ["f1"] });
    expect(api.send.mock.calls[0]![2].text).toBeUndefined();
  });

  it("a failed upload is retried with the same file", async () => {
    upload.fn
      .mockRejectedValueOnce(
        new Error("A feltöltés nem sikerült: nincs kapcsolat."),
      )
      .mockResolvedValueOnce({
        id: "f2",
        kind: "IMAGE",
        fileName: "zoo-pumpa.jpg",
        contentType: "image/jpeg",
        sizeBytes: 1000,
        hasThumbnail: true,
      });
    render(<MessagesPage />);
    fireEvent.change(await screen.findByTestId("attachment-input"), {
      target: { files: [file] },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Újra: zoo-pumpa.jpg" }),
    );
    await waitFor(() => expect(upload.fn).toHaveBeenCalledTimes(2));
    expect(upload.fn.mock.calls[1]![2]).toBe(file);
  });

  it("a file over 10 MB is not uploaded at all", async () => {
    const big = new File([new Uint8Array(11 * 1024 * 1024)], "nagy.pdf", {
      type: "application/pdf",
    });
    render(<MessagesPage />);
    fireEvent.change(await screen.findByTestId("attachment-input"), {
      target: { files: [big] },
    });
    expect(await screen.findByText("A fájl nagyobb 10 MB-nál.")).toBeTruthy();
    expect(upload.fn).not.toHaveBeenCalled();
  });
});

/*
  AZ ELHAGYOTT LAP NEM OLVAS ÚJRA (2026-10-06, a CI-ban: egy tesztfájl vége
  után elsült a 300 ms-os újraolvasás, és „window is not defined” vitte
  pirosra a teljes futást). MI PIROSÍT: az időzítő túléli a lapot.
*/
describe("the delayed list reload", () => {
  it("dies with the page: a signal right before leaving reads nothing afterwards", async () => {
    const page = render(<MessagesPage />);
    await row("m1");
    const calls = api.list.mock.calls.length;
    act(() =>
      stream.listeners.forEach((listener) =>
        listener({ type: "conversation.read", conversationId: "c1" }),
      ),
    );
    page.unmount();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(api.list.mock.calls.length).toBe(calls);
  });
});

describe("a late answer after the page is gone (card d27df94f)", () => {
  /*
    A MÁSIK ÚT AZ IDŐZÍTŐHÖZ: a beszélgetés-nézet olvasottnak jelöl
    (`markRead(...).then(onChanged)`), és az `onChanged` a lap késleltetett
    újraolvasását indítja. Ha a jelölés válasza a lap lebontása UTÁN jön, a
    lebontás már nem törölheti az akkor induló időzítőt. Ez ingadozott a CI-ban
    (a fenti „dies with the page” teszt a 400 ms alatt egy listaolvasást látott):
    a válasz hol a lebontás előtt jött, hol utána. Itt a sorrend rögzített: a
    válasz a lebontás után jön, és utána a lap már nem olvas.
  */
  it("a mark-read answer arriving after leaving schedules no list read", async () => {
    let answer: (value: { moved: boolean }) => void = () => {};
    api.markRead.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const page = render(<MessagesPage />);
      await row("m1");
      await vi.waitFor(() => expect(api.markRead).toHaveBeenCalled());
      const calls = api.list.mock.calls.length;
      page.unmount();
      await act(async () => {
        answer({ moved: true });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(api.list.mock.calls.length).toBe(calls);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a list request still pending when the page goes", () => {
  it("is aborted when the page goes, so its answer cannot write into a page that is gone", async () => {
    let signal: AbortSignal | undefined;
    api.list.mockImplementationOnce(
      (_token: string, current?: AbortSignal) =>
        new Promise(() => {
          signal = current;
        }),
    );
    const page = render(<MessagesPage />);
    await vi.waitFor(() => expect(signal).toBeDefined());
    expect(signal!.aborted).toBe(false);
    page.unmount();
    expect(signal!.aborted).toBe(true);
  });
});
