#!/usr/bin/env python3
"""Exact RISORINC3 parser: 0x1E '&' <args> '&' <letter> [payload(len from arg for i/e/n)]."""
import numpy as np
from pathlib import Path

PAYLOAD_CMDS = {'i', 'e', 'n'}  # arg (first numeric field) = payload byte length

def parse_commands(data):
    """Yield (offset, letter, args_str, payload_bytes)."""
    N = len(data)
    i = 0
    out = []
    while i < N:
        if data[i] != 0x1E:
            i += 1
            continue
        if i + 1 < N and data[i+1] == ord('R'):
            out.append((i, 'R', '', b''))
            i += 2
            continue
        if i + 1 < N and data[i+1] == ord('&'):
            j = i + 2
            while j < N and data[j] != ord('&'):
                j += 1
            args = data[i+2:j].decode('latin-1')
            letter = chr(data[j+1]) if j + 1 < N else '?'
            pstart = j + 2
            plen = 0
            if letter in PAYLOAD_CMDS:
                first = args.split(';')[0]
                if first.isdigit():
                    plen = int(first)
            out.append((i, letter, args, data[pstart:pstart+plen]))
            i = pstart + plen
            continue
        i += 1
    return out

def packbits_decode(buf):
    out = bytearray()
    i, n = 0, len(buf)
    while i < n:
        b = buf[i]; i += 1
        if b < 128:
            cnt = b + 1
            out += buf[i:i+cnt]
            i += cnt
        elif b == 128:
            pass
        else:
            cnt = 257 - b
            if i < n:
                out += bytes([buf[i]]) * cnt
                i += 1
    return bytes(out)

BIT_LUT = np.unpackbits(np.arange(256, dtype=np.uint8)[:, None], axis=1)  # MSB first

def decode_prn(path):
    """Return (img uint8 [H,W] 1=ink, meta dict). Row index = V value - V_min."""
    data = Path(path).read_bytes()
    cmds = parse_commands(data)
    meta = {'header': [(l, a) for _, l, a, _ in cmds if l not in ('i', 'V', 'H')][:40]}
    rows = {}
    cur_v, cur_h = None, 0
    for _, letter, args, payload in cmds:
        if letter == 'V':
            cur_v = int(args)
        elif letter == 'H':
            cur_h = int(args)
        elif letter == 'i' and cur_v is not None:
            rows[cur_v] = (cur_h, packbits_decode(payload))
    if not rows:
        return np.zeros((0, 0), np.uint8), meta
    vmin, vmax = min(rows), max(rows)
    # width: H offset is in bytes? assume px offset/8 ambiguous -> check lens
    maxlen = max(len(r[1]) for r in rows.values())
    W = maxlen * 8
    H = vmax - vmin + 1
    img = np.zeros((H, W), np.uint8)
    for v, (h, rb) in rows.items():
        bits = BIT_LUT[np.frombuffer(rb, np.uint8)].reshape(-1)
        img[v - vmin, :len(bits)] = bits
    meta.update(v_min=vmin, v_max=vmax, n_rows=len(rows),
                bytes_per_row=maxlen, width_px=W, height_px=H, h_offset=cur_h)
    return img, meta

def write_png(path, arr01):
    """arr01: uint8 0/1, 1=ink -> black."""
    from PIL import Image
    Image.fromarray(np.where(arr01 > 0, 0, 255).astype(np.uint8), 'L').save(path, optimize=True)
