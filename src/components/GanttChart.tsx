import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DAY_END,
  DAY_START,
  formatClock,
  LUNCH_END,
  LUNCH_START,
  type DailyGanttSchedule,
  type GanttRow,
  type MachineTask,
  type OperatorTask,
  type TimelineSegment,
} from "@/components/gantt/scheduler";

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

function GanttSection<TTask extends { id: string; doseLabel: string; artigo: string; start: number; end: number; colorIndex: number; segments: TimelineSegment[] }>(props: {
  title: string;
  rows: GanttRow<TTask>[];
  axisEnd: number;
  emptyMessage: string;
  legend: { id: string; label: string; colorIndex: number }[];
}) {
  const { title, rows, axisEnd, emptyMessage, legend } = props;

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

  const labelWidth = 148;
  const rowHeight = 42;
  const pixelsPerMinute = 1.55;
  const totalSpan = axisEnd - DAY_START;
  const chartWidth = Math.max(760, totalSpan * pixelsPerMinute);
  const toPercent = (minutes: number) => ((minutes - DAY_START) / totalSpan) * 100;
  const markers = Array.from({ length: Math.floor((axisEnd - DAY_START) / 30) + 1 }, (_, i) => DAY_START + i * 30);
  const lunchLeft = toPercent(LUNCH_START);
  const lunchWidth = ((LUNCH_END - LUNCH_START) / totalSpan) * 100;
  const totalHeight = rows.length * rowHeight;

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
              <div className="absolute z-0 rounded bg-muted/60" style={{ left: labelWidth + (lunchLeft / 100) * chartWidth, width: (lunchWidth / 100) * chartWidth, top: 0, height: totalHeight }} />
              {markers.map((m) => (
                <div key={m} className={`absolute z-0 ${m % 60 === 0 ? "border-l border-border/50" : "border-l border-border/25"}`} style={{ left: labelWidth + (toPercent(m) / 100) * chartWidth, top: 0, height: totalHeight }} />
              ))}
              {rows.map((row) => {
                const isEmergencyRow = row.label.includes("⚠️");
                return (
                <div key={row.label} className={`relative flex items-center ${isEmergencyRow ? "bg-warning/8" : ""}`} style={{ height: rowHeight }}>
                  <div className="truncate pr-3 text-xs font-semibold text-foreground flex items-center gap-1" style={{ width: labelWidth }}>
                    {row.label}
                  </div>
                  <div className={`relative h-full flex-1 border-b border-border/30 ${isEmergencyRow ? "bg-warning/5" : "bg-muted/5"}`} style={{ width: chartWidth }}>
                    {row.tasks.map((task) =>
                      task.segments.map((seg, si) => {
                        const left = toPercent(seg.start);
                        const width = ((seg.end - seg.start) / totalSpan) * 100;
                        const widthPx = (width / 100) * chartWidth;
                        const showName = widthPx > 50;
                        const showTime = widthPx > 100;
                        return (
                          <div
                            key={`${task.id}-${si}`}
                            className="absolute top-1 flex h-[34px] flex-col justify-center overflow-hidden rounded-md border px-1.5 text-[10px] font-semibold text-foreground shadow-sm"
                            style={{
                              left: `${left}%`,
                              width: `${width}%`,
                              backgroundColor: colorFill(task.colorIndex, seg.overflow),
                              borderColor: colorBorder(task.colorIndex, seg.overflow),
                              borderStyle: seg.overflow ? "dashed" : "solid",
                            }}
                            title={`${task.doseLabel} ${formatClock(task.start)}–${formatClock(task.end)}`}
                          >
                            {showName && <span className="truncate leading-tight">{task.artigo}</span>}
                            {showTime && (
                              <span className="truncate text-[9px] font-medium leading-tight text-foreground/75">
                                {formatClock(task.start)}–{formatClock(task.end)}
                              </span>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              ))}
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
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded-sm bg-muted" />
                <span className="text-muted-foreground">Almoço 13:00–14:00</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded-sm border border-border border-dashed bg-muted/30" />
                <span className="text-muted-foreground">Overflow após 15:30</span>
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
    schedule.tasks.forEach((task) => {
      if (!seen.has(task.equipmentId)) {
        seen.set(task.equipmentId, { id: task.equipmentId, label: task.equipmentName, colorIndex: task.colorIndex });
      }
    });
    return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [schedule.tasks]);

  if (schedule.tasks.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base font-display">Sugestão de Planeamento</CardTitle></CardHeader>
        <CardContent><p className="py-4 text-center text-sm text-muted-foreground">Sem tarefas para gerar planeamento.</p></CardContent>
      </Card>
    );
  }

  const sharedAxisEnd = Math.max(schedule.axisEnd, DAY_END);

  return (
    <div className="space-y-4">
      <GanttSection<MachineTask>
        title="Ocupação das Máquinas"
        rows={schedule.machineRows}
        axisEnd={sharedAxisEnd}
        emptyMessage="Sem máquinas utilizadas neste dia."
        legend={legend}
      />
      <GanttSection<OperatorTask>
        title="Ocupação dos Operadores"
        rows={schedule.operatorRows}
        axisEnd={sharedAxisEnd}
        emptyMessage="Sem operadores presentes na Escala para este dia."
        legend={legend}
      />
    </div>
  );
}
