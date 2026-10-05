//! Packet framing: `01 LEN_LO LEN_HI CMD ARGS... SUM_LO SUM_HI 02`.
//!
//! Length counts the command byte, the arguments and the two checksum bytes.
//! The checksum is the 16-bit sum of every byte from the length field through
//! the last argument. Both 16-bit fields are little-endian (low byte first).
//!
//! Sources: public Divoom Timebox/Timebox Evo protocol write-ups (framing,
//! length, checksum). Needs device test on Pixoo hardware.
//!
//! Not implemented: the Timebox Mini write-up says `01`/`02`/`03` bytes inside
//! a packet are escaped as `03 04`/`03 05`/`03 06`. The Evo write-up lists
//! commands with `01` arguments (clock header, light power) unescaped, so we
//! send raw bytes. See docs/protocol.md.

pub const START: u8 = 0x01;
pub const END: u8 = 0x02;

/// Build a complete packet for `cmd` with `args`.
pub fn encode(cmd: u8, args: &[u8]) -> Vec<u8> {
    let len = (args.len() + 3) as u16; // cmd + args + 2 checksum bytes
    let mut buf = Vec::with_capacity(args.len() + 7);
    buf.push(START);
    buf.extend_from_slice(&len.to_le_bytes());
    buf.push(cmd);
    buf.extend_from_slice(args);
    let sum = checksum(&buf[1..]);
    buf.extend_from_slice(&sum.to_le_bytes());
    buf.push(END);
    buf
}

/// 16-bit sum of `bytes`.
pub fn checksum(bytes: &[u8]) -> u16 {
    bytes
        .iter()
        .fold(0u16, |acc, b| acc.wrapping_add(*b as u16))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_args() {
        // len = 3, sum = 0x03 + 0x46 = 0x49
        assert_eq!(
            encode(0x46, &[]),
            [0x01, 0x03, 0x00, 0x46, 0x49, 0x00, 0x02]
        );
    }

    #[test]
    fn matches_protocol_md_brightness_example_with_fields_byte_swapped() {
        // docs/protocol.md shows `01 00 04 32 80 00 B6 02` (big-endian fields).
        // Size (4) and checksum (0xB6) agree with ours; only the byte order of
        // the two 16-bit fields differs.
        assert_eq!(
            encode(0x32, &[0x80]),
            [0x01, 0x04, 0x00, 0x32, 0x80, 0xB6, 0x00, 0x02]
        );
    }

    #[test]
    fn checksum_above_255_uses_both_bytes() {
        let p = encode(0x45, &[0xFF, 0xFF, 0xFF]);
        // len 6 + 0x45 + 3*0xFF = 6 + 69 + 765 = 840 = 0x0348
        assert_eq!(&p[p.len() - 3..], [0x48, 0x03, 0x02]);
    }

    #[test]
    fn arguments_equal_to_marker_bytes_are_sent_raw() {
        let p = encode(0x74, &[0x01]);
        assert_eq!(p, [0x01, 0x04, 0x00, 0x74, 0x01, 0x79, 0x00, 0x02]);
    }
}
