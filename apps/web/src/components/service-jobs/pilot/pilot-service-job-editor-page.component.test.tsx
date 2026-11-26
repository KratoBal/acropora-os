import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PilotServiceJobEditorPage } from "./pilot-service-job-editor-page";

/**
 * AZ ÚJ HIBAJEGY ŰRLAP A KÖZÖS VÁZON (picasso leltár 3.7, acrobot 2026-11-25). Az űrlapnak eddig nem volt tesztje: ez egyszerre rögzíti az ÚJ
 * szerkezetet (csoport-címek és sorrend, kötelező és nem kötelező jelölés, "Hiányzik: ..." összesítő, halvány mentés gomb, hiba a mezőnél) és a
 * RÉGI viselkedést, amihez nem nyúlunk (a kötelezőségi szabály: partner, helyszín, cím; a létrehozás hívása és az utána következő útvonal).
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const jobs = vi.hoisted(() => ({ create: vi.fn(), uploadDocument: vi.fn() }));
const worksheets = vi.hoisted(() => ({
  departments: vi.fn(),
  assignableUsers: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/service-jobs", () => ({ serviceJobsApi: jobs }));
vi.mock("@/lib/api/worksheets", () => ({ worksheetsApi: worksheets }));
// the partner search is its own widget with its own tests: a stub that picks one partner
vi.mock("../partner-picker", () => ({
  PartnerPicker: ({
    id,
    onPick,
  }: {
    id: string;
    onPick: (partner: {
      customerId: string;
      name: string;
      partnerCode: string;
    }) => void;
  }) => (
    <button
      id={id}
      type="button"
      onClick={() =>
        onPick({
          customerId: "customer-1",
          name: "Fankó Kft.",
          partnerCode: "FANK",
        })
      }
    >
      Partner kiválasztása
    </button>
  ),
}));
vi.mock("../job-asset-picker", () => ({
  JobAssetPicker: ({
    departmentId,
    onChange,
  }: {
    departmentId: string;
    onChange: (ids: string[]) => void;
  }) => (
    <button
      type="button"
      data-department={departmentId}
      onClick={() => onChange(["asset-1"])}
    >
      Eszköz kiválasztása
    </button>
  ),
}));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-1",
    email: "iroda@acropora.local",
    displayName: "Iroda",
    nickname: null,
    role: "ADMIN",
    customerId: null,
    supplierId: null,
  },
};

const SAVE = () => screen.getByRole("button", { name: "Hibajegy megnyitása" });

beforeEach(() => {
  auth.session = session;
  navigation.push.mockReset();
  jobs.create
    .mockReset()
    .mockResolvedValue({ id: "job-1", jobNumber: "HJ-2026-0001" });
  jobs.uploadDocument.mockReset().mockResolvedValue(undefined);
  worksheets.departments.mockReset().mockResolvedValue({
    items: [
      {
        id: "dep-1",
        parentId: null,
        code: "GEP",
        name: "Gépház",
        isActive: true,
        path: ["Gépház"],
      },
    ],
  });
  worksheets.assignableUsers.mockReset().mockResolvedValue({
    items: [{ id: "user-2", name: "Szerelő Sándor", role: "SERVICE" }],
  });
});

describe("az új hibajegy űrlap szerkezete", () => {
  it("a csoportok kérdés-című kártyák, ebben a sorrendben: Kinek és hol? / Mi a munka? / Ki felel érte?", () => {
    render(<PilotServiceJobEditorPage />);
    const titles = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent)
      // the aside card also has an h2: the groups are the ones before it
      .filter((text) => text !== "Mi történik ezután");
    expect(titles).toEqual(["Kinek és hol?", "Mi a munka?", "Ki felel érte?"]);
  });

  // Picasso 3.7: a dependent field is a disabled field saying what it waits for, the why under it in the help style
  it("a függő mező kikapcsolt mező, ami kimondja, mire vár; az oka a súgó stílusában alatta", () => {
    render(<PilotServiceJobEditorPage />);
    expect(screen.getByLabelText(/^Helyszín/)).toBeDisabled();
    expect(
      screen.getByRole("option", { name: "Előbb válassz partnert" }),
    ).toBeTruthy();
    expect(
      screen.getByText("A helyszínek a partner saját fájából jönnek.")
        .className,
    ).toBe("text-xs text-pilot-grey-400");
    // the asset field waits for the location the same way
    const assetWaiting = screen.getByRole("option", {
      name: "Előbb válassz helyszínt",
    });
    expect(assetWaiting.closest("select")).toBeDisabled();
  });

  it("a kötelező mezők csillagosak, a többi '(nem kötelező)' (a két jel egy szabály)", () => {
    render(<PilotServiceJobEditorPage />);
    for (const name of ["Partner", "Helyszín", "Mi a baj?"]) {
      const label = screen.getByText(name, { selector: "label" });
      expect(label.textContent, name).toContain("*");
      expect(label.textContent, name).not.toContain("(nem kötelező)");
    }
    for (const name of ["Eszköz", "Részletek", "Fotók", "Felelős"]) {
      const label = screen.getByText(name, { selector: "label" });
      expect(label.textContent, name).toContain("(nem kötelező)");
      expect(label.textContent, name).not.toContain("*");
    }
    expect(screen.getAllByText("(nem kötelező)")).toHaveLength(4);
  });

  it("az összesítő a gombsorban, egy alakban; a mentés halvány", () => {
    render(<PilotServiceJobEditorPage />);
    expect(screen.getByRole("status").textContent).toBe(
      "Hiányzik: Partner, Helyszín, Mi a baj?",
    );
    expect(SAVE().getAttribute("aria-disabled")).toBe("true");
  });

  it("a Mi történik ezután szöveg ott van (oldalkártya és sima mondat)", () => {
    render(<PilotServiceJobEditorPage />);
    expect(
      screen.getAllByText(/Mentés után megnyílik az új hibajegy adatlapja/),
    ).toHaveLength(2);
  });
});

describe("az új hibajegy űrlap viselkedése (a régi szabályok)", () => {
  it("halvány mentésre kattintva a hibák a mezőknél jelennek meg, a hívás nem megy el", () => {
    render(<PilotServiceJobEditorPage />);
    // no errors before the first attempt
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(SAVE());
    expect(
      screen.getAllByRole("alert").map((alert) => alert.textContent),
    ).toEqual([
      "Válassz partnert.",
      "Válassz helyszínt.",
      "Írd le röviden, mi a baj.",
    ]);
    expect(jobs.create).not.toHaveBeenCalled();
  });

  it("a kitöltött űrlap a régi adatokkal hív, és az adatlapra visz", async () => {
    render(<PilotServiceJobEditorPage />);
    fireEvent.click(screen.getByRole("button", { name: "Partner (kötelező)" }));
    fireEvent.change(
      await screen.findByLabelText(/Helyszín/, { selector: "select" }),
      {
        target: { value: "dep-1" },
      },
    );
    fireEvent.change(screen.getByLabelText(/Mi a baj\?/), {
      target: { value: "Nem indul a szivattyú" },
    });
    fireEvent.change(screen.getByLabelText(/Részletek/), {
      target: { value: "Zúg, aztán leáll." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Eszköz kiválasztása" }),
    );
    fireEvent.click(await screen.findByLabelText("Szerelő Sándor"));
    // all required fields are there: no summary, not dimmed
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(SAVE().getAttribute("aria-disabled")).toBe("false");
    fireEvent.click(SAVE());
    await waitFor(() => expect(jobs.create).toHaveBeenCalledTimes(1));
    expect(jobs.create).toHaveBeenCalledWith("token-1", {
      title: "Nem indul a szivattyú",
      description: "Zúg, aztán leáll.",
      customerId: "customer-1",
      departmentId: "dep-1",
      assetIds: ["asset-1"],
      assigneeIds: ["user-2"],
    });
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith("/szerviz/hibajegyek/job-1"),
    );
  });

  it("a jogosultság nélkül nincs űrlap", () => {
    auth.session = {
      ...session,
      user: { ...session.user, role: "VIEWER" },
    };
    render(<PilotServiceJobEditorPage />);
    expect(
      screen.getByText("Nincs jogosultságod hibajegyet nyitni"),
    ).toBeTruthy();
    expect(within(document.body).queryByText("Kinek és hol?")).toBeNull();
  });
});
