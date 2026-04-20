import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, Pencil, RotateCcw, Save, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DAY_END,
  DAY_START,
  OPERATOR_START,
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
import { useOperatorOverrides } from "@/components/gantt/useOperatorOverrides";

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

// ── Operator Swap Dropdown ──────────────────────────────

function OperatorSwapButton({
  operatorLabel,
  allOperators,
  onSwap,
}: {
  operatorLabel: string;
  allOperators: string[];
  onSwap: (target: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const others = allOperators.filter((o) => o !== operatorLabel);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          title="Trocar todas as tarefas com outro operador"
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-2" align="start">
        <p className="text-xs font-semibold mb-1.5">Trocar com:</p>
        <div className="space-y-0.5">
          {others.map((op) => (
            <button
              key={op}
              type="button"
              className="w-full text-left rounded px-2 py-1 text-xs hover:bg-accent transition-colors"
              onClick={() => {
                onSwap(op);
                setOpen(false);
              }}
            >
              {op}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Task Block Popover (individual move) ────────────────

function TaskBlockPopover({
  task,
  operatorLabel,
  availableTargets,
  onMove,
  children,
}: {
  task: OperatorTask;
  operatorLabel: string;
  availableTargets: string[];
  onMove: (toOp: string) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-56 p-3" align="start" side="top">
        <div className="space-y-2">
          <div className="text-xs">
            <p className="font-semibold">{task.artigo}</p>
            <p className="text-muted-foreground">
              {task.machineLabel} · {formatClock(task.start)}–{formatClock(task.end)}
            </p>
          </div>
          {availableTargets.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">Sem operadores disponíveis neste horário.</p>
          ) : (
            <>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="Mover para…" />
                </SelectTrigger>
                <SelectContent>
                  {availableTargets.map((op) => (
                    <SelectItem key={op} value={op} className="text-xs">
                      {op}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                className="w-full h-7 text-xs"
                disabled={!target}
                onClick={() => {
                  if (target) {
                    onMove(target);
                    setOpen(false);
                    setTarget("");
                  }
                }}
              >
                Confirmar
              </Button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Machine Gantt Section (unchanged) ───────────────────

function MachineGanttSection(props: {
  title: string;
  rows: GanttRow<MachineTask>[];
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
        <CardHeader className="pb-2"><CardTitle className="text-base font-display">{title}</CardTitle></CardHeader>
        <CardContent><p className="py-4 text-center text-sm text-muted-foreground">{emptyMessage}</p></CardContent>
      </Card>
    );
  }

  const isEmergencyRowFn = (label: string) => label.includes("⚠️");
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
      <CardHeader className="pb-2"><CardTitle className="text-base font-display">{title}</CardTitle></CardHeader>
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
              <div className="absolute z-[5]" style={{ left: labelWidth + (hardStopLeft / 100) * chartWidth, top: 0, height: totalHeight, width: 2, backgroundColor: 'hsl(var(--destructive))' }} />
              {secondaryStopLeft !== null && (
                <div className="absolute z-[4]" style={{ left: labelWidth + (secondaryStopLeft / 100) * chartWidth, top: 0, height: totalHeight, width: 0, borderLeft: '2px dashed hsl(38 92% 50%)' }} />
              )}
              {markers.map((m) => (
                <div key={m} className={`absolute z-0 ${m % 60 === 0 ? "border-l border-border/50" : "border-l border-border/25"}`} style={{ left: labelWidth + (toPercent(m) / 100) * chartWidth, top: 0, height: totalHeight }} />
              ))}
              {rows.map((row) => {
                const isEmergency = isEmergencyRowFn(row.label);
                const rowLunch = rowLunchBreaks?.[row.label];
                const lunchLeft = rowLunch ? toPercent(rowLunch.start) : 0;
                const lunchWidth = rowLunch ? ((rowLunch.end - rowLunch.start) / totalSpan) * 100 : 0;
                return (
                  <div key={row.label} className={`relative flex items-center ${isEmergency ? "bg-orange-50 dark:bg-orange-950/20" : ""}`} style={{ height: rowHeight }}>
                    <div className="truncate pr-3 text-xs font-semibold text-foreground flex items-center gap-1" style={{ width: labelWidth }}>
                      {isEmergency ? (
                        <>
                          <span>{row.label.replace(" ⚠️", "")}</span>
                          <span className="inline-flex items-center rounded border border-orange-400 bg-orange-100 dark:bg-orange-900/40 px-1 py-0 text-[8px] font-bold text-orange-700 dark:text-orange-300 leading-tight">Emerg.</span>
                        </>
                      ) : row.label}
                    </div>
                    <div className={`relative h-full flex-1 border-b ${isEmergency ? "border-dashed border-orange-400/50 bg-orange-50/50 dark:bg-orange-950/10" : "border-border/30 bg-muted/5"}`} style={{ width: chartWidth }}>
                      {rowLunch && (
                        <div className="absolute top-0 z-[1] rounded bg-muted/60" style={{ left: `${lunchLeft}%`, width: `${lunchWidth}%`, height: rowHeight }} />
                      )}
                      {row.tasks.map((task) =>
                        task.segments.map((seg, si) => {
                          const left = toPercent(seg.start);
                          const width = ((seg.end - seg.start) / totalSpan) * 100;
                          const widthPx = (width / 100) * chartWidth;
                          const showLabel = widthPx > 30;
                          const showTime = widthPx > 60;
                          const isOverflow = seg.overflow;
                          const roleLabel = task.roleLabel;
                          const labelPrefix = isOverflow ? `⚠ ` : `${task.isFirstPhase ? "1→ " : task.isSequentialPhase ? "→ " : task.showSimultaneousBadge ? "⊗ " : ""}${task.isLunchSafe && rowLunch && seg.end > rowLunch.start && seg.start < rowLunch.end ? "🍽 " : ""}`;
                          return (
                            <div
                              key={`${task.id}-${si}`}
                              className={`absolute top-1 flex h-[34px] flex-col justify-center overflow-hidden rounded-md border px-0.5 text-[10px] font-semibold text-foreground shadow-sm z-10 ${isOverflow ? "border-dashed border-red-500 bg-red-100/60 dark:bg-red-900/30" : ""}`}
                              style={{
                                left: `${left}%`,
                                width: `${width}%`,
                                ...(isOverflow ? { backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(239,68,68,0.15) 4px, rgba(239,68,68,0.15) 8px)' } : {
                                  backgroundColor: colorFill(task.colorIndex, false),
                                  borderColor: colorBorder(task.colorIndex, false),
                                  borderStyle: task.isEmergencyMachine ? "dashed" : "solid",
                                }),
                              }}
                              title={`${task.doseLabel}${roleLabel ? ` — ${roleLabel}` : ''} ${formatClock(task.start)}–${formatClock(task.end)}`}
                            >
                              {showLabel && <span className="truncate leading-tight">{labelPrefix}{task.artigo}{roleLabel ? ` — ${roleLabel}` : ''}</span>}
                              {showTime && <span className="truncate text-[9px] font-medium leading-tight text-foreground/75">{formatClock(seg.start)}–{formatClock(seg.end)}</span>}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <GanttLegend legend={legend} rowLunchBreaks={rowLunchBreaks} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Operator Gantt Section (with edit mode + native HTML5 DnD) ─

const isDev = typeof import.meta !== "undefined" && (import.meta as any).env?.DEV;

interface DragState {
  taskId: string;
  fromOp: string;
  /** ID of the task most recently flashed after a drop (for visual confirmation) */
}

function OperatorGanttSection({
  rows,
  axisEnd,
  legend,
  rowLunchBreaks,
  editMode,
  conflictTaskIds,
  overriddenOperators,
  allOperatorLabels,
  onSwapOperators,
  onMoveTask,
  onReorderTasks,
  getAvailableTargets,
}: {
  rows: GanttRow<OperatorTask>[];
  axisEnd: number;
  legend: { id: string; label: string; colorIndex: number }[];
  rowLunchBreaks?: Record<string, OperatorLunchBreak>;
  editMode: boolean;
  conflictTaskIds: Set<string>;
  overriddenOperators: Set<string>;
  allOperatorLabels: string[];
  onSwapOperators: (opA: string, opB: string) => void;
  onMoveTask: (taskId: string, fromOp: string, toOp: string) => void;
  onReorderTasks: (taskId: string, fromOp: string, toOp: string, insertIndex: number) => void;
  getAvailableTargets: (taskId: string, fromOp: string) => string[];
}) {
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [hoverOp, setHoverOp] = useState<string | null>(null);
  const [insertIdx, setInsertIdx] = useState<number>(-1);
  const [flashId, setFlashId] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">Sem operadores presentes na Escala para este dia.</p>
    );
  }

  const labelWidth = 148;
  const rowHeight = 42;
  const pixelsPerMinute = 1.55;
  const totalSpan = axisEnd - OPERATOR_START;
  const chartWidth = Math.max(760, totalSpan * pixelsPerMinute);
  const toPercent = (minutes: number) => ((minutes - OPERATOR_START) / totalSpan) * 100;
  const firstMarker = Math.ceil(OPERATOR_START / 30) * 30;
  const markers = [OPERATOR_START, ...Array.from({ length: Math.floor((axisEnd - firstMarker) / 30) + 1 }, (_, i) => firstMarker + i * 30)];
  const totalHeight = rows.length * rowHeight;
  const hardStopLeft = toPercent(OPERATOR_HARD_STOP);
  const secondaryStopLeft = toPercent(MACHINE_TARGET_STOP);

  const handleDragStart = (e: React.DragEvent, taskId: string, fromOp: string) => {
    if (!editMode) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", taskId);
    setDragging({ taskId, fromOp });
    if (isDev) console.log("[DnD] dragstart", { taskId, fromOp });
  };

  const handleDragEnd = () => {
    setDragging(null);
    setHoverOp(null);
    setInsertIdx(-1);
  };

  const computeInsertIndex = (e: React.DragEvent, rowEl: HTMLElement, opLabel: string): number => {
    const row = rows.find((r) => r.label === opLabel);
    if (!row) return 0;
    const rect = rowEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    // Sort tasks by start (visual order)
    const sorted = [...row.tasks].sort((a, b) => a.start - b.start);
    for (let i = 0; i < sorted.length; i++) {
      const t = sorted[i];
      const leftPct = ((t.start - OPERATOR_START) / totalSpan);
      const leftPx = leftPct * chartWidth;
      const widthPx = ((t.end - t.start) / totalSpan) * chartWidth;
      const midPx = leftPx + widthPx / 2;
      if (x < midPx) return i;
    }
    return sorted.length;
  };

  const handleRowDragOver = (e: React.DragEvent, opLabel: string, rowEl: HTMLElement | null) => {
    if (!editMode || !dragging || !rowEl) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const idx = computeInsertIndex(e, rowEl, opLabel);
    if (hoverOp !== opLabel) setHoverOp(opLabel);
    if (insertIdx !== idx) setInsertIdx(idx);
  };

  const handleRowDrop = (e: React.DragEvent, opLabel: string, rowEl: HTMLElement | null) => {
    if (!editMode || !dragging || !rowEl) return;
    e.preventDefault();
    const idx = computeInsertIndex(e, rowEl, opLabel);
    const taskId = dragging.taskId;
    const fromOp = dragging.fromOp;
    if (isDev) console.log("[DnD] drop", { taskId, fromOp, toOp: opLabel, idx });
    onReorderTasks(taskId, fromOp, opLabel, idx);
    setFlashId(taskId);
    window.setTimeout(() => setFlashId((cur) => (cur === taskId ? null : cur)), 400);
    handleDragEnd();
  };

  // Compute X position of insertion line for a given row
  const insertionLineLeft = (opLabel: string): number | null => {
    if (hoverOp !== opLabel || insertIdx < 0) return null;
    const row = rows.find((r) => r.label === opLabel);
    if (!row) return null;
    const sorted = [...row.tasks].sort((a, b) => a.start - b.start);
    if (sorted.length === 0) return 0;
    if (insertIdx >= sorted.length) {
      const last = sorted[sorted.length - 1];
      return ((last.end - OPERATOR_START) / totalSpan) * chartWidth;
    }
    const t = sorted[insertIdx];
    return ((t.start - OPERATOR_START) / totalSpan) * chartWidth;
  };

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: labelWidth + chartWidth + 24 }}>
        <div className="relative mb-2" style={{ marginLeft: labelWidth, height: 18 }}>
          {markers.filter((m) => m === OPERATOR_START || m % 60 === 0).map((m) => (
            <div key={m} className="absolute text-[10px] font-medium text-muted-foreground" style={{ left: `${toPercent(m)}%`, transform: "translateX(-50%)" }}>
              {formatClock(m)}
            </div>
          ))}
        </div>
        <div className="relative">
          <div className="absolute z-[5]" style={{ left: labelWidth + (hardStopLeft / 100) * chartWidth, top: 0, height: totalHeight, width: 2, backgroundColor: 'hsl(var(--destructive))' }} />
          <div className="absolute z-[4]" style={{ left: labelWidth + (secondaryStopLeft / 100) * chartWidth, top: 0, height: totalHeight, width: 0, borderLeft: '2px dashed hsl(38 92% 50%)' }} />
          {markers.map((m) => (
            <div key={m} className={`absolute z-0 ${m % 60 === 0 ? "border-l border-border/50" : "border-l border-border/25"}`} style={{ left: labelWidth + (toPercent(m) / 100) * chartWidth, top: 0, height: totalHeight }} />
          ))}
          {rows.map((row) => {
            const rowLunch = rowLunchBreaks?.[row.label];
            const lunchLeft = rowLunch ? toPercent(rowLunch.start) : 0;
            const lunchWidth = rowLunch ? ((rowLunch.end - rowLunch.start) / totalSpan) * 100 : 0;
            const isOverridden = overriddenOperators.has(row.label);
            const isDropTarget = editMode && dragging !== null;
            const isHovered = hoverOp === row.label;
            const lineLeft = insertionLineLeft(row.label);

            return (
              <div key={row.label} className="relative flex items-center" style={{ height: rowHeight }}>
                <div className="truncate pr-2 text-xs font-semibold text-foreground flex items-center gap-1" style={{ width: labelWidth }}>
                  {editMode && (
                    <OperatorSwapButton
                      operatorLabel={row.label}
                      allOperators={allOperatorLabels}
                      onSwap={(target) => onSwapOperators(row.label, target)}
                    />
                  )}
                  <span className="truncate">{row.label}</span>
                  {isOverridden && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-[10px] cursor-help">✏️</span>
                      </TooltipTrigger>
                      <TooltipContent className="text-xs">Atribuição editada manualmente — clique em Repor para reverter</TooltipContent>
                    </Tooltip>
                  )}
                </div>
                <div
                  className={`relative h-full flex-1 border-b bg-muted/5 transition-colors ${
                    isDropTarget
                      ? isHovered
                        ? "border-2 border-dashed border-[#FFD966] bg-[#FFD966]/10"
                        : "border-2 border-dashed border-border/60"
                      : "border-border/30"
                  }`}
                  style={{ width: chartWidth }}
                  onDragOver={(e) => handleRowDragOver(e, row.label, e.currentTarget)}
                  onDragLeave={(e) => {
                    // only clear if leaving the row (not entering a child)
                    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                    if (hoverOp === row.label) {
                      setHoverOp(null);
                      setInsertIdx(-1);
                    }
                  }}
                  onDrop={(e) => handleRowDrop(e, row.label, e.currentTarget)}
                >
                  {rowLunch && (
                    <div className="absolute top-0 z-[1] rounded bg-muted/60" style={{ left: `${lunchLeft}%`, width: `${lunchWidth}%`, height: rowHeight }} />
                  )}
                  {/* Insertion indicator */}
                  {lineLeft !== null && (
                    <div
                      className="absolute top-0 z-[20] pointer-events-none"
                      style={{ left: lineLeft, width: 2, height: rowHeight, backgroundColor: "#FFD966", boxShadow: "0 0 4px #FFD966" }}
                    />
                  )}
                  {row.tasks.length === 0 && !isDropTarget && (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground italic">
                      Sem tarefas atribuídas
                    </div>
                  )}
                  {row.tasks.map((task) =>
                    task.segments.map((seg, si) => {
                      const left = toPercent(seg.start);
                      const width = ((seg.end - seg.start) / totalSpan) * 100;
                      const widthPx = (width / 100) * chartWidth;
                      const showLabel = widthPx > 30;
                      const showTime = widthPx > 60;
                      const isOverflow = seg.overflow;
                      const isConflict = conflictTaskIds.has(task.id);
                      const isBeingDragged = dragging?.taskId === task.id;
                      const isFlashing = flashId === task.id;
                      const exceedsHardStop = task.end > OPERATOR_HARD_STOP;
                      const labelPrefix = isOverflow ? "⚠ " : task.showSimultaneousBadge ? "⊗ " : "";

                      const blockEl = (
                        <div
                          key={`${task.id}-${si}`}
                          draggable={editMode && si === 0}
                          onDragStart={(e) => si === 0 && handleDragStart(e, task.id, row.label)}
                          onDragEnd={handleDragEnd}
                          className={`absolute top-1 flex h-[34px] flex-col justify-center overflow-hidden rounded-md border px-0.5 text-[10px] font-semibold text-foreground shadow-sm z-10 transition-opacity ${
                            isConflict
                              ? "border-2 border-destructive ring-1 ring-destructive/30"
                              : exceedsHardStop && editMode
                              ? "border-2 border-dashed border-red-500"
                              : isOverflow
                              ? "border-dashed border-red-500 bg-red-100/60 dark:bg-red-900/30"
                              : ""
                          } ${editMode ? (isBeingDragged ? "cursor-grabbing opacity-50" : "cursor-grab hover:ring-2 hover:ring-primary/40") : ""} ${
                            isFlashing ? "ring-4 ring-[#FFD966] animate-pulse" : ""
                          }`}
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                            ...(isOverflow
                              ? { backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(239,68,68,0.15) 4px, rgba(239,68,68,0.15) 8px)' }
                              : {
                                  backgroundColor: colorFill(task.colorIndex, false),
                                  borderColor: isConflict || (exceedsHardStop && editMode) ? undefined : colorBorder(task.colorIndex, false),
                                }),
                          }}
                          title={
                            exceedsHardStop && editMode
                              ? "Esta tarefa ultrapassa o limite operacional das 15:30"
                              : isConflict
                              ? `⚠ Conflito de horário — ${task.artigo} ${formatClock(task.start)}–${formatClock(task.end)}`
                              : `${task.doseLabel} ${formatClock(task.start)}–${formatClock(task.end)}`
                          }
                        >
                          {showLabel && <span className="truncate leading-tight">{labelPrefix}{task.artigo}</span>}
                          {showTime && <span className="truncate text-[9px] font-medium leading-tight text-foreground/75">{formatClock(seg.start)}–{formatClock(seg.end)}</span>}
                        </div>
                      );

                      // Dashed placeholder where the dragged block originally sits
                      if (isBeingDragged && si === 0) {
                        return (
                          <>
                            {blockEl}
                            <div
                              key={`placeholder-${task.id}`}
                              className="absolute top-1 h-[34px] rounded-md border-2 border-dashed border-muted-foreground/40 z-[5] pointer-events-none"
                              style={{ left: `${left}%`, width: `${width}%` }}
                            />
                          </>
                        );
                      }

                      return blockEl;
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <GanttLegend legend={legend} rowLunchBreaks={rowLunchBreaks} />
      </div>
    </div>
  );
}

// ── Shared Legend ────────────────────────────────────────

function GanttLegend({
  legend,
  rowLunchBreaks,
}: {
  legend: { id: string; label: string; colorIndex: number }[];
  rowLunchBreaks?: Record<string, OperatorLunchBreak>;
}) {
  return (
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
          <span className="text-muted-foreground">Almoço (60 min entre 12h–14h)</span>
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
  );
}

// ── Main Component ──────────────────────────────────────

export default function GanttChart({ schedule }: GanttChartProps) {
  const overrides = useOperatorOverrides(schedule);

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

  const allOperatorLabels = useMemo(
    () => schedule.operatorRows.map((r) => r.label),
    [schedule.operatorRows],
  );

  if (schedule.tasks.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base font-display">Sugestão de Planeamento</CardTitle></CardHeader>
        <CardContent><p className="py-4 text-center text-sm text-muted-foreground">Sem tarefas para gerar planeamento.</p></CardContent>
      </Card>
    );
  }

  const sharedAxisEnd = Math.max(schedule.axisEnd, DAY_END + 30);

  // Build effective schedule for OperatorTaskSequence
  const effectiveSchedule: DailyGanttSchedule = {
    ...schedule,
    operatorRows: overrides.effectiveRows,
  };

  return (
    <div className="space-y-4">
      <MachineGanttSection
        title="Ocupação das Máquinas"
        rows={schedule.machineRows}
        axisEnd={sharedAxisEnd}
        emptyMessage="Sem máquinas utilizadas neste dia."
        legend={legend}
        rowLunchBreaks={schedule.machineLunchBreaks}
        hardStopMinutes={MACHINE_TARGET_STOP}
        secondaryStopMinutes={OPERATOR_HARD_STOP}
      />

      {/* Operator Gantt with edit controls */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-display">Ocupação dos Operadores</CardTitle>
            <div className="flex items-center gap-1.5">
              {overrides.overriddenOperators.size > 0 && !overrides.editMode && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-muted-foreground" onClick={overrides.resetOverrides}>
                      <RotateCcw className="h-3 w-3" />
                      Repor
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="text-xs">Repor atribuições automáticas do scheduler</TooltipContent>
                </Tooltip>
              )}
              {overrides.editMode ? (
                <>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={overrides.cancelEdit}>
                    <X className="h-3 w-3" />
                    Cancelar
                  </Button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button
                          size="sm"
                          className="h-7 px-2 text-xs gap-1"
                          disabled={overrides.hasConflicts}
                          onClick={overrides.saveOverrides}
                        >
                          <Save className="h-3 w-3" />
                          Guardar
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {overrides.hasConflicts && (
                      <TooltipContent className="text-xs text-destructive">Existem conflitos de horário — resolva antes de guardar</TooltipContent>
                    )}
                  </Tooltip>
                </>
              ) : (
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs gap-1" onClick={overrides.enterEditMode}>
                  <Pencil className="h-3 w-3" />
                  Editar Atribuições
                </Button>
              )}
            </div>
          </div>
          {overrides.editMode && (
            <p className="text-xs text-muted-foreground mt-1">
              Clique ⇄ junto ao nome para trocar operadores. Clique num bloco para mover uma tarefa individual.
            </p>
          )}
        </CardHeader>
        <CardContent>
          <OperatorGanttSection
            rows={overrides.effectiveRows}
            axisEnd={sharedAxisEnd}
            legend={legend}
            rowLunchBreaks={schedule.operatorLunchBreaks}
            editMode={overrides.editMode}
            conflictTaskIds={overrides.conflictTaskIds}
            overriddenOperators={overrides.overriddenOperators}
            allOperatorLabels={allOperatorLabels}
            onSwapOperators={overrides.swapOperators}
            onMoveTask={overrides.moveTask}
            onReorderTasks={overrides.reorderTasks}
            getAvailableTargets={overrides.getAvailableTargets}
          />
        </CardContent>
      </Card>

      <OperatorTaskSequence schedule={effectiveSchedule} />

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
