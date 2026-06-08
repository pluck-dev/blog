"""Google Indexing API 클라이언트 (TS indexing.ts 포팅).

서비스계정 JSON → RS256 JWT(cryptography) → oauth2 토큰 → urlNotifications:publish.
HTTP는 stdlib urllib 사용. 키 없으면 is_configured()=False 로 안전 비활성.

주의: Indexing API 는 공식적으로 JobPosting/BroadcastEvent 용이며 일반 페이지 제출은
구글 약관상 회색지대. 서비스계정 이메일을 각 사이트 Search Console 에 소유자로 추가해야 동작.
"""

from __future__ import annotations

import base64
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

TOKEN_URL = "https://oauth2.googleapis.com/token"
PUBLISH_URL = "https://indexing.googleapis.com/v3/urlNotifications:publish"
SCOPE = "https://www.googleapis.com/auth/indexing"


@dataclass
class ServiceAccount:
    client_email: str
    private_key: str
    token_uri: str = TOKEN_URL


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def parse_service_account(json_text: str | None) -> ServiceAccount:
    if not json_text or not json_text.strip():
        raise ValueError("서비스계정 키가 설정되지 않았습니다(미설정).")
    try:
        obj = json.loads(json_text)
    except json.JSONDecodeError:
        raise ValueError("서비스계정 JSON 형식이 올바르지 않습니다.")
    email = obj.get("client_email")
    key = obj.get("private_key")
    if not isinstance(email, str) or not isinstance(key, str) or not email or not key:
        raise ValueError("서비스계정 JSON 에 client_email / private_key 가 없습니다.")
    return ServiceAccount(client_email=email, private_key=key,
                          token_uri=obj.get("token_uri") or TOKEN_URL)


def is_configured(json_text: str | None) -> bool:
    try:
        parse_service_account(json_text)
        return True
    except Exception:
        return False


def build_assertion(sa: ServiceAccount, now_sec: int | None = None) -> str:
    now = now_sec if now_sec is not None else int(time.time())
    header = _b64url(json.dumps({"alg": "RS256", "typ": "JWT"}, separators=(",", ":")).encode())
    claim = _b64url(json.dumps({
        "iss": sa.client_email, "scope": SCOPE, "aud": sa.token_uri or TOKEN_URL,
        "iat": now, "exp": now + 3600,
    }, separators=(",", ":")).encode())
    signing_input = f"{header}.{claim}".encode("ascii")
    private_key = serialization.load_pem_private_key(sa.private_key.encode("utf-8"), password=None)
    signature = private_key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
    return f"{header}.{claim}.{_b64url(signature)}"


def get_access_token(sa: ServiceAccount, *, timeout: int = 20) -> str:
    body = urllib.parse.urlencode({
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": build_assertion(sa),
    }).encode("ascii")
    req = urllib.request.Request(
        sa.token_uri or TOKEN_URL, data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="ignore")
        raise RuntimeError(f"토큰 발급 실패: HTTP {e.code} {detail[:200]}")
    token = data.get("access_token")
    if not token:
        raise RuntimeError(f"토큰 발급 실패: {data}")
    return token


def submit_url(access_token: str, url: str, notify_type: str = "URL_UPDATED",
               *, timeout: int = 20) -> dict:
    payload = json.dumps({"url": url, "type": notify_type}).encode()
    req = urllib.request.Request(
        PUBLISH_URL, data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {access_token}"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            resp.read()
        return {"url": url, "ok": True}
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="ignore")
        try:
            msg = json.loads(detail).get("error", {}).get("message", f"HTTP {e.code}")
        except Exception:
            msg = f"HTTP {e.code}"
        return {"url": url, "ok": False, "error": msg}
    except Exception as e:  # noqa: BLE001
        return {"url": url, "ok": False, "error": str(e)}


def build_post_url(template: str, domain: str, slug: str) -> str:
    t = (template or "").strip() or "https://{domain}/{slug}"
    return t.replace("{domain}", domain).replace("{slug}", slug)
