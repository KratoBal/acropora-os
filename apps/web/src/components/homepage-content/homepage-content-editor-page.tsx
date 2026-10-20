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
  HOMEPAGE_LIMITS,
  HOMEPAGE_TEXT_FIELDS,
  hasPermission,
  parseHomepageContentInput,
  PERMISSIONS,
  type HomepageSlide,
  type HomepageTextField,
} from "@acropora/types";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import {
  homepageContentApi,
  type HomepageContentSaved,
} from "@/lib/api/homepage-content";

/**
 * THE WEB SHOP'S HOME PAGE (Balázs, 2026-10-20): every title, subtitle, button,
 * block text, link and image of the home page, and the hero slides.
 *
 * === WHAT A FIELD SHOWS ===
 *
 * A field has two states. NOT EDITED (the grey "Alapérték" tag): the page shows
 * the starting value from the design, which is also what the field shows here.
 * EDITED: the value is yours, even an empty one (an empty text hides its line
 * on the page). "Alapérték" puts a field back to not edited.
 *
 * The "Minta adat" tag marks a starting value that is an INVENTED FACT (a
 * review, an address, opening hours): the shop labels it as a sample until you
 * write your own value. Saving the page without touching a field does NOT
 * make the sample yours; only editing it does.
 *
 * === THE SLIDES ===
 *
 * "Alap diák" leaves the slides to the page's starting slides (also labelled as
 * a sample). "Saját diák" is your list, at most five; an empty list means no
 * hero at all.
 */
const emptySlide = (): HomepageSlide => ({
  eyebrow: "",
  title: "",
  text: "",
  cta: "",
  ctaHref: null,
  cta2: "",
  cta2Href: null,
  caption: "",
  caption2: "",
  imageUrl: null,
  imageAlt: "",
});

const PROJECTION_TEXT: Record<HomepageContentSaved["projection"], string> = {
  off: "Mentve. A webshopba küldés ebben a környezetben ki van kapcsolva.",
  sent: "Mentve, és elküldve a webshopnak.",
  unchanged: "Mentve. A webshop már ezt az állapotot mutatta.",
  failed:
    "Mentve, de a webshopnak küldés nem sikerült. A következő ütemezett körben újra megpróbáljuk.",
};

const TYPE_HINT: Record<HomepageTextField["type"], string> = {
  text: "",
  link: "Webshop-cím (/store) vagy https:// cím; üresen a gomb nem jelenik meg.",
  image: "Kép címe (https://…); üresen szürke hely áll.",
};

