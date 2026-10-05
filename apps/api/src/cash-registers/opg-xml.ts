import { SaxesParser } from "saxes";
export const SOAP_NS = "http://www.w3.org/2003/05/soap-envelope";
export const OPG_API_NS = "http://schemas.nav.gov.hu/OPF/1.0/api";
export const OPG_LOG_NS = "http://schemas.nav.gov.hu/OPGN/2.0";
export const XOP_NS = "http://www.w3.org/2004/08/xop/include";
export class OpgError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "OpgError";
  }
}
export interface OpgNode {
  name: string;
  uri: string;
  text: string;
  attributes: Record<string, string>;
  children: OpgNode[];
}
export const element = (n: OpgNode | undefined, name: string, uri = n?.uri) =>
  n?.children.find((c) => c.name === name && c.uri === uri);
export const elements = (n: OpgNode | undefined, name: string, uri = n?.uri) =>
  n?.children.filter((c) => c.name === name && c.uri === uri) ?? [];
export const text = (n: OpgNode | undefined, name: string, uri = n?.uri) =>
  element(n, name, uri)?.text.trim();
export function parseOpgXml(xml: string): OpgNode {
  if (Buffer.byteLength(xml) > 16 * 1024 * 1024)
    throw new OpgError("OPG_XML_TOO_LARGE");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new OpgError("OPG_XML_INVALID");
  const roots: OpgNode[] = [],
    stack: OpgNode[] = [];
  let count = 0;
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    if (stack.length >= 64 || ++count > 250000)
      throw new OpgError("OPG_XML_TOO_COMPLEX");
    const n: OpgNode = {
      name: tag.local,
      uri: tag.uri,
      text: "",
      children: [],
      attributes: Object.fromEntries(
        Object.values(tag.attributes).map((a) => [a.local, a.value]),
      ),
    };
    const parent = stack.at(-1);
    if (parent) parent.children.push(n);
    else roots.push(n);
    stack.push(n);
  });
  parser.on("text", (v) => {
    const n = stack.at(-1);
    if (n) n.text += v;
  });
  parser.on("cdata", (v) => {
    const n = stack.at(-1);
    if (n) n.text += v;
  });
  parser.on("closetag", () => {
    stack.pop();
  });
  try {
    parser.write(xml).close();
  } catch (error) {
    if (error instanceof OpgError) throw error;
    throw new OpgError("OPG_XML_INVALID");
  }
  if (roots.length !== 1) throw new OpgError("OPG_XML_INVALID");
  return roots[0]!;
}
export function unsignedInteger(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new OpgError("OPG_NUMBER_INVALID");
  return Number(value);
}
