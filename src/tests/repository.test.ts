import { describe, expect, it } from 'vitest';
import { LocalFrameRepository } from '../repository';
import { EMPTY_DOCUMENT, type FrameDocument } from '../model';
import type { StorageService } from '../service';

class MemoryStorage implements StorageService {
  value: string | null = null;
  read() { return this.value; }
  write(value: string) { this.value = value; }
}

const healthyDocument = (): FrameDocument => ({
  version: 1,
  image: { src: 'data:image/svg+xml,old', width: 1200, height: 800, name: 'old.svg' },
  guides: { thirds: false, center: true, diagonal: false, golden: true },
  subject: { x: 0.25, y: 0.5 },
  crop: { id: 'current', x: 0.25, y: 0.25, width: 0.5, height: 0.5, ratio: '1:1' },
  variants: [{ id: 'variant-1', x: 0, y: 0.5, width: 0.5, height: 0.5, ratio: 'free' }],
});

describe('LocalFrameRepository', () => {
  it('reports empty storage as a fresh workbench', () => {
    const outcome = new LocalFrameRepository(new MemoryStorage()).load();
    expect(outcome.status).toBe('empty');
    expect(outcome.document).toEqual(EMPTY_DOCUMENT);
  });

  it('saves and reloads a healthy document untouched', () => {
    const storage = new MemoryStorage();
    const repository = new LocalFrameRepository(storage);
    const document = healthyDocument();
    repository.save(document);
    const outcome = repository.load();
    expect(outcome.status).toBe('clean');
    expect(outcome.notes).toEqual([]);
    expect(outcome.document).toEqual(document);
  });

  it('falls back to a usable empty document for damaged data', () => {
    const storage = new MemoryStorage();
    storage.value = '{ damaged';
    const outcome = new LocalFrameRepository(storage).load();
    expect(outcome.status).toBe('reset');
    expect(outcome.document.version).toBe(1);
    expect(outcome.document.image).toBeNull();
    expect(outcome.document.variants).toEqual([]);
  });

  it('resets when the stored structure is unrecognizable', () => {
    const storage = new MemoryStorage();
    storage.value = JSON.stringify(['not', 'a', 'document']);
    expect(new LocalFrameRepository(storage).load().status).toBe('reset');
    storage.value = JSON.stringify({ version: 2, crop: {} });
    const outcome = new LocalFrameRepository(storage).load();
    expect(outcome.status).toBe('reset');
    expect(outcome.document).toEqual(EMPTY_DOCUMENT);
  });

  it('repairs missing fields, out-of-range crops and broken variants', () => {
    const storage = new MemoryStorage();
    storage.value = JSON.stringify({
      version: 1,
      image: { src: 'data:image/svg+xml,old', width: 1200, height: 800, name: 'old.svg' },
      guides: { thirds: false },
      crop: { id: 'current', x: 4, y: -1, width: 3, height: 0, ratio: '9:9' },
      variants: [{ id: 'ok', x: 0, y: 0, width: 0.5, height: 0.5, ratio: 'free' }, 'broken', { x: 'no' }],
    });
    const outcome = new LocalFrameRepository(storage).load();
    expect(outcome.status).toBe('repaired');
    expect(outcome.document.image?.name).toBe('old.svg');
    expect(outcome.document.guides).toEqual({ thirds: false, center: false, diagonal: false, golden: false });
    expect(outcome.document.crop).toEqual({ id: 'current', x: 0, y: 0, width: 1, height: 0.12, ratio: 'free' });
    expect(outcome.document.variants).toEqual([{ id: 'ok', x: 0, y: 0, width: 0.5, height: 0.5, ratio: 'free' }]);
  });
});
