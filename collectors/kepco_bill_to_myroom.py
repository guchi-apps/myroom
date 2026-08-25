#!/usr/bin/env python3
"""関西電力「はぴeみる電」のお知らせメールから月ごとの確定請求を取り、MyRoom の `/api/bills` へ送る。

サブPCの systemd user timer から1日1回実行する想定（`collectors/systemd/` を参照）。
`/api/bills` は同じ (請求月, 種別, 契約) を上書きするため、受信箱に残っているぶんを
毎回そのまま送ってよい。送り直しても件数は増えない。

**なぜメールなのか。** はぴeみる電に公開APIは無く、サイトはCapyのパズル認証に加えて
2026年3月10日から「初めての環境からのログインは2段階認証必須」になった。画面を自動で
読みに行く方式はいつ止まってもおかしくない。いっぽうお知らせメールは検針のたびに
決まった書式で届き、請求金額・使用量・契約種別がそのまま本文に載っている。

**取れるのは月合計だけ。** 日ごと・時間ごとの使用量はメールに載っていない（はぴeみる電の
画面にしか無い）。日別が要るならスマートメーターのBルートという別の道になる。

使い方:
  python3 collectors/kepco_bill_to_myroom.py
  python3 collectors/kepco_bill_to_myroom.py --dry-run --debug
  python3 collectors/kepco_bill_to_myroom.py --months 3 --dry-run
  python3 collectors/kepco_bill_to_myroom.py --dump-raw
"""

from __future__ import annotations

import argparse
import datetime
import email
import email.header
import email.message
import email.utils
import hashlib
import imaplib
import json
import os
import re
import sys
from typing import Any, Dict, List, Optional, Sequence

import requests

JST = datetime.timezone(datetime.timedelta(hours=9))

DEFAULT_API_URL = "https://myroom.gucchii.com/api/bills"
DEFAULT_IMAP_HOST = "imap.gmail.com"
DEFAULT_IMAP_PORT = 993

#: はぴeみる電の検針結果メールの差出人。電気もガスも同じアドレスから届く。
DEFAULT_MAIL_FROM = "kandenweb.kensinhyo@a2.kepco.co.jp"

#: 何か月ぶんさかのぼって探すか。はぴeみる電の保有期間（25か月）に合わせる。
DEFAULT_MONTHS = 25

KIND_ELECTRICITY = "electricity"
KIND_GAS = "gas"

#: 使用量の単位から種別を決める。件名の文言より確実（件名は変わりうる）。
UNIT_KINDS = {
    "kwh": (KIND_ELECTRICITY, "kWh"),
    "立方メートル": (KIND_GAS, "m3"),
    "m3": (KIND_GAS, "m3"),
    "㎥": (KIND_GAS, "m3"),
}

# --- 本文の書式 -------------------------------------------------------------
#
# 電気とガスで見出しの文言が少し違う。電気は太陽光発電の振込にも同じメールを使うため
# 「（振込）」「（予定）」が挟まる。差分を飲み込めるよう、括弧の中身は何でも許す。
#
#   電気: 【ご請求（振込）年月】2026年08月 / 【ご請求（予定）金額】15,760円
#   ガス: 【ご請求年月】2026年08月       / 【ご請求金額】2060 円
#
# **どれも行頭に固定する。** 本文の前置きに「メール本文に、【契約種別】の記載がある場合は
# ご請求金額のお知らせ、…」という説明文があり、固定しないと契約種別としてこの一文を拾う。
RE_BILLING_MONTH = re.compile(
    r"^【ご請求(?:（[^】]*）)?年月】\s*(\d{4})年\s*(\d{1,2})月", re.MULTILINE
)
RE_AMOUNT = re.compile(r"^【ご請求(?:（[^】]*）)?金額】\s*([0-9,]+)\s*円", re.MULTILINE)
RE_PLAN = re.compile(r"^【契約種別】\s*(\S.*?)\s*$", re.MULTILINE)
RE_CUSTOMER = re.compile(r"^【お客さま番号】\s*([0-9\-]+)", re.MULTILINE)
RE_USAGE = re.compile(
    r"^【ご使用量】\s*(?:[^:：\n]*[:：])?\s*([0-9,]+(?:\.[0-9]+)?)\s*(kWh|立方メートル|m3|㎥)",
    re.IGNORECASE | re.MULTILINE,
)


