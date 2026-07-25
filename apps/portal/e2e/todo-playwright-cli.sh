#!/bin/bash
# Todo List 端到端测试脚本（使用 playwright-cli）
# 使用方法: bash e2e/todo-playwright-cli.sh

set -e

BASE_URL="http://localhost:5173/todo"
TIMEOUT=5000

echo "🧪 Todo List 端到端测试开始"
echo "=============================="

# 1. 打开浏览器并访问页面
echo "📱 1. 打开 Todo 页面..."
playwright-cli open "$BASE_URL"

# 2. 截图检查页面加载
echo "📸 2. 检查页面元素..."
playwright-cli screenshot --filename=e2e/screenshots/01-page-loaded.png

# 3. 检查空状态
echo "📭 3. 检查空状态显示..."
playwright-cli eval "document.querySelector('.empty-state') !== null" && echo "✅ 空状态显示正确" || echo "⚠️ 空状态未显示"

# 4. 点击创建按钮，打开表单
echo "➕ 4. 打开创建表单..."
playwright-cli click '.fab-btn'
playwright-cli screenshot --filename=e2e/screenshots/02-form-opened.png

# 5. 填写任务信息
echo "📝 5. 填写任务信息..."
playwright-cli fill 'input[placeholder="输入任务标题..."]' '学习 Vue 3 组合式 API'
playwright-cli fill 'textarea[placeholder="输入任务描述..."]' '阅读官方文档并编写示例'
playwright-cli screenshot --filename=e2e/screenshots/03-form-filled.png

# 6. 选择优先级（高）
echo "🔴 6. 选择优先级..."
playwright-cli click 'button:has-text("🔴 高")'

# 7. 选择分类（学习）
echo "📚 7. 选择分类..."
playwright-cli click 'button:has-text("📚 学习")'

# 8. 选择截止日期
echo "📅 8. 选择截止日期..."
playwright-cli fill 'input[type="date"]' '2026-07-15'

# 9. 提交表单
echo "✅ 9. 提交表单..."
playwright-cli click '.btn-submit'
playwright-cli screenshot --filename=e2e/screenshots/04-task-created.png

# 10. 等待任务列表更新
echo "⏱️ 10. 等待任务列表更新..."
sleep 1
playwright-cli eval "document.querySelector('.todo-item') !== null" && echo "✅ 任务创建成功" || echo "❌ 任务未显示"

# 11. 检查统计卡片更新
echo "📊 11. 检查统计卡片..."
playwright-cli eval "document.querySelector('.stats-value').textContent"

# 12. 点击完成任务
echo "🎉 12. 标记任务为完成..."
playwright-cli click '.btn-complete'
sleep 0.5
playwright-cli screenshot --filename=e2e/screenshots/05-task-completed.png

# 13. 检查筛选功能
echo "🔍 13. 测试筛选功能..."
# 选择已完成状态
playwright-cli select 'select.filter-select' 'completed'
sleep 0.5
playwright-cli screenshot --filename=e2e/screenshots/06-filter-completed.png

# 14. 搜索功能
echo "🔎 14. 测试搜索功能..."
playwright-cli fill 'input.filter-search' 'Vue'
sleep 0.5
playwright-cli screenshot --filename=e2e/screenshots/07-search-result.png

# 15. 移动端测试（调整窗口大小）
echo "📱 15. 测试移动端适配..."
playwright-cli resize 375 812
playwright-cli screenshot --filename=e2e/screenshots/08-mobile-view.png

# 16. 移动端创建任务
echo "➕ 16. 移动端创建任务..."
playwright-cli click '.fab-btn'
playwright-cli screenshot --filename=e2e/screenshots/09-mobile-form.png

# 17. 验证输入框文字颜色
echo "👀 17. 验证输入框文字清晰度..."
playwright-cli fill 'input[placeholder="输入任务标题..."]' '测试文字可见性'
playwright-cli screenshot --filename=e2e/screenshots/10-text-visibility.png

# 18. 关闭表单
echo "❌ 18. 关闭表单..."
playwright-cli click '.btn-cancel'

# 19. 恢复桌面视图
echo "🖥️ 19. 恢复桌面视图..."
playwright-cli resize 1280 720
playwright-cli screenshot --filename=e2e/screenshots/11-desktop-view.png

# 20. 删除任务
echo "🗑️ 20. 删除任务..."
playwright-cli click '.btn-delete'
sleep 0.5
playwright-cli screenshot --filename=e2e/screenshots/12-task-deleted.png

# 关闭浏览器
echo "🔒 关闭浏览器..."
playwright-cli close

echo ""
echo "=============================="
echo "🎉 端到端测试完成！"
echo "📁 截图保存在: e2e/screenshots/"
echo ""
