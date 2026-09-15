export type FormatSupport = { syntax: string; status: 'Native' | 'Converted' | 'Limited' | 'Not implemented'; result: string; note: string };

export const FORMATS: FormatSupport[] = [
  { syntax: 'PNG / JPEG / WebP images', status: 'Converted', result: 'Uploaded as native X media', note: 'Attach a folder once, or replace an individual source. Up to 5 MiB per image and 20 MiB total in this version. Missing images block the handoff.' },
  { syntax: 'Remote image URLs', status: 'Limited', result: 'Downloaded, then uploaded', note: 'Public servers must allow browser downloads (CORS). For blocked, redirected, or private URLs, download and attach the file. No login cookies are sent to image hosts.' },
  { syntax: 'Markdown tables', status: 'Native', result: 'Native Markdown table block', note: 'Keeps the table source. Plain HTML copy/paste does not guarantee this result: the bridge inserts an X Markdown entity.' },
  { syntax: 'Tables as PNG', status: 'Converted', result: 'Rendered and uploaded automatically', note: 'Optional consistent image layout. Text, links, and cells stop being selectable in X. Wide/long tables need splitting.' },
  { syntax: 'Mermaid diagrams', status: 'Converted', result: 'SVG → PNG → native X media', note: 'Standalone Mermaid fences render locally. The result in X is static. Nested fences and syntax errors block preparation.' },
  { syntax: 'Paragraphs, bold, italic, strikethrough', status: 'Native', result: 'Native text and formatting', note: 'The preview uses the same Kaitox content conversion as the bridge. X still controls typography and spacing.' },
  { syntax: 'H1, H2, H3 headings', status: 'Native', result: 'Title + two body heading levels', note: 'First H1 becomes the title. H2 and H3 map to the two heading levels used by this private-editor adapter.' },
  { syntax: 'H4–H6 and extra H1s', status: 'Limited', result: 'Heading depth is reduced', note: 'H4–H6 become H3-style subheadings. Extra H1s become body headings. This is the bridge’s mapping, not a universal API restriction.' },
  { syntax: 'Links and single-level lists', status: 'Native', result: 'Links, bullets, and numbering', note: 'Reference-style links resolve. Relative webpage links need absolute URLs. X controls list numbering.' },
  { syntax: 'Quotes and horizontal rules', status: 'Native', result: 'Quote blocks and dividers', note: 'Complex content nested inside quotes may need to be moved into standalone blocks.' },
  { syntax: 'Fenced code', status: 'Native', result: 'Native Markdown code block', note: 'Text is preserved. Syntax highlighting is not guaranteed by the X adapter. Code and native tables share a 10,000-character preflight budget.' },
  { syntax: 'Inline code and task checkboxes', status: 'Limited', result: 'Plain text / ordinary bullets', note: 'Inline code loses monospace styling. Task checkboxes are not interactive and lose their checked state.' },
  { syntax: 'Standalone X post URLs', status: 'Native', result: 'Embedded X post', note: 'A post URL must occupy its own paragraph. Preview uses a link card; actual visibility depends on X.' },
  { syntax: 'Nested lists, HTML, footnotes', status: 'Not implemented', result: 'Blocked before handoff', note: 'Rewrite these constructs first. This prevents known content loss in the underlying converter.' },
  { syntax: 'LaTeX / mathematical notation', status: 'Not implemented', result: 'No formula renderer in this version', note: 'X’s official API documents a LaTeX entity; this companion bridge does not implement it. Inline dollar-delimited formulas are not interpreted.' },
  { syntax: 'GIF, SVG, video, cover, and image ALT', status: 'Not implemented', result: 'Set these separately in X', note: 'This MVP handles body PNG/JPEG/WebP. Markdown image labels stay in source/export but are not set as X accessibility descriptions.' },
  { syntax: 'Custom HTML/CSS and interactive diagrams', status: 'Not implemented', result: 'Cannot preserve arbitrary behavior', note: 'An X Article cannot execute this web app’s scripts or carry an arbitrary webpage layout. Mermaid exports are images.' },
];
