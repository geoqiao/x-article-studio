// File System Access API: remember the opened Markdown file and image folder so a
// later "Reload from file" needs no picker. Chromium only; other browsers keep the
// <input type="file"> flow. lib.dom lacks the pickers and permission methods.
type Permission = { queryPermission?(descriptor: { mode: 'read' }): Promise<PermissionState>; requestPermission?(descriptor: { mode: 'read' }): Promise<PermissionState> };
export type FileHandle = FileSystemFileHandle & Permission;
export type DirectoryHandle = FileSystemDirectoryHandle & Permission & { values(): AsyncIterable<FileSystemHandle> };
export type RememberedHandles = { document?: FileHandle; folder?: DirectoryHandle };
type Pickers = { showOpenFilePicker?(options: unknown): Promise<FileHandle[]>; showDirectoryPicker?(options: unknown): Promise<DirectoryHandle> };

export const MARKDOWN_FILE = /\.(md|markdown|mdown)$/i;
export const IMAGE_FILE = /\.(png|jpe?g|webp|svg)$/i;

export function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window && 'showDirectoryPicker' in window;
}

function cancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** Markdown and images chosen together, like the Import Markdown input, plus the Markdown handle. */
export async function pickFiles(): Promise<{ files: File[]; document?: FileHandle } | undefined> {
  try {
    const handles = await (window as Pickers).showOpenFilePicker!({
      multiple: true,
      id: 'article-studio-markdown',
      types: [{ description: 'Markdown and images', accept: { 'text/markdown': ['.md', '.markdown', '.mdown'], 'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/webp': ['.webp'], 'image/svg+xml': ['.svg'] } }],
    });
    return { files: await Promise.all(handles.map((handle) => handle.getFile())), document: handles.find((handle) => MARKDOWN_FILE.test(handle.name)) };
  } catch (error) {
    if (cancelled(error)) return undefined;
    throw error;
  }
}

export async function pickFolder(): Promise<DirectoryHandle | undefined> {
  try {
    return await (window as Pickers).showDirectoryPicker!({ id: 'article-studio-images', mode: 'read' });
  } catch (error) {
    if (cancelled(error)) return undefined;
    throw error;
  }
}

export async function hasPermission(handle: Permission): Promise<boolean> {
  try { return ((await handle.queryPermission?.({ mode: 'read' })) ?? 'granted') === 'granted'; } catch { return false; }
}

/** Needs a user gesture when the permission is not already granted. */
export async function ensurePermission(handle: Permission): Promise<boolean> {
  if (await hasPermission(handle)) return true;
  try { return ((await handle.requestPermission?.({ mode: 'read' })) ?? 'granted') === 'granted'; } catch { return false; }
}

/** Image files below a folder, keyed like a folder input would key them: folder name first. */
export async function readFolderImages(folder: DirectoryHandle, limit = 4000): Promise<Map<string, File>> {
  const files = new Map<string, File>();
  async function walk(directory: DirectoryHandle, prefix: string, depth: number): Promise<void> {
    if (depth > 8) return;
    for await (const entry of directory.values()) {
      if (files.size >= limit) return;
      if (entry.name.startsWith('.')) continue;
      if (entry.kind === 'directory') await walk(entry as DirectoryHandle, prefix + entry.name + '/', depth + 1);
      else if (IMAGE_FILE.test(entry.name)) files.set(prefix + entry.name, await (entry as FileHandle).getFile());
    }
  }
  await walk(folder, folder.name + '/', 0);
  return files;
}

/** Handles for dropped items. Must be called synchronously inside the drop handler. */
export function dropHandles(transfer: DataTransfer): Promise<FileSystemHandle[]> {
  type Item = DataTransferItem & { getAsFileSystemHandle?(): Promise<FileSystemHandle | null> };
  const pending = [...transfer.items].map((item) => (item as Item).kind === 'file' ? (item as Item).getAsFileSystemHandle?.() : undefined);
  return Promise.all(pending.map((promise) => promise?.catch(() => null))).then((handles) => handles.filter((handle): handle is FileSystemHandle => !!handle));
}
