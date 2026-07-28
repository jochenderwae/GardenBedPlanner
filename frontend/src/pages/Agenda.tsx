import { AgendaView } from "@/pages/agenda/AgendaView";
import { TaskAgendaView } from "@/pages/agenda/TaskAgendaView";

export function Agenda() {
  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-xl font-medium">Agenda</h1>

      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Tasks</h2>
      <TaskAgendaView />

      <h2 className="mt-6 mb-2 text-sm font-semibold text-muted-foreground">Sowing &amp; harvest windows</h2>
      <AgendaView />
    </div>
  );
}
