// The live action context: notifications.

import { getNotifications } from "@/lib/engine/engine";
import type { ActionContext } from "./actions";

export function actionContext(): ActionContext {
  return {
    notifications: getNotifications(),
  };
}
