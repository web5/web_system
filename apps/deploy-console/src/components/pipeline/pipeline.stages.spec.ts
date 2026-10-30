import { defaultNodesFor } from './pipeline.stages'

/**
 * Q3（2026-10-27 拍板）：新建流水线默认节点序列——后台（be）含预构建节点（可删），
 * 前端/小程序不含。生成点在前端创建向导（PipelineEdit → defaultNodesFor），
 * 「在哪层实现就在哪层测」，故用例落在前端层。
 */
describe('defaultNodesFor（新建流水线默认节点序列，Q3）', () => {
  it('后台（be）默认节点含 prebuild，位于拉取之后、构建之前', () => {
    const keys = defaultNodesFor('be').map((n) => n.key)
    expect(keys).toEqual(['git', 'prebuild', 'build', 'gate', 'release'])
  })

  it('非后台（fe / 未选类型）默认节点不含 prebuild', () => {
    for (const t of ['fe', '']) {
      const keys = defaultNodesFor(t).map((n) => n.key)
      expect(keys).toEqual(['git', 'build', 'gate', 'release'])
      expect(keys).not.toContain('prebuild')
    }
  })

  it('prebuild 是普通 shell 节点（可删除、无 watchdog / 平台保留语义）', () => {
    const n = defaultNodesFor('be').find((x) => x.key === 'prebuild')
    expect(n).toMatchObject({ kind: 'shell', key: 'prebuild', label: '预构建' })
    expect(n?.watchdog).toBeFalsy()
    expect(n?.optional).toBeFalsy()
  })
})
