import { useLayoutEffect, type RefObject } from "react";
import {
  ArrowRight,
  Check,
  CircleAlert,
  Copy,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Monitor,
  RotateCcw,
  Smartphone,
  X,
} from "lucide-react";
import { ArticlePreview } from "../ArticlePreview";
import { COVER_KEY } from "../files";
import type {
  ArticlePlan,
  AssetProgress,
  Issue,
  PreparedAsset,
  TableMode,
} from "../types";

type Props = {
  isMobile: boolean;
  hiddenOnMobile: boolean;
  plan: ArticlePlan;
  markdown: string;
  title: string;
  booting: boolean;
  hasContent: boolean;
  updating: boolean;
  ready: boolean;
  phone: boolean;
  tableMode: TableMode;
  copied: string;
  previewHtml: string;
  errors: Issue[];
  warnings: Issue[];
  renderError: string;
  assetErrors: AssetProgress[];
  missingImagesCount: number;
  simplifiedLists: string;
  endnotes: string;
  coverSource?: string;
  coverAsset?: PreparedAsset;
  coverProblem?: string;
  coverState: "none" | "error" | "ready" | "preparing";
  hasCustomCover: boolean;
  titleInputRef: RefObject<HTMLTextAreaElement | null>;
  canUndoImage: (source: string) => boolean;
  onChangeTitle: (value: string) => void;
  onCopyTitle: () => void;
  onChangeTableMode: (mode: TableMode) => void;
  onChangePhone: (phone: boolean) => void;
  onJumpToLine: (line: number) => void;
  onShowAsset: (id: string) => void;
  onMatchFolder: () => void;
  onRetryRender: () => void;
  onConvertNestedLists: () => void;
  onConvertFootnotes: () => void;
  onPickCover: () => void;
  onRemoveCover: () => void;
  onReplaceImage: (source: string, file: File) => void;
  onUndoImage: (source: string) => void;
  onOpenExample: () => void;
  onDisableWikilinkWarning: () => void;
};

