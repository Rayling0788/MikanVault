import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function mix(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}

function blendOver(dst, srcR, srcG, srcB, srcA) {
  const a = clamp(srcA, 0, 1);
  if (a <= 0) return;
  const outA = a + dst[3] * (1 - a);
  if (outA <= 0) return;
  dst[0] = (srcR * a + dst[0] * dst[3] * (1 - a)) / outA;
  dst[1] = (srcG * a + dst[1] * dst[3] * (1 - a)) / outA;
  dst[2] = (srcB * a + dst[2] * dst[3] * (1 - a)) / outA;
  dst[3] = outA;
}

// Signed distance to rounded box centered at (cx, cy) with half-extents (hx, hy) and radius r
function sdRoundedBox(x, y, cx, cy, hx, hy, r) {
  const qx = Math.abs(x - cx) - hx + r;
  const qy = Math.abs(y - cy) - hy + r;
  const outX = Math.max(qx, 0);
  const outY = Math.max(qy, 0);
  return Math.hypot(outX, outY) + Math.min(Math.max(qx, qy), 0) - r;
}

// Signed distance to rounded triangle (points p0, p1, p2) with corner rounding r
function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h);
}

function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const s1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const s2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const s3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = s1 < 0 || s2 < 0 || s3 < 0;
  const hasPos = s1 > 0 || s2 > 0 || s3 > 0;
  return !(hasNeg && hasPos);
}

function sdTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d = Math.min(
    sdSegment(px, py, ax, ay, bx, by),
    sdSegment(px, py, bx, by, cx, cy),
    sdSegment(px, py, cx, cy, ax, ay),
  );
  return pointInTriangle(px, py, ax, ay, bx, by, cx, cy) ? -d : d;
}

/**
 * Render MikanVault BrandLogo at size x size with 4x4 supersampling.
 * ViewBox coordinates: 0..40 matching src/components/BrandLogo.tsx.
 */
