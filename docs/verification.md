# Verification record

Date: **2026-09-15** · Article Studio 0.1.0

## Executed checks

| Check | Result |
| --- | --- |
| `pnpm check` | Passed for web app and extension TypeScript configurations |
| `pnpm test` | 46 tests passed across 6 files |
| `pnpm build` | Built static app, unpacked extension, and downloadable companion ZIP |
| Served companion ZIP | HTTP 200 from the production preview |
| Web browser smoke | Revised automatic editor/clipboard workflow passed against both the production app and rebuilt HTML |
| Re-import regression | Reproduced the old-image failure before the fix; identical-file re-import, saved reload, fresh attachment hashes, image reordering, distinct articles sharing paths, delayed imports, and changed Mermaid inputs pass after the fix |
| Real unpacked extension in isolated Chromium | Page connection, staging, review, repeated staging, missing-X preflight and discard passed |
| `pnpm build:html` | Built a single HTML file with embedded scripts, CSS, fonts, renderer, and notices |
| Original standalone HTML opened from disk with Chrome offline | Passed before the UX revision; current browser tool blocks file-protocol navigation, so the revised artifact is exercised via localhost |
| Revised standalone HTML with networking disabled after loading | Example image, table, and Mermaid render automatically without asset requests |

The unit suite exercises source order, image placements, reference definitions, table representations, lossy nesting checks, portable asset rewrites, path ambiguity/traversal, URL policy, MIME recognition, bundle limits/hashes, job state transitions, and extension build artifacts. Runner tests mock the X client: all images must upload before creation, and an upload failure prevents the draft mutation.

## Browser results

The revised sample contains one ordinary image, one table, and one Mermaid diagram. Native mode produced two decoded images (1,200×560 and 1,240×140 pixels) plus one native table, without a preparation click. PNG mode automatically produced three decoded images and no HTML table. ZIP exports contain the images and Markdown.

Additional browser cases passed:

- Opening and editing automatically renders assets; the manual Prepare button is absent.
- Copy body writes actual HTML/plaintext to Chrome’s clipboard, preserving emphasis and explicit image markers without expired blob URLs. Copy title writes the title separately.
- Copy image writes a PNG to the clipboard. Pasting it into the editor inserts a Markdown reference and renders the image.
- Adding an image through the picker inserts it into the document, not just the attachment store.
- Individual images match longer Markdown paths; matching an already referenced image does not append another reference.
- Every ordinary image occurrence, including missing images and repeated sources, has direct replacement controls. Undo restores the previous file or the missing-image state without altering Markdown. Fix image opens the existing drawer at the corresponding card.
- Preview editing controls do not appear in copied article HTML.
- A selected parent folder matches referenced images while ignoring unrelated Markdown and a 21 MiB unreferenced image. Folder selection preserves the current article.
- The reported local Obsidian article was tested using its real innermost image folder: all six images rendered in order, all six SHA-256 hashes matched the source files, an earlier incorrect replacement was repaired, no extra Markdown image was appended, and the document/images survived reload. Its text and image files were not added to repository fixtures.
- Re-importing that same six-image article was also tested after deliberately replacing the Orca screenshot and persisting the wrong choice through a page reload. The new import showed no old image bytes; selecting the folder again restored all six original SHA-256 hashes in article order without changing Markdown.
- Dropping an image inserts its reference and renders it; New clears the document and shows an actionable empty state.
- Importing a `.markdown` file and inserting a diagram from the toolbar updates the preview.
- Missing images and malformed Mermaid block complete export and handoff.
- Missing-image and malformed-diagram messages have direct file-selection/source-edit actions.
- A blocked remote image produces CORS guidance and can be replaced with a local file.
- Chinese/emoji content survives an IndexedDB save and reload.
- Known nested-list content loss appears as a blocking issue.
- Switching table mode invalidates previous preparation.
- Without the companion, handoff shows installation instructions.
- At a 390-pixel viewport, document width remains 390 pixels.
- Mobile Write/Preview tabs both work.
- The installed companion receives the prepared title, Markdown, and two image thumbnails in its own extension page.
- Repeating the same handoff reuses its job/review tab.
- With no X tab open, Create X draft fails before network activity; discarding removes the staged job.

The extension test used a separate browser profile with no X login. X requests were blocked as an additional guard, and **zero X requests were observed**.

Scripts: [`browser-smoke.js`](../tests/browser-smoke.js), [`browser-reimport-smoke.js`](../tests/browser-reimport-smoke.js), and [`browser-bridge-smoke.js`](../tests/browser-bridge-smoke.js). They run through `playwright-cli`; the bridge script requires the built extension loaded in an isolated Chromium profile. Do not run the bridge script in a browser containing a real signed-in X tab.

## Screenshots

- [Desktop editor](screenshots/desktop.png)
- [Direct image replacement and undo](screenshots/image-controls.png)
- [Images and diagrams drawer](screenshots/assets.png)
- [Mobile layout](screenshots/mobile.png)
- [Companion review](screenshots/companion.png)

## Material limits

This is **not exhaustive feature coverage**. The tests cover selected cases and core workflows. They do not cover every Mermaid diagram type (the browser sample is a flowchart), every Markdown combination, all large-document limits in a real browser, every image encoding, or Firefox/Safari. Some failure/recovery branches are tested with a mock X client or pure state transitions rather than a real interrupted X request.

No live X image upload, draft creation, or publication was performed. Current account eligibility, GraphQL operation IDs, X’s response to the generated payload, final native-table behavior, and rendering in the X reading interface remain unverified. Mock client tests establish our control flow; they cannot establish compatibility with X’s current service.

The meaningful next acceptance test is a real-account draft containing multiple local/remote images, repeated images, a native table, a PNG table, and flow/sequence Mermaid diagrams. Check ordering and phone readability, plus an interrupted upload/create. This is a proposed validation step, not a completed result.
