import fs from 'node:fs';
import path from 'node:path';

// Minimal JSON persistence. It exists so the platform keeps state across restarts
// without Docker. Replace with MongoDB/HBase by implementing the same four methods.
export class JsonStore {
  constructor(file) {
    this.file = file;
    this.dir = path.dirname(file);
    fs.mkdirSync(this.dir, { recursive: true });
  }
  read() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return null; }
  }
  write(state) {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, this.file);
  }
  clear() { try { fs.unlinkSync(this.file); } catch {} }
}

// Keeps only the newest `limit` entries of an append-only list.
export function cap(list, limit) {
  if (list.length > limit) list.splice(limit, list.length - limit);
  return list;
}
