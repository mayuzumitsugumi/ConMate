import { validateProductMedia } from "../../domain/catalog/product-media";
export async function makeThumbnail(file: File): Promise<string> {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 5 * 1024 * 1024
  )
    throw new Error("請選擇5 MiB以內的 PNG、JPEG 或 WebP 圖片。");
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 24_000_000)
      throw new Error("圖片最多2,400萬像素。");
    const scale = Math.min(1, 160 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("瀏覽器無法建立縮圖。");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const thumbnail = canvas.toDataURL("image/webp", 0.75);
    validateProductMedia({ thumbnail });
    return thumbnail;
  } finally {
    bitmap.close();
  }
}
