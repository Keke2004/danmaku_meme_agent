"""
Install dependencies:
    pip install fastapi uvicorn openai pydantic requests
    source /Users/ericzhou/Desktop/team03/danmaku_meme_agent/tool_venv/bin/activate
    python /Users/ericzhou/Desktop/team03/danmaku_meme_agent/main.py --cli-test
"""

from __future__ import annotations

import argparse
import json
import os
import re
from collections import Counter, defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import APIStatusError, OpenAI
from pydantic import BaseModel, Field


APP_NAME = "梗小虎直播助手后端"
WINDOW_MINUTES = 5
HOT_THRESHOLD = 5
FALLBACK_TEXT = "梗小虎还没学会这个梗，正在努力修行中……"
DEFAULT_STYLE = "搞笑幽默、反应快、会自黑、懂直播互动节奏"
TAVILY_SEARCH_URL = "https://api.tavily.com/search"
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "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")
OPENAI_BASE_URL = "https://copilot.huya.info/api/openai/v1/"
DEFAULT_CHAT_MODEL = os.getenv("OPENAI_CHAT_MODEL", "openai/gpt-5-chat")
DEFAULT_OPENAI_API_KEY = "sk-ZY3dCZmNa5mSe-LR2l0hXQ"

app = FastAPI(title=APP_NAME)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class DanmakuStreamIn(BaseModel):
    streamer_id: str = Field(..., min_length=1)
    username: str = Field(..., min_length=1)
    content: str = Field(..., min_length=1)


class DanmakuStreamOut(BaseModel):
    triggered: bool
    top_candidates: list[dict[str, Any]]


class MemeExplainIn(BaseModel):
    streamer_id: str = Field(..., min_length=1)
    barrage: str = Field(..., min_length=1)
    api_key: Optional[str] = None
    model: Optional[str] = None


class MemeExplainOut(BaseModel):
    found: bool
    search_context: str
    explanation: str
    bot_broadcast: str


class MemeRespondIn(BaseModel):
    streamer_id: str = Field(..., min_length=1)
    barrage: str = Field(..., min_length=1)
    explanation: str = Field(..., min_length=1)
    api_key: Optional[str] = None
    model: Optional[str] = None


class MemeRespondOut(BaseModel):
    safe: str
    humorous: str
    interactive: str


class QuickTestIn(BaseModel):
    barrage: str = Field(..., min_length=1, description="待测试梗文本")
    streamer_id: str = Field(default="default", min_length=1)
    api_key: Optional[str] = Field(default=None, description="可选，优先使用请求内 API Key")
    model: Optional[str] = Field(default=None, description="可选，默认 openai/gpt-5-chat")


class QuickTestOut(BaseModel):
    found: bool
    search_context: str
    explanation: str
    bot_broadcast: str
    safe: str
    humorous: str
    interactive: str


# 简单内存弹幕队列：每个主播保留最近5分钟。
danmaku_store: dict[str, deque[tuple[datetime, str, str]]] = defaultdict(deque)

# 模拟主播人设。
streamer_profiles: dict[str, str] = {
    "default": DEFAULT_STYLE,
    "xiaohu": "嘴贫段子手，爱整活，偶尔一本正经反差萌",
    "laoli": "成熟稳重但会冷幽默，擅长引导观众讨论",
}


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _trim_old_messages(streamer_id: str) -> None:
    queue = danmaku_store[streamer_id]
    cutoff = _now_utc() - timedelta(minutes=WINDOW_MINUTES)
    while queue and queue[0][0] < cutoff:
        queue.popleft()


def _extract_terms(text: str) -> list[str]:
    text = text.strip().lower()
    if not text:
        return []

    terms: list[str] = []
    chinese_chunks = re.findall(r"[\u4e00-\u9fff]{2,}", text)
    english_chunks = re.findall(r"[a-z0-9_]{2,}", text)

    terms.extend(chinese_chunks)
    terms.extend(english_chunks)

    if not terms:
        compact = re.sub(r"\s+", "", text)
        if compact:
            terms.append(compact[:20])

    return terms


