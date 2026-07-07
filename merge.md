# 前后端合并规划（`index.html` + `script.js` + `style.css` 对接 `main.py`）

## 1. 目标与范围
- 目标：将当前前端的 mock 交互替换为真实后端能力，保留现有视觉设计与交互节奏。
- 范围：
- 弹幕发送与热词识别接入 `/api/danmaku/stream`
- 梗解释弹窗接入 `/api/meme/explain`
- 回梗建议接入 `/api/meme/respond`
- 不修改后端业务逻辑，仅做前端接入与必要 UI 补位

## 2. 现状梳理
- 前端现状：
- `script.js` 当前使用本地规则 `aiExplainRules` + `explainTemplates` 生成假解释
- 点击弹幕后弹出 popover，再点击“梗解释”打开 modal
- 发送弹幕只在前端本地渲染，不调用后端
- 后端现状：
- 已有接口：`/health`、`/api/danmaku/stream`、`/api/meme/explain`、`/api/meme/respond`、`/api/test/quick`
- `/api/meme/explain` 已返回 `search_context`
- 后端已有默认 API Key、默认模型与 streamer 兜底，前端可先不暴露敏感配置

## 3. 接口映射方案
- 弹幕发送（手动输入后点击发送）
- 调用：`POST /api/danmaku/stream`
- 请求：`{ streamer_id, username, content }`
- 响应使用：
- `triggered`：更新热度状态（例如 heat-pill 样式）
- `top_candidates`：展示在侧边区域（新增“当前热词”小面板）
- 梗解释（点击弹幕 -> 点击“梗解释”）
- 调用：`POST /api/meme/explain`
- 请求：`{ streamer_id, barrage }`
- 响应使用：
- `explanation`：填充 `modal-desc`
- `search_context`：填充 `modal-note` 或新增“检索来源摘要”区块
- `bot_broadcast`：发一条“机器人弹幕”进入飘屏和聊天区
- 回梗建议（解释完成后自动触发）
- 调用：`POST /api/meme/respond`
- 请求：`{ streamer_id, barrage, explanation }`
- 响应使用：
- `safe` / `humorous` / `interactive`：展示为 3 个可点击建议按钮
- 点击建议按钮后自动发送为“你”的新弹幕

## 4. 前端代码改造点
- `script.js`
- 新增 `API_BASE` 配置（默认同域，可切换 `http://127.0.0.1:8000`）
- 新增统一请求函数 `requestJson(url, payload)`（超时、错误提示、状态码处理）
- 改造 `submitMessage`：本地渲染后补发后端请求并刷新热词/热度
- 改造 `showModal` 流程：由本地模板改为异步请求后端解释
- 新增“解释中 loading”与“请求失败 fallback 文案”
- `index.html`
- 在解释弹窗新增两个信息区：
- “检索摘要（search_context）”
- “回梗建议（safe/humorous/interactive）”
- 可复用现有 `explain-note` 与 footer 区域，尽量少改结构
- `style.css`
- 增加建议按钮组与检索摘要区样式
- 增加 loading / disabled / error 状态样式

## 5. 交互与状态流
- 状态字段建议（前端内存）
- `activeStreamerId`：默认 `default`
- `selectedDanmakuText`
- `latestExplanation`、`latestSearchContext`
- `latestSuggestions`
- 关键交互顺序
- 用户点弹幕 -> 弹出 popover
- 点“梗解释” -> 打开 modal + loading
- 拉取 explain 成功 -> 展示 explanation + search_context + bot_broadcast
- 自动请求 respond -> 展示 3 条回梗建议
- 点任一建议 -> 直接发送弹幕并写入聊天

## 6. 错误处理与降级策略
- 网络失败或后端 5xx：
- modal 中显示“请求失败，请稍后再试”
- 保留当前本地模板作为最后兜底（可配置开关）
- explain 返回 `found=false`：
- 正常展示固定文案，不报错
- 仍可请求 respond，保证主播有可用建议
- 空 `search_context`：
- 展示“暂无检索摘要”占位文案

## 7. 联调与验收清单
- 联调前检查
- `/health` 可访问
- 浏览器与后端跨域策略可用（同域或启用 CORS）
- 功能验收
- 手动发送弹幕能触发 `/api/danmaku/stream`
- 点击弹幕后能拿到 explain 并写入 modal
- modal 中可看到 `search_context`
- 回梗建议 3 条可展示并可一键发送
- 机器人广播能同步进入弹幕区/聊天区
- 视觉验收
- 移动端和桌面端弹窗不溢出
- loading/error/成功状态样式完整

## 8. 实施顺序（建议）
- 第一步：加请求封装与 API_BASE，打通 `/health`、`/api/meme/explain`
- 第二步：替换 modal 的 mock 解释为真实返回
- 第三步：接入 `/api/meme/respond` 并渲染 3 条建议
- 第四步：接入 `/api/danmaku/stream` 与热词面板
- 第五步：统一错误处理与样式细节、完成回归测试

## 9. 本次规划后的下一步
- 你确认本规划后，我将按上述顺序开始实际改动 `index.html`、`script.js`、`style.css`，并完成一次本地联调演示。
