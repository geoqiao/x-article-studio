---
name: md2xarticle
description: Turn a finished Markdown article into an X (Twitter) Article draft in one step through md2xarticle.com and its Chrome companion — loads the article, attaches its local images and cover, and creates the draft in the user's signed-in X account. Use when the user asks to publish, post, upload or draft a Markdown article to X Articles.
---

# Markdown → X Article draft

The user writes the article; this skill does the rest and ends with a draft URL. It never publishes: publishing stays a manual step in X.

Requirements: `node`, `playwright-cli`, Chrome with the Playwright Extension, the [Article Studio X companion](https://chromewebstore.google.com/detail/ojpjldmiiibgjnbjfiacaoenfgpdhbbh) installed, and an X account with Articles access signed in.

## Steps

1. Check the article and generate the browser scripts:

   ```bash
   node <skill-dir>/scripts/prepare.mjs /path/to/article.md [--cover /path/to/cover.png]
   ```

   It prints JSON. Exit code 1 means `problems` is non-empty — fix each one (see below) and run it again. On success `create` and `wait` are script paths.

2. Open a tab in the user's Chrome and run the script:

   ```bash
   playwright-cli attach --extension=chrome --session=md2x-<timestamp>
   playwright-cli -s=md2x-<timestamp> run-code --filename=<create>
   ```

3. Act on the returned object:

   | Result | Meaning and next action |
   | --- | --- |
   | `ok: true` | Draft created. Give the user `draftUrl`. Pass on `message` if it mentions the cover. |
   | `stage: "awaiting-confirmation"` | The companion's review tab is open and waiting. Ask the user to click **Create X draft** there, and to tick **Create drafts without this review** so later runs need no click. Then run `<wait>` the same way. |
   | `stage: "issues"` | The article has content the converter would lose. `issues` lists them with line numbers. Fix the Markdown with the user's agreement and start again from step 1. |
   | `stage: "failed"` | Nothing was created; `message` says why. `errorCode: "X_FIREWALL_BLOCKED"` means X's firewall refused the text — in practice a command piped into a shell such as `curl … \| sh`. Reword that text with the user's agreement and start again. Sign-in problems: ask the user to sign in to X, then start again. |
   | `stage: "uncertain"` | X gave no clear answer. Do not retry. Ask the user to check x.com/compose/articles and resolve it in the companion review. |
   | `stage: "cover"` | The cover could not be prepared; `detail` says why. `cover: "unsupported-site"` means the site predates cover support. |
   | `stage: "companion-missing"` | Ask the user to install the companion and reload the page. |
   | `stage: "companion-outdated"` | Companion older than 0.1.2: it opened its review but reports nothing back and sets no cover. Ask the user to confirm there and check X. |

4. Close the tab: `playwright-cli -s=md2x-<timestamp> tab-close`.

## Images and cover

- Body images: local paths in `![alt](path)` are resolved relative to the article. Remote `https` images are fetched by the site.
- Cover, first match wins: `--cover`, frontmatter `cover: path`, a `cover.png|jpg|jpeg|webp` beside the article. With none, the draft has no cover — say so in the final report. X shows covers at about 5:2.
- Fixing `problems`: PNG, JPEG and WebP only, 5 MiB per image, 20 MiB and 40 images in total. Convert GIF/SVG and shrink large files into a temporary copy (macOS: `sips -s format png in.svg --out out.png`, `sips -Z 2400 in.png --out out.png`), and point a temporary copy of the Markdown at them. Leave the user's originals unchanged.

## Boundaries

- The session only sees the tab it opened. It cannot click the companion review or change its settings; that one-time tick is the user's.
- Images inside lists, quotes or tables, raw HTML and footnotes are reported as issues instead of being dropped.
- Do not retry a run that returned `uncertain`, and do not run `create` twice for one article without checking the first result: each run creates a separate draft.
