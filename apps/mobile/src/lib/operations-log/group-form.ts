// RELATÍV ÚT, NEM `@/`: a teszt-fordító nem ismeri az aliast (`tsconfig.test.json`-ban nincs `paths`).
import type { PickedFile } from "../api/picked-image";
import {
  buildOperationsEntry,
  emptyOperationsEntryForm,
  type BuildOperationsEntryResult,
  type OperationsEntryForm,
  type OperationsEntryFormField,
  type OperationsEntryPhotoToSend,
} from "./entry-form";
import type {
  CreateOperationsEntryInput,
  OperationsTemplate,
  OperationsTemplateField,
} from "./types";

/**
 * A CSOPORTOS RÖGZÍTÉS ŰRLAPJÁNAK LOGIKÁJA (kártya 1a35e8f3; Balázs, 2026-11-15: „több helyszínen több homokszűrő van, ezeket van hogy
 * egyszerre mossák vissza, és egyszerre rögzítenék a naplóba”, a vízóra KÖZÖS). Tiszta modul: a képernyőre nincs komponens-teszt.
 *
 * AZ ELV: egy űrlap, eszközönként KÜLÖN bejegyzés. A közös rész (kezdés, résztvevők, belső megjegyzés, a vízóra) egyszer áll az űrlapon, és
 * MINDEN bejegyzésre rákerül, tehát minden bejegyzés teljes és önálló marad (az eszköz előzménye és a havi sora változatlan); az eszközönként
 * eltérő mezők (a visszamosás ideje, az öblítés) és a rendellenesség eszközönként állnak. A csoportot a közös `groupId` köti össze, a
 * szerver a kimutatásban a közös vízórát egyszer számolja. A bejegyzések validációját a MEGLÉVŐ `buildOperationsEntry` végzi (nincs második
 * szabálykészlet): ez a modul csak összerakja az eszközönkénti űrlapot, és megnevezi, melyik eszköz melyik mezője hibás.
 */

/** Egy csoportban legfeljebb ennyi eszköz: az űrlap eszközönként egy kártya, és egy tucat fölött már nem egy mosásról van szó. */
export const GROUP_MAX_ASSETS = 12;

export interface GroupAsset {
  id: string;
  /** Az eszköz neve a kártyán és a hibaüzenetben. */
  label: string;
}

/** A közös mezők: a vízóra (a sablon mezője, amelyiknek vízóra-szerepe van). Minden más mező eszközönként áll. */
export function isSharedField(field: OperationsTemplateField): boolean {
  return field.meterRole !== null;
}

export function sharedFields(
  template: OperationsTemplate,
): OperationsTemplateField[] {
  return template.fields.filter(isSharedField);
}

export function perAssetFields(
  template: OperationsTemplate,
): OperationsTemplateField[] {
  return template.fields.filter((field) => !isSharedField(field));
}

/**
 * A KÖZÖS SABLONOK: azok a sablonok, amelyek MINDEN kiválasztott eszköznél elérhetők (azonosító szerint: egy kategóriára szóló sablon
 * az azonos kategóriájú eszközöknél ugyanaz a sablon). Az első eszköz sorrendjében, az első eszköz példányával (a mezők a közös azonosítón
 * azonosak). Üres eszköz-lista vagy egy sablon nélküli eszköz: nincs közös sablon.
 */
export function commonTemplates<T extends { id: string }>(
  templateLists: readonly (readonly T[])[],
): T[] {
  const [first, ...rest] = templateLists;
  if (!first) return [];
  return first.filter((template) =>
    rest.every((list) => list.some((item) => item.id === template.id)),
  );
}

/** Egy eszköz része az űrlapon: a nem közös mezők értékei és fényképei, és a rendellenesség (eszközönként, mert eszközönként nyílik jegy). */
export interface GroupAssetPart {
  values: Record<string, string | boolean>;
  photos: Record<string, PickedFile[]>;
  anomaly: boolean;
  anomalyNote: string;
}

export interface GroupEntryForm {
  /** A „Kezdés” gomb pillanata; `null`, amíg meg nem nyomták. */
  startedAt: Date | null;
  /** A közös (vízóra) mezők beírt értékei. */
  shared: Record<string, string | boolean>;
  participantIds: string[];
  internalNote: string;
  /** Eszközönként a saját rész. */
  perAsset: Record<string, GroupAssetPart>;
}

export function emptyGroupAssetPart(): GroupAssetPart {
  return { values: {}, photos: {}, anomaly: false, anomalyNote: "" };
}

export function emptyGroupForm(assets: readonly GroupAsset[]): GroupEntryForm {
  return {
    startedAt: null,
    shared: {},
    participantIds: [],
    internalNote: "",
    perAsset: Object.fromEntries(
      assets.map((asset) => [asset.id, emptyGroupAssetPart()]),
    ),
  };
}

