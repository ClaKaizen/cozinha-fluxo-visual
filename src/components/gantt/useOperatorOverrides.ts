import { useState, useMemo, useCallback } from "react";
import type { DailyGanttSchedule, GanttRow, MachineTask, OperatorTask, TimelineSegment } from "./scheduler";
import { OPERATOR_HARD_STOP, OPERATOR_START, DAY_START } from "./scheduler";

const isDev = typeof import.meta !== "undefined" && (import.meta as any).env?.DEV;

// ── Shared equipment-availability timeline (for post-drag recompute) ──
// Mirrors the scheduler's MachineSlotTracker contract: per equipment id,
// an array of release timestamps — one per physical unit. Built from the
// schedule's machineRows so we don't need the Equipment[] config here.
interface EqTimeline {
  earliestRelease(equipmentId: string): number;
  assign(equipmentId: string, machineDuration: number, notBefore: number): { start: number; end: number };
}

function buildEqTimelineFromMachineRows(
  machineRows: GanttRow<MachineTask>[],
  excludeTaskIds: Set<string>,
): EqTimeline {
  // Each machineRow corresponds to ONE physical unit. Group rows by equipmentId.
  const slots = new Map<string, number[]>();
  // We need stable per-unit slots: use rowLabel → unitIndex mapping per equipment.
  const rowsByEq = new Map<string, GanttRow<MachineTask>[]>();
  for (const row of machineRows) {
    // Pick the equipmentId from the first task on the row, fallback to label parsing.
    const eqId = row.tasks[0]?.equipmentId;
    if (!eqId) continue;
    const list = rowsByEq.get(eqId) ?? [];
    list.push(row);
    rowsByEq.set(eqId, list);
  }
  for (const [eqId, rows] of rowsByEq) {
    const releases: number[] = [];
    for (const row of rows) {
      // Initial release = max end of NON-excluded tasks already on this unit
      let r = DAY_START;
      for (const t of row.tasks) {
        if (excludeTaskIds.has(t.id)) continue;
        if (t.end > r) r = t.end;
      }
      releases.push(r);
    }
    slots.set(eqId, releases);
  }

  function pickEarliest(arr: number[]): number {
    let idx = 0;
    for (let i = 1; i < arr.length; i++) if (arr[i] < arr[idx]) idx = i;
    return idx;
  }

  return {
    earliestRelease(equipmentId) {
      const arr = slots.get(equipmentId);
      if (!arr || arr.length === 0) return DAY_START;
      return Math.min(...arr);
    },
    assign(equipmentId, machineDuration, notBefore) {
      const arr = slots.get(equipmentId);
      if (!arr || arr.length === 0) {
        return { start: notBefore, end: notBefore + machineDuration };
      }
      const i = pickEarliest(arr);
      const start = Math.max(arr[i], notBefore);
      const end = start + machineDuration;
      arr[i] = end;
      return { start, end };
    },
  };
}



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
// Per-operator rule:
//   - First task of each operator keeps its ORIGINAL scheduled start (anchor).
//   - Each subsequent task's operator-cursor advances by previous T.Homem.
//
// Cross-operator rule (Bug 2 fix):
//   - Equipment units are SHARED across all operators. For each task we must
//     also wait until a unit of the required equipment is free.
//   - We therefore process all operators in PARALLEL TIME ORDER (not row by
//     row): at each step we pick the operator whose next task can start the
//     earliest, place that task, advance that operator's cursor and the
//     equipment unit's release time, and repeat.
//   - The per-operator task ordering is preserved exactly as supplied —
//     we never reorder tasks of different types within a single operator.
function applyReorderAndRecompute(
  rows: GanttRow<OperatorTask>[],
  overrides: ManualOverride,
  reorder: Record<string, string[]>,
  anchors: Record<string, number>,
  machineRows: GanttRow<MachineTask>[],
): GanttRow<OperatorTask>[] {
  const assigned = applyOverrides(rows, overrides);

  // Apply manual reorder per row, but DO NOT recompute times yet.
  const orderedRows = assigned.map((row) => {
    const customOrder = reorder[row.label];
    if (!customOrder || customOrder.length === 0) return row;
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
    return { ...row, tasks: ord };
  });

  // Build the shared equipment timeline. Exclude the operator-row tasks
  // themselves — they are about to be re-placed.
  const allOpTaskIds = new Set<string>();
  for (const r of orderedRows) for (const t of r.tasks) allOpTaskIds.add(t.id);
  const eqTimeline = buildEqTimelineFromMachineRows(machineRows, allOpTaskIds);

  // Per-operator queues + cursors.
  const queues: { label: string; remaining: OperatorTask[]; placed: OperatorTask[]; cursor: number; placedCount: number }[] =
    orderedRows.map((row) => ({
      label: row.label,
      remaining: [...row.tasks],
      placed: [],
      cursor: anchors[row.label] ?? OPERATOR_START,
      placedCount: 0,
    }));

  // Iterate: pick the operator whose next task can start the earliest, given
  // its cursor (or anchor for first task) AND the shared equipment timeline.
  let safety = queues.reduce((s, q) => s + q.remaining.length, 0) + 5;
  while (safety-- > 0) {
    let bestQueueIdx = -1;
    let bestStart = Infinity;

    for (let i = 0; i < queues.length; i++) {
      const q = queues[i];
      if (q.remaining.length === 0) continue;
      const t = q.remaining[0];
      const isFirst = q.placedCount === 0;
      // The first task is anchored — its start is fixed regardless of
      // current equipment contention (per spec: anchor must not move).
      const opFreeTime = isFirst ? (anchors[q.label] ?? q.cursor) : q.cursor;
      const eqRelease = eqTimeline.earliestRelease(t.equipmentId);
      const start = isFirst ? opFreeTime : Math.max(opFreeTime, eqRelease);

      if (start < bestStart) {
        bestStart = start;
        bestQueueIdx = i;
      }
    }

    if (bestQueueIdx < 0) break;
    const q = queues[bestQueueIdx];
    const t = q.remaining.shift()!;
    const isFirst = q.placedCount === 0;

    const machineDuration = Math.max(t.machineDuration, t.operatorDuration);
    let placedStart: number;
    if (isFirst) {
      placedStart = anchors[q.label] ?? q.cursor;
      eqTimeline.assign(t.equipmentId, machineDuration, placedStart);
    } else {
      const res = eqTimeline.assign(t.equipmentId, machineDuration, q.cursor);
      placedStart = res.start;
    }

    const end = placedStart + machineDuration;
    const seg: TimelineSegment = { start: placedStart, end, overflow: end > OPERATOR_HARD_STOP };
    q.placed.push({ ...t, start: placedStart, end, segments: [seg] });
    q.placedCount += 1;
    q.cursor = placedStart + (t.operatorDuration || 0);
  }

  if (isDev && safety <= 0) {
    console.warn("[useOperatorOverrides] recompute safety limit hit");
  }

  return orderedRows.map((row, i) => ({ ...row, tasks: queues[i].placed }));
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
    () => applyReorderAndRecompute(schedule.operatorRows, activeOverrides, activeReorder, anchors, schedule.machineRows),
    [schedule.operatorRows, schedule.machineRows, activeOverrides, activeReorder, anchors],
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
      const currentRows = applyReorderAndRecompute(schedule.operatorRows, draftOverrides, draftReorder, anchors, schedule.machineRows);
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
    [schedule.operatorRows, schedule.machineRows, draftOverrides, draftReorder, anchors],
  );

  const moveTask = useCallback(
    (taskId: string, fromOp: string, toOp: string) => {
      const currentRows = applyReorderAndRecompute(schedule.operatorRows, draftOverrides, draftReorder, anchors, schedule.machineRows);
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
    [schedule.operatorRows, schedule.machineRows, draftOverrides, draftReorder, anchors],
  );

  // NEW: drag-and-drop reorder/move with explicit insert index
  const reorderTasks = useCallback(
    (taskId: string, fromOp: string, toOp: string, insertIndex: number) => {
      const currentRows = applyReorderAndRecompute(schedule.operatorRows, draftOverrides, draftReorder, anchors, schedule.machineRows);
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
    [schedule.operatorRows, schedule.machineRows, draftOverrides, draftReorder, anchors],
  );

  const getAvailableTargets = useCallback(
    (taskId: string, fromOp: string): string[] => {
      const currentRows = applyReorderAndRecompute(schedule.operatorRows, draftOverrides, draftReorder, anchors, schedule.machineRows);
      const task = currentRows
        .flatMap((r) => r.tasks)
        .find((t) => t.id === taskId);
      if (!task) return [];
      return currentRows
        .filter((r) => r.label !== fromOp)
        .filter((r) => canMoveTaskTo(task, r, taskId))
        .map((r) => r.label);
    },
    [schedule.operatorRows, schedule.machineRows, draftOverrides, draftReorder, anchors],
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
