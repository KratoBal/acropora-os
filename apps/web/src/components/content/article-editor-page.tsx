"use client";

import { isAllowedFullImageSrc } from "@acropora/rich-text";
import {
  ARTICLE_CHANNELS,
  ARTICLE_LIMITS,
  hasPermission,
  parseArticleBodyInput,
  PERMISSIONS,
  type ArticleBodyInput,
  type ArticleChannel,
  type ArticleDetail,
  type ArticleTaxonOption,
  type ContentDetail,
  type ProductListItem,
} from "@acropora/types";
import {
  Alert,
  Button,
  FormField,
  Input,
  Skeleton,
  Textarea,
} from "@acropora/ui";
import {
  RichTextEditor,
  type RichTextEditorHandle,
} from "@acropora/ui/rich-text-editor";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  WebContentPreview,
  type PreviewProductCard,
} from "@/components/rich-text/web-content-preview";
import { contentApi } from "@/lib/api/content";
import { productApi } from "@/lib/api/products";

import { ArticleCitationsPanel } from "./article-citations-panel";
import { ArticleRevisions } from "./article-revision-diff";
import { CONTENT_STATE_LABELS } from "./content-labels";

/**
 * A CIKK SZERKESZTŐJE (a teljes szerkesztő négy helyének harmadika; Balázs,
 * 2026-10-25 22:30 UTC, msg 1564043552525389924; a modell: acrobot 36158, A
 * változat, a meglévő tartalom-tételen). Saját Figma nincs: a Tartalom sorában
 * a FIGMA-MAP „nincs"-et mond, és a felület a termékleírás és a kezdőlap
 * szerkesztőjének mintáját követi.
 *
 * A JÓVÁHAGYÁS NEM ITT VAN, hanem a tétel útján (Tartalom lista, `content.approve`).
 * Ez a lap csak a törzset írja, és csak amíg a szerver szerint szerkeszthető
 * (`editable`): a jóváhagyásra küldött szöveg nem változhat észrevétlenül.
 *
 * KÉP FELTÖLTÉSSEL VAGY CÍMMEL. A feltöltött kép az OS saját tárolójába kerül,
 * publikus címmel (acrobot döntése, msg 36320); címmel csak a mentés
 * hoszt-listájáról (`RICH_TEXT_IMAGE_HOSTS`, a szerver adja) jöhet kép.
 */

const CHANNEL_LABELS: Record<ArticleChannel, string> = {
  WEBSHOP_BLOG: "Webshop blog",
  REEFCLUB: "ReefClub",
};

const KARTYA_AZONOSITO = /data-product-card="([a-z0-9]+)"/g;
const KARTYA_BETOLTES_FELSO_HATAR = 12;

/** A cím javasolt URL-része; csak javaslat, a mező szabadon írható. */
export function suggestArticleSlug(title: string): string {
  const s = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length <= ARTICLE_LIMITS.slug) return s;
  const cut = s.slice(0, ARTICLE_LIMITS.slug + 1);
  const i = cut.lastIndexOf("-");
  return (i > 0 ? cut.slice(0, i) : s.slice(0, ARTICLE_LIMITS.slug)).replace(
    /-$/,
    "",
  );
}

interface LinkedProduct {
  id: string;
  name: string;
}

interface FormState {
  slug: string;
  excerpt: string;
  bodyHtml: string;
  coverImageUrl: string;
  coverImageAlt: string;
  channels: ArticleChannel[];
  byline: string;
  seoTitle: string;
  metaDescription: string;
  ogImageUrl: string;
  noindex: boolean;
  products: LinkedProduct[];
  taxonKeys: string[];
}

function formFrom(article: ArticleDetail | null, title: string): FormState {
  return {
    slug: article?.slug ?? suggestArticleSlug(title),
    excerpt: article?.excerpt ?? "",
    bodyHtml: article?.bodyHtml ?? "",
    coverImageUrl: article?.coverImageUrl ?? "",
    coverImageAlt: article?.coverImageAlt ?? "",
    channels: article?.channels ?? ["WEBSHOP_BLOG"],
    byline: article?.byline ?? "",
    seoTitle: article?.seoTitle ?? "",
    metaDescription: article?.metaDescription ?? "",
    ogImageUrl: article?.ogImageUrl ?? "",
    noindex: article?.noindex ?? false,
    products: [...(article?.products ?? [])]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((link) => ({ id: link.productId, name: link.name })),
    taxonKeys: article?.taxonKeys ?? [],
  };
}

