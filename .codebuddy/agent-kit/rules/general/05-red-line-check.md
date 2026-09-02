# 红线机器化

反复出现的错误，以机器检查替代文本约定（提交前校验、CI 拦截、自动检测）。

文本规则依赖自觉，机器检查必然执行。

每条红线须具备可执行的检查手段，不能仅以文档形式存在。

三层结构：指南（常驻文档）→ 技能/SOP（标准作业）→ 红线检查（机器拦截）。

## 最小实现示例

### pre-commit（提交前拦截）

```bash
#!/bin/sh
# .git/hooks/pre-commit — 拦截调试代码与疑似密钥
if git diff --cached | grep -nE 'console\.log\(|print\(|(password|secret|token)\s*=' ; then
  echo "红线拦截：发现调试代码或疑似密钥" ; exit 1
fi
```

### CI（推送后拦截）

```yaml
- name: red-line check
  run: |
    ! grep -rn "TODO-FIXME-TEMP" src/   # 占位内容禁止入库
    npm test                              # 回归必须全绿
```

### 迁移路径

新红线的落地路径：文档声明 → 纳入 pre-commit → 最终 CI 强制拦截。只停留在第一层的红线视为未完成。
