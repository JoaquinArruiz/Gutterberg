"""Replace layers of a PNG-based .ico: patch-ico.py icon.ico 16=a.png 32=b.png"""
import struct
import sys


def main(path, *pairs):
    new = {int(s): open(p, "rb").read() for s, p in (a.split("=", 1) for a in pairs)}
    data = open(path, "rb").read()
    _, kind, count = struct.unpack_from("<HHH", data, 0)
    layers = []
    for i in range(count):
        w, h, colors, res, planes, bpp, size, offset = struct.unpack_from("<BBBBHHII", data, 6 + 16 * i)
        w = w or 256
        h = h or 256
        blob = data[offset : offset + size]
        if w == h and w in new:
            blob = new[w]
        layers.append((w, h, colors, res, planes, bpp, blob))
    missing = set(new) - {layer[0] for layer in layers}
    if missing:
        sys.exit(f"{path} has no {sorted(missing)} px layer")
    out = bytearray(struct.pack("<HHH", 0, kind, count))
    offset = 6 + 16 * count
    for w, h, colors, res, planes, bpp, blob in layers:
        out += struct.pack("<BBBBHHII", w % 256, h % 256, colors, res, planes, bpp, len(blob), offset)
        offset += len(blob)
    for layer in layers:
        out += layer[-1]
    open(path, "wb").write(out)


main(*sys.argv[1:])
