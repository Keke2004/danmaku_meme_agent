#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_PATH="$ROOT_DIR/tool_venv"
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5500}"

if [[ ! -d "$VENV_PATH" ]]; then
  echo "未找到虚拟环境：$VENV_PATH"
  echo "请先创建并安装依赖。"
  exit 1
fi

source "$VENV_PATH/bin/activate"

if [[ "${1:-}" == "cli" ]]; then
  echo "进入 CLI 测试模式..."
  exec python "$ROOT_DIR/main.py" --cli-test
fi

BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "启动后端: http://$BACKEND_HOST:$BACKEND_PORT"
uvicorn main:app --host "$BACKEND_HOST" --port "$BACKEND_PORT" --reload &
BACKEND_PID=$!

echo "启动前端静态服务: http://$BACKEND_HOST:$FRONTEND_PORT/index.html"
python3 -m http.server "$FRONTEND_PORT" --bind "$BACKEND_HOST" --directory "$ROOT_DIR" &
FRONTEND_PID=$!

echo
echo "已启动："
echo "  后端健康检查: http://$BACKEND_HOST:$BACKEND_PORT/health"
echo "  前端页面:     http://$BACKEND_HOST:$FRONTEND_PORT/index.html"
echo
echo "按 Ctrl+C 可一键停止前后端。"

wait

‘’‘http://127.0.0.1:5500/index.html’‘’