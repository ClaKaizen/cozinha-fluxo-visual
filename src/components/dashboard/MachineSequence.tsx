import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatClock, type DailyGanttSchedule } from "@/components/gantt/scheduler";

interface Props {
  schedule: DailyGanttSchedule;
}

export default function MachineSequence({ schedule }: Props) {
  const [open, setOpen] = useState(false);

  // Build per-machine-instance list from machineRows
  // Each machineRow.label is the specific machine name (e.g. "Basculante 1")
  const machineCards = schedule.machineRows
    .filter((row) => row.tasks.length > 0)
    .map((row) => {
      const sorted = [...row.tasks].sort((a, b) => a.start - b.start);
      // Merge consecutive tasks of the same artigo on this machine
      const merged: { artigo: string; start: number; end: number }[] = [];
      for (const t of sorted) {
        const last = merged[merged.length - 1];
        if (last && last.artigo === t.artigo && t.start - last.end <= 1) {
          last.end = Math.max(last.end, t.end);
        } else {
          merged.push({ artigo: t.artigo, start: t.start, end: t.end });
        }
      }
      return { label: row.label, tasks: merged };
    });

  if (machineCards.length === 0) return null;

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
          {machineCards.map((mc) => (
            <Card key={mc.label} className="overflow-hidden shadow-sm">
              <div className="bg-[#44546A] px-3 py-1.5">
                <span className="text-xs font-display font-semibold text-white">{mc.label}</span>
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
                  {mc.tasks.map((t, idx) => (
                    <tr key={`${mc.label}-${idx}`} className={`border-b last:border-b-0 ${idx % 2 === 0 ? "bg-muted/30" : ""}`}>
                      <td className="px-2 py-1">{formatClock(t.start)}</td>
                      <td className="px-2 py-1 font-medium">{t.artigo}</td>
                      <td className="px-2 py-1">{formatClock(t.end)}</td>
                      <td className="px-2 py-1 text-right">{Math.round(t.end - t.start)} min</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
