# Pixoo Bluetooth Protocol

How pxls talks to legacy Divoom Pixoo (16x16) displays. The implementation lives in `web/src/lib/protocol/` (packet encoders) and `web/src/lib/device/` (device API and Bluetooth link), and is written from public protocol write-ups and observed device behavior. It does not use or derive from any third-party driver source.

**Status legend.** *Public* = layout documented by a public write-up. *Observed* = layout taken from observed device or app behavior. *Inferred* = our mapping, no document states it. Everything marked *needs device test* has not been confirmed against real hardware; the checklist at the end says how to confirm each one.

## Sources

- **[Timebox Evo protocol write-up](https://github.com/RomRider/node-divoom-timebox-evo/blob/master/PROTOCOL.md)** (public, no license stated; only facts were used): framing, little-endian fields, checksum, brightness `0x74`, channels `0x45 00/01/03/04/06`, image upload layout.
- **[Timebox (Mini) protocol write-up](https://github.com/MarcG046/timebox/blob/master/doc/protocol.md)** (public, no license stated): framing, escaping rule (not used, see below), static image command number.
- **Observed behavior** of Divoom apps and devices: tool command `0x72` layouts, scoreboard tool `0x50`.

Both public write-ups cover the Timebox family. Pixoo behaviour is assumed to match where noted.

## Transport

Bluetooth RFCOMM (serial port profile). pxls binds the display to `/dev/rfcommN` with BlueZ's `rfcomm` tool and writes whole packets to that TTY in raw mode. Replies from the device are read and discarded. Disconnecting closes the TTY and releases the binding.

## Packet framing

```
01 | LEN_LO LEN_HI | CMD | ARGS... | SUM_LO SUM_HI | 02
```

| Field | Size | Meaning |
|-------|------|---------|
| Start | 1 | `0x01` |
| Length | 2 | little-endian: `1 (cmd) + args + 2 (checksum)` |
| Command | 1 | command byte |
| Args | N | command specific |
| Checksum | 2 | little-endian 16-bit sum of every byte from Length through the last arg |
| End | 1 | `0x02` |

Example, brightness 50%: `01 04 00 74 32 AA 00 02` (`0x04 + 0x74 + 0x32 = 0xAA`).

**Escaping:** the Timebox Mini write-up says `01`, `02`, `03` bytes inside a packet are escaped (`03 04`, `03 05`, `03 06`). The Evo write-up documents commands with `01` arguments (clock header, light power) without escaping, so pxls sends raw bytes. *Needs device test* (step 6).

## Commands

| Command | Code | Args | Source | Status |
|---------|------|------|--------|--------|
| Brightness | `0x74` | `percent: u8` (0-100) | Public | needs device test on Pixoo |
| Clock mode | `0x45` | `00 01 TT show_time show_weather show_temp show_date R G B` | Public | needs device test |
| Light mode | `0x45` | `01 R G B brightness effect power 00 00 00` | Public | needs device test |
| Visualization ("music") | `0x45` | `04 TT` | Public layout, Inferred mapping | needs device test |
| User mode | `0x45` | `05 00` | Inferred | needs device test |
| Scoreboard mode | `0x45` | `06 00 red_lo red_hi blue_lo blue_hi` | Public | needs device test |
| Image | `0x44` | see below | Public (Timebox family) | needs device test |
| Stopwatch tool | `0x72` | `00 action` (1 start, 0 stop) | Observed | needs device test |
| Noise meter tool | `0x72` | `02 action` | Observed | needs device test |
| Countdown tool | `0x72` | `03 action minutes seconds` | Observed | needs device test |
| Scoreboard tool | `0x50` | `on red_lo red_hi blue_lo blue_hi` | Observed | **not used by the app**: on a real Pixoo it showed a logo instead of a scoreboard; encoder kept, unverified |

Notes:

- **Clock `TT`:** 0 digital, 1 rainbow, 2 box, 3 analog 1, 4 inverted, 5 analog 2. Byte 3 of the clock args (`01`) is "fixed" in the write-up; it might be a 24h flag, which is untested (pxls has no 12/24h setting). The app's `show_divoom` flag has no known byte and is ignored.
- **Light effect:** 0 normal, 1 rainbow ("love" in the write-up), 2 plants, 3 fly ("no mosquito"), 4 sleep.
- **Music `TT`** (observed on a real Pixoo, not documented): 0 bottom bars, 1 face 3, 2 center bars, 3 face 1, 4 matrix, 5 frog face, 6 side bars, 7 face 2, 8 falling blocks, 9 dancing boy, 10 fireworks, 11 dancing girl.
- **Stopwatch pause/reset** are not documented and not implemented.
- **Score range:** 0-999 (the driver clamps larger values), confirmed by the public write-up and a device observation that 99 was too low.
- **Scoreboard:** mode `0x45 06` and tool `0x50` are different things. The Tools page and `/api/scoreboard` use mode `0x45 06`, the same command Device config sends, on the open link; each +/- sends one packet (the UI debounces and sends the latest value). `0x50` flashed a logo on a real Pixoo, so the app no longer sends it. Whether `0x45 06` updates live from rapid clicks needs a device test.
- **Tools and the link:** countdown (`0x72 03`), sound detector (`0x72 02`) and the scoreboard are sent on the already-open link, which stays open. When a tool ends (timer expiry or Stop) the app re-applies the device config on that same link, with no reconnect; Stop first sends the tool's own stop (`0x72 03 00 00 00` / `0x72 02 00`). Whether the display returns this way, and whether the device keeps a tool running with the link open, needs a device test. Fallback: `PXLS_TOOL_CLOSE_LINK=1` closes the link after a tool is sent and the render loop reconnects when it ends, retrying every 2 s.
- **Tool timing:** the app keeps one record of the running tool (kind and end time). The countdown ends after its set time and the sound detector after 5 minutes (a UI assumption, the noise meter has no end of its own); the scoreboard has no timer.

### Image upload (`0x44`)

Args: `00 0A 0A 04 | AA LEN_LO LEN_HI 00 00 00 NN PALETTE PIXELS`

- `NN` palette size (`00` means 256), `PALETTE` is `NN` RGB triples in order of first use.
- `PIXELS`: one palette index per pixel, row by row from the top left, `ceil(log2(NN))` bits each (minimum 1), filled least-significant bit first, last byte zero padded.
- `LEN` is assumed to be the whole frame length from `AA` through the last pixel byte (the write-up says only "image data length"). *Assumption, needs device test.*
- Sent as one packet, no chunking. Non-16x16 images are resized (nearest neighbour).

## Connection lifecycle

- The engine binds and opens `/dev/rfcommN`, and retries every 2 s after an error. Disconnecting closes the TTY and is idempotent; sends after a disconnect fail with "not connected".
- Whether the display keeps running a tool after the link closes is *unconfirmed* (device test step 3).
- The render loop sends no heartbeat in native mode. Native modes are re-applied about every 10 s (User GIFs every 5 minutes, since re-sending restarts its slideshow).

## Testing

```bash
cd web
npm test                  # golden-byte tests with an in-memory transport
```

On a real device, use the admin Diagnostics page (`PXLS_ENABLE_DEBUG=1`): raw commands, value sweeps and quick tests.

Quick raw test (documented brightness, 50%):

```bash
echo -ne '\x01\x04\x00\x74\x32\xAA\x00\x02' > /dev/rfcomm0
```

## Diagnostics page (admin only)

Set `PXLS_ENABLE_DEBUG=1` in `.env` and restart pxls; admins then get a **Diagnostics** tab. It sends a raw command (framing and checksum added) through the connected device, can show solid red first so ignored commands are obvious, steps through a value range, and keeps a log with notes you can copy. After each send the display loop is paused for two minutes. The endpoint (`POST /api/debug/send`) is admin only and returns 403 while the flag is off. **Restore display** (`POST /api/debug/release`, same rules) ends the pause and re-applies your configured mode on the open link, for when a probe leaves the display stuck (for example on the red screen). Turn the flag off again when you are done.

## Device test checklist

**Results, 2026-10-07** (a Pixoo on RFCOMM channel 1, model and firmware not recorded):
- Brightness `0x74` little-endian framing works at 50, 1 and 100 (items 1 and 6): framing is right and unescaped `0x01` arguments are accepted.
- Image `0x44` works for solid colors and a two-color image; the top-left pixel lands top-left (item 7, static images only). `LEN` as frame length from `AA` is correct.
- The device replies to packets (item 9); pxls reads and discards the replies.

Run on the server with a real Pixoo and note the model and firmware. Tick each item or record what the display did.

1. **Connect and brightness.** Connect from the UI, set brightness 10, 50, 100. Display should change. If nothing happens, send `74 32` from the Diagnostics page. If the display ignores it, framing is wrong and everything else is moot.
2. **Native modes.** Apply clock (each of 6 designs, with weather/temp/date on and off), light (color, brightness, 5 effects, on/off), music (12 modes), user, score. Record which work. Watch for the clock, blank, clock flicker.
3. **Tools on the open link.** Start a 1 minute countdown, sound detector and the scoreboard (Tools page) and check each runs with the status still "Connected". Check the display returns by itself when the countdown ends and on Stop, and how many seconds that takes. If a tool does not run or the display does not return, try `PXLS_TOOL_CLOSE_LINK=1`.
4. **Escaping.** Set brightness to 1 (argument `0x01`). If the display ignores it or misbehaves, the device needs escaped packets.
5. **Images.** Push each page type (text, image, scroll). Check colors, orientation and no garbage. If the image is shifted or the device ignores it, `LEN` semantics are the first suspect.
6. **Clock byte 3.** Compare 12h vs 24h display with the app set to each; see if that byte is a 24h flag (a prerequisite for adding a 12/24h setting).
7. **Responses.** Replies are read and discarded. Leave the server running for a few hours with the render loop active and confirm no stalls (unread device replies could otherwise fill the buffer).
8. **Reconnect.** Power cycle the display; confirm the loop reconnects.

## Troubleshooting

- **No response:** check the MAC (`bluetoothctl devices`), pairing, and that the display is awake.
- **Connection errors** containing "transport endpoint", "not connected" or "107" make the render loop reconnect.
- Set `PXLS_LOG_PACKETS=1` to log every packet sent to the device in hex.

## Contributing

If you confirm or correct a command, update the table with the command byte, arguments, device model and firmware.
