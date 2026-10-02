# Markdown → X Article compatibility

Updated: **2026-10-01**. Scope: Article Studio web editor using `@kaitox/x-article@0.6.0`. “Native” describes the generated X representation, not a successful live-account test.

## The three priorities

| Input | Solution implemented | What is preserved | Remaining boundary |
| --- | --- | --- | --- |
| Local images | Resolve attached files → verify/decode bytes → upload through companion → map source to media ID | Document placement; repeated references reuse one uploaded source within the job | User must grant file access once. Body PNG/JPEG/WebP only; ALT and covers are separate work |
| Remote images | Fetch public bytes in the browser → same pipeline | Placement and original pixels | Host must permit CORS; redirects, private hosts, login-only files, and fetch failures require local replacement |
| Markdown tables | Store the pipe table in an X `MARKDOWN` entity | Table structure, text and Markdown links; native X rendering | Exact appearance and editing affordances are controlled by X and need a live check |
| Tables as PNG | Render canvas locally → same image pipeline | A fixed, readable layout for ordinary text cells | Cell semantics, selectable text, inline formatting and live links are lost; column alignment syntax is not reproduced by this PNG renderer |
| Mermaid | Render standalone fence with Mermaid → normalize SVG labels → white 2× PNG, capped at 1,600 px wide → same image pipeline | Diagram appearance within the renderer’s supported syntax | Static bitmap only; label fidelity and phone readability must be reviewed; malformed/nested fences are blocked |

No manual screenshots are needed for supported tables or Mermaid. Automatic placement requires the companion or a future official-API adapter; exporting a ZIP alone does not insert media into X.

## Complete matrix

| Markdown feature | This version | Result / loss |
| --- | --- | --- |
| Paragraphs, line breaks | Native | Text in article blocks; spacing controlled by X |
| `**bold**`, `*italic*`, `~~strike~~` | Native | Inline formatting ranges |
| Title / first H1 | Native | H1 optional. Visible title field overrides metadata → H1 → filename → Untitled article; first H1 is removed from body |
| H2 and H3 | Native | Two body heading levels |
| H4–H6 / extra H1 | Limited, warning | Depth clamped / extra H1 remains a body heading |
| Absolute HTTP(S), mailto links | Native | Link entities; reference definitions preserved |
| Relative webpage links | Blocked | Convert to absolute URLs first |
| Single-level ordered/unordered lists | Native | One paragraph per item; exact numbering controlled by X |
| Multiple paragraphs or other blocks inside list items | Blocked | Move code/quotes/headings out of lists and split paragraphs to prevent content loss |
| Nested lists | Explicit conversion | Convert to one level retains all simple nested items and inline syntax; complex blocks remain blocked for manual editing |
| Task lists | Limited, warning | Ordinary bullets; checked state is lost |
| Blockquotes | Native for simple text | Complex nested content can lose structure; move tables/images/diagrams out |
| Horizontal rules | Native | Divider entity |
| Fenced code | Native | Markdown code entity; language source retained, highlighting unverified |
| Inline code outside tables | Limited, warning | Text retained, monospace styling lost |
| Inline code inside native tables | Native source | Kept as part of table Markdown; rendering controlled by X |
| Standalone X status URL | Native post entity | Must be the only content in its paragraph; deleted/private posts may not display |
| Standalone images or images mixed into a normal paragraph | Converted to media blocks | Paragraph is split around media, preserving order |
| Images inside lists, headings, quotes, links, emphasis, or tables | Blocked | Move into standalone paragraphs |
| Repeated image source | Supported | One prepared asset/upload per source, each placement retained; different source paths are not deduplicated by bytes |
| HTML `<br>` and comments | Normalized | Breaks become Markdown breaks outside tables; comments are omitted; source and code examples are unchanged |
| Other raw HTML | Blocked | Rewrite as Markdown to prevent dropped content |
| Footnotes | Blocked | Rewrite as links/endnotes |
| LaTeX / math fences / display formulas | Warning | Source is retained as text/code; use an image for rendered notation. Official X API supports LaTeX; this adapter does not map it |
| Single-dollar inline formulas | Plain text | Not interpreted as math; manually convert if intended as a formula |
| GIF, SVG, video | Not implemented | Convert to supported body image types, or add separately in X |
| Cover (frontmatter `cover:` or chosen under Images) | Uploaded and set after creation | Companion 0.1.2+. PNG/JPEG/WebP; a cover X refuses leaves the draft in place with a warning |
| Markdown image ALT labels | Source only | Kept in source/export; not set as X accessibility descriptions |
| Custom CSS/layout, interactive Mermaid | Cannot transfer arbitrary behavior | X controls its renderer; exported PNGs cannot execute scripts |

Known unsupported constructs block handoff instead of silently discarding content. This does not establish losslessness for every possible CommonMark nesting combination. Representative documents must still be reviewed.

## Native tables are supported by the documented storage model

The official draft schema states:

> There is no separate table entity type in article storage; tables are markdown.

> Tables are not a separate enum value — use type markdown with a pipe table in data.markdown.

Kaitox uses the private editor equivalent: an atomic block pointing to a `MARKDOWN` entity with `data.markdown`. Its enum casing, mutability spelling, and media categories differ from the official REST schema. They must be adapted if an official API route is added.

The official schema also documents `latex`, with TeX stored in the block’s text. Therefore “X cannot support formulas” would be an incorrect conclusion from this prototype’s missing formula renderer.

## Evidence and confidence

1. [Official X draft schema](https://docs.x.com/x-api/articles/create-draft-article.md), retrieved 2026-09-15: native Markdown tables, code, image entities, LaTeX, and weighted Markdown limits. This is platform documentation, not account eligibility evidence.
2. [Kaitox mapping guide](https://github.com/kuangjiajia/kaitox-toolkit/blob/add87b9237ee9d77e1f757515e120e3db9c96452/docs/Features/x-article-markdown-mapping.zh-CN.md), inspected 2026-09-15.
3. [Kaitox content-state converter](https://github.com/kuangjiajia/kaitox-toolkit/blob/add87b9237ee9d77e1f757515e120e3db9c96452/packages/x-article/src/contentState.ts), inspected 2026-09-15; npm 0.6.0 converter was also exercised by local tests.
4. [Kaitox Mermaid renderer](https://github.com/kuangjiajia/kaitox-toolkit/blob/add87b9237ee9d77e1f757515e120e3db9c96452/packages/x-article/src/mermaidRender.ts), inspected 2026-09-15; actual PNG pixels verified in Chromium.
5. [MD2X README at the inspected revision](https://github.com/echoVic/x-article-md/blob/81e42e2d86d0e4aef7c855946bb7536e2c42cda7/README.md), retrieved 2026-09-13: separate asset insertion from its X Assets panel. Its [image renderer](https://github.com/echoVic/x-article-md/blob/81e42e2d86d0e4aef7c855946bb7536e2c42cda7/lib/image-copy.ts) already generates table/Mermaid PNGs; copying them remains separate from uploading media to X.

Update 2026-10-01: the owner confirmed draft creation in a real X account. Articles entitlement for other accounts, native table rendering, the long-term stability of X's private query IDs, and published/mobile X output have not been separately documented.
