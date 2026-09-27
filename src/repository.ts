import { restoreDocument, type RestoreResult } from './migration';
import type { FrameDocument } from './model';
import type { StorageService } from './service';

export interface FrameRepository {
  load(): RestoreResult;
  save(document: FrameDocument): void;
}

export class LocalFrameRepository implements FrameRepository {
  constructor(private readonly storage: StorageService) {}

  load(): RestoreResult {
    const result = restoreDocument(this.storage.read());
    // 检查补齐后立刻落盘，避免坏数据下次继续触发修复；
    // 完全无法识别的坏存档保留原样，只把干净的空工作台带进内存。
    if (result.status === 'repaired') {
      try {
        this.storage.write(JSON.stringify(result.document));
      } catch {
        // 存储不可用时内存中的文档依然可用，交由上层提示保存失败。
      }
    }
    return result;
  }

  save(document: FrameDocument): void {
    this.storage.write(JSON.stringify(document));
  }
}