class KepcoMailError(Exception):
    """設定漏れや接続の失敗など、利用者に伝えて終わるべきもの。"""


def today_jst() -> datetime.date:
    return datetime.datetime.now(JST).date()


def load_env_file(path: str) -> Dict[str, str]:
    """`KEY=value` 形式を読む簡易パーサ。

    `python-dotenv` はサブPCのシステムPythonに入っていない。ここで要るのは数行の
    `KEY=value` だけなので、依存を増やさず自前で読む（他の収集スクリプトと同じ）。
    """
    values: Dict[str, str] = {}
    if not os.path.isfile(path) or not os.access(path, os.R_OK):
        return values

    with open(path, encoding="utf-8") as handle:
        for raw in handle:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[len("export ") :].strip()
            key, sep, value = line.partition("=")
            if not sep:
                continue
            key = key.strip()
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]
            if key:
                values[key] = value
    return values


def apply_env_files(paths: Sequence[str]) -> None:
    """先に挙げたファイルを優先して環境変数へ載せる（既存の環境変数は上書きしない）。"""
    for path in paths:
        for key, value in load_env_file(path).items():
            os.environ.setdefault(key, value)


# --- 本文の取り出し ---------------------------------------------------------


def decode_text_body(message: email.message.Message) -> str:
    """`text/plain` の本文を文字列にする。

    はぴeみる電のメールは ISO-2022-JP で届く。宣言された文字コードで読み、
    宣言が無い・読めない場合だけ UTF-8 と CP932 を順に試す
    （`errors="replace"` で潰すと金額の桁が壊れて気付けなくなる）。
    """
    parts = []
    for part in message.walk():
        if part.get_content_maintype() == "multipart":
            continue
        if part.get_content_type() != "text/plain":
            continue
        payload = part.get_payload(decode=True)
        if payload is None:
            continue
        charsets = [part.get_content_charset(), "iso-2022-jp", "utf-8", "cp932"]
        for charset in charsets:
            if not charset:
                continue
            try:
                parts.append(payload.decode(charset))
                break
            except (UnicodeDecodeError, LookupError):
                continue
    return "\n".join(parts)


def decode_subject(message: email.message.Message) -> str:
    raw = message.get("Subject", "")
    try:
        return "".join(
            chunk.decode(charset or "utf-8", errors="replace")
            if isinstance(chunk, bytes)
            else chunk
            for chunk, charset in email.header.decode_header(raw)
        )
    except Exception:
        return raw


def message_date(message: email.message.Message) -> Optional[datetime.datetime]:
    raw = message.get("Date")
    if not raw:
        return None
    try:
        parsed = email.utils.parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return None
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        return parsed
    # MyRoom は JST の naive な datetime で持つ
    return parsed.astimezone(JST).replace(tzinfo=None)


def contract_key(customer_no: Optional[str]) -> str:
    """お客さま番号そのものではなく、区別だけできる短いハッシュにする。

    引越しの月は旧契約と新契約の2通が届く。契約を区別できないと片方が上書きで
    消えるが、番号そのものを持つ必要は無い。
    """
    if not customer_no:
        return "default"
    return hashlib.sha256(customer_no.encode("utf-8")).hexdigest()[:12]


def parse_bill(body: str) -> Optional[Dict[str, Any]]:
    """メール本文1通ぶんを `/api/bills` の1レコードにする。請求のお知らせでなければ None。

    **【契約種別】が無い電気のメールは請求ではない。** 太陽光発電等を契約している場合、
    同じ件名で「振込金額のお知らせ」が届き、その回だけ契約種別の行が落ちる
    （本文にその旨が書かれている）。請求として数えると売電が支出に混ざる。
    """
    month_match = RE_BILLING_MONTH.search(body)
    amount_match = RE_AMOUNT.search(body)
    plan_match = RE_PLAN.search(body)
    usage_match = RE_USAGE.search(body)

    if not month_match or not amount_match or not plan_match:
        return None

    unit_raw = usage_match.group(2).lower() if usage_match else ""
    kind_unit = UNIT_KINDS.get(unit_raw)
    if kind_unit is None:
        return None
    kind, usage_unit = kind_unit

    customer_match = RE_CUSTOMER.search(body)

    return {
        "billing_month": "{}-{:02d}".format(
            month_match.group(1), int(month_match.group(2))
        ),
        "kind": kind,
        "contract_key": contract_key(
            customer_match.group(1) if customer_match else None
        ),
        "plan_name": plan_match.group(1),
        "amount_yen": int(amount_match.group(1).replace(",", "")),
        "usage_value": float(usage_match.group(1).replace(",", "")),
        "usage_unit": usage_unit,
    }


