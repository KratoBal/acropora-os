import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { LivestockArrival, Session, UserRole } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  productOptions: vi.fn(),
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
  api.productOptions.mockReset().mockResolvedValue([
    {
      id: "p9",
      name: "Paracanthurus hepatus",
      commonName: "Regal tang",
      kind: "FISH",
    },
    { id: "p8", name: "Zoanthus mix", commonName: null, kind: null },
    {
      id: "p7",
      name: "Euphyllia ancora",
      commonName: "Hammer koral",
      kind: "CORAL",
    },
  ]);
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
      productId: null,
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

  it("a módosítás a betöltéskori updatedAt-ot küldi (negyedik argumentum), nem a létrehozás idejét, és nem keveri a törzsbe", async () => {
    api.list.mockResolvedValue({
      items: [arrival({ updatedAt: "2026-11-06T09:30:00.000Z" })],
      truncated: false,
    });
    render(<LivestockArrivalsPage />);
    const list = await screen.findByTestId("livestock-arrival-list");
    fireEvent.click(within(list).getByRole("button"));
    await screen.findByTestId("livestock-arrival-form");
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update.mock.calls[0]![3]).toBe("2026-11-06T09:30:00.000Z");
    expect(api.update.mock.calls[0]![2]).not.toHaveProperty(
      "expectedUpdatedAt",
    );
  });

  it("ütközésnél (409) kiírja a szerver szövegét, frissíti a listát, és a mentést lezárja, mert az űrlap a régi verzióból jött", async () => {
    api.update.mockRejectedValue(
      new ApiError("Az érkezést közben valaki módosította: töltsd újra.", 409),
    );
    render(<LivestockArrivalsPage />);
    const list = await screen.findByTestId("livestock-arrival-list");
    fireEvent.click(within(list).getByRole("button"));
    await screen.findByTestId("livestock-arrival-form");
    expect(api.list).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(
      await screen.findByText(/Az érkezést közben valaki módosította/),
    ).toBeInTheDocument();
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Mentés" })).toBeDisabled();
    expect(screen.getByTestId("livestock-arrival-form")).toBeInTheDocument();
  });

  it("más hibánál a mentés nyitva marad, és a lista nem frissül feleslegesen", async () => {
    api.update.mockRejectedValue(new ApiError("A dátum nem létező nap.", 400));
    render(<LivestockArrivalsPage />);
    const list = await screen.findByTestId("livestock-arrival-list");
    fireEvent.click(within(list).getByRole("button"));
    await screen.findByTestId("livestock-arrival-form");
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    await screen.findByText("A dátum nem létező nap.");
    expect(screen.getByRole("button", { name: "Mentés" })).toBeEnabled();
    expect(api.list).toHaveBeenCalledTimes(1);
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

describe("a termék választó", () => {
  const open = async () => {
    render(<LivestockArrivalsPage />);
    await screen.findByTestId("livestock-arrival-list");
    fireEvent.click(screen.getByRole("button", { name: "Új érkezés" }));
    return screen.findByTestId("livestock-arrival-form");
  };
  const pick = async (form: HTMLElement, name: RegExp) => {
    fireEvent.focus(within(form).getByRole("textbox", { name: "Termék" }));
    fireEvent.click(await screen.findByRole("button", { name }));
  };

  it("keres a szerveren a beírt szóra, és a találat a választó helyére kerül", async () => {
    const form = await open();
    const input = within(form).getByRole("textbox", { name: "Termék" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "parac" } });
    await screen.findByRole("button", { name: /Paracanthurus hepatus/ });
    expect(api.productOptions).toHaveBeenLastCalledWith(
      "t",
      "parac",
      expect.any(AbortSignal),
    );
  });

  it("az egyértelmű fajtájú termék beállítja és zárja a fajtát, kitölti az üres megnevezést, és az azonosítója megy a mentéskor", async () => {
    const form = await open();
    await pick(form, /Euphyllia ancora/);
    expect(within(form).getByLabelText("Fajta")).toHaveValue("CORAL");
    expect(within(form).getByLabelText("Fajta")).toBeDisabled();
    expect(within(form).getByLabelText("Megnevezés")).toHaveValue(
      "Euphyllia ancora",
    );
    fireEvent.change(within(form).getByLabelText("Várható érkezés napja"), {
      target: { value: "2026. 11. 20." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create.mock.calls[0]![1]).toMatchObject({
      kind: "CORAL",
      label: "Euphyllia ancora",
      productId: "p7",
    });
  });

  it("a már beírt megnevezést nem írja felül, és a fajta nélküli (több gyökérű) termék a fajtát a személyre hagyja", async () => {
    const form = await open();
    fireEvent.change(within(form).getByLabelText("Megnevezés"), {
      target: { value: "Saját név" },
    });
    fireEvent.change(within(form).getByLabelText("Fajta"), {
      target: { value: "CORAL" },
    });
    await pick(form, /Zoanthus mix/);
    expect(within(form).getByLabelText("Megnevezés")).toHaveValue("Saját név");
    expect(within(form).getByLabelText("Fajta")).toHaveValue("CORAL");
    expect(within(form).getByLabelText("Fajta")).toBeEnabled();
  });

  it("szerkesztésnél a kötött termék neve látszik, és a Csere után mentve a kötés null-ként törlődik", async () => {
    render(<LivestockArrivalsPage />);
    const list = await screen.findByTestId("livestock-arrival-list");
    fireEvent.click(within(list).getByRole("button"));
    const form = await screen.findByTestId("livestock-arrival-form");
    expect(
      within(form).getByText("Zoanthus Utter Chaos (darab)"),
    ).toBeInTheDocument();
    fireEvent.click(within(form).getByRole("button", { name: "Csere" }));
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update.mock.calls[0]![2]).toMatchObject({ productId: null });
  });

  it("a tárolt kötés változatlanul megy vissza, ha a választóhoz nem nyúlt senki", async () => {
    render(<LivestockArrivalsPage />);
    const list = await screen.findByTestId("livestock-arrival-list");
    fireEvent.click(within(list).getByRole("button"));
    await screen.findByTestId("livestock-arrival-form");
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update.mock.calls[0]![2]).toMatchObject({ productId: "p1" });
  });
});

describe("az űrlap alakja az API felé", () => {
  const form = {
    kind: "CORAL" as const,
    label: "  Zoanthus  ",
    product: null,
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
      productId: null,
      expectedOn: "2026-11-13",
      quantity: 12,
      status: "ORDERED",
      preorderable: true,
      note: null,
    });
  });

  it("a kiválasztott termék azonosítója megy, a kiürített választó null (a módosításnál ez törli a kötést)", () => {
    expect(
      inputOfForm({ ...form, product: { id: "p9", title: "Paracanthurus" } })
        .productId,
    ).toBe("p9");
    expect(inputOfForm({ ...form, product: null }).productId).toBeNull();
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
