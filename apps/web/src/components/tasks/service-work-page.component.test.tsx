import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  MyServiceWorkItem,
  MyServiceWorkResponse,
  Session,
} from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MyTasksPage } from "./my-tasks-page";

/*
  A FELADATAIM A SZERVIZES SZEMSZÖGÉBŐL (kártya 041a3dd5; Balázs „2.”,
  tervrajz: picasso-feladataim-2-allapot). MI PIROSÍT:
  - a szervizes a flotta-táblát kapja, vagy más a szervizes lapot;
  - a szervizes lapon van „Új feladat”;
  - a két csoport nem a szerver csoportjait mutatja, vagy a darabszám rossz;
  - a lejárt tétel nem a saját helyén kap piros sort, vagy más is kap;
  - a következő lépés nem mondja meg, miért áll ott a tétel;
  - a Lezárt nem a lezárt nézetet kéri, vagy a tétel nem az adatlapjára visz.
*/
const auth = vi.hoisted(() => ({ session: null as Session | null }));
const api = vi.hoisted(() => ({
  serviceWork: vi.fn(),
  listMine: vi.fn(),
  assignees: vi.fn(),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/tasks", () => ({ tasksApi: api }));

const session = (role: string): Session => ({
  id: "s1",
  token: "t1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "u1",
    email: "u1@example.invalid",
    displayName: "Szerelő",
    role: role as Session["user"]["role"],
    customerId: null,
    supplierId: null,
  },
});

const item = (over: Partial<MyServiceWorkItem>): MyServiceWorkItem => ({
  kind: "SERVICE_JOB",
  id: "j1",
  number: "HJ-2026-0141",
  status: "TRIAGED",
  title: "Szivattyú",
  partnerName: "Fánk",
  unitName: "Biodóm",
  scheduledAt: null,
  overdueSince: null,
  sentForSignature: false,
  bucket: "MINE",
  createdAt: "2026-09-01T08:00:00.000Z",
  ...over,
});

const open: MyServiceWorkResponse = {
  view: "OPEN",
  mine: [
    item({
      kind: "WORKSHEET",
      id: "w1",
      number: "M-2026-0871",
      status: "COMPLETED",
      overdueSince: null,
    }),
    item({
      id: "j-lejart",
      number: "HJ-2026-0120",
      status: "SCHEDULED",
      scheduledAt: "2026-08-31T07:00:00.000Z",
      overdueSince: "2026-08-31T07:00:00.000Z",
    }),
  ],
  others: [
    item({
      id: "j2",
      number: "HJ-2026-0133",
      status: "WAITING_FOR_PARTS",
      bucket: "OTHERS",
    }),
    item({
      kind: "WORKSHEET",
      id: "w2",
      number: "M-2026-0900",
      status: "COMPLETED",
      sentForSignature: true,
      bucket: "OTHERS",
    }),
  ],
  closed: [],
  openCount: 4,
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.serviceWork.mockResolvedValue(open);
  api.listMine.mockResolvedValue({
    items: [],
    openCount: 0,
    doneCount: 0,
    truncated: false,
  });
  api.assignees.mockResolvedValue({ items: [] });
});
afterEach(() => cleanup());

describe("Feladataim by role", () => {
  it("a service technician gets the service view, without „Új feladat”", async () => {
    auth.session = session("SERVICE");
    render(<MyTasksPage />);
    await screen.findByTestId("group-mine");
    expect(api.serviceWork).toHaveBeenCalledWith(
      "t1",
      "OPEN",
      expect.anything(),
    );
    expect(api.listMine).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Új feladat" })).toBeNull();
  });

  it("everyone else keeps the fleet and manual task board", async () => {
    auth.session = session("OWNER");
    render(<MyTasksPage />);
    await waitFor(() => expect(api.listMine).toHaveBeenCalled());
    expect(api.serviceWork).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Új feladat" })).toBeTruthy();
  });
});

describe("the service view", () => {
  beforeEach(() => {
    auth.session = session("SERVICE");
  });

  it("shows the server's two groups with their counts, and the open count", async () => {
    render(<MyTasksPage />);
    const mine = await screen.findByTestId("group-mine");
    const others = screen.getByTestId("group-others");
    expect(within(mine).getByText("Rajtad múlik · 2 tétel")).toBeTruthy();
    expect(within(others).getByText("Máson múlik · 2 tétel")).toBeTruthy();
    expect(within(mine).getByText("M-2026-0871")).toBeTruthy();
    expect(within(others).getByText("HJ-2026-0133")).toBeTruthy();
    expect(screen.getByText("4 nyitott")).toBeTruthy();
  });

  it("an overdue item gets its red line in its own card; the others do not", async () => {
    render(<MyTasksPage />);
    const late = await screen.findByTestId("work-SERVICE_JOB-j-lejart");
    expect(within(late).getByText("Lejárt: 08. 31.")).toBeTruthy();
    const sheet = screen.getByTestId("work-WORKSHEET-w1");
    expect(within(sheet).queryByText(/Lejárt/)).toBeNull();
    expect(screen.getAllByText(/^Lejárt:/)).toHaveLength(1);
  });

  it("the next step says why it stands there: a signature on site, or the buyer signing", async () => {
    render(<MyTasksPage />);
    const onSite = await screen.findByTestId("work-WORKSHEET-w1");
    const sent = screen.getByTestId("work-WORKSHEET-w2");
    const parts = screen.getByTestId("work-SERVICE_JOB-j2");
    expect(
      within(onSite).getByText("Fánk · Biodóm · aláírás rögzítése"),
    ).toBeTruthy();
    expect(
      within(sent).getByText("Fánk · Biodóm · aláírásra vár a vevőnél"),
    ).toBeTruthy();
    expect(
      within(parts).getByText("Fánk · Biodóm · alkatrész beérkezésére vár"),
    ).toBeTruthy();
  });

  it("each item leads to its own page", async () => {
    render(<MyTasksPage />);
    expect(
      (await screen.findByTestId("work-WORKSHEET-w1")).getAttribute("href"),
    ).toBe("/szerviz/munkalapok/w1");
    expect(screen.getByTestId("work-SERVICE_JOB-j2").getAttribute("href")).toBe(
      "/szerviz/hibajegyek/j2",
    );
  });

  it("„Lezárt” asks for the closed view and shows only the closed list", async () => {
    render(<MyTasksPage />);
    await screen.findByTestId("group-mine");
    api.serviceWork.mockResolvedValueOnce({
      view: "CLOSED",
      mine: [],
      others: [],
      closed: [
        item({
          id: "kesz",
          number: "HJ-2026-0001",
          status: "COMPLETED",
          bucket: "CLOSED",
        }),
      ],
      openCount: 4,
    } satisfies MyServiceWorkResponse);
    fireEvent.click(screen.getByRole("button", { name: "Lezárt" }));
    await screen.findByTestId("group-closed");
    expect(api.serviceWork).toHaveBeenLastCalledWith(
      "t1",
      "CLOSED",
      expect.anything(),
    );
    expect(screen.queryByTestId("group-mine")).toBeNull();
    expect(screen.getByText("HJ-2026-0001")).toBeTruthy();
  });
});
