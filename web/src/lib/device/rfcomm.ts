// RFCOMM (serial port profile) link through a bound `/dev/rfcommN` TTY.
//
// Node cannot open AF_BLUETOOTH sockets, so the kernel's RFCOMM TTY does it:
// `rfcomm bind` maps the device to `/dev/rfcommN`, opening the file connects,
// closing it disconnects. No native addons.
//
// The TTY must be raw. With output processing on, the line discipline turns
// 0x0A into 0x0D 0x0A, and image packets start with `00 0A 0A`. Node's
// setRawMode keeps ONLCR set, so `stty raw` is used instead.

import { execFile } from "node:child_process";
import { constants, existsSync } from "node:fs";
import * as fs from "node:fs";
import tty from "node:tty";
import { promisify } from "node:util";
import { NotConnectedError, type Transport } from "./types";

const run = promisify(execFile);
const open = promisify(fs.open);
const write = promisify(fs.write);

const MAC = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/i;

export interface RfcommOptions {
  mac: string;
  /** RFCOMM channel of the device's serial port service. */
  channel?: number;
  /** N in /dev/rfcommN. */
  dev?: number;
  /** Called with any bytes the device sends back. */
  onData?: (bytes: Uint8Array) => void;
  /** Called once if the device hangs up. Not called for close(). */
  onHangup?: (error?: Error) => void;
}

export class RfcommTransport implements Transport {
  private fd: number | null;
  private reader: tty.ReadStream | null;

  private constructor(fd: number, reader: tty.ReadStream | null) {
    this.fd = fd;
    this.reader = reader;
  }

  static async connect({ mac, channel = 1, dev = 0, onData, onHangup }: RfcommOptions): Promise<RfcommTransport> {
    if (!MAC.test(mac)) throw new Error(`invalid MAC address: ${mac}`);
    if (!Number.isInteger(channel) || channel < 1 || channel > 30) throw new Error(`invalid channel: ${channel}`);
    if (!Number.isInteger(dev) || dev < 0 || dev > 255) throw new Error(`invalid rfcomm device: ${dev}`);

    const path = `/dev/rfcomm${dev}`;
    if (!existsSync(path)) {
      await run("rfcomm", ["bind", String(dev), mac, String(channel)]);
    }

    // Opening a bound device establishes the Bluetooth connection.
    const fd = await open(path, constants.O_RDWR | constants.O_NOCTTY);
    try {
      // Set raw mode while we hold the TTY open so the settings stick.
      await run("stty", ["-F", path, "raw", "-echo"]);
    } catch (e) {
      fs.closeSync(fd);
      throw e;
    }

    // Drain replies; the Rust driver never read them (checklist item 9).
    let reader: tty.ReadStream | null = null;
    if (tty.isatty(fd)) {
      reader = new tty.ReadStream(fd);
    }
    const transport = new RfcommTransport(fd, reader);
    if (reader) {
      const hangup = (e?: Error) => {
        if (transport.isOpen) onHangup?.(e);
      };
      reader.on("data", (chunk: Buffer) => onData?.(chunk));
      reader.once("end", () => hangup());
      reader.once("error", (e) => hangup(e));
    }
    return transport;
  }

  get isOpen(): boolean {
    return this.fd !== null;
  }

  async send(bytes: Uint8Array): Promise<void> {
    const fd = this.fd;
    if (fd === null) throw new NotConnectedError();
    let off = 0;
    while (off < bytes.length) {
      try {
        const { bytesWritten } = await write(fd, bytes, off, bytes.length - off);
        off += bytesWritten;
      } catch (e) {
        // The reader puts the fd in non-blocking mode.
        if ((e as NodeJS.ErrnoException).code !== "EAGAIN") throw e;
        await new Promise((r) => setTimeout(r, 5));
      }
    }
  }

  async close(): Promise<void> {
    const fd = this.fd;
    if (fd === null) return;
    this.fd = null;
    this.reader?.destroy();
    this.reader = null;
    try {
      fs.closeSync(fd);
    } catch {
      // Already closed by the reader.
    }
  }
}
