import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type {
  ArticleDetail,
  ArticleEditorData,
  ContentDetail,
  UserRole,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ArticleEditorPage, suggestArticleSlug } from "./article-editor-page";

/*
  THE ARTICLE EDITOR (the full editor's third place). What turns this red:
  - a new article does not start from the title's slug and the blog channel;
  - a save sends something else than the form (products in order, taxa), or
    a malformed body reaches the server instead of being named first;
  - a locked article (sent for approval) can still be edited or saved;
  - an image from a host the save would drop can be inserted or previewed.
*/
const api = vi.hoisted(() => ({
  detail: vi.fn(),
  article: vi.fn(),
  saveArticle: vi.fn(),
  uploadArticleImage: vi.fn(),
}));
const products = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn() }));
// the citation panel (S5) reads the knowledge base: never the network here
const knowledge = vi.hoisted(() => ({
  citations: vi.fn(),
  claimStore: vi.fn(),
  conclusions: vi.fn(),
}));
let role: UserRole = "OWNER";

vi.mock("@/lib/api/content", () => ({ contentApi: api }));
vi.mock("@/lib/api/products", () => ({ productApi: products }));
vi.mock("@/lib/api/knowledge-base", () => ({ knowledgeBaseApi: knowledge }));
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
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const contentDetail = (over: Partial<ContentDetail> = {}): ContentDetail =>
  ({
    id: "c1",
    title: "Zöld Acropora gondozása",
    channel: "ARTICLE",
    state: "DRAFTING",
    body: null,
    comments: [],
    moves: [],
    ...over,
  }) as unknown as ContentDetail;

const stored: ArticleDetail = {
  contentId: "c1",
  slug: "zold-acropora",
  excerpt: "Bevezető",
  bodyHtml: "<p>Szöveg</p>",
  coverImageUrl: null,
  coverImageAlt: null,
  channels: ["WEBSHOP_BLOG"],
  byline: null,
  seoTitle: null,
  metaDescription: null,
  ogImageUrl: null,
  noindex: false,
  products: [
    { productId: "p2", name: "Második", sortOrder: 1 },
    { productId: "p1", name: "Első", sortOrder: 0 },
  ],
  taxonKeys: ["ACROPORA"],
  approvedRevision: null,
  publishedRevision: null,
  publishedAt: null,
  revisions: [],
  updatedAt: "2026-10-26T12:00:00.000Z",
};

const editorData = (
  over: Partial<ArticleEditorData> = {},
): ArticleEditorData => ({
  article: stored,
  editable: true,
  imageHosts: ["static.acropora.hu"],
  taxonOptions: [
    { key: "ACROPORA", rank: "GENUS", label: "Acropora" },
    { key: "MONTIPORA", rank: "GENUS", label: "Montipora" },
  ],
  ...over,
});

beforeEach(() => {
  role = "OWNER";
  api.detail.mockReset().mockResolvedValue(contentDetail());
  api.article.mockReset().mockResolvedValue(editorData());
  api.saveArticle.mockReset().mockResolvedValue({ article: stored });
  api.uploadArticleImage.mockReset().mockResolvedValue({
    id: "cimg",
    url: "https://static.acropora.hu/public/article-images/cimg",
  });
  products.list.mockReset().mockResolvedValue({ items: [] });
  products.detail.mockReset();
  knowledge.citations.mockReset().mockResolvedValue({
    contentId: "c1",
    editable: true,
    vocabulary: { version: 1, status: "APPROVED" },
    sentences: [],
    orphaned: [],
    blockers: [],
    counts: {
      sentences: 0,
      uncited: 0,
      invalid: 0,
      unansweredWarnings: 0,
      orphaned: 0,
    },
    clean: false,
    targets: [],
  });
  knowledge.claimStore.mockReset().mockResolvedValue({
    claims: [],
    total: 0,
    layers: {},
  });
  knowledge.conclusions.mockReset().mockResolvedValue([]);
});

const loaded = async () => {
  render(<ArticleEditorPage contentId="c1" />);
  await screen.findByRole("heading", {
    level: 1,
    name: "Zöld Acropora gondozása",
  });
};

