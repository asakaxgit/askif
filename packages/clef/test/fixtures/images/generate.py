#!/usr/bin/env python3
"""Regenerate the synthetic test images in this directory.

Pure Python standard library only (no Pillow, no network): the PNG, baseline
JPEG and lossless WebP (VP8L) encoders below are minimal and deterministic, so
re-running this script produces byte-identical files.

    python3 generate.py
"""
import math
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
SIZE = 128
WHITE = (255, 255, 255)


def render(size, pixel):
    """pixel(x, y) -> (r, g, b); returns rows of RGB tuples."""
    return [[pixel(x, y) for x in range(size)] for y in range(size)]


# ---------------------------------------------------------------- encoders
def encode_png(img):
    h, w = len(img), len(img[0])
    raw = b"".join(b"\x00" + bytes(c for px in row for c in px) for row in img)

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


ZIGZAG = [
    0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48,
    41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22,
    15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55,
    62, 63,
]
# Standard JPEG luminance quantisation table (Annex K), used for all components.
QBASE = [
    16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55,
    14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
    49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
]
JPEG_QUALITY = 90
QTAB = [max(1, min(255, (q * (200 - 2 * JPEG_QUALITY) + 50) // 100)) for q in QBASE]
COS = [[math.cos((2 * x + 1) * u * math.pi / 16) for x in range(8)] for u in range(8)]
CU = [1 / math.sqrt(2)] + [1.0] * 7
# Simple valid Huffman tables: DC = 12 symbols of 4 bits; AC = the 162 symbols
# (run 0-15 x size 1-10, EOB 0x00, ZRL 0xF0) of 8 bits. Suboptimal, but the
# images are tiny and this avoids carrying the long standard tables.
AC_SYMS = sorted([(r << 4) | s for r in range(16) for s in range(1, 11)] + [0x00, 0xF0])
DC_CODE = {s: (s, 4) for s in range(12)}
AC_CODE = {s: (i, 8) for i, s in enumerate(AC_SYMS)}


def encode_jpeg(img):
    h, w = len(img), len(img[0])
    assert h % 8 == 0 and w % 8 == 0
    planes = ([], [], [])
    for row in img:
        py, pb, pr = [], [], []
        for r, g, b in row:
            py.append(0.299 * r + 0.587 * g + 0.114 * b)
            pb.append(-0.168736 * r - 0.331264 * g + 0.5 * b + 128)
            pr.append(0.5 * r - 0.418688 * g - 0.081312 * b + 128)
        planes[0].append(py)
        planes[1].append(pb)
        planes[2].append(pr)

    out = bytearray()
    acc = 0
    nbits = 0

    def put(code, length):
        nonlocal acc, nbits
        acc = (acc << length) | (code & ((1 << length) - 1))
        nbits += length
        while nbits >= 8:
            byte = (acc >> (nbits - 8)) & 0xFF
            out.append(byte)
            if byte == 0xFF:
                out.append(0)
            nbits -= 8
        acc &= (1 << nbits) - 1

    def vli(v):
        size = abs(v).bit_length()
        return size, (v if v > 0 else v + (1 << size) - 1)

    preds = [0, 0, 0]
    for by in range(0, h, 8):
        for bx in range(0, w, 8):
            for c in range(3):
                blk = [[planes[c][by + y][bx + x] - 128 for x in range(8)] for y in range(8)]
                coef = [0] * 64
                for v in range(8):
                    for u in range(8):
                        s = sum(
                            blk[y][x] * COS[u][x] * COS[v][y]
                            for y in range(8)
                            for x in range(8)
                        )
                        coef[v * 8 + u] = round(s * CU[u] * CU[v] / 4 / QTAB[ZIGZAG.index(v * 8 + u)])
                zz = [coef[ZIGZAG[i]] for i in range(64)]
                diff = zz[0] - preds[c]
                preds[c] = zz[0]
                size, bits = vli(diff)
                put(*DC_CODE[size])
                if size:
                    put(bits, size)
                run = 0
                for i in range(1, 64):
                    if zz[i] == 0:
                        run += 1
                        continue
                    while run > 15:
                        put(*AC_CODE[0xF0])
                        run -= 16
                    size, bits = vli(zz[i])
                    put(*AC_CODE[(run << 4) | size])
                    put(bits, size)
                    run = 0
                if run:
                    put(*AC_CODE[0x00])
    if nbits:
        put((1 << (8 - nbits)) - 1, 8 - nbits)

    def seg(marker, data):
        return b"\xff" + bytes([marker]) + struct.pack(">H", len(data) + 2) + data

    dc_dht = bytes([0x00]) + bytes([0, 0, 0, 12] + [0] * 12) + bytes(range(12))
    ac_dht = bytes([0x10]) + bytes([0] * 7 + [162] + [0] * 8) + bytes(AC_SYMS)
    return (
        b"\xff\xd8"
        + seg(0xE0, b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00")
        + seg(0xDB, b"\x00" + bytes(QTAB[ZIGZAG[i]] for i in range(64)))
        + seg(0xC0, struct.pack(">BHHB", 8, h, w, 3) + b"\x01\x11\x00\x02\x11\x00\x03\x11\x00")
        + seg(0xC4, dc_dht)
        + seg(0xC4, ac_dht)
        + seg(0xDA, b"\x03\x01\x00\x02\x00\x03\x00\x00\x3f\x00")
        + bytes(out)
        + b"\xff\xd9"
    )


def encode_webp_lossless(img):
    """Minimal VP8L encoder: no transforms, no LZ77, every channel limited to
    at most two distinct values so each prefix code is a 'simple' code."""
    h, w = len(img), len(img[0])
    bits = []  # LSB-first bit list

    def put(value, n):
        for i in range(n):
            bits.append((value >> i) & 1)

    put(0x2F, 8)
    put(w - 1, 14)
    put(h - 1, 14)
    put(0, 1)  # alpha_is_used
    put(0, 3)  # version
    put(0, 1)  # no transform
    put(0, 1)  # no colour cache
    put(0, 1)  # no meta prefix image

    # Channel order in the stream: green, red, blue, alpha, then distance.
    chans = [
        sorted({px[1] for row in img for px in row}),
        sorted({px[0] for row in img for px in row}),
        sorted({px[2] for row in img for px in row}),
        [255],
    ]
    for syms in chans:
        assert 1 <= len(syms) <= 2, "webp writer supports <=2 values per channel"
        put(1, 1)  # simple code
        put(len(syms) - 1, 1)
        put(1, 1)  # first symbol uses 8 bits
        put(syms[0], 8)
        if len(syms) == 2:
            put(syms[1], 8)
    # distance code: single symbol 0 (never used)
    put(1, 1)
    put(0, 1)
    put(0, 1)
    put(0, 1)

    for row in img:
        for r, g, b in row:
            for syms, v in zip(chans[:3], (g, r, b)):
                if len(syms) == 2:
                    put(syms.index(v), 1)  # canonical codes: lower symbol = 0

    payload = bytearray()
    for i in range(0, len(bits), 8):
        byte = 0
        for j, bit in enumerate(bits[i : i + 8]):
            byte |= bit << j
        payload.append(byte)
    payload = bytes(payload)
    pad = b"\x00" if len(payload) % 2 else b""
    chunk = b"VP8L" + struct.pack("<I", len(payload)) + payload + pad
    return b"RIFF" + struct.pack("<I", 4 + len(chunk)) + b"WEBP" + chunk


# ---------------------------------------------------------------- drawings
C = SIZE / 2


def red_circle(x, y):
    return (220, 0, 0) if (x + 0.5 - C) ** 2 + (y + 0.5 - C) ** 2 <= 44**2 else WHITE


def blue_square(x, y):
    return (0, 0, 255) if 28 <= x < 100 and 28 <= y < 100 else WHITE


def green_triangle(x, y):
    top, base, left, right = 16, 108, 16, 112
    if not top <= y <= base:
        return WHITE
    half = (right - left) / 2 * (y - top) / (base - top)
    return (0, 160, 0) if abs(x + 0.5 - (left + right) / 2) <= half else WHITE


FONT = {
    "S": [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
    "T": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
    "O": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "P": ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
}
CELL, GAP = 4, 4
TEXT_W = 4 * 5 * CELL + 3 * GAP
TEXT_H = 7 * CELL
TEXT_X0 = (SIZE - TEXT_W) // 2
TEXT_Y0 = (SIZE - TEXT_H) // 2


def stop_text(x, y):
    tx, ty = x - TEXT_X0, y - TEXT_Y0
    if not (0 <= tx < TEXT_W and 0 <= ty < TEXT_H):
        return False
    letter, rem = divmod(tx, 5 * CELL + GAP)
    if rem >= 5 * CELL:
        return False
    return FONT["STOP"[letter]][ty // CELL][rem // CELL] == "#"


def stop_sign(x, y):
    a = 60.0
    s2 = a / (1 + math.sqrt(2))  # half side length
    dx, dy = abs(x + 0.5 - C), abs(y + 0.5 - C)
    if dx > a or dy > a or dx + dy > a + s2:
        return WHITE
    return WHITE if stop_text(x, y) else (200, 0, 0)


def checkerboard(x, y):
    return (0, 0, 0) if ((x // 16) + (y // 16)) % 2 == 0 else WHITE


def blank_white(x, y):
    return WHITE


IMAGES = [
    ("red-circle.png", encode_png, red_circle),
    ("blue-square.jpg", encode_jpeg, blue_square),
    ("green-triangle.webp", encode_webp_lossless, green_triangle),
    ("stop-sign.png", encode_png, stop_sign),
    ("checkerboard.png", encode_png, checkerboard),
    ("blank-white.jpg", encode_jpeg, blank_white),
]

if __name__ == "__main__":
    for name, encoder, fn in IMAGES:
        data = encoder(render(SIZE, fn))
        with open(os.path.join(HERE, name), "wb") as f:
            f.write(data)
        print(f"{name}: {len(data)} bytes")