def _build_top_candidates(streamer_id: str) -> tuple[bool, list[dict[str, Any]]]:
    _trim_old_messages(streamer_id)
    queue = danmaku_store[streamer_id]

    counter: Counter[str] = Counter()
    for _, _, content in queue:
        counter.update(_extract_terms(content))

    top5 = [{"word": word, "count": cnt} for word, cnt in counter.most_common(5)]
    triggered = bool(top5 and top5[0]["count"] >= HOT_THRESHOLD)
    return triggered, top5


def _get_openai_client(override_api_key: Optional[str] = None) -> OpenAI:
    api_key = (
        (override_api_key or "").strip()
        or os.getenv("OPENAI_API_KEY")
        or DEFAULT_OPENAI_API_KEY
    )
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="未检测到 OpenAI API Key。请配置 OPENAI_API_KEY 或在请求体里传入 api_key。",
        )
    return OpenAI(api_key=api_key, base_url=OPENAI_BASE_URL)


def _resolve_chat_model(override_model: Optional[str] = None) -> str:
    model = (override_model or "").strip() or DEFAULT_CHAT_MODEL
    return model


def _create_chat_completion(
    client: OpenAI,
    chat_model: str,
    temperature: float,
    messages: list[dict[str, str]],
    token_limit: int,
):
    """兼容不同网关/模型的 token 参数差异。"""
    base_args = {
        "model": chat_model,
        "messages": messages,
    }

    def _raise_access_denied(exc: APIStatusError) -> None:
        raise HTTPException(
            status_code=403,
            detail=(
                f"当前模型不可用：{chat_model}。"
                "请改用团队可访问模型，并在请求体传 model，"
                "或设置环境变量 OPENAI_CHAT_MODEL。"
            ),
        ) from exc

    def _is_temp_unsupported(err_text: str) -> bool:
        return (
            "temperature" in err_text
            and (
                "unsupported value" in err_text
                or "unsupported parameter" in err_text
                or "does not support" in err_text
            )
        )

    def _is_mct_unsupported(err_text: str) -> bool:
        return (
            "max_completion_tokens" in err_text
            and "unsupported parameter" in err_text
        )

    def _request(use_temperature: bool, use_mct: bool):
        req_args: dict[str, Any] = dict(base_args)
        if use_temperature:
            req_args["temperature"] = temperature
        token_field = "max_completion_tokens" if use_mct else "max_tokens"
        req_args[token_field] = token_limit
        return client.chat.completions.create(**req_args)

    # 尝试顺序：
    # 1) temperature + max_completion_tokens
    # 2) temperature + max_tokens
    # 3) default temperature + max_completion_tokens
    # 4) default temperature + max_tokens
    attempts = [
        (True, True),
        (True, False),
        (False, True),
        (False, False),
    ]
    attempted: set[tuple[bool, bool]] = set()
    last_exc: Optional[APIStatusError] = None

    while attempts:
        use_temperature, use_mct = attempts.pop(0)
        attempt_key = (use_temperature, use_mct)
        if attempt_key in attempted:
            continue
        attempted.add(attempt_key)

        try:
            return _request(use_temperature, use_mct)
        except APIStatusError as exc:
            last_exc = exc
            err_text = str(exc).lower()

            if exc.status_code == 403:
                _raise_access_denied(exc)

            if exc.status_code != 400:
                raise

            # 参数不兼容时继续尝试其他组合。
            if _is_temp_unsupported(err_text) or _is_mct_unsupported(err_text):
                continue

            raise

    if last_exc is not None:
        raise last_exc
    raise HTTPException(status_code=500, detail="模型调用失败：未知错误。")


