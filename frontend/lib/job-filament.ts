import type { BambuSnapshot } from "@/lib/bambu";
import {
  getActiveSpool,
  type FilamentPayload,
  type FilamentSpool,
  type FilamentUsage,
} from "@/lib/filament";

/**
 * プリンターカードの「この造形の使用量」の1行（#454）。
 *
 * 使用量は3mfから読んだスライサーの予定値で、**在庫から引くのはバックエンド**（造形の完了・停止の
 * 遷移で `filament.record_auto_usage()`）。ここは「これから引く／引いた／引かない」を、その結果
 * （在庫の使用量の記録）と突き合わせて言葉にするだけで、引く判断は持たない。
 */
export type JobFilamentTone = "pending" | "done" | "estimate" | "muted";

export interface JobFilamentView {
  tone: JobFilamentTone;
  title: string;
  detail: string;
  /** 「−」を付けて出すか（引いた記録のとき） */
  deducted: boolean;
  grams: number;
  /** 引く先（引いた先）のスプールの色。決まっていないときは null */
  swatchColor: string | null;
}

const RUNNING_STATES = ["preparing", "printing", "paused"];
const ENDED_STATES = ["finished", "failed"];

function findJobUsage(
  payload: FilamentPayload,
  jobKey: string
): { spool: FilamentSpool; usage: FilamentUsage } | null {
  for (const spool of payload.spools) {
    const usage = spool.usages.find((item) => item.job_key === jobKey);
    if (usage) return { spool, usage };
  }
  return null;
}

export function buildJobFilamentView(
  snapshot: BambuSnapshot,
  payload: FilamentPayload | null
): JobFilamentView | null {
  const job = snapshot.job.filament;
  if (!job) return null;
  const running = RUNNING_STATES.includes(snapshot.state);
  if (!running && !ENDED_STATES.includes(snapshot.state)) return null;

  const active = getActiveSpool(payload);
  const multiColor = job.filaments.length > 1;
  const planned = {
    grams: job.totalGrams,
    deducted: false,
  };

  if (running) {
    const title = "この造形で使う量（予定）";
    if (multiColor) {
      return {
        ...planned,
        tone: "muted",
        title,
        detail: "複数色の造形は自動では差し引きません",
        swatchColor: null,
      };
    }
    if (payload && !active) {
      return {
        ...planned,
        tone: "muted",
        title,
        detail: "使用中のスプールが無いため、差し引きません",
        swatchColor: null,
      };
    }
    return {
      ...planned,
      tone: "pending",
      title,
      detail: active
        ? `完了すると「${active.name}」から差し引きます`
        : "完了すると、使用中のスプールから差し引きます",
      swatchColor: active?.color ?? null,
    };
  }

  // 完了・停止のあと。在庫の側に記録が残っていれば「引いた」
  if (!payload) return null;
  const found = findJobUsage(payload, job.jobKey);
  if (found) {
    const estimated = found.usage.source === "auto_estimate";
    return {
      tone: estimated ? "estimate" : "done",
      title: estimated ? "途中で止まったため、概算を差し引きました" : "使用量を差し引きました",
      detail: estimated
        ? `「${found.spool.name}」・進捗率で按分した概算（履歴から取り消せます）`
        : `「${found.spool.name}」・自動で記録（履歴から取り消せます）`,
      grams: found.usage.grams,
      deducted: true,
      swatchColor: found.spool.color,
    };
  }

  const title = "この造形で使った量（予定）";
  let detail = "在庫には反映されていません（手入力で記録できます）";
  if (multiColor) detail = "複数色の造形は自動では差し引きません";
  else if (!active) detail = "使用中のスプールが無かったため、差し引いていません";
  return { ...planned, tone: "muted", title, detail, swatchColor: null };
}
