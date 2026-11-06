import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { LivestockArrival, Session, UserRole } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/api/livestock-arrivals", () => ({ livestockArrivalsApi: api }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/elo-allat-erkezesek",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));

import { inputOfForm, LivestockArrivalsPage } from "./livestock-arrivals-page";

/*
  AZ ÉLŐ ÁLLAT ÉRKEZÉSEK OLDALA (kártya f4e4832b, V2.6 S2b). MI PIROSÍT: ha olvasási joggal is van Új érkezés gomb vagy
  szerkeszthető sor; ha a lista nem a megadott szűrőkkel kérdez (köztük az alapértelmezett "csak a közelgők"); ha az üres
  mennyiség vagy megjegyzés nem null-ként megy (a módosításnál az TÖRLI az értéket); ha lezárt állapotú érkezés
  előjegyezhetőként mehet ki; ha a mentés hibája nem látszik; ha a termék neve nem jelenik meg, amikor van kötés.
*/
function as(role: UserRole): Session {
  return {
    id: "s",
    token: "t",
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: "u",
      email: "u@acropora.local",
      displayName: "U",
      role,
      customerId: null,
      supplierId: null,
    },
  };
}

const arrival = (over: Partial<LivestockArrival> = {}): LivestockArrival => ({
  id: "a1",
  kind: "CORAL",
  label: "Zoanthus Utter Chaos",
  productId: "p1",
  productName: "Zoanthus Utter Chaos (darab)",
  expectedOn: "2026-11-13",
  quantity: 8,
  status: "IN_TRANSIT",
  preorderable: true,
  note: "a futár hívja",
  createdAt: "2026-11-06T08:00:00.000Z",
  updatedAt: "2026-11-06T08:00:00.000Z",
  ...over,
});

beforeEach(() => {
  auth.session = as("OWNER");
  api.list.mockReset().mockResolvedValue({ items: [arrival()] });
  api.create.mockReset().mockResolvedValue(arrival());
  api.update.mockReset().mockResolvedValue(arrival());
});

describe("a lista", () => {
  it("kéri a közelgőket alapból, és megmutatja a sort: nap, fajta, megnevezés, termék, darab, állapot, előjegyezhető, megjegyzés", async () => {
    render(<LivestockArrivalsPage />);
    const list = await screen.findByTestId("livestock-arrival-list");
    expect(api.list.mock.calls[0]![1]).toEqual({ upcoming: true });
    const row = within(list).getByRole("button");
    expect(within(row).getByText("2026. 11. 13.")).toBeInTheDocument();
    expect(within(row).getByText("Korall")).toBeInTheDocument();
    expect(within(row).getByText("Zoanthus Utter Chaos")).toBeInTheDocument();
    expect(
      within(row).getByText("Termék: Zoanthus Utter Chaos (darab)"),
    ).toBeInTheDocument();
    expect(within(row).getByText("8 db")).toBeInTheDocument();
    expect(within(row).getByText("Úton")).toBeInTheDocument();
    expect(within(row).getByText("Előjegyezhető")).toBeInTheDocument();
    expect(screen.getByText("a futár hívja")).toBeInTheDocument();
  });

  it("a szűrők a kéréshez mennek: állapot, fajta, csak előjegyezhető, és a közelgők kikapcsolása", async () => {
    render(<LivestockArrivalsPage />);
    await screen.findByTestId("livestock-arrival-list");
    fireEvent.change(screen.getByLabelText("Állapot szűrő"), {
      target: { value: "IN_TRANSIT" },
    });
    fireEvent.change(screen.getByLabelText("Fajta szűrő"), {
      target: { value: "CORAL" },
    });
    fireEvent.click(screen.getByLabelText("Csak az előjegyezhetők"));
    fireEvent.click(screen.getByLabelText("Csak a közelgők"));
    await waitFor(() =>
      expect(api.list.mock.calls.at(-1)![1]).toEqual({
        status: "IN_TRANSIT",
        kind: "CORAL",
        preorderable: true,
      }),
    );
  });

  it("egy sor nélküli darabszám kötőjel, a termék nélküli sor nem mutat Termék sort", async () => {
    api.list.mockResolvedValue({
      items: [arrival({ quantity: null, productId: null, productName: null })],
    });
    render(<LivestockArrivalsPage />);
    const list = await screen.findByTestId("livestock-arrival-list");
    expect(within(list).getByText("–")).toBeInTheDocument();
    expect(within(list).queryByText(/^Termék:/)).toBeNull();
  });

  it("üres listánál megmondja, mi a teendő, és hibánál a hibát mutatja", async () => {
    api.list.mockResolvedValue({ items: [] });
    const { unmount } = render(<LivestockArrivalsPage />);
    expect(await screen.findByText("Nincs ilyen érkezés")).toBeInTheDocument();
    unmount();
    api.list.mockRejectedValue(new Error("A szerver nem érhető el."));
    render(<LivestockArrivalsPage />);
    expect(
      await screen.findByText("A szerver nem érhető el."),
    ).toBeInTheDocument();
  });
});

describe("a jogosultság", () => {
  it("olvasási joggal nincs Új érkezés gomb, és a sor nem nyílik szerkesztésre", async () => {
    auth.session = as("VIEWER");
    render(<LivestockArrivalsPage />);
    const list = await screen.findByTestId("livestock-arrival-list");
    expect(screen.queryByRole("button", { name: "Új érkezés" })).toBeNull();
    expect(within(list).getByRole("button")).toBeDisabled();
  });

  it("jog nélkül nem kérdez, hanem megmondja, mi hiányzik", () => {
    auth.session = as("PARTNER_SERVICE");
    render(<LivestockArrivalsPage />);
    expect(
      screen.getByText("Nincs hozzáférésed az élő állat érkezésekhez"),
    ).toBeInTheDocument();
    expect(api.list).not.toHaveBeenCalled();
  });

  it("a készletet vezető szerep felvehet és módosíthat", async () => {
    auth.session = as("WAREHOUSE");
    render(<LivestockArrivalsPage />);
    await screen.findByTestId("livestock-arrival-list");
    expect(
      screen.getByRole("button", { name: "Új érkezés" }),
    ).toBeInTheDocument();
  });
});

