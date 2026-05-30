import base64
import json

def _encode_pow_payload(config, nonce):
    prefix = (json.dumps(config[:3], separators=(",", ":"), ensure_ascii=False)[:-1] + ",").encode("utf-8")
    middle = (
        "," + json.dumps(config[4:9], separators=(",", ":"), ensure_ascii=False)[1:-1] + ","
    ).encode("utf-8")
    suffix = ("," + json.dumps(config[10:], separators=(",", ":"), ensure_ascii=False)[1:]).encode("utf-8")
    body = prefix + str(nonce).encode("ascii") + middle + str(nonce >> 1).encode("ascii") + suffix
    return base64.b64encode(body)

config = [
  3120,
  "Thu May 28 2026 16:39:48 GMT+0700 (Indochina Time)",
  4294705152,
  0,
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
  "",
  "",
  "en-US",
  "en-US,es-US,en,es",
  0,
  "location",
  "location",
  "window",
  1234.56,
  "e40e9d4a-77df-4d18-ade9-02e5c988de0c",
  "",
  8,
  1779961068359
]

nonce = 459
encoded = _encode_pow_payload(config, nonce)
print('Python payload encoded length:', len(encoded))
print('Python payload encoded string:', encoded.decode('ascii'))
print('Python body decoded:', base64.b64decode(encoded).decode('utf-8'))
