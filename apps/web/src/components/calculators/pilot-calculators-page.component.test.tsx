import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PilotCalculatorsPage } from "./pilot-calculators-page";

vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      id: "s",
      token: "token-1",
      expiresAt: "2099-01-01T00:00:00.000Z",
      user: {
        id: "u",
        email: "u@acropora.local",
        displayName: "U",
        role: "OWNER",
        customerId: null,
        supplierId: null,
      },
    },
  }),
}));

/*
  A KALKULÁTOROK FEJLÉCE (Picasso 3.20, acrobot 62278): a lapnak nem volt eyebrow-ja, a többi lapé a menü csoportját mondja ("Szerviz", "Beállítások"). MI PIROSÍT: ha az eyebrow elmarad, vagy nem a menü
  csoportja ("Akvarisztika") áll benne.
*/
describe("PilotCalculatorsPage header", () => {
  it("names its menu group above the title", () => {
    render(<PilotCalculatorsPage />);
    const title = screen.getByRole("heading", {
      level: 1,
      name: "Kalkulátorok",
    });
    const eyebrow = screen.getByText("Akvarisztika");
    expect(
      eyebrow.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
