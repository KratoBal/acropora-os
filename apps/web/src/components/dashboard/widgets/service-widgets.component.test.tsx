import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { maintenanceCalendarWidget } from "./maintenance-calendar-widget";
import { materialRequestsWidget } from "./material-requests-widget";
import { serviceTicketsWidget } from "./service-tickets-widget";
import { worksheetsWidget } from "./worksheets-widget";

describe("a szerviz-widgetek", () => {
  it("a hibajegyek az állapotokat és a legrégebbi korát mutatják, sürgősséget nem találnak ki", () => {
    const { Body } = serviceTicketsWidget;
    render(
      <Body
        data={{
          openCount: 3,
          byStatus: { NEW: 2, WAITING_FOR_PARTS: 1 },
          oldestOpenAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        }}
      />,
    );
    expect(screen.getByText("nyitott hibajegy")).toBeTruthy();
    expect(screen.getByText("3 napja")).toBeTruthy();
    expect(screen.queryByText(/sürgős/i)).toBeNull();
    expect(
      serviceTicketsWidget.emptyMessage({
        openCount: 0,
        byStatus: {},
        oldestOpenAt: null,
      }),
    ).toBe("Nincs nyitott hibajegy.");
  });

  /*
    A KÖZÖS ÁLLAPOTOK (kártya 7f23785c): a sorok a szerver `commonCounts`-ából jönnek, a két várakozás a tárolt bontásból. A tárolt
    IN_PROGRESS itt 5, a szerver ebből 2-t Elkészültnek mond: ha a csempe a tárolt bontást olvasná, „Folyamatban 5” állna, és
    Elkészült nem.
  */
  it("a hibajegyek a közös állapotokban, az Elkészült külön sorban", () => {
    const { Body } = serviceTicketsWidget;
    render(
      <Body
        data={{
          openCount: 9,
          byStatus: {
            NEW: 1,
            IN_PROGRESS: 5,
            WAITING_FOR_PARTS: 2,
            WAITING_FOR_CUSTOMER: 1,
          },
          commonCounts: { NEW: 1, IN_PROGRESS: 3, WAITING: 3, DONE: 2 },
          oldestOpenAt: null,
        }}
      />,
    );
    const sorok = screen.getAllByRole("listitem").map((sor) => sor.textContent);
    expect(sorok).toEqual([
      "Új1",
      "Elkészült2",
      "Vár valamire · alkatrészre2",
      "Vár valamire · ügyfélre1",
      "Folyamatban3",
    ]);
  });

  it("a munkalapok csak akkor üresek, ha egyik teendő sincs", () => {
    const none = {
      draft: 0,
      awaitingSignatureNotSent: 0,
      awaitingSignatureSent: 0,
      certificatesAwaitingSignedForm: 0,
    };
    expect(worksheetsWidget.emptyMessage(none)).toBe(
      "Nincs teendő a munkalapokkal.",
    );
    expect(
      worksheetsWidget.emptyMessage({
        ...none,
        certificatesAwaitingSignedForm: 1,
      }),
    ).toBeNull();
    const { Body } = worksheetsWidget;
    render(<Body data={{ ...none, draft: 5, awaitingSignatureSent: 2 }} />);
    expect(screen.getByText("lezárandó munkalap")).toBeTruthy();
    expect(screen.getByText("Aláírásra vár")).toBeTruthy();
  });

  it("az anyagigény a munkalapot, a vevőt és a várakozást mutatja", () => {
    const { Body } = materialRequestsWidget;
    render(
      <Body
        data={{
          openCount: 1,
          oldestSubmittedAt: new Date().toISOString(),
          latest: [
            {
              id: "m1",
              worksheetId: "w1",
              worksheetNumber: "ML-1",
              customerName: "Kitalált Kft.",
              submittedAt: new Date().toISOString(),
              itemCount: 2,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("ML-1 · Kitalált Kft.")).toBeTruthy();
    expect(screen.getByText("ma")).toBeTruthy();
  });

  it("a naptár a lejártat külön mutatja, és a napot nem tolja el az időzóna", () => {
    const { Body } = maintenanceCalendarWidget;
    render(
      <Body
        data={{
          overdue: 2,
          today: 1,
          nextSevenDays: 3,
          soonest: [
            {
              assetId: "a1",
              assetName: "Kitalált szivattyú",
              placeName: "Minta telephely",
              nextServiceAt: "2026-10-01",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Lejárt")).toBeTruthy();
    expect(screen.getByText("esedékes 7 napon belül")).toBeTruthy();
    expect(screen.getByText(/okt\. 1\./)).toBeTruthy();
    expect(
      maintenanceCalendarWidget.emptyMessage({
        overdue: 0,
        today: 0,
        nextSevenDays: 0,
        soonest: [],
      }),
    ).toBe("A következő 7 napban nincs esedékes karbantartás.");
  });
});
