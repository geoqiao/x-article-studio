import { useRef } from "react";
import { RefreshCw } from "lucide-react";
import type { TableMode } from "../types";

type Props = {
  mobileView: "write" | "preview";
  errorsCount: number;
  hasTables: boolean;
  tableMode: TableMode;
  hasDocumentHandle: boolean;
  fileChanged: boolean;
  onChangeView: (view: "write" | "preview") => void;
  onChangeTableMode: (mode: TableMode) => void;
  onReloadFromFile: () => void;
};

export function MobileTabs({
  mobileView,
  errorsCount,
  hasTables,
  tableMode,
  hasDocumentHandle,
  fileChanged,
  onChangeView,
  onChangeTableMode,
  onReloadFromFile,
}: Props) {
  const writeTabRef = useRef<HTMLButtonElement>(null);
  const previewTabRef = useRef<HTMLButtonElement>(null);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextView: "write" | "preview" =
      event.key === "Home"
        ? "write"
        : event.key === "End"
          ? "preview"
          : mobileView === "write"
            ? "preview"
            : "write";
    onChangeView(nextView);
    (nextView === "write" ? writeTabRef : previewTabRef).current?.focus();
  };

  return (
    <div className="mobile-tabs-bar">
      <div
        className="mobile-tabs"
        role="tablist"
        aria-label="Editor view"
        {...({ focusgroup: "tablist nomemory" } as Record<string, string>)}
      >
        <button
          ref={writeTabRef}
          type="button"
          id="tab-write"
          role="tab"
          aria-selected={mobileView === "write"}
          aria-controls="panel-write"
          tabIndex={mobileView === "write" ? 0 : -1}
          {...(mobileView === "write"
            ? ({ focusgroupstart: "" } as Record<string, string>)
            : {})}
          onClick={() => onChangeView("write")}
          onKeyDown={handleKeyDown}
        >
          Write
        </button>
        <button
          ref={previewTabRef}
          type="button"
          id="tab-preview"
          role="tab"
          aria-selected={mobileView === "preview"}
          aria-controls="panel-preview"
          tabIndex={mobileView === "preview" ? 0 : -1}
          {...(mobileView === "preview"
            ? ({ focusgroupstart: "" } as Record<string, string>)
            : {})}
          onClick={() => onChangeView("preview")}
          onKeyDown={handleKeyDown}
        >
          Preview
          {errorsCount > 0 && (
            <span className="tab-badge" aria-label={`${errorsCount} issues`}>
              {errorsCount}
            </span>
          )}
        </button>
      </div>

      <div className="mobile-tab-context">
        {mobileView === "preview" && hasTables && (
          <label className="mobile-tables-control">
            <span>Tables</span>
            <select
              aria-label="Table format"
              value={tableMode}
              onChange={(event) =>
                onChangeTableMode(event.target.value as TableMode)
              }
            >
              <option value="native">Native</option>
              <option value="image">PNG</option>
            </select>
          </label>
        )}
        {mobileView === "write" && hasDocumentHandle && (
          <button
            type="button"
            className={"reload-file " + (fileChanged ? "needs-attention" : "")}
            onClick={onReloadFromFile}
            aria-label="Reload from file"
          >
            <RefreshCw size={14} aria-hidden="true" />
            <span>{fileChanged ? "Reload" : "Sync"}</span>
          </button>
        )}
      </div>
    </div>
  );
}
