export const COLLAB_HTTP = 'http://localhost:7100'
export const COLLAB_WS = 'ws://localhost:7101'

// 每个浏览器标签一个随机身份（用于远端光标区分）
export function randomUser() {
  const colors = ['#F97316', '#4ECDC4', '#7C3AED', '#EF4444', '#0EA5E9', '#22C55E']
  const names = ['访客A', '访客B', '访客C', '访客D']
  return {
    name: names[Math.floor(Math.random() * names.length)] + Math.floor(Math.random() * 100),
    color: colors[Math.floor(Math.random() * colors.length)],
  }
}
