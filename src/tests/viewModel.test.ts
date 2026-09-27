import { beforeEach, describe, expect, it } from 'vitest';
import { FrameSenseViewModel } from '../viewModel';
import { EMPTY_DOCUMENT, type FrameDocument, type ImageAsset } from '../model';
import { restoreDocument, type RestoreResult } from '../migration';
import type { FrameRepository } from '../repository';
import type { ImageService } from '../service';

class MemoryRepository implements FrameRepository {
  document: FrameDocument = structuredClone(EMPTY_DOCUMENT);
  fail = false;
  rawOverride: string | null | undefined = undefined;
  load(): RestoreResult {
    if (this.rawOverride !== undefined) return restoreDocument(this.rawOverride);
    return restoreDocument(JSON.stringify(this.document));
  }
  save(document: FrameDocument) { if (this.fail) throw new Error('no storage'); this.document = structuredClone(document); }
}

class FakeImageService implements ImageService {
  asset: ImageAsset = { src: 'data:image/svg+xml,test', width: 1200, height: 800, name: 'test.svg' };
  readFile() { return Promise.resolve(this.asset); }
  demo() { return this.asset; }
}

describe('FrameSenseViewModel', () => {
  let repository: MemoryRepository;
  let vm: FrameSenseViewModel;
  beforeEach(() => { repository = new MemoryRepository(); vm = new FrameSenseViewModel(repository, new FakeImageService()); });

  it('initializes empty and loads a demo image', async () => {
    await vm.initialize();
    expect(vm.getSnapshot().phase).toBe('ready');
    vm.loadDemo();
    expect(vm.getSnapshot().document.image?.name).toBe('test.svg');
    expect(repository.document.image).not.toBeNull();
  });

  it('updates guides, subject, ratio, and variants', () => {
    vm.loadDemo();
    vm.toggleGuide('center');
    vm.markSubject(0.2, 0.8);
    vm.setRatio('1:1');
    vm.saveVariant();
    expect(vm.getSnapshot().document.guides.center).toBe(true);
    expect(vm.getSnapshot().document.subject).toEqual({ x: 0.2, y: 0.8 });
    expect(vm.getSnapshot().document.crop.ratio).toBe('1:1');
    expect(vm.getSnapshot().document.variants).toHaveLength(1);
  });

  it('keeps edits in memory and reports persistence failure', () => {
    repository.fail = true;
    vm.loadDemo();
    expect(vm.getSnapshot().phase).toBe('error');
    expect(vm.getSnapshot().document.image).not.toBeNull();
    expect(vm.getSnapshot().error).toContain('本地保存失败');
  });

  it('restores an intact legacy document exactly as saved', async () => {
    repository.document = {
      version: 1,
      image: { src: 'data:image/svg+xml,x', width: 800, height: 600, name: '旧版数据.svg' },
      guides: { thirds: true, center: true, diagonal: false, golden: false },
      subject: { x: 0.3, y: 0.7 },
      crop: { id: 'current', x: 0.1, y: 0.2, width: 0.5, height: 0.4, ratio: '4:5' },
      variants: [{ id: 'variant-old-1', x: 0, y: 0, width: 0.6, height: 0.6, ratio: '1:1' }],
    };
    await vm.initialize();
    const state = vm.getSnapshot();
    expect(state.phase).toBe('editing');
    expect(state.error).toBeNull();
    expect(state.document.crop).toEqual({ id: 'current', x: 0.1, y: 0.2, width: 0.5, height: 0.4, ratio: '4:5' });
    expect(state.document.variants[0]).toEqual({ id: 'variant-old-1', x: 0, y: 0, width: 0.6, height: 0.6, ratio: '1:1' });
    expect(state.document.guides.center).toBe(true);
  });

  it('fills missing fields and clamps an out-of-range crop from legacy data', async () => {
    repository.rawOverride = JSON.stringify({
      version: 1,
      image: { src: 'data:image/svg+xml,x', width: 800, height: 600, name: '修复.svg' },
      // guides 缺失 -> 默认开关
      crop: { id: 'current', x: 0.8, y: 0.8, width: 2, height: 2, ratio: 'free' },
      // variants 缺失
    });
    await vm.initialize();
    const state = vm.getSnapshot();
    expect(state.phase).toBe('editing');
    expect(state.error).toContain('已自动补齐');
    const { crop, guides } = state.document;
    expect(crop.x).toBe(0);
    expect(crop.y).toBe(0);
    expect(crop.width).toBe(1);
    expect(crop.height).toBe(1);
    expect(guides).toEqual({ thirds: true, center: false, diagonal: false, golden: false });
    // 工作台仍可操作
    vm.toggleGuide('center');
    expect(vm.getSnapshot().document.guides.center).toBe(true);
  });

  it('isolates broken variant entries instead of discarding the whole document', async () => {
    repository.rawOverride = JSON.stringify({
      version: 1,
      guides: { thirds: false, center: false, diagonal: false, golden: false },
      crop: { id: 'current', x: 0, y: 0, width: 1, height: 1, ratio: 'free' },
      variants: [
        null,
        'not-a-crop',
        { id: 'good', x: 0.1, y: 0.1, width: 0.3, height: 0.3, ratio: '1:1' },
      ],
    });
    await vm.initialize();
    const state = vm.getSnapshot();
    expect(state.phase).toBe('ready');
    expect(state.document.variants).toHaveLength(1);
    expect(state.document.variants[0].id).toBe('good');
    expect(state.error).toContain('2 个异常方案已单独隔离');
  });

  it('degrades to a clean empty workbench when the structure is unrecognizable', async () => {
    repository.rawOverride = JSON.stringify({ random: 'payload', nested: { a: 1 } });
    await vm.initialize();
    const state = vm.getSnapshot();
    expect(state.phase).toBe('ready');
    expect(state.document.variants).toEqual([]);
    expect(state.document.image).toBeNull();
    expect(state.document.guides).toEqual({ thirds: true, center: false, diagonal: false, golden: false });
    expect(state.error).toContain('无法识别');
    // 空工作台仍可操作
    vm.loadDemo();
    expect(vm.getSnapshot().document.image).not.toBeNull();
  });

  it('recovers from syntactically broken JSON with an explicit notice', async () => {
    repository.rawOverride = '{oops';
    await vm.initialize();
    const state = vm.getSnapshot();
    expect(state.phase).toBe('ready');
    expect(state.document.image).toBeNull();
    expect(state.error).toContain('损坏');
  });
});
