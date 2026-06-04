#!/usr/bin/env python3
"""
prn-decoder.py — decode a RISO MZ 9 driver-produced .prn capture into
per-plane PNG bit-masks so you can compare against the JS port.

Usage:
    python3 prn-decoder.py path/to/output.prn [--out outdir/]

What it does:
1. Scans the .prn byte stream for the RISO command escape sequences
   (`&V` paper-feed, `&H` horizontal margin, `&i` ink-set, etc.) and
   identifies the PackBits-compressed scanline blocks between them.
2. Decompresses each block (Apple-style PackBits: signed run-length).
3. Reassembles into per-plane 1-bit images and writes PNGs.

The PRN format on this driver is RISORINC3 — escape commands prefixed by
0x1B (ESC) followed by `&` plus parameter bytes, with scanline payload in
between. We treat it as a permissive byte-scan because the exact command
set has minor variants between firmware versions; the goal is to extract
the bit data regardless.

References:
- "RISORINC3" mentioned in *.ppd 1284DeviceID
- PackBits algorithm: standard TIFF compression
- Disassembly of rastertoRISO04A confirms 1-bit-per-pixel, MSB-first
"""
import argparse
import os
import struct
import sys
from pathlib import Path

# ── PNG writer (no Pillow dependency) ───────────────────────────────────────
import zlib
def write_png_gray(path, width, height, pixels):
    """Write a grayscale 8-bit PNG. pixels is bytes len=width*height."""
    def chunk(tag, data):
        crc = zlib.crc32(tag + data)
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', crc & 0xffffffff)
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 0, 0, 0, 0)  # 8-bit grayscale
    # Build raw image with filter byte 0 per scanline
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        raw.extend(pixels[y*width:(y+1)*width])
    idat = zlib.compress(bytes(raw), 9)
    with open(path, 'wb') as f:
        f.write(sig)
        f.write(chunk(b'IHDR', ihdr))
        f.write(chunk(b'IDAT', idat))
        f.write(chunk(b'IEND', b''))

# ── PackBits decompressor ───────────────────────────────────────────────────
def packbits_decode(data, expected_len=None):
    """Standard PackBits (Apple-style signed RLE).
    Returns the decompressed bytes and the number of input bytes consumed.
    """
    out = bytearray()
    i = 0
    while i < len(data):
        if expected_len is not None and len(out) >= expected_len:
            break
        n = data[i]; i += 1
        if n < 128:
            # literal: copy n+1 bytes
            cnt = n + 1
            out.extend(data[i:i+cnt])
            i += cnt
        elif n == 128:
            # no-op (per spec)
            pass
        else:
            # repeat: take next byte, repeat (257-n) times = (-(n as int8)+1)
            cnt = 257 - n
            if i >= len(data): break
            out.extend(bytes([data[i]] * cnt))
            i += 1
    return bytes(out), i

# ── Scan a .prn for likely scanline data blocks ─────────────────────────────
def scan_prn(data, verbose=False):
    """
    Walk the byte stream. ESC (0x1B) starts a command:
      ESC '&' '<letter>' <args...>
    The argument terminator + payload semantics vary by command. We're after
    the *raster data blocks* which on this driver are emitted between certain
    marker commands and typically contain the per-scanline PackBits stream.
    Returns a list of (offset, putative_length, decoded_bytes) tuples.
    """
    blocks = []
    i = 0
    N = len(data)
    while i < N:
        b = data[i]
        if b == 0x1B and i + 2 < N and data[i+1] == ord('&'):
            # command starts: ESC & <letter>...
            cmd_letter = chr(data[i+2])
            # Find end of command: it's typically terminated by an uppercase letter
            # or by reading numeric args. For simplicity, scan forward to next ESC.
            j = i + 3
            while j < N and data[j] != 0x1B:
                # Stop on cmd terminator (uppercase letter following digits)
                if (ord('A') <= data[j] <= ord('Z')) and j > i + 3 and any(ord('0') <= data[k] <= ord('9') for k in range(i+3, j)):
                    j += 1
                    break
                j += 1
            if verbose:
                cmd_str = data[i:j].decode('latin-1', errors='replace')
                print(f"  cmd @ 0x{i:08x}: &{cmd_letter} ... ({j-i} bytes) = {cmd_str[:60]!r}")
            i = j
        else:
            # Likely raster data starts here. Try to decode PackBits until
            # we hit another ESC or run off the end.
            start = i
            # Find next ESC
            next_esc = data.find(b'\x1b', i)
            if next_esc < 0: next_esc = N
            chunk_data = data[i:next_esc]
            if len(chunk_data) > 8:  # only interesting if non-trivial
                try:
                    decoded, consumed = packbits_decode(chunk_data)
                    if len(decoded) > 0:
                        blocks.append((start, next_esc - start, decoded))
                        if verbose:
                            print(f"  data @ 0x{start:08x}: {next_esc-start} raw → {len(decoded)} decoded bytes")
                except Exception as e:
                    if verbose:
                        print(f"  data @ 0x{start:08x}: decode failed: {e}")
            i = next_esc
    return blocks

