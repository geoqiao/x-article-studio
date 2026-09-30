import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Bold,
  Check,
  CircleAlert,
  Code2,
  Copy,
  FileText,
  FolderOpen,
  HelpCircle,
  Image as ImageIcon,
  Link,
  List,
  LoaderCircle,
  Monitor,
  Network,
  Plus,
  Smartphone,
  Table2,
  Undo2,
  X,
} from "lucide-react";
import { createPlan, MAX_MARKDOWN_LENGTH, safeFileStem } from "./plan";
import {
  prepareArticle,
  safePreview,
  disposeAssets,
  exportArticle,
  type AssetCache,
} from "./prepare";
import { exportDraftBackup } from "./backup";
import { simplifyNestedLists } from "./normalize";
import { MarkdownEditor } from "./MarkdownEditor";
import {
  downloadBlob,
  MAX_TOTAL_BYTES,
  normalizePath,
  resolveLocalFile,
} from "./files";
import { getBridgeStatus, sendDraft } from "./bridge";
import { loadDraft, saveDraft } from "./storage";
import { SAMPLE, createSampleImage } from "./sample";
import { FORMATS } from "./compatibility";
import {
  copyArticleBody,
  copyImage,
  createArticleClipboard,
  selectFormattedBody,
  setArticleClipboard,
  type ArticleClipboard,
} from "./clipboard";
import logoUrl from "../public/logo.svg";
import { ArticlePreview } from "./ArticlePreview";
import type {
  AssetProgress,
  LocalAssetMap,
  PreparedArticle,
  TableMode,
} from "./types";

type Modal =
  | "images"
  | "help"
  | "formats"
  | "connect"
  | "new"
  | "example"
  | "copy"
  | null;
const STANDALONE = import.meta.env.VITE_STANDALONE_PREVIEW === "true";
const FENCE = String.fromCharCode(96).repeat(3);

