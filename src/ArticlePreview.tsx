import { Fragment, useMemo, useRef } from "react";
import { ImagePlus, Undo2, Wrench } from "lucide-react";
import type { AssetSpec, Issue } from "./types";

type ReplaceButtonProps = {
  asset: AssetSpec;
  loaded: boolean;
  onReplace: (source: string, file: File) => void;
};

function PreviewReplaceButton({ asset, loaded, onReplace }: ReplaceButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className="file-action-button"
        onClick={() => inputRef.current?.click()}
      >
        <ImagePlus size={13} aria-hidden="true" />{" "}
        {loaded ? "Replace image" : "Choose image"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
        hidden
        aria-label={`Preview replace ${asset.label}`}
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
  html: string;
  assets: AssetSpec[];
  warnings: Issue[];
  hideTitle?: boolean;
  canUndo: (source: string) => boolean;
  onReplace: (source: string, file: File) => void;
  onUndo: (source: string) => void;
  onFix: (asset: AssetSpec) => void;
};

export function ArticlePreview({
  html,
  assets,
  warnings,
  hideTitle = false,
  canUndo,
  onReplace,
  onUndo,
  onFix,
}: Props) {
  const blocks = useMemo(() => {
    const template = document.createElement("template");
    template.innerHTML = html; // Only the sanitized renderer output enters this component.
    const root = template.content.querySelector(".xp-article");
    const nodes = [...(root?.childNodes || [])].filter((node) => {
      if (hideTitle && node instanceof Element && node.matches("h1.xp-title")) {
        return false;
      }
      return true;
    });
    return nodes.map((node) => {
      const holder = document.createElement("div");
      holder.append(node.cloneNode(true));
      const figure =
        node instanceof Element && node.matches("figure[data-asset-id]")
          ? node
          : null;
      return {
        html: holder.innerHTML,
        assetId: figure?.getAttribute("data-asset-id"),
        imageHtml: figure?.innerHTML,
        loaded: !!figure?.querySelector("img"),
      };
    });
  }, [html, hideTitle]);

  return (
    <div className="rendered-article">
      <article className="xp-article">
        {blocks.map((block, index) => {
          const asset = assets.find((item) => item.id === block.assetId);
          const diagramWarning = asset?.kind === "mermaid"
            ? warnings.find((issue) => issue.id === `tall-${asset.id}`)
            : undefined;
          if (!asset || asset.kind !== "image")
            return (
              <Fragment key={index}>
                {diagramWarning && (
                  <p className="diagram-preview-note">{diagramWarning.message}</p>
                )}
                <div dangerouslySetInnerHTML={{ __html: block.html }} />
              </Fragment>
            );
          return (
            <figure
              className="xp-fig editable-image"
              key={`${index}-${asset.source}`}
              data-asset-id={asset.id}
            >
              <div
                dangerouslySetInnerHTML={{ __html: block.imageHtml || "" }}
              />
              <figcaption className="preview-image-tools">
                <span title={asset.source}>{asset.label}</span>
                <div>
                  <PreviewReplaceButton
                    asset={asset}
                    loaded={block.loaded}
                    onReplace={onReplace}
                  />
                  {canUndo(asset.source) && (
                    <button
                      type="button"
                      aria-label={`Undo change to ${asset.label}`}
                      onClick={() => onUndo(asset.source)}
                    >
                      <Undo2 size={13} aria-hidden="true" /> Undo change
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Fix image ${asset.label}`}
                    onClick={() => onFix(asset)}
                  >
                    <Wrench size={13} aria-hidden="true" /> Fix image
                  </button>
                </div>
              </figcaption>
            </figure>
          );
        })}
      </article>
    </div>
  );
}
