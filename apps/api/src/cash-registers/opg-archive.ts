import { inflateRawSync, crc32 } from "node:zlib";
import { OpgError } from "./opg-xml.js";
const LIMIT = 16 * 1024 * 1024;
interface Ber {
  tag: number;
  body: Buffer;
  children: Ber[];
}
/** Bounded BER reader: CMS encapContentInfo only; this does not verify a signature. */
export function cmsPayload(input: Buffer): Buffer {
  let nodes = 0;
  function read(offset: number, depth: number): [Ber, number] {
    if (depth > 32 || ++nodes > 10000 || offset + 2 > input.length)
      throw new OpgError("OPG_CMS_INVALID");
    const tag = input[offset++]!;
    let length = input[offset++]!;
    const indefinite = length === 128;
    if (length > 128) {
      const n = length & 127;
      if (n > 4 || offset + n > input.length)
        throw new OpgError("OPG_CMS_INVALID");
      length = 0;
      for (let i = 0; i < n; i++) length = length * 256 + input[offset++]!;
    }
    if (indefinite && !(tag & 32)) throw new OpgError("OPG_CMS_INVALID");
    const start = offset,
      end = indefinite ? input.length : offset + length;
    if (end > input.length) throw new OpgError("OPG_CMS_INVALID");
    const children: Ber[] = [];
    if (tag & 32) {
      while (offset < end) {
        if (indefinite && input[offset] === 0 && input[offset + 1] === 0) break;
        const [child, next] = read(offset, depth + 1);
        children.push(child);
        offset = next;
      }
      if (indefinite) {
        if (offset + 2 > input.length) throw new OpgError("OPG_CMS_INVALID");
      } else if (offset !== end) throw new OpgError("OPG_CMS_INVALID");
    }
    const body = input.subarray(start, indefinite ? offset : end);
    return [{ tag, body, children }, indefinite ? offset + 2 : end];
  }
  try {
    const [root, end] = read(0, 0);
    if (
      end !== input.length ||
      root.tag !== 48 ||
      root.children[0]?.body.toString("hex") !== "2a864886f70d010702"
    )
      throw new Error();
    const signed = root.children[1]?.children[0],
      encap = signed?.children[2];
    if (
      encap?.tag !== 48 ||
      encap.children[0]?.body.toString("hex") !== "2a864886f70d010701"
    )
      throw new Error();
    const content = encap.children[1];
    if (content?.tag !== 160 || content.children.length !== 1)
      throw new Error();
    function octets(n: Ber): Buffer {
      if (n.tag === 4) return n.body;
      if (n.tag === 36) return Buffer.concat(n.children.map(octets));
      throw new Error();
    }
    const xml = octets(content.children[0]!);
    if (!xml.length || xml.length > LIMIT) throw new Error();
    return xml;
  } catch {
    throw new OpgError("OPG_CMS_INVALID");
  }
}
export function archivePayload(input: Buffer): Buffer {
  try {
    if (input.length > 32 * 1024 * 1024) throw new Error();
    let e = -1;
    for (let i = input.length - 22; i >= Math.max(0, input.length - 65557); i--)
      if (input.readUInt32LE(i) === 0x06054b50) {
        e = i;
        break;
      }
    if (
      e < 0 ||
      input.readUInt16LE(e + 4) ||
      input.readUInt16LE(e + 6) ||
      e + 22 + input.readUInt16LE(e + 20) !== input.length
    )
      throw new Error();
    const count = input.readUInt16LE(e + 10);
    if (count < 1 || count > 4 || input.readUInt16LE(e + 8) !== count)
      throw new Error();
    let p = input.readUInt32LE(e + 16),
      payload: Buffer | undefined,
      total = 0;
    for (let i = 0; i < count; i++) {
      if (input.readUInt32LE(p) !== 0x02014b50 || input.readUInt16LE(p + 8) & 1)
        throw new Error();
      const compressed = input.readUInt32LE(p + 20),
        size = input.readUInt32LE(p + 24),
        method = input.readUInt16LE(p + 10),
        nameLength = input.readUInt16LE(p + 28);
      total += size;
      if (total > LIMIT) throw new Error();
      const name = input.subarray(p + 46, p + 46 + nameLength).toString("utf8");
      if (!name.endsWith("/")) {
        if (payload || !name.endsWith(".p7b")) throw new Error();
        const offset = input.readUInt32LE(p + 42);
        if (
          input.readUInt32LE(offset) !== 0x04034b50 ||
          input.readUInt16LE(offset + 8) !== method ||
          input.readUInt16LE(offset + 6) & 1
        )
          throw new Error();
        const start =
          offset +
          30 +
          input.readUInt16LE(offset + 26) +
          input.readUInt16LE(offset + 28);
        if (start + compressed > input.readUInt32LE(e + 16)) throw new Error();
        const data = input.subarray(start, start + compressed);
        payload =
          method === 0
            ? data
            : method === 8
              ? inflateRawSync(data, { maxOutputLength: LIMIT })
              : undefined;
        if (
          !payload ||
          payload.length !== size ||
          crc32(payload) !== input.readUInt32LE(p + 16)
        )
          throw new Error();
      }
      p +=
        46 +
        nameLength +
        input.readUInt16LE(p + 30) +
        input.readUInt16LE(p + 32);
    }
    if (!payload || p !== e) throw new Error();
    return cmsPayload(payload);
  } catch (error) {
    if (error instanceof OpgError) throw error;
    throw new OpgError("OPG_ARCHIVE_INVALID");
  }
}
