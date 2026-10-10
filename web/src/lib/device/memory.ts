import { NotConnectedError, type Transport } from "./types";

/** Records every packet instead of sending it. For tests and dry runs. */
export class MemoryTransport implements Transport {
  readonly packets: Uint8Array[] = [];
  closes = 0;
  private open = true;

  get isOpen(): boolean {
    return this.open;
  }

  async send(bytes: Uint8Array): Promise<void> {
    if (!this.open) throw new NotConnectedError();
    this.packets.push(Uint8Array.from(bytes));
  }

  async close(): Promise<void> {
    if (this.open) {
      this.open = false;
      this.closes++;
    }
  }
}
