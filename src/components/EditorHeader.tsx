import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  FilePlus2,
  FileText,
  FolderOpen,
  HelpCircle,
  Image as ImageIcon,
  LoaderCircle,
  MoreHorizontal,
  Package,
  Table2,
} from "lucide-react";
import { DropdownMenu } from "./DropdownMenu";
import type { Modal } from "./StudioDialogs";

type Props = {
  logoUrl: string;
  standalone: boolean;
  companionUrl: string;
  booting: boolean;
  assetsCount: number;
  assetErrorsCount: number;
  errorsCount: number;
  renderError: string;
  copied: string;
  hasTitle: boolean;
  canCopyBody: boolean;
  canExport: boolean;
  exporting: boolean;
  ready: boolean;
  sending: boolean;
  updating: boolean;
  hasContent: boolean;
  autoCreate: boolean;
  onOpenModal: (modal: Modal) => void;
  onImportFiles: () => void;
  onMatchFolder: () => void;
  onSaveMarkdown: () => void;
  onExportZip: () => void;
  onCopyTitle: () => void;
  onCopyBody: () => void;
  onHandoff: () => void;
  onFocusIssues: () => void;
};

export function EditorHeader({
  logoUrl,
  standalone,
  companionUrl,
  booting,
  assetsCount,
  assetErrorsCount,
  errorsCount,
  renderError,
  copied,
  hasTitle,
  canCopyBody,
  canExport,
  exporting,
  ready,
  sending,
  updating,
  hasContent,
  autoCreate,
  onOpenModal,
  onImportFiles,
  onMatchFolder,
  onSaveMarkdown,
  onExportZip,
  onCopyTitle,
  onCopyBody,
  onHandoff,
  onFocusIssues,
}: Props) {
  const draftTitle = errorsCount
    ? "Resolve the issues shown in the preview"
    : updating
      ? "Preparing the article…"
      : !hasContent
        ? "Add article content first"
        : autoCreate
          ? "Create the draft in X now (companion setting)"
          : "Open companion review to create a draft";

  return (
    <header className="app-header" id="top">
      <div className="header-left">
        <a className="brand" href={standalone ? "#" : "/"}>
          <img className="brand-icon" src={logoUrl} alt="" width="26" height="26" />
          <span>md2xarticle</span>
        </a>
        {standalone && <span className="standalone-badge">Preview</span>}

        <DropdownMenu
          triggerClassName="header-menu-trigger desktop-only"
          triggerLabel={
            <>
              <span>File</span>
              <ChevronDown size={14} aria-hidden="true" />
            </>
          }
          disabled={booting}
        >
          {(close) => (
            <>
              <button
                type="button"
                onClick={() => {
                  close();
                  onOpenModal("new");
                }}
              >
                <FilePlus2 size={15} aria-hidden="true" />
                <span>New article</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  close();
                  onImportFiles();
                }}
              >
                <FolderOpen size={15} aria-hidden="true" />
                <span>Import Markdown…</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  close();
                  onMatchFolder();
                }}
              >
                <ImageIcon size={15} aria-hidden="true" />
                <span>Match image folder…</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  close();
                  onOpenModal("example");
                }}
              >
                <FileText size={15} aria-hidden="true" />
                <span>Load example</span>
              </button>
              <hr />
              <button
                type="button"
                onClick={() => {
                  close();
                  onSaveMarkdown();
                }}
              >
                <ArrowDownToLine size={15} aria-hidden="true" />
                <span>Download .md</span>
              </button>
              <button
                type="button"
                disabled={!canExport}
                onClick={() => {
                  close();
                  onExportZip();
                }}
              >
                <Package size={15} aria-hidden="true" />
                <span>{exporting ? "Exporting…" : "Export ZIP"}</span>
              </button>
            </>
          )}
        </DropdownMenu>
      </div>

      <div className="output-actions">
        {(errorsCount > 0 || renderError) && (
          <button
            type="button"
            className="draft-issues-link desktop-only"
            onClick={onFocusIssues}
          >
            {errorsCount
              ? `${errorsCount} ${errorsCount === 1 ? "item" : "items"} to fix`
              : "Preview error"}
          </button>
        )}

        <DropdownMenu
          align="end"
          triggerClassName="header-menu-trigger mobile-only"
          triggerAriaLabel="File and help menu"
          triggerLabel={<MoreHorizontal size={18} aria-hidden="true" />}
          disabled={booting}
        >
          {(close) => (
            <>
              <button
                type="button"
                onClick={() => {
                  close();
                  onOpenModal("new");
                }}
              >
                <FilePlus2 size={15} aria-hidden="true" />
                <span>New article</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  close();
                  onImportFiles();
                }}
              >
                <FolderOpen size={15} aria-hidden="true" />
                <span>Import Markdown…</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  close();
                  onMatchFolder();
                }}
              >
                <ImageIcon size={15} aria-hidden="true" />
                <span>Match image folder…</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  close();
                  onOpenModal("example");
                }}
              >
                <FileText size={15} aria-hidden="true" />
                <span>Load example</span>
              </button>
              <hr />
              <button
                type="button"
                disabled={!hasTitle || booting}
                onClick={() => {
                  close();
                  onCopyTitle();
                }}
              >
                <Copy size={15} aria-hidden="true" />
                <span>Copy title</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  close();
                  onSaveMarkdown();
                }}
              >
                <ArrowDownToLine size={15} aria-hidden="true" />
                <span>Download .md</span>
              </button>
              <button
                type="button"
                disabled={!canExport}
                onClick={() => {
                  close();
                  onExportZip();
                }}
              >
                <Package size={15} aria-hidden="true" />
                <span>{exporting ? "Exporting…" : "Export ZIP"}</span>
              </button>
              <hr />
              <button
                type="button"
                onClick={() => {
                  close();
                  onOpenModal("connect");
                }}
              >
                <span className="menu-x-symbol" aria-hidden="true">𝕏</span>
                <span>Create X draft (Desktop Chrome)</span>
              </button>
              <hr />
              <button
                type="button"
                onClick={() => {
                  close();
                  onOpenModal("help");
                }}
              >
                <HelpCircle size={15} aria-hidden="true" />
                <span>How to use</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  close();
                  onOpenModal("formats");
                }}
              >
                <Table2 size={15} aria-hidden="true" />
                <span>Format support</span>
              </button>
              {!standalone && (
                <>
                  <a href="/support" onClick={close}>
                    <FileText size={15} aria-hidden="true" />
                    <span>Full guide</span>
                  </a>
                  <a href="/privacy" onClick={close}>
                    <span>Privacy</span>
                  </a>
                </>
              )}
            </>
          )}
        </DropdownMenu>

        <button
          type="button"
          onClick={() => onOpenModal("images")}
          className={"images-pill " + (assetErrorsCount ? "needs-attention" : "")}
          aria-label={`Images and diagrams (${assetsCount}${assetErrorsCount ? `, ${assetErrorsCount} need attention` : ""})`}
        >
          <ImageIcon size={15} aria-hidden="true" />
          <span className="label">Images</span>
          <span className="count">{assetsCount}</span>
          {assetErrorsCount > 0 && <span className="attention-dot" aria-hidden="true" />}
        </button>

        <div className="split-button">
          <button
            type="button"
            onClick={onCopyBody}
            disabled={!canCopyBody}
            className="copy-cta copy-button"
            title={
              canCopyBody
                ? "Copy formatted text; images become placement markers"
                : "Resolve the content issues shown in the preview before copying"
            }
          >
            {copied === "body" ? (
              <Check size={14} className="copied-icon" aria-hidden="true" />
            ) : (
              <Copy size={14} aria-hidden="true" />
            )}
            <span className="label">{copied === "body" ? "Copied!" : "Copy body"}</span>
          </button>
          <DropdownMenu
            align="end"
            triggerClassName="split-chevron desktop-only"
            triggerAriaLabel="More copy and export options"
            triggerTitle="Copy title or export"
            triggerLabel={<ChevronDown size={14} aria-hidden="true" />}
            disabled={booting}
          >
            {(close) => (
              <>
                <button
                  type="button"
                  disabled={!canCopyBody}
                  onClick={() => {
                    close();
                    onCopyBody();
                  }}
                >
                  <Copy size={15} aria-hidden="true" />
                  <span>Copy body</span>
                </button>
                <button
                  type="button"
                  disabled={!hasTitle || booting}
                  onClick={() => {
                    close();
                    onCopyTitle();
                  }}
                >
                  <Copy size={15} aria-hidden="true" />
                  <span>Copy title</span>
                </button>
                <hr />
                <button
                  type="button"
                  onClick={() => {
                    close();
                    onSaveMarkdown();
                  }}
                >
                  <ArrowDownToLine size={15} aria-hidden="true" />
                  <span>Download .md</span>
                </button>
                <button
                  type="button"
                  disabled={!canExport}
                  onClick={() => {
                    close();
                    onExportZip();
                  }}
                >
                  <Package size={15} aria-hidden="true" />
                  <span>{exporting ? "Exporting…" : "Export ZIP"}</span>
                </button>
              </>
            )}
          </DropdownMenu>
        </div>

        <button
          type="button"
          onClick={onHandoff}
          disabled={!ready || sending}
          className="button-primary draft-cta desktop-only"
          title={draftTitle}
        >
          {sending ? (
            <LoaderCircle className="spin" size={14} aria-hidden="true" />
          ) : (
            <span className="x-symbol" aria-hidden="true">
              𝕏
            </span>
          )}
          <span className="label">Create X draft</span>
          <ArrowRight size={14} className="draft-arrow" aria-hidden="true" />
        </button>

        <DropdownMenu
          align="end"
          triggerClassName="icon-menu-trigger desktop-only"
          triggerAriaLabel="Help and guides"
          triggerTitle="Help and guides"
          triggerLabel={<HelpCircle size={16} aria-hidden="true" />}
        >
          {(close) => (
            <>
              <button
                type="button"
                onClick={() => {
                  close();
                  onOpenModal("help");
                }}
              >
                <HelpCircle size={15} aria-hidden="true" />
                <span>How to use</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  close();
                  onOpenModal("formats");
                }}
              >
                <Table2 size={15} aria-hidden="true" />
                <span>Format support</span>
              </button>
              {!standalone && (
                <>
                  <hr />
                  <a href="/support" onClick={close}>
                    <span>Guide</span>
                  </a>
                  <a href="/x-article-tables" onClick={close}>
                    <span>Tables guide</span>
                  </a>
                  <a href="/mermaid-diagrams-x-articles" onClick={close}>
                    <span>Mermaid diagrams</span>
                  </a>
                  <a href="/markdown-images-x-articles" onClick={close}>
                    <span>Local images</span>
                  </a>
                  <hr />
                  <a
                    href={companionUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={close}
                  >
                    <span>Chrome companion</span>
                  </a>
                  <a href="/privacy" onClick={close}>
                    <span>Privacy</span>
                  </a>
                </>
              )}
            </>
          )}
        </DropdownMenu>
      </div>
    </header>
  );
}