const orNull = (text: string) => (text.trim() ? text.trim() : null);

/** A mentendő alak; a szerver ugyanezt a szigorú ellenőrzést futtatja. */
export function articleInputFrom(form: FormState): ArticleBodyInput {
  return {
    slug: form.slug.trim(),
    excerpt: form.excerpt.trim(),
    bodyHtml: form.bodyHtml,
    coverImageUrl: orNull(form.coverImageUrl),
    coverImageAlt: orNull(form.coverImageAlt),
    channels: form.channels,
    byline: orNull(form.byline),
    seoTitle: orNull(form.seoTitle),
    metaDescription: orNull(form.metaDescription),
    ogImageUrl: orNull(form.ogImageUrl),
    noindex: form.noindex,
    productIds: form.products.map((product) => product.id),
    taxonKeys: form.taxonKeys,
  };
}

const arCimke = (termek: Pick<ProductListItem, "grossPrice">) =>
  termek.grossPrice
    ? `${Number(termek.grossPrice).toLocaleString("hu-HU", {
        maximumFractionDigits: 0,
      })} Ft`
    : null;

const elonezetKartya = (termek: ProductListItem): PreviewProductCard => ({
  id: termek.id,
  name: termek.name,
  priceLabel: arCimke(termek),
  imageUrl: termek.thumbnail?.url ?? null,
});

const dateTime = (iso: string) => new Date(iso).toLocaleString("hu-HU");