def _search_meme_context(keyword: str) -> str:
    keyword = keyword.strip()
    if not keyword:
        return ""

    if not TAVILY_API_KEY.strip():
        return "Tavily API Key 未配置，无法联网检索。"

    payload = {
        "api_key": TAVILY_API_KEY,
        "query": keyword,
        "search_depth": "advanced",
        "max_results": 5,
        "include_answer": False,
        "include_raw_content": False,
    }
    headers = {"Content-Type": "application/json"}

    try:
        response = requests.post(
            TAVILY_SEARCH_URL,
            headers=headers,
            json=payload,
            timeout=12,
        )
        response.raise_for_status()
    except Exception:
        return "Tavily 请求失败，未获取到可用搜索摘要。"

    try:
        data = response.json()
    except Exception:
        return "Tavily 返回解析失败，未获取到可用搜索摘要。"

    api_error = data.get("error")
    if api_error:
        return f"Tavily 检索失败：{api_error}"

    snippets: list[str] = []
    for item in (data.get("results") or [])[:5]:
        title = str(item.get("title", "")).strip()
        content = str(item.get("content", "")).strip()
        url = str(item.get("url", "")).strip()
        parts = [x for x in [title, content, url] if x]
        merged = " | ".join(parts).strip()
        if merged:
            snippets.append(merged)

    if not snippets:
        answer = str(data.get("answer", "")).strip()
        if answer:
            snippets.append(answer)

    if not snippets:
        return "Tavily 未返回可解析摘要。"

    # 去重并截断，避免把重复结果塞给 LLM。
    deduped: list[str] = []
    seen: set[str] = set()
    for item in snippets:
        normalized = re.sub(r"\s+", " ", item).strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(normalized)
        if len(deduped) >= 5:
            break

    return "\n".join(deduped)[:2000]


