import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ReefClubHome from "./page";

describe("ReefClub start page", () => {
  it("names the app and says it is a test environment", () => {
    render(<ReefClubHome />);
    expect(
      screen.getByRole("heading", { name: "ReefClub" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Teszt környezet/)).toBeInTheDocument();
  });
});
