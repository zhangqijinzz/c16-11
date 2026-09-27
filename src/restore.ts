import { normalizeCrop } from './domain';
import { DEFAULT_CROP, EMPTY_DOCUMENT, type CropVariant, type FrameDocument, type GuideKey, type ImageAsset, type Ratio } from './model';

export interface RestoreReport {
  document: FrameDocument;
  /** true 表示读取过程中做过任何补齐、收敛或隔离。 */
  repaired: boolean;
  /** 面向用户/日志的修复摘要。 */
  notes: string[];
}

const RATIOS: readonly Ratio[] = ['free', '1:1', '4:5', '16:9'];
const GUIDE_KEYS: readonly GuideKey[] = ['thirds', 'center', 'diagonal', 'golden'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function restoreImage(value: unknown, notes: string[]): ImageAsset | null {
  if (value === undefined || value === null) return null;
  if (
    !isRecord(value) ||
    typeof value.src !== 'string' ||
    value.src.length === 0 ||
    !isFiniteNumber(value.width) ||
    value.width <= 0 ||
    !isFiniteNumber(value.height) ||
    value.height <= 0
  ) {
    notes.push('图片信息无效，已按空白工作台处理。');
    return null;
  }
  return {
    src: value.src,
    width: value.width,
    height: value.height,
    name: typeof value.name === 'string' && value.name.length > 0 ? value.name : '未命名图片',
  };
}

function restoreGuides(value: unknown, notes: string[]): Record<GuideKey, boolean> {
  const guides: Record<GuideKey, boolean> = { ...EMPTY_DOCUMENT.guides };
  if (value === undefined || value === null) return guides;
  if (!isRecord(value)) {
    notes.push('辅助层设置无效，已按默认开关补齐。');
    return guides;
  }
  let adjusted = false;
  for (const key of GUIDE_KEYS) {
    const stored = value[key];
    if (typeof stored === 'boolean') guides[key] = stored;
    else adjusted = true;
  }
  if (adjusted) notes.push('辅助层记录不全，已按默认开关补齐。');
  return guides;
}

function restoreSubject(value: unknown, notes: string[]): { x: number; y: number } | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
    notes.push('主体标记无效，已清除。');
    return null;
  }
  const subject = { x: clamp01(value.x), y: clamp01(value.y) };
  if (subject.x !== value.x || subject.y !== value.y) notes.push('主体标记越界，已移回画面内。');
  return subject;
}

function restoreCrop(value: unknown, notes: string[]): CropVariant {
  const source = isRecord(value) ? value : {};
  const crop: CropVariant = {
    id: typeof source.id === 'string' && source.id.length > 0 ? source.id : DEFAULT_CROP.id,
    x: isFiniteNumber(source.x) ? source.x : DEFAULT_CROP.x,
    y: isFiniteNumber(source.y) ? source.y : DEFAULT_CROP.y,
    width: isFiniteNumber(source.width) ? source.width : DEFAULT_CROP.width,
    height: isFiniteNumber(source.height) ? source.height : DEFAULT_CROP.height,
    ratio: typeof source.ratio === 'string' && (RATIOS as readonly string[]).includes(source.ratio) ? source.ratio : DEFAULT_CROP.ratio,
  };
  const normalized = normalizeCrop(crop);
  const changed =
    normalized.id !== source.id ||
    normalized.x !== source.x ||
    normalized.y !== source.y ||
    normalized.width !== source.width ||
    normalized.height !== source.height ||
    normalized.ratio !== source.ratio;
  if (changed) notes.push('当前裁切范围异常，已收敛回可用区间。');
  return normalized;
}

function restoreVariant(value: unknown, index: number): { variant: CropVariant; adjusted: boolean } | null {
  if (!isRecord(value)) return null;
  // 没有可靠几何数据的条目无法修复，单独隔离而不是拖垮整份方案列表。
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y) || !isFiniteNumber(value.width) || !isFiniteNumber(value.height)) {
    return null;
  }
  const ratio = typeof value.ratio === 'string' && (RATIOS as readonly string[]).includes(value.ratio) ? value.ratio : DEFAULT_CROP.ratio;
  const id = typeof value.id === 'string' && value.id.length > 0 ? value.id : `restored-variant-${index + 1}`;
  const variant = normalizeCrop({ id, x: value.x, y: value.y, width: value.width, height: value.height, ratio });
  const adjusted = variant.x !== value.x || variant.y !== value.y || variant.width !== value.width || variant.height !== value.height || variant.ratio !== value.ratio || variant.id !== value.id;
  return { variant, adjusted };
}

function restoreVariants(value: unknown, notes: string[]): CropVariant[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    notes.push('裁切方案列表无效，已清空。');
    return [];
  }
  const variants: CropVariant[] = [];
  let dropped = 0;
  let adjusted = false;
  value.forEach((entry, index) => {
    const restored = restoreVariant(entry, index);
    if (!restored) {
      dropped += 1;
      return;
    }
    if (restored.adjusted) adjusted = true;
    variants.push(restored.variant);
  });
  if (dropped > 0) notes.push(`已隔离 ${dropped} 个异常裁切方案。`);
  if (adjusted) notes.push('部分裁切方案越界，已收敛回可用区间。');
  return variants;
}

/**
 * 读取历史数据时做完整检查和补齐：
 * - 缺失字段按默认补上；
 * - 越界的裁切范围收敛回可用区间；
 * - 辅助层缺失项按默认开关处理；
 * - 方案里的异常条目单独隔离，而不是整份丢弃。
 *
 * 结构完全无法识别（非对象、版本不符）时返回 null，由调用方降级成干净的空工作台。
 */
export function restoreFrameDocument(value: unknown): RestoreReport | null {
  if (!isRecord(value)) return null;
  if (value.version !== 1) return null;
  const notes: string[] = [];
  const document: FrameDocument = {
    version: 1,
    image: restoreImage(value.image, notes),
    guides: restoreGuides(value.guides, notes),
    subject: restoreSubject(value.subject, notes),
    crop: restoreCrop(value.crop, notes),
    variants: restoreVariants(value.variants, notes),
  };
  return { document, repaired: notes.length > 0, notes };
}
