import { useState, useMemo, useCallback } from "react";
import type { DailyGanttSchedule, GanttRow, OperatorTask, TimelineSegment } from "./scheduler";
import { OPERATOR_HARD_STOP, OPERATOR_START } from "./scheduler";

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

// ── Timeline recomputation ───────────────────────────────
//
// First task of each operator keeps its ORIGINAL scheduled start.
// Each subsequent task starts at: previousTask.start + previousTask.operatorDuration.
// T.Máquina (machineDuration) is recomputed from the new start but does NOT
// affect operator sequencing.
function recomputeOperatorTimeline(
  tasks: OperatorTask[],
  anchorStart: number | undefined,
): OperatorTask[] {
  if (tasks.length === 0) return tasks;
  const result: OperatorTask[] = [];
  let cursor = anchorStart ?? tasks[0].start;
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const start = i === 0 ? (anchorStart ?? t.start) : cursor;
    const machineDuration = Math.max(t.machineDuration, t.operatorDuration);
    const end = start + machineDuration;
    const seg: TimelineSegment = { start, end, overflow: end > OPERATOR_HARD_STOP };
    result.push({ ...t, start, end, segments: [seg] });
    cursor = start + (t.operatorDuration || 0);
  }
  return result;
}

function applyReorderAndRecompute(
  rows: GanttRow<OperatorTask>[],
  overrides: ManualOverride,
  reorder: Record<string, string[]>,
  anchors: Record<string, number>,
): GanttRow<OperatorTask>[] {
  const assigned = applyOverrides(rows, overrides);
  return assigned.map((row) => {
    const customOrder = reorder[row.label];
    let ordered = row.tasks;
    if (customOrder && customOrder.length > 0) {
      const byId = new Map(row.tasks.map((t) => [t.id, t]));
      const ord: OperatorTask[] = [];
      for (const id of customOrder) {
        const t = byId.get(id);
        if (t) {
          ord.push(t);
          byId.delete(id);
        }
      }
      for (const t of byId.values()) ord.push(t);
      ordered = ord;
    }
    const recomputed = recomputeOperatorTimeline(ordered, anchors[row.label]);
    return { ...row, tasks: recomputed };
  });
}

// ── Hook ────────────────────────────────────────────────

