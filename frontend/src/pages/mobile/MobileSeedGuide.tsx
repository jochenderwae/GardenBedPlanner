import { SeedGuideView } from "@/pages/seed-guide/SeedGuideView";

export function MobileSeedGuide() {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-sm font-semibold">Seed Guide</h1>
      <SeedGuideView />
    </div>
  );
}
