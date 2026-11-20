import { useRef } from "react";
import {
  ArrowDownToLine,
  Copy,
  FolderOpen,
  Image as ImageIcon,
  Network,
  Table2,
  Undo2,
} from "lucide-react";
import { COVER_KEY, downloadBlob } from "../files";
import { copyImage } from "../clipboard";
import type {
  ArticlePlan,
  AssetProgress,
  AssetSpec,
  PreparedAsset,
  TableMode,
} from "../types";

type AssetReplaceButtonProps = {
  asset: AssetSpec;
  hasError: boolean;
  onReplace: (source: string, file: File) => void;
};

function AssetReplaceButton({
  asset,
  hasError,
  onReplace,
}: AssetReplaceButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className="file-action-button"
        onClick={() => inputRef.current?.click()}
      >
        {hasError ? "Choose file" : "Replace image"}
      </button>
      <input
        ref={inputRef}
        aria-label={"Replace " + asset.label}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onReplace(asset.source, file);
          event.target.value = "";
        }}
      />
    </>
  );
}

type Props = {
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

export function ImagesDrawer({
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
  return (
    <>
      <p className="dialog-lead">
        Add your images here. Tables and Mermaid diagrams are generated
        automatically.
      </p>
      {plan.counts.images > 0 && (
        <div className="folder-guidance">
          <strong>Importing from Obsidian or another local editor?</strong>
          <p>
            The .md file contains image paths. Your browser needs you to select
            the image folder separately. Choose that folder or a parent folder;
            only images referenced by this article are attached. Import Markdown
            also accepts the .md file and its images selected together.
            {fileSystemAccess &&
              " This browser remembers the folder, so the next article from the same place matches automatically."}
          </p>
          <span>
            Example path:{" "}
            <code>
              {plan.assets.find((asset) => asset.kind === "image")?.source}
            </code>
          </span>
        </div>
      )}
      <div
        className="image-dropzone"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          onImportDropped(event.dataTransfer.files);
        }}
      >
        <ImageIcon size={24} aria-hidden="true" />
        <strong>Drop images here</strong>
        <span>PNG, JPEG, WebP, SVG · larger than 5 MiB is downscaled</span>
        <div>
          <button
            type="button"
            className="button-primary"
            onClick={onPickImages}
          >
            Add images
          </button>
          <button
            type="button"
            className="button-outline"
            onClick={onMatchFolder}
          >
            <FolderOpen size={15} aria-hidden="true" />{" "}
            {folderName
              ? `Match image folder (last: ${folderName})`
              : "Match image folder"}
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
              <ImageIcon size={24} aria-hidden="true" />
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
          <button type="button" onClick={onPickCover}>
            {coverSource ? "Replace cover" : "Choose cover"}
          </button>
          {hasCustomCover && (
            <button type="button" onClick={onRemoveCover}>
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
              "asset-card " + (state?.state === "error" ? "has-error" : "")
            }
            key={asset.id}
            id={"asset-" + asset.id}
          >
            <div className="asset-top">
              <div className="asset-thumbnail">
                {done ? (
                  <img src={done.url} alt={asset.label} />
                ) : asset.kind === "mermaid" ? (
                  <Network size={24} aria-hidden="true" />
                ) : asset.kind === "table" ? (
                  <Table2 size={24} aria-hidden="true" />
                ) : (
                  <ImageIcon size={24} aria-hidden="true" />
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
                <AssetReplaceButton
                  asset={asset}
                  hasError={state?.state === "error"}
                  onReplace={onReplaceImage}
                />
              )}
              {canUndoImage(asset.source) && (
                <button
                  type="button"
                  aria-label={"Undo change to " + asset.label}
                  onClick={() => onUndoImage(asset.source)}
                >
                  <Undo2 size={13} aria-hidden="true" /> Undo change
                </button>
              )}
              {asset.kind !== "image" && state?.state === "error" && (
                <button type="button" onClick={() => onJumpToLine(asset.line)}>
                  Edit source · line {asset.line}
                </button>
              )}
              {valid && (
                <>
                  <button
                    type="button"
                    aria-label={"Copy " + asset.label}
                    onClick={async () => {
                      try {
                        await copyImage(done.blob);
                        onNotify("Image copied. Paste it into X.");
                      } catch {
                        onNotify(
                          "Image copying is unavailable. Use Download instead.",
                        );
                      }
                    }}
                  >
                    <Copy size={13} aria-hidden="true" /> Copy image
                  </button>
                  <button
                    type="button"
                    aria-label={"Download " + asset.label}
                    onClick={() => downloadBlob(done.blob, done.fileName)}
                  >
                    <ArrowDownToLine size={13} aria-hidden="true" /> Download
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}

      {!plan.assets.length && (
        <p className="empty-assets">
          No images yet. Use Add images, or insert a Mermaid diagram from the
          editor toolbar.
        </p>
      )}
      {plan.counts.tables > 0 && tableMode === "native" && (
        <p className="inline-note">
          {plan.counts.tables} native table
          {plan.counts.tables === 1 ? "" : "s"} kept in the article. Choose “PNG
          images” in the preview bar if you want downloadable table images.
        </p>
      )}
      <div className="dialog-actions">
        <button
          type="button"
          className="button-primary"
          onClick={onExportZip}
          disabled={!canExport}
        >
          <ArrowDownToLine size={15} aria-hidden="true" /> Download all (.zip)
        </button>
        <button
          type="button"
          className="button-outline"
          onClick={onRetryRender}
          disabled={busy}
        >
          Retry rendering
        </button>
      </div>
    </>
  );
}
