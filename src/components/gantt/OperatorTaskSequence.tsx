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

function buildEntries(tasks: OperatorTask[], lunchStart: number, lunchEnd: number, showLunch: boolean) {
  const sortedTasks = [...tasks].sort((a, b) => a.start - b.start || a.machineLabel.localeCompare(b.machineLabel));
  const entries: Array<{ type: "task"; task: OperatorTask; index: number } | { type: "lunch" }> = [];
  let lunchInserted = !showLunch;
  let counter = 1;

  sortedTasks.forEach((task) => {
    if (!lunchInserted && lunchStart <= task.start) {
      entries.push({ type: "lunch" });
      lunchInserted = true;
    }
    entries.push({ type: "task", task, index: counter });
    counter += 1;
  });

  if (!lunchInserted) {
    entries.push({ type: "lunch" });
  }

  return { entries, lunchLabel: `${formatClock(lunchStart)}–${formatClock(lunchEnd)}` };
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
              <p className="mt-1 text-sm text-muted-foreground">Lista cronológica com almoço variável, tempos ocupados e folgas.</p>
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
                  (sum, task) => sum + task.segments.reduce((segmentSum, segment) => segmentSum + (segment.end - segment.start), 0),
                  0,
                );
                const idleMinutes = Math.max(0, AVAILABLE_MACHINE_MINUTES - occupiedMinutes);
                const occupancy = AVAILABLE_MACHINE_MINUTES > 0 ? (occupiedMinutes / AVAILABLE_MACHINE_MINUTES) * 100 : 0;

                // Use per-operator lunch break
                const opLunch = schedule.operatorLunchBreaks[row.label];
                const opLunchStart = opLunch?.start ?? schedule.lunchStart;
                const opLunchEnd = opLunch?.end ?? schedule.lunchEnd;
                const { entries, lunchLabel } = buildEntries(row.tasks, opLunchStart, opLunchEnd, showLunch);

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
                    <CardContent className="space-y-3 py-4">
                      {row.tasks.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Sem tarefas atribuídas.</p>
                      ) : (
                        <ol className="space-y-2 text-sm">
                          {entries.map((entry, entryIndex) =>
                            entry.type === "lunch" ? (
                              <li key={`${row.label}-lunch-${entryIndex}`} className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-muted-foreground">
                                — {lunchLabel} 🍽 Almoço
                              </li>
                            ) : (
                              <li key={entry.task.id} className="rounded-md border px-3 py-2">
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                  <span className="font-semibold">
                                    {entry.index}. {formatClock(entry.task.start)}–{formatClock(entry.task.end)}
                                  </span>
                                  <span className="font-medium text-foreground">
                                    {entry.task.showSimultaneousBadge ? "⊗ " : ""}
                                    {entry.task.artigo}
                                  </span>
                                  <span className="text-muted-foreground">{entry.task.machineLabel}</span>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">T.Homem: {entry.task.operatorDuration} min total</p>
                              </li>
                            ),
                          )}
                        </ol>
                      )}

                      <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
                        <span>Total ocupado: {formatMinutes(occupiedMinutes)}</span>
                        <span>•</span>
                        <span>Total ocioso: {formatMinutes(idleMinutes)}</span>
                      </div>
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
