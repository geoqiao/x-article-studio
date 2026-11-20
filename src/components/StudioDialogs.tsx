import type { RefObject } from "react";
import { ArrowDownToLine, ArrowRight, Check, Copy, Plus, X } from "lucide-react";
import { FORMATS } from "../compatibility";
import {
  selectFormattedBody,
  setArticleClipboard,
  type ArticleClipboard,
} from "../clipboard";
import type { Settings } from "../settings";
import type {
  ArticlePlan,
  AssetProgress,
  PreparedAsset,
  TableMode,
} from "../types";
import { ImagesDrawer } from "./ImagesDrawer";

export type Modal =
  | "images"
  | "help"
  | "formats"
  | "connect"
  | "new"
  | "example"
  | "copy"
  | null;

export type ManualCopy =
  | { kind: "title"; text: string }
  | ({ kind: "body" } & ArticleClipboard);

type Props = {
  modal: Modal;
  dialogRef: RefObject<HTMLDialogElement | null>;
  backdropPointerRef: RefObject<number | null>;
  manualBodyRef: RefObject<HTMLDivElement | null>;
  standalone: boolean;
  companionUrl: string;
  bridge: boolean;
  settings: Settings;
  manualCopy: ManualCopy | null;
  plan: ArticlePlan;
  previewAssets: PreparedAsset[];
  progress: Record<string, AssetProgress>;
  current: boolean;
  tableMode: TableMode;
  busy: boolean;
  canExport: boolean;
  fileSystemAccess: boolean;
  folderName?: string;
  coverSource?: string;
  coverAsset?: PreparedAsset;
  coverProblem?: string;
  hasCustomCover: boolean;
  canUndoImage: (source: string) => boolean;
  onClose: () => void;
  onOpenModal: (modal: Modal) => void;
  onCheckConnection: () => void;
  onUpdateSettings: (settings: Settings) => void;
  onSaveMarkdown: () => void;
  onReplaceDocument: (example: boolean) => void;
  onImportDropped: (files: FileList) => void;
  onPickImages: () => void;
  onMatchFolder: () => void;
  onPickCover: () => void;
  onRemoveCover: () => void;
  onReplaceImage: (source: string, file: File) => void;
  onUndoImage: (source: string) => void;
  onJumpToLine: (line: number) => void;
  onNotify: (message: string) => void;
  onExportZip: () => void;
  onRetryRender: () => void;
};

function dialogHeading(modal: Modal, manualCopy: ManualCopy | null): string {
  switch (modal) {
    case "images":
      return "Images & diagrams";
    case "connect":
      return "Create a draft with all your images";
    case "help":
      return "From Markdown to X";
    case "formats":
      return "Format support";
    case "new":
      return "Start a new article?";
    case "example":
      return "Load the example?";
    case "copy":
      return manualCopy?.kind === "body" ? "Copy formatted body" : "Copy title";
    default:
      return "";
  }
}

