import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, CircleAlert, LoaderCircle, X } from "lucide-react";
import {
  createPlan,
  MAX_MARKDOWN_LENGTH,
  safeFileStem,
  shellPipeLines,
} from "./plan";
import {
  prepareArticle,
  safePreview,
  disposeArticle,
  exportArticle,
  type AssetCache,
} from "./prepare";
import { exportDraftBackup } from "./backup";
import { convertFootnotesToEndnotes, simplifyNestedLists } from "./normalize";
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
import { copyArticleBody, createArticleClipboard } from "./clipboard";
import logoUrl from "../public/logo.svg";
import { EditorHeader } from "./components/EditorHeader";
import { MobileTabs } from "./components/MobileTabs";
import { SourcePanel } from "./components/SourcePanel";
import { PreviewPanel } from "./components/PreviewPanel";
import { StatusBar } from "./components/StatusBar";
import {
  StudioDialogs,
  type ManualCopy,
  type Modal,
} from "./components/StudioDialogs";
import type {
  AssetProgress,
  LocalAssetMap,
  PreparedArticle,
  TableMode,
} from "./types";

/** A job staged from this page, tracked until the companion reports its outcome. */
type DraftJob = BridgeJob & { auto: boolean };
const STANDALONE = import.meta.env.VITE_STANDALONE_PREVIEW === "true";
const COMPANION_URL =
  "https://chromewebstore.google.com/detail/ojpjldmiiibgjnbjfiacaoenfgpdhbbh";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 760px)").matches
      : false,
  );
  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return isMobile;
}

