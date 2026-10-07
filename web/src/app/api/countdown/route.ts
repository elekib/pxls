import { startCountdown } from "@/lib/tools/service";
import { toolRoute } from "../tools-route";

export const POST = toolRoute((b) => startCountdown(b.minutes, b.seconds));
