import type { PreparedArticle } from "./types";

export async function copyArticleBody(article: PreparedArticle): Promise<void> {
  const body = document.createElement("div");
  body.innerHTML = article.previewHtml;
  body.querySelector("h1")?.remove();
  // Pasted HTML cannot reliably transfer local image bytes into X. Leave useful
  // placement markers instead of copying object URLs that expire in this app.
  for (const image of body.querySelectorAll("img")) {
    const asset = article.assets.find(
      (item) => item.url === image.getAttribute("src"),
    );
    const marker = document.createElement("p");
    marker.textContent =
      "[Image: " +
      (asset?.spec.label || "image") +
      " — add from the Images panel]";
    image.replaceWith(marker);
  }
  const html = body.innerHTML;
  body.style.cssText =
    "position:fixed;left:-100000px;top:0;pointer-events:none";
  document.body.append(body);
  const text = body.innerText;
  body.remove();
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
    throw new Error("Rich clipboard is unavailable.");
  await navigator.clipboard.write([
    new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([text], { type: "text/plain" }),
    }),
  ]);
}

async function asPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const image = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) {
    image.close();
    throw new Error("Canvas is unavailable.");
  }
  context.drawImage(image, 0, 0);
  image.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value ? resolve(value) : reject(new Error("Image conversion failed.")),
      "image/png",
    ),
  );
}

export async function copyImage(blob: Blob): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
    throw new Error("Image clipboard is unavailable.");
  await navigator.clipboard.write([
    new ClipboardItem({ "image/png": asPng(blob) }),
  ]);
}
