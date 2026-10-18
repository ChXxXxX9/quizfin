/* ==========================================================================
   Quiz Nuoto — generatore di QR code (qr.js), senza librerie esterne.
   Standard ISO/IEC 18004: modalità byte (UTF-8), versioni 1–40, correzione
   d'errore L/M/Q/H, scelta automatica della maschera migliore.
   QuizQR.svg(testo, { ecl: 'M', border: 4, dark, light }) → stringa SVG
   QuizQR.matrix(testo, { ecl }) → array di righe di booleani
   ========================================================================== */
(() => {
  'use strict';

  const ECL = { L: { ord: 0, bits: 1 }, M: { ord: 1, bits: 0 }, Q: { ord: 2, bits: 3 }, H: { ord: 3, bits: 2 } };
  const ECC_CODEWORDS_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  ];
  const NUM_ERROR_CORRECTION_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  ];

  const getBit = (x, i) => ((x >>> i) & 1) !== 0;

  function numRawDataModules(ver) {
    let result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }
  function numDataCodewords(ver, ecl) {
    return Math.floor(numRawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK[ecl.ord][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecl.ord][ver];
  }

  // ---- Reed–Solomon su GF(2^8), polinomio 0x11D ----
  function rsMultiply(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function rsDivisor(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < result.length; j++) {
        result[j] = rsMultiply(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = rsMultiply(root, 0x02);
    }
    return result;
  }
  function rsRemainder(data, divisor) {
    const result = divisor.map(() => 0);
    for (const b of data) {
      const factor = b ^ result.shift();
      result.push(0);
      divisor.forEach((coef, i) => { result[i] ^= rsMultiply(coef, factor); });
    }
    return result;
  }

  function utf8Bytes(text) {
    return Array.from(new TextEncoder().encode(String(text)));
  }

  function encode(text, eclName = 'M') {
    const ecl = ECL[eclName] || ECL.M;
    const bytes = utf8Bytes(text);
    // versione più piccola che contiene i dati
    let ver = 1;
    let dataCapacityBits = 0;
    for (; ver <= 40; ver++) {
      dataCapacityBits = numDataCodewords(ver, ecl) * 8;
      const ccBits = ver <= 9 ? 8 : 16;
      if (4 + ccBits + bytes.length * 8 <= dataCapacityBits) break;
    }
    if (ver > 40) throw new Error('Testo troppo lungo per un QR code.');

    // ---- flusso di bit ----
    const bits = [];
    const append = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    append(0x4, 4);
    append(bytes.length, ver <= 9 ? 8 : 16);
    bytes.forEach((b) => append(b, 8));
    append(0, Math.min(4, dataCapacityBits - bits.length));
    append(0, (8 - bits.length % 8) % 8);
    for (let pad = 0xEC; bits.length < dataCapacityBits; pad ^= 0xEC ^ 0x11) append(pad, 8);
    const dataCodewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      dataCodewords.push(b);
    }

    // ---- blocchi + correzione + interleaving ----
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl.ord][ver];
    const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl.ord][ver];
    const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
    const numShortBlocks = numBlocks - rawCodewords % numBlocks;
    const shortBlockLen = Math.floor(rawCodewords / numBlocks);
    const blocks = [];
    const divisor = rsDivisor(blockEccLen);
    for (let i = 0, k = 0; i < numBlocks; i++) {
      const dat = dataCodewords.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
      k += dat.length;
      const ecc = rsRemainder(dat, divisor);
      if (i < numShortBlocks) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const allCodewords = [];
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((block, j) => {
        if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) allCodewords.push(block[i]);
      });
    }

    // ---- matrice ----
    const size = ver * 4 + 17;
    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));
    const setFn = (x, y, dark) => { modules[y][x] = dark; isFunction[y][x] = true; };

    for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
    const finder = (x, y) => {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          const xx = x + dx; const yy = y + dy;
          if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFn(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    // allineamento
    const alignPos = [];
    if (ver > 1) {
      const numAlign = Math.floor(ver / 7) + 2;
      const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
      alignPos.push(6);
      for (let pos = size - 7; alignPos.length < numAlign; pos -= step) alignPos.splice(1, 0, pos);
    }
    const n = alignPos.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) setFn(alignPos[i] + dx, alignPos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
    const drawFormat = (mask) => {
      const data = (ecl.bits << 3) | mask;
      let rem = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const f = ((data << 10) | rem) ^ 0x5412;
      for (let i = 0; i <= 5; i++) setFn(8, i, getBit(f, i));
      setFn(8, 7, getBit(f, 6));
      setFn(8, 8, getBit(f, 7));
      setFn(7, 8, getBit(f, 8));
      for (let i = 9; i < 15; i++) setFn(14 - i, 8, getBit(f, i));
      for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, getBit(f, i));
      for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, getBit(f, i));
      setFn(8, size - 8, true);
    };
    drawFormat(0);
    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      const v = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const bit = getBit(v, i);
        const a = size - 11 + i % 3;
        const b = Math.floor(i / 3);
        setFn(a, b, bit);
        setFn(b, a, bit);
      }
    }
    // dati a zig-zag
    let bitIndex = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!isFunction[y][x] && bitIndex < allCodewords.length * 8) {
            modules[y][x] = getBit(allCodewords[bitIndex >>> 3], 7 - (bitIndex & 7));
            bitIndex++;
          }
        }
      }
    }
    // maschere
    const maskFn = [
      (x, y) => (x + y) % 2 === 0,
      (x, y) => y % 2 === 0,
      (x) => x % 3 === 0,
      (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
      (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
      (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0,
      (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0
    ];
    const applyMask = (m) => {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) if (!isFunction[y][x] && maskFn[m](x, y)) modules[y][x] = !modules[y][x];
      }
    };
    const penalty = () => {
      let score = 0;
      const line = (get) => {
        for (let a = 0; a < size; a++) {
          let runColor = null; let run = 0;
          const seq = [];
          for (let b = 0; b < size; b++) {
            const c = get(a, b);
            seq.push(c);
            if (c === runColor) { run++; if (run === 5) score += 3; else if (run > 5) score += 1; }
            else { runColor = c; run = 1; }
          }
          // motivo simile al mirino 1:1:3:1:1 con 4 chiari a lato
          for (let b = 0; b + 10 < size + 1; b++) {
            const p = (k) => (b + k < size ? seq[b + k] : false);
            const core = p(0) && !p(1) && p(2) && p(3) && p(4) && !p(5) && p(6);
            if (!core) continue;
            const before = [1, 2, 3, 4].every((k) => b - k < 0 || !seq[b - k]);
            const after = [7, 8, 9, 10].every((k) => b + k >= size || !seq[b + k]);
            if (before || after) score += 40;
          }
        }
      };
      line((a, b) => modules[a][b]);
      line((a, b) => modules[b][a]);
      for (let y = 0; y < size - 1; y++) {
        for (let x = 0; x < size - 1; x++) {
          const c = modules[y][x];
          if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3;
        }
      }
      let dark = 0;
      modules.forEach((row) => row.forEach((c) => { if (c) dark++; }));
      const total = size * size;
      const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
      score += Math.max(0, k) * 10;
      return score;
    };
    let best = 0; let bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m);
      drawFormat(m);
      const p = penalty();
      if (p < bestScore) { best = m; bestScore = p; }
      applyMask(m);
    }
    applyMask(best);
    drawFormat(best);
    return { version: ver, size, modules };
  }

  function matrix(text, { ecl = 'M' } = {}) {
    return encode(text, ecl).modules;
  }

  function svg(text, { ecl = 'M', border = 4, dark = '#0b1220', light = '#ffffff', title = '' } = {}) {
    const { size, modules } = encode(text, ecl);
    const dim = size + border * 2;
    let path = '';
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) if (modules[y][x]) path += `M${x + border} ${y + border}h1v1h-1z`;
    }
    const safeTitle = String(title).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" role="img" aria-label="${safeTitle || 'QR code'}"><rect width="100%" height="100%" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
  }

  const api = Object.freeze({ svg, matrix, encode });
  if (typeof window !== 'undefined') window.QuizQR = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
