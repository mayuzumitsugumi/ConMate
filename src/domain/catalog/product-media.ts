import type { CatalogItem } from "../models/catalog";
// Embedded raster only: no remote requests, SVG, animation or user metadata.
export const MAX_THUMBNAIL_LENGTH = 24_000;
export function validateProductMedia(p: {
  barcode?: unknown;
  thumbnail?: unknown;
}) {
  if (
    p.barcode !== undefined &&
    (typeof p.barcode !== "string" ||
      p.barcode.length > 80 ||
      /[^\x21-\x7e]/.test(p.barcode))
  )
    throw new Error("條碼限80字以內的可列印英文、數字或符號，不含空白。");
  if (p.thumbnail !== undefined && p.thumbnail !== "") {
    if (
      typeof p.thumbnail !== "string" ||
      p.thumbnail.length > MAX_THUMBNAIL_LENGTH ||
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(
        p.thumbnail,
      )
    )
      throw new Error("縮圖須為24,000字元以內的本機 PNG、JPEG 或 WebP 圖片。");
    const [header, data] = p.thumbnail.split(",") as [string, string];
    const bytes = atob(data);
    const valid = header.includes("png")
      ? bytes.startsWith("\x89PNG\r\n\x1a\n")
      : header.includes("jpeg")
        ? bytes.startsWith("\xff\xd8\xff")
        : bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP";
    if (!valid) throw new Error("縮圖內容與圖片格式不符。");
    const dimensions = imageDimensions(header, bytes);
    if (!dimensions || dimensions.some((n) => n < 1 || n > 160))
      throw new Error("縮圖尺寸須介於1至160像素，請重新選取原圖產生縮圖。");
  }
}
export function barcodeMatches(products: CatalogItem[], value: string) {
  const code = value.trim();
  return code
    ? products.filter(
        (p) => !p.archived && (p.barcode === code || p.code === code),
      )
    : [];
}

export function validateThumbnailBudget(products: { thumbnail?: string }[]) {
  if (products.reduce((n, p) => n + (p.thumbnail?.length || 0), 0) > 4_000_000)
    throw new Error(
      "工作區縮圖總容量最多4,000,000字元，請移除部分縮圖後再試。",
    );
}

function imageDimensions(
  header: string,
  b: string,
): [number, number] | undefined {
  const n = (i: number) => b.charCodeAt(i);
  const be16 = (i: number) => n(i) * 256 + n(i + 1);
  const le24 = (i: number) => n(i) + n(i + 1) * 256 + n(i + 2) * 65536;
  if (header.includes("png")) {
    if (b.length < 24 || b.slice(12, 16) !== "IHDR") return;
    const be32 = (i: number) => be16(i) * 65536 + be16(i + 2);
    return [be32(16), be32(20)];
  }
  if (header.includes("webp")) {
    if (b.length < 30) return;
    if (b.slice(12, 16) === "VP8X") return [le24(24) + 1, le24(27) + 1];
    if (b.slice(12, 16) === "VP8 " && b.slice(23, 26) === "\x9d\x01\x2a")
      return [(n(26) + 256 * n(27)) & 0x3fff, (n(28) + 256 * n(29)) & 0x3fff];
    if (b.slice(12, 16) === "VP8L" && n(20) === 0x2f)
      return [
        1 + n(21) + ((n(22) & 0x3f) << 8),
        1 + (n(22) >> 6) + (n(23) << 2) + ((n(24) & 15) << 10),
      ];
    return;
  }
  let at = 2;
  while (at + 8 < b.length) {
    if (n(at++) !== 255) return;
    while (n(at) === 255) at++;
    const marker = n(at++);
    if (marker === 0xda || marker === 0xd9) return;
    const length = be16(at);
    if (length < 2 || at + length > b.length) return;
    if ([0xc0, 0xc1, 0xc2].includes(marker))
      return [be16(at + 5), be16(at + 3)];
    at += length;
  }
}
