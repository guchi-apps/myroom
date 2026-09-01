"""VAPID 鍵生成スクリプト（scripts/generate_vapid_keys.py）のテスト。

**ここで守っているのは「出した値がそのまま動くこと」**（#337）。秘密鍵を PEM で出していた頃は、
`backend/push_notify.py` が渡した値を pywebpush が `py_vapid.Vapid01.from_string()` で読めず、
本番へ登録しても送信のたびに `Could not deserialize key data` で落ちる形になっていた。
さらに複数行の値は `deploy.yml` の `sync_env_var`（`KEY=値` の 1 行で書く）を通ると
`.env` の書式ごと壊れる。**1 行であること**と**`from_string()` が読めること**を両方見る。
"""

import importlib.util
import pathlib

from py_vapid import Vapid01

MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "generate_vapid_keys.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("generate_vapid_keys", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


generate_vapid_keys = _load_module()


def test_keys_are_single_line():
    private_key, public_key = generate_vapid_keys.generate_keys()
    for value in (private_key, public_key):
        assert value
        assert "\n" not in value
        assert value == value.strip()


def test_private_key_is_readable_by_py_vapid():
    """pywebpush が実際に通す経路（Vapid01.from_string）でそのまま読めること。"""
    private_key, _ = generate_vapid_keys.generate_keys()
    assert Vapid01.from_string(private_key=private_key) is not None


def test_public_key_matches_private_key():
    """公開鍵が秘密鍵から導かれるものと一致すること（取り違えると購読が全部失敗する）。"""
    from cryptography.hazmat.primitives import serialization
    from py_vapid.utils import b64urlencode

    private_key, public_key = generate_vapid_keys.generate_keys()
    derived = Vapid01.from_string(private_key=private_key).public_key.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    assert b64urlencode(derived) == public_key


def test_out_writes_files_without_printing_values(tmp_path, capsys):
    private_key, public_key = generate_vapid_keys.generate_keys()
    out_dir = tmp_path / "vapid"
    generate_vapid_keys.write_files(out_dir, private_key, public_key)

    assert (out_dir / "vapid-private-key").read_text(encoding="utf-8") == private_key
    assert (out_dir / "vapid-public-key").read_text(encoding="utf-8") == public_key
    assert (out_dir / "vapid-private-key").stat().st_mode & 0o777 == 0o600

    printed = capsys.readouterr().out
    assert private_key not in printed
    assert public_key not in printed
