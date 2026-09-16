import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WorksheetAssetLink } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorksheetAssetEditor } from "./worksheet-asset-editor";

const sheets = vi.hoisted(() => ({ setAssets: vi.fn() }));

vi.mock("@/lib/api/worksheets", () => ({ worksheetsApi: sheets }));

/**
 * A VALASZTO DUPLAJA. A `JobAssetPicker`-nek SAJAT keszlete van (a matricakod,
 * a szaz soros levagas, a negy valasz mind ott merve); ez a fajl a DOBOZT meri.
 *
 * A DUPLA A VARRAT TELJES SZERZODESET VISZI: mind a harom bemenetet latszova
 * teszi, tehat ha a doboz elfelejtene atadni a lap helyszinet, az ITT
 * pirosodik.
 */
vi.mock("@/components/service-jobs/job-asset-picker", () => ({
  JobAssetPicker: ({
    departmentId,
    selected,
    onChange,
  }: {
    departmentId: string;
    selected: readonly string[];
    onChange: (ids: string[]) => void;
  }) => (
    <div>
      <span data-testid="valaszto-helyszin">{departmentId}</span>
      <span data-testid="valaszto-kijeloles">{selected.join(",")}</span>
      <button type="button" onClick={() => onChange([...selected, "esz-9"])}>
        UJAT VALASZT
      </button>
      <button type="button" onClick={() => onChange([])}>
        MIND LE
      </button>
    </div>
  ),
}));

function eszkoz(assetId: string, name: string, num: string) {
  return {
    id: `link-${assetId}`,
    assetId,
    assetNumber: num,
    assetName: name,
    attachedAt: "2026-09-15T08:00:00.000Z",
  } satisfies WorksheetAssetLink;
}

function alap(over: Record<string, unknown> = {}) {
  return {
    worksheetId: "worksheet-1",
    token: "token-1",
    departmentId: "unit-9",
    assets: [eszkoz("esz-1", "Szivattyú", "ESZ-0007")],
    canManage: true,
    onSaved: () => {},
    ...over,
  } as React.ComponentProps<typeof WorksheetAssetEditor>;
}

describe("WorksheetAssetEditor", () => {
  beforeEach(() => {
    sheets.setAssets.mockReset();
  });

  /**
   * EZ AZ ALLITAS AZ, AMIERT A DOBOZ LETEZIK.
   *
   * A csatolt eszkozok 2026-09-15 ota bekerultek az adatbazisba, es SEHOL nem
   * latszottak -- meg a sajat lapjukon sem. A lista tehat olvaso jognak is jar:
   * ugyanaz a ket jog, amit a szerver kulonboztet.
   */
  it("olvasó hívónál is kiírja a csatolt eszközöket, de nem ad szerkesztőt", () => {
    render(<WorksheetAssetEditor {...alap({ canManage: false })} />);

    expect(screen.getByText("Szivattyú")).toBeTruthy();
    expect(screen.getByText("ESZ-0007")).toBeTruthy();
    expect(screen.queryByTestId("valaszto-helyszin")).toBeNull();
    expect(screen.queryByText(/Eszközök mentése/)).toBeNull();
  });

  /**
   * A HIANY IS ALLITAS: egy ures doboz betoltesi hibanak latszik, es a kezelo
   * megvarja. Ez a mondat kimondja, hogy nincs mire varni.
   */
  it("eszköz nélkül kimondja, hogy nincs csatolva semmi", () => {
    render(<WorksheetAssetEditor {...alap({ assets: [] })} />);

    expect(screen.getByText(/nincs eszköz csatolva/)).toBeTruthy();
  });

  /**
   * A VALASZTO A LAP HELYSZINET KAPJA.
   *
   * Enelkul a valaszto egy MASIK helyszin eszkozeit kinalna, es amit a
   * felhasznalo ott valasztana, azt a szerver utasitana el -- a lap sajat
   * helyszinere ellenoriz, es azt a hivo nem is tudja felulirni.
   */
  it("a választó a lap helyszínét kapja meg", () => {
    render(<WorksheetAssetEditor {...alap()} />);

    expect(screen.getByTestId("valaszto-helyszin").textContent).toEqual(
      "unit-9",
    );
    expect(screen.getByTestId("valaszto-kijeloles").textContent).toEqual(
      "esz-1",
    );
  });

  it("a felvett eszközzel a TELJES listát küldi el", async () => {
    sheets.setAssets.mockResolvedValue({ id: "worksheet-1" });
    const mentett: unknown[] = [];
    render(
      <WorksheetAssetEditor
        {...alap({ onSaved: (detail: unknown) => mentett.push(detail) })}
      />,
    );

    fireEvent.click(screen.getByText("UJAT VALASZT"));
    fireEvent.click(screen.getByText("Eszközök mentése"));

    await waitFor(() => expect(sheets.setAssets).toHaveBeenCalledTimes(1));
    expect(sheets.setAssets.mock.calls[0]?.[2]).toEqual({
      assetIds: ["esz-1", "esz-9"],
    });
    // A VALASZ A TELJES RESZLETLAP: nem toltunk ujra, a hivo ezt teszi be.
    await waitFor(() => expect(mentett).toEqual([{ id: "worksheet-1" }]));
  });

  /**
   * ES A LEVETEL IS MEGY: URES LISTA IS ELMEGY.
   *
   * A felvetel allitasa onmagaban akkor is zold lenne, ha a doboz csak
   * hozzaadni tudna -- es az ures lista kulon eset, mert azt konnyu
   * "nincs valtozas"-kent elnyelni.
   */
  it("mindent levéve üres listát küld, nem hagyja ki a mentést", async () => {
    sheets.setAssets.mockResolvedValue({ id: "worksheet-1" });
    render(<WorksheetAssetEditor {...alap()} />);

    fireEvent.click(screen.getByText("MIND LE"));
    fireEvent.click(screen.getByText("Eszközök mentése"));

    await waitFor(() => expect(sheets.setAssets).toHaveBeenCalledTimes(1));
    expect(sheets.setAssets.mock.calls[0]?.[2]).toEqual({ assetIds: [] });
  });

  /**
   * VALTOZAS NELKUL A GOMB NEM KULD.
   *
   * Nem szepitkezes: minden mentes ATIRNA a sorokat, es a `createdAt` az
   * egyetlen jel arrol, mikor kerult egy eszkoz a lapra. Egy ures mentes tehat
   * nem artalmatlan kor.
   */
  it("változás nélkül a gomb nem küld", () => {
    render(<WorksheetAssetEditor {...alap()} />);

    const gomb = screen.getByText("Eszközök mentése") as HTMLButtonElement;
    expect(gomb.disabled).toBe(true);
  });
});