describe("a felvétel", () => {
  const open = async () => {
    render(<LivestockArrivalsPage />);
    await screen.findByTestId("livestock-arrival-list");
    fireEvent.click(screen.getByRole("button", { name: "Új érkezés" }));
    return screen.findByTestId("livestock-arrival-form");
  };

  it("a Mentés addig tiltott, amíg nincs megnevezés és nap", async () => {
    const form = await open();
    const save = screen.getByRole("button", { name: "Mentés" });
    expect(save).toBeDisabled();
    fireEvent.change(within(form).getByLabelText("Megnevezés"), {
      target: { value: "Paracanthurus hepatus" },
    });
    expect(save).toBeDisabled();
    fireEvent.change(within(form).getByLabelText("Várható érkezés napja"), {
      target: { value: "2026. 11. 20." },
    });
    expect(save).toBeEnabled();
  });

  it("a mentés a szerver alakját küldi: levágott megnevezés, üres darabszám és megjegyzés null, alapból megrendelve és nem előjegyezhető", async () => {
    const form = await open();
    fireEvent.change(within(form).getByLabelText("Megnevezés"), {
      target: { value: "  Paracanthurus hepatus " },
    });
    fireEvent.change(within(form).getByLabelText("Várható érkezés napja"), {
      target: { value: "2026. 11. 20." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create.mock.calls[0]![1]).toEqual({
      kind: "FISH",
      label: "Paracanthurus hepatus",
      expectedOn: "2026-11-20",
      quantity: null,
      status: "ORDERED",
      preorderable: false,
      note: null,
    });
  });

  it("a mentés hibáját megmutatja, és az ablak nyitva marad", async () => {
    api.create.mockRejectedValue(new Error("A dátum nem létező nap."));
    const form = await open();
    fireEvent.change(within(form).getByLabelText("Megnevezés"), {
      target: { value: "x" },
    });
    fireEvent.change(within(form).getByLabelText("Várható érkezés napja"), {
      target: { value: "2026. 11. 20." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(
      await screen.findByText("A dátum nem létező nap."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("livestock-arrival-form")).toBeInTheDocument();
  });
});

describe("a szerkesztés", () => {
  it("a sor értékeivel nyílik, és a módosítás a sor azonosítójára megy, a kiürített darabszám és megjegyzés null", async () => {
    render(<LivestockArrivalsPage />);
    const list = await screen.findByTestId("livestock-arrival-list");
    fireEvent.click(within(list).getByRole("button"));
    const form = await screen.findByTestId("livestock-arrival-form");
    expect(within(form).getByLabelText("Megnevezés")).toHaveValue(
      "Zoanthus Utter Chaos",
    );
    expect(within(form).getByLabelText("Darabszám")).toHaveValue("8");
    expect(within(form).getByLabelText("Megjegyzés")).toHaveValue(
      "a futár hívja",
    );
    fireEvent.change(within(form).getByLabelText("Darabszám"), {
      target: { value: "" },
    });
    fireEvent.change(within(form).getByLabelText("Megjegyzés"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update.mock.calls[0]![1]).toBe("a1");
    expect(api.update.mock.calls[0]![2]).toMatchObject({
      quantity: null,
      note: null,
      status: "IN_TRANSIT",
      preorderable: true,
    });
  });

  it("a lezáró állapot leveszi az Előjegyezhető pipát, és le is tiltja; egy megnyitott állapot visszaadja a választást", async () => {
    render(<LivestockArrivalsPage />);
    const list = await screen.findByTestId("livestock-arrival-list");
    fireEvent.click(within(list).getByRole("button"));
    const form = await screen.findByTestId("livestock-arrival-form");
    const tick = within(form).getByRole("checkbox", { name: /Előjegyezhető/ });
    expect(tick).toBeChecked();
    fireEvent.change(within(form).getByLabelText("Állapot"), {
      target: { value: "ARRIVED" },
    });
    expect(tick).not.toBeChecked();
    expect(tick).toBeDisabled();
    expect(
      within(form).getByText(/Csak megrendelt vagy úton lévő/),
    ).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText("Állapot"), {
      target: { value: "ORDERED" },
    });
    expect(tick).toBeEnabled();
    expect(tick).not.toBeChecked();
  });
});

describe("az űrlap alakja az API felé", () => {
  const form = {
    kind: "CORAL" as const,
    label: "  Zoanthus  ",
    expectedOn: "2026-11-13",
    quantity: " 12 ",
    status: "ORDERED" as const,
    preorderable: true,
    note: "  ",
  };

  it("levág, az üres mezőket null-ra váltja, a számot számmá", () => {
    expect(inputOfForm(form)).toEqual({
      kind: "CORAL",
      label: "Zoanthus",
      expectedOn: "2026-11-13",
      quantity: 12,
      status: "ORDERED",
      preorderable: true,
      note: null,
    });
  });

  it("lezárt állapotnál az előjegyezhető nem mehet ki igazként, nyitottnál igen", () => {
    expect(inputOfForm({ ...form, status: "ARRIVED" }).preorderable).toBe(
      false,
    );
    expect(inputOfForm({ ...form, status: "CANCELLED" }).preorderable).toBe(
      false,
    );
    expect(inputOfForm({ ...form, status: "IN_TRANSIT" }).preorderable).toBe(
      true,
    );
  });
});
