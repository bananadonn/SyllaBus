/**
 * Keeps the uploaded syllabus file in the browser (IndexedDB) so the preview survives the Google
 * sign-in redirect. Everything is best-effort: private windows or blocked storage just mean the
 * preview falls back to the extracted text.
 */
const DB = "syllabus";
const STORE = "files";
const KEY = "current";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  try {
    const db = await open();
    return await new Promise<T | null>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error);
    }).finally(() => db.close());
  } catch {
    return null;
  }
}

export const saveFile = (file: File) => run("readwrite", (s) => s.put(file, KEY));
export const clearFile = () => run("readwrite", (s) => s.delete(KEY));
export async function loadFile(): Promise<File | null> {
  const v = await run<File>("readonly", (s) => s.get(KEY));
  return v instanceof Blob ? (v as File) : null;
}
