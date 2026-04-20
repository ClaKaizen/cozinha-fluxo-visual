import { useState, useMemo, useCallback } from "react";
import type { DailyGanttSchedule, GanttRow, OperatorTask, TimelineSegment } from "./scheduler";
import { OPERATOR_HARD_STOP } from "./scheduler";

const isDev = typeof import.meta !== "undefined" && (import.meta as any).env?.DEV;

// ── Manual reorder state ────────────────────────────────
// Stores per-operator ordered list of task IDs AND the anchor start time
// for the first task of each operator (taken from the original schedule).
export interface ReorderState {
  /** operatorLabel → ordered taskIds */
  order: Record<string, string[]>;
  /** operatorLabel → anchor start minute for first task */
  anchors: Record<string, number>;
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
): GanttRow<OperatorTask>[] {
  if (Object.keys(overrides).length === 0) return originalRows;

  // Build a flat pool of all tasks
  const allTasks = new Map<string, OperatorTask>();
  for (const row of originalRows) {
    for (const task of row.tasks) {
      allTasks.set(task.id, task);
    }
  }

  // Build assignment map: taskId → operatorLabel from overrides
  const taskToOperator = new Map<string, string>();
  for (const [opLabel, taskIds] of Object.entries(overrides)) {
    for (const tid of taskIds) {
      taskToOperator.set(tid, opLabel);
    }
  }

  // For tasks NOT in any override, keep original assignment
  for (const row of originalRows) {
    for (const task of row.tasks) {
      if (!taskToOperator.has(task.id)) {
        taskToOperator.set(task.id, row.label);
      }
    }
  }

  // Rebuild rows
  return originalRows.map((row) => {
    const tasks = Array.from(allTasks.values())
      .filter((t) => taskToOperator.get(t.id) === row.label)
      .map((t) => ({ ...t, operatorName: row.label }))
      .sort((a, b) => a.start - b.start);
    return { ...row, tasks };
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

export function useOperatorOverrides(schedule: DailyGanttSchedule) {
  const [editMode, setEditMode] = useState(false);
  const [draftOverrides, setDraftOverrides] = useState<ManualOverride>({});
  const [savedOverrides, setSavedOverrides] = useState<ManualOverride>({});

  // Effective rows = original + saved overrides (outside edit mode)
  // or original + draft overrides (inside edit mode)
  const activeOverrides = editMode ? draftOverrides : savedOverrides;

  const effectiveRows = useMemo(
    () => applyOverrides(schedule.operatorRows, activeOverrides),
    [schedule.operatorRows, activeOverrides],
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
    setDraftOverrides({});
    setEditMode(false);
  }, []);

  const saveOverrides = useCallback(() => {
    if (hasConflicts) return;
    setSavedOverrides({ ...draftOverrides });
    setEditMode(false);
  }, [draftOverrides, hasConflicts]);

  const resetOverrides = useCallback(() => {
    setSavedOverrides({});
    setDraftOverrides({});
    setEditMode(false);
  }, []);

  // Swap ALL tasks between two operators
  const swapOperators = useCallback(
    (opA: string, opB: string) => {
      // Get current effective assignment
      const currentRows = applyOverrides(schedule.operatorRows, draftOverrides);
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
    (taskId: string, fromOp: string, toOp: string) => {
      const currentRows = applyOverrides(schedule.operatorRows, draftOverrides);

      // Build new overrides ensuring all task assignments are captured
      const newOverrides: ManualOverride = {};
      for (const row of currentRows) {
        newOverrides[row.label] = row.tasks
          .map((t) => t.id)
          .filter((id) => (row.label === fromOp ? id !== taskId : true));
      }
      // Add the moved task to target
      if (!newOverrides[toOp]) newOverrides[toOp] = [];
      newOverrides[toOp].push(taskId);

      setDraftOverrides(newOverrides);
    },
    [schedule.operatorRows, draftOverrides],
  );

  // Get available targets for a single task move (no conflict)
  const getAvailableTargets = useCallback(
    (taskId: string, fromOp: string): string[] => {
      const currentRows = applyOverrides(schedule.operatorRows, draftOverrides);
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
