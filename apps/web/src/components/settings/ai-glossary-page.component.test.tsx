import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  AiGlossaryEntry,
  AiGlossaryVersion,
  AiGlossaryVersionInfo,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import { AiGlossaryPage } from "./ai-glossary-page";

/*
  AZ AI SZÓJEGYZÉK LAPJA (kártya 7a5ea203, C3; acrobot 63288). MI PIROSÍT: a jóváhagyó és ideje nem a sor mellett áll, vagy egy megváltozott
  magyar név megtartja a RÉGI jóváhagyót (a szerver az új szöveget a mentőnek írja); a mentés nem az aktív verzióból indul (az elveszett
  frissítés védelem kiesik); a siker-üzenet nem mondja ki az egy perces késést és az automatikus mérést; a 409 nem ad újratöltést; az ATO
  kikerülése vagy eredetijének változása nem figyelmeztet (vagy tilt); a visszaállítás azonnal ír, ahelyett hogy a szerkesztőbe töltene;
  a beállítások joga nélkül a lap betölt.
*/
const api = vi.hoisted(() => ({
  versions: vi.fn(),
  version: vi.fn(),
  save: vi.fn(),
}));
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
vi.mock("@/lib/api/ai-glossary", () => ({ aiGlossaryApi: api }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/beallitasok/ai-szojegyzek",
  useSearchParams: () => new URLSearchParams(),
}));

const entry = (
  abbreviation: string,
  original: string,
  hungarian: string,
  approvedBy: string | null,
  language: "en" | "de" = "en",
): AiGlossaryEntry => ({
  abbreviation,
  original,
  language,
  hungarian,
  approved: approvedBy !== null,
  approvedBy,
  approvedAt: approvedBy ? "2026-11-26T17:00:00.000Z" : null,
});

const ACTIVE: AiGlossaryVersion = {
  version: 3,
  createdAt: "2026-11-26T18:00:00.000Z",
  createdBy: "Kovács Anna",
  note: "ICP jóváhagyva",
  active: true,
  entries: [
    entry(
      "ATO",
      "Automatic Top Off",
      "automatikus utántöltő",
      "Alapértelmezett (rendszer)",
    ),
    entry(
      "ICP",
      "Inductively Coupled Plasma",
      "induktív csatolású plazma",
      "Nagy Béla",
    ),
    entry("RO", "Reverse Osmosis", "fordított ozmózis", null),
    entry(
      "KH",
      "Karbonathärte",
      "karbonátkeménység",
      "Alapértelmezett (rendszer)",
      "de",
    ),
  ],
};
const OLD: AiGlossaryVersion = {
  ...ACTIVE,
  version: 1,
  active: false,
  createdBy: "Alapértelmezett (rendszer)",
  note: "",
  entries: [
    entry(
      "ATO",
      "Automatic Top Off",
      "automatikus utántöltő",
      "Alapértelmezett (rendszer)",
    ),
    entry(
      "ICP",
      "Inductively Coupled Plasma",
      "régi ICP név",
      "Alapértelmezett (rendszer)",
    ),
  ],
};
const LIST: AiGlossaryVersionInfo[] = [
  {
    version: 3,
    createdAt: ACTIVE.createdAt,
    createdBy: "Kovács Anna",
    note: "ICP jóváhagyva",
    entryCount: 4,
    active: true,
  },
  {
    version: 1,
    createdAt: "2026-11-26T17:00:00.000Z",
    createdBy: "Alapértelmezett (rendszer)",
    note: "",
    entryCount: 2,
    active: false,
  },
];

beforeEach(() => {
  auth.role = "OWNER";
  api.versions.mockReset().mockResolvedValue({ versions: LIST });
  api.version
    .mockReset()
    .mockImplementation(async (_token: string, version: number) =>
      version === 1 ? OLD : ACTIVE,
    );
  api.save
    .mockReset()
    .mockResolvedValue({ version: 4, takesEffectWithinSeconds: 60 });
});

const row = (n: number) => screen.getByTestId(`szojegyzek-sor-${n}`);
const approval = (n: number) =>
  screen.getByTestId(`jovahagyas-${n}`).textContent;

