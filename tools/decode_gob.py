#!/usr/bin/env python3
"""
Minimal Go gob decoder for Spectrolite single-ink profile files.

Schema (Go):
  type RGB8 struct { R, G, B uint8 }
  type singleColorMatcherOut struct {
      RisoColors           []RGB8         // observed colors at varying coverage
      ColorsCloseToIdxRiso map[RGB8]uint8 // RGB → coverage byte (0..255)
  }

For each ink we sample the map at coverage values {26, 76, 128, 178, 255}
(approximately 10/30/50/70/100%), averaging all RGB keys that map to each
coverage. This gives a 5-point LUT compatible with Risocam's RISO_CAL.
"""

import os
import struct
import sys
import json
from collections import defaultdict


# ---------------------------------------------------------------------------
# Low-level gob primitives
# ---------------------------------------------------------------------------

class Reader:
    def __init__(self, data, off=0):
        self.data = data
        self.off = off

    def u8(self):
        v = self.data[self.off]
        self.off += 1
        return v

    def take(self, n):
        v = self.data[self.off:self.off + n]
        self.off += n
        return v

    def uint(self):
        """Decode gob unsigned integer.
        Single byte if < 128; else byte = -count, then count big-endian bytes."""
        b = self.u8()
        if b < 128:
            return b
        n = 256 - b  # count of bytes that follow
        v = 0
        for _ in range(n):
            v = (v << 8) | self.u8()
        return v

    def sint(self):
        """Decode gob signed integer via zigzag."""
        u = self.uint()
        if u & 1:
            return -((u + 1) >> 1)
        return u >> 1

    def bytes_with_len(self):
        n = self.uint()
        return self.take(n)

    def string(self):
        return self.bytes_with_len().decode('utf-8')


# ---------------------------------------------------------------------------
# Spectrolite-specific decoder
# ---------------------------------------------------------------------------
# A gob stream is a series of (length-prefixed) messages. The first few
# messages are type definitions (wireType); later messages are values.
#
# Each message begins with a uint length, then bytes. Inside the bytes:
#   - first sint is the typeID
#   - negative typeID → defining type N=-typeID; body = wireType struct
#   - positive typeID → a value of that type
#
# We don't fully parse type defs — we just skip them. Then we parse the
# singleColorMatcherOut value using known structure.


def parse_array_RGB8(r):
    """RGB8 in Spectrolite is `[3]uint8`. gob encodes arrays as
       length prefix (uint) + N elements, even for fixed-size arrays.
       Each uint8 is encoded as a gob uint."""
    n = r.uint()
    rgb = [0, 0, 0]
    for i in range(n):
        v = r.uint() & 0xff
        if i < 3:
            rgb[i] = v
    return tuple(rgb)


def parse_singleColorMatcherOut(r):
    """Parse the value of singleColorMatcherOut.
    struct{ RisoColors []RGB8; ColorsCloseToIdxRiso map[RGB8]uint8 }"""
    riso_colors = []
    cov_map = {}
    field_idx = -1
    while True:
        delta = r.uint()
        if delta == 0:
            break
        field_idx += delta
        if field_idx == 0:
            # RisoColors []RGB8 — slice: length uint then elements
            n = r.uint()
            for _ in range(n):
                riso_colors.append(parse_array_RGB8(r))
        elif field_idx == 1:
            # ColorsCloseToIdxRiso map[RGB8]uint8 — length then key/value pairs
            n = r.uint()
            for _ in range(n):
                k = parse_array_RGB8(r)
                v = r.uint() & 0xff
                cov_map[k] = v
        else:
            # Skip unknown — best effort
            return riso_colors, cov_map
    return riso_colors, cov_map


def decode_file(path):
    with open(path, 'rb') as f:
        data = f.read()
    r = Reader(data)
    # Walk messages: type defs (typeID < 0) until we hit value (typeID >= 0).
    while r.off < len(data):
        msg_len = r.uint()
        msg_end = r.off + msg_len
        tid = r.sint()
        if tid < 0:
            # type def — skip
            r.off = msg_end
            continue
        # value message — should be our singleColorMatcherOut
        riso, cov = parse_singleColorMatcherOut(r)
        return riso, cov
    raise RuntimeError(f"no value message found in {path}")


# ---------------------------------------------------------------------------
# Sample 5-point swatches
# ---------------------------------------------------------------------------
# RisoColors[i] is the rendered color at coverage i (i in 0..255). So we just
# index directly. That's far cleaner than averaging the inverse map.
#
# 10/30/50/70/100% → indices 26, 76, 128, 178, 255.

SAMPLE_COVERAGES = [26, 76, 128, 178, 255]
SAMPLE_LABELS    = ['10%', '30%', '50%', '70%', '100%']


def sample_swatches(riso_colors):
    """Return list of 5 (R,G,B) tuples in 0..255 at the standard coverages."""
    if len(riso_colors) < 256:
        # Some inks might have shorter arrays — pad with last entry
        last = riso_colors[-1] if riso_colors else (255, 255, 255)
        riso_colors = list(riso_colors) + [last] * (256 - len(riso_colors))
    return [riso_colors[c] for c in SAMPLE_COVERAGES]


def fmt_lut(swatches):
    """Format as JS array of [r,g,b] floats in 0..1 to 3 decimals."""
    items = []
    for r, g, b in swatches:
        items.append(f"[{r/255:.3f},{g/255:.3f},{b/255:.3f}]")
    return "[" + ",".join(items) + "]"


