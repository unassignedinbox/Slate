import sys, zlib, struct
size = int(sys.argv[1]) if len(sys.argv) > 1 else 1100
out = sys.argv[2] if len(sys.argv) > 2 else '/tmp/plan.png'
raw = open('/tmp/plan.raw','rb').read()
rows = b''.join(b'\x00' + raw[y*size*3:(y+1)*size*3] for y in range(size))
def chunk(t, d):
    c = struct.pack('>I', len(d)) + t + d
    return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
png = (b'\x89PNG\r\n\x1a\n'
       + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(rows, 6))
       + chunk(b'IEND', b''))
open(out,'wb').write(png)
print('wrote', out, len(png), 'bytes')
