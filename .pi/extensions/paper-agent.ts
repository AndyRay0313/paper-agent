/**
 * Paper Agent Extension — 最简单的 tool use + 状态管理演示
 *
 * 参考 pi 的 todo.ts 和 tools.ts 示例：
 *  - 工具调用 → pi.registerTool()
 *  - 状态管理 → session entries（跟随分支，自动恢复）
 *  - 可视化   → renderCall / renderResult + /papers 命令
 *  - 调用追踪 → tool_execution_start/end 事件钩子
 *  - 状态日志 → .pi/paper-agent-state.log 文件
 *
 * 具体场景：搜 arxiv 文献，综合结果
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── 类型定义 ───────────────────────────────────────────────

interface PaperInfo {
  title: string;
  summary: string;
  arxivUrl: string;
  published: string;
  authors: string;
}

/** 每次搜索都会把这个对象写入 session，用于状态恢复和可视化 */
interface SearchState {
  query: string;
  papers: PaperInfo[];
  timestamp: number;
  totalResults: number;
}

// ─── Arxiv API 封装 ─────────────────────────────────────────

async function fetchArxiv(query: string, maxResults = 3): Promise<PaperInfo[]> {
  const url =
    `http://export.arxiv.org/api/query?` +
    `search_query=all:${encodeURIComponent(query)}` +
    `&start=0&max_results=${maxResults}`;

  const headers = { "User-Agent": "paper-agent/0.1" };

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`arxiv API error: ${res.status}`);

  const xml = await res.text();
  return parseArxivXML(xml);
}

function parseArxivXML(xml: string): PaperInfo[] {
  // 简单 XML 解析（不引入额外依赖）
  const papers: PaperInfo[] = [];

  // 用正则提取每个 <entry>...</entry>
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let match;

  while ((match = entryRe.exec(xml)) !== null) {
    const entry = match[1];

    const getTag = (tag: string) => {
      const m = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return m ? m[1].replace(/\s+/g, " ").trim() : "";
    };

    const getId = () => {
      const m = entry.match(/<id>([\s\S]*?)<\/id>/);
      return m ? m[1].trim() : "";
    };

    const getAuthors = () => {
      const names: string[] = [];
      const authorRe = /<name>([\s\S]*?)<\/name>/g;
      let am;
      while ((am = authorRe.exec(entry)) !== null) {
        names.push(am[1].trim());
      }
      return names;
    };

    papers.push({
      title: getTag("title"),
      summary: getTag("summary"),
      arxivUrl: getId(),
      published: getTag("published"),
      authors: getAuthors().join(", "),
    });
  }

  return papers;
}

