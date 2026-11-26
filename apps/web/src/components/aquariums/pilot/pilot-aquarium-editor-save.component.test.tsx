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

async function page() {
  render(createElement(PilotAquariumEditorPage, { aquariumId: "aq-1" }));
  await screen.findByDisplayValue("Nappali");
  await screen.findByRole("button", { name: /Nagy Béla/ });
}

const state = () => screen.getByTestId("aquarium-save-state").textContent;

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

    await waitFor(() => expect(state()).toBe("Mentve."));
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

    // the next save starts from the new updatedAt and sends nothing that is already saved
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
    await waitFor(() => expect(state()).toBe("Mentve."));
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
    await waitFor(() => expect(state()).toBe("Mentve."));
    expect(api.addEquipment).toHaveBeenCalledTimes(1);
    expect(api.update.mock.calls[1]![2]).toMatchObject({
      expectedUpdatedAt: "2026-11-26T08:01:30.000Z",
    });
  });

  it("a mentés után egy mező átírása leveszi a Mentve jelzést", async () => {
    await page();
    api.update.mockResolvedValue(detail());
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() => expect(state()).toBe("Mentve."));
    fireEvent.change(screen.getByDisplayValue("Nappali"), {
      target: { value: "Iroda" },
    });
    expect(state()).toMatch(/A Mentés az összes fenti adatot menti/);
  });
});
