import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@acropora/types";
import {
  ACROBOT_REPLY_POLL_MS,
  SutyerakWidget,
  SutyerakPanel,
  withAcrobotReplies,
} from "./sutyerak-widget";
import { AssistantPageProvider, useAssistantEntity } from "./page-context";
import { AssistantMarkdown } from "./markdown";
import { ApiError } from "@/lib/api/client";
const state = vi.hoisted(() => ({
  session: null as Session | null,
  pathname: "/szerviz/munkalapok/worksheet-1",
}));
const api = vi.hoisted(() => ({
  config: vi.fn(),
  ask: vi.fn(),
  handoffReplies: vi.fn(),
}));
vi.mock("../auth/auth-provider", () => ({
  useAuth: () => ({ session: state.session }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
}));
vi.mock("@/lib/api/assistant", () => ({ assistantApi: api }));
const employee: Session = {
  id: "user-session",
  token: "user-token",
  expiresAt: "2099-01-01T00:00:00Z",
  user: {
    id: "pilot",
    displayName: "Dolgozó",
    email: "pilot@example.invalid",
    role: "SERVICE",
    customerId: null,
    supplierId: null,
  },
};
function Detail() {
  useAssistantEntity("Munkalap", "worksheet-1", "2026/123");
  return null;
}
const fixture = () =>
  render(
    <AssistantPageProvider>
      <Detail />
      <SutyerakWidget />
    </AssistantPageProvider>,
  );
const figure = () =>
  screen.getByRole("button", { name: "Sutyerák megnyitása" });
const open = async () => {
  await waitFor(() => expect(figure()).toBeInTheDocument());
  fireEvent.click(figure());
};
const submit = () => {
  fireEvent.change(screen.getByLabelText("Kérdés Sutyeráknak"), {
    target: { value: "Mutasd meg!" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Kérdezek" }));
};
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  state.session = employee;
  state.pathname = "/szerviz/munkalapok/worksheet-1";
  api.config.mockResolvedValue({ enabled: true });
  api.handoffReplies.mockResolvedValue({ items: [] });
  api.ask.mockImplementation(async (_token, _input, emit) => {
    emit({ type: "thread", threadId: "thread-1", new: true });
    emit({ type: "text", delta: "Folyamatban" });
    emit({ type: "done", answer: "**Kész**", durationMs: 10, toolCalls: 1 });
  });
});
afterEach(() => vi.useRealTimers());

describe("Sutyerák widget calibration", () => {
  it("disabled / non-pilot config hides the widget, and partners never query it", async () => {
    api.config.mockResolvedValue({ enabled: false });
    const first = fixture();
    await waitFor(() => expect(api.config).toHaveBeenCalled());
    expect(
      screen.queryByRole("button", { name: "Sutyerák megnyitása" }),
    ).not.toBeInTheDocument();
    first.unmount();
    state.session = {
      ...employee,
      user: { ...employee.user, customerId: "customer-1" },
    };
    vi.clearAllMocks();
    fixture();
    expect(api.config).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Sutyerák megnyitása" }),
    ).not.toBeInTheDocument();
  });
  it("drag release does not open the panel; an actual click does", async () => {
    fixture();
    await waitFor(() => expect(figure()).toBeInTheDocument());
    const button = figure();
    const left = button.style.left;
    fireEvent.pointerDown(button, {
      button: 0,
      pointerId: 1,
      clientX: 20,
      clientY: 20,
    });
    fireEvent.pointerMove(button, {
      pointerId: 1,
      clientX: -100,
      clientY: -100,
    });
    fireEvent.pointerUp(button, { pointerId: 1 });
    fireEvent.click(button, { detail: 1 });
    expect(button.style.left).not.toBe(left);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(
      screen.getByRole("dialog", { name: "Sutyerák" }),
    ).toBeInTheDocument();
  });
  it("streams a response, stores the thread and sends actual page/entity context", async () => {
    fixture();
    await open();
    submit();
    await screen.findByText("Kész");
    expect(api.ask).toHaveBeenCalledWith(
      "user-token",
      expect.objectContaining({
        context: {
          page: "/szerviz/munkalapok/worksheet-1",
          entity: "Munkalap: 2026/123 (id: worksheet-1)",
        },
      }),
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(sessionStorage.getItem("sutyerak.thread.pilot")).toBe("thread-1");
    submit();
    await waitFor(() => expect(api.ask).toHaveBeenCalledTimes(2));
    expect(api.ask.mock.calls[1]![1].threadId).toBe("thread-1");
    expect(
      screen.getByText("Sutyerák csak olvas, és azt látja, amit te."),
    ).toBeInTheDocument();
  });
  it("does not send the previous entity while a new detail route is loading", async () => {
    const view = fixture();
    await open();
    state.pathname = "/szerviz/munkalapok/worksheet-2";
    view.rerender(
      <AssistantPageProvider>
        <Detail />
        <SutyerakWidget />
      </AssistantPageProvider>,
    );
    submit();
    await screen.findByText("Kész");
    expect(api.ask.mock.calls[0]![1].context).toEqual({ page: state.pathname });
  });
  it("a foreign thread 403 silently retries once without that thread", async () => {
    sessionStorage.setItem("sutyerak.thread.pilot", "foreign");
    api.ask.mockRejectedValueOnce(new ApiError("foreign", 403));
    fixture();
    await open();
    submit();
    await screen.findByText("Kész");
    expect(api.ask).toHaveBeenCalledTimes(2);
    expect(api.ask.mock.calls[0]![1].threadId).toBe("foreign");
    expect(api.ask.mock.calls[1]![1].threadId).toBeUndefined();
  });
  it("new conversation drops thread/history and aborts the active stream", async () => {
    let signal: AbortSignal | undefined;
    api.ask.mockImplementation((_token, _input, _emit, current) => {
      signal = current;
      return new Promise(() => {});
    });
    fixture();
    await open();
    submit();
    expect(screen.getByText("Sutyerák gondolkodik…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Új beszélgetés" }));
    expect(signal?.aborted).toBe(true);
    expect(sessionStorage.getItem("sutyerak.thread.pilot")).toBeNull();
    expect(screen.queryByText("Mutasd meg!")).not.toBeInTheDocument();
  });
  it("an error event shows stuck state and a readable Hungarian error", async () => {
    api.ask.mockImplementation(async (_token, _input, emit) =>
      emit({ type: "error", message: "Sutyerák most nem tud válaszolni." }),
    );
    fixture();
    await open();
    submit();
    await screen.findByRole("alert");
    expect(
      screen.getByTestId("sutyerak-figure").getAttribute("data-state"),
    ).toBe("stuck");
  });
  it("saved position is clamped after resize and history belongs only to this employee", async () => {
    localStorage.setItem(
      "sutyerak.position.pilot",
      JSON.stringify({ x: 9000, y: 9000 }),
    );
    sessionStorage.setItem(
      "sutyerak.history.other",
      JSON.stringify([{ question: "Idegen titok", answer: "Titok" }]),
    );
    fixture();
    await open();
    expect(screen.queryByText("Idegen titok")).not.toBeInTheDocument();
    Object.defineProperty(window, "innerWidth", {
      value: 320,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 480,
      configurable: true,
    });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(figure().style.width).toBe("192px");
    expect(screen.getByTestId("sutyerak-figure").style.width).toBe("192px");
    expect(Number.parseFloat(figure().style.left)).toBeLessThanOrEqual(
      320 - 192,
    );
    expect(Number.parseFloat(figure().style.top)).toBeLessThanOrEqual(
      480 - 192,
    );
    const panel = screen.getByRole("dialog");
    expect(
      Number.parseFloat(panel.style.left) +
        Number.parseFloat(panel.style.width),
    ).toBeLessThanOrEqual(320);
  });
  it("history survives remount, and Markdown has bold/list/table without injected HTML", async () => {
    const first = render(<SutyerakPanel session={employee} />);
    await open();
    submit();
    await screen.findByText("Kész");
    first.unmount();
    render(<SutyerakPanel session={employee} />);
    await open();
    expect(screen.getByText("Mutasd meg!")).toBeInTheDocument();
    const markup = render(
      <AssistantMarkdown
        text={
          "**Fontos**\n- Első\n| Név | Érték |\n| --- | --- |\n| A | 1 |\n<img src=x onerror=alert(1)>"
        }
      />,
    );
    expect(markup.container.querySelector("strong")?.textContent).toBe(
      "Fontos",
    );
    expect(markup.container.querySelector("li")?.textContent).toBe("Első");
    expect(markup.container.querySelector("table")).not.toBeNull();
    expect(markup.container.querySelector("img")).toBeNull();
  });
});

/*
  A FIGURA A WIDGET ÁLLAPOTÁT MUTATJA (kártya e0780477). MI PIROSÍT: puszta
  fókuszra jegyzetel; a gépelés vagy az IME nem indítja; a kérés alatt nem
  keres; az első nem üres szöveg nem váltja válaszra; a figura nem dekoratív
  (a képek megismétlik a gomb címkéjét); a bemutató gombjai az éles felületre
  kerülnek.
*/
describe("Sutyerák's figure follows the widget", () => {
  const body = () => screen.getByTestId("sutyerak-figure");
  const field = () => screen.getByLabelText("Kérdés Sutyeráknak");

  it("focus alone rests; typing, deleting and IME composition take notes", async () => {
    fixture();
    await open();
    fireEvent.focus(field());
    expect(body().getAttribute("data-state")).toBe("resting");
    fireEvent.change(field(), { target: { value: "M" } });
    expect(body().getAttribute("data-state")).toBe("takingNotes");
    fireEvent.blur(field());
    expect(body().getAttribute("data-state")).toBe("resting");
    fireEvent.change(field(), { target: { value: "" } });
    expect(body().getAttribute("data-state")).toBe("takingNotes");
    fireEvent.blur(field());
    fireEvent.compositionStart(field());
    expect(body().getAttribute("data-state")).toBe("takingNotes");
  });

  it("a request searches, and the first non-empty text answers", async () => {
    let emitText: ((delta: string) => void) | undefined;
    api.ask.mockImplementation(
      (_token, _input, emit) =>
        new Promise<void>(() => {
          emitText = (delta) => emit({ type: "text", delta });
        }),
    );
    fixture();
    await open();
    submit();
    expect(body().getAttribute("data-state")).toBe("searching");
    fireEvent.change(field(), { target: { value: "közben gépelek" } });
    expect(body().getAttribute("data-state")).toBe("searching");
    act(() => emitText!(" "));
    expect(body().getAttribute("data-state")).toBe("searching");
    act(() => emitText!("Folyamatban"));
    expect(body().getAttribute("data-state")).toBe("answering");
  });

  it("the figure is decorative, one pose at a time, from local layers, and no demo controls", async () => {
    fixture();
    await open();
    expect(body().getAttribute("aria-hidden")).toBe("true");
    const images = Array.from(body().querySelectorAll("img"));
    expect(images.every((img) => img.getAttribute("alt") === "")).toBe(true);
    expect(
      images.every((img) =>
        (img.getAttribute("src") ?? "").startsWith("/sutyerak/"),
      ),
    ).toBe(true);
    expect(
      body().querySelectorAll('[data-layer="valaszol-teljes"]'),
    ).toHaveLength(0);
    expect(
      screen.queryByRole("button", {
        name: /Keresés → válasz|Mozgás szüneteltetése|Sötét háttér/,
      }),
    ).toBeNull();
  });
});

/*
  ACROBOT VÁLASZA AZ ABLAKBAN (5830ee10, Balázs 2026-10-06 12:14 UTC). MI
  PIROSÍT: ha a válasz nem jelenik meg az ablakban; ha kétszer jelenik meg;
  ha csukott ablakban vagy beszélgetés nélkül kérdez; ha fél percnél ritkábban
  néz rá; ha a megjelölés hiányzik.
*/
describe("acrobot's answer in the window", () => {
  it("appends a reply once, whatever the order of the polls", () => {
    const first = withAcrobotReplies(
      [{ question: "Hol a 72555?", answer: "Nem tudom, továbbadtam." }],
      [{ id: "m1", text: "A polcon." }],
    );
    const again = withAcrobotReplies(first, [
      { id: "m1", text: "A polcon." },
      { id: "m2", text: "És a raktárban." },
    ]);
    expect(again.map((turn) => turn.acrobotId ?? turn.question)).toEqual([
      "Hol a 72555?",
      "m1",
      "m2",
    ]);
    expect(withAcrobotReplies(again, [{ id: "m2", text: "x" }])).toBe(again);
  });

  it("shows the reply marked as acrobot's when the window opens, and looks again every half minute", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    sessionStorage.setItem("sutyerak.thread.pilot", "thread-7");
    api.handoffReplies.mockResolvedValue({
      items: [
        {
          id: "m1",
          text: "A **polcon** van.",
          createdAt: "2026-10-06T12:20:00.000Z",
        },
      ],
    });
    fixture();
    await waitFor(() => expect(figure()).toBeInTheDocument());
    expect(api.handoffReplies).not.toHaveBeenCalled();
    fireEvent.click(figure());
    await waitFor(() =>
      expect(screen.getByText("Acrobot válasza")).toBeInTheDocument(),
    );
    expect(api.handoffReplies).toHaveBeenCalledWith(
      "user-token",
      "thread-7",
      expect.any(AbortSignal),
    );
    await act(async () => {
      vi.advanceTimersByTime(ACROBOT_REPLY_POLL_MS);
    });
    await waitFor(() => expect(api.handoffReplies).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText("Acrobot válasza")).toHaveLength(1);
    expect(ACROBOT_REPLY_POLL_MS).toBeLessThanOrEqual(30_000);
  });

  it("asks nothing without a conversation of its own", async () => {
    fixture();
    await open();
    await waitFor(() =>
      expect(screen.getByLabelText("Kérdés Sutyeráknak")).toBeInTheDocument(),
    );
    expect(api.handoffReplies).not.toHaveBeenCalled();
  });
});
