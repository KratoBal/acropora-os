import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContentListItem, UserRole } from "@acropora/types";

import { ContentRowActions } from "./content-row-actions";

const api = vi.hoisted(() => ({
  move: vi.fn(),
  comment: vi.fn(),
}));

/**
 * A SZEREP A KAPCSOLÓ, NEM EGY `permissions` TÖMB.
 *
 * A `hasPermission` a szerepkörből számol (`ROLE_PERMISSIONS`), tehát egy
 * kézzel írt jogosultság-lista a munkamenetben NEM befolyásol semmit. Aki mégis
 * azzal próbálná mérni a gombok láthatóságát, olyan tesztet írna, ami MÁS OKBÓL
 * zöld: a gomb attól látszana vagy nem látszana, amit a szerep amúgy is
 * eldöntött.
 *
 * OWNER: mindent tud, a jóváhagyást is.
 * MANAGER: `content.manage` igen, `content.approve` SZÁNDÉKOSAN nem.
 * VIEWER: csak nézhet.
 */
let role: UserRole = "OWNER";

vi.mock("@/lib/api/content", () => ({ contentApi: api }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      token: "token-1",
      user: {
        id: "user-1",
        email: "b@acropora.local",
        displayName: "Balázs",
        role,
      },
    },
  }),
}));

const item = (overrides: Partial<ContentListItem> = {}): ContentListItem =>
  ({
    id: "c1",
    title: "Minta cím",
    channel: "FACEBOOK_POST",
    state: "AWAITING_APPROVAL",
    imageRequired: false,
    imageAttachedAt: null,
    authorId: null,
    reviewerId: null,
    plannedFor: null,
    scheduledFor: null,
    scheduleAnchoredAt: null,
    sentAt: null,
    externalUrl: null,
    updatedAt: new Date().toISOString(),
    moves: [],
    ...overrides,
  }) as ContentListItem;

const approvingStep = {
  to: "READY_TO_SEND" as const,
  requiresApproval: true,
  blockedByExternalWork: null,
  primary: true,
  note: null,
};

const ordinaryStep = {
  to: "AWAITING_REVIEW" as const,
  requiresApproval: false,
  blockedByExternalWork: null,
  primary: false,
  note: null,
};

beforeEach(() => {
  role = "OWNER";
  api.move.mockReset().mockResolvedValue({ ok: true });
  api.comment.mockReset().mockResolvedValue({ id: "comment-1" });
});

describe("who sees which step", () => {
  /**
   * AKI CSAK ÍRNI TUD, NE LÁSSON JÓVÁHAGYÓ GOMBOT.
   *
   * EZ NEM A VÉDELEM, és a különbség fontos: a kapu a szerveren van
   * (`requiresApproval` a szolgáltatásban). Ez az állítás csak azt méri, hogy
   * nem kínálunk fel valamit, amit a hívó úgysem tud végrehajtani.
   */
  it("keeps an approving step away from someone who cannot approve", () => {
    role = "MANAGER";

    render(
      <ContentRowActions
        item={item({ moves: [approvingStep, ordinaryStep] })}
        onDone={() => {}}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "kiküldésre kész" }),
    ).toBeNull();
    // ÉS A HÉTKÖZNAPI LÉPÉS OTT MARAD. E nélkül az állítás akkor is zöld lenne,
    // ha egyetlen gomb sem jelenne meg -- vagyis ha túl sokat zárnánk be.
    expect(
      screen.getByRole("button", { name: "lektorálásra vár" }),
    ).toBeTruthy();
  });

  /**
   * A MÁSIK IRÁNY. Ha ez az állítás nem lenne, az előző attól is zöld maradna,
   * hogy a gomb SOSEM jelenik meg, senkinek.
   */
  it("shows the same step to an approver", () => {
    role = "OWNER";

    render(
      <ContentRowActions
        item={item({ moves: [approvingStep] })}
        onDone={() => {}}
      />,
    );

    expect(
      screen.getByRole("button", { name: "kiküldésre kész" }),
    ).toBeTruthy();
  });

  /**
   * AKI CSAK NÉZHET, HOZZÁSZÓLHAT. A hozzászólás `content.view` jogon áll, és ez
   * nem engedmény: a lektori észrevétel attól ér valamit, hogy az is leírhatja,
   * aki magát a tételt nem mozgatja.
   */
  it("still lets a viewer comment, without offering any step", () => {
    role = "VIEWER";

    render(
      <ContentRowActions
        item={item({ moves: [approvingStep, ordinaryStep] })}
        onDone={() => {}}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "lektorálásra vár" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Hozzászólás" })).toBeTruthy();
  });
});