/**
 * THE EDITOR EXISTS, not only its toolbar. The rich-text editor is created in
 * an effect (`immediatelyRender: false`), and until then a toolbar click does
 * nothing: under CI load the "Kép beszúrása" click landed in that gap, the
 * image panel never opened, and its label was not found (card c25e6465, #1920
 * and #1917). The editable area carries the editor's name only once the
 * editor is there, so waiting for it waits for the editor, not for a time.
 */
const editorReady = () =>
  waitFor(() =>
    expect(
      document.querySelector('[contenteditable][aria-label="Cikk szövege"]'),
    ).not.toBeNull(),
  );

describe("suggestArticleSlug", () => {
  it("turns a Hungarian title into the URL part", () => {
    expect(suggestArticleSlug("Zöld Acropora: gondozás & etetés!")).toBe(
      "zold-acropora-gondozas-etetes",
    );
    expect(suggestArticleSlug("  ")).toBe("");
  });
});

describe("ArticleEditorPage", () => {
  it("starts a new article from the title's slug and the blog channel", async () => {
    api.article.mockResolvedValue(editorData({ article: null }));
    await loaded();
    expect(screen.getByLabelText("URL-rész")).toHaveValue(
      "zold-acropora-gondozasa",
    );
    expect(
      screen.getByRole("checkbox", { name: "Webshop blog" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "ReefClub" }),
    ).not.toBeChecked();
  });

  it("saves what the form holds: the products in order, the taxa, the channels", async () => {
    await loaded();
    // the stored order is by sortOrder, not by the array
    const list = screen.getByRole("list", { name: "Kapcsolódó termékek" });
    expect(list.textContent).toMatch(/Első.*Második/);
    fireEvent.click(screen.getByRole("button", { name: "Második feljebb" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "ReefClub" }));
    fireEvent.click(screen.getByRole("button", { name: /Montipora/ }));
    fireEvent.change(screen.getByLabelText(/^SEO cím/), {
      target: { value: "  Acropora SEO  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));

    await waitFor(() => expect(api.saveArticle).toHaveBeenCalledTimes(1));
    expect(api.saveArticle.mock.calls[0]).toEqual([
      "token-1",
      "c1",
      expect.objectContaining({
        slug: "zold-acropora",
        channels: ["WEBSHOP_BLOG", "REEFCLUB"],
        productIds: ["p2", "p1"],
        taxonKeys: ["ACROPORA", "MONTIPORA"],
        seoTitle: "Acropora SEO",
        coverImageUrl: null,
      }),
    ]);
    expect(await screen.findByText("Mentve")).toBeInTheDocument();
  });

  it("names a malformed body before it reaches the server", async () => {
    await loaded();
    fireEvent.change(screen.getByLabelText("URL-rész"), {
      target: { value: "Rossz Cím" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(await screen.findByText("A mentés nem ment át")).toBeInTheDocument();
    expect(api.saveArticle).not.toHaveBeenCalled();
  });

  it("shows the server's refusal", async () => {
    api.saveArticle.mockRejectedValue(new Error("Ez az URL-rész már foglalt."));
    await loaded();
    fireEvent.change(screen.getByLabelText("Szerző"), {
      target: { value: "Balázs" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(
      await screen.findByText("Ez az URL-rész már foglalt."),
    ).toBeInTheDocument();
  });

  it("locks an article that is past the reviewer: no editor, no save", async () => {
    api.detail.mockResolvedValue(contentDetail({ state: "AWAITING_APPROVAL" }));
    api.article.mockResolvedValue(editorData({ editable: false }));
    await loaded();
    expect(
      screen.getByText("A cikk most nem szerkeszthető"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Cikk szövege")).toBeNull();
    expect(screen.queryByRole("button", { name: "Mentés" })).toBeNull();
    expect(screen.getByLabelText("URL-rész")).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Termék hozzáadása" }),
    ).toBeNull();
  });

  it("is read-only without content.manage", async () => {
    role = "VIEWER";
    await loaded();
    expect(screen.getByText("Csak olvasható")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mentés" })).toBeNull();
  });

  it("takes an image only from the save's hosts, in the body and as the cover", async () => {
    await loaded();
    await editorReady();
    fireEvent.click(screen.getByRole("button", { name: "Kép beszúrása" }));
    const cim = screen.getByLabelText("Kép címe");
    fireEvent.change(cim, { target: { value: "https://cdn.unas.hu/a.jpg" } });
    expect(screen.getByRole("button", { name: "Beszúrás" })).toBeDisabled();
    fireEvent.change(cim, {
      target: { value: "https://static.acropora.hu/a.jpg" },
    });
    expect(screen.getByRole("button", { name: "Beszúrás" })).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Borítókép címe"), {
      target: { value: "https://cdn.unas.hu/b.jpg" },
    });
    expect(
      screen.getAllByText("Kép csak https címről, a saját képtárhelyről jöhet.")
        .length,
    ).toBeGreaterThan(0);
    const preview = screen.getByRole("region", { name: "Élő előnézet" });
    expect(preview.querySelector('img[src*="cdn.unas.hu"]')).toBeNull();
  });

  it("previews the body through the save's cleaning", async () => {
    api.article.mockResolvedValue(
      editorData({
        article: {
          ...stored,
          bodyHtml:
            '<p>a</p><p><img src="https://static.acropora.hu/x.jpg" alt="x"><img src="https://cdn.unas.hu/y.jpg" alt="y"></p>',
        },
      }),
    );
    await loaded();
    const preview = screen.getByRole("region", { name: "Élő előnézet" });
    await act(async () => {});
    expect(
      preview.querySelector('img[src*="static.acropora.hu"]'),
    ).not.toBeNull();
    expect(preview.querySelector('img[src*="cdn.unas.hu"]')).toBeNull();
  });

  it("refuses an item that is not an article", async () => {
    api.detail.mockResolvedValue(contentDetail({ channel: "FACEBOOK_POST" }));
    render(<ArticleEditorPage contentId="c1" />);
    expect(await screen.findByText("Ez a tétel nem cikk")).toBeInTheDocument();
  });

  /*
    THE UPLOAD (acrobot, msg 36320): the file goes to the OS's store and its
    public address lands where it was asked for; a refusal is said, not lost.
  */
  it("uploads a body image and puts its address in the image panel", async () => {
    await loaded();
    await editorReady();
    fireEvent.click(screen.getByRole("button", { name: "Kép beszúrása" }));
    const file = new File(["x"], "a.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Kép feltöltése"), {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Kép címe")).toHaveValue(
        "https://static.acropora.hu/public/article-images/cimg",
      ),
    );
    expect(api.uploadArticleImage).toHaveBeenCalledWith("token-1", "c1", file);
    expect(screen.getByRole("button", { name: "Beszúrás" })).toBeEnabled();
  });

  it("uploads the cover and fills its field", async () => {
    await loaded();
    fireEvent.change(screen.getByLabelText("Borítókép feltöltése"), {
      target: { files: [new File(["x"], "b.jpg", { type: "image/jpeg" })] },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Borítókép címe")).toHaveValue(
        "https://static.acropora.hu/public/article-images/cimg",
      ),
    );
  });

  it("says why an upload was refused", async () => {
    api.uploadArticleImage.mockRejectedValue(
      new Error(
        "A cikk-képek publikus címe ebben a környezetben nincs beállítva",
      ),
    );
    await loaded();
    fireEvent.change(screen.getByLabelText("Borítókép feltöltése"), {
      target: { files: [new File(["x"], "b.jpg", { type: "image/jpeg" })] },
    });
    expect(
      await screen.findByText(/publikus címe ebben a környezetben/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Borítókép címe")).toHaveValue("");
  });

  it("offers no upload on a locked article", async () => {
    api.article.mockResolvedValue(editorData({ editable: false }));
    await loaded();
    expect(screen.queryByLabelText("Borítókép feltöltése")).toBeNull();
  });
});
