// The live action context: notifications and the device buzzer.

import { getEngine, getNotifications } from "@/lib/engine/engine";
import type { ActionContext } from "./actions";

export function actionContext(): ActionContext {
  return {
    notifications: getNotifications(),
    // Sent on the open link; a second Bluetooth connection is refused.
    buzzer: (ms) => getEngine().run((p) => p.playBuzzer(ms)),
  };
}
