import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { DailyGanttSchedule, OperatorTask } from "@/components/gantt/scheduler";
import { AVAILABLE_MACHINE_MINUTES, formatClock } from "@/components/gantt/scheduler";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface OperatorTaskSequenceProps {
  schedule: DailyGanttSchedule;
}

function occupancyPill(rate: number) {
  if (rate > 100) return "bg-danger/15 text-danger border-danger/30";
  if (rate >= 80) return "bg-warning/15 text-warning border-warning/30";
  return "bg-success/15 text-success border-success/30";
}

function formatMinutes(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

// ── Grouping logic ──────────────────────────────────────────────

interface GroupedBlock {
  type: "task";
  artigo: string;
  machines: string[];    // unique machine labels in order
  doses: number;
  start: number;
  end: number;
}

interface LunchBlock {
  type: "lunch";
  start: number;
  end: number;
}

type DisplayBlock = GroupedBlock | LunchBlock;

function buildGroupedBlocks(
  tasks: OperatorTask[],
  lunchStart: number,
  lunchEnd: number,
  showLunch: boolean,
): DisplayBlock[] {
  const sorted = [...tasks].sort((a, b) => a.start - b.start);

  // Group consecutive same-artigo tasks (even if machines differ)
  const groups: GroupedBlock[] = [];
  for (const t of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.artigo === t.artigo) {
      // Extend group
      last.end = Math.max(last.end, t.end);
      last.doses += 1;
      if (!last.machines.includes(t.machineLabel)) {
        last.machines.push(t.machineLabel);
      }
    } else {
      groups.push({
        type: "task",
        artigo: t.artigo,
        machines: [t.machineLabel],
        doses: 1,
        start: t.start,
        end: t.end,
      });
    }
  }

  // Insert lunch row at the right chronological position
  const blocks: DisplayBlock[] = [];
  let lunchInserted = !showLunch;
  for (const g of groups) {
    if (!lunchInserted && lunchStart <= g.start) {
      blocks.push({ type: "lunch", start: lunchStart, end: lunchEnd });
      lunchInserted = true;
    }
    blocks.push(g);
  }
  if (!lunchInserted) {
    blocks.push({ type: "lunch", start: lunchStart, end: lunchEnd });
  }

  return blocks;
}

function formatMachines(machines: string[]): string {
  // Extract common prefix and list unit numbers: "Fritadeira 1", "Fritadeira 2" → "Fritadeira 1 + 2"
  if (machines.length <= 1) return machines[0] ?? "";

  // Try to find common equipment type prefix
  const extractType = (m: string) => m.replace(/\s*\(Emergência\)/, "").replace(/\s+\d+$/, "");
  const extractNum = (m: string) => { const match = m.match(/(\d+)/); return match ? match[1] : ""; };

  const types = new Set(machines.map(extractType));
  if (types.size === 1) {
    const prefix = [...types][0];
    const nums = machines.map(extractNum).filter(Boolean).sort();
    return nums.length > 0 ? `${prefix} ${nums.join(" + ")}` : machines.join(", ");
  }
  return machines.join(", ");
}

