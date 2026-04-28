import { useState, useMemo, useCallback } from "react";
import type {
  DailyGanttSchedule,
  GanttRow,
  OperatorLunchBreak,
  OperatorTask,
  TimelineSegment,
} from "./scheduler";
import { DAY_START, OPERATOR_HARD_STOP, formatClock } from "./scheduler";
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
  // Build a flat pool of all tasks
  const allTasks = new Map<string, OperatorTask>();
  for (const row of originalRows) {
    for (const task of row.tasks) {
      allTasks.set(task.id, task);
    }
  }

  // Build assignment map: taskId → operatorLabel from overrides
  const taskToOperator = new Map<string, string>();
  const orderInTarget = new Map<string, number>();
  for (const [opLabel, taskIds] of Object.entries(overrides)) {
    taskIds.forEach((tid, idx) => {
      taskToOperator.set(tid, opLabel);
      orderInTarget.set(tid, idx);
    });
  }

  // For tasks NOT in any override, keep original assignment + original-order index
  for (const row of originalRows) {
    row.tasks.forEach((task, idx) => {
      if (!taskToOperator.has(task.id)) {
        taskToOperator.set(task.id, row.label);
        orderInTarget.set(task.id, idx + 1_000_000); // append after explicit overrides
      }
    });
  }

  const hasOverrides = Object.keys(overrides).length > 0;

  if (!hasOverrides) {
    // No overrides → return original ordering & timing untouched
    return originalRows.map((row) => ({
      ...row,
      tasks: row.tasks
        .map((t) => ({ ...t, operatorName: row.label }))
        .sort((a, b) => a.start - b.start),
    }));
  }

  // ── Priority-queue simulation ──
  // Goal: respect both operator order (per overrides) AND machine availability (cursor per
  // machineLabel). At each step, advance the operator whose next task can start earliest.
  // This prevents two doses landing on the same machine slot — the root cause of the
  // visible overlap after a swap/drag-drop.
  const operatorSequences = new Map<string, OperatorTask[]>();
  for (const row of originalRows) {
    operatorSequences.set(row.label, []);
  }
  for (const task of allTasks.values()) {
    const op = taskToOperator.get(task.id);
    if (!op) continue;
    const seq = operatorSequences.get(op);
    if (seq) seq.push(task);
  }
  for (const seq of operatorSequences.values()) {
    seq.sort((a, b) => {
      const oa = orderInTarget.get(a.id) ?? 0;
      const ob = orderInTarget.get(b.id) ?? 0;
      return oa - ob;
    });
  }

  const operatorCursor = new Map<string, number>();
  const machineCursor = new Map<string, number>();
  const nextIndex = new Map<string, number>();
  for (const op of operatorSequences.keys()) {
    operatorCursor.set(op, DAY_START);
    nextIndex.set(op, 0);
  }

  // Apply mandatory + personal lunch constraints to a candidate start time.
  // T.Homem must be entirely outside the lunch windows (push start past lunchEnd if it would cross).
  const applyLunchConstraint = (start: number, duration: number, opLabel: string): number => {
    let s = start;
    // Mandatory operator lunch [12:00, 13:00] — applies to every operator
    if (s < MANDATORY_LUNCH_START && s + duration > MANDATORY_LUNCH_START) {
      s = MANDATORY_LUNCH_END;
    } else if (s >= MANDATORY_LUNCH_START && s < MANDATORY_LUNCH_END) {
      s = MANDATORY_LUNCH_END;
    }
    // Personal lunch (only meaningful if shifted later than the mandatory one)
    const lunch = operatorLunchBreaks[opLabel];
    if (lunch && Number.isFinite(lunch.start) && Number.isFinite(lunch.end) && lunch.end > lunch.start) {
      if (s < lunch.start && s + duration > lunch.start) {
        s = lunch.end;
      } else if (s >= lunch.start && s < lunch.end) {
        s = lunch.end;
      }
    }
    return s;
  };

  const updatedTasks = new Map<string, OperatorTask>();

  // Drain all sequences; each iteration commits exactly one task across all operators.
  while (true) {
    let pickOp: string | null = null;
    let pickTask: OperatorTask | null = null;
    let pickStart = Number.POSITIVE_INFINITY;

    for (const [op, seq] of operatorSequences) {
      const idx = nextIndex.get(op) ?? 0;
      if (idx >= seq.length) continue;
      const task = seq[idx];

      const opC = operatorCursor.get(op) ?? DAY_START;
      const mC = machineCursor.get(task.machineLabel) ?? DAY_START;
      const naive = Math.max(DAY_START, opC, mC);
      const start = applyLunchConstraint(naive, task.operatorDuration ?? 0, op);

      if (start < pickStart) {
        pickStart = start;
        pickOp = op;
        pickTask = task;
      }
    }

    if (!pickOp || !pickTask) break;

    const opDur = pickTask.operatorDuration ?? 0;
    const machineDur = pickTask.machineDuration ?? 0;
    const opEnd = pickStart + opDur;
    const machineEnd = pickStart + machineDur;

    operatorCursor.set(pickOp, opEnd);
    machineCursor.set(pickTask.machineLabel, machineEnd);

    const lunch = operatorLunchBreaks[pickOp];
    const lunchStart = lunch?.start ?? Number.POSITIVE_INFINITY;
    const lunchEnd = lunch?.end ?? Number.POSITIVE_INFINITY;
    const built = rebuildOperatorSegments(pickStart, opDur, lunchStart, lunchEnd);

    updatedTasks.set(pickTask.id, {
      ...pickTask,
      operatorName: pickOp,
      start: built.start,
      end: built.end,
      segments: built.segments,
    });

    nextIndex.set(pickOp, (nextIndex.get(pickOp) ?? 0) + 1);
  }

  // Reassemble rows in their original order, with each row's tasks sorted by new start
  const result = originalRows.map((row) => {
    const tasksForRow = Array.from(updatedTasks.values())
      .filter((t) => taskToOperator.get(t.id) === row.label)
      .sort((a, b) => a.start - b.start);
    return { ...row, tasks: tasksForRow };
  });

  if (isDev) {
    for (const row of result) {
      const overflows = row.tasks.filter((t) => t.end > OPERATOR_HARD_STOP);
      if (overflows.length > 0) {
        console.warn(
          `[Override] ${row.label}: tarefas após 15:30 →`,
          overflows.map((t) => `${t.doseLabel} → ${formatClock(t.end)}`),
        );
      }
    }
  }

  return result;
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
