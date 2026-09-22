import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServiceJobFieldsEditor } from "./service-job-fields-editor";

const api = vi.hoisted(() => ({ updateFields: vi.fn() }));
vi.mock("@/lib/api/service-jobs", () => ({ serviceJobsApi: api }));

beforeEach(() => {
  vi.clearAllMocks();
  api.updateFields.mockResolvedValue({});
});

function nyit() {
  return render(
    <ServiceJobFieldsEditor
      jobId="job-1"
      token="token-1"
      title="Elirt cim"
      description="Eredeti leírás"
      onSaved={() => {}}
    />,
  );
}

describe("a bejelentés szerkesztője", () => {
  it("W1: a mezők a MAI értékről indulnak", async () => {
    const user = userEvent.setup();
    nyit();

    await user.click(
      screen.getByRole("button", { name: "Bejelentés szerkesztése" }),
    );

    expect(screen.getByLabelText("A hibajegy címe")).toHaveValue("Elirt cim");
    expect(screen.getByLabelText("A hibajegy leírása")).toHaveValue(
      "Eredeti leírás",
    );
  });

  it("W2: a mentés a beírt értékeket viszi", async () => {
    const user = userEvent.setup();
    nyit();

    await user.click(
      screen.getByRole("button", { name: "Bejelentés szerkesztése" }),
    );
    await user.clear(screen.getByLabelText("A hibajegy címe"));
    await user.type(screen.getByLabelText("A hibajegy címe"), "Javított cím");
    await user.click(screen.getByRole("button", { name: "Mentés" }));

    await waitFor(() => expect(api.updateFields).toHaveBeenCalledTimes(1));
    expect(api.updateFields.mock.calls[0]?.[2]).toEqual({
      title: "Javított cím",
      description: "Eredeti leírás",
    });
  });

  /**
   * W3: AZ URES LEIRAS `null`, NEM URES SZOVEG.
   *
   * A semaban a leiras `String?`, es a "nincs leiras" allapot a `null`. Egy
   * ures szoveg HARMADIK allapotot csinalna ugyanabbol a kettobol, es a lap
   * "A bejelenteshez nem irtak leirast" sora tobbe nem jelenne meg.
   */
  it("W3: az üresre törölt leírás null-ként megy ki", async () => {
    const user = userEvent.setup();
    nyit();

    await user.click(
      screen.getByRole("button", { name: "Bejelentés szerkesztése" }),
    );
    await user.clear(screen.getByLabelText("A hibajegy leírása"));
    await user.click(screen.getByRole("button", { name: "Mentés" }));

    await waitFor(() => expect(api.updateFields).toHaveBeenCalledTimes(1));
    expect(api.updateFields.mock.calls[0]?.[2]?.description).toBeNull();
  });

  /**
   * W4: A SZERVER MONDATA JELENIK MEG, NEM EGY SAJAT.
   *
   * A hatar harom fajtajat a szerver KULON mondattal nevezi meg (lezart jegy,
   * mar van munkalapja, nem modosithatod). Egy helyi "nem sikerult" epp azt a
   * kulonbseget tunetetne el, amiert azok a mondatok leteznek.
   */
  it("W4: a szerver elutasító mondatát mutatja", async () => {
    const user = userEvent.setup();
    api.updateFields.mockRejectedValue(
      new Error(
        "A hibajegyhez már tartozik munkalap, ezért a leírása már nem módosítható.",
      ),
    );
    nyit();

    await user.click(
      screen.getByRole("button", { name: "Bejelentés szerkesztése" }),
    );
    await user.click(screen.getByRole("button", { name: "Mentés" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A hibajegyhez már tartozik munkalap",
    );
  });

  /**
   * W5: KONTROLL -- ures cimmel a mentes NEM INDUL.
   *
   * A cim a semaban KOTELEZO, tehat az ures mezo BIZTOSAN elutasitas. Az
   * orzot nem az bizonyitja, hogy a gomb szurke, hanem hogy NEM TORTENT hivas.
   */
  it("W5: KONTROLL -- üres címmel nem indul mentés", async () => {
    const user = userEvent.setup();
    nyit();

    await user.click(
      screen.getByRole("button", { name: "Bejelentés szerkesztése" }),
    );
    await user.clear(screen.getByLabelText("A hibajegy címe"));
    await user.click(screen.getByRole("button", { name: "Mentés" }));

    expect(api.updateFields).not.toHaveBeenCalled();
  });
});
