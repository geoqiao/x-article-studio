import type { PreparedArticle } from "./types";

export type ArticleClipboard = { html: string; text: string };

/** Clipboard HTML follows X's block names, independently of preview styling. */
export function createArticleClipboard(article: Pick<PreparedArticle, 'plan' | 'previewHtml' | 'assets'>): ArticleClipboard {
  const body = document.createElement("div");
  const preview = document.createElement("template");
  preview.innerHTML = article.previewHtml; // Already sanitized by safePreview.
  const root = preview.content.querySelector(".xp-article");
  if (!root) throw new Error("The formatted article is unavailable.");
  root.querySelector(":scope > .xp-title")?.remove();
  body.append(...root.childNodes);

  // X's Heading/Subheading blocks are header-one/header-two. In our preview
  // those are h2/h3, leaving h1 for the separate article title.
  for (const heading of body.querySelectorAll("h2, h3")) {
    const replacement = document.createElement(heading.tagName === "H2" ? "h1" : "h2");
    replacement.append(...heading.childNodes);
    heading.replaceWith(replacement);
  }
  // Pasted HTML cannot reliably transfer local image bytes into X. Leave useful
  // placement markers instead of copying object URLs that expire in this app.
  for (const figure of body.querySelectorAll("figure.xp-fig")) {
    const spec = article.plan.assets.find(item => item.id === figure.getAttribute("data-asset-id"));
    const marker = document.createElement("p");
    marker.textContent =
      "[Image: " +
      (spec?.label || "image") +
      " — add from the Images panel]";
    figure.replaceWith(marker);
  }
  // Layout wrappers and xp-* attributes belong to the preview, not the article.
  for (const wrapper of body.querySelectorAll("div, figure")) {
    wrapper.replaceWith(...wrapper.childNodes);
  }
  for (const element of body.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (!(element.tagName === "A" && attribute.name === "href"))
        element.removeAttribute(attribute.name);
    }
  }
  for (const pre of body.querySelectorAll("pre")) {
    const code = document.createElement("code");
    code.append(...pre.childNodes);
    pre.append(code);
  }
  return {
    html: body.innerHTML,
    text: [...body.childNodes].map(blockText).filter(Boolean).join("\n\n"),
  };
}

function inlineText(node: Node): string {
  if (node instanceof Element && node.tagName === "BR") return "\n";
  if (node instanceof HTMLAnchorElement) {
    const label = node.textContent || "";
    const href = node.getAttribute("href") || "";
    return href && href !== label ? `${label} (${href})` : label;
  }
  return node.childNodes.length
    ? [...node.childNodes].map(inlineText).join("")
    : node.textContent || "";
}

function blockText(node: Node): string {
  if (!(node instanceof Element)) return node.textContent || "";
  if (node.matches("ul, ol")) {
    return [...node.children].map((item, index) =>
      `${node.tagName === "OL" ? `${index + 1}.` : "•"} ${inlineText(item)}`,
    ).join("\n");
  }
  if (node.tagName === "TABLE") {
    return [...node.querySelectorAll("tr")].map((row) =>
      [...row.children].map(inlineText).join("\t"),
    ).join("\n");
  }
  if (node.tagName === "HR") return "—";
  return inlineText(node);
}

/** Always supply both types; text/plain is readable prose, never source Markdown. */
export function setArticleClipboard(data: DataTransfer, body: ArticleClipboard): void {
  data.setData("text/html", body.html);
  data.setData("text/plain", body.text);
}

export function selectFormattedBody(element: HTMLElement): void {
  element.focus({ preventScroll: true });
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function copyWithSelection(body: ArticleClipboard): boolean {
  const selection = window.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange())
    : [];
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const inputSelection = focused instanceof HTMLTextAreaElement
    ? [focused.selectionStart, focused.selectionEnd, focused.selectionDirection] as const
    : null;
  const holder = document.createElement("div");
  holder.contentEditable = "true";
  holder.innerHTML = body.html;
  holder.style.cssText = "position:fixed;left:-100000px;top:0;pointer-events:none";
  document.body.append(holder);
  let wrote = false;
  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    setArticleClipboard(event.clipboardData, body);
    event.preventDefault();
    wrote = true;
  };
  document.addEventListener("copy", onCopy);
  try {
    selectFormattedBody(holder);
    return document.execCommand("copy") && wrote;
  } finally {
    document.removeEventListener("copy", onCopy);
    holder.remove();
    focused?.focus({ preventScroll: true });
    selection?.removeAllRanges();
    for (const range of ranges) selection?.addRange(range);
    if (focused instanceof HTMLTextAreaElement && inputSelection)
      focused.setSelectionRange(...inputSelection);
  }
}

export async function copyArticleBody(body: ArticleClipboard): Promise<void> {
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([body.html], { type: "text/html" }),
          "text/plain": new Blob([body.text], { type: "text/plain" }),
        }),
      ]);
      return;
    }
  } catch {
    // A denied Async Clipboard call can still allow copying a selected fragment.
  }
  if (!copyWithSelection(body)) throw new Error("Select the formatted body and copy it manually.");
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
