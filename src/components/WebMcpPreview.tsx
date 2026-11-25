import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { createPlan, MAX_MARKDOWN_LENGTH } from "../plan";
import { safePreview } from "../prepare";

const inputSchema = {
  type: "object",
  properties: {
    markdown: {
      type: "string",
      description: "Markdown source for the article preview.",
      minLength: 1,
      maxLength: MAX_MARKDOWN_LENGTH,
    },
    title: {
      type: "string",
      description: "Override the title inferred from frontmatter or the first H1.",
      maxLength: 2000,
    },
    format: {
      type: "string",
      description: "Table format: native Markdown or PNG image placeholders.",
      enum: ["native", "image"],
      default: "native",
    },
  },
  required: ["markdown"],
  additionalProperties: false,
};

type Tool = {
  name: string;
  description: string;
  inputSchema: typeof inputSchema;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown, context?: { signal?: AbortSignal }) => unknown;
};

type WebMcpDocument = Document & {
  modelContext?: {
    registerTool?: (tool: Tool, options: { signal: AbortSignal }) => void | Promise<void>;
  };
};

export function WebMcpPreview() {
  const [preview, setPreview] = useState<{ html: string; hasAssets: boolean }>();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const context = (document as WebMcpDocument).modelContext;
    const registerTool = context?.registerTool;
    if (typeof registerTool !== "function") return;
    const controller = new AbortController();
    const register = async () => {
      try {
        await registerTool.call(context, {
          name: "preview_x_article_markdown",
          description: "Show a temporary X Article preview and return Markdown counts and compatibility diagnostics. Article assets appear as placeholders. The editor draft is preserved.",
          inputSchema,
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute(input, invocation) {
            controller.signal.throwIfAborted();
            invocation?.signal?.throwIfAborted();
            const { markdown, title, format = "native" } =
              (input ?? {}) as Record<string, unknown>;
            if (typeof markdown !== "string" || !markdown.trim() || markdown.length > MAX_MARKDOWN_LENGTH) {
              return { error: `Supply non-empty Markdown of at most ${MAX_MARKDOWN_LENGTH} characters.` };
            }
            if (title !== undefined && (typeof title !== "string" || title.length > 2000)) {
              return { error: "Supply a title of at most 2,000 characters." };
            }
            if (format !== "native" && format !== "image") {
              return { error: 'Choose "native" or "image" for the table format.' };
            }
            try {
              const plan = createPlan(markdown, format, title);
              const hasAssets = plan.assets.length > 0 || !!plan.cover;
              const errors = plan.issues.filter(issue => issue.severity === "error");
              const warnings = plan.issues.filter(issue => issue.severity === "warning");
              const html = safePreview(plan, [], { omitAssets: true });
              const preview = document.createElement("template");
              preview.innerHTML = html;
              const { content } = preview;
              setPreview({ html, hasAssets });
              return {
                title: plan.title,
                format,
                wordCount: plan.wordCount,
                counts: {
                  paragraphs: content.querySelectorAll(".xp-p").length,
                  codeBlocks: content.querySelectorAll(".xp-md").length,
                  listItems: content.querySelectorAll("li").length,
                  ...plan.counts,
                },
                compatibility: {
                  canConvertMarkdown: errors.length === 0,
                  hints: hasAssets
                    ? ["Use the editor to check image and cover files and render diagrams or PNG tables."]
                    : [],
                  errors,
                  warnings,
                },
              };
            } catch {
              return { error: "Could not render this Markdown. Try a smaller section to isolate the issue." };
            }
          },
        }, { signal: controller.signal });
      } catch {
        // Experimental builds can expose the property while rejecting registration.
      }
    };
    void register();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (preview && element && !element.open) element.showModal();
  }, [preview]);

  if (!preview) return null;
  return (
    <dialog
      ref={dialog}
      className="wide-dialog"
      aria-labelledby="webmcp-preview-title"
      onClose={() => setPreview(undefined)}
    >
      <div className="dialog-header">
        <h2 id="webmcp-preview-title">Agent preview</h2>
        <form method="dialog">
          <button type="submit" className="dialog-close" aria-label="Close preview">
            <X size={20} aria-hidden="true" />
          </button>
        </form>
      </div>
      <div className="dialog-body">
        {preview.hasAssets && <p className="dialog-lead">Use the editor to prepare images, diagrams, and covers.</p>}
        <div className="rendered-article" dangerouslySetInnerHTML={{ __html: preview.html }} />
      </div>
    </dialog>
  );
}
