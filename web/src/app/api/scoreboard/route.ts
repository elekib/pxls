import { setScoreboard } from "@/lib/tools/service";
import { toolRoute } from "../tools-route";

export const POST = toolRoute((b) => setScoreboard(b.red_score, b.blue_score));
