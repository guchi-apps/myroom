// CIのNode 20にはグローバルWebSocketが無く、@supabase/supabase-jsの
// createClient()がRealtimeClientの初期化時点で例外を投げる（Node 22+では未使用）。
// 実際にソケットへ接続するテストは無いため、存在チェックを通す最小限のダミーで足りる。
if (typeof globalThis.WebSocket === "undefined") {
  class NoopWebSocket {}
  globalThis.WebSocket = NoopWebSocket as unknown as typeof WebSocket;
}
