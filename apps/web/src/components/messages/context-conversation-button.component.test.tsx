import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Session } from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  session: null as Session | null,
  enabled: true,
}));
const nav = vi.hoisted(() => ({ push: vi.fn() }));
const api = vi.hoisted(() => ({
  openContext: vi.fn(),
  openPartnerContext: vi.fn(),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("./message-stream", () => ({ useMessagesEnabled: () => auth.enabled }));
vi.mock("@/lib/api/messages", () => ({ messagesApi: api }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push }) }));
// the pilot UI loads its font through next/font, which needs the Next compiler
vi.mock("next/font/local", () => ({
  default: () => ({ className: "", style: {} }),
}));

import { ContextConversationButton } from "./context-conversation-button";

/*
  „BESZÉLGETÉS” A MUNKALAPON ÉS A HIBAJEGYEN. Ami pirosít: a gomb Üzenetek-jog
  nélkül is látszik; nem a tárgy fajtáját és azonosítóját kéri; nem a
  megnyitott beszélgetésre visz; a szerver magyar elutasítása nem látszik.
*/
const session = {
  id: "s1",
  token: "t1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "me",
    email: "me@x.invalid",
    displayName: "Balázs",
    role: "OWNER",
    customerId: null,
    supplierId: null,
  },
} as Session;

beforeEach(() => {
  auth.session = session;
  auth.enabled = true;
  nav.push.mockReset();
  api.openContext.mockReset();
  api.openPartnerContext.mockReset();
});
afterEach(() => cleanup());

describe("ContextConversationButton", () => {
  it("opens the object's conversation and goes to it", async () => {
    api.openContext.mockResolvedValue({ id: "c 7" });
    render(<ContextConversationButton kind="service-job" objectId="job1" />);
    fireEvent.click(screen.getByRole("button", { name: "Beszélgetés" }));
    await waitFor(() =>
      expect(nav.push).toHaveBeenCalledWith("/uzenetek?c=c%207"),
    );
    expect(api.openContext).toHaveBeenCalledWith("t1", "service-job", "job1");
  });

  it("without the Üzenetek right there is no button", () => {
    auth.enabled = false;
    render(<ContextConversationButton kind="worksheet" objectId="ws1" />);
    expect(screen.queryByRole("button", { name: "Beszélgetés" })).toBeNull();
  });

  it("a refusal is shown in the server's words, and nothing opens", async () => {
    api.openContext.mockRejectedValue(
      new Error("Ehhez nincs jogod: a szervizt nem látod."),
    );
    render(<ContextConversationButton kind="worksheet" objectId="ws1" />);
    fireEvent.click(screen.getByRole("button", { name: "Beszélgetés" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Ehhez nincs jogod: a szervizt nem látod.",
    );
    expect(nav.push).not.toHaveBeenCalled();
  });
});

/*
  „BESZÉLGETÉS A PARTNERREL” A HIBAJEGYEN (bd46ff05). MI PIROSÍT: ha a belső
  beszélgetést nyitja a partneres helyett; ha a felirat nem különbözteti meg.
*/
describe("ContextConversationButton, the partner one", () => {
  it("opens the job's partner conversation, not the internal one", async () => {
    api.openPartnerContext.mockResolvedValue({ id: "p1" });
    render(
      <ContextConversationButton kind="service-job" objectId="job-1" partner />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Beszélgetés a partnerrel" }),
    );
    await waitFor(() =>
      expect(nav.push).toHaveBeenCalledWith("/uzenetek?c=p1"),
    );
    expect(api.openPartnerContext).toHaveBeenCalledWith("t1", "job-1");
    expect(api.openContext).not.toHaveBeenCalled();
  });
});
