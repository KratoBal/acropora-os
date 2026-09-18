import { createHash } from "node:crypto";

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

const encoder = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): Buffer {
  const out = Buffer.allocUnsafe(2);
  out.writeUInt16LE(value);
  return out;
}

function u32(value: number): Buffer {
  const out = Buffer.allocUnsafe(4);
  out.writeUInt32LE(value >>> 0);
  return out;
}

function safeName(name: string): string {
  if (!name || name.includes("\\") || name.includes("/") || name.includes("\0"))
    throw new Error("A ZIP-csomagban csak egyszerű fájlnév szerepelhet.");
  return name;
}

/**
 * Minimal, uncompressed ZIP writer. It keeps the package dependency-free and
 * intentionally stores each PDF as its own entry for audit-friendly retrieval.
 */
export function serviceJobPackageZip(entries: readonly ZipEntry[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(encoder.encode(safeName(entry.name)));
    const content = Buffer.from(entry.bytes);
    const crc = crc32(content);
    const localHeader = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(content.length),
      u32(content.length),
      u16(name.length),
      u16(0),
      name,
    ]);
    local.push(localHeader, content);
    central.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(content.length),
        u32(content.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    offset += localHeader.length + content.length;
  }

  const centralBytes = Buffer.concat(central);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralBytes.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...local, centralBytes, end]);
}

export function serviceJobPackageFileName(jobNumber: string): string {
  const clean = jobNumber
    .normalize("NFKC")
    .replace(/[\\/\p{Cc}\p{Cf}]/gu, "-")
    .trim()
    .slice(0, 120);
  return `${clean || "hibajegy"}-dokumentumcsomag.zip`;
}

/** The package fingerprint is intentionally available for a future seal manifest. */
export function serviceJobPackageSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
