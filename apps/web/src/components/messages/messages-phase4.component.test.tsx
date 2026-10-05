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
  A 4. FÁZIS A WEBEN (terv: uzenetek-4-fazis-terv.md, 2.3 és 2.4; Figma
  450:323, 450:474). A fejléc a 3. fázis tesztjének mintája. Ami pirosít:
  - a kapcsolt munkalap kártyája hiányzik, vagy korlátozott kártyán is van
    „Megnyitás” (kiskapu a szerviz-adatokhoz);
  - a rendszer-esemény buborékként, művelet-menüvel jelenik meg;
  - direkt beszélgetésben tagot lehet hozzáadni vagy kilépni;
  - a kilépés megerősítés nélkül megy, vagy utána a beszélgetés nyitva marad;
  - a tag hozzáadása a mostani tagokat is felkínálja, vagy nem a kiválasztottakat küldi;
  - a kapcsolás nem a kiválasztott fajtára és azonosítóra megy;
  - a szerver magyar elutasítása (pl. a tárgynak már van beszélgetése) nem látszik.
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
  lists.worksheets.mockReset();
  lists.serviceJobs.mockReset();
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

const group: ConversationListItem = {
  ...conversation,
  type: "GROUP",
  title: "BIO-2026-001 · Fővárosi Állatkert",
  contextType: "WORKSHEET",
};
const card = {
  type: "WORKSHEET" as const,
  id: "ws1",
  number: "BIO-2026-001",
  partnerName: "Fővárosi Állatkert",
  status: "IN_PROGRESS",
  createdAt: "2026-10-05T08:00:00.000Z",
  restricted: false,
};
const detailOf = (item: ConversationListItem, context: unknown) => ({
  ...item,
  description: null,
  createdByUserId: "me",
  lastReadMessageId: null,
  notification: { notify: "ALL", mutedUntil: null },
  context,
});
/*
  A LASSÚ CI-FUTÁS NEM IDŐZÍTÉSEN BUKIK (acrobot 26521: egy futás piros, egy
  zöld, 1130 ms): a fiók csak akkor nyílik, amikor a beszélgetés már betöltött,
  és minden várakozás a MEGJELENÉSRE vár, bő felső határral. Rögzített
  késleltetés nincs.
*/
const SLOW = { timeout: 5000 };
const DETAILS = { name: "Beszélgetés adatai" };

const openDetails = async () => {
  // a beszélgetés betöltött: a „Betöltés…” eltűnt a folyamból
  const list = await screen.findByTestId("message-list", {}, SLOW);
  await waitFor(
    () => expect(within(list).queryByText("Betöltés…")).toBeNull(),
    SLOW,
  );
  fireEvent.click(await screen.findByRole("button", DETAILS, SLOW));
  return within(await screen.findByRole("complementary", DETAILS, SLOW));
};