export function StudioDialogs({
  modal,
  dialogRef,
  backdropPointerRef,
  manualBodyRef,
  standalone,
  companionUrl,
  bridge,
  settings,
  manualCopy,
  plan,
  previewAssets,
  progress,
  current,
  tableMode,
  busy,
  canExport,
  fileSystemAccess,
  folderName,
  coverSource,
  coverAsset,
  coverProblem,
  hasCustomCover,
  canUndoImage,
  onClose,
  onOpenModal,
  onCheckConnection,
  onUpdateSettings,
  onSaveMarkdown,
  onReplaceDocument,
  onImportDropped,
  onPickImages,
  onMatchFolder,
  onPickCover,
  onRemoveCover,
  onReplaceImage,
  onUndoImage,
  onJumpToLine,
  onNotify,
  onExportZip,
  onRetryRender,
}: Props) {
  const outsideDialog = (event: React.PointerEvent<HTMLDialogElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    );
  };

  return (
    <dialog
      ref={dialogRef}
      className={
        modal === "images"
          ? "drawer-dialog"
          : modal === "formats"
            ? "wide-dialog"
            : ""
      }
      aria-labelledby="article-dialog-title"
      closedby="any"
      onCancel={onClose}
      onClose={onClose}
      onPointerDown={(event) => {
        if ("closedBy" in HTMLDialogElement.prototype) return;
        backdropPointerRef.current =
          event.isPrimary && event.button === 0 && outsideDialog(event)
            ? event.pointerId
            : null;
      }}
      onPointerUp={(event) => {
        if ("closedBy" in HTMLDialogElement.prototype) return;
        const dismiss =
          backdropPointerRef.current === event.pointerId && outsideDialog(event);
        backdropPointerRef.current = null;
        if (dismiss) onClose();
      }}
      onPointerCancel={() => {
        backdropPointerRef.current = null;
      }}
    >
      <div className="dialog-inner">
        <div className="dialog-header">
          <h2 id="article-dialog-title">{dialogHeading(modal, manualCopy)}</h2>
          <button
            type="button"
            className="dialog-close"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="dialog-body">
          {modal === "images" && (
            <ImagesDrawer
              plan={plan}
              previewAssets={previewAssets}
              progress={progress}
              current={current}
              tableMode={tableMode}
              busy={busy}
              canExport={canExport}
              fileSystemAccess={fileSystemAccess}
              folderName={folderName}
              coverSource={coverSource}
              coverAsset={coverAsset}
              coverProblem={coverProblem}
              hasCustomCover={hasCustomCover}
              canUndoImage={canUndoImage}
              onImportDropped={onImportDropped}
              onPickImages={onPickImages}
              onMatchFolder={onMatchFolder}
              onPickCover={onPickCover}
              onRemoveCover={onRemoveCover}
              onReplaceImage={onReplaceImage}
              onUndoImage={onUndoImage}
              onJumpToLine={onJumpToLine}
              onNotify={onNotify}
              onExportZip={onExportZip}
              onRetryRender={onRetryRender}
            />
          )}

          {modal === "connect" && (
            <>
              <p className="dialog-lead">
                The Chrome companion uploads your images and inserts them in the
                right places. You review the draft before publishing.
              </p>
              <div className="inline-note mobile-companion-note">
                Automatic draft creation uses a desktop Chrome extension. On a
                phone or tablet, use <strong>Copy body</strong> and{" "}
                <strong>Copy title</strong> to paste directly into X Articles.
              </div>
              {standalone ? (
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
                    Open full app <ArrowRight size={15} aria-hidden="true" />
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
                        Add it from the Chrome Web Store in desktop Chrome, then
                        refresh this page. The editor and copying also work
                        without it.
                      </p>
                      <a
                        className="button-primary"
                        href={companionUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Install Chrome companion{" "}
                        <ArrowRight size={15} aria-hidden="true" />
                      </a>
                      <details className="help-details">
                        <summary>Install a development build</summary>
                        <p>
                          Download and unzip the companion. Open
                          chrome://extensions, enable Developer mode, choose
                          Load unpacked and select the folder.
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
                        automatically and continues with your signed-in X
                        session. Your account needs Articles access.
                      </p>
                    </li>
                  </ol>
                  <p className="muted-note">
                    If an older companion asks you to open X first, update it or{" "}
                    <a
                      href="https://x.com/compose/articles"
                      target="_blank"
                      rel="noreferrer"
                    >
                      open X Articles
                    </a>{" "}
                    once, then retry.
                  </p>
                  <button
                    type="button"
                    className="button-outline"
                    onClick={onCheckConnection}
                  >
                    {bridge ? (
                      <Check size={15} aria-hidden="true" />
                    ) : (
                      <Plus size={15} aria-hidden="true" />
                    )}{" "}
                    Check connection
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
              <ol className="setup-steps">
                <li>
                  <strong>Paste or import your Markdown</strong>
                  <p>
                    Write in the left panel, import a .md file from File, or
                    drop one into the editor. A heading is optional; edit the
                    title directly at the top of the preview.
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
                    desktop Chrome companion. <b>Copy title / Copy body</b> is
                    the manual option: the body is copied as formatted rich
                    text. Use regular Paste in the X Articles body field to keep
                    headings, emphasis, lists, and links. Add images from the
                    Images panel. Tables may need PNG when pasting.
                  </p>
                </li>
              </ol>
              <p className="inline-note">
                Nothing is sent to X while you write. Your draft is saved in
                this browser. Export ZIP includes Markdown and prepared images.
                If preparation is incomplete, it saves the original source and
                selected local files instead.
              </p>
              <label className="setting-row">
                <input
                  type="checkbox"
                  checked={settings.warnWikilinks}
                  onChange={(event) =>
                    onUpdateSettings({
                      ...settings,
                      warnWikilinks: event.target.checked,
                    })
                  }
                />
                <span>
                  <strong>Warn about Obsidian [[wikilinks]]</strong>
                  <br />X shows [[Note]] as literal text. Image embeds like
                  ![[photo.png]] are always converted.
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
                  type="button"
                  className="text-link"
                  onClick={() => onOpenModal("formats")}
                >
                  See full format support{" "}
                  <ArrowRight size={13} aria-hidden="true" />
                </button>
              </details>
            </>
          )}

          {modal === "formats" && (
            <>
              <p className="dialog-lead">
                These are this importer’s mappings. Final rendering and account
                access depend on X.
              </p>
              <div className="format-table-wrap" tabIndex={0}>
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
              <p className="dialog-lead">
                This replaces the article and images saved in this browser.
                Download your Markdown first if you want to keep it.
              </p>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="button-outline"
                  autoFocus
                  onClick={onSaveMarkdown}
                >
                  <ArrowDownToLine size={15} aria-hidden="true" /> Save Markdown
                </button>
                <button
                  type="button"
                  className="button-primary"
                  onClick={() => onReplaceDocument(modal === "example")}
                >
                  {modal === "new" ? "Start new article" : "Load example"}
                </button>
              </div>
            </>
          )}

          {modal === "copy" && manualCopy && (
            <>
              <p className="dialog-lead">
                {manualCopy.kind === "body"
                  ? "Automatic copying was blocked. Select the formatted body below and press ⌘C on Mac or Ctrl+C on Windows. Then paste normally into the X Articles body field."
                  : "Automatic copying was blocked. Select the title below and copy it into the X Articles title field."}
              </p>
              {manualCopy.kind === "body" ? (
                <>
                  <button
                    type="button"
                    className="button-primary"
                    onClick={() =>
                      manualBodyRef.current &&
                      selectFormattedBody(manualBodyRef.current)
                    }
                  >
                    <Copy size={15} aria-hidden="true" /> Select formatted body
                  </button>
                  <div
                    ref={manualBodyRef}
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
      </div>
    </dialog>
  );
}
