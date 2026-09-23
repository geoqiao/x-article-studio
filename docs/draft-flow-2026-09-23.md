# Draft-flow UX audit

Date: **2026-09-23**. Scope: web editor, preflight, companion staging, and existing review/recovery behavior. The converter remains `@kaitox/x-article@0.6.0`.

## Decisions

| Condition | Creation decision | Guidance / recovery |
| --- | --- | --- |
| No H1 or metadata title | Allow | Visible editable title; automatic precedence is metadata → first H1 → filename → Untitled article |
| Invalid title / empty article body | Block | Edit title directly, or add body text/media; title-only content is not a complete article |
| Simple nested lists | Block until explicit conversion | Convert to one level preserves every item and inline syntax; review the changed source/preview |
| Nested lists containing complex blocks, multiple paragraphs per item | Block | Move blocks out / split paragraphs so Kaitox cannot silently drop or join them |
| HTML breaks and comments | Allow after internal normalization | Preserve breaks outside tables; omit comments; keep original source and literal code unchanged |
| Other HTML, footnotes, nested media or unsupported placement | Block | Explain the content loss and link to the affected source block; duplicate image-placement diagnostics suppressed |
| Formulas, inline code, checkbox state, deep headings, covers | Warn | Text/code is retained; explain formatting loss or required action in X without blocking the whole article |
| Local image missing / ambiguous / wrong format | Block handoff | File or folder selection, or replacement at the specific image card; keep copying and source backups available |
| Remote image network/CORS/login/timeout failure | Block handoff | Retry or attach a local replacement; do not label it a missing local file |
| Invalid Mermaid or oversized PNG table | Block handoff | Short diagram syntax message with diagram-local line where available; jump to its source block, or use native tables / split the table |
| App limits: source, image count/bytes/dimensions, native code/table budget | Block handoff | State the limit and an action: split, resize, remove, or switch table mode. Title/native-budget/asset-count errors do not block body copying |
| Preparation pending | Wait for current assets | Show updating status. Cache successful asset bytes across text/title edits; replacing an image or editing diagram/table inputs invalidates that asset |
| Companion absent / wrong origin / standalone HTML | Show connection guide | Install or enable the companion in the same browser profile, refresh the production page; standalone offers the full app |
| Companion request failure | Report failure | Connection guide covers installation; staged job identity and checksum validation remain enforced |
| X not signed in, tab closed, load timeout, upload failure | Keep existing review recovery | Companion messages identify sign-in, reopening, retry, or the failed image. Every upload must succeed before creation |
| Duplicate click / interrupted or ambiguous create result | Keep existing job guard | A claimed job cannot run twice; check X before explicitly allowing another create attempt |

H1 is a Markdown convention, not an X draft requirement. The [official draft schema](https://docs.x.com/x-api/articles/create-draft-article.md), retrieved 2026-09-23, requires a nonempty separate title. The current private adapter also accepts title independently of Markdown.

## Error presentation

All blockers are listed together with a short reason and an action. The issue count beside the disabled draft button opens this panel, including on mobile. Source links select the affected block and highlight its logical line number. The gutter measures wrapped lines, follows scrolling, and updates after font loading and resizing. Reported locations refer to original source lines despite frontmatter removal and HTML normalization; nested constructs currently point to the enclosing source block.

Copying text, copying a title, backing up source, and creating a complete draft use separate readiness rules. Unprepared media becomes a labeled clipboard marker. A source-backup ZIP preserves original Markdown, chosen local files, reference mappings and diagnostics. It is explicitly distinct from a complete article bundle; it excludes unselected remote files and does not claim automatic ZIP restore.

## Validation

- TypeScript checks and 78 unit/integration tests pass, including converter output, source-line mapping, list preservation, safe HTML normalization, title fallback, cache invalidation, download timeout guidance, and backup contents.
- `tests/browser-draft-flow.js`: isolated Chrome, mocked companion handoff, no H1, imported filename, visible title editing, flattening with full content retention, missing/remote media, clipboard markers, source backup, multiple errors, wrapped gutter alignment, source selection, and mobile navigation.
- Existing `tests/browser-smoke.js`: images, replacement/undo, folder matching, paste, tables, Mermaid, import/persistence, exports, help and connection guide.
- Existing `tests/browser-clipboard-smoke.js`: actual HTML/plaintext clipboard, native paste, denied/unavailable API fallback, manual selection copy, and separate title copy.
- Production build passes. No real X draft was created by these tests; account entitlement, current private X endpoints, and live X rendering remain unverified.
