/** Byte link to a device, so command encoding can be tested without Bluetooth. */
export interface Transport {
  /** Write all of `bytes`. */
  send(bytes: Uint8Array): Promise<void>;
  /** Close the link. Idempotent. */
  close(): Promise<void>;
  readonly isOpen: boolean;
}

export class NotConnectedError extends Error {
  constructor() {
    super("not connected");
  }
}