export function HomepageContentEditorPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_MANAGE),
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [ownSlides, setOwnSlides] = useState(false);
  const [slides, setSlides] = useState<HomepageSlide[]>([]);

  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    homepageContentApi
      .get(token, controller.signal)
      .then((content) => {
        setTexts(content.texts);
        setOwnSlides(content.slides !== null);
        setSlides(content.slides ?? []);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(
          cause instanceof Error
            ? cause.message
            : "A kezdőlap tartalma nem tölthető be.",
        );
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [canManage, token]);

  const groups = useMemo(() => {
    const byGroup = new Map<string, HomepageTextField[]>();
    for (const field of HOMEPAGE_TEXT_FIELDS)
      byGroup.set(field.group, [...(byGroup.get(field.group) ?? []), field]);
    return [...byGroup.entries()];
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaved(null);
    const parsed = parseHomepageContentInput({
      texts,
      slides: ownSlides ? slides : null,
    });
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setBusy(true);
    try {
      const result = await homepageContentApi.save(token, parsed.value);
      setTexts(result.content.texts);
      setOwnSlides(result.content.slides !== null);
      setSlides(result.content.slides ?? []);
      setSaved(PROJECTION_TEXT[result.projection]);
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
      <div aria-label="Kezdőlap betöltése">
        <Skeleton className="h-96" />
      </div>
    );

  const setSlide = (index: number, patch: Partial<HomepageSlide>) =>
    setSlides((list) =>
      list.map((slide, i) => (i === index ? { ...slide, ...patch } : slide)),
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Webshop kezdőlap"
        description="A kezdőlap szövegei, hivatkozásai, képei és a nyitó csúszka diái. A nem módosított mező a terv szövegét mutatja."
      />
      {error ? (
        <Alert
          variant="danger"
          title="A mentés nem sikerült"
          description={error}
        />
      ) : null}
      {saved ? <Alert variant="info" title={saved} /> : null}
      <form className="space-y-6" onSubmit={submit}>
        <Card className="space-y-4 p-6">
          <h2 className="font-semibold">Nyitó csúszka</h2>
          <fieldset className="space-y-2 text-sm">
            <legend className="sr-only">Csúszka diái</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="slides-mode"
                checked={!ownSlides}
                onChange={() => setOwnSlides(false)}
              />
              Alap diák (a terv három diája, minta adatként jelölve)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="slides-mode"
                checked={ownSlides}
                onChange={() => setOwnSlides(true)}
              />
              Saját diák (legfeljebb {HOMEPAGE_LIMITS.slides}; üres lista =
              nincs csúszka)
            </label>
          </fieldset>
          {ownSlides ? (
            <div className="space-y-4">
              {slides.map((slide, index) => (
                <SlideFields
                  key={index}
                  index={index}
                  slide={slide}
                  onChange={(patch) => setSlide(index, patch)}
                  onRemove={() =>
                    setSlides((list) => list.filter((_, i) => i !== index))
                  }
                />
              ))}
              <Button
                type="button"
                variant="secondary"
                disabled={slides.length >= HOMEPAGE_LIMITS.slides}
                onClick={() => setSlides((list) => [...list, emptySlide()])}
              >
                Dia hozzáadása
              </Button>
            </div>
          ) : null}
        </Card>
        {groups.map(([group, fields]) => (
          <Card key={group} className="space-y-4 p-6">
            <h2 className="font-semibold">{group}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map((field) => (
                <TextField
                  key={field.key}
                  field={field}
                  value={
                    Object.prototype.hasOwnProperty.call(texts, field.key)
                      ? texts[field.key]
                      : null
                  }
                  onChange={(value) =>
                    setTexts((current) => ({ ...current, [field.key]: value }))
                  }
                  onReset={() =>
                    setTexts((current) => {
                      const { [field.key]: _gone, ...rest } = current;
                      return rest;
                    })
                  }
                />
              ))}
            </div>
          </Card>
        ))}
        <Card className="flex justify-end p-6">
          <Button type="submit" disabled={busy}>
            Mentés
          </Button>
        </Card>
      </form>
    </div>
  );
}

function TextField({
  field,
  value,
  onChange,
  onReset,
}: {
  field: HomepageTextField;
  /** `null`: not edited, the starting value shows. */
  value: string | null;
  onChange: (value: string) => void;
  onReset: () => void;
}) {
  const edited = value !== null;
  const shown = edited ? value : field.default;
  const long =
    field.type === "text" &&
    (field.default.length > 70 || field.default.includes("\n"));
  const control = long ? (
    <Textarea
      aria-label={`${field.group}: ${field.label}`}
      value={shown}
      maxLength={HOMEPAGE_LIMITS.textValue}
      onChange={(event) => onChange(event.target.value)}
    />
  ) : (
    <Input
      aria-label={`${field.group}: ${field.label}`}
      value={shown}
      maxLength={HOMEPAGE_LIMITS.textValue}
      onChange={(event) => onChange(event.target.value)}
      placeholder={field.type === "image" ? "https://…" : undefined}
    />
  );
  return (
    <div className={long ? "sm:col-span-2" : undefined}>
      <FormField
        label={field.label}
        description={TYPE_HINT[field.type] || undefined}
      >
        {control}
      </FormField>
      <div className="mt-1 flex items-center gap-3 text-xs text-dusk-600">
        {edited ? (
          <>
            <span>Módosítva</span>
            <button type="button" className="underline" onClick={onReset}>
              Alapérték
            </button>
          </>
        ) : (
          <>
            <span>Alapérték</span>
            {field.sample ? (
              <span className="rounded border px-1 font-semibold">
                Minta adat
              </span>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function SlideFields({
  index,
  slide,
  onChange,
  onRemove,
}: {
  index: number;
  slide: HomepageSlide;
  onChange: (patch: Partial<HomepageSlide>) => void;
  onRemove: () => void;
}) {
  const n = index + 1;
  const text = (
    label: string,
    key: keyof HomepageSlide,
    max: number,
    long = false,
  ) => (
    <FormField
      label={`${n}. dia: ${label}`}
      className={long ? "sm:col-span-2" : undefined}
    >
      {long ? (
        <Textarea
          aria-label={`${n}. dia: ${label}`}
          value={(slide[key] as string | null) ?? ""}
          maxLength={max}
          onChange={(event) => onChange({ [key]: event.target.value })}
        />
      ) : (
        <Input
          aria-label={`${n}. dia: ${label}`}
          value={(slide[key] as string | null) ?? ""}
          maxLength={max}
          onChange={(event) => onChange({ [key]: event.target.value })}
        />
      )}
    </FormField>
  );
  const address = (
    label: string,
    key: "ctaHref" | "cta2Href" | "imageUrl",
    max: number,
  ) => (
    <FormField label={`${n}. dia: ${label}`}>
      <Input
        aria-label={`${n}. dia: ${label}`}
        value={slide[key] ?? ""}
        maxLength={max}
        onChange={(event) => onChange({ [key]: event.target.value || null })}
      />
    </FormField>
  );
  return (
    <div className="space-y-3 rounded border p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{n}. dia</h3>
        <Button type="button" variant="secondary" onClick={onRemove}>
          Dia törlése
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {text("felirat", "eyebrow", HOMEPAGE_LIMITS.eyebrow)}
        {text("főcím", "title", HOMEPAGE_LIMITS.title)}
        {text("szöveg", "text", HOMEPAGE_LIMITS.slideText, true)}
        {text("első gomb felirata", "cta", HOMEPAGE_LIMITS.button)}
        {address("első gomb célja", "ctaHref", HOMEPAGE_LIMITS.href)}
        {text("második gomb felirata", "cta2", HOMEPAGE_LIMITS.button)}
        {address("második gomb célja", "cta2Href", HOMEPAGE_LIMITS.href)}
        {text("képaláírás", "caption", HOMEPAGE_LIMITS.caption)}
        {text("képaláírás, második sor", "caption2", HOMEPAGE_LIMITS.caption)}
        {address("kép címe", "imageUrl", HOMEPAGE_LIMITS.address)}
        {text("kép leírása", "imageAlt", HOMEPAGE_LIMITS.imageAlt)}
      </div>
    </div>
  );
}
