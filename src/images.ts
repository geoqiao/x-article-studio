import { MAX_IMAGE_BYTES, MAX_SOURCE_BYTES, sniffImage } from './files';

export type NormalizedImage = { blob: Blob; width: number; height: number; note?: string };

/** Longest edge after downscaling. X shows article images far narrower than this. */
const MAX_EDGE = 2400;
const mib = (bytes: number) => (bytes / 1048576).toFixed(1);

function checkDimensions(width: number, height: number): void {
  if (width > 16_384 || height > 16_384 || width * height > 40_000_000) throw new Error('Image dimensions exceed this version’s processing limit. Resize it first.');
}

async function encode(draw: (ctx: CanvasRenderingContext2D) => void, width: number, height: number, mime: string, quality?: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas rendering is unavailable in this browser.');
  // JPEG has no transparency: flatten on white instead of black.
  if (mime === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); }
  draw(ctx);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Image re-encoding failed.')), mime, quality));
}

/** Re-encode a raster image until it fits the per-image limit. PNG falls back to JPEG for photos. */
async function shrink(blob: Blob, mime: string, width: number, height: number): Promise<{ blob: Blob; width: number; height: number }> {
  let target = mime;
  let scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  for (let attempt = 0; attempt < 8; attempt++) {
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const bitmap = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    try {
      const out = await encode((ctx) => ctx.drawImage(bitmap, 0, 0, w, h), w, h, target, target === 'image/png' ? undefined : 0.86);
      if (out.size <= MAX_IMAGE_BYTES) return { blob: out, width: w, height: h };
    } finally { bitmap.close(); }
    if (target === 'image/png' && attempt >= 1) target = 'image/jpeg';
    else scale *= 0.75;
  }
  throw new Error('Image could not be reduced below 5 MiB. Resize or recompress it before attaching.');
}

/** Render an SVG to a crisp PNG. Scripts never run: the browser draws it as an image. */
export async function rasterizeSvg(blob: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const url = URL.createObjectURL(new Blob([blob], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('This SVG could not be rendered. Export it as PNG instead.'));
      image.src = url;
    });
    const naturalWidth = image.naturalWidth || 1200;
    const naturalHeight = image.naturalHeight || Math.round(naturalWidth * 0.6);
    let scale = Math.max(1, 1600 / naturalWidth);
    scale = Math.min(scale, MAX_EDGE / Math.max(naturalWidth, naturalHeight));
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    const png = await encode((ctx) => ctx.drawImage(image, 0, 0, width, height), width, height, 'image/png');
    return png.size <= MAX_IMAGE_BYTES ? { blob: png, width, height } : shrink(png, 'image/png', width, height);
  } finally { URL.revokeObjectURL(url); }
}

/**
 * Verify an image and make it acceptable to X: typed bytes, known dimensions,
 * SVG rendered to PNG, oversized files downscaled. The note explains any change.
 */
export async function normalizeImage(blob: Blob, label: string): Promise<NormalizedImage> {
  if (blob.size > MAX_SOURCE_BYTES) throw new Error('Image is larger than 40 MiB. Resize it before attaching.');
  const mime = await sniffImage(blob);
  if (mime === 'image/svg+xml') {
    const result = await rasterizeSvg(blob);
    return { ...result, note: `“${label}” is an SVG and was rendered as a ${result.width} × ${result.height} PNG. Check it in the preview.` };
  }
  const typed = new Blob([blob], { type: mime });
  const bitmap = await createImageBitmap(typed);
  const { width, height } = bitmap;
  bitmap.close();
  checkDimensions(width, height);
  if (typed.size <= MAX_IMAGE_BYTES) return { blob: typed, width, height };
  const result = await shrink(typed, mime, width, height);
  return { ...result, note: `“${label}” was ${mib(typed.size)} MiB and was downscaled to ${result.width} × ${result.height} (${mib(result.blob.size)} MiB) to fit X’s 5 MiB limit.` };
}