export default function App() {
  const isMobile = useIsMobile();
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
  const [manualCopy, setManualCopy] = useState<ManualCopy | null>(null);
  const manualBody = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const titleInput = useRef<HTMLTextAreaElement>(null);
  const assetCache = useRef<AssetCache>(new Map());
  const markdownInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropPointer = useRef<number | null>(null);
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
  const canCopyBody =
    hasContent &&
    !booting &&
    !plan.issues.some(
      (issue) =>
        issue.severity === "error" &&
        !["title-format", "markdown-limit", "asset-count"].includes(issue.id),
    );
  const canExport = hasContent && !booting && !exporting;
  const simplifiedLists = useMemo(
    () =>
      plan.issues.some((issue) => issue.id === "nested-list")
        ? simplifyNestedLists(markdown)
        : markdown,
    [markdown, plan],
  );
  const endnotes = useMemo(
    () =>
      plan.issues.some((issue) => issue.id === "footnote")
        ? convertFootnotesToEndnotes(markdown)
        : markdown,
    [markdown, plan],
  );
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
          if (saved.handles && typeof saved.handles === "object")
            setHandles(saved.handles);
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

  // Updating the document always updates the preview.
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
    if (!documentHandle) {
      setFileChanged(false);
      return;
    }
    let cancelled = false;
    const check = async () => {
      if (document.hidden || !(await hasPermission(documentHandle))) return;
      try {
        const file = await documentHandle.getFile();
        if (!cancelled && loadedModified.current)
          setFileChanged(file.lastModified > loadedModified.current);
      } catch {
        /* moved or deleted: Reload reports it */
      }
    };
    void check();
    const timer = setInterval(check, 4_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [documentHandle]);

  useEffect(() => {
    backdropPointer.current = null;
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
    const timer = setTimeout(() => setCopied(""), 1500);
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
      const target =
        text === undefined
          ? plan
          : createPlan(text, tableMode, "", path, settings);
      // A remembered image folder that is still readable supplies this article's images too.
      const folder =
        picked.folder ?? (text !== undefined ? handles.folder : undefined);
      let fromFolder = matchFolder;
      if (
        text !== undefined &&
        !images.length &&
        folder &&
        (await hasPermission(folder))
      ) {
        for (const [key, file] of await readFolderImages(folder))
          images.push(Object.assign(file, { folderPath: key }));
        fromFolder = images.length > 0;
      }
      if (sequence !== importSequence.current) return;
      const sources = target.assets
        .filter((asset) => asset.kind === "image")
        .map((asset) => asset.source);
      const wanted =
        target.cover && !/^https?:\/\//i.test(target.cover.source)
          ? [...sources, target.cover.source]
          : sources;
      const incomingImages = new Map(
        images.map((file) => [
          normalizePath(
            (file as File & { folderPath?: string }).folderPath ||
              file.webkitRelativePath ||
              file.name,
          ),
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
      const merged: LocalAssetMap =
        text === undefined ? new Map(files) : new Map();
      const matchedFiles = new Set(matches.values());
      for (const [key, file] of incomingImages)
        if (!fromFolder || matchedFiles.has(file)) merged.set(key, file);
      for (const [source, file] of matches) merged.set(source, file);
      if (
        [...new Set(merged.values())].reduce(
          (sum, file) => sum + file.size,
          0,
        ) >
        MAX_SOURCE_BYTES * 4
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
      if (picked.folder)
        setHandles((old) => ({ ...old, folder: picked.folder }));
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

  async function openFiles() {
    if (!fileSystemAccess) {
      markdownInput.current?.click();
      return;
    }
    try {
      const result = await pickFiles();
      if (result)
        await importFiles(result.files, false, false, {
          document: result.document,
        });
    } catch {
      markdownInput.current?.click();
    }
  }

  async function matchFolderFromDisk() {
    if (!fileSystemAccess) {
      folderInput.current?.click();
      return;
    }
    try {
      const folder = await pickFolder();
      if (!folder) return;
      const images = [...(await readFolderImages(folder))].map(([key, file]) =>
        Object.assign(file, { folderPath: key }),
      );
      if (!images.length) {
        setNotice(`No PNG, JPEG, WebP or SVG files found in “${folder.name}”.`);
        return;
      }
      await importFiles(images, false, true, { folder });
    } catch {
      folderInput.current?.click();
    }
  }

  async function reloadFromFile() {
    const handle = handles.document;
    if (!handle) return;
    const sequence = ++importSequence.current;
    try {
      if (!(await ensurePermission(handle))) {
        setNotice("Allow file access to reload, or import the file again.");
        return;
      }
      const file = await handle.getFile();
      if (file.size > MAX_MARKDOWN_LENGTH * 4)
        throw new Error("This Markdown file is too large.");
      const text = await file.text();
      if (text.length > MAX_MARKDOWN_LENGTH)
        throw new Error("Markdown is limited to 200,000 characters.");
      const folder = handles.folder;
      const folderImages =
        folder && (await hasPermission(folder))
          ? await readFolderImages(folder)
          : new Map<string, File>();
      if (sequence !== importSequence.current) return;
      const next = createPlan(text, tableMode, title, documentPath, settings);
      const sources = next.assets
        .filter((asset) => asset.kind === "image")
        .map((asset) => asset.source);
      const wanted =
        next.cover && !/^https?:\/\//i.test(next.cover.source)
          ? [...sources, next.cover.source]
          : sources;
      const merged: LocalAssetMap = new Map(files);
      let matched = 0;
      for (const source of wanted) {
        if (files.has(source)) continue;
        try {
          const found = resolveLocalFile(
            source,
            folderImages,
            documentPath,
            sources,
          );
          if (found) {
            merged.set(source, found);
            matched++;
          }
        } catch {
          /* ambiguous: the Images panel explains */
        }
      }
      assetCache.current.clear();
      setHighlightedLine(undefined);
      setDraftJob(null);
      setMarkdown(text);
      if (matched) setFiles(merged);
      loadedModified.current = file.lastModified;
      setFileChanged(false);
      setNotice(
        `Reloaded ${file.name} from disk.` +
          (matched
            ? ` Matched ${matched} new image${matched === 1 ? "" : "s"}.`
            : ""),
      );
    } catch (error) {
      if (sequence !== importSequence.current) return;
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not reload the file. Import it again.",
      );
    }
  }

  async function dropped(transfer: DataTransfer) {
    const pending = fileSystemAccess
      ? dropHandles(transfer)
      : Promise.resolve([] as FileSystemHandle[]);
    const dropFiles = [...transfer.files];
    const found = await pending;
    const folder = found.find((handle) => handle.kind === "directory") as
      | DirectoryHandle
      | undefined;
    if (folder) {
      const images = [...(await readFolderImages(folder))].map(([key, file]) =>
        Object.assign(file, { folderPath: key }),
      );
      await importFiles(images, false, true, { folder });
      return;
    }
    const doc = found.find(
      (handle) => handle.kind === "file" && MARKDOWN_FILE.test(handle.name),
    ) as FileHandle | undefined;
    await importFiles(dropFiles, true, false, { document: doc });
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
    requestAnimationFrame(() =>
      document.getElementById("asset-" + id)?.scrollIntoView({ block: "nearest" }),
    );
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
        complete
          ? await exportArticle(article)
          : await exportDraftBackup(
              { markdown, title, tableMode, documentPath },
              files,
              issues,
            ),
        safeFileStem(plan.title) + (complete ? ".zip" : "-source-backup.zip"),
      );
      setNotice(
        complete
          ? "Downloaded Markdown and all prepared images."
          : "Source backup downloaded with selected local files. Unresolved images and formatting still need attention before creating a draft.",
      );
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
    const body = createArticleClipboard({
      plan,
      assets: previewAssets,
      previewHtml: preview,
    });
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
      ? "Draft created in X. " +
        (draftJob.warning ?? "Review and publish it there.")
      : draftJob.status === "failed"
        ? (draftJob.error ?? "The draft could not be created.")
        : draftJob.status === "uncertain"
          ? (draftJob.error ?? "The result is unknown.") +
            " Resolve it in the companion review."
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
    draftJob?.errorCode === "X_FIREWALL_BLOCKED"
      ? shellPipeLines(markdown)
      : [];

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
      <div className="sr-only" role="status" aria-live="polite">
        {copied === "title"
          ? "Title copied"
          : copied === "body"
            ? "Body copied"
            : ""}
      </div>

      <EditorHeader
        logoUrl={logoUrl}
        standalone={STANDALONE}
        companionUrl={COMPANION_URL}
        booting={booting}
        assetsCount={plan.assets.length}
        assetErrorsCount={assetErrors.length}
        errorsCount={errors.length}
        renderError={renderError}
        copied={copied}
        hasTitle={!!plan.title}
        canCopyBody={canCopyBody}
        canExport={canExport}
        exporting={exporting}
        ready={ready}
        sending={sending}
        updating={updating}
        hasContent={hasContent}
        autoCreate={autoCreate}
        onOpenModal={setModal}
        onImportFiles={() => void openFiles()}
        onMatchFolder={() => void matchFolderFromDisk()}
        onSaveMarkdown={saveMarkdown}
        onExportZip={() => void exportZip()}
        onCopyTitle={() => void copyTitle()}
        onCopyBody={() => void copyBody()}
        onHandoff={() => void handoff()}
        onFocusIssues={() => {
          setMobileView("preview");
          requestAnimationFrame(() =>
            document.getElementById("draft-issues")?.focus(),
          );
        }}
      />

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
            <LoaderCircle className="spin" size={14} aria-hidden="true" />
          ) : draftJob.status === "completed" ? (
            <Check size={14} aria-hidden="true" />
          ) : (
            <CircleAlert size={14} aria-hidden="true" />
          )}
          <span>{draftMessage}</span>
          {draftJob.draftUrl && (
            <a
              href={draftJob.draftUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open draft in X <ArrowRight size={13} aria-hidden="true" />
            </a>
          )}
          {firewallLines.map((line) => (
            <button type="button" key={line} onClick={() => jump(line)}>
              Line {line} · Go to line
            </button>
          ))}
          <button
            type="button"
            className="draft-status-close"
            aria-label="Dismiss draft status"
            onClick={() => setDraftJob(null)}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      )}

      {STANDALONE && (
        <div className="workflow-strip">
          <span>
            <b>1</b> Paste or import Markdown
          </span>
          <ArrowRight size={12} aria-hidden="true" />
          <span>
            <b>2</b> Preview updates automatically
          </span>
          <ArrowRight size={12} aria-hidden="true" />
          <span>
            <b>3</b> Copy body or create an X draft
          </span>
        </div>
      )}

      <MobileTabs
        mobileView={mobileView}
        errorsCount={errors.length}
        hasTables={plan.counts.tables > 0}
        tableMode={tableMode}
        hasDocumentHandle={!!handles.document}
        fileChanged={fileChanged}
        onChangeView={setMobileView}
        onChangeTableMode={setTableMode}
        onReloadFromFile={() => void reloadFromFile()}
      />

      <main className={"editor-workspace mobile-" + mobileView}>
        <SourcePanel
          isMobile={isMobile}
          hiddenOnMobile={mobileView !== "write"}
          textareaRef={textarea}
          markdown={markdown}
          booting={booting}
          documentPath={documentPath}
          hasDocumentHandle={!!handles.document}
          fileChanged={fileChanged}
          highlightedLine={highlightedLine}
          onChangeMarkdown={(value) => {
            setMarkdown(value);
            setHighlightedLine(undefined);
          }}
          onInsert={insert}
          onPickImages={() => imageInput.current?.click()}
          onReloadFromFile={() => void reloadFromFile()}
          onSaveMarkdown={saveMarkdown}
          onDropFiles={(transfer) => void dropped(transfer)}
          onPasteFiles={(selected) => void importFiles(selected, true)}
        />

        <PreviewPanel
          isMobile={isMobile}
          hiddenOnMobile={mobileView !== "preview"}
          plan={plan}
          markdown={markdown}
          title={title}
          booting={booting}
          hasContent={hasContent}
          updating={updating}
          ready={ready}
          phone={phone}
          tableMode={tableMode}
          copied={copied}
          previewHtml={preview}
          errors={errors}
          warnings={warnings}
          renderError={renderError}
          assetErrors={assetErrors}
          missingImagesCount={missingImages.length}
          simplifiedLists={simplifiedLists}
          endnotes={endnotes}
          coverSource={coverSource}
          coverAsset={coverAsset}
          coverProblem={coverProblem}
          coverState={coverState}
          hasCustomCover={files.has(COVER_KEY)}
          titleInputRef={titleInput}
          canUndoImage={(source) => imageUndo.has(source)}
          onChangeTitle={setTitle}
          onCopyTitle={() => void copyTitle()}
          onChangeTableMode={setTableMode}
          onChangePhone={setPhone}
          onJumpToLine={jump}
          onShowAsset={showAsset}
          onMatchFolder={() => void matchFolderFromDisk()}
          onRetryRender={() => {
            assetCache.current.clear();
            setRetry((value) => value + 1);
          }}
          onConvertNestedLists={() => {
            setMarkdown(simplifiedLists);
            setNotice(
              "Converted simple nested lists to one level. Review the updated preview.",
            );
          }}
          onConvertFootnotes={() => {
            setMarkdown(endnotes);
            setNotice(
              "Footnotes converted to numbered endnotes after a divider at the end. Review the updated preview.",
            );
          }}
          onPickCover={() => coverInput.current?.click()}
          onRemoveCover={() => chooseCover(undefined)}
          onReplaceImage={replaceImage}
          onUndoImage={undoImage}
          onOpenExample={() => setModal("example")}
          onDisableWikilinkWarning={() =>
            setSettings({ ...settings, warnWikilinks: false })
          }
        />
      </main>

      <StatusBar
        plan={plan}
        charCount={markdown.length}
        booting={booting}
        saving={saving}
        updating={updating}
        hasContent={hasContent}
        hasBlockingErrors={errors.length > 0 || !!renderError}
        standalone={STANDALONE}
      />

      {notice && (
        <div className="toast" role="status">
          <Check size={16} aria-hidden="true" />
          <span>{notice}</span>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={16} aria-hidden="true" />
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

      <StudioDialogs
        modal={modal}
        dialogRef={dialog}
        backdropPointerRef={backdropPointer}
        manualBodyRef={manualBody}
        standalone={STANDALONE}
        companionUrl={COMPANION_URL}
        bridge={bridge}
        settings={settings}
        manualCopy={manualCopy}
        plan={plan}
        previewAssets={previewAssets}
        progress={progress}
        current={current}
        tableMode={tableMode}
        busy={busy}
        canExport={canExport}
        fileSystemAccess={fileSystemAccess}
        folderName={handles.folder?.name}
        coverSource={coverSource}
        coverAsset={coverAsset}
        coverProblem={coverProblem}
        hasCustomCover={files.has(COVER_KEY)}
        canUndoImage={(source) => imageUndo.has(source)}
        onClose={() => setModal(null)}
        onOpenModal={setModal}
        onCheckConnection={async () => {
          const status = await getBridgeStatus();
          setBridge(status.available);
          setNotice(
            status.available
              ? "Companion connected. You can now create your draft."
              : "Companion not found. Install it and refresh this page.",
          );
          if (status.available) setModal(null);
        }}
        onUpdateSettings={setSettings}
        onSaveMarkdown={saveMarkdown}
        onReplaceDocument={(example) => void replaceDocument(example)}
        onImportDropped={(selected) => void importFiles(selected, true)}
        onPickImages={() => imageInput.current?.click()}
        onMatchFolder={() => void matchFolderFromDisk()}
        onPickCover={() => coverInput.current?.click()}
        onRemoveCover={() => chooseCover(undefined)}
        onReplaceImage={replaceImage}
        onUndoImage={undoImage}
        onJumpToLine={jump}
        onNotify={setNotice}
        onExportZip={() => void exportZip()}
        onRetryRender={() => {
          assetCache.current.clear();
          setRetry((value) => value + 1);
        }}
      />
    </div>
  );
}
