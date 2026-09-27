import { EMPTY_DOCUMENT, type FrameDocument } from './model';
import { restoreFrameDocument } from './restore';
import type { StorageService } from './service';

/**
 * empty：没有历史数据；clean：历史数据原样可用；
 * repaired：历史数据经过补齐/收敛/隔离；reset：结构无法识别，已降级为空白工作台。
 */
export type LoadStatus = 'empty' | 'clean' | 'repaired' | 'reset';

export interface LoadOutcome {
  document: FrameDocument;
  status: LoadStatus;
  notes: string[];
}

export interface FrameRepository {
  load(): LoadOutcome;
  save(document: FrameDocument): void;
}

const emptyOutcome = (status: LoadStatus, notes: string[] = []): LoadOutcome => ({
  document: structuredClone(EMPTY_DOCUMENT),
  status,
  notes,
});

export class LocalFrameRepository implements FrameRepository {
  constructor(private readonly storage: StorageService) {}

  load(): LoadOutcome {
    const raw = this.storage.read();
    if (!raw) return emptyOutcome('empty');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return emptyOutcome('reset', ['历史数据不是有效的 JSON。']);
    }
    const restored = restoreFrameDocument(parsed);
    if (!restored) return emptyOutcome('reset', ['历史数据结构无法识别。']);
    return { document: restored.document, status: restored.repaired ? 'repaired' : 'clean', notes: restored.notes };
  }

  save(document: FrameDocument): void {
    this.storage.write(JSON.stringify(document));
  }
}
