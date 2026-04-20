import { useState, useMemo, useCallback } from "react";
import type {
  DailyGanttSchedule,
  GanttRow,
  OperatorLunchBreak,
  OperatorTask,
  TimelineSegment,
} from "./scheduler";
import { OPERATOR_HARD_STOP, formatClock } from "./scheduler";
import { useStore } from "@/store/useStore";

const isDev = import.meta.env?.DEV ?? false;

// Janela de almoço obrigatória (sem produção) — 12:00–13:00
const MANDATORY_LUNCH_START = 12 * 60; // 720
const MANDATORY_LUNCH_END = 13 * 60;   // 780

// ── Segment rebuild (mirrors scheduler.buildOperatorSegments) ─
// Respeita simultaneamente a janela obrigatória 12:00–13:00 e o
// almoço específico do operador (caso esteja deslocado).
function rebuildOperatorSegments(
  start: number,
  duration: number,
  lunchStart: number,
  lunchEnd: number,
): { start: number; end: number; segments: TimelineSegment[] } {
  // Combinar a janela obrigatória com o almoço específico do operador
  // para garantir que NUNCA é desenhado nada entre 12:00 e 13:00.
  const breaks: Array<{ start: number; end: number }> = [
    { start: MANDATORY_LUNCH_START, end: MANDATORY_LUNCH_END },
  ];
  if (Number.isFinite(lunchStart) && Number.isFinite(lunchEnd) && lunchEnd > lunchStart) {
    breaks.push({ start: lunchStart, end: lunchEnd });
  }
  // Ordenar por início
  breaks.sort((a, b) => a.start - b.start);

  const isInsideBreak = (t: number): { start: number; end: number } | null => {
    for (const b of breaks) {
      if (t >= b.start && t < b.end) return b;
    }
    return null;
  };
  const nextBreakStartAfter = (t: number): number => {
    let next = Number.POSITIVE_INFINITY;
    for (const b of breaks) {
      if (b.start > t && b.start < next) next = b.start;
    }
    return next;
  };

  const segments: TimelineSegment[] = [];
  let cursor = start;
  let remaining = duration;

  if (duration <= 0) {
    return { start, end: start, segments: [{ start, end: start, overflow: false }] };
  }

  while (remaining > 0) {
    // Se cair dentro de uma pausa, saltar para o fim dessa pausa
    const inside = isInsideBreak(cursor);
    if (inside) {
      cursor = inside.end;
    }
    let nextBoundary = cursor + remaining;
    const upcomingBreak = nextBreakStartAfter(cursor);
    if (nextBoundary > upcomingBreak) {
      nextBoundary = upcomingBreak;
    }
    const isOverflow = cursor >= OPERATOR_HARD_STOP;
    const segEnd = isOverflow ? cursor + remaining : nextBoundary;
    segments.push({ start: cursor, end: segEnd, overflow: isOverflow });
    if (isOverflow) break;
    remaining -= nextBoundary - cursor;
    cursor = nextBoundary;
  }

  const end = segments.length > 0 ? segments[segments.length - 1].end : start;
  return { start, end, segments };
}

// ── Types ────────────────────────────────────────────────

export interface ManualOverride {
  /** Maps operatorLabel → array of task IDs assigned to them */
  [operatorLabel: string]: string[];
}

export interface OperatorConflict {
  operatorLabel: string;
  taskIds: [string, string]; // two overlapping task IDs
}

// ── Conflict detection ──────────────────────────────────

function detectConflicts(rows: GanttRow<OperatorTask>[]): OperatorConflict[] {
  const conflicts: OperatorConflict[] = [];
  for (const row of rows) {
    const sorted = [...row.tasks].sort((a, b) => a.start - b.start);
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].end > sorted[i + 1].start) {
        conflicts.push({
          operatorLabel: row.label,
          taskIds: [sorted[i].id, sorted[i + 1].id],
        });
      }
    }
  }
  return conflicts;
}

// ── Apply overrides to schedule ─────────────────────────