export function PreviewPanel({
  isMobile,
  hiddenOnMobile,
  plan,
  markdown,
  title,
  booting,
  hasContent,
  updating,
  ready,
  phone,
  tableMode,
  copied,
  previewHtml,
  errors,
  warnings,
  renderError,
  assetErrors,
  missingImagesCount,
  simplifiedLists,
  endnotes,
  coverSource,
  coverAsset,
  coverProblem,
  coverState,
  hasCustomCover,
  titleInputRef,
  canUndoImage,
  onChangeTitle,
  onCopyTitle,
  onChangeTableMode,
  onChangePhone,
  onJumpToLine,
  onShowAsset,
  onMatchFolder,
  onRetryRender,
  onConvertNestedLists,
  onConvertFootnotes,
  onPickCover,
  onRemoveCover,
  onReplaceImage,
  onUndoImage,
  onOpenExample,
  onDisableWikilinkWarning,
}: Props) {
  const displayTitle = title || plan.title || "Untitled article";

  // Keep auto-growing textarea height in sync across browsers lacking CSS field-sizing.
  useLayoutEffect(() => {
    const el = titleInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [displayTitle, phone, isMobile, hiddenOnMobile, titleInputRef]);

  return (
    <section
      id="panel-preview"
      className="preview-panel"
      role={isMobile ? "tabpanel" : undefined}
      aria-labelledby={isMobile ? "tab-preview" : undefined}
      aria-label={isMobile ? undefined : "Article preview"}
      hidden={isMobile && hiddenOnMobile}
    >
      <div className="panel-heading preview-heading desktop-only-flex">
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
          />
          <span>X Article preview</span>
        </strong>
        <div className="preview-controls">
          {plan.counts.tables > 0 && (
            <label>
              <span>Tables</span>
              <select
                aria-label="Table format"
                value={tableMode}
                onChange={(event) =>
                  onChangeTableMode(event.target.value as TableMode)
                }
              >
                <option value="native">Native</option>
                <option value="image">PNG images</option>
              </select>
            </label>
          )}
          <div className="viewport-toggle" role="group" aria-label="Preview width">
            <button
              type="button"
              aria-label="Desktop preview"
              aria-pressed={!phone}
              onClick={() => onChangePhone(false)}
              title="Desktop preview"
            >
              <Monitor size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Phone preview"
              aria-pressed={phone}
              onClick={() => onChangePhone(true)}
              title="Phone preview"
            >
              <Smartphone size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {(errors.length > 0 || renderError) && (
        <div className="preview-alert" id="draft-issues" tabIndex={-1} role="status">
          <CircleAlert size={16} aria-hidden="true" />
          <div>
            <strong>
              {errors.length
                ? `${errors.length} ${errors.length === 1 ? "item" : "items"} to resolve before creating a draft`
                : "Preview could not update"}
            </strong>
            <div className="blocking-issues">
              {errors.map((issue, index) => {
                const asset = issue.id.startsWith("prepare-")
                  ? plan.assets.find((item) => `prepare-${item.id}` === issue.id)
                  : undefined;
                return (
                  <div className="blocking-issue" key={`${issue.id}-${index}`}>
                    <p>
                      {asset ? `${asset.label}: ` : ""}
                      {issue.message}
                    </p>
                    <div className="issue-actions">
                      {issue.id === "title-format" ? (
                        <button
                          type="button"
                          onClick={() => titleInputRef.current?.focus()}
                        >
                          Edit title
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onJumpToLine(issue.line)}
                        >
                          Line {issue.line} ·{" "}
                          {asset && asset.kind !== "image"
                            ? "Edit source"
                            : "Go to line"}
                        </button>
                      )}
                      {asset?.kind === "image" && (
                        <button
                          type="button"
                          onClick={() => onShowAsset(asset.id)}
                        >
                          Add / fix images
                        </button>
                      )}
                      {issue.id === "nested-list" &&
                        simplifiedLists !== markdown &&
                        errors.findIndex((e) => e.id === "nested-list") ===
                          index && (
                          <button type="button" onClick={onConvertNestedLists}>
                            Convert to one level
                          </button>
                        )}
                      {issue.id === "footnote" &&
                        endnotes !== markdown &&
                        errors.findIndex((e) => e.id === "footnote") ===
                          index && (
                          <button type="button" onClick={onConvertFootnotes}>
                            Convert to endnotes
                          </button>
                        )}
                    </div>
                  </div>
                );
              })}
              {renderError && <p>{renderError}</p>}
            </div>
            <div className="issue-actions">
              {missingImagesCount > 0 && (
                <button type="button" onClick={onMatchFolder}>
                  <FolderOpen size={14} aria-hidden="true" /> Match image folder
                </button>
              )}
              {(assetErrors.some((error) => error.reason !== "missing-file") ||
                renderError) && (
                <button type="button" onClick={onRetryRender}>
                  Retry
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className={"preview-scroll " + (phone ? "phone-view" : "")}>
        {!hasContent ? (
          <div className="preview-empty">
            <FileText size={28} aria-hidden="true" />
            <h2>Your article appears here</h2>
            <p>
              Paste Markdown in the editor. Images, tables, and diagrams appear
              automatically.
            </p>
            <button type="button" onClick={onOpenExample}>
              Try the example <ArrowRight size={14} aria-hidden="true" />
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
                      Math.abs(coverAsset.width / coverAsset.height - 2.5) >
                        0.05 &&
                      " · X crops covers to about 5:2; adjust the crop in X"}
                  </span>
                  <div>
                    <button type="button" onClick={onPickCover}>
                      <ImageIcon size={13} aria-hidden="true" />{" "}
                      {coverAsset ? "Replace cover" : "Choose cover"}
                    </button>
                    {hasCustomCover && (
                      <button type="button" onClick={onRemoveCover}>
                        <X size={13} aria-hidden="true" /> Remove cover
                      </button>
                    )}
                  </div>
                </figcaption>
              </figure>
            )}

            <div className="inline-title-block">
              <h1 className="sr-only">{displayTitle}</h1>
              <label htmlFor="article-title" className="sr-only">
                Article title
              </label>
              <div className="inline-title-row">
                <textarea
                  id="article-title"
                  ref={titleInputRef}
                  className="inline-title-input"
                  rows={1}
                  value={title || plan.title}
                  disabled={booting}
                  maxLength={2_000}
                  enterKeyHint="done"
                  placeholder="Untitled article"
                  aria-describedby="title-status-hint"
                  onChange={(event) =>
                    onChangeTitle(event.target.value.replace(/\r?\n/g, " "))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      // IME-safe Enter handling: ignore composition confirmation (Chrome/Firefox isComposing + Safari keyCode 229).
                      if (event.nativeEvent.isComposing || event.keyCode === 229) {
                        return;
                      }
                      event.currentTarget.blur();
                    }
                  }}
                />
                <div className="inline-title-actions">
                  <button
                    type="button"
                    className="inline-title-btn"
                    onClick={onCopyTitle}
                    disabled={!plan.title || booting}
                    title="Copy article title"
                  >
                    {copied === "title" ? (
                      <Check size={13} className="copied-icon" aria-hidden="true" />
                    ) : (
                      <Copy size={13} aria-hidden="true" />
                    )}
                    <span>{copied === "title" ? "Copied" : "Copy title"}</span>
                  </button>
                  {title && (
                    <button
                      type="button"
                      className="inline-title-btn"
                      onClick={() => onChangeTitle("")}
                      title="Use automatic title from Markdown or filename"
                    >
                      <RotateCcw size={13} aria-hidden="true" />
                      <span>Reset auto</span>
                    </button>
                  )}
                </div>
              </div>
              <span id="title-status-hint" className="sr-only">
                {title
                  ? "Custom article title. Press Enter to finish editing."
                  : "Detected from your Markdown or filename. Edit inline to override."}
              </span>
            </div>

            <ArticlePreview
              html={previewHtml}
              assets={plan.assets}
              hideTitle
              canUndo={canUndoImage}
              onReplace={onReplaceImage}
              onUndo={onUndoImage}
              onFix={(asset) => onShowAsset(asset.id)}
            />
          </article>
        )}
      </div>

      {warnings.length > 0 && (
        <details className="format-notes">
          <summary>
            {warnings.length} formatting note{warnings.length === 1 ? "" : "s"}
          </summary>
          {warnings.map((issue, index) => (
            <div className="format-note" key={index}>
              <button type="button" onClick={() => onJumpToLine(issue.line)}>
                {issue.message} <span>Line {issue.line}</span>
              </button>
              {issue.id === "wikilink" && (
                <button
                  type="button"
                  className="note-action"
                  onClick={onDisableWikilinkWarning}
                >
                  Turn off this check
                </button>
              )}
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
