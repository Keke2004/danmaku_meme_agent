"""
Install dependencies:
    pip install fastapi uvicorn openai pydantic requests
    source /Users/ericzhou/Desktop/team03/danmaku_meme_agent/tool_venv/bin/activate
    python /Users/ericzhou/Desktop/team03/danmaku_meme_agent/main.py --cli-test
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
from collections import Counter, defaultdict, deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock
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
KB_FILE_PATH = Path(__file__).with_name("meme_knowledge_base.json")
KB_LEGACY_CSV_PATH = Path(__file__).with_name("meme_knowledge_base.csv")
FUZZY_MATCH_THRESHOLD = float(os.getenv("MEME_FUZZY_THRESHOLD", "0.86"))
MIN_FUZZY_KEY_LEN = 2

app = FastAPI(title=APP_NAME)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _log_startup_info() -> None:
    _kb_log(f"当前知识库文件：{KB_FILE_PATH.resolve()}")


def _kb_log(message: str) -> None:
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[KB][{timestamp}] {message}", flush=True)


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
    user_id: Optional[str] = None


class MemeExplainOut(BaseModel):
    found: bool
    search_context: str
    explanation: str
    bot_broadcast: str
    kb_key: Optional[str] = None
    avg_score: Optional[float] = None
    rating_count: int = 0
    user_score: Optional[int] = None
    rating_enabled: bool = False


class MemeRateIn(BaseModel):
    streamer_id: str = Field(..., min_length=1)
    barrage: str = Field(..., min_length=1)
    score: int
    user_id: str = Field(..., min_length=1, max_length=80)
    kb_key: Optional[str] = None


class MemeRateOut(BaseModel):
    kb_key: str
    avg_score: Optional[float]
    rating_count: int
    user_score: int


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


# 梗知识库：一级（精确/前缀）+ 二级（模糊）都基于内存结构。
_kb_lock = Lock()
_kb_exact: dict[str, str] = {}
_kb_keys: list[str] = []
_kb_entries: list[dict[str, Any]] = []
_kb_entry_index: dict[str, int] = {}
_kb_last_mtime: Optional[float] = None
VALID_RATING_SCORES = {2, 4, 6, 8, 10}


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


def _normalize_kb_key(text: str) -> str:
    normalized = str(text or "").strip().lower()
    if not normalized:
        return ""
    compact = re.sub(r"\s+", "", normalized)
    canonical = re.sub(r"[^\w\u4e00-\u9fff]+", "", compact)
    if canonical:
        return canonical[:120]
    # 兼容“纯表情/符号梗”：若 canonical 为空，则回退到去空白后的原文。
    return compact[:120]


def _levenshtein_distance(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)

    if len(a) < len(b):
        a, b = b, a

    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        current = [i]
        for j, cb in enumerate(b, start=1):
            insert_cost = current[j - 1] + 1
            delete_cost = previous[j] + 1
            replace_cost = previous[j - 1] + (0 if ca == cb else 1)
            current.append(min(insert_cost, delete_cost, replace_cost))
        previous = current
    return previous[-1]


def _similarity_ratio(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    max_len = max(len(a), len(b))
    if max_len == 0:
        return 0.0
    distance = _levenshtein_distance(a, b)
    return 1.0 - (distance / max_len)


def _normalize_user_id(user_id: Optional[str]) -> str:
    raw = str(user_id or "").strip()
    if not raw:
        return ""
    compact = re.sub(r"\s+", "", raw)
    return compact[:80]


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _normalize_score(value: Any) -> Optional[int]:
    score = _safe_int(value, -1)
    if score in VALID_RATING_SCORES:
        return score
    return None


def _extract_rating_state(record: dict[str, Any]) -> tuple[float, int, dict[str, int]]:
    rating_total = max(0.0, _safe_float(record.get("rating_total"), 0.0))
    rating_count = max(0, _safe_int(record.get("rating_count"), 0))

    ratings_by_user: dict[str, int] = {}
    raw_ratings = record.get("ratings_by_user")
    if isinstance(raw_ratings, dict):
        for raw_uid, raw_score in raw_ratings.items():
            uid = _normalize_user_id(raw_uid)
            score = _normalize_score(raw_score)
            if not uid or score is None:
                continue
            ratings_by_user[uid] = score

    # 若历史数据只有 ratings_by_user，没有 total/count，则自动补齐。
    if ratings_by_user and (rating_count <= 0 or rating_total <= 0):
        rating_total = float(sum(ratings_by_user.values()))
        rating_count = len(ratings_by_user)

    if rating_count == 0:
        rating_total = 0.0
    return float(round(rating_total, 4)), rating_count, ratings_by_user


def _rating_summary_from_entry(
    entry: Optional[dict[str, Any]], user_id: Optional[str] = None
) -> dict[str, Any]:
    if not entry:
        return {"avg_score": None, "rating_count": 0, "user_score": None}

    rating_total = max(0.0, _safe_float(entry.get("rating_total"), 0.0))
    rating_count = max(0, _safe_int(entry.get("rating_count"), 0))
    avg_score = round(rating_total / rating_count, 2) if rating_count > 0 else None

    user_score: Optional[int] = None
    uid = _normalize_user_id(user_id)
    if uid:
        raw_user_ratings = entry.get("ratings_by_user")
        if isinstance(raw_user_ratings, dict):
            user_score = _normalize_score(raw_user_ratings.get(uid))

    return {
        "avg_score": avg_score,
        "rating_count": rating_count,
        "user_score": user_score,
    }


def _build_kb_state_from_records(
    records: list[dict[str, Any]],
) -> tuple[dict[str, str], list[str], list[dict[str, Any]], dict[str, int]]:
    mapping: dict[str, str] = {}
    keys: list[str] = []
    entries: list[dict[str, Any]] = []
    index_map: dict[str, int] = {}

    for record in records:
        key_raw = str(record.get("key", "") or "").strip()
        val_raw = str(record.get("value", "") or "").strip()
        updated_at = str(record.get("updated_at", "") or "").strip()
        rating_total, rating_count, ratings_by_user = _extract_rating_state(record)

        normalized_key = _normalize_kb_key(key_raw)
        if not normalized_key or not val_raw or val_raw == FALLBACK_TEXT:
            continue

        normalized_record = {
            "key": key_raw,
            "value": val_raw,
            "updated_at": updated_at,
            "rating_total": rating_total,
            "rating_count": rating_count,
            "ratings_by_user": ratings_by_user,
        }
        if normalized_key in index_map:
            existing_index = index_map[normalized_key]
            entries[existing_index] = normalized_record
        else:
            index_map[normalized_key] = len(entries)
            entries.append(normalized_record)
            keys.append(normalized_key)

        mapping[normalized_key] = val_raw

    return mapping, keys, entries, index_map


def _read_legacy_csv_records() -> list[dict[str, str]]:
    if not KB_LEGACY_CSV_PATH.exists():
        return []

    records: list[dict[str, str]] = []
    with KB_LEGACY_CSV_PATH.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.reader(fh)
        for idx, row in enumerate(reader):
            if not row or len(row) < 2:
                continue
            key_raw = str(row[0] or "").strip()
            val_raw = str(row[1] or "").strip()
            if idx == 0 and key_raw.lower() == "key" and val_raw.lower() == "value":
                continue
            updated_at = str(row[2] or "").strip() if len(row) >= 3 else ""
            records.append(
                {
                    "key": key_raw,
                    "value": val_raw,
                    "updated_at": updated_at,
                }
            )
    return records


def _persist_kb_to_disk_unlocked() -> None:
    global _kb_last_mtime

    payload = {
        "version": 1,
        "updated_at": _now_utc().isoformat(),
        "items": _kb_entries,
    }

    KB_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with KB_FILE_PATH.open("w", encoding="utf-8", newline="") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
        fh.flush()
        os.fsync(fh.fileno())

    try:
        _kb_last_mtime = KB_FILE_PATH.stat().st_mtime
    except FileNotFoundError:
        _kb_last_mtime = -1.0


def _load_kb_from_disk_unlocked() -> None:
    global _kb_exact, _kb_keys, _kb_entries, _kb_entry_index, _kb_last_mtime

    if KB_FILE_PATH.exists():
        try:
            with KB_FILE_PATH.open("r", encoding="utf-8") as fh:
                payload = json.load(fh)

            if isinstance(payload, dict):
                raw_items = payload.get("items", [])
            elif isinstance(payload, list):
                raw_items = payload
            else:
                raw_items = []

            records: list[dict[str, Any]] = []
            for item in raw_items:
                if isinstance(item, dict):
                    records.append(item)

            mapping, keys, entries, index_map = _build_kb_state_from_records(records)
            _kb_exact = mapping
            _kb_keys = keys
            _kb_entries = entries
            _kb_entry_index = index_map
            try:
                _kb_last_mtime = KB_FILE_PATH.stat().st_mtime
            except FileNotFoundError:
                _kb_last_mtime = -1.0
            return
        except Exception:
            # JSON 读取异常时，尝试迁移旧 CSV；若也失败则保留旧缓存。
            pass

    if KB_LEGACY_CSV_PATH.exists():
        try:
            legacy_records = _read_legacy_csv_records()
            mapping, keys, entries, index_map = _build_kb_state_from_records(legacy_records)
            _kb_exact = mapping
            _kb_keys = keys
            _kb_entries = entries
            _kb_entry_index = index_map
            _persist_kb_to_disk_unlocked()
            _kb_log(
                f"已从旧 CSV 自动迁移到 JSON：{KB_LEGACY_CSV_PATH.name} -> {KB_FILE_PATH.name}"
            )
            return
        except Exception:
            return

    _kb_exact = {}
    _kb_keys = []
    _kb_entries = []
    _kb_entry_index = {}
    _kb_last_mtime = -1.0


def _reload_kb_if_updated() -> None:
    with _kb_lock:
        try:
            mtime = KB_FILE_PATH.stat().st_mtime
        except FileNotFoundError:
            mtime = -1.0

        if _kb_last_mtime is None:
            _load_kb_from_disk_unlocked()
            return
        if mtime > (_kb_last_mtime or -1.0):
            _load_kb_from_disk_unlocked()
            return
        if mtime < 0 and _kb_last_mtime >= 0:
            _load_kb_from_disk_unlocked()


def _find_from_kb(barrage: str) -> Optional[dict[str, Any]]:
    normalized = _normalize_kb_key(barrage)
    if not normalized:
        return None

    _reload_kb_if_updated()
    with _kb_lock:
        exact_map = dict(_kb_exact)
        keys_snapshot = list(_kb_keys)

    # 一级：精确命中（O(1)）
    exact_value = exact_map.get(normalized)
    if exact_value:
        return {
            "hit_level": "L1_EXACT",
            "matched_key": normalized,
            "score": 1.0,
            "explanation": exact_value,
        }

    # 一级：前缀命中。通过“输入所有前缀 + 哈希查表”实现，单次查找仍为 O(1)。
    for end in range(len(normalized), 1, -1):
        prefix = normalized[:end]
        prefix_value = exact_map.get(prefix)
        if prefix_value:
            return {
                "hit_level": "L1_PREFIX",
                "matched_key": prefix,
                "score": 1.0,
                "explanation": prefix_value,
            }

    # 二级：模糊命中，容错错别字/漏字。
    if len(normalized) < MIN_FUZZY_KEY_LEN or not keys_snapshot:
        return None

    best_key = ""
    best_score = 0.0
    text_len = len(normalized)
    for key in keys_snapshot:
        # 长度差过大直接跳过，减少不必要计算。
        if abs(len(key) - text_len) > max(2, int(max(len(key), text_len) * 0.45)):
            continue
        score = _similarity_ratio(normalized, key)
        if score > best_score:
            best_key = key
            best_score = score

    if best_key and best_score >= FUZZY_MATCH_THRESHOLD:
        return {
            "hit_level": "L2_FUZZY",
            "matched_key": best_key,
            "score": round(best_score, 4),
            "explanation": exact_map[best_key],
        }
    return None


def _upsert_kb_entry(key: str, value: str) -> bool:
    global _kb_last_mtime

    clean_key = str(key or "").strip()
    clean_value = str(value or "").strip()
    normalized_key = _normalize_kb_key(clean_key)
    if not normalized_key or not clean_value or clean_value == FALLBACK_TEXT:
        if not normalized_key:
            _kb_log(f"跳过写入（key 归一化为空）raw_key={clean_key!r}")
        return False

    now_iso = _now_utc().isoformat()
    with _kb_lock:
        if _kb_last_mtime is None:
            _load_kb_from_disk_unlocked()

        _kb_exact[normalized_key] = clean_value
        if normalized_key not in _kb_keys:
            _kb_keys.append(normalized_key)
            _kb_entry_index[normalized_key] = len(_kb_entries)
            _kb_entries.append(
                {
                    "key": clean_key,
                    "value": clean_value,
                    "updated_at": now_iso,
                    "rating_total": 0.0,
                    "rating_count": 0,
                    "ratings_by_user": {},
                }
            )
        else:
            existing_index = _kb_entry_index[normalized_key]
            existing_entry = _kb_entries[existing_index]
            rating_total, rating_count, ratings_by_user = _extract_rating_state(existing_entry)
            _kb_entries[existing_index] = {
                "key": clean_key,
                "value": clean_value,
                "updated_at": now_iso,
                "rating_total": rating_total,
                "rating_count": rating_count,
                "ratings_by_user": ratings_by_user,
            }

        _persist_kb_to_disk_unlocked()

    _kb_log(f"已写入知识库 key={clean_key!r}")
    return True


def _get_rating_summary_by_normalized_key(
    normalized_key: str, user_id: Optional[str] = None
) -> dict[str, Any]:
    if not normalized_key:
        return {"avg_score": None, "rating_count": 0, "user_score": None}

    _reload_kb_if_updated()
    with _kb_lock:
        if _kb_last_mtime is None:
            _load_kb_from_disk_unlocked()
        idx = _kb_entry_index.get(normalized_key)
        if idx is None:
            return {"avg_score": None, "rating_count": 0, "user_score": None}
        entry = _kb_entries[idx]
        return _rating_summary_from_entry(entry, user_id)


def _resolve_existing_kb_key(kb_key_hint: Optional[str], barrage: str) -> str:
    _reload_kb_if_updated()

    hint = _normalize_kb_key(kb_key_hint)
    if hint:
        with _kb_lock:
            if _kb_last_mtime is None:
                _load_kb_from_disk_unlocked()
            if hint in _kb_entry_index:
                return hint

    kb_hit = _find_from_kb(barrage)
    if kb_hit:
        matched = _normalize_kb_key(str(kb_hit.get("matched_key", "")))
        if matched:
            with _kb_lock:
                if _kb_last_mtime is None:
                    _load_kb_from_disk_unlocked()
                if matched in _kb_entry_index:
                    return matched

    normalized_barrage = _normalize_kb_key(barrage)
    if normalized_barrage:
        with _kb_lock:
            if _kb_last_mtime is None:
                _load_kb_from_disk_unlocked()
            if normalized_barrage in _kb_entry_index:
                return normalized_barrage
    return ""


def _apply_meme_rating(normalized_key: str, user_id: str, score: int) -> dict[str, Any]:
    if score not in VALID_RATING_SCORES:
        raise HTTPException(status_code=400, detail="score 仅支持 2/4/6/8/10。")

    uid = _normalize_user_id(user_id)
    if not uid:
        raise HTTPException(status_code=400, detail="user_id 不能为空。")

    with _kb_lock:
        if _kb_last_mtime is None:
            _load_kb_from_disk_unlocked()

        idx = _kb_entry_index.get(normalized_key)
        if idx is None:
            raise HTTPException(status_code=404, detail="该梗尚未入库，暂不可评分。")

        entry = dict(_kb_entries[idx])
        if str(entry.get("value", "")).strip() == FALLBACK_TEXT:
            raise HTTPException(status_code=400, detail="兜底解释不支持评分。")

        rating_total, rating_count, ratings_by_user = _extract_rating_state(entry)
        previous_score = _normalize_score(ratings_by_user.get(uid))

        if previous_score is None:
            rating_total += score
            rating_count += 1
        else:
            rating_total += score - previous_score

        ratings_by_user[uid] = score
        entry["rating_total"] = float(round(max(0.0, rating_total), 4))
        entry["rating_count"] = max(0, rating_count)
        entry["ratings_by_user"] = ratings_by_user
        entry["updated_at"] = _now_utc().isoformat()

        _kb_entries[idx] = entry
        _persist_kb_to_disk_unlocked()
        summary = _rating_summary_from_entry(entry, uid)

    _kb_log(
        f"评分已更新 key={entry.get('key')!r} uid={uid!r} score={score} "
        f"avg={summary['avg_score']} count={summary['rating_count']}"
    )
    return {
        "kb_key": normalized_key,
        "avg_score": summary["avg_score"],
        "rating_count": summary["rating_count"],
        "user_score": score,
    }


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
    compact_content = re.sub(r"\s+", "", content)
    compact_fallback = re.sub(r"\s+", "", FALLBACK_TEXT)
    if compact_content == compact_fallback:
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


def _run_explain_pipeline(
    barrage: str,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
) -> tuple[bool, str, str, Optional[str]]:
    """
    梗解释主流程：
    1) 先走知识库（一级精确/前缀 + 二级模糊）
    2) 命中则直接返回，不走检索+LLM
    3) 未命中则走检索+LLM，且把有效结果回写知识库
    """
    kb_hit = _find_from_kb(barrage)
    if kb_hit:
        search_context = (
            f"知识库命中：{kb_hit['hit_level']} | key={kb_hit['matched_key']} | "
            f"score={kb_hit['score']}"
        )
        explanation = str(kb_hit["explanation"]).strip() or FALLBACK_TEXT
        _kb_log(
            f"命中 {kb_hit['hit_level']} | input={barrage} | "
            f"matched={kb_hit['matched_key']} | score={kb_hit['score']}"
        )
        return explanation != FALLBACK_TEXT, search_context, explanation, str(kb_hit["matched_key"])

    search_text = _search_meme_context(barrage)
    explanation = _call_llm_for_explanation(
        barrage=barrage,
        search_text=search_text,
        api_key=api_key,
        model=model,
    )
    if explanation != FALLBACK_TEXT:
        stored = _upsert_kb_entry(barrage, explanation)
        if stored:
            _kb_log(f"已新增 key={barrage}")
            kb_key = _normalize_kb_key(barrage)
        else:
            _kb_log(f"跳过写入（空 key/value 或兜底文案）key={barrage}")
            kb_key = None
    else:
        _kb_log(f"跳过写入（LLM 返回兜底文案）key={barrage}")
        kb_key = None
    return explanation != FALLBACK_TEXT, search_text, explanation, kb_key


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
    _kb_log(f"/api/meme/explain 请求: barrage={payload.barrage!r}")
    found, search_text, explanation, kb_key = _run_explain_pipeline(
        barrage=payload.barrage,
        api_key=payload.api_key,
        model=payload.model,
    )
    bot_broadcast = explanation
    print(f"机器人已向直播间广播：{bot_broadcast}")
    rating_enabled = explanation != FALLBACK_TEXT and bool(kb_key)
    rating_summary = (
        _get_rating_summary_by_normalized_key(kb_key or "", payload.user_id)
        if rating_enabled
        else {"avg_score": None, "rating_count": 0, "user_score": None}
    )

    return MemeExplainOut(
        found=found,
        search_context=search_text,
        explanation=explanation,
        bot_broadcast=bot_broadcast,
        kb_key=kb_key,
        avg_score=rating_summary["avg_score"],
        rating_count=rating_summary["rating_count"],
        user_score=rating_summary["user_score"],
        rating_enabled=rating_enabled,
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


@app.post("/api/meme/rate", response_model=MemeRateOut)
def meme_rate(payload: MemeRateIn) -> MemeRateOut:
    if payload.score not in VALID_RATING_SCORES:
        raise HTTPException(status_code=400, detail="score 仅支持 2/4/6/8/10。")

    normalized_key = _resolve_existing_kb_key(payload.kb_key, payload.barrage)
    if not normalized_key:
        raise HTTPException(status_code=404, detail="该梗尚未入库，暂不可评分。")

    result = _apply_meme_rating(
        normalized_key=normalized_key,
        user_id=payload.user_id,
        score=payload.score,
    )
    return MemeRateOut(**result)


@app.post("/api/test/quick", response_model=QuickTestOut)
def quick_test(payload: QuickTestIn) -> QuickTestOut:
    """测试专用：直接输入梗文本（和可选 api_key）返回解释+回梗建议。"""
    found, search_text, explanation, _kb_key = _run_explain_pipeline(
        barrage=payload.barrage,
        api_key=payload.api_key,
        model=payload.model,
    )
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
