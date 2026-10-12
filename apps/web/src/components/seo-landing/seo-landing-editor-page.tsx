"use client";
import {
  Alert,
  Button,
  Card,
  FormField,
  Input,
  PageHeader,
  Skeleton,
  Textarea,
} from "@acropora/ui";
import {
  hasPermission,
  parseSeoLandingInput,
  PERMISSIONS,
  SEO_LANDING_LIMITS,
  type SeoLandingOptions,
  type SeoLandingPage,
} from "@acropora/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { seoLandingPagesApi } from "@/lib/api/seo-landing-pages";
import { SEO_LANDING_LIST_PATH } from "./seo-landing-list-page";

/**
 * ONE SEO LANDING PAGE (SEO P1-14): its address, its texts and its filter.
 *
 * THE FILTER: a product is on the page when it is in ANY of the chosen
 * categories (each with its subcategories, as on the category page) AND of any
 * of the chosen brands; an empty side does not filter (murena, t10). At least
 * one category or brand is required: an empty filter would be the whole
 * catalogue. The same shared parser checks it here and on the server.
 *
 * THE NOTES (barracuda, #1682 and #1683): a brand the shop does not show
 * (inactive or archived) has its product links taken down by the brand
 * projection, so its products do NOT reach the page: a warning. An inactive
 * category is different: the shop's landing route (acropora-commerce #544)
 * filters on the category ids over the whole tree, so its products DO appear;
 * only the category's own page is hidden. The editor says exactly that, so no
 * one removes a working category for a problem that does not exist.
 */
