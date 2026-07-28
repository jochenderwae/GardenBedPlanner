import { AgendaView } from "@/pages/agenda/AgendaView";
import { TaskAgendaView } from "@/pages/agenda/TaskAgendaView";

export function MobileAgenda() {
  return (
    <div className="flex flex-col gap-3">
      {/* text-base matches CardTitle's own size (16px) - AgendaView's own
       * per-month Card/CardTitle headings render at the same size, so the
       * page title needs to be at least that prominent, not smaller (see
       * the "mobile page-heading pattern" backlog item). Desktop's
       * equivalent heading (Agenda.tsx) is larger (text-xl) - that's an
       * intentional, separate mobile-shell title scale, mirroring how the
       * bottom nav's labels are also a step down (text-xs) from desktop,
       * not unaddressed drift. */}
      <h1 className="text-base font-semibold">Agenda</h1>

      <h2 className="text-sm font-semibold text-muted-foreground">Tasks</h2>
      <TaskAgendaView />

      <h2 className="mt-2 text-sm font-semibold text-muted-foreground">Sowing &amp; harvest windows</h2>
      <AgendaView />
    </div>
  );
}
