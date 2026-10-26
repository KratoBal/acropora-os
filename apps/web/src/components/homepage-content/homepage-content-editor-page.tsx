"use client";
import {
  Alert,
  PilotButton,
  PilotCard,
  PilotDialog,
  PilotThemeRoot,
  Skeleton,
} from "@acropora/ui";
import {
  HOMEPAGE_TEXT_FIELDS,
  hasPermission,
  parseHomepageContentInput,
  PERMISSIONS,
  servedNavigationFeatures,
  type HomepageBlock,
  type HomepageBlockKey,
  type HomepageFooter,
  type HomepageSlide,
  type HomepageTextField,
} from "@acropora/types";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  homepageContentApi,
  type HomepageContentSaved,
} from "@/lib/api/homepage-content";

import {
  HomepageBlockList,
  type HomepageSelection,
} from "./homepage-block-list";
import {
  allBlocksHidden,
  blockMeta,
  blocksForSave,
  effectiveBlocks,
} from "./homepage-blocks";
import {
  Kapcsolo,
  TextField,
  type ImageUploadControl,
} from "./homepage-fields";
import { HomepageFeaturedEditor } from "./homepage-featured-editor";
import { HomepageFooterEditor } from "./homepage-footer-editor";
import { HomepagePreview } from "./homepage-preview";
import { previewRecord } from "./homepage-preview-protocol";
import { HomepageSlidesEditor } from "./homepage-slides-editor";

/**
 * THE WEB SHOP'S HOME PAGE ADMIN, "Beállítások / Kezdőlap" (Balázs, 2026-10-20;
 * the block editor: his brief of 2026-10-26 08:28 UTC,
 * `exchange/kezdolap-admin-megbizas-balazs-2026-10-26.txt`; Figma 685:535).
 *
 * Three columns: the blocks (order and visibility), the editor of the selected
 * block, and the live preview of the REAL test storefront.
 *
 * === WHAT A FIELD SHOWS ===
 *
 * NOT EDITED (the grey "Alapérték" tag): the page shows the design's starting
 * value, which is also what the field shows here. EDITED: the value is yours,
 * even an empty one. "Visszaállítás" puts a field back to not edited. "Minta
 * adat" marks a starting value that is an INVENTED FACT (a review, an address):
 * saving the page without touching it does NOT make the sample yours.
 *
 * === SAVE AND SHOP ARE TWO THINGS ===
 *
 * "Mentés" stores here; whether the content also reaches the shop is the
 * projection's answer, said in one of four exact sentences. A failed send never
 * fails the save: the scheduled round tries again.
 */
const SAVE_TEXT: Record<HomepageContentSaved["projection"], string> = {
  off: "Mentve (a webshopba küldés ki van kapcsolva)",
  sent: "Mentve, és elküldve a webshopnak",
  unchanged: "Mentve, a webshopban nem változott semmi",
  failed:
    "Mentve, de a webshopba küldés nem sikerült: a következő ütemezett kör újrapróbálja",
};

interface Draft {
  texts: Record<string, string>;
  ownSlides: boolean;
  slides: HomepageSlide[];
  blocks: HomepageBlock[];
  footer: HomepageFooter | null;
}

const snapshot = (draft: Draft) =>
  JSON.stringify({
    texts: draft.texts,
    slides: draft.ownSlides ? draft.slides : null,
    blocks: blocksForSave(draft.blocks),
    footer: draft.footer,
  });