describe("what the screen does with a list it did not write", () => {
  /**
   * A FELÜLET NEM TART SAJÁT LISTÁT. Ha a szerver kevesebb lépést küld, kevesebb
   * gomb jelenik meg -- nem hiba, nem üres hely, és semmiképp nem összeomlás.
   */
  it("simply shows fewer buttons when the server offers fewer steps", () => {
    render(<ContentRowActions item={item({ moves: [] })} onDone={() => {}} />);

    expect(
      screen.queryByRole("button", { name: "kiküldésre kész" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Hozzászólás" })).toBeTruthy();
  });

  /**
   * ÉS HA A SZERVER OLYAN LÉPÉST KÜLD, AMINEK ITT NINCS NEVE.
   *
   * A címke-tábla `Record<ContentState, string>`, tehát új állapotnál a FORDÍTÓ
   * szól -- de az a build ígérete. A dróton attól még érkezhet ismeretlen érték,
   * mert a szerver és a felület külön indul el. Ilyenkor a nyers név jelenik
   * meg: egy `undefined` üres gombot adna, amire senki nem tudná, mit csinál.
   */
  it("names an unknown step by its raw value instead of leaving the button empty", () => {
    render(
      <ContentRowActions
        item={item({
          moves: [
            {
              to: "AWAITING_LEGAL_CHECK",
              requiresApproval: false,
              blockedByExternalWork: null,
              primary: false,
              note: null,
            },
          ] as unknown as ContentListItem["moves"],
        })}
        onDone={() => {}}
      />,
    );

    expect(
      screen.getByRole("button", { name: "AWAITING_LEGAL_CHECK" }),
    ).toBeTruthy();
  });
});

describe("a step that cannot run today", () => {
  /**
   * AZ ÜTEMEZETT POSZT VISSZAVONÁSA VALÓDI TEENDŐ, CSAK NEM ITT. A gomb ezért
   * látszik, de nem indítható, és az indok mellette áll. Elrejtve senki nem
   * tudná meg, hogy van teendő; engedve a szerver utasítaná el, és a gomb
   * tanítaná meg, hogy néha nem működik.
   */
  it("shows it disabled, with the reason next to it", () => {
    render(
      <ContentRowActions
        item={item({
          state: "SCHEDULED",
          moves: [
            {
              to: "READY_TO_SEND",
              requiresApproval: false,
              blockedByExternalWork:
                "A poszt ütemezve áll a Facebookon: az ütemezést ott vissza kell vonni.",
              primary: false,
              note: null,
            },
          ],
        })}
        onDone={() => {}}
      />,
    );

    const button = screen.getByRole("button", { name: "kiküldésre kész" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/ütemezve áll a Facebookon/)).toBeTruthy();
  });
});

describe("discarding, which needs a reason", () => {
  /**
   * OK NÉLKÜL EL SEM INDUL. A szerver ugyanezt megtagadná, de akkor a hiányzó
   * mező szerver-hibaként jelenne meg, és a felhasználó egy elrontott lépést
   * látna egy kitöltetlen mező helyett.
   */
  it("will not send the step until a reason is typed", async () => {
    render(
      <ContentRowActions
        item={item({
          state: "DRAFTING",
          moves: [
            {
              to: "DISCARDED",
              requiresApproval: false,
              blockedByExternalWork: null,
              primary: false,
              note: {
                field: "discardReason" as const,
                label: "Miért vetjük el?",
              },
            },
          ],
        })}
        onDone={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "elvetve" }));

    const confirm = screen.getAllByRole("button", { name: "elvetve" })[1]!;
    expect(confirm.hasAttribute("disabled")).toBe(true);
    // AZ ŐRZŐT NEM AZ BIZONYÍTJA, HOGY SZÓL, HANEM HOGY NEM TÖRTÉNT SEMMI.
    expect(api.move).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Miért vetjük el?"), {
      target: { value: "a kampány elmarad" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "elvetve" })[1]!);

    await waitFor(() => expect(api.move).toHaveBeenCalledTimes(1));
    expect(api.move.mock.calls[0]![2]).toMatchObject({
      to: "DISCARDED",
      discardReason: "a kampány elmarad",
    });
  });
});

