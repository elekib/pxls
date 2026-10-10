import { playBuzzer } from "@/lib/tools/service";
import { toolRoute } from "../tools-route";

export const POST = toolRoute((b) => playBuzzer(b.total_time));
