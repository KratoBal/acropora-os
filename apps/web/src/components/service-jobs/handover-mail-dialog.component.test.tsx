import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HandoverMailDialog } from "./handover-mail-dialog";

const LINE =
  "A hibajegy a partnerportálon is megnézhető: https://ticket.example.hu/hibajegyek/job-1";

const dialog = (portalLinkLine?: string) => (
  <HandoverMailDialog
    open
    jobNumber="HJ-2026-009"
    preview={{
      kind: "send",
      recipients: [{ name: "Üzemeltető Ubul", email: "uzem@partner.hu" }],
      subject: "A HJ-2026-009 számú hibajegyet lezártuk.",
      ...(portalLinkLine !== undefined ? { portalLinkLine } : {}),
    }}
    previewError={null}
    sendError={null}
    busy={false}
    onSend={vi.fn()}
    onCancel={vi.fn()}
  />
);

describe("HandoverMailDialog: a portál-link sora", () => {
  it("a szerver mondatát mutatja szó szerint, és a súgó már nem állítja, hogy semmit nem fűz hozzá", () => {
    render(dialog(LINE));
    expect(
      screen.getByTestId("handover-mail-portal-line").textContent,
    ).toContain(LINE);
    expect(
      screen.getByText(/Alatta a rendszer egy sort ad hozzá/),
    ).toBeTruthy();
    expect(screen.queryByText(/A rendszer semmit nem fűz hozzá/)).toBeNull();
  });

  it("link nélkül (üres vagy hiányzó mondat) nincs sor, és a súgó a régi: semmi nem kerül a szöveg alá", () => {
    for (const line of ["", undefined]) {
      const { unmount } = render(dialog(line));
      expect(screen.queryByTestId("handover-mail-portal-line")).toBeNull();
      expect(screen.getByText(/A rendszer semmit nem fűz hozzá/)).toBeTruthy();
      unmount();
    }
  });

  it("a küldés szövege a kezelő szövege marad: a sor nem kerül a szövegmezőbe", () => {
    const onSend = vi.fn();
    render(
      <HandoverMailDialog
        open
        jobNumber="HJ-2026-009"
        preview={{
          kind: "send",
          recipients: [{ name: "Ubul", email: "uzem@partner.hu" }],
          subject: "Tárgy",
          portalLinkLine: LINE,
        }}
        previewError={null}
        sendError={null}
        busy={false}
        onSend={onSend}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: /Üzenet/ }), {
      target: { value: "Köszönjük." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Elküldés 1 címzettnek/ }),
    );
    expect(onSend).toHaveBeenCalledWith({
      subject: "Tárgy",
      message: "Köszönjük.",
    });
  });
});