describe("which endpoint a step goes to", () => {
  /**
   * A DÖNTÉST A SZERVER VÁLASZA HOZZA, NEM EZ A FÁJL. A hívó annyit tesz, hogy
   * továbbadja a sorral érkezett `requiresApproval` értéket -- így ha holnap egy
   * másik lépés válik jóváhagyóvá, a felületen semmit nem kell átírni.
   */
  it("passes the server's own answer about the step back to the client", async () => {
    render(
      <ContentRowActions
        item={item({ moves: [approvingStep] })}
        onDone={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "kiküldésre kész" }));

    await waitFor(() => expect(api.move).toHaveBeenCalledTimes(1));
    expect(api.move.mock.calls[0]![2]).toMatchObject({
      from: "AWAITING_APPROVAL",
      to: "READY_TO_SEND",
      requiresApproval: true,
    });
  });

  /**
   * EGY SIKERES LÉPÉS UTÁN ÚJRA KELL KÉRDEZNI: a tétel állapota megváltozott, és
   * ezzel az is, mit lehet belőle lépni. E nélkül a sor olyan lépéseket kínálna
   * tovább, amiket a szerver már elutasít.
   */
  it("asks the list to reload once the step went through", async () => {
    const onDone = vi.fn();

    render(
      <ContentRowActions
        item={item({ moves: [approvingStep] })}
        onDone={onDone}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "kiküldésre kész" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  /**
   * ÉS HA A LÉPÉS ELBUKIK, A LISTA NEM TÖLTŐDIK ÚJRA, viszont a hiba LÁTSZIK.
   * Egy néma bukás után a sor változatlanul állna, és a felhasználó azt hinné,
   * hogy nem nyomta meg elég erősen.
   */
  it("shows the failure and does not pretend the step happened", async () => {
    const onDone = vi.fn();
    api.move.mockRejectedValue(
      new Error("A tartalom időközben más állapotba került."),
    );

    render(
      <ContentRowActions
        item={item({ moves: [approvingStep] })}
        onDone={onDone}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "kiküldésre kész" }));

    await waitFor(() =>
      expect(screen.getByText(/időközben más állapotba került/)).toBeTruthy(),
    );
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("which button stands out", () => {
  /**
   * EGY KIEMELT LÉPÉS SORONKÉNT, ÉS AZT A SZERVER VÁLASZTJA KI.
   *
   * A felület nem dönti el, melyik a kézenfekvő lépés: a `primary` mezőt kapja,
   * és csak megjeleníti. Ez az állítás azt méri, hogy a KAPOTT rangsort követi,
   * nem egy sajátot -- ezért adunk neki olyan sort, ahol nem az első elem az
   * elsődleges.
   */
  it("follows the server's ranking instead of its own", () => {
    render(
      <ContentRowActions
        item={item({
          moves: [
            {
              to: "AWAITING_REVISION",
              requiresApproval: true,
              blockedByExternalWork: null,
              primary: false,
              note: null,
            },
            approvingStep,
          ],
        })}
        onDone={() => {}}
      />,
    );

    const highlighted = screen.getByRole("button", { name: "kiküldésre kész" });
    const quiet = screen.getByRole("button", { name: "javításra vár" });

    // A KIEMELT GOMB NEM ALÁHÚZOTT SZÖVEG, a halkított igen. A két állítás
    // EGYÜTT mér: ha minden gomb egyforma lenne, az egyik pirosodna.
    expect(highlighted.className).not.toContain("underline");
    expect(quiet.className).toContain("underline");
  });

  /**
   * ÉS A HOZZÁSZÓLÁS UGYANOLYAN HALK, MINT A TÖBBI MÁSODLAGOS VEZÉRLŐ.
   *
   * MÉRVE 2026-09-01, picasso találta meg a friss ágon: a lépés-gombok a
   * `MoveButton`-on mennek át, a hozzászólás nem, ezért a halk alak csak az
   * előbbiekre került rá. A soron így „egy kiemelt, kettő halk és egy közepes"
   * állt -- pont az az egyenetlen súlyozás, ami ellen az egész javaslat készült.
   *
   * EZ AZ ÁLLÍTÁS AZÉRT KELL, mert a hiba SEMMILYEN meglévő tesztet nem
   * buktatott: minden gomb ott volt, minden kattintás működött, csak a súlyuk
   * volt más. Amit nem mérünk, azt a következő átrendezés újra elronthatja.
   */
  it("keeps the comment control as quiet as the secondary steps", () => {
    render(
      <ContentRowActions
        item={item({ moves: [approvingStep, ordinaryStep] })}
        onDone={() => {}}
      />,
    );

    const secondary = screen.getByRole("button", { name: "lektorálásra vár" });
    const comment = screen.getByRole("button", { name: "Hozzászólás" });

    expect(comment.className).toContain("underline");
    // ÉS UGYANAZ AZ ALAK, nem csak „szintén aláhúzott": ha a kettő egy nap
    // eltérne, ez az állítás mondja meg, nem egy képernyőkép.
    for (const shape of ["px-1", "underline-offset-2"])
      expect(comment.className).toContain(shape);
    expect(secondary.className).toContain("underline-offset-2");
  });
});

describe("a step that asks for text first", () => {
  /**
   * MELYIK LÉPÉS KÉR SZÖVEGET, AZT A SZERVER MONDJA MEG.
   *
   * Korábban itt egy állapotnév állt (`ha ez elvetés, kérj okot`), vagyis egy
   * szabály-másolat a felületen. Ez az állítás azt méri, hogy a képernyő a
   * KAPOTT `note` mezőt követi: a visszaküldés ugyanúgy mezőt nyit, pedig róla
   * ez a fájl semmit nem tud.
   */
  it("opens the field for any step the server marked, not just discarding", () => {
    render(
      <ContentRowActions
        item={item({
          state: "AWAITING_REVIEW",
          moves: [
            {
              to: "AWAITING_REVISION",
              requiresApproval: false,
              blockedByExternalWork: null,
              primary: false,
              note: {
                field: "revisionNote" as const,
                label: "Mit kell javítani?",
              },
            },
          ],
        })}
        onDone={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "javításra vár" }));

    // A KÉRDÉS SZÖVEGE IS A SZERVERTŐL JÖN, nem innen.
    expect(screen.getByLabelText("Mit kell javítani?")).toBeTruthy();
    // ÉS SZÖVEG NÉLKÜL NEM INDUL EL.
    expect(api.move).not.toHaveBeenCalled();
  });

  /**
   * ÉS A MEZŐ NEVE IS ONNAN JÖN. Ez a különbség számít: ha a felület találná ki,
   * hogy a szöveg `discardReason` néven megy vissza, a visszaküldés csendben
   * rossz mezőt küldene, és a szerver azt mondaná, hogy hiányzik a felvetés --
   * miközben a felhasználó látja, hogy beírta.
   */
  it("sends the text under the name the server gave", async () => {
    render(
      <ContentRowActions
        item={item({
          state: "AWAITING_REVIEW",
          moves: [
            {
              to: "AWAITING_REVISION",
              requiresApproval: false,
              blockedByExternalWork: null,
              primary: false,
              note: {
                field: "revisionNote" as const,
                label: "Mit kell javítani?",
              },
            },
          ],
        })}
        onDone={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "javításra vár" }));
    fireEvent.change(screen.getByLabelText("Mit kell javítani?"), {
      target: { value: "a második bekezdés két állítást kever" },
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: "javításra vár" })[1]!,
    );

    await waitFor(() => expect(api.move).toHaveBeenCalledTimes(1));
    expect(api.move.mock.calls[0]![2]).toMatchObject({
      to: "AWAITING_REVISION",
      revisionNote: "a második bekezdés két állítást kever",
    });
    // ÉS NEM A MÁSIK MEZŐ NEVÉN. E nélkül az állítás attól is zöld lenne, hogy
    // mindkettőt elküldjük.
    expect(api.move.mock.calls[0]![2]).not.toHaveProperty("discardReason");
  });

  /**
   * AMELYIK LÉPÉS NEM KÉR SZÖVEGET, AZ AZONNAL INDUL. Enélkül a javítás túl
   * sokat zárna be: minden gomb egy mezőt nyitna, és a jóváhagyás is kérdezne.
   */
  it("still runs a plain step straight away", async () => {
    render(
      <ContentRowActions
        item={item({ moves: [approvingStep] })}
        onDone={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "kiküldésre kész" }));

    await waitFor(() => expect(api.move).toHaveBeenCalledTimes(1));
  });
});