/** Egy eszköz egyedi űrlapja a közös részből és a saját részéből: ezt kapja a meglévő `buildOperationsEntry`. */
export function assetEntryForm(
  form: GroupEntryForm,
  assetId: string,
): OperationsEntryForm {
  const part = form.perAsset[assetId] ?? emptyGroupAssetPart();
  return {
    ...emptyOperationsEntryForm(),
    startedAt: form.startedAt,
    values: { ...part.values, ...form.shared },
    participantIds: form.participantIds,
    anomaly: part.anomaly,
    anomalyNote: part.anomalyNote,
    internalNote: form.internalNote,
    photos: part.photos,
  };
}

function hash32(text: string): string {
  // FNV-1a: determinisztikus, rövid; nem biztonsági célú (a csoport-azonosító nem titok, a szerver csak az egyediségét őrzi)
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * A CSOPORT AZONOSÍTÓJA: a sablon, a kezdés és az eszközök halmaza határozza meg, tehát ugyanaz az űrlap (egy duplán megnyomott „Kész”,
 * egy újrapróbálás) ugyanazt az azonosítót adja, és nem hoz létre második csoportot. A szerver mintája `^[A-Za-z0-9_.:-]{8,64}$`.
 */
export function operationsGroupId(input: {
  templateId: string;
  startedAt: string;
  assetIds: readonly string[];
}): string {
  const assets = [...input.assetIds].sort().join(",");
  return `grp:${hash32(input.templateId)}:${Date.parse(input.startedAt)}:${hash32(assets)}`;
}

export interface GroupEntryToSave {
  assetId: string;
  assetLabel: string;
  payload: CreateOperationsEntryInput & { queueTitle: string };
  photos: OperationsEntryPhotoToSend[];
  operationId: string;
}

/** A hiba helye az űrlapon: a közös mezők (`shared:`), egy eszköz mezője (`asset:<eszköz>:<kulcs>`), vagy egy közös elem. */
export type GroupFormField =
  | `shared:${string}`
  | `asset:${string}:${string}`
  | `asset:${string}:anomalyNote`
  | "startedAt"
  | "internalNote"
  | "participants"
  | "group";

export type BuildGroupResult =
  | {
      ok: true;
      groupId: string;
      entries: GroupEntryToSave[];
    }
  | { ok: false; field: GroupFormField; message: string };

function mapField(
  failure: Extract<BuildOperationsEntryResult, { ok: false }>,
  assetId: string,
  shared: ReadonlySet<string>,
): GroupFormField {
  const field: OperationsEntryFormField | null = failure.field;
  if (field === null) return "group";
  if (field.startsWith("field:")) {
    const key = field.slice("field:".length);
    return shared.has(key) ? `shared:${key}` : `asset:${assetId}:${key}`;
  }
  if (field === "anomalyNote") return `asset:${assetId}:anomalyNote`;
  // `startedAt`, `internalNote`, `participants`: a közös részhez tartoznak
  return field as "startedAt" | "internalNote" | "participants";
}

/**
 * A TELJES CSOPORTOS ŰRLAP SZERVER-KÉSZ BEJEGYZÉSEKKÉ -- VAGY EGY MEGNEVEZETT HIBA. Eszközönként a meglévő `buildOperationsEntry`-t futtatja
 * (ugyanaz a validáció, ugyanaz a mondat), és CSAK akkor ad vissza bármit, ha MINDEN eszköz érvényes: egy félig küldött csoport nincs. A
 * közös mező hibája (például a kötelező vízóra) közös helyen jön, nem az első eszköz nevével; az eszközönkénti hiba az eszköz nevével.
 */
export function buildGroupEntries(input: {
  template: OperationsTemplate;
  assets: readonly GroupAsset[];
  form: GroupEntryForm;
  now: Date;
}): BuildGroupResult {
  const { template, assets, form, now } = input;
  if (assets.length < 2)
    return {
      ok: false,
      field: "group",
      message: "A csoportos rögzítéshez legalább két eszköz kell.",
    };
  if (assets.length > GROUP_MAX_ASSETS)
    return {
      ok: false,
      field: "group",
      message: `Egy csoportban legfeljebb ${GROUP_MAX_ASSETS} eszköz lehet.`,
    };
  const shared = new Set(sharedFields(template).map((field) => field.key));
  const built: {
    asset: GroupAsset;
    result: Extract<BuildOperationsEntryResult, { ok: true }>;
  }[] = [];
  for (const asset of assets) {
    const result = buildOperationsEntry({
      template,
      assetId: asset.id,
      assetLabel: asset.label,
      form: assetEntryForm(form, asset.id),
      now,
    });
    if (!result.ok) {
      const field = mapField(result, asset.id, shared);
      const common = !field.startsWith("asset:");
      return {
        ok: false,
        field,
        message: common ? result.message : `${asset.label}: ${result.message}`,
      };
    }
    built.push({ asset, result });
  }
  const startedAt = built[0]!.result.payload.startedAt;
  const groupId = operationsGroupId({
    templateId: template.id,
    startedAt,
    assetIds: assets.map((asset) => asset.id),
  });
  return {
    ok: true,
    groupId,
    entries: built.map(({ asset, result }) => ({
      assetId: asset.id,
      assetLabel: asset.label,
      operationId: result.operationId,
      photos: result.photos,
      payload: { ...result.payload, groupId },
    })),
  };
}
