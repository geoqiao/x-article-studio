import { ArrowDown, Check, LoaderCircle } from "lucide-react";
import type { ArticlePlan } from "../types";

type Props = {
  plan: ArticlePlan;
  charCount: number;
  booting: boolean;
  saving: string;
  updating: boolean;
  hasContent: boolean;
  hasBlockingErrors: boolean;
  standalone: boolean;
};

export function StatusBar({
  plan,
  charCount,
  booting,
  saving,
  updating,
  hasContent,
  hasBlockingErrors,
  standalone,
}: Props) {
  return (
    <footer className="status-bar">
      <div className="status-left">
        <span className="status-metrics">
          {plan.wordCount.toLocaleString()} words
          <span className="desktop-only">
            {" "}
            · {charCount.toLocaleString()} chars
          </span>
        </span>
        {plan.frontmatter && (
          <span
            className="frontmatter-note desktop-only"
            title="YAML frontmatter is never sent to X"
          >
            · Frontmatter:{" "}
            {plan.frontmatter.used.length
              ? "used " + plan.frontmatter.used.join(", ")
              : "ignored"}
          </span>
        )}
      </div>

      <div className="status-center">
        <span className="preview-state" role="status">
          {updating ? (
            <>
              <LoaderCircle size={13} className="spin" aria-hidden="true" />
              <span>Updating preview…</span>
            </>
          ) : !hasContent ? (
            <span>Paste Markdown to start</span>
          ) : hasBlockingErrors ? (
            <span>Resolve highlighted items</span>
          ) : (
            <>
              <Check size={13} aria-hidden="true" />
              <span>Preview up to date</span>
            </>
          )}
        </span>
        <span className="status-sep" aria-hidden="true">
          ·
        </span>
        <span className="save-status">{booting ? "Opening…" : saving}</span>
      </div>

      <div className="status-right">
        {standalone ? (
          <span className="desktop-only">Works offline</span>
        ) : (
          <>
            <a href="/privacy" className="desktop-only">
              Privacy
            </a>
            <a href="#product-guide" className="how-it-works-link">
              <span>How it works</span>
              <ArrowDown size={12} aria-hidden="true" />
            </a>
          </>
        )}
      </div>
    </footer>
  );
}
