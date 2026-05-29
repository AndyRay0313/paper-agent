# Paper Agent — pi 扩展版

最简 tool use + 状态管理演示。基于 [pi](https://github.com/earendil-works/pi-coding-agent) 扩展系统。

## 场景

搜 arxiv 论文 → 阅读摘要 → 综合文献结果。

## 文件说明

| 文件 | 作用 |
|------|------|
| `.pi/extensions/paper-agent.ts` | 🔑 核心：工具注册 + 状态管理 + 调用追踪 |
| `.pi/skills/paper-agent/SKILL.md` | pi 自动加载的能力描述 |

## 运行

```bash
# 安装 pi
npm install -g @earendil-works/pi-coding-agent

# 进入项目目录启动
cd paper-agent
pi --provider deepseek --model deepseek-v4-pro
```

进去后直接对话：`帮我搜 retrieval augmented generation 的论文`

## 你能看到什么

- **工具调用入口** — `tool_execution_start` 事件通知（谁、什么参数、当前状态）
- **工具渲染** — `renderCall` / `renderResult` 自定义渲染（折叠/展开）
- **状态变化** — `tool_execution_end` 事件通知（执行结果、状态变化）
- **状态日志** — `.pi/paper-agent-state.log` 文件记录每次调用
- **状态查看** — `/papers` 命令随时查看搜索历史

## 安装为 pi package

别人可以直接安装：

```bash
pi install git:github.com/你的用户名/paper-agent
```
