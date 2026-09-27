import { describe, expect, it } from 'vitest';
import { LocalFrameRepository } from '../repository';
import { EMPTY_DOCUMENT } from '../model';
import { restoreDocument } from '../migration';
import type { StorageService } from '../service';

class MemoryStorage implements StorageService {
  value: string | null = null;
  read() { return this.value; }
  write(value: string) { this.value = value; }
}

describe('LocalFrameRepository', () => {
  it('saves and reloads the versioned document untouched', () => {
    const storage = new MemoryStorage();
    const repository = new LocalFrameRepository(storage);
    const document = { ...structuredClone(EMPTY_DOCUMENT), subject: { x: 0.4, y: 0.6 } };
    repository.save(document);
    const result = repository.load();
    expect(result.status).toBe('intact');
    expect(result.document.subject).toEqual({ x: 0.4, y: 0.6 });
  });

  it('falls back to a usable empty document for damaged data', () => {
    const storage = new MemoryStorage();
    storage.value = '{ damaged';
    const result = new LocalFrameRepository(storage).load();
    expect(result.status).toBe('corrupted');
    expect(result.document.version).toBe(1);
    expect(result.document.image).toBeNull();
    expect(result.document.variants).toEqual([]);
  });

  it('does not overwrite storage when the data is completely unrecognizable', () => {
    const storage = new MemoryStorage();
    storage.value = JSON.stringify({ hello: 'world', items: [1, 2, 3] });
    const original = storage.value;
    new LocalFrameRepository(storage).load();
    expect(storage.value).toBe(original);
  });

  it('repairs and immediately persists recoverable legacy data', () => {
    const storage = new MemoryStorage();
    storage.value = JSON.stringify({ version: 1, guides: { thirds: true }, crop: { x: 5, y: -2, width: 3, height: 0.01, ratio: 'free' }, variants: [] });
    const result = new LocalFrameRepository(storage).load();
    expect(result.status).toBe('repaired');
    expect(result.document.crop.x).toBe(0);
    expect(result.document.crop.y).toBe(0);
    // 修复结果已写回，下一次读取应识别为完好
    expect(restoreDocument(storage.value).status).toBe('intact');
  });
});