function renderLogoRgba(size) {
  const buf = Buffer.alloc(size * size * 4);
  const ss = 4;
  const invSs = 1 / ss;
  const invSs2 = 1 / (ss * ss);

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let accR = 0;
      let accG = 0;
      let accB = 0;
      let accA = 0;

      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const ux = ((px + (sx + 0.5) * invSs) / size) * 40;
          const uy = ((py + (sy + 0.5) * invSs) / size) * 40;

          const pix = [0, 0, 0, 0];
          const aa = 0.25;

          // 1. Main tangerine squircle (x=2..38, y=2..38, r=10.8)
          const dShell = sdRoundedBox(ux, uy, 20, 20, 18, 18, 10.8);
          const shellCov = clamp(0.5 - dShell / aa, 0, 1);
          if (shellCov > 0) {
            const gradT = clamp(((ux - 4) + (uy - 3)) / 67, 0, 1);
            let r;
            let g;
            let b;
            if (gradT < 0.52) {
              const t = gradT / 0.52;
              r = mix(255, 255, t);
              g = mix(158, 122, t);
              b = mix(79, 47, t);
            } else {
              const t = (gradT - 0.52) / 0.48;
              r = mix(255, 217, t);
              g = mix(122, 78, t);
              b = mix(47, 15, t);
            }
            blendOver(pix, r, g, b, shellCov);

            // Subtle inner glass highlight border
            const borderCov = clamp(1 - Math.abs(dShell + 0.55) / 0.55, 0, 1) * shellCov;
            if (borderCov > 0) {
              blendOver(pix, 255, 255, 255, borderCov * 0.24);
            }
          }

          // 2. Subtle citrus ring centered at (20, 21), r=11, stroke=1.5
          const dRing = Math.abs(Math.hypot(ux - 20, uy - 21) - 11) - 0.75;
          const ringCov = clamp(0.5 - dRing / aa, 0, 1);
          if (ringCov > 0) {
            blendOver(pix, 11, 13, 17, ringCov * 0.24);
          }

          // 3. Cinema play aperture triangle (rounded)
          const dTri = sdTriangle(ux, uy, 16.9, 15.1, 16.9, 25.9, 26.2, 20.5) - 0.55;
          const triCov = clamp(0.5 - dTri / aa, 0, 1);
          if (triCov > 0) {
            blendOver(pix, 11, 13, 17, triCov);
          }

          // 4. Tiny citrus leaf accent at top right
          const dLeafTop = sdRoundedBox(
            (ux - 24.8) * 0.86 - (uy - 7.1) * 0.5 + 24.8,
            (ux - 24.8) * 0.5 + (uy - 7.1) * 0.86 + 7.1,
            24.8,
            7.1,
            3.6,
            1.45,
            1.4,
          );
          const leafCov = clamp(0.5 - dLeafTop / aa, 0, 1);
          if (leafCov > 0) {
            const lt = clamp((ux - 21) / 7.5, 0, 1);
            blendOver(pix, mix(74, 22, lt), mix(222, 163, lt), mix(128, 74, lt), leafCov);
          }

          accR += pix[0] * pix[3];
          accG += pix[1] * pix[3];
          accB += pix[2] * pix[3];
          accA += pix[3];
        }
      }

      const outA = accA * invSs2;
      const idx = (py * size + px) * 4;
      if (outA > 0) {
        buf[idx] = clamp(Math.round((accR * invSs2) / outA), 0, 255);
        buf[idx + 1] = clamp(Math.round((accG * invSs2) / outA), 0, 255);
        buf[idx + 2] = clamp(Math.round((accB * invSs2) / outA), 0, 255);
        buf[idx + 3] = clamp(Math.round(outA * 255), 0, 255);
      }
    }
  }
  return buf;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodeBmpDibEntry(size, rgba) {
  const headerSize = 40;
  const xorSize = size * size * 4;
  const maskRowBytes = Math.ceil(size / 32) * 4;
  const andSize = maskRowBytes * size;
  const out = Buffer.alloc(headerSize + xorSize + andSize);

  out.writeUInt32LE(headerSize, 0);
  out.writeInt32LE(size, 4);
  out.writeInt32LE(size * 2, 8);
  out.writeUInt16LE(1, 12); // planes
  out.writeUInt16LE(32, 14); // 32bpp BGRA
  out.writeUInt32LE(0, 16); // BI_RGB
  out.writeUInt32LE(xorSize + andSize, 20);

  // Bottom-up BGRA rows
  for (let y = 0; y < size; y += 1) {
    const srcY = size - 1 - y;
    for (let x = 0; x < size; x += 1) {
      const s = (srcY * size + x) * 4;
      const d = headerSize + (y * size + x) * 4;
      out[d] = rgba[s + 2]; // B
      out[d + 1] = rgba[s + 1]; // G
      out[d + 2] = rgba[s]; // R
      out[d + 3] = rgba[s + 3]; // A
    }
  }
  return out;
}

function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // ICO
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(entries.length * 16);
  let offset = 6 + dir.length;

  for (let i = 0; i < entries.length; i += 1) {
    const { size, data } = entries[i];
    const p = i * 16;
    dir[p] = size >= 256 ? 0 : size;
    dir[p + 1] = size >= 256 ? 0 : size;
    dir[p + 2] = 0;
    dir[p + 3] = 0;
    dir.writeUInt16LE(1, p + 4);
    dir.writeUInt16LE(32, p + 6);
    dir.writeUInt32LE(data.length, p + 8);
    dir.writeUInt32LE(offset, p + 12);
    offset += data.length;
  }

  return Buffer.concat([header, dir, ...entries.map((e) => e.data)]);
}

const buildDir = path.resolve(process.cwd(), 'build');
fs.mkdirSync(buildDir, { recursive: true });

const png256 = encodePng(256, renderLogoRgba(256));
fs.writeFileSync(path.join(buildDir, 'icon.png'), png256);

const sizes = [16, 32, 48, 64, 128, 256];
const icoEntries = sizes.map((size) => {
  if (size === 256) {
    return { size, data: png256 };
  }
  return { size, data: encodeBmpDibEntry(size, renderLogoRgba(size)) };
});
fs.writeFileSync(path.join(buildDir, 'icon.ico'), buildIco(icoEntries));

console.log('Generated build/icon.png and build/icon.ico successfully.');
