interface Snapshot {
  imageData: any;
  backgroundColor: string;
}

/**
 * 撤销/重做 - 基于离屏 Canvas 快照
 */
export class HistoryManager {
  private snapshots: Snapshot[] = [];
  private currentIndex = -1;
  private maxSize: number;
  private width: number;
  private height: number;

  constructor(maxSize = 30, width = 0, height = 0) {
    this.maxSize = maxSize;
    this.width = width;
    this.height = height;
  }

  setSize(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  /** 保存快照 - 从源 ctx 复制 */
  push(sourceCtx: any, backgroundColor: string, w?: number, h?: number) {
    const pw = w ?? this.width;
    const ph = h ?? this.height;
    let data: any;
    try {
      data = sourceCtx.getImageData(0, 0, pw, ph);
    } catch (e) {
      data = null;
    }

    // 删除当前位置之后的快照
    this.snapshots = this.snapshots.slice(0, this.currentIndex + 1);
    this.snapshots.push({ imageData: data, backgroundColor });

    if (this.snapshots.length > this.maxSize) {
      this.snapshots.shift();
    }
    this.currentIndex = this.snapshots.length - 1;
  }

  /** 撤销 - 返回快照数据 */
  undo(): Snapshot | null {
    if (this.currentIndex <= 0) return null;
    this.currentIndex--;
    return this.snapshots[this.currentIndex];
  }

  /** 重做 */
  redo(): Snapshot | null {
    if (this.currentIndex >= this.snapshots.length - 1) return null;
    this.currentIndex++;
    return this.snapshots[this.currentIndex];
  }

  /** 恢复快照到目标 ctx，并返回背景色 */
  restore(targetCtx: any): string | undefined {
    const snapshot = this.snapshots[this.currentIndex];
    if (!snapshot) return undefined;
    try {
      targetCtx.putImageData(snapshot.imageData, 0, 0);
    } catch (e) {
      // 忽略
    }
    return snapshot.backgroundColor;
  }

  canUndo(): boolean {
    return this.currentIndex > 0;
  }

  canRedo(): boolean {
    return this.currentIndex < this.snapshots.length - 1;
  }

  current(): Snapshot | null {
    return this.currentIndex >= 0 ? this.snapshots[this.currentIndex] : null;
  }

  reset() {
    this.snapshots = [];
    this.currentIndex = -1;
  }
}
