import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  AquariumDetail,
  AquariumEquipment,
  AquariumMaintainer,
  Session,
} from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";
import { PilotAquariumEditorPage } from "./pilot-aquarium-editor-page";

/**
 * AZ AKVÁRIUM ADATLAPJÁN EGY MENTÉS VAN (picasso leltár 3.22, acrobot döntése 2026-11-26). Kitalált adat. MI PIROSÍT: a karbantartó-
 * pill vagy a berendezés felvétele, törlése kattintásra a szerverre megy (a régi, második mentési modell); a Mentés nem viszi el őket,
 * vagy nem az akvárium mezői mennek elsőként (az ütközés-ellenőrzés); egy félúton elakadt mentés után a következő Mentés egy már
 * felvitt sort újra felvisz; a lap nem mondja ki, mi vár mentésre.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
const api = vi.hoisted(() => ({
  detail: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  addEquipment: vi.fn(),
  removeEquipment: vi.fn(),
  setMaintainers: vi.fn(),
  selectableMaintainers: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => "/akvariumok/aq-1",
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/aquariums", () => ({ aquariumsApi: api }));
vi.mock("@/lib/api/worksheets", () => ({
  worksheetsApi: { departments: vi.fn().mockResolvedValue({ items: [] }) },
}));
// the water values card reads measurements on its own: not this test's subject
vi.mock("./pilot-aquarium-water-values", () => ({
  PilotAquariumWaterValues: () => null,
}));

const anna: AquariumMaintainer = { userId: "u-anna", displayName: "Kiss Anna" };
const bela: AquariumMaintainer = { userId: "u-bela", displayName: "Nagy Béla" };
const lamp: AquariumEquipment = {
  id: "eq-1",
  kind: "VILAGITAS",
  manufacturer: "Minta",
  quantity: 1,
};

function detail(over: Partial<AquariumDetail> = {}): AquariumDetail {
  return {
    id: "aq-1",
    aquariumNumber: "AK-0001",
    name: "Nappali",
    ownershipType: "OWN",
    waterBodyType: "AKVARIUM",
    systemVolumeIsManual: false,
    equipment: [lamp],
    maintainers: [anna],
    targets: [],
    updatedAt: "2026-11-26T08:00:00.000Z",
    ...over,
  } as AquariumDetail;
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  navigation.push.mockReset();
  auth.session = {
    id: "s-1",
    token: "t",
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: "u-1",
      email: "o@example.test",
      displayName: "Tulaj",
      role: "OWNER",
      customerId: null,
      supplierId: null,
    },
  } as Session;
  api.detail.mockResolvedValue(detail());
  api.selectableMaintainers.mockResolvedValue([anna, bela]);
});

// an existing aquarium opens read (Picasso 3.22): the form is behind "Szerkesztés"
async function page() {
  render(createElement(PilotAquariumEditorPage, { aquariumId: "aq-1" }));
  fireEvent.click(await screen.findByRole("button", { name: "Szerkesztés" }));
  await screen.findByDisplayValue("Nappali");
  await screen.findByRole("button", { name: /Nagy Béla/ });
}

const state = () => screen.getByTestId("aquarium-save-state").textContent;

// Picasso 3.28 (acrobot 62633): Tulajdon is the segmented switch, and the chosen one is said (aria-pressed)
describe("akvárium: a Tulajdon kapcsoló", () => {
  it("egy választás nyomott, a másikra kattintva az lesz", async () => {
    await page();
    const own = screen.getByRole("button", { name: "Saját" });
    const customer = screen.getByRole("button", { name: "Ügyfél" });
    const pressed = [own, customer].filter(
      (button) => button.getAttribute("aria-pressed") === "true",
    );
    expect(pressed).toHaveLength(1);
    const other = pressed[0] === own ? customer : own;
    fireEvent.click(other);
    expect(other).toHaveAttribute("aria-pressed", "true");
    expect(pressed[0]).toHaveAttribute("aria-pressed", "false");
  });
});

describe("akvárium adatlap: egy mentés", () => {
  it("a karbantartó és a berendezés a lapon vár, a szerverre csak a Mentés viszi", async () => {
    await page();
    expect(state()).toMatch(/A Mentés az összes fenti adatot menti/);

    fireEvent.click(screen.getByRole("button", { name: /Nagy Béla/ }));
    fireEvent.click(
      screen.getByRole("button", { name: /Berendezés hozzáadása/ }),
    );
    expect(api.setMaintainers).not.toHaveBeenCalled();
    expect(api.addEquipment).not.toHaveBeenCalled();
    expect(state()).toBe(
      "Mentésre vár: a berendezések és a karbantartók. A Mentés a fenti adatokkal együtt viszi.",
    );

    const calls: string[] = [];
    api.update.mockImplementation(
      async () => (
        calls.push("update"),
        detail({ updatedAt: "2026-11-26T08:01:00.000Z" })
      ),
    );
    api.addEquipment.mockImplementation(
      async () => (
        calls.push("add"),
        detail({ equipment: [lamp, { ...lamp, id: "eq-2" }] })
      ),
    );
    api.setMaintainers.mockImplementation(
      async () => (
        calls.push("maintainers"),
        detail({
          equipment: [lamp, { ...lamp, id: "eq-2" }],
          maintainers: [anna, bela],
          updatedAt: "2026-11-26T08:02:00.000Z",
        })
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));

    expect(await screen.findByText("Mentve.")).toBeTruthy();
    expect(calls).toEqual(["update", "add", "maintainers"]);
    expect(api.update.mock.calls[0]![2]).toMatchObject({
      name: "Nappali",
      expectedUpdatedAt: "2026-11-26T08:00:00.000Z",
    });
    expect(api.setMaintainers).toHaveBeenCalledWith("t", "aq-1", [
      "u-anna",
      "u-bela",
    ]);
    expect(api.addEquipment.mock.calls[0]![2]).not.toHaveProperty("id");
    expect(navigation.push).not.toHaveBeenCalled();

    // the next save (the form opened again) starts from the new updatedAt and sends nothing that is already saved
    fireEvent.click(screen.getByRole("button", { name: "Szerkesztés" }));
    await screen.findByDisplayValue("Nappali");
    api.update.mockResolvedValue(
      detail({
        equipment: [lamp, { ...lamp, id: "eq-2" }],
        maintainers: [anna, bela],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(2));
    expect(api.update.mock.calls[1]![2]).toMatchObject({
      expectedUpdatedAt: "2026-11-26T08:02:00.000Z",
    });
    expect(api.addEquipment).toHaveBeenCalledTimes(1);
    expect(api.setMaintainers).toHaveBeenCalledTimes(1);
  });

  it("a törölt berendezés a Mentéssel törlődik, előtte nem", async () => {
    await page();
    fireEvent.click(
      screen.getByRole("button", { name: "Világítás · Minta: törlés" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Törlés" }));
    expect(api.removeEquipment).not.toHaveBeenCalled();
    expect(screen.getByText("Nincs felvitt berendezés.")).toBeInTheDocument();
    expect(state()).toMatch(/^Mentésre vár: a berendezések\./);

    api.update.mockResolvedValue(detail());
    api.removeEquipment.mockResolvedValue(detail({ equipment: [] }));
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(await screen.findByText("Mentve.")).toBeTruthy();
    expect(api.removeEquipment).toHaveBeenCalledWith("t", "aq-1", "eq-1");
  });

  it("félúton elakadt mentés: ami lement, nem megy újra, a többi vár", async () => {
    await page();
    fireEvent.click(
      screen.getByRole("button", { name: /Berendezés hozzáadása/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Nagy Béla/ }));
    api.update.mockResolvedValue(
      detail({ updatedAt: "2026-11-26T08:01:00.000Z" }),
    );
    api.addEquipment.mockResolvedValue(
      detail({
        equipment: [lamp, { ...lamp, id: "eq-2" }],
        updatedAt: "2026-11-26T08:01:30.000Z",
      }),
    );
    api.setMaintainers.mockRejectedValueOnce(
      new ApiError("A kolléga nem választható.", 400),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));

    expect(
      await screen.findByText(
        /A mentés félúton elakadt: A kolléga nem választható\./,
      ),
    ).toBeInTheDocument();
    expect(state()).toBe(
      "Mentésre vár: a karbantartók. A Mentés a fenti adatokkal együtt viszi.",
    );

    api.update.mockResolvedValue(
      detail({ equipment: [lamp, { ...lamp, id: "eq-2" }] }),
    );
    api.setMaintainers.mockResolvedValue(
      detail({
        equipment: [lamp, { ...lamp, id: "eq-2" }],
        maintainers: [anna, bela],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(await screen.findByText("Mentve.")).toBeTruthy();
    expect(api.addEquipment).toHaveBeenCalledTimes(1);
    expect(api.update.mock.calls[1]![2]).toMatchObject({
      expectedUpdatedAt: "2026-11-26T08:01:30.000Z",
    });
  });

  it("a sikeres Mentés után az adatlap olvasva áll és kimondja; a Szerkesztés újra az űrlapot nyitja, a jelzés nélkül", async () => {
    await page();
    api.update.mockResolvedValue(detail({ name: "Iroda" }));
    fireEvent.change(screen.getByDisplayValue("Nappali"), {
      target: { value: "Iroda" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(await screen.findByText("Mentve.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mentés" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Iroda");
    fireEvent.click(screen.getByRole("button", { name: "Szerkesztés" }));
    expect(await screen.findByDisplayValue("Iroda")).toBeTruthy();
    expect(screen.queryByText("Mentve.")).toBeNull();
  });
});

/**
 * OLVASVA NYÍLIK (Picasso 3.22). Eddig a meglévő akvárium szerkesztő űrlapként nyílt, tengerinél tizennégy üres céltartomány-mezővel.
 * MI PIROSÍT: a meglévő akvárium űrlappal nyílik; az olvasó nézet a beállítatlan céltartományokat is sorolja, vagy a beállítottat
 * nem; a "Mégse" a lapon álló módosítást a szerverre viszi vagy megtartja; az új akvárium nem űrlappal nyílik.
 */
