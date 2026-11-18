import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  type Session,
  type WebshopOrderShortageView,
  USER_ROLES,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import {
  SHORTAGE_CHANNEL_LABELS,
  SHORTAGE_CHOICE_LABELS,
  SHORTAGE_STATUS_LABELS,
  ShortagesCard,
} from "./webshop-order-shortages";

/*
  A KÉSZLETHIÁNY KÁRTYÁJA A WEBSHOP-RENDELÉS LAPJÁN (task t-20261118-keszlethiany-kepernyo; card ac167fc2). WHAT TURNS IT RED: a case's status,
  items (ordered, available, agreed quantity), choice, channel, note or linked order missing from the list; the empty, loading and error states
  wrong; buttons for a user who cannot manage orders; an item that already sits in an active case offered again; a submit enabled while the
  client-side rule (note, quantity range, a reduced line, the replacement variant, the linked split order, the withdrawal reason) is broken;
  the wrong payload sent; a server refusal swallowed.
*/
const api = vi.hoisted(() => ({
  shortages: vi.fn(),
  openShortage: vi.fn(),
  agreeShortage: vi.fn(),
  resolveShortage: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session, isLoading: false }),
}));
vi.mock("@/lib/api/webshop-orders", () => ({ webshopOrdersApi: api }));
vi.mock("next/font/local", () => ({
  default: () => ({ className: "font-pilot" }),
}));

const session: Session = {
  id: "s",
  token: "tok",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "u1",
    email: "a@acropora.local",
    displayName: "A",
    role: USER_ROLES[0] as Session["user"]["role"],
    customerId: null,
    supplierId: null,
  },
};

const order = {
  id: "order_1",
  lines: [
    {
      id: "i1",
      title: "Aqualight G3-S",
      variantTitle: null,
      sku: "AL-G3S",
      quantity: 5,
      unitPrice: 1000,
      total: 5000,
    },
    {
      id: "i2",
      title: "Modern Reef Kh+ 1000 ml",
      variantTitle: null,
      sku: "MR-KH",
      quantity: 2,
      unitPrice: 2000,
      total: 4000,
    },
    {
      id: "i3",
      title: "Cirkulációs szivattyú",
      variantTitle: null,
      sku: null,
      quantity: 1,
      unitPrice: 3000,
      total: 3000,
    },
  ],
};

const searchVariants = vi.fn();

const shortage = (
  over: Partial<WebshopOrderShortageView> = {},
): WebshopOrderShortageView => ({
  id: "s1",
  orderId: "order_1",
  status: "OPEN",
  choice: null,
  channel: null,
  agreedAt: null,
  agreementNote: null,
  splitOrderId: null,
  resolutionNote: null,
  detectedAt: "2026-11-18T08:00:00.000Z",
  detectedByUserId: "u1",
  resolvedAt: null,
  resolvedByUserId: null,
  lines: [
    {
      id: "l1",
      itemId: "i1",
      sku: "AL-G3S",
      title: "Aqualight G3-S",
      orderedQuantity: 5,
      availableQuantity: 3,
      agreedQuantity: null,
      replacementVariantId: null,
      replacementSku: null,
    },
  ],
  ...over,
});

const agreed = (over: Partial<WebshopOrderShortageView> = {}) =>
  shortage({
    status: "AGREED",
    choice: "SPLIT",
    channel: "PHONE",
    agreedAt: "2026-11-18T08:30:00.000Z",
    agreementNote: "A vevő a hiányzó 2 darabot később kéri.",
    lines: [
      {
        ...shortage().lines[0]!,
        agreedQuantity: 3,
      },
    ],
    ...over,
  });

function renderCard(canManage = true) {
  return render(
    <ShortagesCard
      order={order as never}
      canManage={canManage}
      onSearchVariants={searchVariants}
    />,
  );
}