export default function App() {
  const [markdown, setMarkdown] = useState(SAMPLE);
  const [title, setTitle] = useState("");
  const [tableMode, setTableMode] = useState<TableMode>("native");
  const [files, setFiles] = useState<LocalAssetMap>(new Map());
  const [imageUndo, setImageUndo] = useState<Map<string, File | undefined>>(
    new Map(),
  );
  const [documentPath, setDocumentPath] = useState("");
  const [highlightedLine, setHighlightedLine] = useState<number>();
  const [booting, setBooting] = useState(true);
  const [saving, setSaving] = useState("Saved locally");
  const [prepared, setPrepared] = useState<{
    article: PreparedArticle;
    files: LocalAssetMap;
    path: string;
  }>();
  const [busy, setBusy] = useState(true);
  const [progress, setProgress] = useState<Record<string, AssetProgress>>({});
  const [renderError, setRenderError] = useState("");
  const [retry, setRetry] = useState(0);
  const [phone, setPhone] = useState(false);
  const [mobileView, setMobileView] = useState<"write" | "preview">("write");
  const [modal, setModal] = useState<Modal>(null);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState("");
  const [bridge, setBridge] = useState(false);
  const [sending, setSending] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [manualCopy, setManualCopy] = useState<
    | { kind: "title"; text: string }
    | ({ kind: "body" } & ArticleClipboard)
    | null
  >(null);
  const manualBody = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const assetCache = useRef<AssetCache>(new Map());
  const markdownInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const activeAssets = useRef<PreparedArticle | undefined>(undefined);
  const importSequence = useRef(0);
  const plan = useMemo(
    () => createPlan(markdown, tableMode, title, documentPath),
    [markdown, tableMode, title, documentPath],
  );
  const current =
    prepared?.article.plan === plan &&
    prepared.files === files &&
    prepared.path === documentPath;
  const article = prepared?.article;
  const hasContent = !!markdown.trim();
  const issues = hasContent ? (current ? article!.issues : plan.issues) : [];
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const ready = current && !!article && !busy && !errors.length && !renderError;
  const canCopyBody = hasContent && !booting && !plan.issues.some(issue =>
    issue.severity === "error" && !["title-format", "markdown-limit", "asset-count"].includes(issue.id));
  const canExport = hasContent && !booting && !exporting;
  const simplifiedLists = useMemo(() => plan.issues.some(issue => issue.id === "nested-list")
    ? simplifyNestedLists(markdown) : markdown, [markdown, plan]);
  const updating =
    booting || (hasContent && !renderError && (busy || !current));
  const previewAssets = useMemo(() => {
    if (!prepared || prepared.files !== files || prepared.path !== documentPath)
      return [];
    // Reuse an image only while its actual inputs still match. Ordinal asset IDs
    // can point to different pictures after editing or importing a document.
    return prepared.article.assets.filter(({ spec }) => {
      const next = plan.assets.find((asset) => asset.source === spec.source);
      return (
        next?.kind === spec.kind &&
        next.code === spec.code &&
        JSON.stringify([next.headers, next.rows]) ===
          JSON.stringify([spec.headers, spec.rows])
      );
    });
  }, [prepared, files, documentPath, plan]);
  const preview = useMemo(
    () => safePreview(plan, previewAssets),
    [plan, previewAssets],
  );
  const assetErrors = Object.values(progress).filter(
    (asset) => asset.state === "error",
  );
  const missingImages = assetErrors.filter(
    (error) => error.reason === "missing-file",
  );
  const modeLabel = STANDALONE ? "HTML preview" : "Markdown to X Articles";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await loadDraft();
        if (cancelled) return;
        if (saved && typeof saved.markdown === "string") {
          setMarkdown(saved.markdown);
          setTitle(saved.title || "");
          setTableMode(saved.tableMode === "image" ? "image" : "native");
          setDocumentPath(saved.documentPath || "");
          setFiles(new Map(saved.files || []));
        } else {
          const sample = await createSampleImage();
          if (!cancelled) setFiles(new Map([["assets/workflow.png", sample]]));
        }
      } catch {
        if (!cancelled) {
          setSaving("Local saving unavailable");
          const sample = await createSampleImage();
          if (!cancelled) setFiles(new Map([["assets/workflow.png", sample]]));
        }
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    if (!STANDALONE)
      getBridgeStatus().then((status) => {
        if (!cancelled) setBridge(status.available);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Updating the document always updates the preview. There is no preparation step.
  useEffect(() => {
    if (booting) return;
    const controller = new AbortController();
    setBusy(hasContent);
    setProgress({});
    setRenderError("");
    const timer = setTimeout(async () => {
      if (!hasContent) return;
      try {
        const result = await prepareArticle(
          plan,
          files,
          documentPath,
          (next) => {
            if (!controller.signal.aborted)
              setProgress((old) => ({ ...old, [next.id]: next }));
          },
          controller.signal,
          assetCache.current,
        );
        if (controller.signal.aborted) {
          disposeAssets(result.assets);
          return;
        }
        if (activeAssets.current) disposeAssets(activeAssets.current.assets);
        activeAssets.current = result;
        setPrepared({ article: result, files, path: documentPath });
      } catch (error) {
        if (!controller.signal.aborted)
          setRenderError(
            error instanceof Error
              ? error.message
              : "Could not update the preview.",
          );
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [plan, files, documentPath, booting, hasContent, retry]);

  useEffect(() => {
    if (booting) return;
    setSaving("Saving…");
    const timer = setTimeout(() => {
      saveDraft({ markdown, title, tableMode, documentPath }, files)
        .then(() => setSaving("Saved locally"))
        .catch(() => setSaving("Not saved · download your Markdown"));
    }, 700);
    return () => clearTimeout(timer);
  }, [markdown, title, tableMode, files, documentPath, booting]);
  useEffect(() => {
    if (modal && !dialog.current?.open) dialog.current?.showModal();
    if (!modal && dialog.current?.open) dialog.current.close();
  }, [modal]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 7000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(""), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  useEffect(
    () => () => {
      if (activeAssets.current) disposeAssets(activeAssets.current.assets);
    },
    [],
  );

  function insert(before: string, after = "", placeholder = "") {
    const input = textarea.current;
    const start = input?.selectionStart ?? markdown.length;
    const end = input?.selectionEnd ?? start;
    const selected = markdown.slice(start, end) || placeholder;
    const text = before + selected + after;
    if (markdown.length - (end - start) + text.length > MAX_MARKDOWN_LENGTH) {
      setNotice("This document is at the 200,000-character limit.");
      return;
    }
    setMarkdown(markdown.slice(0, start) + text + markdown.slice(end));
    setMobileView("write");
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(
        start + before.length,
        start + before.length + selected.length,
      );
    });
  }

  async function importFiles(
    selected: FileList | File[] | null,
    insertImages = false,
    matchFolder = false,
  ) {
    if (!selected?.length) return;
    const sequence = ++importSequence.current;
    try {
      const incoming = [...selected];
      const docs = matchFolder
        ? []
        : incoming.filter((file) => /\.(md|markdown|mdown)$/i.test(file.name));
      const images = incoming.filter((file) =>
        /\.(png|jpe?g|webp)$/i.test(file.name),
      );
      let path = documentPath;
      let text: string | undefined;
      if (docs.length === 1) {
        if (docs[0].size > MAX_MARKDOWN_LENGTH * 4)
          throw new Error("This Markdown file is too large.");
        text = await docs[0].text();
        if (text.length > MAX_MARKDOWN_LENGTH)
          throw new Error("Markdown is limited to 200,000 characters.");
        path = normalizePath(docs[0].webkitRelativePath || docs[0].name);
      }
      if (sequence !== importSequence.current) return;
      const target = text === undefined ? plan : createPlan(text, tableMode, "", path);
      const sources = target.assets
        .filter((asset) => asset.kind === "image")
        .map((asset) => asset.source);
      const incomingImages = new Map(
        images.map((file) => [
          normalizePath(file.webkitRelativePath || file.name),
          file,
        ]),
      );
      if (incomingImages.size !== images.length)
        throw new Error(
          "Several selected files have the same filename. Select their parent folder to preserve paths, or choose each image with Replace.",
        );
      const matches = new Map<string, File>();
      let ambiguous = 0;
      for (const source of sources) {
        try {
          const file = resolveLocalFile(source, incomingImages, path, sources);
          if (file) matches.set(source, file);
        } catch {
          ambiguous++;
        }
      }
      if (insertImages && ambiguous)
        throw new Error(
          "These filenames match more than one image path. Select their parent folder or choose each image with Replace.",
        );
      if (matchFolder && !matches.size) {
        setNotice(
          ambiguous
            ? "Several files use the same name. Choose a more specific folder or use Choose file for each image."
            : "No referenced images found in this folder. Select the article’s image folder or its parent.",
        );
        return;
      }
      // Explicit Markdown import always starts a fresh attachment scope, even
      // when its text/name is identical to the current document. Browser reload
      // restores a saved draft; importing a file must not restore its overrides.
      const merged: LocalAssetMap =
        text === undefined ? new Map(files) : new Map();
      const matchedFiles = new Set(matches.values());
      for (const [key, file] of incomingImages)
        if (!matchFolder || matchedFiles.has(file)) merged.set(key, file);
      // Selecting an image folder also repairs an earlier incorrect replacement.
      for (const [source, file] of matches) merged.set(source, file);
      if (
        [...new Set(merged.values())].reduce(
          (sum, file) => sum + file.size,
          0,
        ) > MAX_TOTAL_BYTES
      )
        throw new Error(
          "Images exceed 20 MiB. Choose fewer files or resize them.",
        );
      if (images.length) {
        setFiles(merged);
        setImageUndo((old) => {
          const next = new Map(old);
          for (const source of matches.keys()) next.delete(source);
          return next;
        });
      }
      if (matchFolder) {
        setNotice(
          `Matched ${matches.size} of ${sources.length} article images. ` +
            (ambiguous
              ? "Some filenames are ambiguous; use Choose file for those images."
              : "Your Markdown is unchanged."),
        );
        return;
      }
      if (text !== undefined) {
        clearPreparedArticle();
        setFiles(merged);
        setImageUndo(new Map());
        setCopied("");
        setManualCopy(null);
        setMarkdown(text);
        setTitle("");
        setDocumentPath(path);
        setMobileView("write");
        setModal(null);
        setNotice(
          "Opened " +
            docs[0].name +
            ". " +
            (sources.length > matches.size
              ? "Select the image folder for this import. Previous image choices were cleared."
              : "The preview updates automatically."),
        );
      } else if (insertImages) {
        const newImages = images.filter(
          (file) =>
            !plan.assets.some((asset) => {
              try {
                return (
                  resolveLocalFile(asset.source, merged, path, sources) === file
                );
              } catch {
                return false;
              }
            }),
        );
        if (newImages.length)
          insert(
            "\n\n" +
              newImages
                .map(
                  (file) =>
                    "![" +
                    file.name.replace(/[\[\]\\]/g, "") +
                    "](<" +
                    encodeURI(
                      normalizePath(file.webkitRelativePath || file.name),
                    ) +
                    ">)",
                )
                .join("\n\n") +
              "\n",
          );
        setNotice(
          images.length +
            " image" +
            (images.length === 1 ? "" : "s") +
            " added. Preview updating…",
        );
      } else {
        setNotice(
          docs.length > 1
            ? "Images added. Import one Markdown file to choose the article."
            : images.length
              ? "Images added. Preview updating…"
              : "Choose a Markdown file or PNG, JPEG, or WebP images.",
        );
      }
    } catch (error) {
      if (sequence !== importSequence.current) return;
      setNotice(
        error instanceof Error ? error.message : "Could not open these files.",
      );
    }
  }

  function clearPreparedArticle() {
    assetCache.current.clear();
    setHighlightedLine(undefined);
    if (activeAssets.current) disposeAssets(activeAssets.current.assets);
    activeAssets.current = undefined;
    setPrepared(undefined);
    setProgress({});
    setRenderError("");
  }

  function replaceImage(source: string, file: File) {
    setImageUndo((old) => new Map(old).set(source, files.get(source)));
    setFiles(new Map(files).set(source, file));
    setNotice(
      "Image changed. Use Undo change beside the image to restore the previous choice.",
    );
  }

  function showAsset(id: string) {
    setModal("images");
    requestAnimationFrame(() => document.getElementById("asset-" + id)?.scrollIntoView({ block: "nearest" }));
  }

  function undoImage(source: string) {
    if (!imageUndo.has(source)) return;
    const previous = imageUndo.get(source);
    const next = new Map(files);
    if (previous) next.set(source, previous);
    else next.delete(source);
    setFiles(next);
    setImageUndo((old) => {
      const history = new Map(old);
      history.delete(source);
      return history;
    });
    setNotice("Previous image choice restored.");
  }

  function saveMarkdown() {
    downloadBlob(
      new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
      safeFileStem(plan.title) + ".md",
    );
  }
  async function exportZip() {
    if (!canExport) return;
    setExporting(true);
    try {
      const complete = ready && article;
      downloadBlob(
        complete ? await exportArticle(article) : await exportDraftBackup(
          { markdown, title, tableMode, documentPath }, files, issues),
        safeFileStem(plan.title) + (complete ? ".zip" : "-source-backup.zip"),
      );
      setNotice(complete ? "Downloaded Markdown and all prepared images." : "Source backup downloaded with selected local files. Unresolved images and formatting still need attention before creating a draft.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }
  async function copyTitle() {
    try {
      await navigator.clipboard.writeText(plan.title);
      setCopied("title");
      setNotice("Title copied. Paste it into the title field in X.");
    } catch {
      setManualCopy({ kind: "title", text: plan.title });
      setModal("copy");
    }
  }
  async function copyBody() {
    if (!canCopyBody) return;
    setCopied("");
    setNotice("");
    const body = createArticleClipboard({ plan, assets: previewAssets, previewHtml: preview });
    try {
      await copyArticleBody(body);
      setCopied("body");
      setNotice(
        plan.assets.length
          ? "Formatted body copied. Paste into X Articles, then add the images from the Images panel."
          : "Formatted body copied. Paste it into the X Articles body field.",
      );
    } catch {
      setManualCopy({ kind: "body", ...body });
      setModal("copy");
    }
  }
  async function handoff() {
    if (!article || !ready) return;
    if (STANDALONE) {
      setModal("connect");
      return;
    }
    setSending(true);
    try {
      const status = await getBridgeStatus();
      setBridge(status.available);
      if (!status.available) {
        setModal("connect");
        return;
      }
      await sendDraft(article.bundle);
      setNotice(
        "Review opened in the companion. Confirm there to upload images and create your draft.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not open the companion.",
      );
    } finally {
      setSending(false);
    }
  }
  function jump(line: number) {
    setHighlightedLine(undefined);
    setMobileView("write");
    setModal(null);
    requestAnimationFrame(() => {
      setHighlightedLine(line);
      const start =
        markdown
          .split("\n")
          .slice(0, line - 1)
          .join("\n").length + (line > 1 ? 1 : 0);
      textarea.current?.focus();
      textarea.current?.setSelectionRange(
        start,
        start + (markdown.split("\n")[line - 1]?.length || 0),
      );
    });
  }
  async function replaceDocument(example: boolean) {
    const sequence = ++importSequence.current;
    const nextFiles: LocalAssetMap = example
      ? new Map([["assets/workflow.png", await createSampleImage()]])
      : new Map();
    if (sequence !== importSequence.current) return;
    clearPreparedArticle();
    setModal(null);
    setNotice("");
    setCopied("");
    setImageUndo(new Map());
    setTitle("");
    setTableMode("native");
    setDocumentPath("");
    setMobileView("write");
    setMarkdown(example ? SAMPLE : "");
    setFiles(nextFiles);
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="#" aria-label="Article Studio">
          <img className="brand-icon" src={logoUrl} alt="" width="32" height="32" />
          Article Studio
        </a>
        <span className="app-description">{modeLabel}</span>
        <div className="header-links">
          <button onClick={() => setModal("formats")}>Format support</button>
          <button onClick={() => setModal("help")}>
            <HelpCircle size={15} /> How to use
          </button>
        </div>
      </header>

      <div className="action-bar">
        <div className="file-actions">
          <button onClick={() => setModal("new")} disabled={booting}>
            <Plus size={15} /> New
          </button>
          <button
            onClick={() => markdownInput.current?.click()}
            disabled={booting}
          >
            <UploadIcon /> Import Markdown
          </button>
          <button
            onClick={() => setModal("images")}
            className={assetErrors.length ? "needs-attention" : ""}
          >
            <ImageIcon size={15} /> Images{" "}
            <span className="count">{plan.assets.length}</span>
            {assetErrors.length > 0 && <span className="attention-dot" />}
          </button>
          <button onClick={() => setModal("example")} disabled={booting}>
            Example
          </button>
        </div>
        <div className="output-actions">
          <button onClick={copyTitle} disabled={!plan.title || booting}>
            <Copy size={14} />
            {copied === "title" ? "Copied!" : "Copy title"}
          </button>
          <button
            onClick={copyBody}
            disabled={!canCopyBody}
            className="button-primary"
            title={canCopyBody ? "Copy formatted text; images become placement markers" : "Resolve the content issues shown in the preview before copying"}
          >
            <Copy size={14} />
            {copied === "body" ? "Copied!" : "Copy body"}
          </button>
          <button
            onClick={handoff}
            disabled={!ready || sending}
            className="button-outline"
            title={errors.length ? "Resolve the issues shown below the article title" : updating ? "Preparing the article…" : !hasContent ? "Add article content first" : "Open companion review to create a draft"}
          >
            {sending ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <span className="x-symbol" aria-hidden="true">
                𝕏
              </span>
            )}{" "}
            Create X draft <ArrowRight size={14} />
          </button>
          {(errors.length > 0 || renderError) && <button className="draft-issues-link" onClick={() => {
            setMobileView("preview");
            requestAnimationFrame(() => document.getElementById("draft-issues")?.focus());
          }}>{errors.length ? `${errors.length} ${errors.length === 1 ? "item" : "items"} to fix` : "View preview error"}</button>}
        </div>
      </div>

      {STANDALONE && (
        <div className="workflow-strip">
          <span>
            <b>1</b> Paste or import Markdown
          </span>
          <ArrowRight size={12} />
          <span>
            <b>2</b> Preview updates automatically
          </span>
          <ArrowRight size={12} />
          <span>
            <b>3</b> Copy body or create an X draft
          </span>
        </div>
      )}
      <div className="mobile-tabs" role="tablist" aria-label="Editor view">
        <button
          role="tab"
          aria-selected={mobileView === "write"}
          onClick={() => setMobileView("write")}
        >
          Write
        </button>
        <button
          role="tab"
          aria-selected={mobileView === "preview"}
          onClick={() => setMobileView("preview")}
        >
          Preview {errors.length > 0 && "· " + errors.length + " issues"}
        </button>
      </div>

      <main className={"editor-workspace mobile-" + mobileView}>
        <section className="source-panel" aria-label="Markdown editor">
          <div className="panel-heading">
            <strong>
              <Code2 size={15} /> Markdown
            </strong>
            <span>{documentPath.split("/").pop() || "Untitled.md"}</span>
            <button
              onClick={saveMarkdown}
              title="Download your original Markdown"
              aria-label="Save Markdown"
            >
              <ArrowDownToLine size={15} />
            </button>
          </div>
          <div className="format-toolbar" aria-label="Markdown formatting">
            <button
              onClick={() => insert("## ", "", "Heading")}
              title="Insert heading"
              aria-label="Insert heading"
            >
              H₂
            </button>
            <button
              onClick={() => insert("**", "**", "bold text")}
              title="Bold (⌘/Ctrl+B)"
              aria-label="Bold"
            >
              <Bold size={15} />
            </button>
            <button
              onClick={() => insert("[", "](https://example.com)", "link text")}
              title="Insert link"
              aria-label="Insert link"
            >
              <Link size={15} />
            </button>
            <button
              onClick={() => insert("\n- ", "\n", "List item")}
              title="Insert list"
              aria-label="Insert list"
            >
              <List size={16} />
            </button>
            <span className="toolbar-divider" />
            <button
              onClick={() =>
                insert(
                  "\n\n| Column | Value |\n| --- | --- |\n| Item | Detail |\n\n",
                )
              }
            >
              <Table2 size={15} /> Table
            </button>
            <button
              onClick={() =>
                insert(
                  "\n\n" +
                    FENCE +
                    "mermaid\nflowchart LR\n  A[Start] --> B[Finish]\n" +
                    FENCE +
                    "\n\n",
                )
              }
            >
              <Network size={15} /> Diagram
            </button>
            <button onClick={() => imageInput.current?.click()}>
              <ImageIcon size={15} /> Image
            </button>
          </div>
          <MarkdownEditor
            inputRef={textarea}
            highlightedLine={highlightedLine}
            aria-label="Markdown source"
            value={markdown}
            disabled={booting}
            spellCheck={false}
            maxLength={MAX_MARKDOWN_LENGTH}
            placeholder={
              "Paste your Markdown here, or use Import Markdown above.\n\nA heading is optional. Edit the article title above the preview."
            }
            onChange={(event) => { setMarkdown(event.target.value); setHighlightedLine(undefined); }}
            onKeyDown={(event) => {
              if (
                (event.metaKey || event.ctrlKey) &&
                event.key.toLowerCase() === "b"
              ) {
                event.preventDefault();
                insert("**", "**", "bold text");
              }
            }}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes("Files"))
                event.preventDefault();
            }}
            onDrop={(event) => {
              if (event.dataTransfer.files.length) {
                event.preventDefault();
                void importFiles(event.dataTransfer.files, true);
              }
            }}
            onPaste={(event) => {
              if (event.clipboardData.files.length) {
                event.preventDefault();
                void importFiles(event.clipboardData.files, true);
              }
            }}
          />
          <div className="panel-footer">
            <span>
              {plan.wordCount.toLocaleString()} words ·{" "}
              {markdown.length.toLocaleString()} characters
            </span>
            <span className="save-status">{booting ? "Opening…" : saving}</span>
          </div>
        </section>

        <section className="preview-panel" aria-label="Article preview">
          <div className="panel-heading">
            <strong>
              <span
                className={
                  "status-dot " +
                  (updating
                    ? "working"
                    : errors.length || renderError
                      ? "error"
                      : ready
                        ? "ready"
                        : "")
                }
              />{" "}
              Live preview
            </strong>
            <div className="preview-controls">
              {plan.counts.tables > 0 && (
                <label>
                  Tables{" "}
                  <select
                    aria-label="Table format"
                    value={tableMode}
                    onChange={(event) =>
                      setTableMode(event.target.value as TableMode)
                    }
                  >
                    <option value="native">Native</option>
                    <option value="image">PNG images</option>
                  </select>
                </label>
              )}
              <button
                aria-label="Desktop preview"
                aria-pressed={!phone}
                onClick={() => setPhone(false)}
              >
                <Monitor size={15} />
              </button>
              <button
                aria-label="Phone preview"
                aria-pressed={phone}
                onClick={() => setPhone(true)}
              >
                <Smartphone size={15} />
              </button>
            </div>
          </div>
          <div className="article-title-field">
            <label htmlFor="article-title">Article title</label>
            <input id="article-title" ref={titleInput} value={title || plan.title}
              disabled={booting} maxLength={2_000}
              onChange={event => setTitle(event.target.value)}
              aria-describedby="title-hint" />
            <div id="title-hint">
              <span>{title ? "Custom title" : "Detected from your article or filename; edit here."}</span>
              {title && <button onClick={() => setTitle("")}>Use automatic title</button>}
            </div>
          </div>
          {(errors.length > 0 || renderError) && (
            <div className="preview-alert" id="draft-issues" tabIndex={-1} role="status">
              <CircleAlert size={16} />
              <div>
                <strong>{errors.length ? `${errors.length} ${errors.length === 1 ? "item" : "items"} to resolve before creating a draft` : "Preview could not update"}</strong>
                <div className="blocking-issues">
                  {errors.map((issue, index) => {
                    const asset = issue.id.startsWith("prepare-")
                      ? plan.assets.find(item => `prepare-${item.id}` === issue.id) : undefined;
                    return <div className="blocking-issue" key={`${issue.id}-${index}`}>
                      <p>{asset ? `${asset.label}: ` : ""}{issue.message}</p>
                      <div className="issue-actions">
                        {issue.id === "title-format" ? <button onClick={() => titleInput.current?.focus()}>Edit title</button>
                          : <button onClick={() => jump(issue.line)}>Line {issue.line} · {asset && asset.kind !== "image" ? "Edit source" : "Go to line"}</button>}
                        {asset?.kind === "image" && <button onClick={() => showAsset(asset.id)}>Add / fix images</button>}
                        {issue.id === "nested-list" && simplifiedLists !== markdown &&
                          <button onClick={() => {
                            setMarkdown(simplifiedLists);
                            setNotice("Converted simple nested lists to one level. Review the updated preview.");
                          }}>Convert to one level</button>}
                      </div>
                    </div>;
                  })}
                  {renderError && <p>{renderError}</p>}
                </div>
                <div className="issue-actions">
                  {missingImages.length > 0 && <button onClick={() => folderInput.current?.click()}><FolderOpen size={14} /> Match image folder</button>}
                  {(assetErrors.some(error => error.reason !== "missing-file") || renderError) && <button onClick={() => { assetCache.current.clear(); setRetry(value => value + 1); }}>Retry</button>}
                </div>
              </div>
            </div>
          )}
          <div className={"preview-scroll " + (phone ? "phone-view" : "")}>
            {!hasContent ? (
              <div className="preview-empty">
                <FileText size={28} />
                <h2>Your article appears here</h2>
                <p>
                  Paste Markdown in the editor. Images, tables, and diagrams
                  appear automatically.
                </p>
                <button onClick={() => setModal("example")}>
                  Try the example <ArrowRight size={14} />
                </button>
              </div>
            ) : (
              <article className="preview-paper">
                <ArticlePreview
                  html={preview}
                  assets={plan.assets}
                  canUndo={(source) => imageUndo.has(source)}
                  onReplace={replaceImage}
                  onUndo={undoImage}
                  onFix={(asset) => showAsset(asset.id)}
                />
              </article>
            )}
          </div>
          {warnings.length > 0 && (
            <details className="format-notes">
              <summary>
                {warnings.length} formatting note
                {warnings.length === 1 ? "" : "s"}
              </summary>
              {warnings.map((issue, index) => (
                <button key={index} onClick={() => jump(issue.line)}>
                  {issue.message} <span>Line {issue.line}</span>
                </button>
              ))}
            </details>
          )}
          <div className="panel-footer">
            <span className="preview-state" role="status">
              {updating ? (
                <>
                  <LoaderCircle size={13} className="spin" /> Updating preview…
                </>
              ) : !hasContent ? (
                "Paste Markdown to start"
              ) : errors.length || renderError ? (
                "Resolve the highlighted items"
              ) : (
                <>
                  <Check size={13} /> Preview up to date
                </>
              )}
            </span>
            <span>Final appearance is controlled by X</span>
          </div>
        </section>
      </main>

      <footer className="app-footer">
        <span>
          {STANDALONE
            ? "Works offline · X connection needs the full app"
            : "Saved on this device · X draft reviewed before creation"}
        </span>
        {!STANDALONE && (
          <a href="/privacy" target="_blank" rel="noopener noreferrer">
            Privacy
          </a>
        )}
        <button onClick={exportZip} disabled={!canExport} title={ready ? "Download the prepared article" : "Download source Markdown and selected files, including unresolved items"}>
          <ArrowDownToLine size={13} />
          {exporting ? "Exporting…" : "Export ZIP"}
        </button>
      </footer>
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          <span>{notice}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}

      <input
        ref={markdownInput}
        type="file"
        accept=".md,.markdown,.mdown,text/markdown"
        aria-label="Import Markdown file"
        hidden
        onChange={(event) => {
          void importFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={folderInput}
        type="file"
        {...{ webkitdirectory: "", directory: "" }}
        multiple
        aria-label="Choose image folder"
        hidden
        onChange={(event) => {
          void importFiles(event.target.files, false, true);
          event.target.value = "";
        }}
      />
      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        aria-label="Add image files"
        hidden
        onChange={(event) => {
          void importFiles(event.target.files, true);
          event.target.value = "";
        }}
      />

      <dialog
        ref={dialog}
        className={
          modal === "images"
            ? "drawer-dialog"
            : modal === "formats"
              ? "wide-dialog"
              : ""
        }
        aria-label={
          modal === "images" ? "Images and diagrams" : "Article Studio dialog"
        }
        onCancel={() => setModal(null)}
        onClose={() => setModal(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setModal(null);
        }}
      >
        <div className="dialog-inner">
          <button
            className="dialog-close"
            aria-label="Close dialog"
            onClick={() => setModal(null)}
          >
            <X size={20} />
          </button>
          {modal === "images" && (
            <>
              <h2>Images & diagrams</h2>
              <p className="dialog-lead">
                Add your images here. Tables and Mermaid diagrams are generated
                automatically.
              </p>
              {plan.counts.images > 0 && (
                <div className="folder-guidance">
                  <strong>
                    Importing from Obsidian or another local editor?
                  </strong>
                  <p>
                    The .md file contains image paths. Your browser needs you to
                    select the image folder separately. Choose that folder or a
                    parent folder; only images referenced by this article are
                    attached.
                  </p>
                  <span>
                    Example path:{" "}
                    <code>
                      {
                        plan.assets.find((asset) => asset.kind === "image")
                          ?.source
                      }
                    </code>
                  </span>
                </div>
              )}
              <div
                className="image-dropzone"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void importFiles(event.dataTransfer.files, true);
                }}
              >
                <ImageIcon size={25} />
                <strong>Drop images here</strong>
                <span>PNG, JPEG, WebP · up to 5 MiB each</span>
                <div>
                  <button
                    className="button-primary"
                    onClick={() => imageInput.current?.click()}
                  >
                    Add images
                  </button>
                  <button
                    className="button-outline"
                    onClick={() => folderInput.current?.click()}
                  >
                    <FolderOpen size={15} /> Match image folder
                  </button>
                </div>
              </div>
              {plan.assets.map((asset) => {
                const done = previewAssets.find(
                  (item) => item.spec.source === asset.source,
                );
                const state = progress[asset.id];
                const valid = current && !!done;
                return (
                  <div
                    className={
                      "asset-card " +
                      (state?.state === "error" ? "has-error" : "")
                    }
                    key={asset.id}
                    id={"asset-" + asset.id}
                  >
                    <div className="asset-top">
                      <div className="asset-thumbnail">
                        {done ? (
                          <img src={done.url} alt={asset.label} />
                        ) : asset.kind === "mermaid" ? (
                          <Network size={24} />
                        ) : asset.kind === "table" ? (
                          <Table2 size={24} />
                        ) : (
                          <ImageIcon size={24} />
                        )}
                      </div>
                      <div className="asset-details">
                        <strong>{asset.label}</strong>
                        <span className="asset-path">
                          {asset.kind === "image"
                            ? asset.source
                            : asset.kind === "mermaid"
                              ? "Mermaid → PNG"
                              : "Table → PNG"}
                        </span>
                        <span className={"asset-state " + (state?.state || "")}>
                          {state?.state === "error"
                            ? state.message
                            : valid
                              ? done.width + " × " + done.height + " · ready"
                              : "Rendering…"}
                        </span>
                      </div>
                    </div>
                    <div className="asset-actions">
                      {asset.kind === "image" && (
                        <label className="file-button">
                          {state?.state === "error"
                            ? "Choose file"
                            : "Replace image"}
                          <input
                            aria-label={"Replace " + asset.label}
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            hidden
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) replaceImage(asset.source, file);
                              event.target.value = "";
                            }}
                          />
                        </label>
                      )}
                      {imageUndo.has(asset.source) && (
                        <button
                          aria-label={"Undo change to " + asset.label}
                          onClick={() => undoImage(asset.source)}
                        >
                          <Undo2 size={13} /> Undo change
                        </button>
                      )}
                      {asset.kind !== "image" && state?.state === "error" && (
                        <button onClick={() => jump(asset.line)}>
                          Edit source · line {asset.line}
                        </button>
                      )}
                      {valid && (
                        <>
                          <button
                            aria-label={"Copy " + asset.label}
                            onClick={async () => {
                              try {
                                await copyImage(done.blob);
                                setNotice("Image copied. Paste it into X.");
                              } catch {
                                setNotice(
                                  "Image copying is unavailable. Use Download instead.",
                                );
                              }
                            }}
                          >
                            <Copy size={13} /> Copy image
                          </button>
                          <button
                            aria-label={"Download " + asset.label}
                            onClick={() =>
                              downloadBlob(done.blob, done.fileName)
                            }
                          >
                            <ArrowDownToLine size={13} /> Download
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
              {!plan.assets.length && (
                <p className="empty-assets">
                  No images yet. Use Add images, or insert a Mermaid diagram
                  from the editor toolbar.
                </p>
              )}
              {plan.counts.tables > 0 && tableMode === "native" && (
                <p className="inline-note">
                  {plan.counts.tables} native table
                  {plan.counts.tables === 1 ? "" : "s"} kept in the article.
                  Choose “PNG images” above the preview if you want downloadable
                  table images.
                </p>
              )}
              <div className="dialog-actions">
                <button
                  className="button-primary"
                  onClick={exportZip}
                  disabled={!canExport}
                >
                  <ArrowDownToLine size={15} /> Download all (.zip)
                </button>
                <button
                  onClick={() => { assetCache.current.clear(); setRetry((value) => value + 1); }}
                  disabled={busy}
                >
                  Retry rendering
                </button>
              </div>
            </>
          )}
          {modal === "connect" && (
            <>
              <h2>Create a draft with all your images</h2>
              <p className="dialog-lead">
                The companion uploads your images and inserts them in the right
                places. You review the draft before publishing.
              </p>
              {STANDALONE ? (
                <>
                  <div className="inline-note">
                    You’re using the standalone HTML preview. Automatic X draft
                    creation runs from the full app.
                  </div>
                  <a
                    className="button-primary block-link"
                    href="https://md2xarticle.com/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open full app <ArrowRight size={15} />
                  </a>
                  <p>
                    Open md2xarticle.com and import your Markdown and images
                    there. You can still use Copy body, copy individual images,
                    and Export ZIP from this file.
                  </p>
                </>
              ) : (
                <>
                  <ol className="setup-steps">
                    <li>
                      <strong>Install the Chrome companion once</strong>
                      <p>
                        Add it from the Chrome Web Store, then refresh this
                        page. The editor and copying also work without it.
                      </p>
                      <a
                        className="button-primary"
                        href="https://chromewebstore.google.com/detail/ojpjldmiiibgjnbjfiacaoenfgpdhbbh"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Install Chrome companion <ArrowRight size={15} />
                      </a>
                      <details className="help-details">
                        <summary>Install a development build</summary>
                        <p>
                          Download and unzip the companion. Open chrome://extensions,
                          enable Developer mode, choose Load unpacked and select the folder.
                        </p>
                        <a href="/article-studio-bridge.zip" download>
                          Download companion
                        </a>
                      </details>
                    </li>
                    <li>
                      <strong>Click Create X draft</strong>
                      <p>
                        Review the title and images in the companion, then
                        confirm creation there. The companion opens X Articles
                        automatically and continues with your signed-in X session.
                        Your account needs Articles access.
                      </p>
                    </li>
                  </ol>
                  <p className="muted-note">
                    If an older companion asks you to open X first, update it or{" "}
                    <a href="https://x.com/compose/articles" target="_blank" rel="noreferrer">
                      open X Articles
                    </a>{" "}
                    once, then retry.
                  </p>
                  <button
                    className="button-outline"
                    onClick={async () => {
                      const status = await getBridgeStatus();
                      setBridge(status.available);
                      setNotice(
                        status.available
                          ? "Companion connected. You can now create your draft."
                          : "Companion not found. Install it and refresh this page.",
                      );
                      if (status.available) setModal(null);
                    }}
                  >
                    {bridge ? <Check size={15} /> : <Plus size={15} />} Check
                    connection
                  </button>
                </>
              )}
              <p className="muted-note">
                Draft creation has been confirmed in a real X account. X
                controls final rendering and may change its editor, so review
                each draft there. The companion creates drafts; it does not
                publish.
              </p>
            </>
          )}
          {modal === "help" && (
            <>
              <h2>From Markdown to X</h2>
              <ol className="setup-steps">
                <li>
                  <strong>Paste or import your Markdown</strong>
                  <p>
                    Write in the left panel, import a .md file, or drop one into
                    the editor. A heading is optional; edit the title above the preview.
                  </p>
                </li>
                <li>
                  <strong>Check the live preview</strong>
                  <p>
                    Tables and Mermaid render automatically. Use Images to add
                    missing files. You can also drop or paste images into the
                    editor.
                  </p>
                </li>
                <li>
                  <strong>Choose how to move it into X</strong>
                  <p>
                    <b>Create X draft</b> uploads and places images through the
                    Chrome companion. <b>Copy title / Copy body</b> is the
                    manual option: the body is copied as formatted rich text.
                    Use regular Paste in the X Articles body field to keep
                    headings, emphasis, lists, and links. Add images from the
                    Images panel. Tables may need PNG when pasting.
                  </p>
                </li>
              </ol>
              <p className="inline-note">
                Nothing is sent to X while you write. Your draft is saved in
                this browser. Export ZIP includes Markdown and prepared images.
                If preparation is incomplete, it saves the original source and selected local files instead.
              </p>
              <details className="help-details">
                <summary>Testing and current limitations</summary>
                <p>
                  Core conversion and browser workflows have been tested, and
                  draft creation has been confirmed in a real X account. Final X
                  rendering of every format, every Markdown/Mermaid combination,
                  and other browser families remain unverified.
                </p>
                <p>
                  Remote images need CORS permission or a local replacement.
                  Covers, ALT descriptions, formulas, GIF, SVG, and video are
                  not implemented.
                </p>
                <button
                  className="text-link"
                  onClick={() => setModal("formats")}
                >
                  See full format support <ArrowRight size={13} />
                </button>
              </details>
            </>
          )}
          {modal === "formats" && (
            <>
              <h2>Format support</h2>
              <p className="dialog-lead">
                These are this importer’s mappings. Final rendering and account
                access depend on X.
              </p>
              <div className="format-table-wrap">
                <table className="format-table">
                  <thead>
                    <tr>
                      <th>Markdown</th>
                      <th>Support</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FORMATS.map((format) => (
                      <tr key={format.syntax}>
                        <th>{format.syntax}</th>
                        <td>{format.status}</td>
                        <td>
                          <strong>{format.result}</strong>
                          <p>{format.note}</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {(modal === "new" || modal === "example") && (
            <>
              <h2>
                {modal === "new" ? "Start a new article?" : "Load the example?"}
              </h2>
              <p className="dialog-lead">
                This replaces the article and images saved in this browser.
                Download your Markdown first if you want to keep it.
              </p>
              <div className="dialog-actions">
                <button onClick={saveMarkdown}>
                  <ArrowDownToLine size={15} /> Save Markdown
                </button>
                <button
                  className="button-primary"
                  onClick={() => replaceDocument(modal === "example")}
                >
                  {modal === "new" ? "Start new article" : "Load example"}
                </button>
              </div>
            </>
          )}
          {modal === "copy" && manualCopy && (
            <>
              <h2>{manualCopy.kind === "body" ? "Copy formatted body" : "Copy title"}</h2>
              <p className="dialog-lead">
                {manualCopy.kind === "body"
                  ? "Automatic copying was blocked. Select the formatted body below and press ⌘C on Mac or Ctrl+C on Windows. Then paste normally into the X Articles body field."
                  : "Automatic copying was blocked. Select the title below and copy it into the X Articles title field."}
              </p>
              {manualCopy.kind === "body" ? (
                <>
                  <button
                    className="button-primary"
                    onClick={() => manualBody.current && selectFormattedBody(manualBody.current)}
                  >
                    <Copy size={15} /> Select formatted body
                  </button>
                  <div
                    ref={manualBody}
                    className="manual-copy-rich rendered-article"
                    role="textbox"
                    aria-label="Formatted body to copy"
                    aria-readonly="true"
                    tabIndex={0}
                    onCopy={(event) => {
                      setArticleClipboard(event.clipboardData, manualCopy);
                      event.preventDefault();
                    }}
                    dangerouslySetInnerHTML={{ __html: manualCopy.html }}
                  />
                </>
              ) : (
                <textarea
                  className="manual-copy"
                  aria-label="Text to copy"
                  value={manualCopy.text}
                  readOnly
                  onFocus={(event) => event.target.select()}
                />
              )}
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}

function UploadIcon() {
  return <FolderOpen size={15} />;
}
