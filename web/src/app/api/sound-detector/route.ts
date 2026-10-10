import { startSoundDetector } from "@/lib/tools/service";
import { toolRoute } from "../tools-route";

export const POST = toolRoute(() => startSoundDetector());
