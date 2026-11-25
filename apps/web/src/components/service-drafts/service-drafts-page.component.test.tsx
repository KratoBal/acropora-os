import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceDraftListResponse, Session } from "@acropora/types";
import {
  ServiceDraftsPage,
  draftIntakeBadge,
  draftSourceLabel,
  splitQuotedReply,
} from "./service-drafts-page";
vi.mock("next/font/local", () => ({ default: () => ({ className: "inter" }) }));
const mock = vi.hoisted(() => ({
  list: vi.fn(),
  status: vi.fn(),
  places: vi.fn(),
  ticketMailStatus: vi.fn(),
  accept: vi.fn(),
  reject: vi.fn(),
  promote: vi.fn(),
  attachment: vi.fn(),
  push: vi.fn(),
  session: null as Session | null,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mock.push }) }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: mock.session }),
}));
vi.mock("@/lib/api/service-drafts", () => ({ serviceDraftsApi: mock }));
function data(): ServiceDraftListResponse {
  return {
    items: [
      {
        id: "draft",
        title: "Venturi szivattyú",
        originalProblem: "Szivattyú tisztítás\nÉs a csövek javítása.",
        reportDate: "2026-10-03",
        createdAt: "2026-10-04T12:00:00Z",
        status: "PENDING",
        proposedDepartmentId: "dep",
        decidedById: null,
        decidedAt: null,
        acceptedServiceJobId: null,
        source: "CAPASULI_DAILY_REPORT",
        mail: {
          originalText: "Dolgozók: [NEV]\nTeljes napi jelentő",
          subject: "Napi jelentő",
          mailbox: "balazs@acropora.hu",
          fromAddress: null,
          droppedAttachments: 0,
        },
        attachments: [],
        filterState: "PASSED",
        intakeState: "RULE_DRAFT",
        aiSummary: null,
        jevClass: "OUR_TECHNICAL_FAULT",
        jevConfidence: 0.93,
        occurrence: 2,
        earlier: [
          {
            id: "earlier",
            reportDate: "2026-09-26",
            status: "ACCEPTED",
            acceptedServiceJobId: "old-job",
          },
        ],
      },
    ],
    nextCursor: null,
    locations: [
      { id: "dep", parentId: null, name: "Cápasuli", customerId: "zoo" },
    ],
    openedBy: { id: "opener", name: "Cápasuli" },
    filterEnabled: true,
    filtered: [],
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.session = {
    id: "session",
    expiresAt: "2099-01-01",
    token: "token",
    user: {
      id: "admin",
      email: "admin@example.test",
      displayName: "Admin",
      role: "ADMIN",
      customerId: null,
      supplierId: null,
    },
  };
  mock.list.mockResolvedValue(data());
  mock.status.mockResolvedValue({
    enabled: false,
    switchReason: "NOT_SET",
    configured: false,
    mailbox: "balazs@acropora.hu",
    query: "napi jelentő",
    intervalMinutes: 60,
    lastRunAt: null,
    lastError: null,
  });
  mock.places.mockResolvedValue({ items: [] });
  mock.ticketMailStatus.mockResolvedValue({
    enabled: false,
    switchReason: "NOT_SET",
    configured: false,
    mailbox: "ticket@acropora.hu",
    query: "in:inbox",
    intervalMinutes: 10,
    maxMessagesPerRun: 50,
    unknownSenderPerHour: 5,
    description: "off",
    running: false,
    lastRunAt: null,
    lastError: null,
    lastSummary: null,
  });
  mock.accept.mockResolvedValue({ serviceJobId: "job" });
  mock.reject.mockResolvedValue({ serviceJobId: null });
});
describe("Service draft review", () => {
  it("lets the reviewer correct the From display name before accepting", async () => {
    const response = data();
    response.items[0]!.reporterPersonName = "Szilveszter Roland";
    mock.list.mockResolvedValue(response);
    render(<ServiceDraftsPage />);
    const input = await screen.findByLabelText("Jelentő szerzője");
    expect((input as HTMLInputElement).value).toBe("Szilveszter Roland");
    fireEvent.change(input, { target: { value: "Kovács Anna" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Elfogadom: Venturi szivattyú" }),
    );
    await waitFor(() =>
      expect(mock.accept).toHaveBeenCalledWith(
        "token",
        "draft",
        "dep",
        "Kovács Anna",
      ),
    );
  });
  it("shows verbatim text, complete report, repeated occurrence and chosen opener", async () => {
    render(<ServiceDraftsPage />);
    await screen.findByText("Venturi szivattyú");
    expect(screen.getByText(/És a csövek javítása/)).toBeTruthy();
    expect(screen.getByText(/2. alkalom/)).toBeTruthy();
    expect(screen.getByText(/A hibajegy nyitója/)).toBeTruthy();
    fireEvent.click(screen.getByText("Teljes napi jelentő megnyitása"));
    expect(screen.getByText(/Dolgozók/)).toBeTruthy();
  });
  it("accepts selected location once and navigates to the existing ticket detail", async () => {
    render(<ServiceDraftsPage />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Elfogadom: Venturi szivattyú",
      }),
    );
    await waitFor(() =>
      expect(mock.push).toHaveBeenCalledWith("/szerviz/hibajegyek/job"),
    );
    expect(mock.accept).toHaveBeenCalledWith("token", "draft", "dep", "");
    expect(mock.reject).not.toHaveBeenCalled();
  });
  it("records reject without creating or navigating to a ticket", async () => {
    render(<ServiceDraftsPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Elvetem: Venturi szivattyú" }),
    );
    await screen.findByText("A piszkozatot elvetetted.");
    expect(mock.reject).toHaveBeenCalledWith("token", "draft");
    expect(mock.accept).not.toHaveBeenCalled();
    expect(mock.push).not.toHaveBeenCalled();
  });
  it("disables accept when the Capasuli user is missing, leaving reject available", async () => {
    mock.list.mockResolvedValue({ ...data(), openedBy: null });
    render(<ServiceDraftsPage />);
    expect(
      (
        (await screen.findByRole("button", {
          name: "Elfogadom: Venturi szivattyú",
        })) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Elvetem: Venturi szivattyú",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
  it("keeps failed decision visible and allows retry", async () => {
    mock.accept.mockRejectedValue(new Error("Nem menthető"));
    render(<ServiceDraftsPage />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Elfogadom: Venturi szivattyú",
      }),
    );
    await screen.findByText("Nem menthető");
    expect(mock.push).not.toHaveBeenCalled();
  });
  it("does not fetch reports for managers or partner accounts", () => {
    mock.session!.user.role = "MANAGER";
    render(<ServiceDraftsPage />);
    expect(screen.getByText(/csak belső adminisztrátoroknak/)).toBeTruthy();
    expect(mock.list).not.toHaveBeenCalled();
  });
  it("shows empty results and rejected history via separate tabs", async () => {
    mock.list.mockResolvedValue({ ...data(), items: [] });
    render(<ServiceDraftsPage />);
    await screen.findByText("Nincs ilyen állapotú piszkozat.");
    fireEvent.click(screen.getByRole("tab", { name: "Elvetett" }));
    await waitFor(() =>
      expect(mock.list).toHaveBeenLastCalledWith(
        "token",
        "REJECTED",
        undefined,
        expect.any(AbortSignal),
        undefined,
      ),
    );
  });
});

/*
  A JEV-SZŰRÉS A PISZKOZATOK LAPJÁN (Cápasuli, Balázs 2026-10-05; brief
  4-5. pont). MI PIROSÍT: ha a kiszűrt tétel eltűnik ahelyett, hogy a
  "Kiszűrve" szakaszban álljon; ha a "Mégis piszkozat" nem hívja a
  visszahozást vagy nem tölti újra a listát; ha a bizonytalan jel hiányzik;
  ha a "nem szűrt" jel kikapcsolt szűrésnél is zajt csap.
*/
describe("Service draft review -- Jev filter", () => {
  it("lists filtered items collapsed at the bottom and promotes one", async () => {
    mock.list.mockResolvedValue({
      ...data(),
      filtered: [
        {
          id: "f1",
          title: "Biodóm ajtó beragad",
          originalProblem: "Biodóm ajtó beragad",
          reportDate: "2026-10-02",
          jevClass: "NOT_OURS",
          jevConfidence: 0.91,
        },
      ],
    });
    mock.promote.mockResolvedValue({ id: "f1" });
    render(<ServiceDraftsPage />);
    expect(await screen.findByText("Kiszűrve (1)")).toBeTruthy();
    expect(screen.getByText(/Nem nekünk szól · 91%/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Biodóm ajtó beragad: mégis piszkozat",
      }),
    );
    await waitFor(() =>
      expect(mock.promote).toHaveBeenCalledWith("token", "f1"),
    );
    await waitFor(() => expect(mock.list).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText("A tétel visszakerült a piszkozatok közé."),
    ).toBeTruthy();
  });

  it("marks an uncertain item, and an unfiltered one only while the filter is on", async () => {
    const base = data().items[0]!;
    mock.list.mockResolvedValue({
      ...data(),
      items: [
        {
          ...base,
          id: "u",
          title: "Bizonytalan tétel",
          filterState: "UNCERTAIN",
        },
        {
          ...base,
          id: "n",
          title: "Szűretlen tétel",
          filterState: "UNFILTERED",
        },
      ],
    });
    render(<ServiceDraftsPage />);
    expect(await screen.findByText("Bizonytalan")).toBeTruthy();
    expect(screen.getByText("Nem szűrt")).toBeTruthy();
  });

  it("no 'nem szűrt' noise while the filter is off", async () => {
    const base = data().items[0]!;
    mock.list.mockResolvedValue({
      ...data(),
      filterEnabled: false,
      items: [{ ...base, filterState: "UNFILTERED" }],
    });
    render(<ServiceDraftsPage />);
    await screen.findByText("Venturi szivattyú");
    expect(screen.queryByText("Nem szűrt")).toBeNull();
    expect(screen.queryByText(/Kiszűrve/)).toBeNull();
  });
});

/**
 * A TICKET@ LEVELBOL KESZULT VAZLAT A LISTAN (kartya ec7b947b, S4b): a harom bejovo ag ugyanabban a listaban all, es a kartyan ranezesre
 * kulonbozik (a forras szava, a felado cime, az allapot-jelveny), forras szerint szurheto, es a helyszint az osszes aktiv helyszin kozul lehet valasztani.
 * MI PIROSIT: ha a ticket vazlat Capasuli fejlecet kap; ha a felado cime vagy a jelveny hianyzik; ha az elfogadas a Capasuli partner-felhasznalo
 * hianya miatt tiltott marad (ticket vazlatnal nem kell); ha a helyszin-lista a Capasuli helyszineket kinalja; ha a szuro nem a forrast kuldi.
 */
function ticketData(
  over: Partial<ServiceDraftListResponse["items"][number]> = {},
): ServiceDraftListResponse {
  const base = data().items[0]!;
  return {
    ...data(),
    openedBy: null,
    items: [
      {
        ...base,
        id: "ticket-draft",
        title: "Szűrő csöpög",
        originalProblem: "A 3-as medence szűrője csöpög.",
        source: "TICKET_MAIL",
        intakeState: "UNKNOWN_SENDER",
        proposedDepartmentId: null,
        reporterPersonName: null,
        filterState: "UNFILTERED",
        jevClass: null,
        jevConfidence: null,
        occurrence: 1,
        earlier: [],
        mail: {
          originalText: "A 3-as medence szűrője csöpög.",
          subject: "Szűrő hiba",
          mailbox: "ticket@acropora.hu",
          fromAddress: "kulso@masik.hu",
          droppedAttachments: 2,
        },
        ...over,
      },
    ],
  };
}
describe("Service draft review -- ticket mailbox drafts", () => {
  it("shows the source, the sender address, the kind badge and the dropped attachments, not the Cápasuli header", async () => {
    mock.list.mockResolvedValue(ticketData());
    render(<ServiceDraftsPage />);
    await screen.findByText("Szűrő csöpög");
    expect(
      screen.getByText(/Ticket levél · 2026-10-03 · Szűrő hiba/),
    ).toBeTruthy();
    expect(screen.queryByText(/Cápasuli · 2026-10-03/)).toBeNull();
    expect(screen.getByText("Feladó: kulso@masik.hu")).toBeTruthy();
    expect(screen.getByText("Ismeretlen feladó")).toBeTruthy();
    expect(screen.getByText(/2 csatolmány kimaradt/)).toBeTruthy();
    expect(screen.getByText("Teljes levél megnyitása")).toBeTruthy();
  });

  it("offers ALL active places with the customer's name, and accepts without a Cápasuli opener", async () => {
    mock.list.mockResolvedValue(ticketData());
    mock.places.mockResolvedValue({
      items: [
        {
          id: "p1",
          name: "Akvárium 1",
          customerId: "c1",
          customerName: "Állatkert Kft",
        },
        {
          id: "p2",
          name: "Recepció",
          customerId: "c2",
          customerName: "Hotel Zrt",
        },
      ],
    });
    render(<ServiceDraftsPage />);
    const select = (await screen.findByLabelText(
      "Helyszín",
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(3));
    expect(select.options[1]!.textContent).toBe("Állatkert Kft · Akvárium 1");
    expect(screen.queryByText("Cápasuli")).toBeNull();
    const accept = screen.getByRole("button", {
      name: "Elfogadom: Szűrő csöpög",
    });
    expect((accept as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(select, { target: { value: "p2" } });
    expect((accept as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(accept);
    await waitFor(() =>
      expect(mock.accept).toHaveBeenCalledWith(
        "token",
        "ticket-draft",
        "p2",
        "",
      ),
    );
  });

  it("preselects the place the draft proposes (the sender's one assigned place)", async () => {
    mock.list.mockResolvedValue(
      ticketData({
        proposedDepartmentId: "p1",
        reporterPersonName: "Kovács Anna",
        intakeState: "AI_UNAVAILABLE",
      }),
    );
    mock.places.mockResolvedValue({
      items: [
        {
          id: "p1",
          name: "Akvárium 1",
          customerId: "c1",
          customerName: "Állatkert Kft",
        },
      ],
    });
    render(<ServiceDraftsPage />);
    const select = (await screen.findByLabelText(
      "Helyszín",
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("p1"));
    expect(screen.getByText("AI nélkül")).toBeTruthy();
    expect(
      (screen.getByLabelText("Jelentő szerzője") as HTMLInputElement).value,
    ).toBe("Kovács Anna");
  });

  it("shows the AI summary as TEXT, marked as a help, with the original mail text beside it (barracuda, ai#106)", async () => {
    mock.list.mockResolvedValue(
      ticketData({
        intakeState: "AI_DRAFT",
        aiSummary: "A szűrő csöpög <b>sürgős</b> https://tamado.example",
      }),
    );
    render(<ServiceDraftsPage />);
    await screen.findByText("Szűrő csöpög");
    expect(screen.getByText("AI vázlat")).toBeTruthy();
    expect(screen.getByText(/AI összefoglaló \(csak segítség/)).toBeTruthy();
    // the summary is a text node: the tags and the link are shown as characters, not rendered
    const summary = screen.getByText(
      /A szűrő csöpög <b>sürgős<\/b> https:\/\/tamado\.example/,
    );
    expect(summary.querySelector("b")).toBeNull();
    expect(summary.querySelector("a")).toBeNull();
    // and the original text of the mail is on the same card
    expect(screen.getByText("A levél szövege")).toBeTruthy();
    expect(
      screen.getAllByText("A 3-as medence szűrője csöpög.").length,
    ).toBeGreaterThan(0);
  });

  it("no AI summary block when the AI did not run", async () => {
    mock.list.mockResolvedValue(ticketData());
    render(<ServiceDraftsPage />);
    await screen.findByText("Szűrő csöpög");
    expect(screen.queryByText(/AI összefoglaló/)).toBeNull();
  });

  it("the source filter sends the source to the list", async () => {
    mock.list.mockResolvedValue(ticketData());
    render(<ServiceDraftsPage />);
    await screen.findByText("Szűrő csöpög");
    expect(mock.list.mock.calls[0]![4]).toBeUndefined();
    fireEvent.click(screen.getByRole("tab", { name: "Ticket levelek" }));
    await waitFor(() =>
      expect(mock.list.mock.calls.at(-1)![4]).toBe("TICKET_MAIL"),
    );
    fireEvent.click(screen.getByRole("tab", { name: "Cápasuli jelentők" }));
    await waitFor(() =>
      expect(mock.list.mock.calls.at(-1)![4]).toBe("CAPASULI_DAILY_REPORT"),
    );
  });

  it("CONTROL: the Cápasuli setup notice is not shown when the list holds only ticket drafts", async () => {
    mock.list.mockResolvedValue(ticketData());
    render(<ServiceDraftsPage />);
    await screen.findByText("Szűrő csöpög");
    expect(
      screen.queryByText(/Az elfogadáshoz állítsd be a Cápasuli/),
    ).toBeNull();
  });

  it("CONTROL: a Cápasuli draft keeps its own header, places and the notice without an opener", async () => {
    const response = data();
    response.openedBy = null;
    mock.list.mockResolvedValue(response);
    render(<ServiceDraftsPage />);
    await screen.findByText("Venturi szivattyú");
    expect(screen.getByText(/Cápasuli · 2026-10-03/)).toBeTruthy();
    expect(
      screen.getByText(/Az elfogadáshoz állítsd be a Cápasuli/),
    ).toBeTruthy();
    expect(mock.places).not.toHaveBeenCalled();
  });

  it("shows the ticket mailbox intake status for the admins", async () => {
    mock.ticketMailStatus.mockResolvedValue({
      ...(await mock.ticketMailStatus()),
      enabled: true,
      configured: true,
      lastRunAt: "2026-11-16T22:00:00.000Z",
      lastError: "TICKET_MAIL_MESSAGE_FAILED",
    });
    render(<ServiceDraftsPage />);
    await screen.findByText(/Ticket postafiók feldolgozás: bekapcsolva/);
    expect(screen.getByText("TICKET_MAIL_MESSAGE_FAILED")).toBeTruthy();
  });
});
describe("draftIntakeBadge and draftSourceLabel", () => {
  it("each kind has its own badge; a rule-based draft has none", () => {
    expect(draftIntakeBadge({ intakeState: "AI_DRAFT" })).toEqual({
      label: "AI vázlat",
      variant: "teal",
    });
    expect(draftIntakeBadge({ intakeState: "AI_UNAVAILABLE" })?.label).toBe(
      "AI nélkül",
    );
    expect(draftIntakeBadge({ intakeState: "WATCH_OFF" })?.label).toBe(
      "Figyelés kikapcsolva",
    );
    expect(draftIntakeBadge({ intakeState: "UNKNOWN_SENDER" })?.label).toBe(
      "Ismeretlen feladó",
    );
    expect(draftIntakeBadge({ intakeState: "RULE_DRAFT" })).toBeNull();
  });
  it("names the source", () => {
    expect(draftSourceLabel("TICKET_MAIL")).toBe("Ticket levél");
    expect(draftSourceLabel("CAPASULI_DAILY_REPORT")).toBe("Cápasuli");
  });
});

/*
  PISZKOZATOK (Picasso 3.17, acrobot 61999). MI PIROSÍT: ha az Elfogadom halvány, de egy mondat sem mondja meg, miért; ha az idézett válasz-levél
  újra az egész kártyán látszik; ha a szűrő-pirulák aktív állapota újra sárga; ha az idézés-felismerés elnyeli az új szöveget.
*/
describe("splitQuotedReply", () => {
  const reply =
    "Köszönöm, megnézzük.\nÜdv: Béla\n\n2026. nov. 25., Sze, 10:12 időpontban Szerelő Sándor <s@acropora.hu> ezt írta:\n> A szűrő csöpög.\n> Kérlek nézzétek meg.";

  it("splits the new text from the quoted chain at the 'ezt írta' header", () => {
    const { own, quoted } = splitQuotedReply(reply);
    expect(own).toBe("Köszönöm, megnézzük.\nÜdv: Béla");
    expect(quoted?.startsWith("2026. nov. 25., Sze")).toBe(true);
    expect(quoted).toContain("> A szűrő csöpög.");
  });

  it("knows the English header and the Eredeti üzenet separator", () => {
    expect(
      splitQuotedReply("Thanks.\nOn Tue, Bob <b@x.hu> wrote:\n> old").quoted,
    ).toContain("wrote:");
    expect(
      splitQuotedReply("Köszi.\n-----Eredeti üzenet-----\nrégi").quoted,
    ).toContain("régi");
  });

  it("leaves a mail without a quote alone, and never hides a mail that is ALL quote", () => {
    expect(splitQuotedReply("Csak új szöveg.")).toEqual({
      own: "Csak új szöveg.",
      quoted: null,
    });
    const allQuote = "2026. nov. 25. Béla ezt írta:\n> minden idézet";
    expect(splitQuotedReply(allQuote)).toEqual({
      own: allQuote,
      quoted: null,
    });
    // blank lines before the header are not "new text" either: nothing would stay on the card
    const blankThenQuote = "\n\n2026. nov. 25. Béla ezt írta:\n> minden idézet";
    expect(splitQuotedReply(blankThenQuote)).toEqual({
      own: blankThenQuote,
      quoted: null,
    });
  });
});

describe("Service draft review -- Picasso 3.17", () => {
  it("says why the Elfogadom is pale until a place is chosen, and the sentence goes away with the choice", async () => {
    mock.list.mockResolvedValue(ticketData());
    mock.places.mockResolvedValue({
      items: [
        {
          id: "p1",
          name: "Akvárium 1",
          customerId: "c1",
          customerName: "Állatkert Kft",
        },
      ],
    });
    render(<ServiceDraftsPage />);
    const select = (await screen.findByLabelText(
      "Helyszín",
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(2));
    const accept = screen.getByRole("button", {
      name: "Elfogadom: Szűrő csöpög",
    });
    const hint = screen.getByText("Előbb válassz helyszínt.");
    expect(hint.className).toBe("text-xs text-pilot-grey-400");
    expect(accept.getAttribute("aria-describedby")).toBe(hint.id);
    expect((accept as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(select, { target: { value: "p1" } });
    expect(screen.queryByText("Előbb válassz helyszínt.")).toBeNull();
    expect(accept.getAttribute("aria-describedby")).toBeNull();
  });

  it("collapses the quoted reply under 'Idézett levél megnyitása', the new text stays on the card", async () => {
    mock.list.mockResolvedValue(
      ticketData({
        originalProblem:
          "A szivattyú továbbra is zúg.\n\n2026. nov. 25., Sze, 10:12 időpontban Szerelő Sándor <s@acropora.hu> ezt írta:\n> Kérlek nézzétek meg a szivattyút.",
      }),
    );
    render(<ServiceDraftsPage />);
    const own = await screen.findByText("A szivattyú továbbra is zúg.");
    expect(own.closest("details")).toBeNull();
    const summary = screen.getByText("Idézett levél megnyitása");
    const details = summary.closest("details")!;
    expect(details.hasAttribute("open")).toBe(false);
    expect(details.textContent).toContain("ezt írta:");
    expect(details.textContent).toContain("Kérlek nézzétek meg a szivattyút.");
  });

  it("the active filter pill is the system's green, not yellow", async () => {
    mock.list.mockResolvedValue(data());
    render(<ServiceDraftsPage />);
    await screen.findByText("Venturi szivattyú");
    const active = screen
      .getAllByRole("tab")
      .filter((tab) => tab.getAttribute("aria-selected") === "true");
    expect(active.length).toBeGreaterThan(0);
    for (const tab of active) {
      expect(tab.className).toContain("bg-pilot-aqua-50");
      expect(tab.className).not.toContain("amber");
    }
  });
});
