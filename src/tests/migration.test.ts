import { describe, expect, it } from 'vitest';
import { isFrameDocument, isRecognizableDocument, repairDocument, restoreDocument } from '../migration';
import { EMPTY_DOCUMENT } from '../model';

const validDocument = {
  version: 1,
  image: { src: 'data:image/svg+xml,x', width: 1200, height: 800, name: 'ok.svg' },
  guides: { thirds: true, center: false, diagonal: false, golden: false },
  subject: { x: 0.4, y: 0.6 },
  crop: { id: 'current', x: 0.1, y: 0.1, width: 0.5, height: 0.5, ratio: 'free' },
  variants: [{ id: 'v1', x: 0.2, y: 0.2, width: 0.4, height: 0.4, ratio: '1:1' }],
};

describe('restoreDocument', () => {
  it('returns an intact empty document when there is no stored data', () => {
    expect(restoreDocument(null).status).toBe('intact');
    expect(restoreDocument('').document).toEqual(EMPTY_DOCUMENT);
  });

  it('keeps well-formed version-1 data exactly as saved', () => {
    const result = restoreDocument(JSON.stringify(validDocument));
    expect(result.status).toBe('intact');
    expect(result.issues).toEqual([]);
    expect(result.document).toEqual(validDocument);
    expect(result.quarantined).toEqual([]);
  });

  it('does not misjudge old-version valid data with fewer optional fields as damaged', () => {
    const legacy = {
      version: 1,
      image: null,
      guides: { thirds: false, center: false, diagonal: false, golden: false },
      subject: null,
      crop: { id: 'current', x: 0, y: 0, width: 1, height: 1, ratio: 'free' },
      variants: [],
    };
    expect(restoreDocument(JSON.stringify(legacy)).status).toBe('intact');
  });

  it('parses malformed JSON as corrupted', () => {
    expect(restoreDocument('{broken').status).toBe('corrupted');
  });

  it.each([
    ['array', [1, 2, 3]],
    ['string', 'hello'],
    ['number', 42],
    ['null', null],
    ['unrelated object', { foo: 'bar' }],
  ])('treats %s as unrecognizable and keeps bad data out of editing state', (_label, value) => {
    const result = restoreDocument(JSON.stringify(value));
    expect(result.status).toBe('corrupted');
    expect(result.document).toEqual(EMPTY_DOCUMENT);
  });
});

