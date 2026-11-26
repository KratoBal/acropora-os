import { render, screen } from "@testing-library/react";
import type { QuoteTemplateDto, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QuoteTemplatesPage } from "./quote-templates-page";

vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));
const api = vi.hoisted(() => ({
  templateList: vi.fn(),
  snippets: vi.fn(),
  createTemplate: vi.fn(),
}));
vi.mock("@/lib/api/quotes", () => ({ quotesApi: api }));
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
    } satisfies Session,
  }),
}));

/*
  AZ AJÁNLATSABLONOK KÁRTYÁI (Picasso 3.19, acrobot 62278): a jobb oldali kártya gombjai lejjebb álltak, mert a kártyák magassága eltért. MI PIROSÍT: ha a kártya nem tölti ki a rács celláját; ha a gombsor
  nem tapad a kártya aljához (a hosszú és a rövid tartalmú kártyán ugyanott áll); ha a gombok neve elveszik.
*/
const template = (id: string, name: string, titles: string[]) =>
  ({
    id,
    name,
    priceDisplay: "NET",
    defaultValidityDays: 14,
    archivedAt: null,
    blocks: titles.map((title) => ({
      kind: "TEXT",
      title,
      content: null,
      keepWithNext: false,
      startOnNewPage: false,
    })),
    milestones: [],
  }) as unknown as QuoteTemplateDto;

beforeEach(() => {
  api.templateList
    .mockReset()
    .mockResolvedValue([
      template("t1", "Rövid sablon", ["Bevezető"]),
      template("t2", "Hosszú sablon", [
        "Bevezető",
        "Műszaki leírás",
        "Szállítási feltételek",
        "Garancia",
        "Fizetési ütemezés",
      ]),
    ]);
  api.snippets.mockReset().mockResolvedValue([]);
});

describe("QuoteTemplatesPage cards", () => {
  it("every card fills its grid cell and its buttons stick to the card's bottom, whatever the text above", async () => {
    render(<QuoteTemplatesPage />);
    const edit = await screen.findByRole("button", {
      name: "Rövid sablon: szerkesztés",
    });
    const editLong = screen.getByRole("button", {
      name: "Hosszú sablon: szerkesztés",
    });
    for (const button of [edit, editLong]) {
      const row = button.parentElement!;
      expect(row.className).toContain("mt-auto");
      const inner = row.parentElement!;
      expect(inner.className).toContain("flex-col");
      expect(inner.className).toContain("h-full");
      const card = inner.parentElement!;
      expect(card.className).toContain("h-full");
    }
  });

  it("each card keeps its two named buttons", async () => {
    render(<QuoteTemplatesPage />);
    await screen.findByRole("button", { name: "Rövid sablon: szerkesztés" });
    for (const name of ["Rövid sablon", "Hosszú sablon"]) {
      expect(
        screen.getByRole("button", { name: `${name}: szerkesztés` }),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: `${name}: másolat` }),
      ).toBeTruthy();
    }
  });
});
