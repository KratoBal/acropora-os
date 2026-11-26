import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  ServiceJobLinkableWorksheetsResponse,
  ServiceJobLinkedWorksheetsResponse,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  LINKED_WORKSHEETS_NOTICE,
  PilotLinkedWorksheetsCard,
} from "./pilot-linked-worksheets-card";

vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

const api = vi.hoisted(() => ({
  linkedWorksheets: vi.fn(),
  linkableWorksheets: vi.fn(),
  linkWorksheet: vi.fn(),
  unlinkWorksheet: vi.fn(),
}));
vi.mock("@/lib/api/service-jobs", () => ({ serviceJobsApi: api }));

/*
  WHAT TURNS THIS RED (card 5b366f5d): the card dropping the "reference, not a move; no hours or price" sentence or showing any
  hours or price on a linked row (a field there invites the reading that it counts into the sheet); the link, unlink and picker
  controls showing for a viewer without the manage right; the picker not offering the same-location group first or not saying
  that more matched than shown; a click not calling the endpoint with the sheet and worksheet ids; a server refusal not reaching
  the screen; the unlink going through without the confirmation; the log showing for a viewer who has none.
*/
const linked = (
  over: Partial<ServiceJobLinkedWorksheetsResponse> = {},
): ServiceJobLinkedWorksheetsResponse => ({
  items: [
    {
      worksheetId: "ws-1",
      number: "KAR-2026-022",
      subject: "Lámpák átszerelése",
      createdAt: "2026-11-10T10:00:00Z",
      handedOverAt: null,
      status: "SIGNED",
      departmentPath: ["Állatkert", "Középső medence"],
      homeJobNumber: null,
      linkedAt: "2026-11-11T10:00:00Z",
      linkedByName: "Belső Ember",
    },
  ],
  history: [
    {
      id: "ev-1",
      kind: "LINKED",
      worksheetId: "ws-1",
      note: "KAR-2026-022: Lámpák átszerelése",
      actorName: "Belső Ember",
      createdAt: "2026-11-11T10:00:00Z",
    },
  ],
  ...over,
});

const offer = (
  over: Partial<ServiceJobLinkableWorksheetsResponse> = {},
): ServiceJobLinkableWorksheetsResponse => ({
  items: [
    {
      worksheetId: "ws-near",
      number: "KAR-2026-030",
      subject: "Szivattyú csere",
      createdAt: "2026-11-12T10:00:00Z",
      status: "DRAFT",
      departmentPath: ["Állatkert", "Középső medence"],
      homeJobNumber: null,
      inSameLocation: true,
    },
    {
      worksheetId: "ws-far",
      number: "BAL-2026-004",
      subject: "Szűrő tisztítás",
      createdAt: "2026-11-02T10:00:00Z",
      status: "SIGNED",
      departmentPath: ["Állatkert", "Bejárat"],
      homeJobNumber: "SRV-2026-00482",
      inSameLocation: false,
    },
  ],
  truncated: false,
  ...over,
});

function draw(canManage: boolean) {
  return render(
    <PilotLinkedWorksheetsCard token="t" jobId="job-1" canManage={canManage} />,
  );
}

