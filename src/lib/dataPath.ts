import path from "path";

/** Resolve bundled reference/data files (standalone repo: `backend/data/`). */
export function dataDir(): string {
  return process.env.DATA_DIR ?? path.join(process.cwd(), "data");
}

export function dataFilePath(filename: string): string {
  return path.join(dataDir(), filename);
}
