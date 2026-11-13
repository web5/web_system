/**
 * storage 读写（迁移自 dachengzi helper.js L52–64，原样）
 *
 * ⚠️ 用例内引用 storage key 只许用 ctx.KEYS.<别名>（值来自各 app e2e.config.js
 * storageKeys），禁字面量——漂移守卫 assertKeysInSource 只对 config 里的值对账，
 * 写字面量等于绕过守卫（见 README 第③/⑥章）。
 */

/** 读 storage（走小程序上下文里的 wx.getStorageSync） */
async function getStorage(mp, key) {
  return mp.callWxMethod('getStorageSync', key);
}

/** 写 storage */
async function setStorage(mp, key, value) {
  return mp.callWxMethod('setStorageSync', key, value);
}

/** 删 storage */
async function removeStorage(mp, key) {
  return mp.callWxMethod('removeStorageSync', key);
}

module.exports = { getStorage, setStorage, removeStorage };
