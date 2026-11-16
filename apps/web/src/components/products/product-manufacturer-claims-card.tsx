"use client";

import {
  Alert,
  ConfirmDialog,
  PilotBadge,
  type PilotBadgeVariant,
  PilotButton,
  PilotInput,
  PilotSection,
  PilotSelect,
  Textarea,
} from "@acropora/ui";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  type ClaimContentItem,
  type ClaimOutputReason,
  type ClaimSourceKind,
  type ClaimStatus,
  type ClaimType,
  manufacturerClaimApi,
  type ManufacturerClaimView,
} from "@/lib/api/manufacturer-claims";

/**
 * THE PRODUCT'S MANUFACTURER CLAIMS (T5.3, spec point 4, "Termék szerint"): every claim with its
 * source, its check state and what it allows in a text. Content takes the "a gyártó szerint"
 * marking from the claim, so the card shows it the way content will use it.
 *
 * WHO MAY DO WHAT IS THE SERVER'S: the card offers the check buttons only where the API would
 * accept them (not on the viewer's own claim; "független forrással megerősítve" only with the
 * approval right), so a refusal is the exception, not the way to find out.
 */
export const CLAIM_TYPE_TEXT: Record<ClaimType, string> = {
  DOSING: "Adagolás",
  EFFECT: "Hatás",
  COMPOSITION: "Összetétel",
  APPLICABILITY: "Alkalmazhatóság",
  SAFETY: "Biztonság",
  ADVERTISING: "Reklám",
  OTHER: "Egyéb",
};
const SOURCE_KIND_TEXT: Record<ClaimSourceKind, string> = {
  DATASHEET: "Adatlap",
  MANUFACTURER_PAGE: "Gyártói oldal",
  LABEL: "Címke",
  MANUFACTURER_GUIDE: "Gyártói útmutató",
  AUTHOR_ARTICLE: "Szerzői cikk",
};
export const CLAIM_STATUS_TEXT: Record<ClaimStatus, string> = {
  UNVERIFIED: "Ellenőrizetlen",
  MATCHES_MANUFACTURER: "Gyártói forrással egyezik",
  INDEPENDENTLY_CONFIRMED: "Független forrással megerősítve",
  DISPUTED: "Eltér / vitatott",
};
const STATUS_BADGE: Record<ClaimStatus, PilotBadgeVariant> = {
  UNVERIFIED: "amber",
  MATCHES_MANUFACTURER: "teal",
  INDEPENDENTLY_CONFIRMED: "success",
  DISPUTED: "danger",
};
export const OUTPUT_MODE_TEXT = {
  PUBLISHABLE: "Kiírható",
  DRAFT_ONLY: "Csak vázlatba",
  BLOCKED: "Nem írható ki",
} as const;
const REASON_TEXT: Record<ClaimOutputReason, string> = {
  ARCHIVED: "archiválva",
  DISPUTED: "eltér vagy vitatott",
  UNVERIFIED: "még senki nem ellenőrizte (a rögzítő nem ellenőrizheti)",
  KNOWLEDGE_FACT_CHANGED:
    "a Product Knowledge adagolás azóta változott: kösd újra, és ellenőrizzétek",
  KNOWLEDGE_FACT_NOT_LINKED:
    "a terméknek van Product Knowledge adagolása, ez az állítás nincs hozzákötve",
  ADVERTISING_NOT_CONFIRMED:
    "reklám: szó szerint csak független megerősítés után idézhető",
};

export function claimReasonText(reason: ClaimOutputReason): string {
  return REASON_TEXT[reason];
}

interface Draft {
  /** Set when editing: the claim, the version the editor saw, and whether it stands on a fact. */
  editing: { id: string; version: number; onFact: boolean } | null;
  claimType: ClaimType;
  claimText: string;
  sourceKind: ClaimSourceKind;
  sourceRef: string;
  sourcePublishedOn: string;
  sourceReadOn: string;
  valueAmount: string;
  valueUnit: string;
  note: string;
}