# ── Try to reassemble decoded blocks into a 2D image ────────────────────────
def assemble_image(blocks, max_planes=4, verbose=False):
    """
    Given decoded blocks, attempt to find a consistent scanline width and
    reassemble. Heuristic: most blocks should have the same length (the
    bytes-per-scanline). Group runs of same-length blocks as planes.
    """
    if not blocks:
        return []
    # Get length histogram
    from collections import Counter
    lens = Counter(len(b[2]) for b in blocks)
    if verbose:
        print("\nDecoded-block length histogram (top 5):")
        for ln, count in lens.most_common(5):
            print(f"  {ln} bytes × {count} blocks")
    # Most common length is likely the bytes-per-scanline
    bpr, _ = lens.most_common(1)[0]
    # Pixels per row = bpr * 8 (1-bit packed)
    pix_per_row = bpr * 8
    # Group runs of same-bpr blocks separated by other commands
    # For simplicity: gather all blocks at this bpr into one big image,
    # then split into planes by looking for "restart" markers
    same_blocks = [b for b in blocks if len(b[2]) == bpr]
    if verbose:
        print(f"\nUsing bytes-per-row = {bpr} (= {pix_per_row} pixels)")
        print(f"Same-bpr scanlines: {len(same_blocks)}")
    # No way to perfectly separate planes without the command metadata,
    # so we just emit one image with all consistent scanlines stacked.
    height = len(same_blocks)
    if height == 0:
        return []
    # Unpack 1-bit MSB-first to 8-bit per pixel
    pixels = bytearray(pix_per_row * height)
    for y, (_, _, scanline) in enumerate(same_blocks):
        for x_byte, byte in enumerate(scanline):
            for bit in range(8):
                pix_x = x_byte * 8 + bit
                bit_set = (byte >> (7 - bit)) & 1
                # ink convention: 1 = ink/hole/black on output
                pixels[y * pix_per_row + pix_x] = 0 if bit_set else 255
    return [(pix_per_row, height, bytes(pixels))]

# ── Main ────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('prn_file')
    ap.add_argument('--out', default='.', help='output directory (default: cwd)')
    ap.add_argument('-v', '--verbose', action='store_true')
    args = ap.parse_args()

    data = Path(args.prn_file).read_bytes()
    print(f"Loaded {args.prn_file} ({len(data)} bytes)")

    # Show the first few escape commands to confirm format
    print("\nFirst commands:")
    for _ in range(8):
        i = data.find(b'\x1b&')
        if i < 0: break
        j = data.find(b'\x1b&', i + 1)
        if j < 0: j = min(i + 80, len(data))
        chunk = data[i:j]
        print(f"  0x{i:08x}: {chunk[:50]!r}")
        data = data[:i] + b'\x00' + data[i+1:]  # blank to find next
    data = Path(args.prn_file).read_bytes()  # restore

    blocks = scan_prn(data, verbose=args.verbose)
    print(f"\nFound {len(blocks)} candidate data blocks")

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    images = assemble_image(blocks, verbose=args.verbose)
    for idx, (w, h, pixels) in enumerate(images):
        out_path = out_dir / f"{Path(args.prn_file).stem}_plane{idx}.png"
        write_png_gray(out_path, w, h, pixels)
        # Coverage stat
        ink = sum(1 for p in pixels if p == 0)
        print(f"  wrote {out_path}  {w}×{h}, coverage={ink/(w*h)*100:.2f}%")

    if not images:
        print("\nNo consistent scanlines found. Try --verbose to inspect block sizes.")
        print("If the .prn uses a non-PackBits compression, this decoder won't work as-is.")

if __name__ == '__main__':
    main()