def _call_llm_for_explanation(
    barrage: str,
    search_text: str,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
) -> str:
    client = _get_openai_client(api_key)
    chat_model = _resolve_chat_model(model)

    system_prompt = (
        "你是直播助手“梗小虎”。请判断输入是否为网络梗，并输出最终回答。"
        "规则：\n"
        f"1) 若检索结果不足以明确解释，或不是网络梗，必须只输出：{FALLBACK_TEXT}\n"
        "2) 若能解释，输出风趣接地气的简短中文（80字以内），且同时包含“含义”和“来源”。\n"
        "3) 不要输出额外说明，不要使用 markdown。"
    )
    user_prompt = (
        f"弹幕：{barrage}\n"
        f"联网检索结果：{search_text if search_text else '（空）'}\n"
        "请按规则给出最终回答。"
    )

    resp = _create_chat_completion(
        client=client,
        chat_model=chat_model,
        temperature=0.4,
        token_limit=180,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    content = (resp.choices[0].message.content or "").strip()
    if not content:
        return FALLBACK_TEXT
    if FALLBACK_TEXT in content:
        return FALLBACK_TEXT
    return content[:80]


def _call_llm_for_responses(
    barrage: str,
    explanation: str,
    style: str,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
) -> dict[str, str]:
    client = _get_openai_client(api_key)
    chat_model = _resolve_chat_model(model)

    system_prompt = (
        "你是直播文案助手。请给主播生成三条口语化回复，每条<=20个汉字，不能低俗攻击。"
        "请严格输出 JSON 对象，键为 safe, humorous, interactive。"
        "不要输出其他文字。"
    )
    user_prompt = (
        f"主播人设：{style}\n"
        f"当前弹幕：{barrage}\n"
        f"梗解释：{explanation}\n"
        "生成三条回复：\n"
        "- safe：稳妥版\n"
        "- humorous：幽默版\n"
        "- interactive：互动版"
    )

    resp = _create_chat_completion(
        client=client,
        chat_model=chat_model,
        temperature=0.8,
        token_limit=180,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    raw = (resp.choices[0].message.content or "").strip()
    if raw.startswith("```"):
        raw = raw.strip("`").replace("json\n", "", 1).strip()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = {
            "safe": "这梗我先稳住",
            "humorous": "你们是真会整活",
            "interactive": "还知道啥梗快刷",
        }

    result = {
        "safe": str(data.get("safe", "这梗我先稳住"))[:20],
        "humorous": str(data.get("humorous", "你们是真会整活"))[:20],
        "interactive": str(data.get("interactive", "还知道啥梗快刷"))[:20],
    }
    return result


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "app": APP_NAME}


@app.post("/api/danmaku/stream", response_model=DanmakuStreamOut)
def danmaku_stream(payload: DanmakuStreamIn) -> DanmakuStreamOut:
    queue = danmaku_store[payload.streamer_id]
    queue.append((_now_utc(), payload.username, payload.content.strip()))

    triggered, top_candidates = _build_top_candidates(payload.streamer_id)
    return DanmakuStreamOut(triggered=triggered, top_candidates=top_candidates)


@app.post("/api/meme/explain", response_model=MemeExplainOut)
def meme_explain(payload: MemeExplainIn) -> MemeExplainOut:
    search_text = _search_meme_context(payload.barrage)
    explanation = _call_llm_for_explanation(
        payload.barrage,
        search_text,
        api_key=payload.api_key,
        model=payload.model,
    )

    found = explanation != FALLBACK_TEXT
    bot_broadcast = explanation
    print(f"机器人已向直播间广播：{bot_broadcast}")

    return MemeExplainOut(
        found=found,
        search_context=search_text,
        explanation=explanation,
        bot_broadcast=bot_broadcast,
    )


@app.post("/api/meme/respond", response_model=MemeRespondOut)
def meme_respond(payload: MemeRespondIn) -> MemeRespondOut:
    style = streamer_profiles.get(payload.streamer_id, streamer_profiles["default"])
    suggestions = _call_llm_for_responses(
        barrage=payload.barrage,
        explanation=payload.explanation,
        style=style,
        api_key=payload.api_key,
        model=payload.model,
    )
    return MemeRespondOut(**suggestions)


@app.post("/api/test/quick", response_model=QuickTestOut)
def quick_test(payload: QuickTestIn) -> QuickTestOut:
    """测试专用：直接输入梗文本（和可选 api_key）返回解释+回梗建议。"""
    search_text = _search_meme_context(payload.barrage)
    explanation = _call_llm_for_explanation(
        barrage=payload.barrage,
        search_text=search_text,
        api_key=payload.api_key,
        model=payload.model,
    )
    found = explanation != FALLBACK_TEXT
    bot_broadcast = explanation
    print(f"机器人已向直播间广播：{bot_broadcast}")

    style = streamer_profiles.get(payload.streamer_id, streamer_profiles["default"])
    suggestions = _call_llm_for_responses(
        barrage=payload.barrage,
        explanation=explanation,
        style=style,
        api_key=payload.api_key,
        model=payload.model,
    )

    return QuickTestOut(
        found=found,
        search_context=search_text,
        explanation=explanation,
        bot_broadcast=bot_broadcast,
        **suggestions,
    )


def run_cli_test_mode() -> None:
    """命令行交互测试：先输入 API Key，再输入梗文本查看返回。"""
    print("=== 梗小虎测试模式 ===")
    api_key = input("请输入 OpenAI API Key（直接回车使用默认值）: ").strip() or DEFAULT_OPENAI_API_KEY
    streamer_id = "default"
    model = "openai/gpt-5-chat"
    print(f"已使用默认 streamer_id：{streamer_id}")
    print(f"已使用默认模型：{model}")
    print("已进入测试，输入梗文本开始测试；输入 q 退出。")

    while True:
        barrage = input("\n请输入梗文本: ").strip()
        if barrage.lower() in {"q", "quit", "exit"}:
            print("测试结束。")
            break
        if not barrage:
            print("梗文本不能为空，请重新输入。")
            continue

        payload = QuickTestIn(
            barrage=barrage,
            streamer_id=streamer_id,
            api_key=api_key,
            model=model,
        )
        try:
            result = quick_test(payload)
            print("Tavily 检索结果：")
            print(result.search_context if result.search_context else "（未检索到有效 Tavily 摘要）")
            print("测试结果：")
            print(json.dumps(result.model_dump(), ensure_ascii=False, indent=2))
        except HTTPException as exc:
            print(f"请求失败（{exc.status_code}）：{exc.detail}")
        except Exception as exc:  # pragma: no cover - runtime/network level fallback
            print(f"请求异常：{exc}")


if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser(description=APP_NAME)
    parser.add_argument(
        "--cli-test",
        action="store_true",
        help="进入命令行测试模式（先输入 API Key，再输入梗文本）。",
    )
    args = parser.parse_args()

    if args.cli_test:
        run_cli_test_mode()
    else:
        uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
