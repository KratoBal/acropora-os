import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  ContentDetail,
  TeachingNumber,
  TeachingOutputSummary,
  TeachingSourceDetail,
  TeachingSourceEditorData,
  UserRole,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TeachingSourcePage } from "./teaching-source-page";
import {
  parseTeachingInflections,
  parseTeachingPairs,
  parseTeachingValue,
  teachingPairsText,
  teachingValueText,
} from "./teaching-source-form";

/*
  THE TEACHING SOURCE PAGE (T5.2, slice 3). What turns this red:
  - a save sends something else than the form (the value text not turned
    into the structure, the version guard missing);
  - a contradicting number shown without its open-question mark, or a broken
    reference that still reaches the server;
  - a locked source (sent for approval) can still be edited or saved;
  - outputs offered for generation before the approval, or a stale output
    offered for the "went out" record;
  - the number text fields reading 2-4 or 1,026 wrongly.
*/
const api = vi.hoisted(() => ({
  detail: vi.fn(),
  teachingSource: vi.fn(),
  saveTeachingSource: vi.fn(),
  teachingOutputs: vi.fn(),
  generateTeachingOutput: vi.fn(),
  markTeachingOutputSent: vi.fn(),
  downloadTeachingOutput: vi.fn(),
  teachingOutputEdits: vi.fn(),
  teachingOutputEdit: vi.fn(),
  uploadTeachingOutputEdit: vi.fn(),
  decideTeachingOutputEdit: vi.fn(),
}));
let role: UserRole = "OWNER";

vi.mock("@/lib/api/content", () => ({ contentApi: api }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      token: "token-1",
      user: { id: "user-1", email: "b@acropora.local", role },
    },
  }),
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

const item = (over: Partial<ContentDetail> = {}): ContentDetail =>
  ({
    id: "c1",
    title: "Az első hat hét",
    channel: "TEACHING_SOURCE",
    state: "DRAFTING",
    body: null,
    comments: [],
    moves: [],
    ...over,
  }) as unknown as ContentDetail;

const num = (
  over: Partial<TeachingNumber> & { id: string },
): TeachingNumber => ({
  name: over.id,
  context: null,
  approx: false,
  quantity: { value: { kind: "exact", value: 50 }, unit: "ml" },
  pairs: [],
  partKey: null,
  display: "50 ml",
  short: "50 ml",
  spoken: null,
  inflections: [],
  state: "OK",
  note: null,
  ...over,
});

const stored = (
  over: Partial<TeachingSourceDetail> = {},
): TeachingSourceDetail => ({
  contentId: "c1",
  subtitle: null,
  author: "Akil, Modern Reef blog",
  editor: null,
  audience: "INTERNAL",
  publicBasis: null,
  disclaimer: null,
  parts: [
    {
      key: "elso",
      title: "Indulás",
      text: "Adag: {szám: adag}.",
      subparts: [],
      checklist: [],
      speakerNote: null,
    },
  ],
  numbers: [num({ id: "adag", name: "Nitri-Bac adag" })],
  version: 2,
  contentHash: "h",
  approvedVersion: null,
  versions: [],
  updatedAt: "2026-11-15T08:00:00.000Z",
  ...over,
});

const data = (
  source: TeachingSourceDetail | null,
  editable = true,
): TeachingSourceEditorData => ({ source, analysis: null, editable });

const output = (
  over: Partial<TeachingOutputSummary> = {},
): TeachingOutputSummary => ({
  id: "o1",
  kind: "SLIDES",
  sourceVersion: 2,
  generatedById: "user-1",
  generatedAt: "2026-11-15T08:00:00.000Z",
  stale: false,
  approved: true,
  overFrame: 0,
  chaptersWithoutNarration: 0,
  edits: 0,
  undecidedEdits: 0,
  sent: null,
  ...over,
});

beforeEach(() => {
  role = "OWNER";
  for (const fn of Object.values(api)) fn.mockReset();
  api.detail.mockResolvedValue(item());
  api.teachingSource.mockResolvedValue(data(stored()));
  api.teachingOutputs.mockResolvedValue([]);
  api.teachingOutputEdits.mockResolvedValue([]);
});

