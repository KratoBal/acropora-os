import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { WebshopCustomerText } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WebshopCustomerTextsPage } from "./webshop-customer-texts-page";

/*
  A VEVŐI SZÖVEGEK LAPJA (kártya 7bfca4eb; acrobot 60632). MI PIROSÍT: a csoportok nem a vevő útja szerint állnak, vagy a Levelek
  nem a Levélsablonokba visz; a kereső nem szűr a csoportokon át; egy elhagyott {hely} az API-ig jut; a mentés a változatlan
  nyelvet is írja; az alapértékre visszaírt szöveg tárolt másolat lesz törlés helyett; egy ismeretlen csoport szövege eltűnik; a
  beállítások joga nélkül a lap betölt.
*/
const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
const auth = vi.hoisted(() => ({ role: "OWNER" as "OWNER" | "WAREHOUSE" }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      token: "token",
      user: {
        id: "u",
        email: "u@acropora.local",
        role: auth.role,
        customerId: null,
        supplierId: null,
      },
    },
    isLoading: false,
  }),
}));
vi.mock("@/lib/api/webshop-customer-texts", () => ({
  webshopCustomerTextsApi: api,
}));

const text = (
  key: string,
  group: string,
  hu: string,
  en: string,
  overrides: Partial<WebshopCustomerText["overrides"]> = {},
): WebshopCustomerText => ({
  key,
  group,
  defaults: { hu, en },
  overrides: { hu: null, en: null, ...overrides },
});

const TEXTS = [
  text("cart.add", "penztar", "Kosárba", "Add to cart"),
  text(
    "guestOrder.problem.done",
    "hibabejelentes",
    "Megkaptuk, ügyszám: {id}",
    "Received, case {id}",
  ),
  text("account.title", "fiok", "Fiók", "Account", { en: "My account" }),
  text("future.text", "uj-csoport", "Új szöveg", "New text"),
];

beforeEach(() => {
  auth.role = "OWNER";
  api.get.mockReset().mockResolvedValue({ texts: TEXTS });
  api.save.mockReset().mockImplementation(async (_token, input) => {
    const found = TEXTS.find((t) => t.key === input.key)!;
    return {
      ...found,
      overrides: { ...found.overrides, [input.locale]: input.value },
    };
  });
});

describe("WebshopCustomerTextsPage", () => {
  it("a csoportok a vevő útja szerint, a Levelek a Levélsablonok webshop füléhez visz, az ismeretlen csoport sem vész el", async () => {
    render(<WebshopCustomerTextsPage />);
    await screen.findByLabelText("Keresés a vevői szövegekben");
    const groupButtons = screen
      .getAllByRole("button", { expanded: false })
      .map((b) => b.querySelector("span span")?.textContent);
    expect(groupButtons).toEqual([
      "Pénztár",
      "Rendelés leadva",
      "Rendelés állapota",
      "Elállás és visszatérítés",
      "Hibabejelentés",
      "Fiók",
      "Hírlevél és készletfigyelő",
      "Süti-hozzájárulás",
    ]);
    expect(
      screen.getByRole("link", { name: "A webshop levelei" }),
    ).toHaveAttribute("href", "/beallitasok/levelsablonok?csoport=webshop");
    expect(screen.getByText("Egyéb")).toBeInTheDocument();
    expect(screen.getByTestId("vevoi-szoveg-future.text")).toBeInTheDocument();
  });

  it("a kereső a csoportokon át szűr, ékezet nélkül is, és a felülírásban is keres", async () => {
    render(<WebshopCustomerTextsPage />);
    const search = await screen.findByLabelText("Keresés a vevői szövegekben");
    fireEvent.change(search, { target: { value: "kosarba" } });
    expect(screen.getByText("1 találat")).toBeInTheDocument();
    expect(screen.getByTestId("vevoi-szoveg-cart.add")).toBeInTheDocument();
    expect(screen.queryByTestId("vevoi-szoveg-account.title")).toBeNull();
    fireEvent.change(search, { target: { value: "my account" } });
    expect(
      screen.getByTestId("vevoi-szoveg-account.title"),
    ).toBeInTheDocument();
    expect(screen.queryByText("A webshop levelei")).toBeNull();
  });

  it("csak a változott nyelvet menti; egy elhagyott {hely} nem jut az API-ig", async () => {
    render(<WebshopCustomerTextsPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Hibabejelentés/ }),
    );
    const row = screen.getByTestId("vevoi-szoveg-guestOrder.problem.done");
    fireEvent.click(within(row).getByRole("button", { name: "Szerkesztés" }));
    fireEvent.change(within(row).getByLabelText("Magyar szöveg"), {
      target: { value: "Megkaptuk a bejelentést" },
    });
    fireEvent.click(within(row).getByRole("button", { name: "Mentés" }));
    expect(
      await within(row).findByText(/\{id\}/, {
        selector: "p.text-xs.text-pilot-red-700",
      }),
    ).toBeInTheDocument();
    expect(api.save).not.toHaveBeenCalled();

    fireEvent.change(within(row).getByLabelText("Magyar szöveg"), {
      target: { value: "Megkaptuk, az ügyszámod: {id}" },
    });
    fireEvent.click(within(row).getByRole("button", { name: "Mentés" }));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(api.save).toHaveBeenCalledWith("token", {
      key: "guestOrder.problem.done",
      locale: "hu",
      value: "Megkaptuk, az ügyszámod: {id}",
    });
  });

  it("a „Vissza az alapra” a felülírást törli (null), nem az alapérték másolatát tárolja", async () => {
    render(<WebshopCustomerTextsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Fiók/ }));
    const row = screen.getByTestId("vevoi-szoveg-account.title");
    expect(within(row).getByText("Átírva")).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "Szerkesztés" }));
    fireEvent.click(
      within(row).getByRole("button", { name: "Vissza az alapra" }),
    );
    fireEvent.click(within(row).getByRole("button", { name: "Mentés" }));
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith("token", {
        key: "account.title",
        locale: "en",
        value: null,
      }),
    );
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText("Visszaállítva az alapértékre."),
    ).toBeInTheDocument();
  });

  it("a {hely}-ek előre látszanak, és gépelés közben megmondja, melyik hiányzik; hely nélküli szövegnél nincs sor", async () => {
    render(<WebshopCustomerTextsPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Hibabejelentés/ }),
    );
    const row = screen.getByTestId("vevoi-szoveg-guestOrder.problem.done");
    fireEvent.click(within(row).getByRole("button", { name: "Szerkesztés" }));
    const helyek = within(row).getByTestId("helyek-hu");
    expect(helyek.textContent).toContain(
      "Ezeknek a helyeknek a szövegben kell maradniuk: {id}",
    );
    expect(helyek.textContent).not.toContain("hiányzik");
    fireEvent.change(within(row).getByLabelText("Magyar szöveg"), {
      target: { value: "Megkaptuk a bejelentést" },
    });
    expect(within(row).getByTestId("helyek-hu").textContent).toContain(
      "most hiányzik: {id}",
    );
    expect(api.save).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole("button", { name: /Pénztár/ }));
    const kosar = screen.getByTestId("vevoi-szoveg-cart.add");
    fireEvent.click(within(kosar).getByRole("button", { name: "Szerkesztés" }));
    expect(within(kosar).queryByTestId("helyek-hu")).toBeNull();
  });

  it("a beállítások joga nélkül nem tölt", async () => {
    auth.role = "WAREHOUSE";
    render(<WebshopCustomerTextsPage />);
    expect(
      screen.getByText("Nincs hozzáférésed a webshop vevői szövegeihez"),
    ).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
});