describe('repairDocument', () => {
  it('fills missing top-level fields with defaults', () => {
    const result = repairDocument({ version: 1 });
    expect(result.status).toBe('repaired');
    expect(result.document.guides).toEqual(EMPTY_DOCUMENT.guides);
    expect(result.document.crop).toEqual(EMPTY_DOCUMENT.crop);
    expect(result.document.variants).toEqual([]);
    expect(result.document.subject).toBeNull();
    expect(result.document.image).toBeNull();
    expect(result.issues).toContain('crop');
    expect(result.issues).toContain('guides');
    expect(result.issues).toContain('variants');
  });

  it('recognizes legacy objects without a version marker when known fields exist', () => {
    expect(isRecognizableDocument({ variants: [] })).toBe(true);
    const result = repairDocument({ variants: [] });
    expect(result.status).toBe('repaired');
    expect(result.issues).toContain('version');
    expect(result.document.version).toBe(1);
  });

  it('clamps crop geometry back into the usable region', () => {
    const result = repairDocument({
      version: 1,
      guides: { thirds: true, center: false, diagonal: false, golden: false },
      crop: { id: 'current', x: 0.9, y: 0.9, width: 0.8, height: 0.8, ratio: 'free' },
      variants: [],
    });
    const { crop } = result.document;
    expect(crop.width).toBe(0.8);
    expect(crop.height).toBe(0.8);
    expect(crop.x).toBeCloseTo(0.2);
    expect(crop.y).toBeCloseTo(0.2);
  });

  it('enforces the minimum crop size and recovers non-finite numbers', () => {
    const result = repairDocument({
      version: 1,
      guides: { thirds: true, center: false, diagonal: false, golden: false },
      crop: { id: 'current', x: NaN, y: 0, width: 0.01, height: Infinity, ratio: 'free' },
      variants: [],
    });
    const { crop } = result.document;
    expect(crop.x).toBe(0);
    expect(crop.width).toBe(0.12);
    expect(crop.height).toBe(1);
    expect(Number.isFinite(crop.y)).toBe(true);
  });

  it('repairs an unknown ratio back to free', () => {
    const result = repairDocument({
      version: 1,
      guides: { thirds: true, center: false, diagonal: false, golden: false },
      crop: { id: 'current', x: 0, y: 0, width: 1, height: 1, ratio: '21:9' },
      variants: [],
    });
    expect(result.document.crop.ratio).toBe('free');
  });

  it('fills missing guide switches with defaults instead of crashing the counter', () => {
    const result = repairDocument({
      version: 1,
      guides: { thirds: true },
      crop: { id: 'current', x: 0, y: 0, width: 1, height: 1, ratio: 'free' },
      variants: [],
    });
    expect(result.document.guides).toEqual({ thirds: true, center: false, diagonal: false, golden: false });
    expect(Object.values(result.document.guides).filter(Boolean)).toHaveLength(1);
    expect(result.issues).toContain('guides');
  });

  it('ignores non-boolean guide values and falls back to defaults', () => {
    const result = repairDocument({
      version: 1,
      guides: { thirds: 'yes', center: 1, diagonal: null, golden: {} },
      crop: { id: 'current', x: 0, y: 0, width: 1, height: 1, ratio: 'free' },
      variants: [],
    });
    expect(result.document.guides).toEqual({ thirds: true, center: false, diagonal: false, golden: false });
  });

  it('drops an unusable image but keeps the rest of the document', () => {
    const result = repairDocument({
      version: 1,
      image: { src: '', width: 100, height: 100 },
      guides: { thirds: true, center: false, diagonal: false, golden: false },
      crop: { id: 'current', x: 0, y: 0, width: 1, height: 1, ratio: 'free' },
      variants: [],
    });
    expect(result.document.image).toBeNull();
    expect(result.issues).toContain('image');
  });

  it('clamps a subject marker back into the image', () => {
    const result = repairDocument({
      version: 1,
      guides: { thirds: true, center: false, diagonal: false, golden: false },
      crop: { id: 'current', x: 0, y: 0, width: 1, height: 1, ratio: 'free' },
      variants: [],
      subject: { x: 3, y: -2 },
    });
    expect(result.document.subject).toEqual({ x: 1, y: 0 });
  });

  it('quarantines unrecognizable variant entries individually and salvages the rest', () => {
    const result = repairDocument({
      version: 1,
      guides: { thirds: true, center: false, diagonal: false, golden: false },
      crop: { id: 'current', x: 0, y: 0, width: 1, height: 1, ratio: 'free' },
      variants: [
        { junk: true },
        null,
        42,
        { id: 'ok', x: 0, y: 0, width: 0.5, height: 0.5, ratio: '1:1' },
        { x: 2, y: 2, width: -1, height: 0.5, ratio: 'free' },
      ],
    });
    expect(result.document.variants).toHaveLength(2);
    expect(result.document.variants[0].id).toBe('ok');
    const clamped = result.document.variants[1];
    expect(clamped.x).toBeCloseTo(0.88);
    expect(clamped.y).toBe(0.5);
    expect(clamped.width).toBe(0.12);
    expect(result.quarantined).toHaveLength(3);
    expect(result.issues).toContain('variant-quarantined');
  });

  it('repairs a missing or duplicated variant id so keys stay unique', () => {
    const result = repairDocument({
      version: 1,
      guides: { thirds: true, center: false, diagonal: false, golden: false },
      crop: { id: 'current', x: 0, y: 0, width: 1, height: 1, ratio: 'free' },
      variants: [
        { x: 0, y: 0, width: 0.5, height: 0.5, ratio: 'free' },
        { id: 'dup', x: 0, y: 0, width: 0.5, height: 0.5, ratio: 'free' },
        { id: 'dup', x: 0, y: 0, width: 0.5, height: 0.5, ratio: 'free' },
      ],
    });
    const ids = result.document.variants.map((variant) => variant.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toContain('dup');
  });

  it('keeps the strict guard honest for valid and repaired data', () => {
    expect(isFrameDocument(validDocument)).toBe(true);
    expect(isFrameDocument({ version: 1 })).toBe(false);
    expect(isFrameDocument(null)).toBe(false);
    expect(isFrameDocument({ junk: true })).toBe(false);
  });
});