export function SeoLandingEditorPage({ landingId }: { landingId?: string }) {
  const { session } = useAuth();
  const router = useRouter();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_MANAGE),
  );
  const [options, setOptions] = useState<SeoLandingOptions | null>(null);
  const [page, setPage] = useState<SeoLandingPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [intro, setIntro] = useState("");
  const [isPublished, setIsPublished] = useState(false);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [brandIds, setBrandIds] = useState<string[]>([]);
  const [categorySearch, setCategorySearch] = useState("");
  const [brandSearch, setBrandSearch] = useState("");

  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    Promise.all([
      seoLandingPagesApi.options(token, controller.signal),
      landingId
        ? seoLandingPagesApi.detail(token, landingId, controller.signal)
        : Promise.resolve(null),
    ])
      .then(([nextOptions, nextPage]) => {
        setOptions(nextOptions);
        if (nextPage) fill(nextPage);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(
          cause instanceof Error
            ? cause.message
            : "A válogatás nem tölthető be.",
        );
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [canManage, landingId, token]);

  const fill = (next: SeoLandingPage) => {
    setPage(next);
    setSlug(next.slug);
    setTitle(next.title);
    setSeoTitle(next.seoTitle ?? "");
    setMetaDescription(next.metaDescription ?? "");
    setIntro(next.intro ?? "");
    setIsPublished(next.isPublished);
    setCategoryIds(next.filter.storeCategoryIds);
    setBrandIds(next.filter.brandIds);
  };

  const notes = useMemo(() => {
    if (!options) return [];
    const categories = new Map(options.categories.map((c) => [c.id, c]));
    const brands = new Map(options.brands.map((b) => [b.id, b]));
    return [
      ...categoryIds
        .filter((id) => categories.get(id)?.isActive === false)
        .map((id) => ({
          title: "Rejtett kategória",
          text: `A(z) „${categories.get(id)!.path}” kategória oldala nem látszik a webshopban, de a termékei a válogatásban megjelennek.`,
        })),
      ...brandIds
        .filter((id) => brands.get(id)?.shown === false)
        .map((id) => ({
          title: "Üres lehet a válogatás",
          text: `A(z) „${brands.get(id)!.name}” márka nem látszik a webshopban (nem aktív vagy archivált): a termékei nem kerülnek a válogatásba.`,
        })),
    ];
  }, [options, categoryIds, brandIds]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaved(false);
    const parsed = parseSeoLandingInput({
      slug,
      title,
      seoTitle,
      metaDescription,
      intro,
      filter: { storeCategoryIds: categoryIds, brandIds },
      isPublished,
    });
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setBusy(true);
    try {
      if (page) {
        fill(await seoLandingPagesApi.update(token, page.id, parsed.value));
        setSaved(true);
      } else {
        const created = await seoLandingPagesApi.create(token, parsed.value);
        router.replace(`${SEO_LANDING_LIST_PATH}/${created.id}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "A mentés sikertelen.");
    } finally {
      setBusy(false);
    }
  };

  if (!canManage)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed"
        description="products.manage jogosultság szükséges."
      />
    );
  if (loading)
    return (
      <div aria-label="Válogatás betöltése">
        <Skeleton className="h-96" />
      </div>
    );

  const toggle =
    (setter: (update: (ids: string[]) => string[]) => void) => (id: string) =>
      setter((ids) =>
        ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
      );
  const categoryMatches = (options?.categories ?? []).filter((c) =>
    c.path.toLowerCase().includes(categorySearch.trim().toLowerCase()),
  );
  const brandMatches = (options?.brands ?? []).filter((b) =>
    b.name.toLowerCase().includes(brandSearch.trim().toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={page ? page.title : "Új válogatás"}
        description="Kiemelt termékválogatás saját címmel a webshopban."
        actions={
          <Link href={SEO_LANDING_LIST_PATH}>
            <Button variant="secondary">Vissza a listához</Button>
          </Link>
        }
      />
      {error ? (
        <Alert
          variant="danger"
          title="A mentés nem sikerült"
          description={error}
        />
      ) : null}
      {saved ? <Alert variant="info" title="Mentve" /> : null}
      {notes.map((note) => (
        <Alert
          key={note.text}
          variant="info"
          title={note.title}
          description={note.text}
        />
      ))}
      <form className="space-y-6" onSubmit={submit}>
        <Card className="p-6">
          <h2 className="font-semibold">Cím és szövegek</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <FormField label="Cím">
              <Input
                aria-label="Cím"
                value={title}
                maxLength={SEO_LANDING_LIMITS.title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </FormField>
            <FormField
              label="Webshop-cím"
              description={`/hu/valogatas/${slug || "…"}${
                page && slug !== page.slug
                  ? ` (a régi cím átirányít: /hu/valogatas/${page.slug})`
                  : ""
              }`}
            >
              <Input
                aria-label="Webshop-cím"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                placeholder="kisbetu-szamok-es-kotojel"
              />
            </FormField>
            <FormField label="SEO cím">
              <Input
                aria-label="SEO cím"
                value={seoTitle}
                maxLength={SEO_LANDING_LIMITS.seoTitle}
                onChange={(event) => setSeoTitle(event.target.value)}
              />
            </FormField>
            <FormField label="Meta leírás">
              <Input
                aria-label="Meta leírás"
                value={metaDescription}
                maxLength={SEO_LANDING_LIMITS.metaDescription}
                onChange={(event) => setMetaDescription(event.target.value)}
              />
            </FormField>
          </div>
          <FormField label="Bevezető" className="mt-4">
            <Textarea
              aria-label="Bevezető"
              value={intro}
              maxLength={SEO_LANDING_LIMITS.intro}
              onChange={(event) => setIntro(event.target.value)}
            />
          </FormField>
        </Card>
        <Card className="p-6">
          <h2 className="font-semibold">Melyik termékek kerülnek rá</h2>
          <p className="mt-1 text-sm text-dusk-600">
            A kiválasztott kategóriák bármelyikében (az alkategóriáikkal együtt)
            és a kiválasztott márkák bármelyikéből. Ha az egyik oldalon nincs
            kiválasztás, az nem szűr. Legalább egy kategória vagy márka kell.
          </p>
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <ChoiceList
              label="Kategóriák"
              search={categorySearch}
              onSearch={setCategorySearch}
              items={categoryMatches.map((c) => ({
                id: c.id,
                label: c.path,
                muted: !c.isActive,
              }))}
              selected={categoryIds}
              onToggle={toggle(setCategoryIds)}
            />
            <ChoiceList
              label="Márkák"
              search={brandSearch}
              onSearch={setBrandSearch}
              items={brandMatches.map((b) => ({
                id: b.id,
                label: b.name,
                muted: !b.shown,
              }))}
              selected={brandIds}
              onToggle={toggle(setBrandIds)}
            />
          </div>
        </Card>
        <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isPublished}
              onChange={(event) => setIsPublished(event.target.checked)}
            />
            Közzétéve a webshopban
          </label>
          <Button type="submit" disabled={busy}>
            {page ? "Mentés" : "Létrehozás"}
          </Button>
        </Card>
      </form>
    </div>
  );
}

function ChoiceList({
  label,
  search,
  onSearch,
  items,
  selected,
  onToggle,
}: {
  label: string;
  search: string;
  onSearch: (value: string) => void;
  items: { id: string; label: string; muted: boolean }[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">
        {label} ({selected.length} kiválasztva)
      </legend>
      <Input
        aria-label={`${label} keresése`}
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder="Keresés"
      />
      <ul className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-2 text-sm">
        {items.map((item) => (
          <li key={item.id}>
            <label
              className={`flex items-center gap-2 ${item.muted ? "text-dusk-400" : ""}`}
            >
              <input
                type="checkbox"
                checked={selected.includes(item.id)}
                onChange={() => onToggle(item.id)}
              />
              {item.label}
              {item.muted ? " (nem látszik a webshopban)" : ""}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