def hex_color(rgb):
    r, g, b = rgb
    return f"#{r:02x}{g:02x}{b:02x}"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    profile_dir = "/Applications/Spectrolite.app/Contents/Resources/bin/single-ink-profiles"
    out = {}
    failures = []

    files = sorted(os.listdir(profile_dir))
    for fn in files:
        if not fn.endswith('.gob'):
            continue
        name = fn[:-4]
        path = os.path.join(profile_dir, fn)
        try:
            riso, cov = decode_file(path)
            swatches = sample_swatches(riso)
            out[name] = {
                'n_riso_colors': len(riso),
                'n_map_entries': len(cov),
                'swatches': swatches,
                'cov_0':   riso[0]   if len(riso) > 0   else None,
                'cov_26':  riso[26]  if len(riso) > 26  else None,
                'cov_76':  riso[76]  if len(riso) > 76  else None,
                'cov_128': riso[128] if len(riso) > 128 else None,
                'cov_178': riso[178] if len(riso) > 178 else None,
                'cov_255': riso[255] if len(riso) > 255 else None,
            }
        except Exception as e:
            failures.append((fn, str(e)))

    # Pretty-print summary
    print("=" * 78)
    print(f"Decoded {len(out)}/{len(files)} profiles")
    if failures:
        print(f"Failures: {len(failures)}")
        for fn, e in failures[:5]:
            print(f"  {fn}: {e}")
    print("=" * 78)
    print()
    print(f"{'name':<22}{'paper(0%)':<14}{'10%':<14}{'30%':<14}{'50%':<14}{'70%':<14}{'100%':<14}")
    print("-" * 78)
    for name in sorted(out.keys()):
        e = out[name]
        s = e['swatches']
        paper = e['cov_0']
        def fc(rgb):
            return hex_color(rgb) if rgb else 'n/a   '
        print(f"{name:<22}{fc(paper):<14}{fc(s[0]):<14}{fc(s[1]):<14}{fc(s[2]):<14}{fc(s[3]):<14}{fc(s[4]):<14}")

    # JSON for downstream
    with open('/tmp/spectrolite_inks.json', 'w') as f:
        json.dump({
            'profiles': {
                name: {
                    'paper': e['cov_0'],
                    'swatches': e['swatches'],
                    'n_riso_colors': e['n_riso_colors'],
                    'n_map_entries': e['n_map_entries'],
                } for name, e in out.items()
            }
        }, f, indent=2)
    print()
    print("JSON written to /tmp/spectrolite_inks.json")

    # Specifically: black vs charcoal vs gray
    print()
    print("=" * 78)
    print("BLACK vs CHARCOAL vs GRAY vs LIGHT-GRAY — full coverage")
    print("=" * 78)
    for n in ['black', 'charcoal', 'gray', 'light-gray']:
        if n in out:
            e = out[n]
            print(f"{n:<14} paper={hex_color(e['cov_0']) if e['cov_0'] else '?':<8} "
                  f"50%={hex_color(e['cov_128']) if e['cov_128'] else '?':<8} "
                  f"100%={hex_color(e['cov_255']) if e['cov_255'] else '?':<8}")

    # JS replacement snippets for Risocam's RISO_CAL — for synthetic entries.
    #
    # Map Risocam ink name → Spectrolite profile name + existing hex/gamma/etc.
    # Only LUT is replaced; hex/gamma/grainMul/fluo flags preserved.
    print()
    print("=" * 78)
    print("JS LUT REPLACEMENTS (paste into js/data.js to upgrade synthetic LUTs)")
    print("=" * 78)
    # Mapping: Risocam name → Spectrolite filename stem
    mapping = {
        'Bisque':      ('bisque',      '#f4d6b8', 0.92, 0.45, False, ''),
        'Bubblegum':   ('bubblegum',   '#e89cae', 0.95, 0.55, False, ''),
        'Lagoon':      ('lagoon',      '#79d2c8', 1.00, 0.50, True,  ''),
        'Indigo':      ('indigo',      '#41476b', 0.62, 1.30, False, ''),
        'Kelly Green': ('kelly-green', '#67b346', 0.78, 0.85, False, ''),
        'Wine':        ('wine',        '#9b1e3a', 0.55, 1.00, False, ''),
        'Smoky Teal':  ('smoky-teal',  '#65949d', 0.78, 0.95, False, ''),
        'Fl. Red':     ('fluorescent-red', '#ff4040', 0.65, 0.80, True, ''),
        'Burgundy':    ('burgundy',    '#622233', 0.55, 1.10, False, ''),
        # Black: use Spectrolite's true black (linear) instead of charcoal-warm.
        # This makes CMYK K-channel produce real black.
        'Black':       ('black',       '#1a1a1a', 0.50, 1.40, False, ''),
    }
    for ink_name, (gob_name, hex_c, gamma, grain, fluo, extra) in mapping.items():
        if gob_name not in out:
            print(f"  // MISSING: {gob_name}")
            continue
        e = out[gob_name]
        lut_str = fmt_lut(e['swatches'])
        fluo_s = 'true' if fluo else 'false'
        line = f"  '{ink_name}':"
        line += f" {{ hex:'{hex_c}', gamma:{gamma}, grainMul:{grain}, fluo:{fluo_s},"
        if extra:
            line += f" {extra}"
        line += f" lut:{lut_str} }},"
        print(line)

    # Bonus: a few more inks Risocam might want
    print()
    print("// Additional Spectrolite inks not in Risocam — could be added:")
    extras_to_show = ['mint', 'mist', 'seafoam', 'orchid', 'plum', 'grape',
                      'sea-blue', 'medium-blue', 'midnight', 'forest', 'pine',
                      'maroon', 'crimson', 'tomato', 'pumpkin', 'mahogany',
                      'sunflower', 'apricot', 'paprika']
    for name in extras_to_show:
        if name in out:
            e = out[name]
            full = hex_color(e['cov_255']) if e['cov_255'] else '?'
            print(f"//   {name:<22} full-coverage={full}")

if __name__ == '__main__':
    main()