# --- IMAP -------------------------------------------------------------------


def find_all_mail_folder(imap: imaplib.IMAP4) -> str:
    """`\\All`（Gmailの「すべてのメール」）が付いたフォルダ名を返す。

    受信箱だけを見ると、アーカイブ済みの古い検針メールを取りこぼす。フォルダ名は
    アカウントの言語で変わる（日本語だと `[Gmail]/すべてのメール` のUTF-7表現）ので、
    名前ではなく特別用途フラグで探す。見つからなければ受信箱へ落とす。
    """
    status, lines = imap.list()
    if status != "OK" or not lines:
        return "INBOX"

    for raw in lines:
        line = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else raw
        if "\\All" not in line:
            continue
        # `(\HasNoChildren \All) "/" "[Gmail]/&...-"` の最後の引用符内
        match = re.search(r'"([^"]+)"\s*$', line)
        if match:
            return match.group(1)
        return line.rsplit(" ", 1)[-1]
    return "INBOX"


def search_since(months: int, today: datetime.date) -> str:
    """IMAP の `SINCE` に渡す日付（`01-Jan-2026`）。"""
    total = today.year * 12 + (today.month - 1) - months
    start = datetime.date(total // 12, total % 12 + 1, 1)
    return start.strftime("%d-%b-%Y")


def fetch_bill_records(
    host: str,
    port: int,
    user: str,
    password: str,
    mail_from: str,
    months: int,
    today: datetime.date,
    debug: bool = False,
    dump_raw: bool = False,
) -> List[Dict[str, Any]]:
    """はぴeみる電のお知らせメールを読み、`/api/bills` の `records` の形にして返す。"""
    records: List[Dict[str, Any]] = []

    try:
        imap = imaplib.IMAP4_SSL(host, port)
    except OSError as exc:
        raise KepcoMailError("IMAP に接続できません（{}:{}）: {}".format(host, port, exc))

    try:
        try:
            imap.login(user, password)
        except imaplib.IMAP4.error as exc:
            raise KepcoMailError(
                "IMAP のログインに失敗しました。Gmail はアプリパスワードが要ります"
                "（通常のパスワードでは通りません）: {}".format(exc)
            )

        folder = find_all_mail_folder(imap)
        if debug:
            print("folder: {}".format(folder))
        status, _ = imap.select('"{}"'.format(folder), readonly=True)
        if status != "OK":
            raise KepcoMailError("メールフォルダを開けません: {}".format(folder))

        criteria = '(FROM "{}" SINCE {})'.format(mail_from, search_since(months, today))
        status, data = imap.search(None, criteria)
        if status != "OK":
            raise KepcoMailError("メールの検索に失敗しました: {}".format(criteria))

        message_ids = data[0].split() if data and data[0] else []
        if debug:
            print("matched mails: {}".format(len(message_ids)))

        for message_id in message_ids:
            status, payload = imap.fetch(message_id, "(RFC822)")
            if status != "OK" or not payload or not isinstance(payload[0], tuple):
                continue
            message = email.message_from_bytes(payload[0][1])
            body = decode_text_body(message)

            if dump_raw:
                print("--- {} {}".format(message_id.decode(), decode_subject(message)))
                print(body)
                continue

            record = parse_bill(body)
            if record is None:
                if debug:
                    print(
                        "skip: {}（請求のお知らせではありません）".format(
                            decode_subject(message)
                        )
                    )
                continue

            received = message_date(message)
            if received is not None:
                record["received_at"] = received.isoformat()
            records.append(record)
            if debug:
                print(
                    "read: {} {} {}円 {}{}".format(
                        record["billing_month"],
                        record["kind"],
                        record["amount_yen"],
                        record["usage_value"],
                        record["usage_unit"],
                    )
                )
    finally:
        try:
            imap.logout()
        except Exception:  # 後始末の失敗で取得結果を捨てない
            pass

    return dedupe_records(records)


def dedupe_records(records: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """同じ (請求月, 種別, 契約) は**後から届いたほう**を残す。

    訂正のメールが後日届くことがあり、その場合は新しいほうが正しい。並びは
    請求月の古い順に揃える（`--dry-run` の出力を読みやすくするため）。
    """
    latest: Dict[tuple, Dict[str, Any]] = {}
    for record in records:
        key = (record["billing_month"], record["kind"], record["contract_key"])
        current = latest.get(key)
        if current is None or (record.get("received_at") or "") >= (
            current.get("received_at") or ""
        ):
            latest[key] = record
    return sorted(
        latest.values(), key=lambda item: (item["billing_month"], item["kind"])
    )


def post_to_myroom(
    api_url: str,
    payload: Dict[str, Any],
    timeout: int,
    dry_run: bool,
) -> Dict[str, Any]:
    if dry_run:
        print("[dry-run] POST {}".format(api_url))
        print("[dry-run] payload: {}".format(json.dumps(payload, ensure_ascii=False)))
        return {"status": "dry_run", "payload": payload}

    response = requests.post(api_url, json=payload, timeout=timeout)
    response.raise_for_status()
    return response.json()


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="はぴeみる電のお知らせメール -> MyRoom /api/bills"
    )
    parser.add_argument("--imap-host", default=os.getenv("KEPCO_IMAP_HOST", DEFAULT_IMAP_HOST))
    parser.add_argument(
        "--imap-port",
        type=int,
        default=int(os.getenv("KEPCO_IMAP_PORT", str(DEFAULT_IMAP_PORT))),
    )
    parser.add_argument("--imap-user", default=os.getenv("KEPCO_IMAP_USER", ""))
    parser.add_argument(
        "--imap-password",
        default=os.getenv("KEPCO_IMAP_PASSWORD", ""),
        help="Gmail はアプリパスワード（通常のパスワードでは通らない）",
    )
    parser.add_argument(
        "--mail-from",
        default=os.getenv("KEPCO_MAIL_FROM", DEFAULT_MAIL_FROM),
        help="検針結果メールの差出人（既定: {}）".format(DEFAULT_MAIL_FROM),
    )
    parser.add_argument(
        "--api-url",
        default=os.getenv("MYROOM_BILLS_API_URL", DEFAULT_API_URL),
        help="MyRoom の受け口URL",
    )
    parser.add_argument(
        "--months",
        type=int,
        default=int(os.getenv("KEPCO_BILL_MONTHS", str(DEFAULT_MONTHS))),
        help="さかのぼって探す月数（既定: {}）".format(DEFAULT_MONTHS),
    )
    parser.add_argument(
        "--http-timeout",
        type=int,
        default=int(os.getenv("HTTP_TIMEOUT", "30")),
    )
    parser.add_argument("--debug", action="store_true", help="取得の内訳を表示する")
    parser.add_argument("--dry-run", action="store_true", help="取得のみ。POSTしない")
    parser.add_argument(
        "--dump-raw",
        action="store_true",
        help="該当したメールの本文をそのまま表示して終了する（書式が変わったときの調査用）",
    )

    args = parser.parse_args(argv)
    if not args.imap_user or not args.imap_password:
        parser.error("KEPCO_IMAP_USER and KEPCO_IMAP_PASSWORD are required (env or CLI)")
    return args


def main(argv: Optional[Sequence[str]] = None) -> int:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    apply_env_files(
        [
            os.path.join(script_dir, ".env"),
            os.path.join(os.path.dirname(script_dir), ".env"),
        ]
    )

    try:
        args = parse_args(argv)

        records = fetch_bill_records(
            args.imap_host,
            args.imap_port,
            args.imap_user,
            args.imap_password,
            args.mail_from,
            args.months,
            today_jst(),
            debug=args.debug,
            dump_raw=args.dump_raw,
        )

        if args.dump_raw:
            return 0

        if not records:
            print(
                "no bill mails found (from={} months={})".format(
                    args.mail_from, args.months
                ),
                file=sys.stderr,
            )
            return 1

        print(
            "read: {}".format(
                ", ".join(
                    "{} {} {}円".format(r["billing_month"], r["kind"], r["amount_yen"])
                    for r in records
                )
            )
        )

        result = post_to_myroom(
            args.api_url, {"records": records}, args.http_timeout, args.dry_run
        )
        print("sent: {}".format(json.dumps(result, ensure_ascii=False)))
        return 0

    except KepcoMailError as exc:
        print("error: {}".format(exc), file=sys.stderr)
        return 1
    except requests.RequestException as exc:
        print("error: MyRoom への送信に失敗しました: {}".format(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
