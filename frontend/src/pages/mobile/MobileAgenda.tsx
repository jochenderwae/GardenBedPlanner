import { AgendaView } from "@/pages/agenda/AgendaView";

export function MobileAgenda() {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-sm font-semibold">Agenda</h1>
      <AgendaView />
    </div>
  );
}
