import { readFileSync } from "node:fs";
import { join } from "node:path";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ReefClubCodePanel,
  codeBlocker,
  formatExpiry,
} from "./reefclub-code-panel";

const aquariums = vi.hoisted(() => ({ issueReefClubCode: vi.fn() }));
const customers = vi.hoisted(() => ({ detail: vi.fn() }));
vi.mock("@/lib/api/aquariums", () => ({ aquariumsApi: aquariums }));
vi.mock("@/lib/api/customers", () => ({ customersApi: customers }));
// a panel a pilot-ui gombjait használja (Inter, `next/font/local`)
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

/**
 * "REEFCLUB-KÓD KIADÁSA" A VEVŐ AKVÁRIUMÁNÁL. Kitalált adat. MI PIROSÍT: a kód egy cég
 * vevőnek vagy e-mail cím nélküli vevőnek kiadható gombbal; a kód nem látszik, vagy nem
 * másolható; a lejárat hiányzik; a szerver elutasítása elnyelődik; az e-mailes kérés
 * nem a kérésen megadott `sendEmail`-lel megy.
 */
const person = {
  id: "c-1",
  type: "PERSON",
  displayName: "Minta Vevő",
  email: "minta@example.test",
};
const EXPIRES = "2026-10-21T20:30:00.000Z";

function panel() {
  return render(
    createElement(ReefClubCodePanel, { token: "t", customerId: "c-1" }),
  );
}

beforeEach(() => {
  aquariums.issueReefClubCode.mockReset();
  customers.detail.mockReset().mockResolvedValue(person);
});
afterEach(() => vi.unstubAllGlobals());

describe("ReefClubCodePanel", () => {
  it("issues the code without an e-mail by default, shows it big with its expiry, and says it is shown once", async () => {
    aquariums.issueReefClubCode.mockResolvedValue({
      code: "ABCD-EFGH-JKLM",
      expiresAt: EXPIRES,
    });
    panel();
    fireEvent.click(
      await screen.findByRole("button", { name: "ReefClub-kód kiadása" }),
    );

    expect(await screen.findByLabelText("ReefClub-kód")).toHaveTextContent(
      "ABCD-EFGH-JKLM",
    );
    expect(aquariums.issueReefClubCode).toHaveBeenCalledWith("t", "c-1", false);
    expect(screen.getByText(formatExpiry(EXPIRES))).toBeInTheDocument();
    expect(screen.queryByText(/Elküldtük ide/)).toBeNull();
    expect(screen.getByText(/később nem olvasható vissza/)).toBeInTheDocument();
  });

  it("with the box ticked the code is also e-mailed, and the address it went to is shown", async () => {
    aquariums.issueReefClubCode.mockResolvedValue({
      code: "ABCD-EFGH-JKLM",
      expiresAt: EXPIRES,
      emailedTo: "minta@example.test",
    });
    panel();
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: "ReefClub-kód kiadása" }),
    );
    expect(
      await screen.findByText("Elküldtük ide: minta@example.test"),
    ).toBeInTheDocument();
    expect(aquariums.issueReefClubCode).toHaveBeenCalledWith("t", "c-1", true);
  });

  it("copies the code to the clipboard and says so; without a clipboard it says to select it", async () => {
    aquariums.issueReefClubCode.mockResolvedValue({
      code: "ABCD-EFGH-JKLM",
      expiresAt: EXPIRES,
    });
    const writeText = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    panel();
    fireEvent.click(
      await screen.findByRole("button", { name: "ReefClub-kód kiadása" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Másolás" }));
    expect(await screen.findByText("Kimásolva.")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("ABCD-EFGH-JKLM");

    fireEvent.click(screen.getByRole("button", { name: "Másolás" }));
    expect(
      await screen.findByText(/A vágólap nem érhető el/),
    ).toBeInTheDocument();
  });

  it("a company customer gets no button, the reason instead, and nothing is called", async () => {
    customers.detail.mockResolvedValue({ ...person, type: "COMPANY" });
    panel();
    expect(await screen.findByRole("note")).toHaveTextContent(
      "csak magánszemély vevőnek adható ki",
    );
    expect(
      screen.queryByRole("button", { name: "ReefClub-kód kiadása" }),
    ).toBeNull();
    expect(aquariums.issueReefClubCode).not.toHaveBeenCalled();
  });

  it("a person without an e-mail address gets no button either, and is told why", async () => {
    customers.detail.mockResolvedValue({ ...person, email: undefined });
    panel();
    expect(await screen.findByRole("note")).toHaveTextContent(
      "nincs e-mail címe",
    );
    expect(
      screen.queryByRole("button", { name: "ReefClub-kód kiadása" }),
    ).toBeNull();
  });

  it("shows the server's own words when it refuses, and no code", async () => {
    aquariums.issueReefClubCode.mockRejectedValue(
      new Error(
        "Az e-mail küldés jelenleg nincs beállítva; a kód a képernyőn érvényes.",
      ),
    );
    panel();
    fireEvent.click(
      await screen.findByRole("button", { name: "ReefClub-kód kiadása" }),
    );
    expect(
      await screen.findByText(/e-mail küldés jelenleg nincs beállítva/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("ReefClub-kód")).toBeNull();
  });

  it("a customer that cannot be loaded is said, with no button", async () => {
    customers.detail.mockRejectedValue(new Error("Az ügyfél nem található."));
    panel();
    await waitFor(() =>
      expect(screen.getByText("Az ügyfél nem található.")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "ReefClub-kód kiadása" }),
    ).toBeNull();
  });
});

describe("codeBlocker and formatExpiry", () => {
  it("names the same two reasons the server refuses for", () => {
    expect(codeBlocker({ type: "COMPANY", email: "x@example.test" })).toMatch(
      /csak magánszemély/,
    );
    expect(codeBlocker({ type: "PERSON", email: "  " })).toMatch(
      /nincs e-mail címe/,
    );
    expect(codeBlocker({ type: "PERSON", email: "x@example.test" })).toBeNull();
  });

  it("writes the expiry in the shop's time zone (Europe/Budapest), not the viewer's", () => {
    // 20:30 UTC on 21 October is 22:30 in Budapest (CEST, UTC+2). The host's own zone is set
    // to UTC for the call: on a machine whose zone IS Budapest (this fleet's shells) a missing
    // explicit zone would pass unseen, and the CI's zone is UTC.
    const host = process.env.TZ;
    process.env.TZ = "UTC";
    try {
      expect(formatExpiry(EXPIRES)).toMatch(/22:30/);
    } finally {
      if (host === undefined) delete process.env.TZ;
      else process.env.TZ = host;
    }
  });
});

describe("where the panel is mounted", () => {
  // Source-level wiring check, and its limit is said: it reads the file, it does not render
  // the 900-line editor. It pins WHERE the panel sits (edit mode, a customer chosen, inside the
  // ownership card) so a refactor that moves it to the create form fails here.
  it("the editor mounts it only when editing and a customer is chosen", () => {
    const source = readFileSync(
      join(__dirname, "pilot", "pilot-aquarium-editor-page.tsx"),
      "utf8",
    );
    expect(source).toMatch(
      /isEdit && customerSelection\.customerId \?\s*\(\s*<ReefClubCodePanel/,
    );
    expect(source.match(/<ReefClubCodePanel/g)).toHaveLength(1);
  });
});
