/**
 * JSチャンクの読み込み失敗から自動で立ち直るための判定（#450）。
 *
 * デプロイの途中（HTMLと `version.json` が先に届き、チャンクがまだ届いていない数秒）や
 * バックエンドの再起動中に開くと、描画中に `Failed to load chunk ...` が投げられる。
 * 境界が無いと Next.js 既定の「Application error」の白い画面になるため、
 * `app/global-error.tsx` がこれで判定し、1回だけ読み込み直す。
 */

/** 自動リロードした時刻を覚えておくキー（連続リロードを止めるため） */
export const CHUNK_RELOAD_STORAGE_KEY = "myroom_chunk_reload_at";

/** この時間内にもう一度失敗したら、自動では読み込み直さない */
export const CHUNK_RELOAD_COOLDOWN_MS = 60 * 1000;

type ErrorLike = { name?: unknown; message?: unknown; cause?: unknown };

/** Turbopack（`Failed to load chunk`）と webpack（`ChunkLoadError`）の両方の形を拾う */
export function isChunkLoadError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 3) return false;
  const { name, message, cause } = error as ErrorLike;
  if (name === "ChunkLoadError") return true;
  if (typeof message === "string") {
    if (/Failed to load chunk|Loading (CSS )?chunk .+ failed/i.test(message)) return true;
  }
  return isChunkLoadError(cause, depth + 1);
}

/**
 * 自動で読み込み直してよいか。直前（`CHUNK_RELOAD_COOLDOWN_MS` 以内）に一度読み込み直して
 * いたら false にして、チャンクが本当に無いときにリロードが止まらなくなるのを防ぐ。
 */
export function shouldAutoReload(lastReloadAt: string | null, now: number): boolean {
  if (!lastReloadAt) return true;
  const last = Number(lastReloadAt);
  if (!Number.isFinite(last)) return true;
  return now - last >= CHUNK_RELOAD_COOLDOWN_MS;
}

/**
 * チャンクの失敗で、いま自動で読み込み直してよいか。読むだけで書き込まない。
 * sessionStorage が使えない環境では、ループを避けるため自動では読み込み直さない。
 */
export function canAutoReloadForChunkError(error: unknown): boolean {
  if (!isChunkLoadError(error) || typeof window === "undefined") return false;
  try {
    return shouldAutoReload(window.sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY), Date.now());
  } catch {
    return false;
  }
}

/**
 * 読み込み直した時刻を残してから読み込み直す。時刻を残せなければ読み込み直さない
 * （残せないまま読み込み直すと、チャンクが本当に無いときに止まらなくなる）。
 * 読み込み直したら true。
 */
export function reloadForChunkError(): boolean {
  try {
    window.sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}
