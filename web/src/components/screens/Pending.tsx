/** Placeholder for a tab that a later phase of the rebuild fills in. */
export function Pending({ title, phase }: { title: string; phase: number }) {
  return (
    <div className="max-w-[900px]">
      <h2 className="text-[30px] font-bold text-cyan-400 mb-6">{title}</h2>
      <div className="bg-gray-800 rounded-lg p-6 mb-6 border-l-4 border-gray-600">
        <p className="text-gray-400">This page is coming in phase {phase} of the Next.js rebuild.</p>
      </div>
    </div>
  );
}
