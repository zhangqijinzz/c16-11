import { describe, expect, it } from 'vitest';
import { restoreFrameDocument } from '../restore';
import { EMPTY_DOCUMENT, type CropVariant, type FrameDocument } from '../model';

const validCrop = (): CropVariant => ({ id: 'current', x: 0.25, y: 0.25, width: 0.5, height: 0.5, ratio: '1:1' });

const healthyDocument = (): FrameDocument => ({
  version: 1,
  image: { src: 'data:image/svg+xml,old', width: 1200, height: 800, name: 'old.svg' },
  guides: { thirds: false, center: true, diagonal: false, golden: true },
  subject: { x: 0.25, y: 0.5 },
  crop: validCrop(),
  variants: [{ id: 'variant-1', x: 0, y: 0.5, width: 0.5, height: 0.5, ratio: 'free' }],
});

describe('restoreFrameDocument', () => {
  it('returns null for structures that cannot be recognized', () => {
    expect(restoreFrameDocument(null)).toBeNull();
    expect(restoreFrameDocument(undefined)).toBeNull();
    expect(restoreFrameDocument('text')).toBeNull();
    expect(restoreFrameDocument(42)).toBeNull();
    expect(restoreFrameDocument([])).toBeNull();
    expect(restoreFrameDocument({})).toBeNull();
    expect(restoreFrameDocument({ version: '1' })).toBeNull();
    expect(restoreFrameDocument({ version: 2, crop: validCrop() })).toBeNull();
  });

  it('keeps a healthy document exactly as it was', () => {
    const healthy = healthyDocument();
    const report = restoreFrameDocument(structuredClone(healthy));
    expect(report).not.toBeNull();
    expect(report?.repaired).toBe(false);
    expect(report?.notes).toEqual([]);
    expect(report?.document).toEqual(healthy);
  });

  it('treats documents missing only newer optional fields as clean', () => {
    const report = restoreFrameDocument({ version: 1, crop: validCrop() });
    expect(report?.repaired).toBe(false);
    expect(report?.document).toEqual({ ...structuredClone(EMPTY_DOCUMENT), crop: validCrop() });
  });

  it('fills a missing crop with the default frame and reports the repair', () => {
    const report = restoreFrameDocument({ version: 1, guides: { thirds: true, center: false, diagonal: false, golden: false } });
    expect(report?.document.crop).toEqual(EMPTY_DOCUMENT.crop);
    expect(report?.repaired).toBe(true);
  });

  it('clamps an out-of-range crop back into the usable interval', () => {
    const report = restoreFrameDocument({ version: 1, crop: { id: 'current', x: 0.9, y: -0.5, width: 0.6, height: 2, ratio: '16:9' } });
    expect(report?.document.crop).toEqual({ id: 'current', x: 0.4, y: 0, width: 0.6, height: 1, ratio: '16:9' });
  });

  it('replaces non-numeric crop values with defaults', () => {
    const report = restoreFrameDocument({ version: 1, crop: { id: 7, x: 'left', y: null, width: 'wide', height: Number.NaN, ratio: '9:9' } });
    expect(report?.document.crop).toEqual(EMPTY_DOCUMENT.crop);
    expect(report?.repaired).toBe(true);
  });

  it('falls back to default toggles for missing or invalid guide entries', () => {
    const report = restoreFrameDocument({ version: 1, crop: validCrop(), guides: { center: true, golden: 'yes' } });
    expect(report?.document.guides).toEqual({ thirds: true, center: true, diagonal: false, golden: false });
    expect(report?.repaired).toBe(true);
  });

  it('ignores unknown extra guide keys for forward compatibility', () => {
    const report = restoreFrameDocument({ version: 1, crop: validCrop(), guides: { thirds: true, center: false, diagonal: false, golden: false, spiral: true } });
    expect(report?.repaired).toBe(false);
    expect(report?.document.guides).toEqual(EMPTY_DOCUMENT.guides);
  });

  it('drops an invalid image instead of breaking the stage', () => {
    const report = restoreFrameDocument({ version: 1, crop: validCrop(), image: { src: '', width: -3 } });
    expect(report?.document.image).toBeNull();
    expect(report?.repaired).toBe(true);
  });

  it('keeps a valid image and defaults a missing name', () => {
    const report = restoreFrameDocument({ version: 1, crop: validCrop(), image: { src: 'data:image/png;base64,xx', width: 640, height: 480 } });
    expect(report?.document.image).toEqual({ src: 'data:image/png;base64,xx', width: 640, height: 480, name: '未命名图片' });
    expect(report?.repaired).toBe(false);
  });

  it('clears an invalid subject and clamps out-of-range coordinates', () => {
    const invalid = restoreFrameDocument({ version: 1, crop: validCrop(), subject: 'oops' });
    expect(invalid?.document.subject).toBeNull();
    expect(invalid?.repaired).toBe(true);
    const clamped = restoreFrameDocument({ version: 1, crop: validCrop(), subject: { x: 1.4, y: -0.2 } });
    expect(clamped?.document.subject).toEqual({ x: 1, y: 0 });
    expect(clamped?.repaired).toBe(true);
  });

  it('isolates broken variants individually and clamps the rest', () => {
    const report = restoreFrameDocument({
      version: 1,
      crop: validCrop(),
      variants: [
        { id: 'keep', x: 0.1, y: 0.1, width: 0.5, height: 0.5, ratio: '1:1' },
        { id: 'clamp', x: 0.9, y: 0.9, width: 0.5, height: 0.5, ratio: 'free' },
        { id: 'no-geometry' },
        'garbage',
        null,
      ],
    });
    expect(report?.document.variants).toEqual([
      { id: 'keep', x: 0.1, y: 0.1, width: 0.5, height: 0.5, ratio: '1:1' },
      { id: 'clamp', x: 0.5, y: 0.5, width: 0.5, height: 0.5, ratio: 'free' },
    ]);
    expect(report?.notes.some((note) => note.includes('3 个异常裁切方案'))).toBe(true);
  });

  it('generates an id and a default ratio for variants that lost them', () => {
    const report = restoreFrameDocument({ version: 1, crop: validCrop(), variants: [{ x: 0, y: 0, width: 0.5, height: 0.5, ratio: '4:3' }] });
    expect(report?.document.variants).toEqual([{ id: 'restored-variant-1', x: 0, y: 0, width: 0.5, height: 0.5, ratio: 'free' }]);
  });

  it('clears a variants field that is not a list', () => {
    const report = restoreFrameDocument({ version: 1, crop: validCrop(), variants: { 0: 'x' } });
    expect(report?.document.variants).toEqual([]);
    expect(report?.repaired).toBe(true);
  });
});
