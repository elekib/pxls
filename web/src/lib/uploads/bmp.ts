// Minimal BMP decoder (uncompressed 24/32-bit), since libvips cannot read BMP.

export interface Raw {
  width: number;
  height: number;
  data: Uint8Array; // RGB
}

export function decodeBmp(buf: Uint8Array): Raw {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (v.getUint16(0, false) !== 0x424d) throw new Error("not a BMP");
  const offset = v.getUint32(10, true);
  const width = v.getInt32(18, true);
  const rawHeight = v.getInt32(22, true);
  const bpp = v.getUint16(28, true);
  const compression = v.getUint32(30, true);
  // 0 = BI_RGB; 3 = BI_BITFIELDS, which for 32-bit is the usual BGRA layout.
  if ((bpp !== 24 && bpp !== 32) || (compression !== 0 && !(compression === 3 && bpp === 32))) {
    throw new Error("unsupported BMP");
  }
  const height = Math.abs(rawHeight);
  if (width <= 0 || height === 0 || width > 4096 || height > 4096) throw new Error("bad BMP size");
  const bytes = bpp / 8;
  const stride = Math.ceil((width * bytes) / 4) * 4;
  if (offset + stride * height > buf.length) throw new Error("truncated BMP");
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const srcRow = rawHeight > 0 ? height - 1 - y : y; // bottom-up unless height < 0
    for (let x = 0; x < width; x++) {
      const s = offset + srcRow * stride + x * bytes;
      const d = (y * width + x) * 3;
      data[d] = buf[s + 2]!;
      data[d + 1] = buf[s + 1]!;
      data[d + 2] = buf[s]!;
    }
  }
  return { width, height, data };
}
