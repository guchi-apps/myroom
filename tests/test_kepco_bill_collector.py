"""はぴeみる電のお知らせメールの読み取り（`collectors/kepco_bill_to_myroom.py`）。

**本文は実際に届いたメールの書式をそのまま使う。** 見出しの文言は電気とガスで違い、
電気は太陽光発電の振込通知にも同じ件名を使うため、書式が変わったらここが落ちる。
"""

import datetime
import os
import sys

import pytest

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "collectors")
)

import kepco_bill_to_myroom as collector  # noqa: E402


ELECTRICITY_MAIL = """平素は、弊社事業に対しまして、格別のご理解、ご協力を賜り厚く御礼申し上げます。
今月のご請求金額（太陽光発電等の方は振込金額）・ご使用量が確定いたしましたので、お知らせいたします。

※太陽光発電等をご契約されているお客さまにつきましては、太陽光発電等の振込金額と、電気ご使用分におけるご請求金額の料金確定タイミングが異なります。メール本文に、【契約種別】の記載がある場合はご請求金額のお知らせ、【契約種別】の記載がない場合は、太陽光発電等の振込金額のお知らせとなります。

【ご請求（振込）年月】2026年08月
【お客さま番号】11-22-3333-444444
【契約種別】なっトクでんき
【ご請求（予定）金額】15,760円
【ご使用量】なっトクでんき:540kWh

▼ご請求金額・ご使用量のご確認▼
「はぴｅみる電」にログインして、ご請求金額やご使用量をご確認いただけます。
"""

GAS_MAIL = """今月のご請求金額・ご使用量が確定いたしましたので、お知らせいたします。

【ご請求年月】2026年08月
【お客さま番号】11-22-3333-444444
【契約種別】なっトクプラン
【ご請求金額】2060 円
【ご使用量】なっトクプラン:8 立方メートル
"""

# 太陽光発電等の振込通知。本文の説明どおり【契約種別】の行が落ちる
SOLAR_TRANSFER_MAIL = """【ご請求（振込）年月】2026年08月
【お客さま番号】11-22-3333-444444
【振込金額】8,000円
"""


def test_parses_electricity_mail():
    record = collector.parse_bill(ELECTRICITY_MAIL)

    assert record["billing_month"] == "2026-08"
    assert record["kind"] == "electricity"
    assert record["plan_name"] == "なっトクでんき"
    assert record["amount_yen"] == 15760
    assert record["usage_value"] == 540.0
    assert record["usage_unit"] == "kWh"


def test_parses_gas_mail():
    record = collector.parse_bill(GAS_MAIL)

    assert record["kind"] == "gas"
    assert record["amount_yen"] == 2060
    assert record["usage_value"] == 8.0
    assert record["usage_unit"] == "m3"


def test_headings_are_anchored_to_the_start_of_a_line():
    # 前置きの説明文にも【契約種別】という文字列が出てくる。行頭に固定していないと
    # 契約種別としてその一文を拾ってしまう
    assert collector.parse_bill(ELECTRICITY_MAIL)["plan_name"] == "なっトクでんき"


def test_crlf_mail_is_parsed():
    record = collector.parse_bill(ELECTRICITY_MAIL.replace("\n", "\r\n"))
    assert record["plan_name"] == "なっトクでんき"
    assert record["amount_yen"] == 15760


def test_solar_transfer_mail_is_not_a_bill():
    # 売電の振込を支出として数えない
    assert collector.parse_bill(SOLAR_TRANSFER_MAIL) is None


def test_unrelated_mail_is_ignored():
    assert collector.parse_bill("はぴｅみる電のキャンペーンのお知らせです。") is None


def test_same_customer_number_gives_the_same_contract_key():
    assert collector.contract_key("11-22-3333-444444") == collector.contract_key(
        "11-22-3333-444444"
    )
    assert collector.contract_key("11-22-3333-444444") != collector.contract_key(
        "55-66-7777-888888"
    )
    # お客さま番号そのものは残さない
    assert "11-22" not in collector.contract_key("11-22-3333-444444")
    assert collector.contract_key(None) == "default"


def test_dedupe_keeps_the_mail_that_arrived_later():
    # 訂正のメールが後日届いたら新しいほうが正しい
    records = [
        {
            "billing_month": "2026-08",
            "kind": "electricity",
            "contract_key": "c1",
            "amount_yen": 15760,
            "received_at": "2026-08-20T14:18:00",
        },
        {
            "billing_month": "2026-08",
            "kind": "electricity",
            "contract_key": "c1",
            "amount_yen": 15200,
            "received_at": "2026-08-25T09:00:00",
        },
    ]

    deduped = collector.dedupe_records(records)

    assert len(deduped) == 1
    assert deduped[0]["amount_yen"] == 15200


def test_dedupe_keeps_both_contracts_of_a_moving_month():
    # 引越しの月は旧契約と新契約の2通が届く。どちらも残す
    records = [
        {
            "billing_month": "2026-04",
            "kind": "gas",
            "contract_key": "old",
            "amount_yen": 2598,
            "received_at": "2026-04-10T13:39:00",
        },
        {
            "billing_month": "2026-04",
            "kind": "gas",
            "contract_key": "new",
            "amount_yen": 2177,
            "received_at": "2026-04-22T13:36:00",
        },
    ]

    assert len(collector.dedupe_records(records)) == 2


def test_search_since_goes_back_whole_months():
    assert collector.search_since(1, datetime.date(2026, 8, 25)) == "01-Jul-2026"
    assert collector.search_since(25, datetime.date(2026, 8, 25)) == "01-Jul-2024"


@pytest.mark.parametrize(
    "line, expected",
    [
        ("【ご使用量】なっトクでんき:540kWh", ("540", "kWh")),
        ("【ご使用量】なっトクプラン:8 立方メートル", ("8", "立方メートル")),
        ("【ご使用量】1,234.5kWh", ("1,234.5", "kWh")),
    ],
)
def test_usage_line_variations(line, expected):
    match = collector.RE_USAGE.search(line)
    assert match is not None
    assert (match.group(1), match.group(2)) == expected