describe("akvárium adatlap: olvasva nyílik, a szerkesztés a Szerkesztés gombra", () => {
  it("a meglévő akvárium olvasva nyílik: nincs beviteli mező, csak a beállított céltartomány látszik", async () => {
    api.detail.mockResolvedValue(
      detail({
        waterType: "TENGERI",
        notes: "Nappali sarok",
        targets: [{ parameterCode: "KH", min: 7, max: 9 }],
      }),
    );
    render(createElement(PilotAquariumEditorPage, { aquariumId: "aq-1" }));
    expect(
      await screen.findByRole("button", { name: "Szerkesztés" }),
    ).toBeTruthy();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Mentés" })).toBeNull();
    expect(screen.getByText("Nappali sarok")).toBeTruthy();
    expect(screen.getByText("Kiss Anna")).toBeTruthy();
    // one set range, as a line; not fourteen empty fields
    expect(screen.getByText(/7 – 9/)).toBeTruthy();
    expect(screen.queryAllByPlaceholderText("Tól")).toHaveLength(0);
    expect(api.update).not.toHaveBeenCalled();
  });

  it("céltartomány nélkül kimondja, hol adható meg", async () => {
    render(createElement(PilotAquariumEditorPage, { aquariumId: "aq-1" }));
    expect(
      await screen.findByText(
        "Nincs saját céltartomány beállítva; a Szerkesztésben adható meg.",
      ),
    ).toBeTruthy();
  });

  it("a Mégse elveti a lapon álló módosítást, a szerverre semmi nem megy", async () => {
    await page();
    fireEvent.change(screen.getByDisplayValue("Nappali"), {
      target: { value: "Iroda" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mégse" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Nappali",
    );
    fireEvent.click(screen.getByRole("button", { name: "Szerkesztés" }));
    expect(await screen.findByDisplayValue("Nappali")).toBeTruthy();
    expect(api.update).not.toHaveBeenCalled();
  });

  it("az új akvárium egyből űrlap, Szerkesztés gomb nélkül", async () => {
    render(createElement(PilotAquariumEditorPage, {}));
    expect(
      await screen.findByRole("button", { name: "Létrehozás" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Szerkesztés" })).toBeNull();
    expect(api.detail).not.toHaveBeenCalled();
  });
});

// acrobot 63508 (a #2950 elve): a hiányzó gyártó nem kötőjelként áll a Berendezések sorában, sem olvasva, sem a Szerkesztés után
describe("akvárium adatlap: a berendezés sora a hiányzó gyártóval", () => {
  const noMaker: AquariumEquipment = {
    id: "eq-2",
    kind: "VILAGITAS",
    manufacturer: null,
    model: "T5",
    quantity: 1,
  } as AquariumEquipment;
  const rowText = (view: HTMLElement) =>
    [...view.querySelectorAll("span")]
      .map((node) => node.textContent?.trim() ?? "")
      .filter((text) => text.includes("T5"));

  it("olvasva: „T5”, nem „— · T5”", async () => {
    api.detail.mockResolvedValue(detail({ equipment: [noMaker] }));
    const { container } = render(
      createElement(PilotAquariumEditorPage, { aquariumId: "aq-1" }),
    );
    await screen.findByRole("button", { name: "Szerkesztés" });
    expect(rowText(container)).toEqual(["T5"]);
    expect(container.textContent).not.toContain("— · T5");
  });

  it("a Szerkesztés után is: „T5”, nem „— · T5”", async () => {
    api.detail.mockResolvedValue(detail({ equipment: [noMaker] }));
    const { container } = render(
      createElement(PilotAquariumEditorPage, { aquariumId: "aq-1" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Szerkesztés" }));
    await screen.findByDisplayValue("Nappali");
    expect(rowText(container)).toEqual(["T5"]);
    expect(container.textContent).not.toContain("— · T5");
  });

  it("a kitöltött gyártó és típus ` · ` jellel áll", async () => {
    api.detail.mockResolvedValue(
      detail({ equipment: [{ ...noMaker, manufacturer: "Minta" }] }),
    );
    const { container } = render(
      createElement(PilotAquariumEditorPage, { aquariumId: "aq-1" }),
    );
    await screen.findByRole("button", { name: "Szerkesztés" });
    expect(container.textContent).toContain("Minta · T5");
  });
});
