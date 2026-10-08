import type { QuoteRichText, QuoteTemplateInput } from "@acropora/types";

/**
 * THE FOUR STARTING TEMPLATES (#1582; Balázs 2026-10-08 "Sablon semmi"; the
 * names and block lists are the Figma Templates frame's, 579:2243). The
 * blocks are text only: the items come per quote (C3). The texts are a
 * starting point, editable on the Beállítások page.
 */

/** A text block's content: one paragraph per line, a "- " line a bullet. */
function text(...lines: string[]): QuoteRichText {
  const content: QuoteRichText[] = [];
  let bullets: QuoteRichText[] = [];
  const flush = () => {
    if (bullets.length) content.push({ type: "bulletList", content: bullets });
    bullets = [];
  };
  for (const line of lines) {
    if (line.startsWith("- ")) {
      bullets.push({
        type: "listItem",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: line.slice(2) }],
          },
        ],
      });
      continue;
    }
    flush();
    content.push({
      type: "paragraph",
      content: [{ type: "text", text: line }],
    });
  }
  flush();
  return { type: "doc", content };
}

const HU_INTRO = text(
  "Köszönjük megkeresését! Az alábbiakban összefoglaljuk ajánlatunkat a kért rendszerre.",
  "Az ajánlat tételesen tartalmazza a javasolt eszközöket és munkákat; az opcionális tételek külön szerepelnek, és csak az Ön kérésére kerülnek a megrendelésbe.",
);

const HU_TERMS = text(
  "Fizetési feltételek: a fizetési ütemezés szerint, átutalással.",
  "Garancia: a kivitelezésre 12 hónap, az eszközökre a gyártói garancia.",
  "Az ajánlat a feltüntetett érvényességi időn belül fogadható el. Az áru a teljes vételár kifizetéséig az Acropora Kft. tulajdonában marad.",
);

export const DEFAULT_QUOTE_TEMPLATES: readonly QuoteTemplateInput[] = [
  {
    name: "Komplett akvárium kivitelezés",
    priceDisplay: "GROSS",
    defaultValidityDays: 30,
    blocks: [
      { kind: "TEXT", title: "Bevezető", content: HU_INTRO },
      { kind: "SECTION", title: "Akvárium és bútor" },
      { kind: "SECTION", title: "Technikai rendszer" },
      { kind: "OPTIONS", title: "Opcionális tételek" },
      { kind: "SUMMARY", title: "Összesítés" },
      { kind: "TERMS", title: "Feltételek", content: HU_TERMS },
    ],
    milestones: [
      { label: "Előleg megrendeléskor", percent: "40" },
      { label: "Telepítéskor", percent: "40" },
      { label: "Átadáskor", percent: "20" },
    ],
  },
  {
    name: "Technikai rendszer ajánlat",
    priceDisplay: "GROSS",
    defaultValidityDays: 30,
    blocks: [
      { kind: "TEXT", title: "Bevezető", content: HU_INTRO },
      { kind: "SECTION", title: "Technika" },
      { kind: "SECTION", title: "Telepítés" },
      { kind: "SUMMARY", title: "Összesítés" },
      { kind: "TERMS", title: "Feltételek", content: HU_TERMS },
    ],
    milestones: [
      { label: "Előleg megrendeléskor", percent: "50" },
      { label: "Telepítés után", percent: "50" },
    ],
  },
  {
    name: "Szerviz / fejlesztési ajánlat",
    priceDisplay: "GROSS",
    defaultValidityDays: 15,
    blocks: [
      {
        kind: "TEXT",
        title: "Bevezető",
        content: text(
          "Köszönjük megkeresését! A felmérés alapján az alábbi munkákat javasoljuk.",
        ),
      },
      { kind: "SECTION", title: "Munka leírás" },
      { kind: "SUMMARY", title: "Ár" },
      {
        kind: "TERMS",
        title: "Feltételek",
        content: text(
          "Fizetés a munka elvégzése után, átutalással.",
          "Garancia: az elvégzett munkára 6 hónap, a beépített alkatrészekre a gyártói garancia.",
        ),
      },
    ],
    milestones: [{ label: "A munka elvégzése után", percent: "100" }],
  },
  {
    name: "English complete aquarium",
    priceDisplay: "NET",
    defaultValidityDays: 30,
    blocks: [
      {
        kind: "TEXT",
        title: "Intro",
        content: text(
          "Thank you for your enquiry. Please find our proposal for the requested system below.",
          "Optional items are listed separately and are only included in the order at your request.",
        ),
      },
      { kind: "SECTION", title: "Aquarium and furniture" },
      { kind: "SECTION", title: "Technology" },
      { kind: "OPTIONS", title: "Options" },
      { kind: "SUMMARY", title: "Summary" },
      {
        kind: "TERMS",
        title: "Terms",
        content: text(
          "Payment: according to the payment schedule, by bank transfer.",
          "Warranty: 12 months on the installation, the manufacturer's warranty on the equipment.",
          "The goods remain the property of Acropora Kft. until paid in full.",
        ),
      },
    ],
    milestones: [
      { label: "Deposit on order", percent: "40" },
      { label: "On installation", percent: "40" },
      { label: "On handover", percent: "20" },
    ],
  },
];
