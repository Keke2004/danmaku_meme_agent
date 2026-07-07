你是一个资深的 Python 后端专家。请根据以下产品需求，编写一个结构清晰、开箱即用的 FastAPI 核心后端单文件代码（`main.py`）。

---

## 一、核心业务逻辑与 API 接口设计

我们需要实现一个名为“梗小虎”的直播助手工具后端，主要包含以下三个核心功能，请在一个 Python 文件中完整实现：

### 1. 弹幕接收与高频词识别 (`POST /api/danmaku/stream`)
- **功能**：接收模拟的弹幕流，将其写入内存队列（保留最近 5 分钟），并实时统计高频词。
- **输入**：`{ "streamer_id": "string", "username": "string", "content": "string" }`
- **输出**：返回当前弹幕是否触发热度阈值，并返回当前排名前 5 的高频弹幕候选词。

### 2. 联网梗百科解释与机器人广播 (`POST /api/meme/explain`)
- **功能**：用户或主播点击某条弹幕触发此接口。
- **逻辑**：
  1. 接收弹幕文本。
  2. 调用 **Tavily API**（使用 `requests` 请求 `https://api.tavily.com/search`，并通过 `api_key` 获取检索摘要）检索该词的最新网络释义。
  3. 将搜索结果送入 **LLM**（使用 `openai` 库，调用 `gpt-4o-mini`）。
  4. **LLM 提示词要求**：如果搜索结果能明确解释该梗，请用极其风趣、接地气、简短（80字以内）的语言输出解释（包含“含义”和“来源”）；**【重要】如果联网未检索到该梗，或者 LLM 判断其不是一个网络梗，则必须统一回复固定提示语：“梗小虎还没学会这个梗，正在努力修行中……”**。
  5. 模拟弹幕机器人广播：在返回体中附带一个 `bot_broadcast` 字段，模拟机器人将解释自动发送给全体观众。
- **输入**：`{ "streamer_id": "string", "barrage": "string" }`
- **输出**：`{ "found": bool, "explanation": "string", "bot_broadcast": "string" }`

### 3. 主播专属接梗/回梗助手 (`POST /api/meme/respond`)
- **功能**：主播点击“回梗”或“接梗助手”时触发。
- **逻辑**：
  - 根据当前弹幕、其梗百科解释以及主播的风格人设（默认提供一个搞笑幽默的主播人设），让 LLM 生成三类**口语化、极简短（每条不超过 20 字）**的回复建议：
    1. **稳妥版**：安全不踩雷，大方得体。
    2. **幽默版**：符合主播搞笑风格，自黑或顺杆爬。
    3. **互动版**：反问观众，引导弹幕继续刷屏。
- **输入**：`{ "streamer_id": "string", "barrage": "string", "explanation": "string" }`
- **输出**：`{ "safe": "string", "humorous": "string", "interactive": "string" }`

---

## 二、技术栈与依赖要求
请在代码开头以注释形式写明安装依赖的命令：
```bash
pip install fastapi uvicorn openai pydantic requests
```
## 三、代码实现规范

### 1. 单文件闭环：所有路由、Pydantic 协议、LLM 调用和内存数据结构均写在 main.py 中，方便一键运行。
### 2. 环境变量：从 os.getenv("OPENAI_API_KEY") 读取 API Key，并提供基础的异常处理（如未配置 Key 时的友好提示）。
### 3. Mock 数据：在内存中维护一个简单的 streamer_profiles 字典，用于读取主播的人设风格。
### 4. 日志输出：在控制台打印出“机器人已向直播间广播：xxx”的日志，以直观展示广播效果。

---
