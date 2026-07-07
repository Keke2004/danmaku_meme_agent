# 梗小虎直播助手后端

单文件 FastAPI 后端：`main.py`。

## 1. 主要功能

### 1.1 弹幕接收与高频词识别
- 接口：`POST /api/danmaku/stream`
- 输入：`streamer_id`、`username`、`content`
- 功能：
  - 将弹幕写入内存队列（每个主播保留最近 5 分钟）
  - 统计当前窗口内高频候选词（Top 5）
  - 当第一名词频达到阈值（默认 5）时，`triggered = true`
- 输出：`triggered`、`top_candidates`

### 1.2 联网梗解释与机器人广播
- 接口：`POST /api/meme/explain`
- 输入：`streamer_id`、`barrage`，可选 `api_key`、`model`
- 功能：
  - 先进行知识库两级匹配（见 1.6）
  - 若知识库命中，直接返回解释，跳过联网检索与 LLM
  - 若知识库未命中，再使用 Tavily API（`https://api.tavily.com/search`）检索并提取结果摘要，形成 `search_context`
  - 将检索内容送入 LLM 生成梗解释
  - 若 LLM 返回有效解释（非固定兜底文案），自动回写知识库
  - 返回机器人广播文案并打印日志：`机器人已向直播间广播：xxx`
- 输出：`found`、`search_context`、`explanation`、`bot_broadcast`

### 1.6 知识库匹配（新增）
- 存储文件：`meme_knowledge_base.json`（与 `main.py` 同目录）
- 生效流程：每次 `meme/explain` 会先匹配知识库，再决定是否走搜索+LLM

两级匹配策略：
1. 一级缓存（精确/前缀）
- 使用内存哈希表（Dictionary）
- 精确命中：`O(1)` 查找
- 前缀命中：对输入生成前缀并进行哈希查表

2. 二级模糊（Fuzzy）
- 使用 Levenshtein 编辑距离计算相似度
- 默认阈值：`0.86`（可通过环境变量 `MEME_FUZZY_THRESHOLD` 调整）
- 用于容错错别字、漏字（如“肉蛋葱鸡”/“肉蛋葱机”）

自动回写规则：
- 当知识库未命中并走了搜索+LLM后：
  - 若 LLM 返回不是 `梗小虎还没学会这个梗，正在努力修行中……`，则写入知识库
  - 写入格式：JSON `items` 数组中的对象，字段含 `key`、`value`、`updated_at`
- 若返回固定兜底文案，不写入知识库

兼容说明：
- 若历史存在 `meme_knowledge_base.csv`，服务会在首次读取知识库时自动迁移到 `meme_knowledge_base.json`
- 迁移完成后，后续新增与更新只写入 JSON 文件

### 1.3 主播回梗建议
- 接口：`POST /api/meme/respond`
- 输入：`streamer_id`、`barrage`、`explanation`，可选 `api_key`、`model`
- 功能：根据主播人设生成三类超短回复
  - `safe`：稳妥版
  - `humorous`：幽默版
  - `interactive`：互动版
- 输出：`safe`、`humorous`、`interactive`

### 1.4 一站式测试接口
- 接口：`POST /api/test/quick`
- 输入：`barrage`，可选 `streamer_id`、`api_key`、`model`
- 功能：一次调用完成“Tavily 检索 + 梗解释 + 回梗建议”
- 输出：`found`、`search_context`、`explanation`、`bot_broadcast`、`safe`、`humorous`、`interactive`

### 1.5 CLI 交互测试
启动：
```bash
source /Users/ericzhou/Desktop/team03/danmaku_meme_agent/tool_venv/bin/activate
python /Users/ericzhou/Desktop/team03/danmaku_meme_agent/main.py --cli-test
```
流程：
1. 输入 OpenAI API Key（可直接回车使用默认值）
2. 系统自动使用默认 `streamer_id=default`
3. 系统自动使用默认模型 `openai/gpt-5-chat`
4. 循环输入梗文本，立即看到：
   - Tavily 检索结果（`search_context`）
   - 最终 JSON 测试结果

Tavily Key 说明：
- 代码中默认读取 `TAVILY_API_KEY` 环境变量。
- 当前版本内置了开发 key 兜底值，便于快速联调。

OpenAI Key 说明：
- 代码优先使用请求体 `api_key`，其次读取 `OPENAI_API_KEY` 环境变量。
- 若都未提供，使用代码内默认 key（仅用于快速测试）。

## 2. 什么时候会回复“梗小虎还没学会这个梗，正在努力修行中……”

固定兜底文案：
`梗小虎还没学会这个梗，正在努力修行中……`

出现条件（代码与提示词共同作用）：
1. 联网检索内容不足，无法支持明确解释该梗（提示词要求 LLM 返回兜底文案）
2. LLM 判断输入并非网络梗（提示词要求 LLM 返回兜底文案）
3. LLM 返回空内容（代码强制替换为兜底文案）
4. LLM 回复中包含该固定兜底文案（代码统一归一为该文案）

`found` 字段规则：
- `found = false`：`explanation` 等于固定兜底文案
- `found = true`：`explanation` 不等于固定兜底文案

## 3. 模型与参数兼容策略

为兼容不同网关/模型，代码会自动重试组合：
- `temperature + max_completion_tokens`
- `temperature + max_tokens`
- `default temperature + max_completion_tokens`
- `default temperature + max_tokens`

如果模型无权限（403），会返回明确错误提示，要求更换为团队可访问模型。

## 4. 依赖安装

```bash
pip install fastapi uvicorn openai pydantic requests
```

## 5. 启动服务

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