describe("AiGlossaryPage", () => {
  it("az aktív verziót tölti be: a sorok, a jóváhagyó neve és ideje a jelölő mellett, a várakozó sor jelvénnyel", async () => {
    render(<AiGlossaryPage />);
    await screen.findByText("Aktív verzió: 3");
    expect(approval(1)).toMatch(/^Jóváhagyta: Alapértelmezett \(rendszer\), /);
    expect(approval(2)).toMatch(/^Jóváhagyta: Nagy Béla, /);
    expect(approval(3)).toBe("Jóváhagyásra vár");
    expect(screen.getByText("1 jóváhagyásra vár")).toBeInTheDocument();
    expect(within(row(4)).getByLabelText("4. sor nyelve")).toHaveValue("de");
    expect(api.version).toHaveBeenCalledWith("token", 3);
  });

  it("egy megváltozott magyar név a SAJÁT jóváhagyásod lesz, a változatlan sor megtartja a régit; a jelölés bekapcsolása is a tiéd", async () => {
    render(<AiGlossaryPage />);
    await screen.findByText("Aktív verzió: 3");
    fireEvent.change(within(row(2)).getByLabelText("2. sor magyar neve"), {
      target: { value: "induktív plazma" },
    });
    expect(approval(2)).toBe("A mentéssel te hagyod jóvá");
    expect(approval(1)).toMatch(/^Jóváhagyta: Alapértelmezett/);
    fireEvent.click(within(row(3)).getByLabelText("3. sor jóváhagyva"));
    expect(approval(3)).toBe("A mentéssel te hagyod jóvá");
    expect(screen.queryByText("1 jóváhagyásra vár")).toBeNull();
    // vissza az eredetire: megint a régi jóváhagyó
    fireEvent.change(within(row(2)).getByLabelText("2. sor magyar neve"), {
      target: { value: "induktív csatolású plazma" },
    });
    expect(approval(2)).toMatch(/^Jóváhagyta: Nagy Béla/);
  });

  it("változtatás nélkül a mentés tiltott; mentéskor az aktív verzióból indul, a szöveg levágva megy, a siker kimondja a késést és a mérést", async () => {
    render(<AiGlossaryPage />);
    await screen.findByText("Aktív verzió: 3");
    const save = screen.getByRole("button", { name: "Mentés új verzióként" });
    expect(save).toBeDisabled();
    fireEvent.change(within(row(1)).getByLabelText("1. sor magyar neve"), {
      target: { value: "  automatikus utántöltő rendszer " },
    });
    fireEvent.change(screen.getByLabelText("Megjegyzés a mentéshez"), {
      target: { value: "ATO bővítve" },
    });
    expect(save).toBeEnabled();
    api.versions.mockResolvedValue({
      versions: [{ ...LIST[0]!, version: 4 }, ...LIST],
    });
    fireEvent.click(save);
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    const [token, input] = api.save.mock.calls[0]!;
    expect(token).toBe("token");
    expect(input.expectedVersion).toBe(3);
    expect(input.note).toBe("ATO bővítve");
    expect(input.entries[0]).toEqual({
      abbreviation: "ATO",
      original: "Automatic Top Off",
      language: "en",
      hungarian: "automatikus utántöltő rendszer",
      approved: true,
    });
    const notice = await screen.findByText(/Mentve: 4\. verzió/);
    expect(notice.textContent).toMatch(/legfeljebb 60 másodpercen belül/);
    expect(notice.textContent).toMatch(
      /kérdéskészlet-őr automatikusan új mérést indít/,
    );
  });

  it("hibás sor (üres magyar név) magyar mondattal jelzi, és a mentés tiltott", async () => {
    render(<AiGlossaryPage />);
    await screen.findByText("Aktív verzió: 3");
    fireEvent.change(within(row(1)).getByLabelText("1. sor magyar neve"), {
      target: { value: "  " },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(/üres/);
    expect(
      screen.getByRole("button", { name: "Mentés új verzióként" }),
    ).toBeDisabled();
    expect(api.save).not.toHaveBeenCalled();
  });

  it("409-nél a szerver mondata és Újratöltés jön, az újratöltés az aktív verziót kéri", async () => {
    api.save.mockRejectedValue(
      new ApiError(
        "Közben valaki más mentett egy újabb szójegyzéket (4. verzió).",
        409,
      ),
    );
    render(<AiGlossaryPage />);
    await screen.findByText("Aktív verzió: 3");
    fireEvent.change(within(row(1)).getByLabelText("1. sor magyar neve"), {
      target: { value: "más név" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Mentés új verzióként" }),
    );
    expect(
      await screen.findByText(/Közben valaki más mentett/),
    ).toBeInTheDocument();
    const calls = api.versions.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Újratöltés" }));
    await waitFor(() => expect(api.versions.mock.calls.length).toBe(calls + 1));
  });

  it("az ATO kikerülése vagy az eredetijének változása figyelmeztet, de nem tilt", async () => {
    render(<AiGlossaryPage />);
    await screen.findByText("Aktív verzió: 3");
    expect(screen.queryByTestId("ato-figyelmeztetes")).toBeNull();
    fireEvent.change(
      within(row(1)).getByLabelText("1. sor eredeti kifejezése"),
      {
        target: { value: "Auto Top-Up" },
      },
    );
    expect(screen.getByTestId("ato-figyelmeztetes")).toHaveTextContent(
      /eredeti kifejezése változik/,
    );
    expect(
      screen.getByRole("button", { name: "Mentés új verzióként" }),
    ).toBeEnabled();
    fireEvent.change(
      within(row(1)).getByLabelText("1. sor eredeti kifejezése"),
      {
        target: { value: "Automatic Top Off" },
      },
    );
    expect(screen.queryByTestId("ato-figyelmeztetes")).toBeNull();
    fireEvent.click(
      within(row(1)).getByRole("button", { name: "Sor törlése" }),
    );
    expect(screen.getByTestId("ato-figyelmeztetes")).toHaveTextContent(
      /kikerül/,
    );
    expect(
      screen.getByRole("button", { name: "Mentés új verzióként" }),
    ).toBeEnabled();
  });

  it("az előzményből a RÉGI verzió a szerkesztőbe töltődik, nem ír; a megjegyzés előre kitöltve, és az aktív verzió változatlan sorai megtartják a jóváhagyót", async () => {
    render(<AiGlossaryPage />);
    await screen.findByText("Aktív verzió: 3");
    fireEvent.click(screen.getByRole("button", { name: /Előzmény/ }));
    const history = screen.getByTestId("szojegyzek-elozmeny");
    expect(within(history).getByText("3. verzió (aktív)")).toBeInTheDocument();
    expect(
      within(history).queryAllByRole("button", {
        name: "Betöltés szerkesztőbe",
      }),
    ).toHaveLength(1);
    fireEvent.click(
      within(history).getByRole("button", { name: "Betöltés szerkesztőbe" }),
    );
    await screen.findByText(/A\(z\) 1\. verzió tartalma van betöltve/);
    expect(api.save).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Megjegyzés a mentéshez")).toHaveValue(
      "Visszaállítás: 1. verzió",
    );
    // az ATO ugyanaz, mint az aktívban: megtartja a jóváhagyót; az ICP régi neve más: a mentő hagyja jóvá
    expect(approval(1)).toMatch(/^Jóváhagyta: Alapértelmezett/);
    expect(approval(2)).toBe("A mentéssel te hagyod jóvá");
    expect(screen.getAllByTestId(/^szojegyzek-sor-/)).toHaveLength(2);
    // a mentés az AKTÍV (3.) verzióból indul, és engedélyezett akkor is, ha a lista "nem változott" az aktív alakjához képest
    expect(
      screen.getByRole("button", { name: "Mentés új verzióként" }),
    ).toBeEnabled();
  });

  it("a beállítások joga nélkül nem tölt be, és az API-t nem hívja", async () => {
    auth.role = "WAREHOUSE";
    render(<AiGlossaryPage />);
    expect(
      await screen.findByText("Nincs hozzáférésed az AI szójegyzékéhez"),
    ).toBeInTheDocument();
    expect(api.versions).not.toHaveBeenCalled();
  });
});
