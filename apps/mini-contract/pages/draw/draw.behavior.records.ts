// pages/draw/draw.behavior.records.ts
// 画板记录管理：自动创建/更新/保存画板记录

import { createRecord, updateRecord } from '../../services/drawing-records';

/** 将 Canvas 导出为 base64 data URL（Promise 包装） */
function canvasToBase64(canvas: any): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      wx.canvasToTempFilePath({
        canvas,
        success: (res: any) => {
          try {
            const fs = wx.getFileSystemManager();
            const base64 = fs.readFileSync(res.tempFilePath, 'base64');
            resolve(`data:image/png;base64,${base64}`);
          } catch (_) {
            resolve(null);
          }
        },
        fail: () => resolve(null),
      });
    } catch (_) {
      resolve(null);
    }
  });
}

export const RecordsBehavior = Behavior({
  data: {
    currentRecordId: '',
  },

  methods: {
    /** 进入画板时创建新记录 */
    initDrawingRecord() {
      const record = createRecord();
      this.setData({ currentRecordId: record.id });
    },

    /** 画布内容变化时更新记录（防抖 2 秒） */
    onContentChange() {
      if (this._recordUpdateTimer) clearTimeout(this._recordUpdateTimer as number);
      this._recordUpdateTimer = setTimeout(() => {
        this._recordUpdateTimer = null;
        // 只有画布有实际绘制内容时才创建/更新记录（避免 engine.init() 时就创建空记录）
        const engine = (this as any).engine;
        if (!engine || !engine.hasContent) return;
        if (!this.data.currentRecordId) {
          this.initDrawingRecord();
        } else {
          this.updateCurrentRecord();
        }
      }, 2000) as unknown as number;
    },

    /** 更新当前记录的时间戳 */
    updateCurrentRecord() {
      if (!this.data.currentRecordId) return;
      updateRecord(this.data.currentRecordId, { updatedAt: Date.now() });
    },

    /** 保存画布内容和缩略图到当前记录（异步，返回 Promise） */
    saveCurrentRecord(): Promise<void> {
      return new Promise((resolve) => {
        const engine = (this as any).engine;
        const recordId = this.data.currentRecordId;
        if (!engine || !recordId) { resolve(); return; }

        // 先导出主 canvas 为 base64
        canvasToBase64(engine.mainCanvas).then((canvasData) => {
          if (canvasData) {
            updateRecord(recordId, { canvasData });
          }

          // 生成缩略图 base64
          this.generateThumbnail(engine).then((thumbData) => {
            if (thumbData) {
              updateRecord(recordId, { thumbnail: thumbData });
            }
            resolve();
          });
        });
      });
    },

    /** 生成缩略图 base64 */
    generateThumbnail(engine: any): Promise<string | null> {
      return new Promise((resolve) => {
        try {
          const thumbW = 100;
          const thumbH = 100;
          const canvas = wx.createOffscreenCanvas({ type: '2d', width: thumbW, height: thumbH });
          const ctx = canvas.getContext('2d');

          // 填充背景色
          const bgColor = (this.data as any).backgroundColor || '#ffffff';
          if (bgColor) {
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, thumbW, thumbH);
          }

          // 主 canvas 的像素尺寸是 engine.width * dpr，需要全绘再缩放到缩略图
          try {
            ctx.drawImage(
              engine.mainCanvas,
              0, 0, engine.width * engine.dpr, engine.height * engine.dpr,
              0, 0, thumbW, thumbH,
            );
          } catch (_) {
            // drawImage 可能失败（如 canvas 未渲染），返回空缩略图
            resolve(null);
            return;
          }

          wx.canvasToTempFilePath({
            canvas,
            success: (res: any) => {
              try {
                const fs = wx.getFileSystemManager();
                const base64 = fs.readFileSync(res.tempFilePath, 'base64');
                resolve(`data:image/png;base64,${base64}`);
              } catch (_) {
                resolve(null);
              }
            },
            fail: () => resolve(null),
          });
        } catch (_) {
          resolve(null);
        }
      });
    },

    /** 确保当前有记录 ID（没有则立即创建） */
    ensureRecordId() {
      const engine = (this as any).engine;
      if (!engine || !engine.hasContent) return;
      if (!this.data.currentRecordId) {
        this.initDrawingRecord();
      }
    },

    /** 页面隐藏时兜底保存（如用户按 home 键或接电话） */
    onHide() {
      // 取消防抖定时器，避免回调在页面离开后再创建记录
      if (this._recordUpdateTimer) {
        clearTimeout(this._recordUpdateTimer as number);
        this._recordUpdateTimer = null;
      }
      this.ensureRecordId();
      if (this.data.currentRecordId) {
        this.saveCurrentRecord();
      }
    },

    /** 页面卸载时兜底保存 */
    onUnload() {
      if (this._recordUpdateTimer) {
        clearTimeout(this._recordUpdateTimer as number);
        this._recordUpdateTimer = null;
      }
      this.ensureRecordId();
      if (this.data.currentRecordId) {
        this.saveCurrentRecord();
      }
    },
  },
});
