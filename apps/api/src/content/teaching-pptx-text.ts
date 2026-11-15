import PizZip from "pizzip";
import { SaxesParser } from "saxes";
import type { TeachingSlideText } from "@acropora/types";

/**
 * THE TEXT OF AN EDITED SLIDE DECK (T5.2, the "differs from the source"
 * mark): the slides of a .pptx in the order the presentation shows them, each
 * as its paragraphs, the first one the title. Only text is read: no image, no
 * layout, no macro; nothing in the file is run or rendered.
 *
 * THE ORDER COMES FROM ppt/presentation.xml (`p:sldIdLst`), through its
 * relationship file, not from the slide file names: PowerPoint keeps
 * `slide3.xml` as the name of a slide moved to the front.
 */

export class TeachingPptxError extends Error {}

/** A deck past this many slides or this much XML is no teaching deck; refused, not read. */
export const TEACHING_PPTX_LIMITS = {
  slides: 300,
  xmlBytes: 20_000_000,
} as const;

function xmlEvents(
  xml: string,
  handlers: {
    open?: (name: string, attrs: Record<string, string>) => void;
    close?: (name: string) => void;
    text?: (text: string) => void;
  },
): void {
  const parser = new SaxesParser({ xmlns: false });
  parser.on("opentag", (tag) => {
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(tag.attributes)) attrs[k] = String(v);
    handlers.open?.(tag.name, attrs);
  });
  parser.on("closetag", (tag) => handlers.close?.(tag.name));
  parser.on("text", (t) => handlers.text?.(t));
  parser.on("cdata", (t) => handlers.text?.(t));
  parser.write(xml).close();
}

/**
 * One part of the package as text, refused BEFORE inflating when its declared
 * size is past the limit. The declared size can lie; then the inflater's own
 * length check fails after the fact, and the upload limit (the controller's)
 * bounds what an upload can carry. The uploader is a content manager, not the
 * public.
 */
function read(zip: PizZip, path: string): string {
  const file = zip.file(path);
  if (!file)
    throw new TeachingPptxError(`A fájlban nincs ${path}: nem diasor.`);
  const declared = (
    file as unknown as { _data?: { uncompressedSize?: number } }
  )._data?.uncompressedSize;
  if (typeof declared === "number" && declared > TEACHING_PPTX_LIMITS.xmlBytes)
    throw new TeachingPptxError(
      "A diasor egy része túl nagy az összevetéshez.",
    );
  return file.asText();
}

/** The slide part paths in the order the presentation shows them. */
function slideOrder(zip: PizZip): string[] {
  const ids: string[] = [];
  xmlEvents(read(zip, "ppt/presentation.xml"), {
    open: (name, attrs) => {
      if (name === "p:sldId" && attrs["r:id"]) ids.push(attrs["r:id"]);
    },
  });
  const targets = new Map<string, string>();
  xmlEvents(read(zip, "ppt/_rels/presentation.xml.rels"), {
    open: (name, attrs) => {
      if (name === "Relationship" && attrs.Id && attrs.Target)
        targets.set(attrs.Id, attrs.Target);
    },
  });
  return ids.map((id) => {
    const target = targets.get(id);
    if (!target)
      throw new TeachingPptxError("A diasor egy diájára nincs hivatkozás.");
    // relative to ppt/, or absolute from the package root
    return target.startsWith("/")
      ? target.slice(1)
      : `ppt/${target.replace(/^\.\//, "")}`;
  });
}

/** The paragraphs of one slide, in document order, empty ones left out. */
function slideParagraphs(xml: string): string[] {
  const paragraphs: string[] = [];
  let current: string[] | null = null;
  let inText = false;
  xmlEvents(xml, {
    open: (name) => {
      if (name === "a:p") current = [];
      else if (name === "a:t") inText = true;
      else if (name === "a:br" && current) current.push(" ");
    },
    close: (name) => {
      if (name === "a:t") inText = false;
      else if (name === "a:p" && current) {
        const line = current.join("").replace(/\s+/g, " ").trim();
        if (line) paragraphs.push(line);
        current = null;
      }
    },
    text: (t) => {
      if (inText && current) current.push(t);
    },
  });
  return paragraphs;
}

/** The slides of a .pptx as text: the first paragraph the title, the rest the points. */
export function readTeachingPptxText(bytes: Uint8Array): TeachingSlideText[] {
  let zip: PizZip;
  try {
    zip = new PizZip(bytes);
  } catch {
    throw new TeachingPptxError("A fájl nem olvasható zip: nem .pptx diasor.");
  }
  const order = slideOrder(zip);
  if (order.length > TEACHING_PPTX_LIMITS.slides)
    throw new TeachingPptxError(
      `A diasor ${order.length} diás; legfeljebb ${TEACHING_PPTX_LIMITS.slides} olvasható.`,
    );
  let xmlBytes = 0;
  return order.map((path) => {
    const xml = read(zip, path);
    xmlBytes += xml.length;
    if (xmlBytes > TEACHING_PPTX_LIMITS.xmlBytes)
      throw new TeachingPptxError(
        "A diasor szövege túl nagy az összevetéshez.",
      );
    const [title = "", ...points] = slideParagraphs(xml);
    return { title, points };
  });
}
