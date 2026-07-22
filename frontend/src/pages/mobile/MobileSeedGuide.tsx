import { SeedGuideView } from "@/pages/seed-guide/SeedGuideView";

export function MobileSeedGuide() {
  return (
    <div className="flex flex-col gap-3">
      {/* text-base matches CardTitle's own size (16px) - SeedGuideView's own
       * per-plant Card/CardTitle headings render at the same size, so the
       * page title needs to be at least that prominent, not smaller (see
       * the "mobile page-heading pattern" backlog item). Desktop's
       * equivalent heading (SeedGuide.tsx) is larger (text-xl) - that's an
       * intentional, separate mobile-shell title scale, mirroring how the
       * bottom nav's labels are also a step down (text-xs) from desktop,
       * not unaddressed drift. */}
      <h1 className="text-base font-semibold">Seed Guide</h1>
      <SeedGuideView />
    </div>
  );
}
