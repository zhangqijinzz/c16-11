import { beforeEach, describe, expect, it } from 'vitest';
import { FrameSenseViewModel } from '../viewModel';
import { EMPTY_DOCUMENT, type FrameDocument, type ImageAsset } from '../model';
import type { FrameRepository, LoadOutcome } from '../repository';
import type { ImageService } from '../service';

class MemoryRepository implements FrameRepository {
  outcome: LoadOutcome = { document: structuredClone(EMPTY_DOCUMENT), status: 'empty', notes: [] };
  fail = false;
  load(): LoadOutcome {
    return { document: structuredClone(this.outcome.document), status: this.outcome.status, notes: [...this.outcome.notes] };
  }
  save(document: FrameDocument) {
    if (this.fail) throw new Error('no storage');
    this.outcome = { document: structuredClone(document), status: 'clean', notes: [] };
  }
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
    expect(repository.outcome.document.image).not.toBeNull();
  });

  it('restores clean history as-is', async () => {
    const document: FrameDocument = { ...structuredClone(EMPTY_DOCUMENT), image: { src: 'data:image/svg+xml,old', width: 800, height: 600, name: 'old.svg' }, subject: { x: 0.4, y: 0.6 } };
    repository.outcome = { document, status: 'clean', notes: [] };
    await vm.initialize();
    expect(vm.getSnapshot().phase).toBe('editing');
    expect(vm.getSnapshot().document.subject).toEqual({ x: 0.4, y: 0.6 });
    expect(vm.getSnapshot().notice).toBe('已恢复上次工作状态');
  });

  it('restores repaired history with a visible notice', async () => {
    const document: FrameDocument = { ...structuredClone(EMPTY_DOCUMENT), image: { src: 'data:image/svg+xml,old', width: 800, height: 600, name: 'old.svg' } };
    repository.outcome = { document, status: 'repaired', notes: ['辅助层记录不全，已按默认开关补齐。'] };
    await vm.initialize();
    const state = vm.getSnapshot();
    expect(state.phase).toBe('editing');
    expect(state.document.image?.name).toBe('old.svg');
    expect(state.notice).toContain('已自动修复');
    expect(state.error).toBeNull();
  });

  it('degrades to a clean empty workbench and tells the user when history is unrecognizable', async () => {
    repository.outcome = { document: structuredClone(EMPTY_DOCUMENT), status: 'reset', notes: ['历史数据结构无法识别。'] };
    await vm.initialize();
    const state = vm.getSnapshot();
    expect(state.phase).toBe('ready');
    expect(state.document).toEqual(EMPTY_DOCUMENT);
    expect(state.notice).toContain('无法识别');
    expect(state.error).toBeNull();
    vm.loadDemo();
    expect(vm.getSnapshot().phase).toBe('editing');
    expect(vm.getSnapshot().document.image).not.toBeNull();
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
});