describe("the number text fields", () => {
  it("read a value, a range with a decimal comma, pairs and inflections", () => {
    expect(parseTeachingValue("1,026")).toEqual({
      kind: "exact",
      value: 1.026,
    });
    expect(parseTeachingValue("2-4")).toEqual({
      kind: "range",
      min: 2,
      max: 4,
    });
    expect(parseTeachingValue("2–4")).toEqual({
      kind: "range",
      min: 2,
      max: 4,
    });
    expect(parseTeachingValue("4-2")).toBeNull();
    expect(parseTeachingValue("kb. 4")).toBeNull();
    expect(teachingValueText({ kind: "exact", value: 1.026 })).toBe("1,026");
    // never in exponent form (barracuda on #2581), and read back
    expect(teachingValueText({ kind: "exact", value: 1e-7 })).toBe("0,0000001");
    expect(parseTeachingValue("0,0000001")).toEqual({
      kind: "exact",
      value: 1e-7,
    });
    expect(parseTeachingPairs("35 PSU; 2-3 ppt")).toEqual([
      { value: { kind: "exact", value: 35 }, unit: "PSU" },
      { value: { kind: "range", min: 2, max: 3 }, unit: "ppt" },
    ]);
    expect(teachingPairsText(parseTeachingPairs("35 PSU") ?? [])).toBe(
      "35 PSU",
    );
    expect(parseTeachingPairs("PSU")).toBeNull();
    expect(
      parseTeachingInflections("hétig = 4 hétig | négy hétig\n\nnap = 3 napig"),
    ).toEqual([
      { name: "hétig", written: "4 hétig", spoken: "négy hétig" },
      { name: "nap", written: "3 napig", spoken: null },
    ]);
    expect(parseTeachingInflections("= x")).toBeNull();
  });
});

