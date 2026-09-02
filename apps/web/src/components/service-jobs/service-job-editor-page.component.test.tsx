import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CustomerListResponse, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServiceJobEditorPage } from "./service-job-editor-page";

const api = vi.hoisted(() => ({ create: vi.fn() }));
const customers = vi.hoisted(() => ({ list: vi.fn() }));
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/service-jobs", () => ({ serviceJobsApi: api }));
vi.mock("@/lib/api/customers", () => ({ customersApi: customers }));

function sessionAs(role: Session["user"]["role"]): Session {
  return {
    id: "session-1",
    token: "token-1",
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: "user-sanyi",
      email: "sanyi@acropora.local",
      displayName: "Szerelő Sándor",
      nickname: "Sanyi",
      role,
      customerId: null,
      supplierId: null,
    },
  };
}

const customerList = {
  items: [
    {
      id: "vevo-1",
      customerNumber: "V-001",
      partnerCode: "FANK",
      source: "MANUAL",
      type: "COMPANY",
      displayName: "Fővárosi Állat- És Növénykert",
    },
  ],
  pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
} as unknown as CustomerListResponse;

describe("ServiceJobEditorPage", () => {
  beforeEach(() => {
    auth.session = sessionAs("SERVICE");
    api.create.mockReset().mockResolvedValue({
      id: "job-uj",
      jobNumber: "HJ-2026-009",
    });
    customers.list.mockReset().mockResolvedValue(customerList);
    navigation.push.mockReset();
  });

  /**
   * A PARTNER ELHAGYHATÓ, és ez a folyamat egyik rendes útja: a jegy egy már
   * meglévő lapból születik, aminek van partnere. Ha itt kötelező lenne, épp
   * azt az utat nehezítenénk, amit az owner leírt.
   */
  it("partner nélkül is megnyitja a jegyet, és a friss lapjára visz", async () => {
    render(<ServiceJobEditorPage />);

    fireEvent.change(screen.getByLabelText("Mi a baj?"), {
      target: { value: "A hármas medence szivattyúja nem indul" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Hibajegy megnyitása" }),
    );

    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create.mock.calls[0]?.[1]).toEqual({
      title: "A hármas medence szivattyúja nem indul",
      description: null,
      customerId: null,
    });
    // A LISTÁRA VISSZAVINNI ANNYI LENNE, mint a felhasználóra hagyni, hogy
    // megkeresse, amit épp létrehozott.
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith(
        "/szerviz/hibajegyek/job-uj",
      ),
    );
  });

  /**
   * A KÖVETKEZMÉNY OTT ÁLL A HIÁNY MELLETT. Egy "elhagyható" felirat önmagában
   * elhallgatná, hogy a partner nélküli jegy MA nem tud munkalapot fogadni - és
   * a felhasználó a csatolásnál futna bele, egy másik képernyőn.
   */
  it("kimondja, hogy partner nélkül nem lehet munkalapot csatolni", () => {
    render(<ServiceJobEditorPage />);

    expect(
      screen.getByText(
        /Partner nélkül a jegy megnyílik, de munkalapot csak azután lehet alá csatolni/,
      ),
    ).toBeTruthy();
  });

  /**
   * A VÁLASZTÓ KERES, NEM LISTÁZ, és két karakter alatt NEM kérdez rá: a
   * vevő-lista lapozott, egy oldal legfeljebb százat ad, tehát egy sima
   * legördülő csendben levágná a többit.
   */
  it("két karaktertől keres, előtte nem kérdezi le a listát", async () => {
    render(<ServiceJobEditorPage />);
    const mezo = screen.getByLabelText("Partner");

    fireEvent.change(mezo, { target: { value: "F" } });
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(customers.list).not.toHaveBeenCalled();

    fireEvent.change(mezo, { target: { value: "Fővárosi" } });
    await waitFor(() => expect(customers.list).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByRole("button", {
        name: "Fővárosi Állat- És Növénykert",
      }),
    ).toBeTruthy();
  });

  /**
   * A SZŰKÍTÉST MÉRŐ ÁLLÍTÁS: olvasó jognál a felvitel nem nyílik meg.
   */
  it("olvasó jognál nem enged hibajegyet nyitni", () => {
    auth.session = sessionAs("VIEWER");
    render(<ServiceJobEditorPage />);

    expect(
      screen.getByText("Nincs jogosultságod hibajegyet nyitni"),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Mi a baj?")).toBeNull();
  });
});