describe("a Kapcsolódó munkalapok kártya", () => {
  beforeEach(() => {
    api.linkedWorksheets.mockReset().mockResolvedValue(linked());
    api.linkableWorksheets.mockReset().mockResolvedValue(offer());
    api.linkWorksheet.mockReset().mockResolvedValue({ ok: true });
    api.unlinkWorksheet.mockReset().mockResolvedValue({ ok: true });
  });

  // Picasso 3.3: inside the Munkalapok card the same content stands as its lower section, not a second card
  it("beágyazva a Munkalapok kártya szakasza: saját alcím és ugyanaz a tartalom, kártya-keret nélkül", async () => {
    const { container } = render(
      <PilotLinkedWorksheetsCard token="t" jobId="job-1" canManage embedded />,
    );
    const section = await screen.findByRole("region", {
      name: "Kapcsolódó munkalapok",
    });
    expect(section.tagName).toBe("SECTION");
    expect(
      within(section).getByRole("heading", { name: "Kapcsolódó munkalapok" })
        .tagName,
    ).toBe("H3");
    expect(await within(section).findByTestId("linked-worksheet")).toBeTruthy();
    expect(
      within(section).getByRole("button", { name: "Munkalap hozzákapcsolása" }),
    ).toBeTruthy();
    // the section is the outermost element: no card frame of its own
    expect(container.firstElementChild).toBe(section);
  });

  it("kimondja, hogy hivatkozás, és hogy a munkaóra és az ár nem számít bele", async () => {
    draw(false);
    const notice = await screen.findByTestId("linked-worksheets-notice");
    expect(notice).toHaveTextContent(LINKED_WORKSHEETS_NOTICE);
    expect(notice).toHaveTextContent("a helyén marad");
    expect(notice).toHaveTextContent("munkaórája és az ára");
  });

  it("a kapcsolt munkalap tárgya, száma, helyszíne és állapota látszik, munkaóra és ár NEM", async () => {
    draw(false);
    const row = await screen.findByTestId("linked-worksheet");
    expect(row).toHaveTextContent("Lámpák átszerelése");
    expect(row).toHaveTextContent("KAR-2026-022");
    expect(row).toHaveTextContent("Állatkert / Középső medence");
    expect(row).toHaveTextContent("Lezárt");
    expect(row.textContent).not.toMatch(/munkaóra|Ft|ár\b/i);
  });

  // az elutasított lap kártyáján az OK ott van (barracuda, #2984): a hibajegyen ebből látszik, hogy az ügyfél nem írta alá, és cselekedni kell
  it("az elutasított és az aláírásra váró lap állapota az okkal áll a kártyán", async () => {
    const base = linked().items[0]!;
    api.linkedWorksheets.mockResolvedValue(
      linked({
        items: [
          { ...base, worksheetId: "ws-r", status: "REJECTED" },
          { ...base, worksheetId: "ws-a", status: "AWAITING_SIGNATURE" },
        ],
      }),
    );
    draw(false);
    const rows = await screen.findAllByTestId("linked-worksheet");
    expect(rows[0]).toHaveTextContent("Folyamatban · elutasítva");
    expect(rows[1]).toHaveTextContent("Elkészült · aláírásra vár");
  });

  it("üres listánál kimondja, hogy még nincs kapcsolódó munkalap", async () => {
    api.linkedWorksheets.mockResolvedValue(linked({ items: [], history: [] }));
    draw(true);
    expect(
      await screen.findByText("Még nincs kapcsolódó munkalap."),
    ).toBeInTheDocument();
  });

  it("kezelő jog nélkül nincs hozzákapcsolás, levétel és választó", async () => {
    draw(false);
    await screen.findByTestId("linked-worksheet");
    expect(
      screen.queryByRole("button", { name: "Munkalap hozzákapcsolása" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Levétel" })).toBeNull();
    expect(api.linkableWorksheets).not.toHaveBeenCalled();
  });

  it("a választó a helyszínen lévőket külön csoportban, előbb mutatja, és nem kínál semmit a kapcsolt mellé hamisan", async () => {
    const user = userEvent.setup();
    draw(true);
    await screen.findByTestId("linked-worksheet");
    await user.click(
      screen.getByRole("button", { name: "Munkalap hozzákapcsolása" }),
    );
    const rows = await screen.findAllByTestId("linkable-worksheet");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Szivattyú csere"),
      expect.stringContaining("Szűrő tisztítás"),
    ]);
    const picker = screen.getByTestId("linkable-picker");
    const headings = within(picker)
      .getAllByText(/Ugyanezen a helyszínen|A partner többi munkalapja/)
      .map((node) => node.textContent);
    expect(headings).toEqual([
      "Ugyanezen a helyszínen (és alatta)",
      "A partner többi munkalapja",
    ]);
    // where a worksheet already lives is visible before choosing it
    expect(rows[1]).toHaveTextContent("a(z) SRV-2026-00482 alatt áll");
  });

  it("a kattintás a lap és a munkalap azonosítójával hívja a végpontot, utána újratölt", async () => {
    const user = userEvent.setup();
    draw(true);
    await screen.findByTestId("linked-worksheet");
    await user.click(
      screen.getByRole("button", { name: "Munkalap hozzákapcsolása" }),
    );
    const rows = await screen.findAllByTestId("linkable-worksheet");
    await user.click(
      within(rows[0]!).getByRole("button", { name: "Hozzákapcsolás" }),
    );
    await waitFor(() =>
      expect(api.linkWorksheet).toHaveBeenCalledWith("t", "job-1", "ws-near"),
    );
    await waitFor(() =>
      expect(api.linkedWorksheets.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
  });

  it("a szerver elutasítása megjelenik a képernyőn", async () => {
    api.linkWorksheet.mockRejectedValue(
      new Error(
        "Ez a munkalap már egy másik karbantartási laphoz van kapcsolva.",
      ),
    );
    const user = userEvent.setup();
    draw(true);
    await screen.findByTestId("linked-worksheet");
    await user.click(
      screen.getByRole("button", { name: "Munkalap hozzákapcsolása" }),
    );
    const rows = await screen.findAllByTestId("linkable-worksheet");
    await user.click(
      within(rows[0]!).getByRole("button", { name: "Hozzákapcsolás" }),
    );
    expect(
      await screen.findByText(
        "Ez a munkalap már egy másik karbantartási laphoz van kapcsolva.",
      ),
    ).toBeInTheDocument();
  });

  it("a találati korlátot kimondja, nem hallgatja el", async () => {
    api.linkableWorksheets.mockResolvedValue(offer({ truncated: true }));
    const user = userEvent.setup();
    draw(true);
    await screen.findByTestId("linked-worksheet");
    await user.click(
      screen.getByRole("button", { name: "Munkalap hozzákapcsolása" }),
    );
    expect(
      await screen.findByText(/Több találat van, mint amennyit a lista mutat/),
    ).toBeInTheDocument();
  });

  it("a keresőszöveg és a napok a szerverre mennek, nem a betöltött listán szűr", async () => {
    const user = userEvent.setup();
    draw(true);
    await screen.findByTestId("linked-worksheet");
    await user.click(
      screen.getByRole("button", { name: "Munkalap hozzákapcsolása" }),
    );
    await screen.findAllByTestId("linkable-worksheet");
    await user.type(
      screen.getByLabelText("Keresés szám vagy tárgy szerint"),
      "lámpa",
    );
    await waitFor(() =>
      expect(api.linkableWorksheets).toHaveBeenLastCalledWith(
        "t",
        "job-1",
        { q: "lámpa", createdFrom: "", createdTo: "" },
        expect.anything(),
      ),
    );
  });

  it("a levétel megerősítés nélkül nem megy, megerősítéssel igen", async () => {
    const user = userEvent.setup();
    draw(true);
    await screen.findByTestId("linked-worksheet");
    await user.click(screen.getByRole("button", { name: "Levétel" }));
    expect(api.unlinkWorksheet).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("A munkalap maga nem változik");
    await user.click(within(dialog).getByRole("button", { name: "Levétel" }));
    await waitFor(() =>
      expect(api.unlinkWorksheet).toHaveBeenCalledWith("t", "job-1", "ws-1"),
    );
  });

  it("a napló megnyitható, és a partnernek (üres napló) nincs is gombja", async () => {
    const user = userEvent.setup();
    const { unmount } = draw(true);
    await screen.findByTestId("linked-worksheet");
    await user.click(screen.getByRole("button", { name: "Napló (1)" }));
    expect(
      screen.getByText(/hozzákapcsolva: KAR-2026-022: Lámpák átszerelése/),
    ).toBeInTheDocument();
    unmount();

    api.linkedWorksheets.mockResolvedValue(linked({ history: [] }));
    draw(false);
    await screen.findByTestId("linked-worksheet");
    expect(screen.queryByRole("button", { name: /Napló/ })).toBeNull();
  });

  it("ha a lista nem töltődik be, a hiba látszik, nem üres lista", async () => {
    api.linkedWorksheets.mockRejectedValue(
      new Error("A hibajegy nem található."),
    );
    draw(false);
    expect(
      await screen.findByText("A hibajegy nem található."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Még nincs kapcsolódó munkalap.")).toBeNull();
  });
});