export function applyOverrides(
  originalRows: GanttRow<OperatorTask>[],
  overrides: ManualOverride,
  operatorLunchBreaks: Record<string, OperatorLunchBreak> = {},
): GanttRow<OperatorTask>[] {
  // Anchor = start of first task in original row (before override)
  const anchorByRow = new Map<string, number>();
  for (const row of originalRows) {
    if (row.tasks.length > 0) {
      anchorByRow.set(row.label, row.tasks[0].start);
    }
  }

  // Build a flat pool of all tasks
  const allTasks = new Map<string, OperatorTask>();
  for (const row of originalRows) {
    for (const task of row.tasks) {
      allTasks.set(task.id, task);
    }
  }

  // Build assignment map: taskId → operatorLabel from overrides
  const taskToOperator = new Map<string, string>();
  // Also preserve order from override arrays
  const orderInTarget = new Map<string, number>();
  for (const [opLabel, taskIds] of Object.entries(overrides)) {
    taskIds.forEach((tid, idx) => {
      taskToOperator.set(tid, opLabel);
      orderInTarget.set(tid, idx);
    });
  }

  // For tasks NOT in any override, keep original assignment
  for (const row of originalRows) {
    row.tasks.forEach((task, idx) => {
      if (!taskToOperator.has(task.id)) {
        taskToOperator.set(task.id, row.label);
        orderInTarget.set(task.id, idx + 1_000_000); // append after explicit overrides
      }
    });
  }

  const hasOverrides = Object.keys(overrides).length > 0;

  // Rebuild rows
  return originalRows.map((row) => {
    const assignedTasks = Array.from(allTasks.values()).filter(
      (t) => taskToOperator.get(t.id) === row.label,
    );

    if (!hasOverrides) {
      // No overrides → return original ordering & timing untouched
      return {
        ...row,
        tasks: assignedTasks
          .map((t) => ({ ...t, operatorName: row.label }))
          .sort((a, b) => a.start - b.start),
      };
    }

    // Sort by override-defined order
    assignedTasks.sort((a, b) => {
      const oa = orderInTarget.get(a.id) ?? 0;
      const ob = orderInTarget.get(b.id) ?? 0;
      return oa - ob;
    });

    // Recalculate start/end/segments sequentially from anchor
    const lunch = operatorLunchBreaks[row.label];
    const lunchStart = lunch?.start ?? Number.POSITIVE_INFINITY;
    const lunchEnd = lunch?.end ?? Number.POSITIVE_INFINITY;
    const anchor = anchorByRow.get(row.label) ?? (assignedTasks[0]?.start ?? 0);

    let cursor = anchor;
    const recalculated: OperatorTask[] = assignedTasks.map((t) => {
      const dur = t.operatorDuration ?? 0;
      const built = rebuildOperatorSegments(cursor, dur, lunchStart, lunchEnd);
      cursor = built.end;
      return {
        ...t,
        operatorName: row.label,
        start: built.start,
        end: built.end,
        segments: built.segments,
      };
    });

    if (isDev && recalculated.some((t) => t.end > OPERATOR_HARD_STOP)) {
      const overflows = recalculated
        .filter((t) => t.end > OPERATOR_HARD_STOP)
        .map((t) => `${t.doseLabel} → ${formatClock(t.end)}`);
      console.warn(`[Override] ${row.label}: tarefas após 15:30 →`, overflows);
    }

    return { ...row, tasks: recalculated };
  });
}

// ── Check if a task can be moved to another operator ────

function canMoveTaskTo(
  task: OperatorTask,
  targetRow: GanttRow<OperatorTask>,
  excludeTaskId?: string,
): boolean {
  for (const existing of targetRow.tasks) {
    if (existing.id === excludeTaskId) continue;
    if (task.start < existing.end && task.end > existing.start) {
      return false; // overlap
    }
  }
  return true;
}

// ── Hook ────────────────────────────────────────────────

