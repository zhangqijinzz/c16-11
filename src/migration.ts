import { DEFAULT_CROP, EMPTY_DOCUMENT, GUIDE_KEYS, type CropVariant, type FrameDocument, type GuideKey, type ImageAsset, type Ratio } from './model';

/**
 * 读取历史存档时的检查结果。
 * - intact:    数据完好（或没有存档），原样可用
 * - repaired:  结构可识别，但存在缺失/越界/异常条目，已就地补齐
 * - corrupted: 结构完全无法识别，降级为干净的空工作台
 */
export type RestoreStatus = 'intact' | 'repaired' | 'corrupted';

export interface RestoreResult {
  status: RestoreStatus;
  document: FrameDocument;
  /** 被单独隔离的异常裁切方案条目（不带入编辑状态，也不整份丢弃其余数据） */
  quarantined: unknown[];
  /** 本次检查发现并补齐/收敛的问题类型（已去重） */
  issues: string[];
}

const RATIOS: readonly Ratio[] = ['free', '1:1', '4:5', '16:9'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function asRatio(value: unknown): Ratio | null {
  return typeof value === 'string' && (RATIOS as readonly string[]).includes(value) ? (value as Ratio) : null;
}

/**
 * 结构是否还能识别为 FrameSense 工作台存档。
 * version 1 的对象一律可识别；没有版本号但带有已知顶层字段的旧存档同样可识别。
 */
export function isRecognizableDocument(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (value.version === 1) return true;
  return 'crop' in value || Array.isArray(value.variants) || 'guides' in value;
}

function repairImage(value: unknown, issues: string[]): ImageAsset | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || typeof value.src !== 'string' || value.src.trim() === ''
    || !isFiniteNumber(value.width) || value.width <= 0
    || !isFiniteNumber(value.height) || value.height <= 0) {
    issues.push('image');
    return null;
  }
  return {
    src: value.src,
    width: value.width,
    height: value.height,
    name: typeof value.name === 'string' && value.name.trim() !== '' ? value.name : '未命名图片',
  };
}

function repairGuides(value: unknown, issues: string[]): Record<GuideKey, boolean> {
  const source = isRecord(value) ? value : undefined;
  if (!source) issues.push('guides');
  const guides = structuredClone(EMPTY_DOCUMENT.guides);
  for (const key of GUIDE_KEYS) {
    if (source && typeof source[key] === 'boolean') {
      guides[key] = source[key];
    } else {
      // 记录不全（键缺失）或开关值非法，都按默认开关补齐。
      issues.push('guides');
    }
  }
  return guides;
}

function repairSubject(value: unknown, issues: string[]): { x: number; y: number } | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
    issues.push('subject');
    return null;
  }
  return { x: clamp01(value.x), y: clamp01(value.y) };
}

/** 越界判定与 domain 中的可用区间保持一致：尺寸不小于 0.12，且整体落在画面内。 */
function cropOutOfRange(x: number, y: number, width: number, height: number): boolean {
  return x < -1e-9 || y < -1e-9 || x + width > 1 + 1e-9 || y + height > 1 + 1e-9
    || width < 0.12 - 1e-9 || height < 0.12 - 1e-9
    || width > 1 + 1e-9 || height > 1 + 1e-9;
}

type CropGeometry = Omit<CropVariant, 'id'>;

/** 缺失数值按默认补上，越界的裁切范围收敛回 [0,1] 内的可用区间。 */
function repairCropGeometry(value: unknown, issues: string[], issueCode: string): CropGeometry {
  const source = isRecord(value) ? value : undefined;
  if (!source) {
    issues.push(issueCode);
    return { x: DEFAULT_CROP.x, y: DEFAULT_CROP.y, width: DEFAULT_CROP.width, height: DEFAULT_CROP.height, ratio: DEFAULT_CROP.ratio };
  }
  const width = isFiniteNumber(source.width) ? source.width : DEFAULT_CROP.width;
  const height = isFiniteNumber(source.height) ? source.height : DEFAULT_CROP.height;
  const x = isFiniteNumber(source.x) ? source.x : DEFAULT_CROP.x;
  const y = isFiniteNumber(source.y) ? source.y : DEFAULT_CROP.y;
  if (!isFiniteNumber(source.x) || !isFiniteNumber(source.y)
    || !isFiniteNumber(source.width) || !isFiniteNumber(source.height)
    || cropOutOfRange(x, y, width, height)) {
    issues.push(issueCode);
  }
  const parsedRatio = asRatio(source.ratio);
  if (source.ratio !== undefined && parsedRatio === null) {
    issues.push(issueCode);
  }
  const ratio: Ratio = parsedRatio ?? (DEFAULT_CROP.ratio as Ratio);

  const clampedWidth = Math.min(1, Math.max(0.12, width));
  const clampedHeight = Math.min(1, Math.max(0.12, height));
  return {
    x: Math.min(1 - clampedWidth, Math.max(0, x)),
    y: Math.min(1 - clampedHeight, Math.max(0, y)),
    width: clampedWidth,
    height: clampedHeight,
    ratio,
  };
}