export function HomepageContentEditorPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_MANAGE),
  );
  const canSwitch = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SETTINGS_MANAGE),
  );
  // the editor lives only where the environment serves it (the server's switch;
  // production has it OFF and the endpoints answer 404): the commerce exception
  // is for the test shop only
  const available = servedNavigationFeatures(session?.navigation).has(
    "homepage-content",
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({
    texts: {},
    ownSlides: false,
    slides: [],
    blocks: effectiveBlocks(null),
    footer: null,
  });
  const [savedSnapshot, setSavedSnapshot] = useState<string>("");
  const [selected, setSelected] = useState<HomepageSelection>("hero");
  const [projectionEnabled, setProjectionEnabled] = useState(false);
  const [projectionAllowed, setProjectionAllowed] = useState(true);
  const [storefrontUrl, setStorefrontUrl] = useState<string | null>(null);
  const [confirmHidden, setConfirmHidden] = useState(false);

  const apply = (content: {
    texts: Record<string, string>;
    slides: HomepageSlide[] | null;
    blocks: HomepageBlock[] | null;
    footer: HomepageFooter | null;
  }) => {
    const next: Draft = {
      texts: content.texts,
      ownSlides: content.slides !== null,
      slides: content.slides ?? [],
      blocks: effectiveBlocks(content.blocks ?? null),
      footer: content.footer ?? null,
    };
    setDraft(next);
    setSavedSnapshot(snapshot(next));
  };

  useEffect(() => {
    if (!canManage || !available) return;
    const controller = new AbortController();
    homepageContentApi
      .get(token, controller.signal)
      .then((content) => {
        apply(content);
        setProjectionEnabled(content.projectionEnabled);
        setProjectionAllowed(content.projectionAllowed);
        setStorefrontUrl(content.storefrontUrl ?? null);
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
  }, [available, canManage, token]);

  const dirty = !loading && snapshot(draft) !== savedSnapshot;

  /** The administrator's switch: takes effect at once, it is not part of the save. */
  const switchProjection = async (enabled: boolean) => {
    setError(null);
    try {
      const result = await homepageContentApi.setProjection(token, enabled);
      setProjectionEnabled(result.projectionEnabled);
      setStatus(
        result.projectionEnabled
          ? "A küldés a webshopba be van kapcsolva. A következő mentéstől (és az ütemezett körtől) a tartalom megy a boltba."
          : "A küldés a webshopba ki van kapcsolva.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A kapcsoló nem váltott.",
      );
    }
  };

  const upload: ImageUploadControl = {
    allowed: projectionAllowed && projectionEnabled,
    upload: async (file) => {
      setError(null);
      try {
        return (await homepageContentApi.uploadImage(token, file)).url;
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "A kép feltöltése sikertelen.",
        );
        return null;
      }
    },
  };

  const groups = useMemo(() => {
    const byGroup = new Map<string, HomepageTextField[]>();
    for (const field of HOMEPAGE_TEXT_FIELDS)
      byGroup.set(field.group, [...(byGroup.get(field.group) ?? []), field]);
    return byGroup;
  }, []);

  const record = useMemo(
    () =>
      previewRecord({
        texts: draft.texts,
        slides: draft.ownSlides ? draft.slides : null,
        blocks: blocksForSave(draft.blocks),
        footer: draft.footer,
      }),
    [draft],
  );

  const save = async () => {
    setError(null);
    setStatus(null);
    const parsed = parseHomepageContentInput({
      texts: draft.texts,
      slides: draft.ownSlides ? draft.slides : null,
      blocks: blocksForSave(draft.blocks),
      footer: draft.footer,
    });
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setBusy(true);
    try {
      const result = await homepageContentApi.save(token, parsed.value);
      apply(result.content);
      setProjectionEnabled(result.content.projectionEnabled);
      setProjectionAllowed(result.content.projectionAllowed);
      setStatus(SAVE_TEXT[result.projection]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "A mentés sikertelen.");
    } finally {
      setBusy(false);
    }
  };

  const requestSave = () => {
    if (allBlocksHidden(draft.blocks)) setConfirmHidden(true);
    else void save();
  };

  if (!available)
    return (
      <Alert
        variant="info"
        title="Ebben a környezetben nem elérhető"
        description="A webshop kezdőlapja csak a teszt-webshophoz szerkeszthető."
      />
    );
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

  const setTexts = (
    update: (texts: Record<string, string>) => Record<string, string>,
  ) => setDraft((d) => ({ ...d, texts: update(d.texts) }));
  const fieldsOf = (group: string) => (
    <div key={group} className="space-y-3">
      <h3 className="text-sm font-semibold text-pilot-grey-900">{group}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        {(groups.get(group) ?? []).map((field) => (
          <TextField
            key={field.key}
            field={field}
            value={draft.texts[field.key] ?? null}
            upload={upload}
            onChange={(value) =>
              setTexts((texts) => ({ ...texts, [field.key]: value }))
            }
            onReset={() =>
              setTexts((texts) => {
                const { [field.key]: _gone, ...rest } = texts;
                return rest;
              })
            }
          />
        ))}
      </div>
    </div>
  );
  const selectedBlock =
    selected === "footer"
      ? null
      : (draft.blocks.find((block) => block.key === selected) ?? null);
  const setVisible = (key: HomepageBlockKey, visible: boolean) =>
    setDraft((d) => ({
      ...d,
      blocks: d.blocks.map((b) => (b.key === key ? { ...b, visible } : b)),
    }));

  return (
    <PilotThemeRoot className="space-y-6">
      <header>
        <p className="text-xs text-pilot-grey-500">Beállítások / Kezdőlap</p>
        <h1 className="mt-1 text-[28px] font-semibold leading-9 text-pilot-grey-900">
          Kezdőlap
        </h1>
        <p className="mt-1 text-sm text-pilot-grey-600">
          A webshop kezdőlapjának tartalma és megjelenése.
        </p>
      </header>

      <PilotCard className="flex flex-wrap items-center gap-4 p-4">
        <div className="min-w-60 flex-1">
          <div className="flex items-center gap-3">
            <Kapcsolo
              label="Küldés a webshopba: a kezdőlap tartalma menjen a webshopba (és a képek is feltölthetők legyenek)"
              checked={projectionEnabled}
              disabled={!canSwitch || !projectionAllowed}
              onChange={(enabled) => void switchProjection(enabled)}
            />
            <span className="text-sm font-semibold text-pilot-grey-900">
              Küldés a webshopba
            </span>
          </div>
          {!projectionAllowed ? (
            <p className="mt-2 text-xs text-pilot-aqua-700">
              Ebben a környezetben a webshopba küldés nincs engedélyezve.
            </p>
          ) : !canSwitch ? (
            <p className="mt-2 text-xs text-pilot-grey-500">
              A kapcsolót az adminisztrátor váltja.
            </p>
          ) : null}
        </div>
        <p
          role="status"
          className={`text-sm ${dirty ? "text-pilot-amber-700" : "text-pilot-grey-600"}`}
        >
          {dirty ? (
            <>
              <span aria-hidden="true">● </span>Nem mentett változás
            </>
          ) : (
            (status ?? "Nincs mentett változás")
          )}
        </p>
        {storefrontUrl ? (
          <a
            href={`${storefrontUrl}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md px-4 py-2 text-sm font-semibold text-pilot-grey-900 ring-1 ring-pilot-grey-200 hover:bg-pilot-grey-50"
          >
            Előnézet új lapon
          </a>
        ) : (
          <PilotButton
            variant="secondary"
            disabled
            title="A teszt kirakat címe ebben a környezetben nincs beállítva."
          >
            Előnézet új lapon
          </PilotButton>
        )}
        <PilotButton disabled={busy} onClick={requestSave}>
          Mentés
        </PilotButton>
      </PilotCard>

      {error ? (
        <Alert
          variant="danger"
          title="A mentés nem sikerült"
          description={error}
        />
      ) : null}
      {!dirty && status ? <Alert variant="info" title={status} /> : null}

      <div className="grid items-start gap-4 xl:grid-cols-[280px_minmax(0,1fr)_minmax(0,380px)]">
        <HomepageBlockList
          blocks={draft.blocks}
          selected={selected}
          onSelect={setSelected}
          onChange={(blocks) => setDraft((d) => ({ ...d, blocks }))}
        />

        <PilotCard className="space-y-6 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-pilot-grey-900">
              {selected === "footer" ? "Lábléc" : blockMeta(selected).label}
            </h2>
            {selectedBlock ? (
              <span className="flex items-center gap-2 text-xs text-pilot-grey-600">
                Látszik
                <Kapcsolo
                  label={`${blockMeta(selectedBlock.key).label}: látszik (szerkesztő)`}
                  checked={selectedBlock.visible}
                  onChange={(visible) => setVisible(selectedBlock.key, visible)}
                />
              </span>
            ) : null}
          </div>
          {selected === "footer" ? (
            <HomepageFooterEditor
              footer={draft.footer}
              onChange={(footer) => setDraft((d) => ({ ...d, footer }))}
              onOpenBoltunk={() => setSelected("boltunk")}
            />
          ) : selected === "hero" ? (
            <>
              <HomepageSlidesEditor
                own={draft.ownSlides}
                slides={draft.slides}
                upload={upload}
                onOwnChange={(ownSlides) =>
                  setDraft((d) => ({ ...d, ownSlides }))
                }
                onSlidesChange={(slides) => setDraft((d) => ({ ...d, slides }))}
              />
              {fieldsOf("Hero")}
            </>
          ) : selected === "kezdo-es-halado" ? (
            <TabbedGroups
              groups={blockMeta(selected).groups}
              render={fieldsOf}
            />
          ) : selected === "egyedi-korallok" ? (
            <HomepageFeaturedEditor
              token={token}
              onProjection={(projection) => setStatus(SAVE_TEXT[projection])}
            />
          ) : (
            blockMeta(selected).groups.map(fieldsOf)
          )}
        </PilotCard>

        <HomepagePreview
          storefrontUrl={storefrontUrl}
          record={record}
          selected={selected === "footer" ? null : selected}
          onSelect={setSelected}
        />
      </div>

      {confirmHidden ? (
        <PilotDialog open onClose={() => setConfirmHidden(false)}>
          <div
            role="alertdialog"
            aria-labelledby="minden-rejtve"
            className="p-5"
          >
            <h2
              id="minden-rejtve"
              className="text-sm font-semibold text-pilot-amber-700"
            >
              Minden blokk rejtve van. Biztosan így mented?
            </h2>
            <p className="mt-2 text-sm text-pilot-grey-600">
              A kirakat kezdőlapján csak a fejléc és a lábléc marad.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <PilotButton
                variant="secondary"
                onClick={() => setConfirmHidden(false)}
              >
                Mégse
              </PilotButton>
              <PilotButton
                onClick={() => {
                  setConfirmHidden(false);
                  void save();
                }}
              >
                Mentés így
              </PilotButton>
            </div>
          </div>
        </PilotDialog>
      ) : null}
    </PilotThemeRoot>
  );
}

/** "Kezdőknek és tapasztaltaknak": ONE storefront block, one tab per group. */
function TabbedGroups({
  groups,
  render,
}: {
  groups: readonly string[];
  render: (group: string) => ReactNode;
}) {
  const [active, setActive] = useState(groups[0] ?? "");
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Szerkesztőfülek" className="flex gap-2">
        {groups.map((group) => (
          <button
            key={group}
            type="button"
            role="tab"
            aria-selected={active === group}
            onClick={() => setActive(group)}
            className={`rounded-md px-4 py-2 text-sm font-semibold ${
              active === group
                ? "bg-pilot-aqua-50 text-pilot-aqua-700"
                : "bg-pilot-grey-100 text-pilot-grey-600"
            }`}
          >
            {group}
          </button>
        ))}
      </div>
      {render(active)}
    </div>
  );
}
