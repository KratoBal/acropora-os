/**
 * Small, dependency-free QR Code Model 2 encoder for the asset label use case.
 * It emits a fixed Version 5 / error-correction level L symbol (up to 106
 * UTF-8 bytes), which is ample for the configured asset deep link and keeps
 * production image generation fully local.
 */
const VERSION = 5;
const SIZE = VERSION * 4 + 17;
const DATA_CODEWORDS = 108;
const ECC_CODEWORDS = 26;
const MAX_BYTES = 106;

type Matrix = boolean[][];

export function createAssetQrSvg(value: string): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > MAX_BYTES)
    throw new Error(
      `ASSET_QR_BASE_URL is too long: QR payload is ${bytes.length} bytes, maximum is ${MAX_BYTES}.`,
    );
  const data = encodeData(bytes);
  const codewords = [...data, ...reedSolomonRemainder(data)];
  const modules = makeMatrix(codewords);
  return toSvg(modules);
}

function encodeData(bytes: Uint8Array): number[] {
  const bits: number[] = [];
  appendBits(bits, 0b0100, 4); // byte mode
  appendBits(bits, bytes.length, 8); // versions 1-9
  for (const byte of bytes) appendBits(bits, byte, 8);
  const capacity = DATA_CODEWORDS * 8;
  appendBits(bits, 0, Math.min(4, capacity - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const result: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    let value = 0;
    for (let offset = 0; offset < 8; offset++)
      value = (value << 1) | (bits[index + offset] ?? 0);
    result.push(value);
  }
  for (let pad = 0; result.length < DATA_CODEWORDS; pad++)
    result.push(pad % 2 === 0 ? 0xec : 0x11);
  return result;
}

function appendBits(target: number[], value: number, length: number) {
  for (let bit = length - 1; bit >= 0; bit--)
    target.push((value >>> bit) & 1);
}

function reedSolomonRemainder(data: number[]): number[] {
  const divisor = reedSolomonDivisor(ECC_CODEWORDS);
  const result = Array<number>(ECC_CODEWORDS).fill(0);
  for (const value of data) {
    const factor = value ^ result[0]!;
    result.shift();
    result.push(0);
    for (let index = 0; index < result.length; index++)
      result[index] = result[index]! ^ multiply(divisor[index]!, factor);
  }
  return result;
}

function reedSolomonDivisor(degree: number): number[] {
  const result = Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let iteration = 0; iteration < degree; iteration++) {
    for (let index = 0; index < degree; index++) {
      result[index] = multiply(result[index]!, root);
      if (index + 1 < degree) result[index] ^= result[index + 1]!;
    }
    root = multiply(root, 0x02);
  }
  return result;
}

function multiply(left: number, right: number): number {
  let result = 0;
  for (let bit = 7; bit >= 0; bit--) {
    result = (result << 1) ^ ((result >>> 7) * 0x11d);
    result ^= ((right >>> bit) & 1) * left;
  }
  return result;
}

function makeMatrix(codewords: number[]): Matrix {
  const modules = Array.from({ length: SIZE }, () =>
    Array<boolean>(SIZE).fill(false),
  );
  const isFunction = Array.from({ length: SIZE }, () =>
    Array<boolean>(SIZE).fill(false),
  );
  const setFunction = (x: number, y: number, dark: boolean) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    modules[y]![x] = dark;
    isFunction[y]![x] = true;
  };

  drawFinder(3, 3, setFunction);
  drawFinder(SIZE - 4, 3, setFunction);
  drawFinder(3, SIZE - 4, setFunction);
  for (let index = 0; index < SIZE; index++) {
    if (!isFunction[6]![index]) setFunction(index, 6, index % 2 === 0);
    if (!isFunction[index]![6]) setFunction(6, index, index % 2 === 0);
  }
  drawAlignment(30, 30, setFunction);
  drawFormatBits(0, setFunction); // reserve and set mask 0 metadata

  const bits = codewords.flatMap((value) =>
    Array.from({ length: 8 }, (_, index) => (value >>> (7 - index)) & 1),
  );
  let bitIndex = 0;
  let upward = true;
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right--;
    for (let vertical = 0; vertical < SIZE; vertical++) {
      const y = upward ? SIZE - 1 - vertical : vertical;
      for (let offset = 0; offset < 2; offset++) {
        const x = right - offset;
        if (isFunction[y]![x]) continue;
        const raw = bits[bitIndex++] === 1;
        const masked = (x + y) % 2 === 0; // mask pattern 0
        modules[y]![x] = raw !== masked;
      }
    }
    upward = !upward;
  }
  drawFormatBits(0, setFunction);
  return modules;
}

function drawFinder(
  centerX: number,
  centerY: number,
  set: (x: number, y: number, dark: boolean) => void,
) {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      set(centerX + dx, centerY + dy, distance !== 2 && distance !== 4);
    }
  }
}

function drawAlignment(
  centerX: number,
  centerY: number,
  set: (x: number, y: number, dark: boolean) => void,
) {
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++)
      set(centerX + dx, centerY + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
}

function drawFormatBits(
  mask: number,
  set: (x: number, y: number, dark: boolean) => void,
) {
  const data = (1 << 3) | mask; // error correction level L = format value 1
  let remainder = data;
  for (let index = 0; index < 10; index++)
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  const bits = ((data << 10) | remainder) ^ 0x5412;
  const bit = (index: number) => ((bits >>> index) & 1) !== 0;

  for (let index = 0; index <= 5; index++) set(8, index, bit(index));
  set(8, 7, bit(6));
  set(8, 8, bit(7));
  set(7, 8, bit(8));
  for (let index = 9; index < 15; index++) set(14 - index, 8, bit(index));
  for (let index = 0; index < 8; index++)
    set(SIZE - 1 - index, 8, bit(index));
  for (let index = 8; index < 15; index++)
    set(8, SIZE - 15 + index, bit(index));
  set(8, SIZE - 8, true);
}

function toSvg(modules: Matrix): string {
  const border = 4;
  const dimension = SIZE + border * 2;
  const path: string[] = [];
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++)
      if (modules[y]![x]) path.push(`M${x + border},${y + border}h1v1h-1z`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${dimension} ${dimension}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path.join("")}" fill="#000"/></svg>`;
}
