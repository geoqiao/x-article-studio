import JSZip from 'jszip';
import { safeFileStem } from './plan';
import type { SavedDraft } from './storage';
import type { Issue, LocalAssetMap } from './types';

/** A recoverable source archive, independent of conversion or image readiness. */
export async function exportDraftBackup(draft: Omit<SavedDraft, 'files'>, files: LocalAssetMap, issues: Issue[]): Promise<Blob> {
  const zip = new JSZip();
  zip.file('source.md', draft.markdown);
  const stored = new Map<File, string>();
  const mappings: [string, string][] = [];
  for (const [source, file] of files) {
    let path = stored.get(file);
    if (!path) {
      path = `attachments/${stored.size + 1}-${safeFileStem(file.name)}`;
      stored.set(file, path);
      zip.file(path, await file.arrayBuffer());
    }
    mappings.push([source, path]);
  }
  zip.file('draft-backup.json', JSON.stringify({ ...draft, files: mappings, issues }, null, 2));
  zip.file('README.txt', 'Source backup — this article is not ready for X.\nsource.md is the unchanged Markdown, including diagram source and image references.\nattachments/ contains selected local files. draft-backup.json records each original image reference and its selected file, plus title, table mode and outstanding issues.\nTo restore, import source.md and use Replace image to attach files using those mappings. Automatic ZIP restore is not supported. Remote images that were not selected locally are not included.\n');
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
