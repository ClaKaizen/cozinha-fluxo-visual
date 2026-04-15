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

interface GroupedRow {
  type: "task";
  machines: string; // "Fritadeira 1+2"
  artigo: string;
  qd: number;
  start: number;
  end: number;
}

interface LunchRow {
  type: "lunch";
  start: number;
  end: number;
}

type DisplayRow = GroupedRow | LunchRow;

function extractEquipmentType(machineLabel: string): string {
  // "Fritadeira 1" → "Fritadeira", "Basculante 2 (Emergência)" → "Basculante"
  return machineLabel.replace(/\s*\(Emergência\)/, "").replace(/\s+\d+$/, "");
}

function extractUnitNumber(machineLabel: string): string {
  const m = machineLabel.match(/(\d+)/);
  return m ? m[1] : "";
}

function buildGroupedRows(
  tasks: Array<{ artigo: string; machineLabel: string; equipmentName: string; start: number; end: number }>,
  lunch: OperatorLunchBreak | undefined,
): DisplayRow[] {
  const sorted = [...tasks].sort((a, b) => a.start - b.start);

  // Group consecutive same-artigo, same-equipment-type with gap <= 5min
  const groups: GroupedRow[] = [];
  for (const t of sorted) {
    const eqType = extractEquipmentType(t.machineLabel);
    const unit = extractUnitNumber(t.machineLabel);
    const last = groups[groups.length - 1];
    if (
      last &&
      last.artigo === t.artigo &&
      extractEquipmentType(last.machines) === eqType &&
      t.start - last.end <= 5
    ) {
      // Extend group
      last.end = Math.max(last.end, t.end);
      last.qd += 1;
      // Add unit number if not already present
      const existingUnits = new Set(last.machines.replace(eqType + " ", "").split("+"));
      if (unit && !existingUnits.has(unit)) {
        const allUnits = [...existingUnits, unit].sort();
        last.machines = `${eqType} ${allUnits.join("+")}`;
      }
    } else {
      groups.push({
        type: "task",
        machines: t.machineLabel,
        artigo: t.artigo,
        qd: 1,
        start: t.start,
        end: t.end,
      });
    }
  }

  // Insert lunch
  const rows: DisplayRow[] = [];
  let lunchInserted = !lunch;
  for (const g of groups) {
    if (!lunchInserted && lunch && lunch.start <= g.start) {
      rows.push({ type: "lunch", start: lunch.start, end: lunch.end });
      lunchInserted = true;
    }
    rows.push(g);
  }
  if (!lunchInserted && lunch) {
    rows.push({ type: "lunch", start: lunch.start, end: lunch.end });
  }

  return rows;
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

            const displayRows = buildGroupedRows(
              row.tasks.map((t) => ({
                artigo: t.artigo,
                machineLabel: t.machineLabel || t.equipmentName,
                equipmentName: t.equipmentName,
                start: t.start,
                end: t.end,
              })),
              lunch,
            );

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
                      <th className="text-left font-medium px-2 py-1">Máquina</th>
                      <th className="text-left font-medium px-2 py-1">Artigo</th>
                      <th className="text-right font-medium px-2 py-1">QD</th>
                      <th className="text-left font-medium px-2 py-1">Início</th>
                      <th className="text-left font-medium px-2 py-1">Fim</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((r, idx) =>
                      r.type === "lunch" ? (
                        <tr key={`lunch-${idx}`} className="bg-amber-50 border-b">
                          <td colSpan={5} className="px-2 py-1 text-center text-muted-foreground italic text-xs">
                            — 🍽 Almoço — {formatClock(r.start)}–{formatClock(r.end)}
                          </td>
                        </tr>
                      ) : (
                        <tr key={`${row.label}-${idx}`} className={`border-b last:border-b-0 ${idx % 2 === 0 ? "bg-muted/30" : ""}`}>
                          <td className="px-2 py-1">{r.machines}</td>
                          <td className="px-2 py-1 font-medium">{r.artigo}</td>
                          <td className="px-2 py-1 text-right">{r.qd}</td>
                          <td className="px-2 py-1">{formatClock(r.start)}</td>
                          <td className="px-2 py-1">{formatClock(r.end)}</td>
                        </tr>
                      ),
                    )}
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
