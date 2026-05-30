"""
Sentinel Proof-of-Work 求解器
用于生成 OpenAI Sentinel 反机器人验证所需的 PoW token。

原理：构造浏览器指纹 payload，通过 SHA3-512 哈希碰撞找到满足难度要求的 nonce，
生成 base64 编码的证明 token。
"""

from __future__ import annotations

import base64
import hashlib
import json
import random
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Sequence


# 默认难度（越短越容易）
DEFAULT_SENTINEL_DIFF = "0fffff"
DEFAULT_MAX_ITERATIONS = 500_000

# 浏览器环境指纹常量
_SCREEN_SIGNATURES = (3000, 3120, 4000, 4160)
_LANGUAGE_SIGNATURE = "en-US,es-US,en,es"
_NAVIGATOR_KEYS = ("location", "ontransitionend", "onprogress")
_WINDOW_KEYS = ("window", "document", "navigator")


class SentinelPOWError(RuntimeError):
    """PoW 求解失败时抛出"""


def _format_browser_time() -> str:
    """生成浏览器风格的时间戳字符串"""
    browser_now = datetime.now(timezone(timedelta(hours=-5)))
    return browser_now.strftime("%a %b %d %Y %H:%M:%S") + " GMT-0500 (Eastern Standard Time)"


def build_sentinel_config(user_agent: str) -> list:
    """构造浏览器指纹 payload，模拟真实浏览器环境信息"""
    perf_ms = time.perf_counter() * 1000
    epoch_ms = (time.time() * 1000) - perf_ms
    return [
        random.choice(_SCREEN_SIGNATURES),
        _format_browser_time(),
        4294705152,
        0,
        user_agent,
        "",
        "",
        "en-US",
        _LANGUAGE_SIGNATURE,
        0,
        random.choice(_NAVIGATOR_KEYS),
        "location",
        random.choice(_WINDOW_KEYS),
        perf_ms,
        str(uuid.uuid4()),
        "",
        8,
        epoch_ms,
    ]


def _encode_pow_payload(config: Sequence[object], nonce: int) -> bytes:
    """将 config 和 nonce 编码为 base64 payload，用于哈希碰撞"""
    prefix = (json.dumps(config[:3], separators=(",", ":"), ensure_ascii=False)[:-1] + ",").encode("utf-8")
    middle = (
        "," + json.dumps(config[4:9], separators=(",", ":"), ensure_ascii=False)[1:-1] + ","
    ).encode("utf-8")
    suffix = ("," + json.dumps(config[10:], separators=(",", ":"), ensure_ascii=False)[1:]).encode("utf-8")
    body = prefix + str(nonce).encode("ascii") + middle + str(nonce >> 1).encode("ascii") + suffix
    return base64.b64encode(body)


def solve_sentinel_pow(
    seed: str,
    difficulty: str,
    config: Sequence[object],
    max_iterations: int = DEFAULT_MAX_ITERATIONS,
) -> str:
    """
    求解 Sentinel PoW 挑战。
    
    通过暴力枚举 nonce，找到使 SHA3-512(seed + payload) 的前缀
    满足难度要求的解。
    
    Returns:
        base64 编码的解答字符串
    
    Raises:
        SentinelPOWError: 超过最大迭代次数仍未找到解
    """
    seed_bytes = seed.encode("utf-8")
    target = bytes.fromhex(difficulty)
    prefix_length = len(target)

    for nonce in range(max_iterations):
        encoded = _encode_pow_payload(config, nonce)
        digest = hashlib.sha3_512(seed_bytes + encoded).digest()
        if digest[:prefix_length] <= target:
            return encoded.decode("ascii")

    raise SentinelPOWError(f"failed to solve sentinel pow after {max_iterations} attempts")


def build_sentinel_pow_token(
    user_agent: str,
    difficulty: str = DEFAULT_SENTINEL_DIFF,
    max_iterations: int = DEFAULT_MAX_ITERATIONS,
) -> str:
    """
    构建 Sentinel 请求所需的 `p` token。
    
    这是对外的主入口函数。生成浏览器指纹 → 随机种子 → 求解 PoW → 
    返回 `gAAAAAC{solution}` 格式的 token。
    
    Args:
        user_agent: 浏览器 User-Agent 字符串
        difficulty: 难度值（十六进制）
        max_iterations: 最大迭代次数
        
    Returns:
        格式为 "gAAAAAC{base64_solution}" 的 token 字符串
    """
    config = build_sentinel_config(user_agent)
    seed = format(random.random())
    solution = solve_sentinel_pow(seed, difficulty, config, max_iterations=max_iterations)
    return f"gAAAAAC{solution}"