/** Today in Budapest, as the `YYYY-MM-DD` the API takes. */
function today(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Budapest",
  }).format(new Date());
}

const emptyDraft = (): Draft => ({
  editing: null,
  claimType: "EFFECT",
  claimText: "",
  sourceKind: "MANUFACTURER_PAGE",
  sourceRef: "",
  sourcePublishedOn: "",
  sourceReadOn: today(),
  valueAmount: "",
  valueUnit: "",
  note: "",
});

/** "" is no value; a comma is a decimal point (Hungarian typing). */
function numberOf(text: string): number | undefined {
  const value = Number(text.trim().replace(",", "."));
  return text.trim() === "" || Number.isNaN(value) ? undefined : value;
}

export function ProductManufacturerClaimsCard({
  token,
  productId,
  canManage,
  canApprove,
  currentUserId,
}: {
  token: string;
  productId: string;
  canManage: boolean;
  canApprove: boolean;
  currentUserId: string;
}) {
  const [claims, setClaims] = useState<ManufacturerClaimView[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [content, setContent] = useState<
    Record<string, ClaimContentItem[] | undefined>
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await manufacturerClaimApi.forProduct(token, productId);
      setClaims(result.items);
      setTruncated(result.truncated);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A gyártói állítások nem tölthetők be.",
      );
      setClaims([]);
    }
  }, [productId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
      setDraft(null);
      setArchiving(null);
      setContent({});
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A művelet nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!draft) return;
    const amount = numberOf(draft.valueAmount);
    if ((amount === undefined) !== (draft.valueUnit.trim() === "")) {
      setError("A szám-érték és a mértékegység csak együtt adható meg.");
      return;
    }
    if (draft.editing) {
      const editing = draft.editing;
      void act(() =>
        manufacturerClaimApi.update(token, editing.id, {
          expectedVersion: editing.version,
          claimType: draft.claimType,
          claimText: draft.claimText,
          sourceKind: draft.sourceKind,
          sourceRef: draft.sourceRef,
          sourceReadOn: draft.sourceReadOn,
          sourcePublishedOn: draft.sourcePublishedOn || null,
          // a claim on a Product Knowledge fact has no number of its own
          ...(editing.onFact
            ? {}
            : {
                valueAmount: amount ?? null,
                valueUnit: amount !== undefined ? draft.valueUnit.trim() : null,
              }),
          note: draft.note.trim() || null,
        }),
      );
      return;
    }
    void act(() =>
      manufacturerClaimApi.create(token, productId, {
        claimType: draft.claimType,
        claimText: draft.claimText,
        sourceKind: draft.sourceKind,
        sourceRef: draft.sourceRef,
        sourceReadOn: draft.sourceReadOn,
        ...(draft.sourcePublishedOn
          ? { sourcePublishedOn: draft.sourcePublishedOn }
          : {}),
        ...(amount !== undefined
          ? { valueAmount: amount, valueUnit: draft.valueUnit.trim() }
          : {}),
        ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
      }),
    );
  };

  const edit = (claim: ManufacturerClaimView) =>
    setDraft({
      editing: {
        id: claim.id,
        version: claim.version,
        onFact: claim.knowledgeFact !== null,
      },
      claimType: claim.claimType,
      claimText: claim.claimText,
      sourceKind: claim.sourceKind,
      sourceRef: claim.sourceRef,
      sourcePublishedOn: claim.sourcePublishedOn ?? "",
      sourceReadOn: claim.sourceReadOn,
      valueAmount: claim.valueAmount === null ? "" : String(claim.valueAmount),
      valueUnit: claim.valueUnit ?? "",
      note: claim.note ?? "",
    });

  const toggleContent = async (claimId: string) => {
    if (content[claimId]) {
      setContent({ ...content, [claimId]: undefined });
      return;
    }
    try {
      const { items } = await manufacturerClaimApi.content(token, claimId);
      setContent({ ...content, [claimId]: items });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Az érintett tartalmak nem tölthetők be.",
      );
    }
  };

  const live = (claims ?? []).filter((claim) => !claim.archivedAt);

  return (
    <PilotSection
      title="Gyártói állítások"
      subtitle="Mit állít a gyártó a termékről, honnan, és ellenőrizte-e valaki (a tartalmak ebből veszik a „gyártó szerint” jelölést)"
      action={
        canManage && !draft && claims ? (
          <PilotButton
            variant="secondary"
            onClick={() => setDraft(emptyDraft())}
          >
            Új állítás
          </PilotButton>
        ) : undefined
      }
      bodyClassName="space-y-3 px-5 py-5"
    >
      {error ? (
        <Alert variant="danger" title="Nem sikerült" description={error} />
      ) : null}
      {truncated ? (
        <Alert
          variant="info"
          title="A lista nem teljes"
          description="Ennél a terméknél az első 500 állítás látszik (az adagolás és a biztonság elöl)."
        />
      ) : null}

      {!claims ? (
        <p className="text-sm text-pilot-grey-500">Betöltés…</p>
      ) : live.length === 0 && !draft ? (
        <p className="text-sm text-pilot-grey-500">
          Ehhez a termékhez még nincs gyártói állítás.
        </p>
      ) : null}

      {live.map((claim) => {
        const own = claim.recordedBy?.id === currentUserId;
        const checkable = canManage && !own && claim.recordedBy !== null;
        const linkHolds =
          claim.knowledgeLink !== "CHANGED" &&
          claim.knowledgeLink !== "MISSING_LINK";
        return (
          <div
            key={claim.id}
            data-testid={`manufacturer-claim-${claim.id}`}
            className="space-y-1 rounded-lg border border-dusk-100 p-3 text-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-dusk-900">
                {CLAIM_TYPE_TEXT[claim.claimType]}
              </span>
              <span className="flex flex-wrap gap-1">
                <PilotBadge variant={STATUS_BADGE[claim.status]}>
                  {CLAIM_STATUS_TEXT[claim.status]}
                </PilotBadge>
                <PilotBadge
                  variant={
                    claim.output.mode === "PUBLISHABLE"
                      ? "success"
                      : claim.output.mode === "BLOCKED"
                        ? "danger"
                        : "amber"
                  }
                >
                  {OUTPUT_MODE_TEXT[claim.output.mode]}
                </PilotBadge>
              </span>
            </div>
            <p className="text-dusk-800">
              „{claim.claimText}”
              {claim.output.attribution ? (
                <span className="text-dusk-500">
                  {" "}
                  ({claim.output.attribution})
                </span>
              ) : null}
            </p>
            {claim.knowledgeFact ? (
              <p className="text-xs text-dusk-500">
                Product Knowledge ({claim.knowledgeFact.field}):{" "}
                {claim.knowledgeFact.value ?? "nincs érték"}
              </p>
            ) : claim.valueAmount !== null ? (
              <p className="text-xs text-dusk-500">
                Érték: {claim.valueAmount} {claim.valueUnit}
              </p>
            ) : null}
            <p className="break-words text-xs text-dusk-500">
              {SOURCE_KIND_TEXT[claim.sourceKind]}: {claim.sourceRef}
              {claim.sourcePublishedOn
                ? ` · közzétéve ${claim.sourcePublishedOn}`
                : ""}
              {` · kiolvasva ${claim.sourceReadOn}`}
            </p>
            <p className="text-xs text-dusk-500">
              {claim.version}. változat · rögzítette{" "}
              {claim.recordedBy?.name ?? "?"}
              {claim.verifiedBy
                ? ` · ellenőrizte ${claim.verifiedBy.name}`
                : ""}
              {claim.note ? ` · ${claim.note}` : ""}
            </p>
            {claim.output.reasons.length > 0 ? (
              <ul className="list-disc pl-5 text-xs text-amber-700">
                {claim.output.reasons.map((reason) => (
                  <li key={reason}>{claimReasonText(reason)}</li>
                ))}
              </ul>
            ) : null}
            {claim.output.checkRequiredBeforeSend &&
            claim.output.mode !== "PUBLISHABLE" ? (
              <p className="text-xs text-amber-700">
                Adagolás vagy biztonság: kiküldés előtt kötelező az ellenőrzés.
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2 pt-1">
              {checkable &&
              !draft &&
              linkHolds &&
              claim.status !== "MATCHES_MANUFACTURER" ? (
                <PilotButton
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      manufacturerClaimApi.setStatus(
                        token,
                        claim.id,
                        claim.version,
                        "MATCHES_MANUFACTURER",
                      ),
                    )
                  }
                >
                  Gyártói forrással egyezik
                </PilotButton>
              ) : null}
              {checkable &&
              !draft &&
              linkHolds &&
              canApprove &&
              claim.status !== "INDEPENDENTLY_CONFIRMED" ? (
                <PilotButton
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      manufacturerClaimApi.setStatus(
                        token,
                        claim.id,
                        claim.version,
                        "INDEPENDENTLY_CONFIRMED",
                      ),
                    )
                  }
                >
                  Független forrással megerősítve
                </PilotButton>
              ) : null}
              {checkable && !draft && claim.status !== "DISPUTED" ? (
                <PilotButton
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      manufacturerClaimApi.setStatus(
                        token,
                        claim.id,
                        claim.version,
                        "DISPUTED",
                      ),
                    )
                  }
                >
                  Eltér / vitatott
                </PilotButton>
              ) : null}
              {canManage && !draft && claim.status !== "UNVERIFIED" ? (
                <PilotButton
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      manufacturerClaimApi.setStatus(
                        token,
                        claim.id,
                        claim.version,
                        "UNVERIFIED",
                      ),
                    )
                  }
                >
                  Vissza ellenőrizetlenre
                </PilotButton>
              ) : null}
              {canManage && !draft ? (
                <PilotButton
                  variant="secondary"
                  disabled={busy}
                  onClick={() => edit(claim)}
                >
                  Szerkesztés
                </PilotButton>
              ) : null}
              {canManage && !draft ? (
                <PilotButton
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setArchiving(claim.id)}
                >
                  Archiválás
                </PilotButton>
              ) : null}
              <PilotButton
                variant="secondary"
                disabled={busy}
                onClick={() => void toggleContent(claim.id)}
              >
                {content[claim.id]
                  ? "Tartalmak elrejtése"
                  : "Érintett tartalmak"}
              </PilotButton>
            </div>

            {content[claim.id] ? (
              content[claim.id]!.length === 0 ? (
                <p className="text-xs text-dusk-500">
                  Egyetlen tartalom sem épül erre az állításra.
                </p>
              ) : (
                <ul className="space-y-0.5 text-xs">
                  {content[claim.id]!.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={
                          item.channel === "ARTICLE"
                            ? `/tartalom/${encodeURIComponent(item.id)}/cikk`
                            : "/tartalom"
                        }
                        className="text-brand-600 underline"
                      >
                        {item.title}
                      </Link>{" "}
                      <span className="text-dusk-500">({item.state})</span>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
        );
      })}

      {draft ? (
        <div className="space-y-2 rounded-lg border border-dusk-200 p-3 text-sm">
          <p className="text-xs text-dusk-500">
            {draft.editing
              ? "A mentés új változatot nyit. Ha magát az állítást (fajta, szöveg, forrás, szám) módosítod, az ellenőrzés törlődik, a rá épülő jóváhagyott tartalmak visszalépnek jóváhagyásra, és innentől te vagy a rögzítő; a megjegyzés javítása az ellenőrzést megtartja."
              : "Az állítás ellenőrizetlenül kerül fel: ellenőrizni nem az tudja, aki rögzítette."}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-dusk-500">Fajta</span>
              <PilotSelect
                aria-label="Fajta"
                value={draft.claimType}
                onChange={(value) =>
                  setDraft({ ...draft, claimType: value as ClaimType })
                }
              >
                {(Object.keys(CLAIM_TYPE_TEXT) as ClaimType[]).map((type) => (
                  <option key={type} value={type}>
                    {CLAIM_TYPE_TEXT[type]}
                  </option>
                ))}
              </PilotSelect>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-dusk-500">Forrás fajtája</span>
              <PilotSelect
                aria-label="Forrás fajtája"
                value={draft.sourceKind}
                onChange={(value) =>
                  setDraft({ ...draft, sourceKind: value as ClaimSourceKind })
                }
              >
                {(Object.keys(SOURCE_KIND_TEXT) as ClaimSourceKind[]).map(
                  (kind) => (
                    <option key={kind} value={kind}>
                      {SOURCE_KIND_TEXT[kind]}
                    </option>
                  ),
                )}
              </PilotSelect>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-dusk-500">Kiolvasva</span>
              <PilotInput
                aria-label="Kiolvasva"
                type="date"
                value={draft.sourceReadOn}
                onChange={(value) =>
                  setDraft({ ...draft, sourceReadOn: value })
                }
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-dusk-500">
                A gyártó közzétette (ha datált)
              </span>
              <PilotInput
                aria-label="Közzétéve"
                type="date"
                value={draft.sourcePublishedOn}
                onChange={(value) =>
                  setDraft({ ...draft, sourcePublishedOn: value })
                }
              />
            </label>
            {draft.editing?.onFact ? (
              <p className="text-xs text-dusk-500 sm:col-span-2">
                A szám a Product Knowledge tényben van, itt nem adható meg.
              </p>
            ) : (
              <>
                <label className="space-y-1">
                  <span className="text-xs text-dusk-500">
                    Szám-érték (nem kötelező)
                  </span>
                  <PilotInput
                    aria-label="Szám-érték"
                    inputMode="decimal"
                    value={draft.valueAmount}
                    onChange={(value) =>
                      setDraft({ ...draft, valueAmount: value })
                    }
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-dusk-500">Mértékegység</span>
                  <PilotInput
                    aria-label="Mértékegység"
                    value={draft.valueUnit}
                    onChange={(value) =>
                      setDraft({ ...draft, valueUnit: value })
                    }
                  />
                </label>
              </>
            )}
          </div>
          <label className="block space-y-1">
            <span className="text-xs text-dusk-500">
              Az állítás, ahogy a forrásban áll
            </span>
            <Textarea
              aria-label="Az állítás"
              value={draft.claimText}
              onChange={(event) =>
                setDraft({ ...draft, claimText: event.target.value })
              }
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-dusk-500">
              Forrás (webcím vagy fájl)
            </span>
            <PilotInput
              aria-label="Forrás"
              value={draft.sourceRef}
              onChange={(value) => setDraft({ ...draft, sourceRef: value })}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-dusk-500">Megjegyzés</span>
            <PilotInput
              aria-label="Megjegyzés"
              value={draft.note}
              onChange={(value) => setDraft({ ...draft, note: value })}
            />
          </label>
          <div className="flex gap-2 pt-1">
            <PilotButton disabled={busy} onClick={save}>
              Mentés
            </PilotButton>
            <PilotButton
              variant="secondary"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              Mégsem
            </PilotButton>
          </div>
        </div>
      ) : null}

      <p className="text-xs">
        <Link
          href="/products/gyartoi-allitasok"
          className="text-brand-600 underline"
        >
          Az összes gyártói állítás, ellenőrzésre várók
        </Link>
      </p>

      <ConfirmDialog
        open={archiving !== null}
        title="Archiválod ezt a gyártói állítást?"
        consequence="Az állítás nem írható ki többé. A rá épülő, már jóváhagyott tartalmak visszalépnek jóváhagyásra; az ütemezettek hozzászólást kapnak."
        recovery="Az állítás és a naplója megmarad, de visszaállítani nem lehet: ha mégis kell, rögzítsd újra, és más ellenőrizze."
        confirmLabel="Archiválás"
        busy={busy}
        onConfirm={() => {
          const id = archiving;
          setArchiving(null);
          if (id) void act(() => manufacturerClaimApi.archive(token, id));
        }}
        onCancel={() => setArchiving(null)}
      />
    </PilotSection>
  );
}
