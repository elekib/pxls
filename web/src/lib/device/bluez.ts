// Host-side BlueZ commands for recovering a wedged link.
//
// A connect blocks in open() on /dev/rfcommN until the RFCOMM link comes up.
// If the controller never completes the ACL link, open() never returns.
// `rfcomm release` unbinds the TTY, which wakes the blocked open(). If the
// controller itself is stuck, only resetting the adapter clears it.

import { execFile } from "node:child_process";

export type Exec = (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

/** These talk to the kernel and can hang themselves; never wait on them forever. */
const EXEC_TIMEOUT_MS = 10_000;

export const exec: Exec = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: EXEC_TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });

/** Unbind /dev/rfcomm<dev>; a connect blocked in open() on it returns with an error. */
export async function releaseRfcomm(dev: number, run: Exec = exec): Promise<void> {
  await run("rfcomm", ["release", String(dev)]);
}

/**
 * Power-cycle adapter hci<index> and return how. Prefers the management API
 * (`btmgmt power off/on`) and falls back to the legacy HCI reset ioctl.
 */
export async function resetAdapter(index: number, run: Exec = exec): Promise<string> {
  const mgmt = (state: "off" | "on") => run("btmgmt", ["--index", String(index), "power", state]);
  try {
    await mgmt("off");
  } catch {
    // btmgmt missing or the management socket refused: reset over HCI.
    await run("hciconfig", [`hci${index}`, "reset"]);
    return `hciconfig hci${index} reset`;
  }
  try {
    await mgmt("on");
    return `btmgmt --index ${index} power off/on`;
  } catch {
    // Never leave the adapter powered off.
    await run("hciconfig", [`hci${index}`, "up"]);
    return `btmgmt --index ${index} power off, hciconfig hci${index} up`;
  }
}