describe("TeachingSourcePage", () => {
  it("saves the form as the structure, with the version it was made on", async () => {
    api.saveTeachingSource.mockResolvedValue(data(stored({ version: 3 })));
    render(<TeachingSourcePage contentId="c1" />);
    const value = await screen.findByLabelText("Érték (szám vagy tartomány)");
    fireEvent.change(value, { target: { value: "2-4" } });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() =>
      expect(api.saveTeachingSource).toHaveBeenCalledTimes(1),
    );
    const [, id, input] = api.saveTeachingSource.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(id).toBe("c1");
    expect(input.baseVersion).toBe(2);
    expect((input.numbers as TeachingNumber[])[0]?.quantity).toEqual({
      value: { kind: "range", min: 2, max: 4 },
      unit: "ml",
    });
    expect(await screen.findByText("Mentve")).toBeTruthy();
  });

  it("names a broken reference and does not send it", async () => {
    render(<TeachingSourcePage contentId="c1" />);
    const text = await screen.findByLabelText("Szöveg");
    fireEvent.change(text, { target: { value: "Adag: {szám: nincs-ilyen}." } });
    expect(await screen.findByText("Hibás szám-hivatkozás")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() =>
      expect(screen.getByText("A mentés nem ment át")).toBeTruthy(),
    );
    expect(api.saveTeachingSource).not.toHaveBeenCalled();
  });

  it("marks two values for one quantity as an open question, and shows where a number stands", async () => {
    api.teachingSource.mockResolvedValue(
      data(
        stored({
          numbers: [
            num({ id: "ciklus-a", name: "Ciklus" }),
            num({
              id: "ciklus-b",
              name: "Ciklus",
              quantity: {
                value: { kind: "range", min: 2, max: 6 },
                unit: "hét",
              },
            }),
            num({ id: "adag", name: "Nitri-Bac adag" }),
          ],
        }),
      ),
    );
    render(<TeachingSourcePage contentId="c1" />);
    expect(
      await screen.findByText("Nyitott kérdés: a forrás így nem hagyható jóvá"),
    ).toBeTruthy();
    expect(screen.getAllByText("nyitott kérdés")).toHaveLength(2);
    expect(screen.getByText("Hol szerepel: Indulás (szöveg)")).toBeTruthy();
  });

  it("a locked source cannot be edited or saved", async () => {
    api.teachingSource.mockResolvedValue(data(stored(), false));
    render(<TeachingSourcePage contentId="c1" />);
    expect(
      await screen.findByText("A forrás most nem szerkeszthető"),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("Szöveg") as HTMLTextAreaElement).disabled,
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Mentés" })).toBeNull();
  });

  it("offers generation only for an approved source, and the went-out record only for a current, approved output", async () => {
    api.teachingOutputs.mockResolvedValue([
      output({ id: "o1" }),
      output({ id: "o2", stale: true, approved: false, kind: "PRINTABLE" }),
    ]);
    render(<TeachingSourcePage contentId="c1" />);
    expect(
      await screen.findByText(/Kimenet a jóváhagyott forrásból készül/),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /generálása/ })).toBeNull();
    await screen.findByText("elavult");
    expect(
      screen.getAllByRole("button", { name: "Kiment rögzítése" }),
    ).toHaveLength(1);
  });

  it("generates from an approved source", async () => {
    api.detail.mockResolvedValue(
      item({ state: "READY_TO_SEND" } as Partial<ContentDetail>),
    );
    api.teachingSource.mockResolvedValue(
      data(stored({ approvedVersion: 2 }), false),
    );
    api.generateTeachingOutput.mockResolvedValue({});
    render(<TeachingSourcePage contentId="c1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Diasor (PPTX) generálása" }),
    );
    await waitFor(() =>
      expect(api.generateTeachingOutput).toHaveBeenCalledWith(
        "token-1",
        "c1",
        "SLIDES",
      ),
    );
  });

  it("an edited deck: the upload, the slide that differs, and the decision once", async () => {
    api.teachingOutputs.mockResolvedValue([
      output({ id: "o1", edits: 1, undecidedEdits: 1 }),
    ]);
    const detail = {
      id: "e1",
      outputId: "o1",
      fileName: "luca.pptx",
      sizeBytes: 10,
      sha256: "h",
      uploadedById: "user-1",
      uploadedAt: "2026-11-15T09:00:00.000Z",
      changes: 1,
      decision: null,
      diff: {
        kind: "SLIDES",
        changed: 1,
        slides: [
          {
            position: 2,
            change: "CHANGED",
            generated: { title: "Indulás", points: ["Várj 4 hetet."] },
            edited: { title: "Indulás", points: ["Várj 6 hetet."] },
            removedPoints: ["Várj 4 hetet."],
            addedPoints: ["Várj 6 hetet."],
            titleChanged: false,
          },
        ],
      },
    };
    api.teachingOutputEdits.mockResolvedValue([detail]);
    api.uploadTeachingOutputEdit.mockResolvedValue(detail);
    api.decideTeachingOutputEdit.mockResolvedValue({
      ...detail,
      decision: {
        toSource: true,
        note: null,
        byId: "user-1",
        at: "2026-11-15T09:05:00.000Z",
      },
    });
    const { container } = render(<TeachingSourcePage contentId="c1" />);
    expect(
      await screen.findByText(/eltér a forrástól, 1 döntésre vár/),
    ).toBeTruthy();
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["x"], "luca.pptx");
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() =>
      expect(api.uploadTeachingOutputEdit).toHaveBeenCalledWith(
        "token-1",
        "c1",
        "o1",
        file,
      ),
    );
    expect(await screen.findByText("Várj 4 hetet.")).toBeTruthy();
    expect(screen.getByText("Várj 6 hetet.")).toBeTruthy();
    const toSource = screen.getByRole("button", {
      name: "A forrásba átvezetendő",
    }) as HTMLButtonElement;
    // the upload step still reloads the lists; the buttons wait for it
    await waitFor(() => expect(toSource.disabled).toBe(false));
    fireEvent.click(toSource);
    await waitFor(() =>
      expect(api.decideTeachingOutputEdit).toHaveBeenCalledWith(
        "token-1",
        "c1",
        "o1",
        "e1",
        {
          toSource: true,
          note: null,
        },
      ),
    );
    expect(
      await screen.findByText(/Döntés: a változás a forrásba átvezetendő/),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "A forrásba átvezetendő" }),
    ).toBeNull();
  });

  it("an edited PDF: the upload takes a .pdf, and the difference is shown by sentence", async () => {
    api.teachingOutputs.mockResolvedValue([
      output({ id: "o2", kind: "PRINTABLE", edits: 1, undecidedEdits: 1 }),
    ]);
    const detail = {
      id: "e2",
      outputId: "o2",
      fileName: "anyag.pdf",
      sizeBytes: 10,
      sha256: "h",
      uploadedById: "user-1",
      uploadedAt: "2026-11-15T09:00:00.000Z",
      changes: 1,
      decision: null,
      diff: {
        kind: "TEXT",
        removed: ["Indulás Várj 4 hetet."],
        added: ["Indulás Várj 6 hetet."],
        same: 5,
        changed: 1,
      },
    };
    api.teachingOutputEdits.mockResolvedValue([detail]);
    api.teachingOutputEdit.mockResolvedValue(detail);
    render(<TeachingSourcePage contentId="c1" />);
    const input = (await screen.findByLabelText(
      "Szerkesztett PDF feltöltése (.pdf)",
    )) as HTMLInputElement;
    expect(input.accept).toBe(".pdf,application/pdf");
    expect(await screen.findByText("1 mondat eltér")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Eltérés megnézése" }));
    expect(await screen.findByText("Indulás Várj 4 hetet.")).toBeTruthy();
    expect(screen.getByText("Indulás Várj 6 hetet.")).toBeTruthy();
    expect(screen.getByText(/1 mondat tér el a generálttól/)).toBeTruthy();
  });
});
