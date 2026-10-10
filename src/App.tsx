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
  RefreshCw,
  Smartphone,
  Table2,
  Undo2,
  X,
} from "lucide-react";
import { createPlan, MAX_MARKDOWN_LENGTH, safeFileStem, shellPipeLines } from "./plan";
import {
  prepareArticle,
  safePreview,
  disposeArticle,
  exportArticle,
  type AssetCache,
} from "./prepare";
import { exportDraftBackup } from "./backup";
import { convertFootnotesToEndnotes, simplifyNestedLists } from "./normalize";
import { MarkdownEditor } from "./MarkdownEditor";
import {
  COVER_KEY,
  downloadBlob,
  MAX_SOURCE_BYTES,
  normalizePath,
  resolveLocalFile,
} from "./files";
import {
  dropHandles,
  ensurePermission,
  hasPermission,
  IMAGE_FILE,
  MARKDOWN_FILE,
  pickFiles,
  pickFolder,
  readFolderImages,
  supportsFileSystemAccess,
  type DirectoryHandle,
  type FileHandle,
  type RememberedHandles,
} from "./filesystem";
import { loadSettings, saveSettings, type Settings } from "./settings";
import {
  getBridgeStatus,
  getDraftJob,
  sendDraft,
  type BridgeJob,
} from "./bridge";
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
/** A job staged from this page, tracked until the companion reports its outcome. */
type DraftJob = BridgeJob & { auto: boolean };
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
  // Opened through the File System Access API; lets Reload from file skip the picker.
  const [handles, setHandles] = useState<RememberedHandles>({});
  const [fileChanged, setFileChanged] = useState(false);
  const loadedModified = useRef(0);
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
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
  const [autoCreate, setAutoCreate] = useState(false);
  const [draftJob, setDraftJob] = useState<DraftJob | null>(null);
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
  const coverInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const activeAssets = useRef<PreparedArticle | undefined>(undefined);
  const importSequence = useRef(0);
  const plan = useMemo(
    () => createPlan(markdown, tableMode, title, documentPath, settings),
    [markdown, tableMode, title, documentPath, settings],
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
  const endnotes = useMemo(() => plan.issues.some(issue => issue.id === "footnote")
    ? convertFootnotesToEndnotes(markdown) : markdown, [markdown, plan]);
  const fileSystemAccess = supportsFileSystemAccess();
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
  // A cover chosen here takes precedence over the frontmatter path.
  const coverSource = files.has(COVER_KEY) ? COVER_KEY : plan.cover?.source;
  const coverAsset =
    prepared?.files === files &&
    prepared.path === documentPath &&
    prepared.article.cover?.spec.source === coverSource
      ? prepared.article.cover
      : undefined;
  const coverProblem =
    progress.cover?.state === "error" ? progress.cover.message : undefined;
  const coverState = !coverSource
    ? "none"
    : coverProblem
      ? "error"
      : coverAsset && current
        ? "ready"
        : "preparing";
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
          if (saved.handles && typeof saved.handles === "object") setHandles(saved.handles);
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
        if (cancelled) return;
        setBridge(status.available);
        setAutoCreate(status.autoCreate === true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Follow a staged job until the companion reports a draft or the job is discarded.
  // A failed or uncertain job can still change after the user acts in the review.
  const trackedJobId = draftJob?.jobId;
  const tracking =
    !!draftJob && !["completed", "missing"].includes(draftJob.status);
  useEffect(() => {
    if (!trackedJobId || !tracking) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const next = await getDraftJob(trackedJobId);
        if (cancelled) return;
        setDraftJob((old) =>
          old?.jobId === trackedJobId ? { ...next, auto: old.auto } : old,
        );
      } catch {
        // The companion may be reloading; the next tick tries again.
      }
    }, 1_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [trackedJobId, tracking]);

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
          disposeArticle(result);
          return;
        }
        if (activeAssets.current) disposeArticle(activeAssets.current);
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
      saveDraft({ markdown, title, tableMode, documentPath }, files, handles)
        .then(() => setSaving("Saved locally"))
        .catch(() => setSaving("Not saved · download your Markdown"));
    }, 700);
    return () => clearTimeout(timer);
  }, [markdown, title, tableMode, files, documentPath, handles, booting]);
  useEffect(() => saveSettings(settings), [settings]);
  // While the file is readable without a prompt, notice edits made in another editor.
  const documentHandle = handles.document;
  useEffect(() => {
    if (!documentHandle) { setFileChanged(false); return; }
    let cancelled = false;
    const check = async () => {
      if (document.hidden || !(await hasPermission(documentHandle))) return;
      try {
        const file = await documentHandle.getFile();
        if (!cancelled && loadedModified.current) setFileChanged(file.lastModified > loadedModified.current);
      } catch { /* moved or deleted: Reload reports it */ }
    };
    void check();
    const timer = setInterval(check, 4_000);
    document.addEventListener("visibilitychange", check);
    return () => { cancelled = true; clearInterval(timer); document.removeEventListener("visibilitychange", check); };
  }, [documentHandle]);
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
      if (activeAssets.current) disposeArticle(activeAssets.current);
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
    picked: RememberedHandles = {},
  ) {
    if (!selected?.length) return;
    const sequence = ++importSequence.current;
    try {
      const incoming = [...selected];
      const docs = matchFolder
        ? []
        : incoming.filter((file) => MARKDOWN_FILE.test(file.name));
      const images = incoming.filter((file) => IMAGE_FILE.test(file.name));
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
      const target = text === undefined ? plan : createPlan(text, tableMode, "", path, settings);
      // A remembered image folder that is still readable supplies this article's images too.
      const folder = picked.folder ?? (text !== undefined ? handles.folder : undefined);
      let fromFolder = matchFolder;
      if (text !== undefined && !images.length && folder && (await hasPermission(folder))) {
        for (const [key, file] of await readFolderImages(folder)) images.push(Object.assign(file, { folderPath: key }));
        fromFolder = images.length > 0;
      }
      if (sequence !== importSequence.current) return;
      const sources = target.assets
        .filter((asset) => asset.kind === "image")
        .map((asset) => asset.source);
      // A local frontmatter cover is matched like a body image.
      const wanted =
        target.cover && !/^https?:\/\//i.test(target.cover.source)
          ? [...sources, target.cover.source]
          : sources;
      const incomingImages = new Map(
        images.map((file) => [
          normalizePath((file as File & { folderPath?: string }).folderPath || file.webkitRelativePath || file.name),
          file,
        ]),
      );
      if (incomingImages.size !== images.length)
        throw new Error(
          "Several selected files have the same filename. Select their parent folder to preserve paths, or choose each image with Replace.",
        );
      const matches = new Map<string, File>();
      let ambiguous = 0;
      for (const source of wanted) {
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
        if (!fromFolder || matchedFiles.has(file)) merged.set(key, file);
      // Selecting an image folder also repairs an earlier incorrect replacement.
      for (const [source, file] of matches) merged.set(source, file);
      // Oversized pictures are downscaled during preparation; only refuse absurd selections.
      if (
        [...new Set(merged.values())].reduce(
          (sum, file) => sum + file.size,
          0,
        ) > MAX_SOURCE_BYTES * 4
      )
        throw new Error(
          "Selected images total more than 160 MiB. Choose fewer files or resize them.",
        );
      if (images.length) {
        setFiles(merged);
        setImageUndo((old) => {
          const next = new Map(old);
          for (const source of matches.keys()) next.delete(source);
          return next;
        });
      }
      if (picked.folder) setHandles((old) => ({ ...old, folder: picked.folder }));
      if (matchFolder) {
        setNotice(
          `Matched ${matches.size} of ${wanted.length} article images. ` +
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
        setHandles((old) => ({ ...old, document: picked.document }));
        loadedModified.current = picked.document ? docs[0].lastModified : 0;
        setFileChanged(false);
        setMobileView("write");
        setModal(null);
        setNotice(
          "Opened " +
            docs[0].name +
            ". " +
            (wanted.length > matches.size
              ? "Select the image folder for this import. Previous image choices were cleared."
              : fromFolder && !matchFolder && folder && matches.size
                ? `Images matched from the remembered folder “${folder.name}”.`
                : "The preview updates automatically."),
        );
      } else if (insertImages) {
        const coverFile = target.cover && matches.get(target.cover.source);
        const newImages = images.filter(
          (file) =>
            file !== coverFile &&
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

  /** Import Markdown: the native picker remembers the file where the browser allows it. */
  async function openFiles() {
    if (!fileSystemAccess) { markdownInput.current?.click(); return; }
    try {
      const result = await pickFiles();
      if (result) await importFiles(result.files, false, false, { document: result.document });
    } catch {
      markdownInput.current?.click();
    }
  }

  async function matchFolderFromDisk() {
    if (!fileSystemAccess) { folderInput.current?.click(); return; }
    try {
      const folder = await pickFolder();
      if (!folder) return;
      const images = [...(await readFolderImages(folder))].map(([key, file]) => Object.assign(file, { folderPath: key }));
      if (!images.length) { setNotice(`No PNG, JPEG, WebP or SVG files found in “${folder.name}”.`); return; }
      await importFiles(images, false, true, { folder });
    } catch {
      folderInput.current?.click();
    }
  }

  /** Re-read the opened .md and re-match the remembered folder; edits made here stay. */
  async function reloadFromFile() {
    const handle = handles.document;
    if (!handle) return;
    const sequence = ++importSequence.current;
    try {
      if (!(await ensurePermission(handle))) { setNotice("Allow file access to reload, or import the file again."); return; }
      const file = await handle.getFile();
      if (file.size > MAX_MARKDOWN_LENGTH * 4) throw new Error("This Markdown file is too large.");
      const text = await file.text();
      if (text.length > MAX_MARKDOWN_LENGTH) throw new Error("Markdown is limited to 200,000 characters.");
      const folder = handles.folder;
      const folderImages = folder && (await hasPermission(folder)) ? await readFolderImages(folder) : new Map<string, File>();
      if (sequence !== importSequence.current) return;
      const next = createPlan(text, tableMode, title, documentPath, settings);
      const sources = next.assets.filter((asset) => asset.kind === "image").map((asset) => asset.source);
      const wanted = next.cover && !/^https?:\/\//i.test(next.cover.source) ? [...sources, next.cover.source] : sources;
      const merged: LocalAssetMap = new Map(files);
      let matched = 0;
      for (const source of wanted) {
        if (files.has(source)) continue;
        try {
          const found = resolveLocalFile(source, folderImages, documentPath, sources);
          if (found) { merged.set(source, found); matched++; }
        } catch { /* ambiguous: the Images panel explains */ }
      }
      assetCache.current.clear();
      setHighlightedLine(undefined);
      setDraftJob(null);
      setMarkdown(text);
      if (matched) setFiles(merged);
      loadedModified.current = file.lastModified;
      setFileChanged(false);
      setNotice(`Reloaded ${file.name} from disk.` + (matched ? ` Matched ${matched} new image${matched === 1 ? "" : "s"}.` : ""));
    } catch (error) {
      if (sequence !== importSequence.current) return;
      setNotice(error instanceof Error ? error.message : "Could not reload the file. Import it again.");
    }
  }

  /** Dropped items: remember the Markdown handle; a dropped folder matches images. */
  async function dropped(transfer: DataTransfer) {
    const pending = fileSystemAccess ? dropHandles(transfer) : Promise.resolve([] as FileSystemHandle[]);
    const dropFiles = [...transfer.files];
    const found = await pending;
    const folder = found.find((handle) => handle.kind === "directory") as DirectoryHandle | undefined;
    if (folder) {
      const images = [...(await readFolderImages(folder))].map(([key, file]) => Object.assign(file, { folderPath: key }));
      await importFiles(images, false, true, { folder });
      return;
    }
    const document = found.find((handle) => handle.kind === "file" && MARKDOWN_FILE.test(handle.name)) as FileHandle | undefined;
    await importFiles(dropFiles, true, false, { document });
  }

  function clearPreparedArticle() {
    assetCache.current.clear();
    setHighlightedLine(undefined);
    setDraftJob(null);
    if (activeAssets.current) disposeArticle(activeAssets.current);
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

  function chooseCover(file: File | undefined) {
    const next = new Map(files);
    if (file) next.set(COVER_KEY, file);
    else next.delete(COVER_KEY);
    setFiles(next);
    setNotice(
      file
        ? "Cover selected. The companion sets it when it creates the draft."
        : plan.cover
          ? "Cover choice removed. The cover line in your Markdown applies again."
          : "Cover removed.",
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
      const nativeTables = tableMode === "native" && plan.counts.tables > 0;
      setNotice(
        (plan.assets.length
          ? "Formatted body copied. Paste into X Articles, then add the images from the Images panel."
          : "Formatted body copied. Paste it into the X Articles body field.") +
          (nativeTables
            ? " X cannot paste tables, so each row was copied as a list item; use Create X draft for native tables."
            : ""),
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
      setAutoCreate(status.autoCreate === true);
      if (!status.available) {
        setModal("connect");
        return;
      }
      const result = await sendDraft(article.bundle);
      const auto = result.autoCreate === true;
      // Companion 0.1.1 and earlier cannot report a job or set a cover.
      setDraftJob(
        status.capabilities?.includes("job")
          ? { jobId: result.jobId, status: "pending", auto }
          : null,
      );
      setNotice(
        (auto
          ? "Creating your X draft. Progress appears under the toolbar."
          : "Review opened in the companion. Confirm there to upload images and create your draft.") +
          (article.bundle.cover && !status.capabilities?.includes("cover")
            ? " This companion version cannot set the cover: update it, or set the cover in X."
            : ""),
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
  const draftProgress =
    draftJob?.progress && draftJob.progress.total > 0
      ? ` (${draftJob.progress.done}/${draftJob.progress.total} images)`
      : "";
  const draftMessage = !draftJob
    ? ""
    : draftJob.status === "completed"
      ? "Draft created in X. " + (draftJob.warning ?? "Review and publish it there.")
      : draftJob.status === "failed"
        ? (draftJob.error ?? "The draft could not be created.")
        : draftJob.status === "uncertain"
          ? (draftJob.error ?? "The result is unknown.") + " Resolve it in the companion review."
          : draftJob.status === "missing"
            ? "This staged article was discarded in the companion."
            : draftJob.status === "uploading"
              ? `Uploading images to X${draftProgress}…`
              : draftJob.status === "creating"
                ? "Opening X Articles…"
                : draftJob.auto
                  ? "Starting draft creation…"
                  : "Waiting for your confirmation in the companion review.";
  const firewallLines =
    draftJob?.errorCode === "X_FIREWALL_BLOCKED" ? shellPipeLines(markdown) : [];
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
    setHandles((old) => ({ folder: old.folder }));
    loadedModified.current = 0;
    setFileChanged(false);
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
          <button onClick={() => void openFiles()} disabled={booting}>
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
            title={errors.length ? "Resolve the issues shown below the article title" : updating ? "Preparing the article…" : !hasContent ? "Add article content first" : autoCreate ? "Create the draft in X now (companion setting)" : "Open companion review to create a draft"}
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

      {draftJob && (
        <div
          className={"draft-status draft-" + draftJob.status}
          id="draft-status"
          role="status"
          data-status={draftJob.status}
          data-job-id={draftJob.jobId}
          data-draft-url={draftJob.draftUrl}
          data-error-code={draftJob.errorCode}
        >
          {["pending", "creating", "uploading"].includes(draftJob.status) ? (
            <LoaderCircle className="spin" size={14} />
          ) : draftJob.status === "completed" ? (
            <Check size={14} />
          ) : (
            <CircleAlert size={14} />
          )}
          <span>{draftMessage}</span>
          {draftJob.draftUrl && (
            <a href={draftJob.draftUrl} target="_blank" rel="noopener noreferrer">
              Open draft in X <ArrowRight size={13} />
            </a>
          )}
          {firewallLines.map((line) => (
            <button key={line} onClick={() => jump(line)}>
              Line {line} · Go to line
            </button>
          ))}
          <button
            className="draft-status-close"
            aria-label="Dismiss draft status"
            onClick={() => setDraftJob(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
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
            {handles.document && (
              <button
                className={"reload-file " + (fileChanged ? "needs-attention" : "")}
                onClick={() => void reloadFromFile()}
                title={fileChanged ? "This file changed on disk. Reload it; your image choices stay." : "Re-read this file from disk; your image choices stay."}
                aria-label="Reload from file"
              >
                <RefreshCw size={14} /> {fileChanged ? "Changed on disk · Reload" : "Reload"}
              </button>
            )}
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
                void dropped(event.dataTransfer);
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
              {plan.frontmatter && (
                <span className="frontmatter-note" title="YAML frontmatter is never sent to X">
                  · Frontmatter: {plan.frontmatter.used.length ? "used " + plan.frontmatter.used.join(", ") : "no title or cover"}
                  {plan.frontmatter.count > plan.frontmatter.used.length && `, ignored ${plan.frontmatter.count - plan.frontmatter.used.length} field${plan.frontmatter.count - plan.frontmatter.used.length === 1 ? "" : "s"}`}
                </span>
              )}
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
                        {issue.id === "nested-list" && simplifiedLists !== markdown && errors.findIndex(e => e.id === "nested-list") === index &&
                          <button onClick={() => {
                            setMarkdown(simplifiedLists);
                            setNotice("Converted simple nested lists to one level. Review the updated preview.");
                          }}>Convert to one level</button>}
                        {issue.id === "footnote" && endnotes !== markdown && errors.findIndex(e => e.id === "footnote") === index &&
                          <button onClick={() => {
                            setMarkdown(endnotes);
                            setNotice("Footnotes converted to numbered endnotes after a divider at the end. Review the updated preview.");
                          }}>Convert to endnotes</button>}
                      </div>
                    </div>;
                  })}
                  {renderError && <p>{renderError}</p>}
                </div>
                <div className="issue-actions">
                  {missingImages.length > 0 && <button onClick={() => void matchFolderFromDisk()}><FolderOpen size={14} /> Match image folder</button>}
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
                {coverSource && (
                  <figure
                    className="xp-fig editable-image preview-cover"
                    id="article-cover"
                    data-state={coverState}
                  >
                    {coverAsset ? (
                      <img src={coverAsset.url} alt="Article cover" />
                    ) : (
                      <div className="preview-cover-empty">
                        {coverProblem ?? "Preparing cover…"}
                      </div>
                    )}
                    <figcaption className="preview-image-tools">
                      <span>
                        Cover
                        {coverAsset &&
                          ` · ${coverAsset.width} × ${coverAsset.height}`}
                        {coverSource !== COVER_KEY && ` · ${coverSource}`}
                        {coverAsset &&
                          Math.abs(coverAsset.width / coverAsset.height - 2.5) > 0.05 &&
                          " · X crops covers to about 5:2; adjust the crop in X"}
                      </span>
                      <div>
                        <button onClick={() => coverInput.current?.click()}>
                          <ImageIcon size={13} />{" "}
                          {coverAsset ? "Replace cover" : "Choose cover"}
                        </button>
                        {files.has(COVER_KEY) && (
                          <button onClick={() => chooseCover(undefined)}>
                            <X size={13} /> Remove cover
                          </button>
                        )}
                      </div>
                    </figcaption>
                  </figure>
                )}
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
                <div className="format-note" key={index}>
                  <button onClick={() => jump(issue.line)}>
                    {issue.message} <span>Line {issue.line}</span>
                  </button>
                  {issue.id === "wikilink" && (
                    <button className="note-action" onClick={() => setSettings({ ...settings, warnWikilinks: false })}>
                      Turn off this check
                    </button>
                  )}
                </div>
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
            : autoCreate
              ? "Saved on this device · X draft created without review (companion setting)"
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
        accept=".md,.markdown,.mdown,text/markdown,image/png,image/jpeg,image/webp,image/svg+xml,.svg"
        multiple
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
        accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
        multiple
        aria-label="Add image files"
        hidden
        onChange={(event) => {
          void importFiles(event.target.files, true);
          event.target.value = "";
        }}
      />
      <input
        ref={coverInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
        aria-label="Choose cover image"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) chooseCover(file);
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
                    attached. Import Markdown also accepts the .md file and its
                    images selected together.
                    {fileSystemAccess && " This browser remembers the folder, so the next article from the same place matches automatically."}
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
                <span>PNG, JPEG, WebP, SVG · larger than 5 MiB is downscaled</span>
                <div>
                  <button
                    className="button-primary"
                    onClick={() => imageInput.current?.click()}
                  >
                    Add images
                  </button>
                  <button
                    className="button-outline"
                    onClick={() => void matchFolderFromDisk()}
                  >
                    <FolderOpen size={15} /> {handles.folder ? `Match image folder (last: ${handles.folder.name})` : "Match image folder"}
                  </button>
                </div>
              </div>
              <div
                className={"asset-card " + (coverProblem ? "has-error" : "")}
                id="asset-cover"
              >
                <div className="asset-top">
                  <div className="asset-thumbnail">
                    {coverAsset ? (
                      <img src={coverAsset.url} alt="Cover" />
                    ) : (
                      <ImageIcon size={24} />
                    )}
                  </div>
                  <div className="asset-details">
                    <strong>Cover</strong>
                    <span className="asset-path">
                      {!coverSource
                        ? "Optional · shown above the title in X"
                        : coverSource === COVER_KEY
                          ? "Chosen here"
                          : coverSource}
                    </span>
                    <span className={"asset-state " + (coverProblem ? "error" : "")}>
                      {coverProblem ??
                        (coverAsset
                          ? coverAsset.width + " × " + coverAsset.height + " · ready"
                          : coverSource
                            ? "Preparing…"
                            : "X shows covers at about 5:2. Or add cover: path to your frontmatter.")}
                    </span>
                  </div>
                </div>
                <div className="asset-actions">
                  <button onClick={() => coverInput.current?.click()}>
                    {coverSource ? "Replace cover" : "Choose cover"}
                  </button>
                  {files.has(COVER_KEY) && (
                    <button onClick={() => chooseCover(undefined)}>
                      Remove cover
                    </button>
                  )}
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
                            accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
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
              <label className="setting-row">
                <input
                  type="checkbox"
                  checked={settings.warnWikilinks}
                  onChange={(event) => setSettings({ ...settings, warnWikilinks: event.target.checked })}
                />
                <span>
                  <strong>Warn about Obsidian [[wikilinks]]</strong>
                  <br />
                  X shows [[Note]] as literal text. Image embeds like ![[photo.png]] are always converted.
                </span>
              </label>
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
                  Images over 5 MiB are downscaled and SVG is rendered to PNG.
                  ALT descriptions, formulas, GIF, and video are not
                  implemented. Covers need companion 0.1.2 or later.
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