// ─── Extension 主入口 ───────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── 内存状态（从 session 重建） ──────────────────────────

  let searchHistory: SearchState[] = [];
  let toolCallCount = 0;
  let cwd = process.cwd();

  /**
   * 🔑 状态管理的核心：从 session entries 重建状态
   *
   * pi 的 session 是一个 JSONL 文件，每个 tool 调用结果都会被持久化。
   * 当 session 重启、分支切换时，通过扫描 entries 来重建内存状态，
   * 保证状态始终和当前分支一致。
   */
  function reconstructState(ctx: ExtensionContext) {
    searchHistory = [];
    toolCallCount = 0;

    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const msg = entry.message;
      if (msg.role !== "toolResult" || msg.toolName !== "search_arxiv") continue;

      toolCallCount++;

      // 每个 tool result 的 details 就是 SearchState
      if (msg.details) {
        searchHistory.push(msg.details as SearchState);
      }
    }
  }

  // ── 状态日志：每次工具调用写入文件 ──────────────────────

  function writeStateLog(message: string) {
    try {
      const logDir = path.join(cwd, ".pi");
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      const logFile = path.join(logDir, "paper-agent-state.log");
      const timestamp = new Date().toISOString();
      fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
    } catch {
      // 忽略日志写入错误
    }
  }

  // ── 注册 /papers 命令（查看状态） ─────────────────────────

  pi.registerCommand("papers", {
    description: "查看当前分支的论文搜索历史（状态管理展示）",
    handler: async (_args, ctx) => {
      reconstructState(ctx);

      if (searchHistory.length === 0) {
        ctx.ui.notify("📚 还没有搜过论文，试试让 agent 搜索", "info");
        return;
      }

      // 用 notify 展示状态摘要
      const summary = searchHistory
        .map(
          (s, i) =>
            `[${i + 1}] 搜索: "${s.query}" → ${s.papers.length} 篇论文` +
            s.papers.map((p) => `\n    📄 ${p.title}`).join(""),
        )
        .join("\n\n");

      ctx.ui.notify(`📚 论文搜索历史 (${searchHistory.length} 次)\n\n${summary}`, "info");
    },
  });

  // ── 🔑 事件钩子：每次工具调用主动展示状态变化 ─────────

  /**
   * tool_execution_start：工具被调用时立即通知
   * → 你能看到 "谁、什么时候、用什么参数 调了工具"
   */
  pi.on("tool_execution_start", async (event, ctx) => {
    if (event.toolName !== "search_arxiv") return;

    const beforeCount = searchHistory.length;
    const query = event.args?.query || "?";

    ctx.ui.notify(
      `🔍 [工具调用] search_arxiv("${query}") 开始执行\n` +
        `   当前状态: 已搜索 ${beforeCount} 次, 共 ${beforeCount > 0 ? searchHistory.reduce((sum, s) => sum + s.papers.length, 0) : 0} 篇论文在历史中`,
      "info",
    );

    writeStateLog(
      `TOOL_CALL_START | query="${query}" | historySize=${beforeCount} | toolCallCount=${toolCallCount}`,
    );
  });

  /**
   * tool_execution_end：工具执行完毕时通知 + 展示状态变化
   * → 你能看到 "执行结果、状态从什么变成什么"
   */
  pi.on("tool_execution_end", async (event, ctx) => {
    if (event.toolName !== "search_arxiv") return;

    const result = event.result;
    const details = result?.details as SearchState | undefined;

    if (!details) {
      ctx.ui.notify("⚠️ [工具完成] search_arxiv 执行完毕，无结果", "warning");
      writeStateLog("TOOL_CALL_END | no result");
      return;
    }

    const afterCount = searchHistory.length + 1; // 包含本次
    const totalPapers = details.totalResults;

    ctx.ui.notify(
      `✅ [工具完成] search_arxiv("${details.query}")\n` +
        `   本次结果: ${totalPapers} 篇论文\n` +
        `   状态变化: 搜索次数 ${searchHistory.length} → ${afterCount}`,
      "success",
    );

    writeStateLog(
      `TOOL_CALL_END | query="${details.query}" | papers=${totalPapers} | ` +
        `historySize=${afterCount} | ` +
        `papers: [${details.papers.map((p) => p.title.slice(0, 40)).join(" | ")}]`,
    );
  });

  // ── 注册 search_arxiv 工具 ────────────────────────────────

  pi.registerTool({
    name: "search_arxiv",
    label: "Search Arxiv",
    description:
      "搜索 arxiv 论文。输入英文关键词/主题，返回最多 3 篇最相关论文的标题、摘要、作者和链接。" +
      "适用于：文献调研、了解某个研究方向的最新进展、查找特定论文。",

    // TypeBox schema：定义 LLM 可以传的参数
    parameters: Type.Object({
      query: Type.String({ description: "英文搜索关键词，如 'transformer attention mechanism'" }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { query } = params;

      try {
        const papers = await fetchArxiv(query);

        if (papers.length === 0) {
          return {
            content: [{ type: "text", text: `未找到与 "${query}" 相关的论文。` }],
            details: {
              query,
              papers: [],
              timestamp: Date.now(),
              totalResults: 0,
            } as SearchState,
          };
        }

        // 格式化结果给 LLM 阅读
        const text = papers
          .map(
            (p, i) =>
              `[${i + 1}] ${p.title}\n` +
              `    作者: ${p.author || "N/A"}\n` +
              `    日期: ${p.published?.slice(0, 10) || "N/A"}\n` +
              `    链接: ${p.arxivUrl}\n` +
              `    摘要: ${p.summary.slice(0, 300)}...`,
          )
          .join("\n\n");

        return {
          content: [
            {
              type: "text",
              text: `找到 ${papers.length} 篇关于 "${query}" 的论文：\n\n${text}`,
            },
          ],
          // 🔑 把状态存入 details，pi 自动持久化到 session
          details: {
            query,
            papers,
            timestamp: Date.now(),
            totalResults: papers.length,
          } as SearchState,
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `搜索出错: ${err.message}` }],
          details: { query, papers: [], timestamp: Date.now(), totalResults: 0 } as SearchState,
        };
      }
    },

    // ── 自定义渲染：让工具调用在 TUI 中清晰可见 ──────────

    /**
     * 🔑 renderCall：每次 LLM 调用这个工具时，在终端显示什么
     */
    renderCall(args, theme, _context) {
      const query = args.query as string;
      return new Text(
        theme.fg("toolTitle", theme.bold("🔍 search_arxiv ")) + theme.fg("muted", `"${query}"`),
        0,
        0,
      );
    },

    /**
     * 🔑 renderResult：工具执行完显示什么（折叠/展开状态不同）
     */
    renderResult(result, { expanded }, theme, _context) {
      const details = result.details as SearchState | undefined;
      if (!details) {
        return new Text(theme.fg("dim", "无结果"), 0, 0);
      }

      if (details.papers.length === 0) {
        return new Text(theme.fg("warning", `未找到关于 "${details.query}" 的论文`), 0, 0);
      }

      // 折叠状态：只显示一行摘要
      if (!expanded) {
        return new Text(
          theme.fg("success", `✓ 找到 ${details.papers.length} 篇`) +
            " " +
            theme.fg("dim", `关于 "${details.query}" — ${details.papers.map((p) => p.title.slice(0, 30)).join(", ")}...`),
          0,
          0,
        );
      }

      // 展开状态：显示详细信息
      let text = theme.fg("success", `✓ 找到 ${details.papers.length} 篇论文\n`);
      for (let i = 0; i < details.papers.length; i++) {
        const p = details.papers[i];
        text += `\n${theme.fg("accent", theme.bold(`[${i + 1}] ${p.title}`))}`;
        text += `\n  ${theme.fg("dim", "作者:")} ${p.authors || "N/A"}`;
        text += `\n  ${theme.fg("dim", "日期:")} ${p.published?.slice(0, 10) || "N/A"}`;
        text += `\n  ${theme.fg("dim", "链接:")} ${p.arxivUrl}`;
        text += `\n  ${theme.fg("dim", "摘要:")} ${p.summary.slice(0, 200)}...`;
      }

      return new Text(text, 0, 0);
    },
  });

  // ── 生命周期：状态恢复 ────────────────────────────────────

  /**
   * 🔑 session_start：每次 session 启动/切换时重建状态
   * session_tree：用户在 /tree 中跳转分支后也要重建
   */
  pi.on("session_start", async (_event, ctx) => {
    cwd = ctx.cwd;
    reconstructState(ctx);

    ctx.ui.notify(
      `📚 Paper Agent 已就绪 | 当前状态: ${searchHistory.length} 次搜索历史`,
      "info",
    );
  });

  pi.on("session_tree", async (_event, ctx) => {
    cwd = ctx.cwd;
    reconstructState(ctx);

    ctx.ui.notify(
      `🌲 分支切换 | 当前分支状态: ${searchHistory.length} 次搜索历史`,
      "info",
    );
  });
}
