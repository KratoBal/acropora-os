import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReefClubCustomerLink } from "@/lib/api/aquariums";

import { ReefClubLinksList } from "./reefclub-links-list";

const aquariums = vi.hoisted(() => ({
  reefClubLinks: vi.fn(),
  endReefClubLink: vi.fn(),
}));
vi.mock("@/lib/api/aquariums", () => ({ aquariumsApi: aquariums }));
// a lista a pilot-ui gombjait használja (Inter, `next/font/local`)
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

/**
 * A VEVŐ REEFCLUB-ÖSSZEKÖTÉSEI ÉS MEGSZÜNTETÉSÜK. Kitalált adat. MI PIROSÍT: a megszüntetés
 * megerősítés nélkül fut; a megszűnt linkhez is van gomb; a megszüntetés rossz vevőre vagy
 * rossz linkre megy; a lista a megszüntetés után nem frissül; a szerver elutasítása elnyelődik;
 * a bukott vevő-értesítés nem látszik.
 */
const active: ReefClubCustomerLink = {
  id: "l-1",
  accountEmail: "aktiv@example.test",
  status: "ACTIVE",
  createdAt: "2026-10-20T08:00:00.000Z",
  noticeSentAt: "2026-10-20T08:01:00.000Z",
  noticeFailed: false,
};
const endedByAccount: ReefClubCustomerLink = {
  id: "l-2",
  accountEmail: "regi@example.test",
  status: "ENDED",
  createdAt: "2026-10-10T08:00:00.000Z",
  endedAt: "2026-10-12T08:00:00.000Z",
  endedBy: "ACCOUNT",
  noticeFailed: true,
};

function list() {
  return render(
    createElement(ReefClubLinksList, { token: "t", customerId: "c-1" }),
  );
}

beforeEach(() => {
  aquariums.reefClubLinks
    .mockReset()
    .mockResolvedValue([endedByAccount, active]);
  aquariums.endReefClubLink.mockReset().mockResolvedValue(undefined);
});

describe("ReefClubLinksList", () => {
  it("says so when no ReefClub account is linked", async () => {
    aquariums.reefClubLinks.mockResolvedValue([]);
    list();
    expect(
      await screen.findByText("A vevőhöz még nem kapcsolódik ReefClub-fiók."),
    ).toBeInTheDocument();
  });

  it("lists active and ended links with who ended them and the customer's notice state", async () => {
    list();
    const activeRow = await screen.findByTestId("reefclub-link-l-1");
    expect(activeRow).toHaveTextContent("aktiv@example.test");
    expect(activeRow).toHaveTextContent("aktív");
    expect(activeRow).toHaveTextContent("Értesítés elküldve");

    const endedRow = screen.getByTestId("reefclub-link-l-2");
    expect(endedRow).toHaveTextContent("megszűnt");
    expect(endedRow).toHaveTextContent("a vevő szüntette meg");
    expect(endedRow).toHaveTextContent(
      "A vevő NEM kapott értesítést (minden küldés elbukott).",
    );
  });

  it("offers ending only for the active link", async () => {
    list();
    await screen.findByTestId("reefclub-link-l-1");
    expect(
      screen.getAllByRole("button", { name: "Összekötés megszüntetése" }),
    ).toHaveLength(1);
  });

  it("asks with the common dialog before ending, and Mégsem ends nothing", async () => {
    list();
    fireEvent.click(
      await screen.findByRole("button", { name: "Összekötés megszüntetése" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("aktiv@example.test");
    // a három rész: mit teszünk, mi vész el, hogyan szerezhető vissza
    expect(dialog).toHaveTextContent("nem látja a vevő bolti akváriumait");
    expect(dialog).toHaveTextContent("Semmilyen adat nem törlődik");
    expect(dialog).toHaveTextContent("új ReefClub-kóddal újra összeköthet");
    expect(aquariums.endReefClubLink).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Mégsem" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(aquariums.endReefClubLink).not.toHaveBeenCalled();
  });

  it("ends the confirmed link of this customer and reloads the list", async () => {
    list();
    fireEvent.click(
      await screen.findByRole("button", { name: "Összekötés megszüntetése" }),
    );
    aquariums.reefClubLinks.mockResolvedValue([
      {
        ...active,
        status: "ENDED",
        endedBy: "SHOP",
        endedAt: "2026-10-20T21:00:00.000Z",
      },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Megszüntetés" }));

    await waitFor(() =>
      expect(aquariums.endReefClubLink).toHaveBeenCalledWith("t", "c-1", "l-1"),
    );
    expect(await screen.findByText(/a bolt szüntette meg/)).toBeInTheDocument();
    expect(aquariums.reefClubLinks).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByRole("button", { name: "Összekötés megszüntetése" }),
    ).toBeNull();
  });

  it("shows the server's words when ending is refused, and reloads", async () => {
    aquariums.endReefClubLink.mockRejectedValue(
      new Error("Az aktív összekapcsolás nem található."),
    );
    list();
    fireEvent.click(
      await screen.findByRole("button", { name: "Összekötés megszüntetése" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Megszüntetés" }));

    expect(
      await screen.findByText("Az aktív összekapcsolás nem található."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(aquariums.reefClubLinks).toHaveBeenCalledTimes(2);
  });

  it("shows the server's words when the list cannot be loaded", async () => {
    aquariums.reefClubLinks.mockRejectedValue(new Error("Nincs jogosultság."));
    list();
    expect(await screen.findByText("Nincs jogosultság.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /megszüntet/i })).toBeNull();
  });
});
