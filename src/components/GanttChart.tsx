import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DAY_END,
  DAY_START,
  OPERATOR_HARD_STOP,
  MACHINE_TARGET_STOP,
  formatClock,
  type DailyGanttSchedule,
  type GanttRow,
  type MachineTask,
  type OperatorLunchBreak,
  type OperatorTask,
  type TimelineSegment,
} from "@/components/gantt/scheduler";
import OperatorTaskSequence from "@/components/gantt/OperatorTaskSequence";

const EQUIPMENT_COLOR_TOKENS = [
  "--gantt-equipment-1",
  "--gantt-equipment-2",
  "--gantt-equipment-3",
  "--gantt-equipment-4",
  "--gantt-equipment-5",
  "--gantt-equipment-6",
];

interface GanttChartProps {
  schedule: DailyGanttSchedule;
}

function colorFill(index: number, overflow: boolean) {
  const token = EQUIPMENT_COLOR_TOKENS[index % EQUIPMENT_COLOR_TOKENS.length];
  return overflow ? `hsl(var(${token}) / 0.18)` : `hsl(var(${token}) / 0.36)`;
}

function colorBorder(index: number, overflow: boolean) {
  const token = EQUIPMENT_COLOR_TOKENS[index % EQUIPMENT_COLOR_TOKENS.length];
  return overflow ? `hsl(var(${token}) / 0.55)` : `hsl(var(${token}) / 0.9)`;
}