function currentCropId(value: unknown, issues: string[]): string {
  if (typeof value === 'string' && value.trim() !== '') return value;
  issues.push('crop-id');
  return DEFAULT_CROP.id;
}

function uniqueCropId(value: unknown, fallback: string, used: Set<string>, issues: string[]): string {
  let id: string;
  if (typeof value === 'string' && value.trim() !== '') {
    id = value;
  } else {
    id = fallback;
    issues.push('variant-id');
  }
  if (used.has(id)) {
    let candidate = `${id}-recovered`;
    let suffix = 2;
    while (used.has(candidate)) candidate = `${id}-recovered-${suffix++}`;
    id = candidate;
  }
  used.add(id);
  return id;
}

/** 方案条目必须能补成一个合法裁切；彻底不可用的条目交由调用方隔离。 */
function salvageVariant(value: unknown, index: number, issues: string[], quarantined: unknown[], used: Set<string>): CropVariant | null {
  if (!isRecord(value) || !('x' in value || 'y' in value || 'width' in value || 'height' in value || 'ratio' in value || 'id' in value)) {
    quarantined.push(value);
    issues.push('variant-quarantined');
    return null;
  }
  const geometry = repairCropGeometry(value, issues, 'variant');
  const id = uniqueCropId(value.id, `variant-recovered-${index + 1}`, used, issues);
  return { ...geometry, id };
}

/**
 * 检查并修复一份历史存档。调用方保证 source 已通过 isRecognizableDocument。
 */
export function repairDocument(source: Record<string, unknown>): RestoreResult {
  const issues: string[] = [];
  const quarantined: unknown[] = [];

  const image = repairImage(source.image, issues);
  const guides = repairGuides(source.guides, issues);
  const subject = repairSubject(source.subject, issues);

  const cropSource = isRecord(source.crop) ? source.crop : undefined;
  if (!cropSource) issues.push('crop');
  const crop: CropVariant = { ...repairCropGeometry(cropSource, issues, 'crop'), id: currentCropId(cropSource?.id, issues) };

  const variants: CropVariant[] = [];
  if (!Array.isArray(source.variants)) {
    issues.push('variants');
  } else {
    const used = new Set<string>();
    for (const [index, entry] of source.variants.entries()) {
      const salvaged = salvageVariant(entry, index, issues, quarantined, used);
      if (salvaged) variants.push(salvaged);
    }
  }

  if (source.version !== 1) issues.push('version');

  const uniqueIssues = [...new Set(issues)];
  const document: FrameDocument = { version: 1, image, guides, subject, crop, variants };
  return { status: uniqueIssues.length === 0 ? 'intact' : 'repaired', document, quarantined, issues: uniqueIssues };
}

/** 严格判定：数据完好、无需任何修复时才为真。 */
export function isFrameDocument(value: unknown): value is FrameDocument {
  return isRecognizableDocument(value) && repairDocument(value).status === 'intact';
}

/**
 * 读取历史数据的唯一入口：解析 JSON，识别结构，返回可安全进入编辑状态的结果。
 * - 没有存档：返回干净空工作台（intact）
 * - 无法解析或结构完全无法识别：降级为干净空工作台（corrupted），坏数据不带入编辑状态
 */
export function restoreDocument(raw: string | null | undefined): RestoreResult {
  if (raw === null || raw === undefined || raw.trim() === '') {
    return { status: 'intact', document: structuredClone(EMPTY_DOCUMENT), quarantined: [], issues: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  if (!isRecognizableDocument(parsed)) {
    return { status: 'corrupted', document: structuredClone(EMPTY_DOCUMENT), quarantined: [], issues: ['corrupted'] };
  }
  return repairDocument(parsed);
}
