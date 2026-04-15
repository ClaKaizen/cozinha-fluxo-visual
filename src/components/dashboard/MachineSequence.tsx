import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatClock, type DailyGanttSchedule } from "@/components/gantt/scheduler";

interface Props {
  schedule: DailyGanttSchedule;
}

export default function MachineSequence({ schedule }: Props) {
  const [open, setOpen] = useState(false);

  if (schedule.machineRows.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full rounded-t-lg bg-[#44546A] px-4 py-2 text-sm font-display font-semibold text-white"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Sequência por Máquina
      </button>
      {open && (
        <div className="p-4 space-y-3 border border-t-0 rounded-b-lg bg-card">
          {schedule.machineRows.map((row) => {
            if (row.tasks.length === 0) return null;
            const sorted = [...row.tasks].sort((a, b) => a.start - b.start);
            return (
              <Card key={row.label} className="overflow-hidden shadow-sm">
                <div className="bg-[#44546A] px-3 py-1.5">
                  <span className="text-xs font-display font-semibold text-white">{row.label}</span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-[10px] text-muted-foreground">
                      <th className="text-left font-medium px-2 py-1">Início</th>
                      <th className="text-left font-medium px-2 py-1">Artigo</th>
                      <th className="text-left font-medium px-2 py-1">Fim</th>
                      <th className="text-right font-medium px-2 py-1">Duração</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((t, idx) => (
                      <tr key={t.id} className={`border-b last:border-b-0 ${idx % 2 === 0 ? "bg-muted/30" : ""}`}>
                        <td className="px-2 py-1">{formatClock(t.start)}</td>
                        <td className="px-2 py-1 font-medium">{t.artigo}</td>
                        <td className="px-2 py-1">{formatClock(t.end)}</td>
                        <td className="px-2 py-1 text-right">{Math.round(t.end - t.start)} min</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