export default function OperatorTaskSequence({ schedule }: OperatorTaskSequenceProps) {
  const [open, setOpen] = useState(false);
  const showLunch = schedule.operatorRows.some((row) => row.tasks.length > 0);

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button type="button" className="flex w-full items-center justify-between px-6 py-4 text-left">
            <div>
              <CardTitle className="text-base font-display">Sequência de Tarefas por Operador</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Tabela agrupada com máquinas, doses, horários e almoço.</p>
            </div>
            <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4 pt-0">
            {schedule.operatorRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem operadores presentes neste dia.</p>
            ) : (
              schedule.operatorRows.map((row) => {
                const occupiedMinutes = row.tasks.reduce(
                  (sum, task) => sum + task.segments.reduce((s, seg) => s + (seg.end - seg.start), 0),
                  0,
                );
                const idleMinutes = Math.max(0, AVAILABLE_MACHINE_MINUTES - occupiedMinutes);
                const occupancy = AVAILABLE_MACHINE_MINUTES > 0 ? (occupiedMinutes / AVAILABLE_MACHINE_MINUTES) * 100 : 0;

                const opLunch = schedule.operatorLunchBreaks[row.label];
                const opLunchStart = opLunch?.start ?? schedule.lunchStart;
                const opLunchEnd = opLunch?.end ?? schedule.lunchEnd;
                const blocks = buildGroupedBlocks(row.tasks, opLunchStart, opLunchEnd, showLunch);

                let taskCounter = 0;

                return (
                  <div key={row.label} className="overflow-hidden rounded-lg border bg-card">
                    <CardHeader className="flex flex-row items-center justify-between gap-3 bg-secondary py-4 text-secondary-foreground">
                      <div>
                        <CardTitle className="text-base font-display text-secondary-foreground">{row.label}</CardTitle>
                        <p className="mt-1 text-xs text-secondary-foreground/80">Taxa ocupação: {occupancy.toFixed(0)}%</p>
                      </div>
                      <Badge variant="outline" className={`border px-2 py-1 text-[10px] ${occupancyPill(occupancy)}`}>
                        {occupancy.toFixed(0)}%
                      </Badge>
                    </CardHeader>
                    <CardContent className="p-0">
                      {row.tasks.length === 0 ? (
                        <p className="px-4 py-3 text-sm text-muted-foreground">Sem tarefas atribuídas.</p>
                      ) : (
                        <>
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                                <th className="w-8 px-2 py-1.5 text-center font-semibold">#</th>
                                <th className="px-2 py-1.5 text-left font-semibold">Tarefa</th>
                                <th className="px-2 py-1.5 text-left font-semibold hidden sm:table-cell">Máquina(s)</th>
                                <th className="w-14 px-2 py-1.5 text-center font-semibold">Doses</th>
                                <th className="px-2 py-1.5 text-right font-semibold hidden sm:table-cell">Início</th>
                                <th className="px-2 py-1.5 text-right font-semibold hidden sm:table-cell">Fim</th>
                                <th className="px-2 py-1.5 text-right font-semibold sm:hidden">Horário</th>
                              </tr>
                            </thead>
                            <tbody>
                              {blocks.map((block, idx) => {
                                if (block.type === "lunch") {
                                  return (
                                    <tr key={`lunch-${idx}`} className="bg-muted/30 border-b">
                                      <td className="px-2 py-1.5 text-center text-muted-foreground">🍽️</td>
                                      <td className="px-2 py-1.5 text-muted-foreground italic" colSpan={2}>
                                        Almoço
                                      </td>
                                      <td className="hidden sm:table-cell px-2 py-1.5 text-center text-muted-foreground">—</td>
                                      <td className="px-2 py-1.5 text-right font-mono text-xs text-muted-foreground hidden sm:table-cell">
                                        {formatClock(block.start)}
                                      </td>
                                      <td className="px-2 py-1.5 text-right font-mono text-xs text-muted-foreground hidden sm:table-cell">
                                        {formatClock(block.end)}
                                      </td>
                                      <td className="px-2 py-1.5 text-right font-mono text-xs text-muted-foreground sm:hidden">
                                        {formatClock(block.start)}–{formatClock(block.end)}
                                      </td>
                                    </tr>
                                  );
                                }

                                taskCounter += 1;
                                const isEven = taskCounter % 2 === 0;
                                return (
                                  <tr key={`task-${idx}`} className={`border-b last:border-b-0 ${isEven ? "bg-muted/20" : ""}`}>
                                    <td className="px-2 py-1.5 text-center text-xs text-muted-foreground">{taskCounter}</td>
                                    <td className="px-2 py-1.5 font-semibold text-foreground">{block.artigo}</td>
                                    <td className="px-2 py-1.5 text-muted-foreground hidden sm:table-cell">{formatMachines(block.machines)}</td>
                                    <td className="px-2 py-1.5 text-center font-medium">{block.doses}</td>
                                    <td className="px-2 py-1.5 text-right font-mono text-xs hidden sm:table-cell">{formatClock(block.start)}</td>
                                    <td className="px-2 py-1.5 text-right font-mono text-xs hidden sm:table-cell">{formatClock(block.end)}</td>
                                    <td className="px-2 py-1.5 text-right font-mono text-xs sm:hidden">
                                      {formatClock(block.start)}–{formatClock(block.end)}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
                            <span>Ocupado: {formatMinutes(occupiedMinutes)}</span>
                            <span>•</span>
                            <span>Ocioso: {formatMinutes(idleMinutes)}</span>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </div>
                );
              })
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
