/**
 * Minimal synchronous SHA-1 for verifying the `#h` integrity record in
 * IANA/NIST `leap-seconds.list` files (the format predates SHA-2; this is an
 * integrity check on public data, not a security boundary). ASCII input only.
 */

const rotl = (x: number, n: number): number => ((x << n) | (x >>> (32 - n))) >>> 0

/** Hex SHA-1 digest of an ASCII string. */
export function sha1Hex(ascii: string): string {
  const length = ascii.length
  const withPadding = Math.ceil((length + 9) / 64) * 64
  const bytes = new Uint8Array(withPadding)
  for (let i = 0; i < length; i += 1) bytes[i] = ascii.charCodeAt(i) & 0xff
  bytes[length] = 0x80
  const bitLength = length * 8
  const view = new DataView(bytes.buffer)
  view.setUint32(withPadding - 4, bitLength >>> 0)
  view.setUint32(withPadding - 8, Math.floor(bitLength / 2 ** 32))

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0
  const w = new Uint32Array(80)

  for (let block = 0; block < withPadding; block += 64) {
    for (let t = 0; t < 16; t += 1) w[t] = view.getUint32(block + t * 4)
    for (let t = 16; t < 80; t += 1) {
      w[t] = rotl((w[t - 3] ?? 0) ^ (w[t - 8] ?? 0) ^ (w[t - 14] ?? 0) ^ (w[t - 16] ?? 0), 1)
    }
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    for (let t = 0; t < 80; t += 1) {
      let f: number
      let k: number
      if (t < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (t < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (t < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }
      const temp = (rotl(a, 5) + f + e + k + (w[t] ?? 0)) >>> 0
      e = d
      d = c
      c = rotl(b, 30)
      b = a
      a = temp
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }

  return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, '0')).join('')
}
