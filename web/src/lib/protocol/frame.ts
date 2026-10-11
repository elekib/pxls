// Packet framing: `01 LEN_LO LEN_HI CMD ARGS... SUM_LO SUM_HI 02`.
//
// Length counts the command byte, the arguments and the two checksum bytes.
// The checksum is the 16-bit sum of every byte from the length field through
// the last argument. Both 16-bit fields are little-endian. Arguments are sent
// raw, without escaping; see docs/protocol.md.

export const START = 0x01;
export const END = 0x02;

/** Build a complete packet for `cmd` with `args`. */
export function encode(cmd: number, args: ArrayLike<number> = []): Uint8Array {
  const len = (args.length + 3) & 0xffff; // cmd + args + 2 checksum bytes
  const buf = new Uint8Array(args.length + 7);
  buf[0] = START;
  buf[1] = len & 0xff;
  buf[2] = len >> 8;
  buf[3] = cmd;
  buf.set(args, 4);
  const sum = checksum(buf.subarray(1, 4 + args.length));
  buf[4 + args.length] = sum & 0xff;
  buf[5 + args.length] = sum >> 8;
  buf[6 + args.length] = END;
  return buf;
}

/** 16-bit wrapping sum of `bytes`. */
export function checksum(bytes: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) sum = (sum + (bytes[i] as number)) & 0xffff;
  return sum;
}
