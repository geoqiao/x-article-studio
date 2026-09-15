# MD2X workflow review

Date: 2026-09-15. Trigger: the user could not understand the initial Article Studio interface and asked us to inspect MD2X.

Inspected the live [MD2X editor](https://markdown2x.com/editor), its landing page, formatting toolbar, and Assets & Media drawer in an isolated Chrome browser. This was a UI review, not a live X-publishing test.

## Observed MD2X behavior

- The editor opens directly into two full-height panes: Markdown and Live Preview.
- Copy Body is the visible primary action in the top toolbar.
- Tables and Mermaid appear as the document renders; users do not need a separate preparation step.
- Import, export, and an asset drawer are available beside the editor.
- Formatting controls insert tables, diagrams, and common Markdown syntax.

The previous Article Studio put a large introduction above the editor, hid image actions in a tab, placed the output actions below the editor, and required an unfamiliar Prepare → Handoff workflow. Passing conversion tests did not demonstrate that this was understandable.

## Changes implemented

- Open directly into the editor; remove the landing-page hero, feature strip, and technical preview banner.
- Render automatically; preserve editor focus and reject stale preparation results.
- Keep Copy title, Copy body, and Create X draft visible at the top.
- Give Images a labeled drawer with Add images, Choose folder, Copy image, and Download actions.
- Insert picked, pasted, or dropped images into the Markdown document.
- Add table/diagram insertion and direct actions for missing files and broken diagram syntax.
- Put detailed instructions and implementation limitations behind How to use and Format support.
- Retain the companion path for automatic image placement; manual rich-text copying explicitly marks where images must be inserted.

## Follow-up: local images and corrections

The user's Obsidian article exposed two problems: importing Markdown did not explain the separate file-selection requirement, and selecting a file or inner image folder failed to match longer Markdown paths. After an incorrect replacement, the preview also provided no direct correction action.

The editor now offers Match image folder beside missing-image feedback, explains local-file access, matches filename/directory suffixes, and imports only referenced images from folders. Each ordinary preview image has a direct picker and an Undo change action after replacement. Fix image remains available and opens the matching drawer card. The reported article's six images were verified against their original file hashes.

The browser checks verify these interactions. Whether this version is clear enough for the user still requires their review; no usability-study success is claimed.
