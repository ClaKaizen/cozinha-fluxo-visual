import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatClock, type DailyGanttSchedule, type OperatorLunchBreak } from "@/components/gantt/scheduler";

interface Props {
  schedule: DailyGanttSchedule;
  operatorHoursMap: Map<string, number>;
}

function occupancyPill(rate: number) {
  return rate > 100
    ? "bg-danger/15 text-danger border-danger/30"
    : rate >= 80
    ? "bg-warning/15 text-warning border-warning/30"
    : "bg-success/15 text-success border-success/30";
}

export default function OperatorSequence({ schedule, operatorHoursMap }: Props) {
  const [open, setOpen] = useState(false);

  if (schedule.operatorRows.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full rounded-t-lg bg-[#44546A] px-4 py-2 text-sm font-display font-semibold text-white"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Sequência por Operador
      </button>
      {open && (
        <div className="p-4 space-y-3 border border-t-0 rounded-b-lg bg-card">
          {schedule.operatorRows.map((row) => {
            if (row.tasks.length === 0) return null;
            const opHours = operatorHoursMap.get(row.label) ?? 0;
            const opRate = (opHours / 8) * 100;
            const lunch = schedule.operatorLunchBreaks[row.label] as OperatorLunchBreak | undefined;

            // Build timeline entries: tasks + lunch
            type Entry = { time: number; artigo: string; equipment: string; isLunch?: boolean };
            const entries: Entry[] = row.tasks.map((t) => ({
              time: t.start,
              artigo: t.artigo,
              equipment: t.machineLabel || t.equipmentName,
            }));
            if (lunch) {
              entries.push({ time: lunch.start, artigo: "🍽 Almoço", equipment: "—", isLunch: true });
            }
            entries.sort((a, b) => a.time - b.time);

            return (
              <Card key={row.label} className="overflow-hidden shadow-sm">
                <div className="bg-[#44546A] px-3 py-1.5 flex items-center justify-between">
                  <span className="text-xs font-display font-semibold text-white">{row.label}</span>
                  <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 border ${occupancyPill(opRate)} bg-white/10`}>
                    {opRate.toFixed(0)}%
                  </Badge>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-[10px] text-muted-foreground">
                      <th className="text-left font-medium px-2 py-1">Início</th>
                      <th className="text-left font-medium px-2 py-1">Artigo</th>
                      <th className="text-left font-medium px-2 py-1">Equipamento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e, idx) => (
                      <tr key={idx} className={`border-b last:border-b-0 ${e.isLunch ? "bg-amber-50 text-muted-foreground italic" : idx % 2 === 0 ? "bg-muted/30" : ""}`}>
                        <td className="px-2 py-1">{e.isLunch ? `— ${formatClock(e.time)}` : formatClock(e.time)}</td>
                        <td className="px-2 py-1 font-medium">{e.artigo}</td>
                        <td className="px-2 py-1">{e.equipment}</td>
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