describe("ShortagesCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.session = session;
    api.shortages.mockResolvedValue([]);
  });

  it("shows the empty state, and loads with the token and the order id", async () => {
    renderCard();
    expect(
      await screen.findByText(
        "Nincs rögzített készlethiány ezen a rendelésen.",
      ),
    ).toBeTruthy();
    expect(api.shortages).toHaveBeenCalledWith(
      "tok",
      "order_1",
      expect.anything(),
    );
  });

  it("shows a loading state first and an error state when the list does not load", async () => {
    api.shortages.mockRejectedValue(new ApiError("Hiba", 500));
    renderCard();
    expect(screen.getByLabelText("Készlethiányok betöltése")).toBeTruthy();
    expect(
      await screen.findByText("A készlethiányok listája nem tölthető be."),
    ).toBeTruthy();
  });

  it("lists a case with its status, the quantities, the choice, the channel, the note and the linked order", async () => {
    api.shortages.mockResolvedValue([
      agreed(),
      agreed({
        id: "s2",
        status: "DONE",
        splitOrderId: "order_2",
        resolvedAt: "2026-11-18T09:00:00.000Z",
      }),
    ]);
    renderCard();
    expect(
      (await screen.findAllByText(SHORTAGE_STATUS_LABELS.AGREED)).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("Aqualight G3-S").length).toBe(2);
    expect(screen.getAllByText(/rendelve 5/).length).toBe(2);
    expect(screen.getAllByText(/van 3/).length).toBe(2);
    expect(screen.getAllByText(/jóváhagyott 3/).length).toBe(2);
    expect(screen.getAllByText(SHORTAGE_CHOICE_LABELS.SPLIT).length).toBe(2);
    expect(screen.getAllByText(SHORTAGE_CHANNEL_LABELS.PHONE).length).toBe(2);
    expect(
      screen.getAllByText("A vevő a hiányzó 2 darabot később kéri.").length,
    ).toBe(2);
    expect(screen.getByText(SHORTAGE_STATUS_LABELS.DONE)).toBeTruthy();
    const link = screen.getByRole("link", { name: /kapcsolt rendelés/i });
    expect(link.getAttribute("href")).toBe("/webshop/rendelesek/order_2");
  });

  it("a user who cannot manage orders sees the list and no button", async () => {
    api.shortages.mockResolvedValue([shortage()]);
    renderCard(false);
    await screen.findByText("Aqualight G3-S");
    expect(
      screen.queryByRole("button", { name: "Hiány felvétele" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Megállapodás rögzítése" }),
    ).toBeNull();
  });

  it("offers the actions each status allows: OPEN agree and withdraw, AGREED re-record, close and withdraw, DONE none", async () => {
    api.shortages.mockResolvedValue([
      shortage({ id: "a" }),
      agreed({ id: "b" }),
      agreed({ id: "c", status: "DONE", splitOrderId: "order_2" }),
      shortage({ id: "d", status: "WITHDRAWN", resolutionNote: "Megjött." }),
    ]);
    renderCard();
    await screen.findAllByText("Aqualight G3-S");
    const caseOf = (id: string) => screen.getByTestId(`shortage-${id}`);
    const buttons = (id: string) =>
      within(caseOf(id))
        .queryAllByRole("button")
        .map((b) => b.textContent);
    expect(buttons("a")).toEqual(["Megállapodás rögzítése", "Visszavonás"]);
    expect(buttons("b")).toEqual([
      "Megállapodás módosítása",
      "Lezárás",
      "Visszavonás",
    ]);
    expect(buttons("c")).toEqual([]);
    expect(buttons("d")).toEqual([]);
    expect(within(caseOf("d")).getByText("Megjött.")).toBeTruthy();
  });

  describe("opening a shortage", () => {
    it("picks items of the order, keeps the available quantity below the ordered one, and sends the payload", async () => {
      api.openShortage.mockResolvedValue(shortage());
      renderCard();
      await screen.findByText(
        "Nincs rögzített készlethiány ezen a rendelésen.",
      );
      fireEvent.click(screen.getByRole("button", { name: "Hiány felvétele" }));
      const dialog = await screen.findByRole("dialog", {
        name: "Hiány felvétele",
      });
      const submit = within(dialog).getByRole("button", { name: "Felvétel" });
      expect((submit as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(within(dialog).getByLabelText("Aqualight G3-S"));
      const available = within(dialog).getByLabelText(
        "Aqualight G3-S: meglévő mennyiség",
      );
      fireEvent.change(available, { target: { value: "5" } });
      expect((submit as HTMLButtonElement).disabled).toBe(true);
      expect(
        within(dialog).getByText(/kisebb legyen a rendeltnél/),
      ).toBeTruthy();
      fireEvent.change(available, { target: { value: "3" } });
      expect((submit as HTMLButtonElement).disabled).toBe(false);
      api.shortages.mockResolvedValue([shortage()]);
      fireEvent.click(submit);
      await waitFor(() =>
        expect(api.openShortage).toHaveBeenCalledWith("tok", "order_1", {
          lines: [{ itemId: "i1", availableQuantity: 3 }],
        }),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "Hiány felvétele" }),
        ).toBeNull(),
      );
      expect(await screen.findByText(/rendelve 5/)).toBeTruthy();
    });

    it("sends an item without an available quantity when the field is left empty", async () => {
      api.openShortage.mockResolvedValue(shortage());
      renderCard();
      await screen.findByText(
        "Nincs rögzített készlethiány ezen a rendelésen.",
      );
      fireEvent.click(screen.getByRole("button", { name: "Hiány felvétele" }));
      const dialog = await screen.findByRole("dialog", {
        name: "Hiány felvétele",
      });
      fireEvent.click(within(dialog).getByLabelText("Cirkulációs szivattyú"));
      fireEvent.click(within(dialog).getByRole("button", { name: "Felvétel" }));
      await waitFor(() =>
        expect(api.openShortage).toHaveBeenCalledWith("tok", "order_1", {
          lines: [{ itemId: "i3" }],
        }),
      );
    });

    it("an item that already sits in an active case cannot be picked again, a closed case frees it", async () => {
      api.shortages.mockResolvedValue([
        shortage(),
        shortage({ id: "x", status: "WITHDRAWN" }),
      ]);
      renderCard();
      await screen.findAllByText("Aqualight G3-S");
      fireEvent.click(screen.getByRole("button", { name: "Hiány felvétele" }));
      const dialog = await screen.findByRole("dialog", {
        name: "Hiány felvétele",
      });
      expect(
        (within(dialog).getByLabelText("Aqualight G3-S") as HTMLInputElement)
          .disabled,
      ).toBe(true);
      expect(
        (
          within(dialog).getByLabelText(
            "Cirkulációs szivattyú",
          ) as HTMLInputElement
        ).disabled,
      ).toBe(false);
    });

    it("shows the server's refusal and keeps the dialog open", async () => {
      api.openShortage.mockRejectedValue(
        new ApiError(
          "A tételhez már tartozik nyitott vagy megállapodott hiány.",
          409,
        ),
      );
      renderCard();
      await screen.findByText(
        "Nincs rögzített készlethiány ezen a rendelésen.",
      );
      fireEvent.click(screen.getByRole("button", { name: "Hiány felvétele" }));
      const dialog = await screen.findByRole("dialog", {
        name: "Hiány felvétele",
      });
      fireEvent.click(within(dialog).getByLabelText("Cirkulációs szivattyú"));
      fireEvent.click(within(dialog).getByRole("button", { name: "Felvétel" }));
      expect(
        await within(dialog).findByText(
          "A tételhez már tartozik nyitott vagy megállapodott hiány.",
        ),
      ).toBeTruthy();
    });
  });

  describe("recording the agreement", () => {
    async function openAgreement() {
      api.shortages.mockResolvedValue([shortage()]);
      renderCard();
      await screen.findByText("Aqualight G3-S");
      fireEvent.click(
        screen.getByRole("button", { name: "Megállapodás rögzítése" }),
      );
      return screen.findByRole("dialog", { name: "Megállapodás rögzítése" });
    }

    it("needs the note, a reduced line, and sends the choice, channel, note and the agreed quantities (SPLIT)", async () => {
      api.agreeShortage.mockResolvedValue(agreed());
      const dialog = await openAgreement();
      const submit = within(dialog).getByRole("button", { name: "Rögzítés" });
      expect((submit as HTMLButtonElement).disabled).toBe(true); // no note yet
      fireEvent.change(within(dialog).getByLabelText("Mit mondtak"), {
        target: { value: "  Telefon, a vevő később kéri.  " },
      });
      // default agreed = the available quantity (3 < 5 ordered): a reduced line already
      expect((submit as HTMLButtonElement).disabled).toBe(false);
      fireEvent.change(
        within(dialog).getByLabelText("Aqualight G3-S: jóváhagyott mennyiség"),
        { target: { value: "5" } },
      );
      expect((submit as HTMLButtonElement).disabled).toBe(true);
      expect(within(dialog).getByText(/legalább egy tétel/i)).toBeTruthy();
      fireEvent.change(
        within(dialog).getByLabelText("Aqualight G3-S: jóváhagyott mennyiség"),
        { target: { value: "3" } },
      );
      api.shortages.mockResolvedValue([agreed()]);
      fireEvent.click(submit);
      await waitFor(() =>
        expect(api.agreeShortage).toHaveBeenCalledWith("tok", "order_1", "s1", {
          choice: "SPLIT",
          channel: "PHONE",
          note: "Telefon, a vevő később kéri.",
          lines: [{ itemId: "i1", agreedQuantity: 3 }],
        }),
      );
    });

    it("refuses an agreed quantity above the ordered one or not a whole number", async () => {
      const dialog = await openAgreement();
      fireEvent.change(within(dialog).getByLabelText("Mit mondtak"), {
        target: { value: "n" },
      });
      const submit = within(dialog).getByRole("button", { name: "Rögzítés" });
      const input = within(dialog).getByLabelText(
        "Aqualight G3-S: jóváhagyott mennyiség",
      );
      for (const bad of ["6", "-1", "2.5", ""]) {
        fireEvent.change(input, { target: { value: bad } });
        expect((submit as HTMLButtonElement).disabled).toBe(true);
      }
      fireEvent.change(input, { target: { value: "0" } });
      expect((submit as HTMLButtonElement).disabled).toBe(false);
    });

    it("REPLACE needs the replacement variant picked from the search on every reduced line, and sends its id and sku", async () => {
      searchVariants.mockResolvedValue([
        { variantId: "var_9", title: "Aqualight G3-L", sku: "AL-G3L" },
      ]);
      api.agreeShortage.mockResolvedValue(agreed({ choice: "REPLACE" }));
      const dialog = await openAgreement();
      fireEvent.click(
        within(dialog).getByLabelText(SHORTAGE_CHOICE_LABELS.REPLACE),
      );
      fireEvent.change(within(dialog).getByLabelText("Mit mondtak"), {
        target: { value: "Cserét kért." },
      });
      const submit = within(dialog).getByRole("button", { name: "Rögzítés" });
      expect((submit as HTMLButtonElement).disabled).toBe(true);
      fireEvent.change(
        within(dialog).getByLabelText("Aqualight G3-S: csere keresése"),
        { target: { value: "G3" } },
      );
      fireEvent.click(within(dialog).getByRole("button", { name: "Keresés" }));
      fireEvent.click(await within(dialog).findByLabelText(/Aqualight G3-L/));
      expect((submit as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(submit);
      await waitFor(() =>
        expect(api.agreeShortage).toHaveBeenCalledWith("tok", "order_1", "s1", {
          choice: "REPLACE",
          channel: "PHONE",
          note: "Cserét kért.",
          lines: [
            {
              itemId: "i1",
              agreedQuantity: 3,
              replacementVariantId: "var_9",
              replacementSku: "AL-G3L",
            },
          ],
        }),
      );
      expect(searchVariants).toHaveBeenCalledWith("G3");
    });

    it("sends the chosen channel and a given time as an ISO string, and shows the server's refusal", async () => {
      api.agreeShortage.mockRejectedValue(
        new ApiError(
          "A lezárt vagy visszavont hiányhoz nem rögzíthető megállapodás.",
          409,
        ),
      );
      const dialog = await openAgreement();
      fireEvent.click(
        within(dialog).getByLabelText(SHORTAGE_CHOICE_LABELS.REMOVE),
      );
      fireEvent.change(within(dialog).getByLabelText("Csatorna"), {
        target: { value: "EMAIL" },
      });
      fireEvent.change(
        within(dialog).getByLabelText("Mikor egyeztek meg (ha nem most)"),
        {
          target: { value: "2026-11-18T07:30" },
        },
      );
      fireEvent.change(within(dialog).getByLabelText("Mit mondtak"), {
        target: { value: "E-mailben kérte." },
      });
      fireEvent.click(within(dialog).getByRole("button", { name: "Rögzítés" }));
      await waitFor(() => expect(api.agreeShortage).toHaveBeenCalled());
      const body = api.agreeShortage.mock.calls[0]![3] as {
        choice: string;
        channel: string;
        agreedAt: string;
      };
      expect(body.choice).toBe("REMOVE");
      expect(body.channel).toBe("EMAIL");
      expect(body.agreedAt).toBe(new Date("2026-11-18T07:30").toISOString());
      expect(
        await within(dialog).findByText(
          "A lezárt vagy visszavont hiányhoz nem rögzíthető megállapodás.",
        ),
      ).toBeTruthy();
    });
  });

  describe("closing and withdrawing", () => {
    it("a SPLIT closes only with the linked order's id, and sends it", async () => {
      api.shortages.mockResolvedValue([agreed()]);
      api.resolveShortage.mockResolvedValue(agreed({ status: "DONE" }));
      renderCard();
      await screen.findByText("Aqualight G3-S");
      fireEvent.click(screen.getByRole("button", { name: "Lezárás" }));
      const dialog = await screen.findByRole("dialog", { name: "Lezárás" });
      const submit = within(dialog).getByRole("button", {
        name: "Lezárás rögzítése",
      });
      expect((submit as HTMLButtonElement).disabled).toBe(true);
      fireEvent.change(
        within(dialog).getByLabelText("A kapcsolt (új) rendelés azonosítója"),
        { target: { value: " order_2 " } },
      );
      expect((submit as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(submit);
      await waitFor(() =>
        expect(api.resolveShortage).toHaveBeenCalledWith(
          "tok",
          "order_1",
          "s1",
          {
            outcome: "done",
            splitOrderId: "order_2",
          },
        ),
      );
    });

    it("another choice closes without a linked order and the field is not offered", async () => {
      api.shortages.mockResolvedValue([agreed({ choice: "REMOVE" })]);
      api.resolveShortage.mockResolvedValue(agreed({ status: "DONE" }));
      renderCard();
      await screen.findByText("Aqualight G3-S");
      fireEvent.click(screen.getByRole("button", { name: "Lezárás" }));
      const dialog = await screen.findByRole("dialog", { name: "Lezárás" });
      expect(
        within(dialog).queryByLabelText("A kapcsolt (új) rendelés azonosítója"),
      ).toBeNull();
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Lezárás rögzítése" }),
      );
      await waitFor(() =>
        expect(api.resolveShortage).toHaveBeenCalledWith(
          "tok",
          "order_1",
          "s1",
          {
            outcome: "done",
          },
        ),
      );
    });

    it("a withdrawal needs the reason, and sends it trimmed", async () => {
      api.shortages.mockResolvedValue([shortage()]);
      api.resolveShortage.mockResolvedValue(shortage({ status: "WITHDRAWN" }));
      renderCard();
      await screen.findByText("Aqualight G3-S");
      fireEvent.click(screen.getByRole("button", { name: "Visszavonás" }));
      const dialog = await screen.findByRole("dialog", { name: "Visszavonás" });
      const submit = within(dialog).getByRole("button", {
        name: "Visszavonás rögzítése",
      });
      expect((submit as HTMLButtonElement).disabled).toBe(true);
      fireEvent.change(within(dialog).getByLabelText("Az indok"), {
        target: { value: "  Megjött az áru.  " },
      });
      expect((submit as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(submit);
      await waitFor(() =>
        expect(api.resolveShortage).toHaveBeenCalledWith(
          "tok",
          "order_1",
          "s1",
          {
            outcome: "withdrawn",
            note: "Megjött az áru.",
          },
        ),
      );
    });
  });

  it("has a Hungarian label for every status, choice and channel", () => {
    expect(Object.keys(SHORTAGE_STATUS_LABELS).sort()).toEqual([
      "AGREED",
      "DONE",
      "OPEN",
      "WITHDRAWN",
    ]);
    expect(Object.keys(SHORTAGE_CHOICE_LABELS).sort()).toEqual([
      "REMOVE",
      "REPLACE",
      "SPLIT",
    ]);
    expect(Object.keys(SHORTAGE_CHANNEL_LABELS).sort()).toEqual([
      "EMAIL",
      "OTHER",
      "PHONE",
    ]);
  });
});