describe("the linked worksheet", () => {
  it("shows the card with Megnyitás, the subtitle in the list and the header", async () => {
    api.list.mockResolvedValue({ items: [group] });
    api.detail.mockResolvedValue(detailOf(group, card));
    render(<MessagesPage />);
    const shown = await screen.findByTestId("context-card");
    expect(shown.textContent).toContain("KAPCSOLT MUNKALAP");
    expect(shown.textContent).toContain("BIO-2026-001");
    expect(shown.textContent).toContain("Fővárosi Állatkert");
    expect(shown.textContent).toContain("Folyamatban");
    expect(
      within(shown)
        .getByRole("link", { name: "Megnyitás" })
        .getAttribute("href"),
    ).toBe("/szerviz/munkalapok/ws1");
    expect(
      screen.getAllByText(/Munkalaphoz kapcsolva/).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("a restricted card shows the number only, without Megnyitás", async () => {
    api.list.mockResolvedValue({ items: [group] });
    api.detail.mockResolvedValue(
      detailOf(group, {
        ...card,
        partnerName: null,
        status: null,
        createdAt: null,
        restricted: true,
      }),
    );
    render(<MessagesPage />);
    const shown = await screen.findByTestId("context-card");
    expect(shown.textContent).toContain("BIO-2026-001");
    expect(within(shown).queryByRole("link")).toBeNull();
  });

  it("a system event is a centred line, without a bubble menu", async () => {
    api.page.mockResolvedValue({
      items: [
        message(
          "s1",
          "anna",
          "Kovács Anna csatolta ezt a beszélgetést a BIO-2026-001 munkalaphoz.",
          {
            type: "SYSTEM",
          },
        ),
      ],
      olderCursor: null,
    });
    render(<MessagesPage />);
    const line = await screen.findByTestId("system-message");
    expect(line.textContent).toBe(
      "Kovács Anna csatolta ezt a beszélgetést a BIO-2026-001 munkalaphoz.",
    );
    expect(within(await row("s1")).queryByRole("toolbar")).toBeNull();
  });
});

describe("members and leaving", () => {
  it("a direct conversation offers neither adding nor leaving", async () => {
    render(<MessagesPage />);
    const drawer = await openDetails();
    expect(drawer.queryByRole("button", { name: "Tag hozzáadása" })).toBeNull();
    expect(
      drawer.queryByRole("button", { name: "Kilépés a beszélgetésből" }),
    ).toBeNull();
  });

  it("adding offers only non-members and sends the chosen ones", async () => {
    api.list.mockResolvedValue({ items: [group] });
    api.detail.mockResolvedValue(detailOf(group, null));
    api.people.mockResolvedValue({
      items: [
        {
          userId: "anna",
          name: "Kovács Anna",
          avatarUrl: null,
          role: "SERVICE",
          isActive: true,
        },
        {
          userId: "dani",
          name: "Kiss Dániel",
          avatarUrl: null,
          role: "SERVICE",
          isActive: true,
        },
      ],
    });
    api.addMembers.mockResolvedValue(detailOf(group, null));
    render(<MessagesPage />);
    fireEvent.click(
      (await openDetails()).getByRole("button", { name: "Tag hozzáadása" }),
    );
    const dialog = within(
      await screen.findByRole("dialog", { name: "Tag hozzáadása" }),
    );
    await dialog.findByText("Kiss Dániel");
    expect(dialog.queryByText("Kovács Anna")).toBeNull();
    fireEvent.click(dialog.getByRole("checkbox"));
    fireEvent.click(dialog.getByRole("button", { name: "Hozzáadás" }));
    await waitFor(() =>
      expect(api.addMembers).toHaveBeenCalledWith("t1", "c1", ["dani"]),
    );
  });

  it("leaving asks first, then leaves and returns to the list", async () => {
    api.list.mockResolvedValue({ items: [group] });
    api.detail.mockResolvedValue(detailOf(group, null));
    api.leave.mockResolvedValue({ left: true, archived: false });
    render(<MessagesPage />);
    fireEvent.click(
      (await openDetails()).getByRole("button", {
        name: "Kilépés a beszélgetésből",
      }),
    );
    expect(api.leave).not.toHaveBeenCalled();
    const confirm = within(
      await screen.findByRole(
        "dialog",
        { name: "Kilépsz a beszélgetésből?" },
        SLOW,
      ),
    );
    fireEvent.click(confirm.getByRole("button", { name: "Kilépés" }));
    await waitFor(
      () => expect(api.leave).toHaveBeenCalledWith("t1", "c1"),
      SLOW,
    );
    await waitFor(
      () => expect(nav.replace).toHaveBeenCalledWith("/uzenetek"),
      SLOW,
    );
  });
});

describe("linking", () => {
  it("searches the chosen kind by number and links the picked one", async () => {
    api.list.mockResolvedValue({ items: [{ ...group, contextType: null }] });
    api.detail.mockResolvedValue(detailOf(group, null));
    lists.serviceJobs.mockResolvedValue({
      items: [
        {
          id: "job1",
          jobNumber: "SZ-2026-014",
          customerName: "Fővárosi Állatkert",
        },
      ],
    });
    api.linkContext.mockRejectedValueOnce(
      new Error("Ehhez a hibajegyhez már tartozik beszélgetés."),
    );
    render(<MessagesPage />);
    fireEvent.click(
      (await openDetails()).getByRole("button", {
        name: "Kapcsolás munkalaphoz vagy hibajegyhez",
      }),
    );
    const dialog = within(
      await screen.findByRole("dialog", { name: "Kapcsolás" }),
    );
    fireEvent.click(dialog.getByRole("radio", { name: "Hibajegy" }));
    fireEvent.change(dialog.getByRole("textbox", { name: "Szám keresése" }), {
      target: { value: "SZ-2026" },
    });
    fireEvent.click(await dialog.findByRole("button", { name: /SZ-2026-014/ }));
    await waitFor(() =>
      expect(api.linkContext).toHaveBeenCalledWith("t1", "c1", {
        type: "SERVICE_JOB",
        id: "job1",
      }),
    );
    expect((await dialog.findByRole("alert")).textContent).toBe(
      "Ehhez a hibajegyhez már tartozik beszélgetés.",
    );
    expect(lists.worksheets).not.toHaveBeenCalled();
  });

  it("a linked group can be unlinked", async () => {
    api.list.mockResolvedValue({ items: [group] });
    api.detail.mockResolvedValue(detailOf(group, card));
    api.unlinkContext.mockResolvedValue(detailOf(group, null));
    render(<MessagesPage />);
    fireEvent.click(
      (await openDetails()).getByRole("button", { name: "Leválasztás" }),
    );
    await waitFor(() =>
      expect(api.unlinkContext).toHaveBeenCalledWith("t1", "c1"),
    );
  });
});
