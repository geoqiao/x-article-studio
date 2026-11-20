import type { RefObject } from "react";
import {
  ArrowDownToLine,
  Bold,
  Image as ImageIcon,
  Link,
  List,
  Network,
  RefreshCw,
  Table2,
} from "lucide-react";
import { MarkdownEditor } from "../MarkdownEditor";
import { MAX_MARKDOWN_LENGTH } from "../plan";

const FENCE = String.fromCharCode(96).repeat(3);

type Props = {
  isMobile: boolean;
  hiddenOnMobile: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  markdown: string;
  booting: boolean;
  documentPath: string;
  hasDocumentHandle: boolean;
  fileChanged: boolean;
  highlightedLine?: number;
  onChangeMarkdown: (value: string) => void;
  onInsert: (before: string, after?: string, placeholder?: string) => void;
  onPickImages: () => void;
  onReloadFromFile: () => void;
  onSaveMarkdown: () => void;
  onDropFiles: (transfer: DataTransfer) => void;
  onPasteFiles: (files: FileList) => void;
};

export function SourcePanel({
  isMobile,
  hiddenOnMobile,
  textareaRef,
  markdown,
  booting,
  documentPath,
  hasDocumentHandle,
  fileChanged,
  highlightedLine,
  onChangeMarkdown,
  onInsert,
  onPickImages,
  onReloadFromFile,
  onSaveMarkdown,
  onDropFiles,
  onPasteFiles,
}: Props) {
  return (
    <section
      id="panel-write"
      className="source-panel"
      role={isMobile ? "tabpanel" : undefined}
      aria-labelledby={isMobile ? "tab-write" : undefined}
      aria-label={isMobile ? undefined : "Markdown editor"}
      hidden={isMobile && hiddenOnMobile}
    >
      <div className="panel-heading source-bar">
        <div className="format-toolbar" aria-label="Markdown formatting">
          <button
            type="button"
            onClick={() => onInsert("## ", "", "Heading")}
            title="Insert heading"
            aria-label="Insert heading"
          >
            H₂
          </button>
          <button
            type="button"
            onClick={() => onInsert("**", "**", "bold text")}
            title="Bold (⌘/Ctrl+B)"
            aria-label="Bold"
          >
            <Bold size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onInsert("[", "](https://example.com)", "link text")}
            title="Insert link"
            aria-label="Insert link"
          >
            <Link size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onInsert("\n- ", "\n", "List item")}
            title="Insert list"
            aria-label="Insert list"
          >
            <List size={16} aria-hidden="true" />
          </button>
          <span className="toolbar-divider" aria-hidden="true" />
          <button
            type="button"
            onClick={() =>
              onInsert(
                "\n\n| Column | Value |\n| --- | --- |\n| Item | Detail |\n\n",
              )
            }
            title="Insert table"
          >
            <Table2 size={15} aria-hidden="true" />
            <span className="label">Table</span>
          </button>
          <button
            type="button"
            onClick={() =>
              onInsert(
                "\n\n" +
                  FENCE +
                  "mermaid\nflowchart LR\n  A[Start] --> B[Finish]\n" +
                  FENCE +
                  "\n\n",
              )
            }
            title="Insert Mermaid diagram"
          >
            <Network size={15} aria-hidden="true" />
            <span className="label">Diagram</span>
          </button>
          <button type="button" onClick={onPickImages} title="Insert image">
            <ImageIcon size={15} aria-hidden="true" />
            <span className="label">Image</span>
          </button>
        </div>
        <span className="file-name">
          {documentPath.split("/").pop() || "Untitled.md"}
        </span>
        {hasDocumentHandle && (
          <button
            type="button"
            className={"reload-file desktop-only " + (fileChanged ? "needs-attention" : "")}
            onClick={onReloadFromFile}
            title={
              fileChanged
                ? "This file changed on disk. Reload it; your image choices stay."
                : "Re-read this file from disk; your image choices stay."
            }
            aria-label="Reload from file"
          >
            <RefreshCw size={14} aria-hidden="true" />
            <span>{fileChanged ? "Changed · Reload" : "Reload"}</span>
          </button>
        )}
        <button
          type="button"
          className="desktop-only"
          onClick={onSaveMarkdown}
          title="Download your original Markdown"
          aria-label="Save Markdown"
        >
          <ArrowDownToLine size={15} aria-hidden="true" />
        </button>
      </div>

      <MarkdownEditor
        inputRef={textareaRef}
        highlightedLine={highlightedLine}
        aria-label="Markdown source"
        value={markdown}
        disabled={booting}
        spellCheck={false}
        maxLength={MAX_MARKDOWN_LENGTH}
        placeholder={
          "Paste your Markdown here, or use File → Import Markdown.\n\nA heading is optional. Edit the title directly at the top of the preview."
        }
        onChange={(event) => onChangeMarkdown(event.target.value)}
        onKeyDown={(event) => {
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === "b"
          ) {
            event.preventDefault();
            onInsert("**", "**", "bold text");
          }
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files"))
            event.preventDefault();
        }}
        onDrop={(event) => {
          if (event.dataTransfer.files.length) {
            event.preventDefault();
            onDropFiles(event.dataTransfer);
          }
        }}
        onPaste={(event) => {
          if (event.clipboardData.files.length) {
            event.preventDefault();
            onPasteFiles(event.clipboardData.files);
          }
        }}
      />
    </section>
  );
}