function ProductSearch({
  token,
  label,
  onPick,
  onCancel,
}: {
  token: string;
  label: string;
  onPick: (product: ProductListItem) => void;
  onCancel: () => void;
}) {
  const [kereses, setKereses] = useState("");
  const [talalatok, setTalalatok] = useState<ProductListItem[]>([]);
  useEffect(() => {
    if (kereses.trim().length < 2) {
      setTalalatok([]);
      return;
    }
    let aktiv = true;
    const idozito = setTimeout(() => {
      void productApi
        .list(token, { search: kereses.trim(), pageSize: 8 })
        .then((valasz) => {
          if (aktiv) setTalalatok(valasz.items);
        })
        .catch(() => {
          if (aktiv) setTalalatok([]);
        });
    }, 250);
    return () => {
      aktiv = false;
      clearTimeout(idozito);
    };
  }, [token, kereses]);
  return (
    <div
      role="group"
      aria-label={label}
      className="space-y-2 rounded-lg border border-pilot-grey-200 p-2"
    >
      <input
        aria-label="Termék keresése"
        value={kereses}
        placeholder="Termék neve vagy cikkszáma"
        onChange={(event) => setKereses(event.target.value)}
        className="w-full rounded-md border border-pilot-grey-200 px-2 py-1 text-sm"
      />
      <ul className="space-y-1">
        {talalatok.map((termek) => (
          <li key={termek.id}>
            <button
              type="button"
              onClick={() => onPick(termek)}
              className="w-full rounded px-2 py-1 text-left text-sm hover:bg-pilot-grey-50"
            >
              {termek.name}
              {termek.primarySku ? (
                <span className="ml-2 text-xs text-pilot-grey-500">
                  {termek.primarySku}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onCancel}
        className="text-xs text-pilot-grey-600"
      >
        Mégse
      </button>
    </div>
  );
}

export function ArticleEditorPage({ contentId }: { contentId: string }) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.CONTENT_MANAGE),
  );
  // the research knowledge base's citation check (S5): its own permissions
  const canSeeCitations = Boolean(
    session && hasPermission(session.user, PERMISSIONS.KNOWLEDGE_VIEW),
  );
  const canCite = Boolean(
    session && hasPermission(session.user, PERMISSIONS.KNOWLEDGE_MANAGE),
  );
  const [citationReload, setCitationReload] = useState(0);

  const [item, setItem] = useState<ContentDetail | null>(null);
  const [editable, setEditable] = useState(false);
  const [imageHosts, setImageHosts] = useState<string[]>([]);
  const [taxonOptions, setTaxonOptions] = useState<ArticleTaxonOption[]>([]);
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  const szerkeszto = useRef<RichTextEditorHandle>(null);
  const [panel, setPanel] = useState<"image" | "productCard" | "linked" | null>(
    null,
  );
  const [kepCim, setKepCim] = useState("");
  const [kepAlt, setKepAlt] = useState("");
  const [taxonSzuro, setTaxonSzuro] = useState("");
  const [uploading, setUploading] = useState<"body" | "cover" | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [kartyak, setKartyak] = useState<
    ReadonlyMap<string, PreviewProductCard>
  >(() => new Map());
  const kertKartyak = useRef(new Set<string>());

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    Promise.all([
      contentApi.detail(token, contentId, controller.signal),
      contentApi.article(token, contentId, controller.signal),
    ])
      .then(([detail, data]) => {
        setItem(detail);
        setEditable(data.editable);
        setImageHosts(data.imageHosts);
        setTaxonOptions(data.taxonOptions);
        setArticle(data.article);
        setForm(formFrom(data.article, detail.title));
        setDirty(false);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setLoadError(
          cause instanceof Error ? cause.message : "A cikk nem tölthető be.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [contentId, token]);

  /* A szövegben álló termékkártyák adata: egyszer kérjük le mindet. */
  const bodyHtml = form?.bodyHtml ?? "";
  useEffect(() => {
    const azonositok = [...bodyHtml.matchAll(KARTYA_AZONOSITO)]
      .map((m) => m[1] as string)
      .filter((id) => !kertKartyak.current.has(id))
      .slice(0, KARTYA_BETOLTES_FELSO_HATAR);
    for (const id of azonositok) {
      kertKartyak.current.add(id);
      void productApi
        .detail(token, id)
        .then((termek) =>
          setKartyak((elozo) => new Map(elozo).set(id, elonezetKartya(termek))),
        )
        .catch(() => {
          /* a kártya a tartalék-alakban marad */
        });
    }
  }, [token, bodyHtml]);

  const taxonLabel = useMemo(
    () => new Map(taxonOptions.map((option) => [option.key, option.label])),
    [taxonOptions],
  );
  const szurtTaxonok = useMemo(() => {
    const q = taxonSzuro.trim().toLowerCase();
    return taxonOptions
      .filter(
        (option) =>
          !q ||
          option.label.toLowerCase().includes(q) ||
          option.key.toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [taxonOptions, taxonSzuro]);

  if (loading) return <Skeleton className="h-64" />;
  if (loadError)
    return (
      <Alert
        variant="danger"
        title="A cikk nem tölthető be"
        description={loadError}
      />
    );
  if (!item || !form) return null;

  if (item.channel !== "ARTICLE")
    return (
      <Alert
        variant="info"
        title="Ez a tétel nem cikk"
        description="Cikk-törzs csak a Cikk csatornájú tételhez tartozik."
      />
    );

  // a szerkesztő maga csak akkor jelenik meg, ha írni lehet; mentés közben
  // a mezők állnak, a szerkesztő marad
  const locked = !editable || !canManage;
  const readOnly = locked || saving;
  const update = (patch: Partial<FormState>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
    setSaved(false);
  };
  const imageProblem = (url: string) =>
    url.trim() && !isAllowedFullImageSrc(url.trim(), imageHosts)
      ? "Kép csak https címről, a saját képtárhelyről jöhet."
      : undefined;

  /** One image to the OS's store; the answer is an address the save keeps. */
  const upload = async (
    target: "body" | "cover",
    file: File | undefined,
  ): Promise<string | null> => {
    if (!file) return null;
    setUploadError(null);
    setUploading(target);
    try {
      const { url } = await contentApi.uploadArticleImage(
        token,
        contentId,
        file,
      );
      return url;
    } catch (cause) {
      setUploadError(
        cause instanceof Error ? cause.message : "A kép nem tölthető fel.",
      );
      return null;
    } finally {
      setUploading(null);
    }
  };

  const save = async () => {
    setSaveError(null);
    setSaved(false);
    const input = articleInputFrom(form);
    // ugyanaz a szigorú ellenőrzés, mint a szerveren: a hiba itt, a mező
    // mellett derül ki, nem egy elutasított kérésből
    const parsed = parseArticleBodyInput(input);
    if (!parsed.ok) {
      setSaveError(parsed.message);
      return;
    }
    setSaving(true);
    try {
      const { article: fresh } = await contentApi.saveArticle(
        token,
        contentId,
        parsed.value,
      );
      setArticle(fresh);
      if (fresh) setForm(formFrom(fresh, item.title));
      setDirty(false);
      setSaved(true);
      setCitationReload((n) => n + 1);
    } catch (cause) {
      setSaveError(
        cause instanceof Error ? cause.message : "A mentés nem sikerült.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/tartalom" className="text-xs text-pilot-grey-600">
            ← Tartalom
          </Link>
          <h1 className="text-xl font-semibold text-dusk-900">{item.title}</h1>
          <p className="mt-1 text-sm text-dusk-600">
            Cikk · {CONTENT_STATE_LABELS[item.state]}
            {article?.publishedAt
              ? ` · közzétéve ${dateTime(article.publishedAt)}`
              : ""}
          </p>
        </div>
        {canManage && editable ? (
          <div className="flex items-center gap-3">
            {saved ? (
              <span className="text-sm text-pilot-grey-600">Mentve</span>
            ) : dirty ? (
              <span className="text-sm text-pilot-grey-600">
                Nem mentett változás
              </span>
            ) : null}
            <Button onClick={() => void save()} disabled={saving || !dirty}>
              {saving ? "Mentés…" : "Mentés"}
            </Button>
          </div>
        ) : null}
      </div>

      {!editable ? (
        <Alert
          variant="info"
          title="A cikk most nem szerkeszthető"
          description="A jóváhagyásra küldött vagy jóváhagyott szöveg nem változhat észrevétlenül. Módosításhoz előbb vissza kell küldeni javításra a Tartalom listán."
        />
      ) : !canManage ? (
        <Alert
          variant="info"
          title="Csak olvasható"
          description="A cikk szerkesztéséhez tartalomkezelési jog kell."
        />
      ) : null}

      {uploadError ? (
        <Alert
          variant="danger"
          title="A kép nem tölthető fel"
          description={uploadError}
        />
      ) : null}

      {saveError ? (
        <Alert
          variant="danger"
          title="A mentés nem ment át"
          description={saveError}
        />
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-4">
          <FormField
            label="URL-rész"
            htmlFor="article-slug"
            description="Kisbetű, szám és kötőjel; egy cím csak egy cikké lehet."
          >
            <Input
              id="article-slug"
              value={form.slug}
              maxLength={ARTICLE_LIMITS.slug}
              disabled={readOnly}
              onChange={(event) => update({ slug: event.target.value })}
            />
          </FormField>

          <FormField
            label={`Bevezető (${form.excerpt.length}/${ARTICLE_LIMITS.excerpt})`}
            htmlFor="article-excerpt"
          >
            <Textarea
              id="article-excerpt"
              rows={3}
              value={form.excerpt}
              maxLength={ARTICLE_LIMITS.excerpt}
              disabled={readOnly}
              onChange={(event) => update({ excerpt: event.target.value })}
            />
          </FormField>

          {/*
            NEM `FormField`: annak `<label>`-je űrlapmezőt keres, a szerkesztő
            pedig `contenteditable`. Az akadálymentes neve a saját
            `aria-label`-je.
          */}
          <div className="space-y-1.5">
            <p className="block text-sm font-semibold text-dusk-800">Szöveg</p>
            {locked ? (
              <WebContentPreview
                html={form.bodyHtml}
                cards={kartyak}
                imageHosts={imageHosts}
                emptyText="A cikk szövege még üres."
                className="rounded-lg border border-pilot-grey-200 p-3"
              />
            ) : (
              <RichTextEditor
                ref={szerkeszto}
                profile="full"
                aria-label="Cikk szövege"
                value={form.bodyHtml}
                onChange={(html) => update({ bodyHtml: html })}
                onImageRequest={() => {
                  setKepCim("");
                  setKepAlt("");
                  setPanel("image");
                }}
                onProductCardRequest={() => setPanel("productCard")}
              />
            )}
            {panel === "image" ? (
              <div
                role="group"
                aria-label="Kép beszúrása címmel"
                className="space-y-2 rounded-lg border border-pilot-grey-200 p-2"
              >
                <label className="block text-sm">
                  <span className="text-pilot-grey-700">Kép feltöltése</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    aria-label="Kép feltöltése"
                    disabled={uploading !== null}
                    className="mt-1 block text-sm"
                    onChange={async (event) => {
                      const url = await upload("body", event.target.files?.[0]);
                      if (url) setKepCim(url);
                    }}
                  />
                </label>
                {uploading === "body" ? (
                  <p className="text-xs text-pilot-grey-600">Feltöltés…</p>
                ) : null}
                <Input
                  aria-label="Kép címe"
                  placeholder="https://…"
                  value={kepCim}
                  onChange={(event) => setKepCim(event.target.value)}
                />
                <Input
                  aria-label="Kép leírása"
                  placeholder="Mit ábrázol a kép"
                  value={kepAlt}
                  onChange={(event) => setKepAlt(event.target.value)}
                />
                {imageProblem(kepCim) ? (
                  <p className="text-xs text-red-700">{imageProblem(kepCim)}</p>
                ) : null}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={!kepCim.trim() || Boolean(imageProblem(kepCim))}
                    onClick={() => {
                      szerkeszto.current?.insertImage({
                        src: kepCim.trim(),
                        alt: kepAlt.trim() || item.title,
                      });
                      setPanel(null);
                    }}
                  >
                    Beszúrás
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setPanel(null)}
                  >
                    Mégse
                  </Button>
                </div>
              </div>
            ) : null}
            {panel === "productCard" ? (
              <ProductSearch
                token={token}
                label="Termékkártya választása"
                onPick={(termek) => {
                  setKartyak((elozo) =>
                    new Map(elozo).set(termek.id, elonezetKartya(termek)),
                  );
                  kertKartyak.current.add(termek.id);
                  szerkeszto.current?.insertProductCard({
                    id: termek.id,
                    name: termek.name,
                  });
                  setPanel(null);
                }}
                onCancel={() => setPanel(null)}
              />
            ) : null}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-dusk-800">
              Hol jelenik meg
            </legend>
            {ARTICLE_CHANNELS.map((channel) => (
              <label key={channel} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.channels.includes(channel)}
                  disabled={readOnly}
                  onChange={(event) =>
                    update({
                      channels: event.target.checked
                        ? ARTICLE_CHANNELS.filter(
                            (c) => c === channel || form.channels.includes(c),
                          )
                        : form.channels.filter((c) => c !== channel),
                    })
                  }
                />
                {CHANNEL_LABELS[channel]}
              </label>
            ))}
          </fieldset>

          <FormField
            label="Borítókép címe"
            htmlFor="article-cover"
            error={imageProblem(form.coverImageUrl)}
          >
            <Input
              id="article-cover"
              placeholder="https://…"
              value={form.coverImageUrl}
              disabled={readOnly}
              onChange={(event) =>
                update({ coverImageUrl: event.target.value })
              }
            />
          </FormField>
          {readOnly ? null : (
            <label className="block text-sm">
              <span className="text-pilot-grey-700">Borítókép feltöltése</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label="Borítókép feltöltése"
                disabled={uploading !== null}
                className="mt-1 block text-sm"
                onChange={async (event) => {
                  const url = await upload("cover", event.target.files?.[0]);
                  if (url) update({ coverImageUrl: url });
                }}
              />
              {uploading === "cover" ? (
                <span className="text-xs text-pilot-grey-600">Feltöltés…</span>
              ) : null}
            </label>
          )}
          <FormField label="Borítókép leírása" htmlFor="article-cover-alt">
            <Input
              id="article-cover-alt"
              value={form.coverImageAlt}
              maxLength={ARTICLE_LIMITS.imageAlt}
              disabled={readOnly}
              onChange={(event) =>
                update({ coverImageAlt: event.target.value })
              }
            />
          </FormField>
          <FormField label="Szerző" htmlFor="article-byline">
            <Input
              id="article-byline"
              value={form.byline}
              maxLength={ARTICLE_LIMITS.byline}
              disabled={readOnly}
              onChange={(event) => update({ byline: event.target.value })}
            />
          </FormField>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-dusk-800">
              Kapcsolódó termékek ({form.products.length}/
              {ARTICLE_LIMITS.products})
            </h2>
            {form.products.length === 0 ? (
              <p className="text-sm text-dusk-500">Nincs kapcsolódó termék.</p>
            ) : (
              <ol aria-label="Kapcsolódó termékek" className="space-y-1">
                {form.products.map((product, index) => (
                  <li
                    key={product.id}
                    className="flex items-center justify-between gap-2 rounded border border-pilot-grey-200 px-2 py-1 text-sm"
                  >
                    <span>{product.name}</span>
                    {readOnly ? null : (
                      <span className="flex gap-1">
                        <button
                          type="button"
                          aria-label={`${product.name} feljebb`}
                          disabled={index === 0}
                          onClick={() => {
                            const next = [...form.products];
                            [next[index - 1], next[index]] = [
                              next[index]!,
                              next[index - 1]!,
                            ];
                            update({ products: next });
                          }}
                          className="px-1 disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={`${product.name} lejjebb`}
                          disabled={index === form.products.length - 1}
                          onClick={() => {
                            const next = [...form.products];
                            [next[index + 1], next[index]] = [
                              next[index]!,
                              next[index + 1]!,
                            ];
                            update({ products: next });
                          }}
                          className="px-1 disabled:opacity-30"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          aria-label={`${product.name} eltávolítása`}
                          onClick={() =>
                            update({
                              products: form.products.filter(
                                (p) => p.id !== product.id,
                              ),
                            })
                          }
                          className="px-1"
                        >
                          ×
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {readOnly ? null : panel === "linked" ? (
              <ProductSearch
                token={token}
                label="Kapcsolódó termék választása"
                onPick={(termek) => {
                  if (!form.products.some((p) => p.id === termek.id))
                    update({
                      products: [
                        ...form.products,
                        { id: termek.id, name: termek.name },
                      ],
                    });
                  setPanel(null);
                }}
                onCancel={() => setPanel(null)}
              />
            ) : (
              <Button
                size="sm"
                variant="ghost"
                disabled={form.products.length >= ARTICLE_LIMITS.products}
                onClick={() => setPanel("linked")}
              >
                Termék hozzáadása
              </Button>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-dusk-800">
              Fajok és csoportok ({form.taxonKeys.length}/{ARTICLE_LIMITS.taxa})
            </h2>
            {form.taxonKeys.length ? (
              <ul
                aria-label="Kiválasztott fajok"
                className="flex flex-wrap gap-1"
              >
                {form.taxonKeys.map((key) => (
                  <li
                    key={key}
                    className="flex items-center gap-1 rounded bg-pilot-grey-100 px-2 py-0.5 text-xs"
                  >
                    {taxonLabel.get(key) ?? key}
                    {readOnly ? null : (
                      <button
                        type="button"
                        aria-label={`${taxonLabel.get(key) ?? key} eltávolítása`}
                        onClick={() =>
                          update({
                            taxonKeys: form.taxonKeys.filter((k) => k !== key),
                          })
                        }
                      >
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
            {readOnly ? null : taxonOptions.length === 0 ? (
              <p className="text-sm text-dusk-500">
                A szakmai szótárban még nincs faj vagy csoport.
              </p>
            ) : (
              <>
                <Input
                  aria-label="Faj vagy csoport keresése"
                  placeholder="Faj vagy csoport"
                  value={taxonSzuro}
                  onChange={(event) => setTaxonSzuro(event.target.value)}
                />
                <ul
                  aria-label="Választható fajok"
                  className="max-h-40 space-y-0.5 overflow-y-auto"
                >
                  {szurtTaxonok
                    .filter((option) => !form.taxonKeys.includes(option.key))
                    .map((option) => (
                      <li key={option.key}>
                        <button
                          type="button"
                          disabled={
                            form.taxonKeys.length >= ARTICLE_LIMITS.taxa
                          }
                          onClick={() =>
                            update({
                              taxonKeys: [...form.taxonKeys, option.key],
                            })
                          }
                          className="w-full rounded px-2 py-0.5 text-left text-sm hover:bg-pilot-grey-50 disabled:opacity-40"
                        >
                          {option.label}
                          <span className="ml-2 text-xs text-pilot-grey-500">
                            {option.key}
                          </span>
                        </button>
                      </li>
                    ))}
                </ul>
              </>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-dusk-800">Keresők</h2>
            <FormField
              label={`SEO cím (${form.seoTitle.length}/${ARTICLE_LIMITS.seoTitle})`}
              htmlFor="article-seo-title"
            >
              <Input
                id="article-seo-title"
                value={form.seoTitle}
                maxLength={ARTICLE_LIMITS.seoTitle}
                disabled={readOnly}
                onChange={(event) => update({ seoTitle: event.target.value })}
              />
            </FormField>
            <FormField
              label={`Meta leírás (${form.metaDescription.length}/${ARTICLE_LIMITS.metaDescription})`}
              htmlFor="article-meta"
            >
              <Textarea
                id="article-meta"
                rows={2}
                value={form.metaDescription}
                maxLength={ARTICLE_LIMITS.metaDescription}
                disabled={readOnly}
                onChange={(event) =>
                  update({ metaDescription: event.target.value })
                }
              />
            </FormField>
            <FormField
              label="Megosztási kép címe"
              htmlFor="article-og"
              error={imageProblem(form.ogImageUrl)}
            >
              <Input
                id="article-og"
                placeholder="https://…"
                value={form.ogImageUrl}
                disabled={readOnly}
                onChange={(event) => update({ ogImageUrl: event.target.value })}
              />
            </FormField>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.noindex}
                disabled={readOnly}
                onChange={(event) => update({ noindex: event.target.checked })}
              />
              Ne jelenjen meg a keresőkben
            </label>
          </section>

          {article ? (
            <ArticleRevisions
              token={token}
              contentId={contentId}
              revisions={article.revisions}
              approvedRevisionId={article.approvedRevision?.id ?? null}
              publishedRevisionId={article.publishedRevision?.id ?? null}
              dirty={dirty}
            />
          ) : null}

          {article && canSeeCitations ? (
            <ArticleCitationsPanel
              token={token}
              contentId={contentId}
              canEdit={canCite}
              reloadKey={citationReload}
              dirty={dirty}
            />
          ) : null}
        </div>

        <section
          aria-label="Élő előnézet"
          className="space-y-3 rounded-lg border border-pilot-grey-200 bg-white p-4"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-pilot-grey-500">
            Élő előnézet: a cikk szövege, ahogy mentés után tárolódik
          </p>
          {form.coverImageUrl.trim() && !imageProblem(form.coverImageUrl) ? (
            <img
              src={form.coverImageUrl.trim()}
              alt=""
              className="max-h-64 w-full rounded object-cover"
            />
          ) : null}
          <h2 className="text-2xl font-semibold text-pilot-grey-900">
            {item.title}
          </h2>
          {form.excerpt.trim() ? (
            <p className="text-base text-pilot-grey-700">{form.excerpt}</p>
          ) : null}
          <WebContentPreview
            html={form.bodyHtml}
            cards={kartyak}
            imageHosts={imageHosts}
            emptyText="A cikk szövege még üres."
          />
        </section>
      </div>
    </div>
  );
}