export function useOperatorOverrides(schedule: DailyGanttSchedule) {
  const [editMode, setEditMode] = useState(false);
  const [draftOverrides, setDraftOverrides] = useState<ManualOverride>({});
  const [savedOverrides, setSavedOverrides] = useState<ManualOverride>({});
  const [draftReorder, setDraftReorder] = useState<Record<string, string[]>>({});
  const [savedReorder, setSavedReorder] = useState<Record<string, string[]>>({});
  // Snapshot of original first-task start per operator at the moment edit
  // mode was entered. This is the immutable anchor used by recomputation.
  const [editAnchors, setEditAnchors] = useState<Record<string, number> | null>(null);

  const baseAnchors = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of schedule.operatorRows) {
      if (row.tasks.length > 0) {
        const first = [...row.tasks].sort((a, b) => a.start - b.start)[0];
        map[row.label] = first.start;
      } else {
        map[row.label] = OPERATOR_START;
      }
    }
    return map;
  }, [schedule.operatorRows]);

  const anchors = editMode && editAnchors ? editAnchors : baseAnchors;

  const activeOverrides = editMode ? draftOverrides : savedOverrides;
  const activeReorder = editMode ? draftReorder : savedReorder;

  const effectiveRows = useMemo(
    () => applyReorderAndRecompute(schedule.operatorRows, activeOverrides, activeReorder, anchors),
    [schedule.operatorRows, activeOverrides, activeReorder, anchors],
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
    for (const key of Object.keys(activeReorder)) {
      if (activeReorder[key].length > 0) set.add(key);
    }
    return set;
  }, [activeOverrides, activeReorder]);

  const enterEditMode = useCallback(() => {
    setDraftOverrides({ ...savedOverrides });
    setDraftReorder({ ...savedReorder });
    setEditAnchors({ ...baseAnchors });
    setEditMode(true);
  }, [savedOverrides, savedReorder, baseAnchors]);

  const cancelEdit = useCallback(() => {
    setDraftOverrides({});
    setDraftReorder({});
    setEditAnchors(null);
    setEditMode(false);
  }, []);

  const saveOverrides = useCallback(() => {
    if (hasConflicts) return;
    setSavedOverrides({ ...draftOverrides });
    setSavedReorder({ ...draftReorder });
    setEditAnchors(null);
    setEditMode(false);
  }, [draftOverrides, draftReorder, hasConflicts]);

  const resetOverrides = useCallback(() => {
    setSavedOverrides({});
    setDraftOverrides({});
    setSavedReorder({});
    setDraftReorder({});
    setEditAnchors(null);
    setEditMode(false);
  }, []);

  const swapOperators = useCallback(
    (opA: string, opB: string) => {
      const currentRows = applyReorderAndRecompute(schedule.operatorRows, draftOverrides, draftReorder, anchors);
      const rowA = currentRows.find((r) => r.label === opA);
      const rowB = currentRows.find((r) => r.label === opB);
      if (!rowA || !rowB) return;
      const newOverrides = { ...draftOverrides };
      newOverrides[opA] = rowB.tasks.map((t) => t.id);
      newOverrides[opB] = rowA.tasks.map((t) => t.id);
      const newReorder = { ...draftReorder };
      delete newReorder[opA];
      delete newReorder[opB];
      setDraftOverrides(newOverrides);
      setDraftReorder(newReorder);
    },
    [schedule.operatorRows, draftOverrides, draftReorder, anchors],
  );

  const moveTask = useCallback(
    (taskId: string, fromOp: string, toOp: string) => {
      const currentRows = applyReorderAndRecompute(schedule.operatorRows, draftOverrides, draftReorder, anchors);
      const newOverrides: ManualOverride = {};
      for (const row of currentRows) {
        newOverrides[row.label] = row.tasks
          .map((t) => t.id)
          .filter((id) => (row.label === fromOp ? id !== taskId : true));
      }
      if (!newOverrides[toOp]) newOverrides[toOp] = [];
      newOverrides[toOp].push(taskId);
      setDraftOverrides(newOverrides);
    },
    [schedule.operatorRows, draftOverrides, draftReorder, anchors],
  );

  // NEW: drag-and-drop reorder/move with explicit insert index
  const reorderTasks = useCallback(
    (taskId: string, fromOp: string, toOp: string, insertIndex: number) => {
      const currentRows = applyReorderAndRecompute(schedule.operatorRows, draftOverrides, draftReorder, anchors);
      const orderMap: Record<string, string[]> = {};
      for (const row of currentRows) {
        orderMap[row.label] = row.tasks.map((t) => t.id);
      }
      const fromList = orderMap[fromOp] ?? [];
      const srcIdx = fromList.indexOf(taskId);
      if (srcIdx === -1) return;
      fromList.splice(srcIdx, 1);
      orderMap[fromOp] = fromList;

      const toList = orderMap[toOp] ?? [];
      let idx = insertIndex;
      if (fromOp === toOp && srcIdx < insertIndex) idx = insertIndex - 1;
      idx = Math.max(0, Math.min(idx, toList.length));
      toList.splice(idx, 0, taskId);
      orderMap[toOp] = toList;

      const newOverrides: ManualOverride = {};
      for (const label of Object.keys(orderMap)) {
        newOverrides[label] = [...orderMap[label]];
      }
      const newReorder: Record<string, string[]> = { ...draftReorder };
      newReorder[fromOp] = [...orderMap[fromOp]];
      newReorder[toOp] = [...orderMap[toOp]];

      if (isDev) {
        console.log("[DnD] reorderTasks", { taskId, fromOp, toOp, insertIndex });
      }

      setDraftOverrides(newOverrides);
      setDraftReorder(newReorder);
    },
    [schedule.operatorRows, draftOverrides, draftReorder, anchors],
  );

  const getAvailableTargets = useCallback(
    (taskId: string, fromOp: string): string[] => {
      const currentRows = applyReorderAndRecompute(schedule.operatorRows, draftOverrides, draftReorder, anchors);
      const task = currentRows
        .flatMap((r) => r.tasks)
        .find((t) => t.id === taskId);
      if (!task) return [];
      return currentRows
        .filter((r) => r.label !== fromOp)
        .filter((r) => canMoveTaskTo(task, r, taskId))
        .map((r) => r.label);
    },
    [schedule.operatorRows, draftOverrides, draftReorder, anchors],
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
    reorderTasks,
    getAvailableTargets,
  };
}
