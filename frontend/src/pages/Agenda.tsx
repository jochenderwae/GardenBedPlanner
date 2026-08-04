import { CalendarView } from "@/pages/agenda/CalendarView";

export function Agenda() {
  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-4 text-xl font-medium">Agenda</h1>
      <CalendarView />
    </div>
  );
}