export function useOperatorOverrides(schedule: DailyGanttSchedule, dateStr: string) {
  const operatorOverridesMap = useStore((s) => s.operatorOverrides);
  const setOperatorOverridesStore = useStore((s) => s.setOperatorOverrides);
  const clearOperatorOverridesStore = useStore((s) => s.clearOperatorOverrides);

  const [editMode, setEditMode] = useState(false);
  const [draftOverrides, setDraftOverrides] = useState<ManualOverride>({});
  const savedOverrides: ManualOverride = operatorOverridesMap[dateStr] ?? {};

  // Effective rows = original + saved overrides (outside edit mode)
  // or original + draft overrides (inside edit mode)
  const activeOverrides = editMode ? draftOverrides : savedOverrides;

  const effectiveRows = useMemo(
    () => applyOverrides(schedule.operatorRows, activeOverrides, schedule.operatorLunchBreaks),
    [schedule.operatorRows, activeOverrides, schedule.operatorLunchBreaks],
  );

  const conflicts = useMemo(() => detectConflicts(effectiveRows), [effectiveRows]);
  const hasConflicts = conflicts.length > 0;

  const conflictTaskIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of conflicts) {
      set.add(c.taskIds[0]);
      set.add(c.taskIds[1]);
    }
    return set;
  }, [conflicts]);

  const overriddenOperators = useMemo(() => {
    const set = new Set<string>();
    for (const key of Object.keys(activeOverrides)) {
      if (activeOverrides[key].length > 0) set.add(key);
    }
    return set;
  }, [activeOverrides]);

  // ── Actions ──────────────────────────────────────────

  const enterEditMode = useCallback(() => {
    setDraftOverrides({ ...savedOverrides });
    setEditMode(true);
  }, [savedOverrides]);

  const cancelEdit = useCallback(() => {
    setDraftOverrides({ ...savedOverrides });
    setEditMode(false);
  }, [savedOverrides]);

  const saveOverrides = useCallback(() => {
    if (hasConflicts) return;
    setOperatorOverridesStore(dateStr, { ...draftOverrides });
    setEditMode(false);
  }, [draftOverrides, hasConflicts, dateStr, setOperatorOverridesStore]);

  const resetOverrides = useCallback(() => {
    clearOperatorOverridesStore(dateStr);
    setDraftOverrides({});
    setEditMode(false);
  }, [dateStr, clearOperatorOverridesStore]);

  // Swap ALL tasks between two operators
  const swapOperators = useCallback(
    (opA: string, opB: string) => {
      // Get current effective assignment
      const currentRows = applyOverrides(schedule.operatorRows, draftOverrides, schedule.operatorLunchBreaks);
      const rowA = currentRows.find((r) => r.label === opA);
      const rowB = currentRows.find((r) => r.label === opB);
      if (!rowA || !rowB) return;

      const newOverrides = { ...draftOverrides };
      // opA gets opB's tasks, opB gets opA's tasks
      newOverrides[opA] = rowB.tasks.map((t) => t.id);
      newOverrides[opB] = rowA.tasks.map((t) => t.id);
      setDraftOverrides(newOverrides);
    },
    [schedule.operatorRows, draftOverrides],
  );

  // Move a single task to a different operator
  const moveTask = useCallback(
    (taskId: string, fromOp: string, toOp: string, insertAtIndex?: number) => {
      const currentRows = applyOverrides(schedule.operatorRows, draftOverrides, schedule.operatorLunchBreaks);

      // Build new overrides ensuring all task assignments are captured
      const newOverrides: ManualOverride = {};
      for (const row of currentRows) {
        newOverrides[row.label] = row.tasks
          .map((t) => t.id)
          .filter((id) => id !== taskId);
      }
      // Insert the moved task into target at requested position (or append)
      if (!newOverrides[toOp]) newOverrides[toOp] = [];
      if (insertAtIndex === undefined || insertAtIndex >= newOverrides[toOp].length) {
        newOverrides[toOp].push(taskId);
      } else {
        const safeIndex = Math.max(0, insertAtIndex);
        newOverrides[toOp].splice(safeIndex, 0, taskId);
      }

      setDraftOverrides(newOverrides);
    },
    [schedule.operatorRows, draftOverrides],
  );

  // Get available targets for a single task move (no conflict)
  const getAvailableTargets = useCallback(
    (taskId: string, fromOp: string): string[] => {
      const currentRows = applyOverrides(schedule.operatorRows, draftOverrides, schedule.operatorLunchBreaks);
      const task = currentRows
        .flatMap((r) => r.tasks)
        .find((t) => t.id === taskId);
      if (!task) return [];

      return currentRows
        .filter((r) => r.label !== fromOp)
        .filter((r) => canMoveTaskTo(task, r, taskId))
        .map((r) => r.label);
    },
    [schedule.operatorRows, draftOverrides],
  );

  return {
    editMode,
    effectiveRows,
    conflicts,
    hasConflicts,
    conflictTaskIds,
    overriddenOperators,
    activeOverrides,
    enterEditMode,
    cancelEdit,
    saveOverrides,
    resetOverrides,
    swapOperators,
    moveTask,
    getAvailableTargets,
  };
}
