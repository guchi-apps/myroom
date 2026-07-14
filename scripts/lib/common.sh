# Shared helpers for local development startup scripts.
# shellcheck shell=bash

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

BACKEND_PID=""
FRONTEND_PID=""

setup_python() {
  cd "$ROOT_DIR"
  local need_install=0
  if [[ ! -d venv ]]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
    need_install=1
  fi
  # shellcheck source=/dev/null
  source venv/bin/activate
  if [[ "$need_install" -eq 1 ]] || ! python -c "import uvicorn" 2>/dev/null; then
    echo "Installing Python dependencies (backend only)..."
    python -m pip install --upgrade pip
    pip install -r requirements.txt
  fi
}

setup_frontend_deps() {
  cd "$ROOT_DIR/frontend"
  if [[ ! -d node_modules ]]; then
    echo "Installing frontend dependencies..."
    npm install
  fi
}

wait_for_port() {
  local port="$1"
  local label="$2"
  local i
  for i in $(seq 1 30); do
    if ss -tuln 2>/dev/null | grep -q ":${port} "; then
      return 0
    fi
    sleep 0.5
  done
  echo "Error: ${label} did not start on port ${port}."
  return 1
}

start_backend() {
  cd "$ROOT_DIR"
  # shellcheck source=/dev/null
  source venv/bin/activate
  echo "Starting backend (DB_MOCK=${DB_MOCK})..."
  uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000 &
  BACKEND_PID=$!
  wait_for_port 8000 "Backend"
}

start_frontend() {
  cd "$ROOT_DIR/frontend"
  echo "Starting frontend..."
  npm run dev &
  FRONTEND_PID=$!
  wait_for_port 5173 "Frontend"
}

expose_lan() {
  # WSL2 以外（native Linux / macOS 等）では LAN 公開の対象外なので、
  # ファイルの有無ではなく実行環境そのものを見て静かにスキップする。
  if ! grep -qi microsoft /proc/version 2>/dev/null; then
    return 0
  fi
  if [[ ! -x "${ROOT_DIR}/scripts/expose-lan.sh" ]]; then
    echo "警告: scripts/expose-lan.sh に実行権限がありません（chmod +x scripts/expose-lan.sh）。スマホからのアクセス設定をスキップします。" >&2
    return 0
  fi
  "${ROOT_DIR}/scripts/expose-lan.sh" || echo "（スマホからのアクセスは今回スキップされました。再試行: ./scripts/expose-lan.sh）"
}

print_urls() {
  echo ""
  echo "Ready:"
  echo "  Frontend (UI): http://localhost:5173"
  echo "  Backend API:   http://localhost:8000"
  echo "  API docs:      http://localhost:8000/docs"
  echo ""
  echo "Press Ctrl+C to stop all services."
  echo ""
}

cleanup_services() {
  echo ""
  echo "Stopping services..."
  if [[ -n "${FRONTEND_PID:-}" ]]; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  # uvicorn --reload spawns a child process
  pkill -f "uvicorn backend.main:app" 2>/dev/null || true
  pkill -f "next dev --port 5173" 2>/dev/null || true
}

run_dev_stack() {
  local mode_label="$1"
  trap cleanup_services EXIT INT TERM

  echo "=== ${mode_label} ==="
  setup_python
  setup_frontend_deps
  start_backend
  start_frontend
  expose_lan
  print_urls
  wait "$BACKEND_PID" "$FRONTEND_PID"
}
