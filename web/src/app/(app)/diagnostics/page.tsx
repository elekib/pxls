import { DeviceTester } from "@/components/DeviceTester";
import { requireUser } from "@/lib/auth/session";
import { getEngine } from "@/lib/engine/engine";

export const dynamic = "force-dynamic";

// Interim: the device test controls. Phase 6 ports the original Diagnostics page.
export default async function Page() {
  await requireUser("admin");
  return (
    <div className="max-w-[900px]">
      <h2 className="text-[30px] font-bold text-cyan-400 mb-6">Diagnostics</h2>
      {getEngine().config.debug ? (
        <DeviceTester />
      ) : (
        <div className="bg-gray-800 rounded-lg p-6 mb-6 border-l-4 border-gray-600">
          <p className="text-gray-400">Set PXLS_ENABLE_DEBUG=1 and restart to use the diagnostics tools.</p>
        </div>
      )}
    </div>
  );
}
