import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  DueInvoicesMailSettingsView,
  Session,
  UserRole,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DueInvoicesSettingsPage,
  splitRecipients,
} from "./due-invoices-settings-page";

/*
  A LEJÁRÓ SZÁMLÁK LEVELÉNEK BEÁLLÍTÁSA (acrobot 58227, 58274). MI PIROSÍT: ha a lap a betöltött értékeket nem mutatja (címzettek soronként, feladó,
  nap, a két időpont, a kapcsoló); ha a mentés nem a szerkesztett értékeket viszi (a címzettek szétbontva, az üres feladó null, a nap számként);
  ha a szerver hibamondata nem látszik, vagy a mentés „Mentve”-t ír hiba esetén; ha az alapértelmezett feladó nem látszik, vagy hiánya nem
  figyelmeztet a ticket@-ra; ha az utolsó küldés nyoma nem látszik; ha jog nélkül betölt; ha a címzett-szöveg vesszővel vagy szóközzel nem bomlik.
*/
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

const api = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/api/due-invoices", () => ({ dueInvoicesSettingsApi: api }));

const auth = vi.hoisted(() => ({ role: "OWNER" as UserRole }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      id: "s",
      token: "token-1",
      expiresAt: "2099-01-01T00:00:00.000Z",
      user: {
        id: "u",
        email: "u@acropora.local",
        displayName: "U",
        role: auth.role,
        customerId: null,
        supplierId: null,
      },
    } satisfies Session,
  }),
}));

const view = (
  over: Partial<DueInvoicesMailSettingsView> = {},
): DueInvoicesMailSettingsView => ({
  enabled: true,
  recipients: ["balazs@acropora.example", "penzugy@acropora.example"],
  fromAddress: null,
  weekday: 1,
  earliest: "07:00",
  latest: "12:00",
  defaultFromAddress: "info@acropora.example",
  lastSent: null,
  ...over,
});

beforeEach(() => {
  auth.role = "OWNER";
  api.read.mockReset().mockResolvedValue(view());
  api.save.mockReset().mockImplementation(async (_token, input) => ({
    ...view(),
    ...input,
  }));
});

describe("the due-invoices mail settings page", () => {
  it("shows the loaded values: the recipients one per line, the sender placeholder, the day, both times, the switch", async () => {
    render(<DueInvoicesSettingsPage />);
    expect(await screen.findByLabelText("Címzettek")).toHaveValue(
      "balazs@acropora.example\npenzugy@acropora.example",
    );
    expect(screen.getByLabelText("Feladó")).toHaveValue("");
    expect(screen.getByLabelText("Feladó")).toHaveAttribute(
      "placeholder",
      "info@acropora.example",
    );
    expect(screen.getByLabelText("Nap")).toHaveValue("1");
    expect(screen.getByLabelText("Legkorábbi időpont")).toHaveValue("07:00");
    expect(screen.getByLabelText("Legkésőbbi időpont")).toHaveValue("12:00");
    expect(
      screen.getByLabelText("A heti levél be van kapcsolva"),
    ).toBeChecked();
    expect(
      screen.getByText(/Üresen az alapértelmezés megy: info@acropora.example/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("due-last-sent")).toHaveTextContent(
      "Még nem ment levél.",
    );
  });

  it("saves what was edited: recipients split on lines, commas and spaces, an empty sender as null, the day as a number", async () => {
    const user = userEvent.setup();
    render(<DueInvoicesSettingsPage />);
    const recipients = await screen.findByLabelText("Címzettek");
    await user.clear(recipients);
    await user.type(
      recipients,
      "a@acropora.example, b@acropora.example c@acropora.example",
    );
    await user.selectOptions(screen.getByLabelText("Nap"), "3");
    await user.click(screen.getByLabelText("A heti levél be van kapcsolva"));
    await user.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(api.save).toHaveBeenCalledWith("token-1", {
      enabled: false,
      recipients: [
        "a@acropora.example",
        "b@acropora.example",
        "c@acropora.example",
      ],
      fromAddress: null,
      weekday: 3,
      earliest: "07:00",
      latest: "12:00",
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Mentve.");
  });

  it("a typed sender goes with the save", async () => {
    const user = userEvent.setup();
    render(<DueInvoicesSettingsPage />);
    await user.type(
      await screen.findByLabelText("Feladó"),
      " penzugy@acropora.example ",
    );
    await user.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() => expect(api.save).toHaveBeenCalled());
    expect(api.save.mock.calls[0]![1].fromAddress).toBe(
      "penzugy@acropora.example",
    );
  });

  it("the server's sentence is shown on a refused save, and it does not say it was saved", async () => {
    api.save.mockRejectedValueOnce(
      new Error("Érvénytelen címzett: rossz cim."),
    );
    const user = userEvent.setup();
    render(<DueInvoicesSettingsPage />);
    await user.click(await screen.findByRole("button", { name: "Mentés" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Érvénytelen címzett: rossz cim.",
    );
    expect(screen.queryByText("Mentve.")).toBeNull();
  });

  it("without a default sender it warns about the ticket address; with a saved sender and a last send it shows them", async () => {
    api.read.mockResolvedValue(
      view({
        defaultFromAddress: null,
        fromAddress: "penzugy@acropora.example",
        lastSent: {
          day: "2026-11-23",
          at: "2026-11-23T07:15:00.000Z",
          recipients: 2,
        },
      }),
    );
    render(<DueInvoicesSettingsPage />);
    expect(
      await screen.findByText(/Nincs alapértelmezett feladó beállítva/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Feladó")).toHaveValue(
      "penzugy@acropora.example",
    );
    expect(screen.getByTestId("due-last-sent")).toHaveTextContent(
      "Utolsó küldés: 2026. 11. 23., 2 címzettnek.",
    );
  });

  it("without the finance.manage right nothing loads", async () => {
    auth.role = "SERVICE";
    render(<DueInvoicesSettingsPage />);
    expect(
      await screen.findByText(/finance\.manage jog kell/),
    ).toBeInTheDocument();
    expect(api.read).not.toHaveBeenCalled();
  });

  it("splitRecipients splits on whitespace, commas and semicolons and drops the empty parts", () => {
    expect(splitRecipients("a@x.hu\nb@x.hu, c@x.hu;d@x.hu  \n")).toEqual([
      "a@x.hu",
      "b@x.hu",
      "c@x.hu",
      "d@x.hu",
    ]);
    expect(splitRecipients("   ")).toEqual([]);
  });
});
