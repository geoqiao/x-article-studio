import { useMemo } from "react";
import { ImagePlus, Undo2, Wrench } from "lucide-react";
import type { AssetSpec } from "./types";

type Props = {
  html: string;
  assets: AssetSpec[];
  canUndo: (source: string) => boolean;
  onReplace: (source: string, file: File) => void;
  onUndo: (source: string) => void;
  onFix: (asset: AssetSpec) => void;
};

export function ArticlePreview({
  html,
  assets,
  canUndo,
  onReplace,
  onUndo,
  onFix,
}: Props) {
  const blocks = useMemo(() => {
    const template = document.createElement("template");
    template.innerHTML = html; // Only the sanitized renderer output enters this component.
    const root = template.content.querySelector(".xp-article");
    return [...(root?.childNodes || [])].map((node) => {
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
  }, [html]);

  return (
    <div className="rendered-article">
      <article className="xp-article">
        {blocks.map((block, index) => {
          const asset = assets.find((item) => item.id === block.assetId);
          if (!asset || asset.kind !== "image")
            return (
              <div
                key={index}
                dangerouslySetInnerHTML={{ __html: block.html }}
              />
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
                  <label
                    className="file-button"
                    tabIndex={0}
                    role="button"
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.currentTarget.querySelector("input")?.click();
                      }
                    }}
                  >
                    <ImagePlus size={13} />{" "}
                    {block.loaded ? "Replace image" : "Choose image"}
                    <input
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
                  </label>
                  {canUndo(asset.source) && (
                    <button
                      aria-label={`Undo change to ${asset.label}`}
                      onClick={() => onUndo(asset.source)}
                    >
                      <Undo2 size={13} /> Undo change
                    </button>
                  )}
                  <button
                    aria-label={`Fix image ${asset.label}`}
                    onClick={() => onFix(asset)}
                  >
                    <Wrench size={13} /> Fix image
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