function GanttSection<TTask extends { id: string; doseLabel: string; artigo: string; start: number; end: number; colorIndex: number; segments: TimelineSegment[]; showSimultaneousBadge?: boolean }>(props: {
  title: string;
  rows: GanttRow<TTask>[];
  axisEnd: number;
  emptyMessage: string;
  legend: { id: string; label: string; colorIndex: number }[];
  rowLunchBreaks?: Record<string, OperatorLunchBreak>;
  hardStopMinutes: number;
  secondaryStopMinutes?: number;
}) {
  const { title, rows, axisEnd, emptyMessage, legend, rowLunchBreaks, hardStopMinutes, secondaryStopMinutes } = props;

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-display">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-4 text-center text-sm text-muted-foreground">{emptyMessage}</p>
        </CardContent>
      </Card>
    );
  }

  const isEmergencyRowFn = (label: string) => label.includes("⚠️");
  const isDedicatedRowFn = (label: string) => label.includes("🔒");

  const labelWidth = 148;
  const rowHeight = 42;
  const pixelsPerMinute = 1.55;
  const totalSpan = axisEnd - DAY_START;
  const chartWidth = Math.max(760, totalSpan * pixelsPerMinute);
  const toPercent = (minutes: number) => ((minutes - DAY_START) / totalSpan) * 100;
  const markers = Array.from({ length: Math.floor((axisEnd - DAY_START) / 30) + 1 }, (_, i) => DAY_START + i * 30);
  const totalHeight = rows.length * rowHeight;

  const hardStopLeft = toPercent(hardStopMinutes);
  const secondaryStopLeft = secondaryStopMinutes ? toPercent(secondaryStopMinutes) : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-display">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div style={{ minWidth: labelWidth + chartWidth + 24 }}>
            <div className="relative mb-2" style={{ marginLeft: labelWidth, height: 18 }}>
              {markers.filter((m) => m % 60 === 0).map((m) => (
                <div key={m} className="absolute text-[10px] font-medium text-muted-foreground" style={{ left: `${toPercent(m)}%`, transform: "translateX(-50%)" }}>
                  {formatClock(m)}
                </div>
              ))}
            </div>
            <div className="relative">
              {/* Primary hard stop line (solid red) */}
              <div className="absolute z-[5]" style={{ left: labelWidth + (hardStopLeft / 100) * chartWidth, top: 0, height: totalHeight, width: 2, backgroundColor: 'hsl(var(--destructive))' }} />
              {/* Secondary stop line (dashed orange) */}
              {secondaryStopLeft !== null && (
                <div className="absolute z-[4]" style={{ left: labelWidth + (secondaryStopLeft / 100) * chartWidth, top: 0, height: totalHeight, width: 0, borderLeft: '2px dashed hsl(38 92% 50%)' }} />
              )}
              {markers.map((m) => (
                <div key={m} className={`absolute z-0 ${m % 60 === 0 ? "border-l border-border/50" : "border-l border-border/25"}`} style={{ left: labelWidth + (toPercent(m) / 100) * chartWidth, top: 0, height: totalHeight }} />
              ))}
              {rows.map((row) => {
                const isEmergency = isEmergencyRowFn(row.label);
                const isDedicated = isDedicatedRowFn(row.label);
                const rowLunch = rowLunchBreaks?.[row.label];
                const lunchLeft = rowLunch ? toPercent(rowLunch.start) : 0;
                const lunchWidth = rowLunch ? ((rowLunch.end - rowLunch.start) / totalSpan) * 100 : 0;

                return (
                <div key={row.label} className={`relative flex items-center ${isEmergency ? "bg-orange-50 dark:bg-orange-950/20" : ""}`} style={{ height: rowHeight }}>
                  <div className="truncate pr-3 text-xs font-semibold text-foreground flex items-center gap-1" style={{ width: labelWidth }}>
                    {isEmergency ? (
                      <>
                        <span>{row.label.replace(" ⚠️", "").replace(" 🔒", "")}</span>
                        <span className="inline-flex items-center rounded border border-orange-400 bg-orange-100 dark:bg-orange-900/40 px-1 py-0 text-[8px] font-bold text-orange-700 dark:text-orange-300 leading-tight">Emerg.</span>
                      </>
                    ) : isDedicated ? (
                      <>
                        <span>{row.label.replace(" 🔒", "")}</span>
                        <span className="text-[10px]" title="Máquina dedicada">🔒</span>
                      </>
                    ) : row.label}
                  </div>
                  <div className={`relative h-full flex-1 border-b ${isEmergency ? "border-dashed border-orange-400/50 bg-orange-50/50 dark:bg-orange-950/10" : "border-border/30 bg-muted/5"}`} style={{ width: chartWidth }}>
                    {rowLunch && (
                      <div
                        className="absolute top-0 z-[1] rounded bg-muted/60"
                        style={{
                          left: `${lunchLeft}%`,
                          width: `${lunchWidth}%`,
                          height: rowHeight,
                        }}
                      />
                    )}
                    {row.tasks.map((task) =>
                      task.segments.map((seg, si) => {
                        const left = toPercent(seg.start);
                        const width = ((seg.end - seg.start) / totalSpan) * 100;
                        const widthPx = (width / 100) * chartWidth;
                        const showLabel = widthPx > 30;
                        const showTime = widthPx > 60;
                        const isOverflow = seg.overflow;
                        const roleLabel = (task as unknown as MachineTask).roleLabel;
                        const labelPrefix = isOverflow ? `⚠ ` : `${(task as unknown as MachineTask).isFirstPhase ? "1→ " : (task as unknown as MachineTask).isSequentialPhase ? "→ " : task.showSimultaneousBadge ? "⊗ " : ""}${(task as unknown as MachineTask).isLunchSafe && rowLunch && seg.end > rowLunch.start && seg.start < rowLunch.end ? "🍽 " : ""}`;
                        return (
                          <div
                            key={`${task.id}-${si}`}
                            className={`absolute top-1 flex h-[34px] flex-col justify-center overflow-hidden rounded-md border px-0.5 text-[10px] font-semibold text-foreground shadow-sm z-10 ${isOverflow ? "border-dashed border-red-500 bg-red-100/60 dark:bg-red-900/30" : ""}`}
                            style={{
                              left: `${left}%`,
                              width: `${width}%`,
                              ...(isOverflow ? {
                                backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(239,68,68,0.15) 4px, rgba(239,68,68,0.15) 8px)',
                              } : {
                                backgroundColor: colorFill(task.colorIndex, false),
                                borderColor: colorBorder(task.colorIndex, false),
                                borderStyle: (task as unknown as MachineTask).isEmergencyMachine ? "dashed" : "solid",
                              }),
                            }}
                            title={`${task.doseLabel}${roleLabel ? ` — ${roleLabel}` : ''} ${formatClock(task.start)}–${formatClock(task.end)}${(task as unknown as MachineTask).isDedicated ? `\nDedicada a: ${roleLabel || task.artigo}` : ''}`}
                          >
                            {showLabel && (
                              <span className="truncate leading-tight">{labelPrefix}{task.artigo}{roleLabel ? ` — ${roleLabel}` : ''}</span>
                            )}
                            {showTime && (
                              <span className="truncate text-[9px] font-medium leading-tight text-foreground/75">
                                {formatClock(seg.start)}–{formatClock(seg.end)}
                              </span>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-xs">
              {legend.map((item) => {
                const token = EQUIPMENT_COLOR_TOKENS[item.colorIndex % EQUIPMENT_COLOR_TOKENS.length];
                return (
                  <div key={item.id} className="flex items-center gap-1.5">
                    <div className="h-3 w-3 rounded-sm border" style={{ backgroundColor: `hsl(var(${token}) / 0.36)`, borderColor: `hsl(var(${token}) / 0.9)` }} />
                    <span>{item.label}</span>
                  </div>
                );
              })}
              {rowLunchBreaks && (
                <div className="flex items-center gap-1.5">
                  <div className="h-3 w-3 rounded-sm bg-muted" />
                  <span className="text-muted-foreground">Almoço (variável 12h–14h)</span>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded-sm border border-dashed border-orange-400 bg-orange-100" />
                <span className="text-muted-foreground">Emergência</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="flex h-3 w-3 items-center justify-center rounded-sm border border-border text-[9px] font-bold text-foreground">⊗</div>
                <span className="text-muted-foreground">Simultâneo</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="flex h-3 w-3 items-center justify-center rounded-sm border border-border text-[9px] font-bold text-foreground">→</div>
                <span className="text-muted-foreground">Sequencial (prep)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded-sm border border-dashed border-red-500 bg-red-100/60" />
                <span className="text-muted-foreground">Overflow após 15:30</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-0.5 w-3 border-t-2 border-dashed" style={{ borderColor: 'hsl(38 92% 50%)' }} />
                <span className="text-muted-foreground">Limite máquinas 15:40</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function GanttChart({ schedule }: GanttChartProps) {
  const legend = useMemo(() => {
    const seen = new Map<string, { id: string; label: string; colorIndex: number }>();
    schedule.machineRows.forEach((row) => {
      row.tasks.forEach((task) => {
        if (!seen.has(task.equipmentId)) {
          seen.set(task.equipmentId, { id: task.equipmentId, label: task.equipmentName, colorIndex: task.colorIndex });
        }
      });
    });
    schedule.tasks.forEach((task) => {
      if (!seen.has(task.equipmentId)) {
        seen.set(task.equipmentId, { id: task.equipmentId, label: task.equipmentName, colorIndex: task.colorIndex });
      }
    });
    return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [schedule.tasks, schedule.machineRows]);

  if (schedule.tasks.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base font-display">Sugestão de Planeamento</CardTitle></CardHeader>
        <CardContent><p className="py-4 text-center text-sm text-muted-foreground">Sem tarefas para gerar planeamento.</p></CardContent>
      </Card>
    );
  }

  const sharedAxisEnd = Math.max(schedule.axisEnd, DAY_END + 30);

  return (
    <div className="space-y-4">
      <GanttSection<MachineTask>
        title="Ocupação das Máquinas"
        rows={schedule.machineRows}
        axisEnd={sharedAxisEnd}
        emptyMessage="Sem máquinas utilizadas neste dia."
        legend={legend}
        rowLunchBreaks={schedule.machineLunchBreaks}
        hardStopMinutes={MACHINE_TARGET_STOP}
        secondaryStopMinutes={OPERATOR_HARD_STOP}
      />
      <GanttSection<OperatorTask>
        title="Ocupação dos Operadores"
        rows={schedule.operatorRows}
        axisEnd={sharedAxisEnd}
        emptyMessage="Sem operadores presentes na Escala para este dia."
        legend={legend}
        rowLunchBreaks={schedule.operatorLunchBreaks}
        hardStopMinutes={OPERATOR_HARD_STOP}
        secondaryStopMinutes={MACHINE_TARGET_STOP}
      />
      <OperatorTaskSequence schedule={schedule} />

      {schedule.staffingWarning && (
        <div className="flex items-center gap-2 rounded-md border border-amber-400/50 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          <span>{schedule.staffingWarning}</span>
        </div>
      )}

      {schedule.unscheduledTasks.length > 0 && (
        <Card className="border-destructive/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-display text-destructive">Tarefas não planeadas por falta de capacidade</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-sm space-y-1">
              {schedule.unscheduledTasks.map((u, i) => (
                <li key={i} className="text-destructive">
                  <span className="font-medium">{u.artigo}</span> — {u.dosesRemaining} dose{u.dosesRemaining > 1 ? "s" : ""} não atribuída{u.dosesRemaining > 1 ? "s" : ""}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
