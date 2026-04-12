import {
  Category,
  Equipment,
  Operator,
  ProductionEntry,
  ShiftCode,
  TempOperator,
  WORKING_CODES,
} from "@/store/types";

export const DAY_START = 7 * 60;    // 420
export const DAY_END = 16 * 60;     // 960
export const AVAILABLE_MACHINE_MINUTES = 480; // 8h useful operator time

// ── Shared types ──────────────────────────────────────────────

export interface TimelineSegment {
  start: number;
  end: number;
  overflow: boolean;
}

export interface MachineBooking {
  equipmentId: string;
  equipmentName: string;
  duration: number;
  simultaneous: boolean;
  colorIndex: number;
  showSimultaneousBadge?: boolean;
  isSequentialPhase?: boolean;
}

export interface PlanningTask {
  id: string;
  artigo: string;
  doseLabel: string;
  equipmentId: string;
  equipmentName: string;
  categoryName: string;
  machineDuration: number;
  operatorDuration: number;
  colorIndex: number;
  isEmergency: boolean;
  machineBookings: MachineBooking[];
}

export interface MachineTask extends PlanningTask {
  machineIndex: number;
  machineLabel: string;
  start: number;
  end: number;
  segments: TimelineSegment[];
  isEmergencyMachine: boolean;
  showSimultaneousBadge: boolean;
  isSequentialPhase: boolean;
}

export interface OperatorTask extends PlanningTask {
  operatorName: string;
  start: number;
  end: number;
  segments: TimelineSegment[];
  machineTaskId: string;
  machineLabel: string;
  showSimultaneousBadge: boolean;
}

export interface GanttRow<TTask> {
  label: string;
  tasks: TTask[];
}

export interface UnscheduledTask {
  artigo: string;
  dosesRemaining: number;
}

export interface OperatorLunchBreak {
  start: number;
  end: number;
}

export interface DailyGanttSchedule {
  tasks: PlanningTask[];
  machineRows: GanttRow<MachineTask>[];
  operatorRows: GanttRow<OperatorTask>[];
  axisEnd: number;
  usesEmergencyEquipment: boolean;
  emergencyEquipmentNames: string[];
  overflowTasks: string[];
  unscheduledTasks: UnscheduledTask[];
  lunchStart: number;
  lunchEnd: number;
  hasOvertime: boolean;
  operatorLunchBreaks: Record<string, OperatorLunchBreak>;
  machineLunchBreaks: Record<string, OperatorLunchBreak>;
}

export interface OperatorPresence {
  operator: Operator;
  code: ShiftCode;
  absent: boolean;
  hours: number;
}

interface BuildScheduleInput {
  dateStr: string;
  production: ProductionEntry[];
  categories: Category[];
  equipment: Equipment[];
  operatorsForDate: OperatorPresence[];
  tempOperators: TempOperator[];
}

// ── Helpers ──────────────────────────────────────────────

const roundUpToHalfHour = (minutes: number) => Math.ceil(minutes / 30) * 30;

export function normalizeDateKey(value: string): string {
  return value.slice(0, 10);
}

export function formatClock(minutes: number): string {
  const safeMinutes = Math.max(0, Math.floor(minutes));
  const h = Math.floor(safeMinutes / 60);
  const m = safeMinutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function normalizeCursor(cursor: number, lunchStart: number, lunchEnd: number): number {
  if (cursor < DAY_START) return DAY_START;
  if (cursor >= lunchStart && cursor < lunchEnd) return lunchEnd;
  return cursor;
}

function createSegments(start: number, duration: number, lunchStart: number, lunchEnd: number): { start: number; end: number; segments: TimelineSegment[] } {
  let cursor = normalizeCursor(start, lunchStart, lunchEnd);
  const segments: TimelineSegment[] = [];
  const normalizedStart = cursor;
  let remaining = Math.max(0, duration);

  while (remaining > 0) {
    cursor = normalizeCursor(cursor, lunchStart, lunchEnd);
    let nextBoundary = cursor + remaining;
    if (cursor < lunchStart) nextBoundary = Math.min(nextBoundary, lunchStart);
    if (cursor < DAY_END) nextBoundary = Math.min(nextBoundary, DAY_END);

    const isOverflow = cursor >= DAY_END;
    segments.push({
      start: cursor,
      end: isOverflow ? cursor + remaining : nextBoundary,
      overflow: isOverflow,
    });

    if (isOverflow) break;

    remaining -= nextBoundary - cursor;
    cursor = nextBoundary;
    if (remaining > 0 && cursor === lunchStart) cursor = lunchEnd;
  }

  return { start: normalizedStart, end: segments.length > 0 ? segments[segments.length - 1].end : normalizedStart, segments };
}

// Machine segments: no lunch break — machines run continuously
function createMachineSegments(start: number, duration: number): { start: number; end: number; segments: TimelineSegment[] } {
  let cursor = Math.max(start, DAY_START);
  const segments: TimelineSegment[] = [];
  let remaining = Math.max(0, duration);

  while (remaining > 0) {
    const isOverflow = cursor >= DAY_END;
    const end = cursor + remaining;
    segments.push({ start: cursor, end, overflow: isOverflow });
    break; // machines run continuously, single segment
  }

  return { start: cursor, end: cursor + Math.max(0, duration), segments };
}

// ── Combinatorics helper ──────────────────────────────────

function buildCombinations(indices: number[], count: number): number[][] {
  if (count === 0) return [[]];
  const results: number[][] = [];
  const current: number[] = [];
  const walk = (startIndex: number) => {
    if (current.length === count) { results.push([...current]); return; }
    for (let i = startIndex; i < indices.length; i++) {
      current.push(indices[i]);
      walk(i + 1);
      current.pop();
    }
  };
  walk(0);
  return results;
}

// ── Phase structures ──────────────────────────────────

interface PhaseAssignment {
  booking: MachineBooking;
  machineIdx: number;
  scheduled: { start: number; end: number; segments: TimelineSegment[] };
}

interface OperatorAssignment {
  task: PlanningTask;
  machineStart: number;
  machineLabel: string;
  machineTaskId: string;
  showSimultaneousBadge: boolean;
}

// ── Machine scheduling core ──────────────────────────────

function buildBookingPhases(task: PlanningTask): MachineBooking[][] {
  const sequentialPhases = task.machineBookings.filter((b) => !b.simultaneous).map((b) => [b]);
  const simultaneousPhase = task.machineBookings.filter((b) => b.simultaneous);
  return simultaneousPhase.length > 0 ? [...sequentialPhases, simultaneousPhase] : sequentialPhases;
}

/**
 * Try to schedule a set of simultaneous bookings starting at minStart.
 * Returns assignments or null.
 */
function evaluatePhase(
  phaseBookings: MachineBooking[],
  minStart: number,
  allowEmergency: boolean,
  requireWithinDay: boolean,
  machineSlots: Map<string, number[]>,
  equipmentMap: Map<string, Equipment>,
): PhaseAssignment[] | null {
  const groupedBookings = new Map<string, MachineBooking[]>();
  phaseBookings.forEach((b) => {
    const existing = groupedBookings.get(b.equipmentId) ?? [];
    existing.push(b);
    groupedBookings.set(b.equipmentId, existing);
  });

  const comboEntries = Array.from(groupedBookings.entries()).map(([equipmentId, bookings]) => {
    const eq = equipmentMap.get(equipmentId);
    if (!eq) return null;
    const slotLimit = allowEmergency ? eq.quantidade + eq.quantidadeEmergencia : eq.quantidade;
    if (slotLimit < bookings.length) return null;
    const combos = buildCombinations(Array.from({ length: slotLimit }, (_, i) => i), bookings.length);
    return { equipmentId, bookings, combos };
  });

  if (comboEntries.some((e) => e === null)) return null;
  const entries = comboEntries as { equipmentId: string; bookings: MachineBooking[]; combos: number[][] }[];

  const selections: Array<{ equipmentId: string; bookings: MachineBooking[]; slotIndices: number[] }> = [];

  const search = (entryIndex: number): PhaseAssignment[] | null => {
    if (entryIndex >= entries.length) {
      const rawStart = Math.max(
        minStart,
        ...selections.flatMap((sel) =>
          sel.slotIndices.map((si) => Math.max(machineSlots.get(sel.equipmentId)?.[si] ?? DAY_START, minStart))
        ),
      );
      const phaseStart = Math.max(rawStart, DAY_START);
      const assignments: PhaseAssignment[] = [];

      for (const sel of selections) {
        for (let bi = 0; bi < sel.bookings.length; bi++) {
          const booking = sel.bookings[bi];
          const machineIdx = sel.slotIndices[bi];
          const scheduled = createMachineSegments(phaseStart, booking.duration);
          if (requireWithinDay && scheduled.segments.some((s) => s.overflow)) return null;
          assignments.push({ booking, machineIdx, scheduled });
        }
      }
      return assignments;
    }

    const entry = entries[entryIndex];
    for (const slotIndices of entry.combos) {
      selections.push({ equipmentId: entry.equipmentId, bookings: entry.bookings, slotIndices });
      const result = search(entryIndex + 1);
      selections.pop();
      if (result) return result;
    }
    return null;
  };

  return search(0);
}

/**
 * Try to schedule all phases of a task atomically.
 * Returns all phase assignments or null.
 */
function tryScheduleTask(
  task: PlanningTask,
  allowEmergency: boolean,
  requireWithinDay: boolean,
  machineSlots: Map<string, number[]>,
  equipmentMap: Map<string, Equipment>,
): PhaseAssignment[] | null {
  const phases = buildBookingPhases(task);
  if (phases.length === 0) return null;

  // Clone machine slots so we can speculatively commit
  const speculativeSlots = new Map<string, number[]>();
  machineSlots.forEach((slots, key) => speculativeSlots.set(key, [...slots]));

  const allAssignments: PhaseAssignment[] = [];
  let phaseCursor = DAY_START;

  // Find earliest start across all equipment needed
  for (const phaseBookings of phases) {
    // For each phase, try normal first, then emergency if allowed
    let assignments: PhaseAssignment[] | null = null;

    if (!allowEmergency) {
      assignments = evaluatePhase(phaseBookings, phaseCursor, false, requireWithinDay, speculativeSlots, equipmentMap);
    } else {
      // Try normal first
      assignments = evaluatePhase(phaseBookings, phaseCursor, false, requireWithinDay, speculativeSlots, equipmentMap);
      if (!assignments) {
        assignments = evaluatePhase(phaseBookings, phaseCursor, true, requireWithinDay, speculativeSlots, equipmentMap);
      }
    }

    if (!assignments || assignments.length === 0) return null;

    // Commit to speculative slots
    for (const a of assignments) {
      speculativeSlots.get(a.booking.equipmentId)![a.machineIdx] = a.scheduled.end;
    }

    const phaseEnd = Math.max(...assignments.map((a) => a.scheduled.end));
    phaseCursor = phaseEnd;
    allAssignments.push(...assignments);
  }

  return allAssignments;
}

/**
 * Commit assignments to real machine slots and produce MachineTask objects.
 */
function commitAssignments(
  task: PlanningTask,
  assignments: PhaseAssignment[],
  machineSlots: Map<string, number[]>,
  equipmentMap: Map<string, Equipment>,
  machineTasks: MachineTask[],
  machineRowsMap: Map<string, GanttRow<MachineTask>>,
  overflowTasks: string[],
  emergencyEquipmentNames: Set<string>,
): MachineTask[] {
  const taskMachineTasks: MachineTask[] = [];

  for (const { booking, machineIdx, scheduled } of assignments) {
    const eq = equipmentMap.get(booking.equipmentId);
    if (!eq) continue;

    machineSlots.get(booking.equipmentId)![machineIdx] = scheduled.end;
    const isEmergencyMachine = machineIdx >= eq.quantidade;
    const label = isEmergencyMachine
      ? `${booking.equipmentName} ${machineIdx + 1} ⚠️`
      : `${booking.equipmentName} ${machineIdx + 1}`;

    if (isEmergencyMachine) emergencyEquipmentNames.add(eq.nome);

    if (scheduled.segments.some((s) => s.overflow) && !overflowTasks.includes(task.doseLabel)) {
      overflowTasks.push(task.doseLabel);
    }

    const mt: MachineTask = {
      ...task,
      equipmentId: booking.equipmentId,
      equipmentName: booking.equipmentName,
      colorIndex: booking.colorIndex,
      machineIndex: machineIdx,
      machineLabel: label,
      start: scheduled.start,
      end: scheduled.end,
      segments: scheduled.segments,
      isEmergencyMachine,
      showSimultaneousBadge: Boolean(booking.showSimultaneousBadge),
      isSequentialPhase: Boolean(booking.isSequentialPhase),
    };

    taskMachineTasks.push(mt);
    machineTasks.push(mt);
    const row = machineRowsMap.get(label) ?? { label, tasks: [] };
    row.tasks.push(mt);
    machineRowsMap.set(label, row);
  }

  return taskMachineTasks;
}

// ── Main schedule builder ──────────────────────────────────

function buildWithLunch(
  tasks: PlanningTask[],
  equipment: Equipment[],
  equipmentMap: Map<string, Equipment>,
  operatorNames: string[],
  targetLunchStart: number,
  targetLunchEnd: number,
): Omit<DailyGanttSchedule, 'tasks' | 'lunchStart' | 'lunchEnd'> {
  // ── PHASE 0: Sort by equipment contention then QD ──
  const equipContention = new Map<string, number>();
  tasks.forEach((t) => {
    for (const b of t.machineBookings) {
      equipContention.set(b.equipmentId, (equipContention.get(b.equipmentId) ?? 0) + b.duration);
    }
  });

  const sortedTasks = [...tasks].sort((a, b) => {
    // Highest contention ratio first
    const aContention = Math.max(...a.machineBookings.map((bk) => {
      const eq = equipmentMap.get(bk.equipmentId);
      const avail = eq ? eq.quantidade * AVAILABLE_MACHINE_MINUTES : 1;
      return (equipContention.get(bk.equipmentId) ?? 0) / avail;
    }));
    const bContention = Math.max(...b.machineBookings.map((bk) => {
      const eq = equipmentMap.get(bk.equipmentId);
      const avail = eq ? eq.quantidade * AVAILABLE_MACHINE_MINUTES : 1;
      return (equipContention.get(bk.equipmentId) ?? 0) / avail;
    }));
    if (bContention !== aContention) return bContention - aContention;

    // Compound tasks (multi-phase) first
    const aCompound = a.machineBookings.some((bk) => !bk.simultaneous) ? 1 : 0;
    const bCompound = b.machineBookings.some((bk) => !bk.simultaneous) ? 1 : 0;
    if (bCompound !== aCompound) return bCompound - aCompound;

    // Larger machine duration first
    return b.machineDuration - a.machineDuration;
  });

  // ── PHASE 1: Schedule with normal equipment only ──
  const machineSlots = new Map<string, number[]>();
  equipment.forEach((eq) => {
    machineSlots.set(eq.id, Array.from({ length: eq.quantidade + eq.quantidadeEmergencia }, () => DAY_START));
  });

  const machineRowsMap = new Map<string, GanttRow<MachineTask>>();
  const machineTasks: MachineTask[] = [];
  const overflowTasks: string[] = [];
  const emergencyEquipmentNames = new Set<string>();
  const taskMachinesMap = new Map<string, MachineTask[]>();

  const phase1Scheduled: PlanningTask[] = [];
  const phase1Overflow: PlanningTask[] = [];

  for (const task of sortedTasks) {
    const assignments = tryScheduleTask(task, false, true, machineSlots, equipmentMap);
    if (assignments) {
      const mts = commitAssignments(task, assignments, machineSlots, equipmentMap, machineTasks, machineRowsMap, overflowTasks, emergencyEquipmentNames);
      taskMachinesMap.set(task.id, mts);
      phase1Scheduled.push(task);
    } else {
      phase1Overflow.push(task);
    }
  }

  // ── PHASE 2: Retry overflow tasks with emergency equipment ──
  const phase2Overflow: PlanningTask[] = [];

  for (const task of phase1Overflow) {
    const assignments = tryScheduleTask(task, true, true, machineSlots, equipmentMap);
    if (assignments) {
      const mts = commitAssignments(task, assignments, machineSlots, equipmentMap, machineTasks, machineRowsMap, overflowTasks, emergencyEquipmentNames);
      taskMachinesMap.set(task.id, mts);
    } else {
      // Last resort: allow overflow (beyond 16:00)
      const overflowAssignments = tryScheduleTask(task, true, false, machineSlots, equipmentMap);
      if (overflowAssignments) {
        const mts = commitAssignments(task, overflowAssignments, machineSlots, equipmentMap, machineTasks, machineRowsMap, overflowTasks, emergencyEquipmentNames);
        taskMachinesMap.set(task.id, mts);
      }
      phase2Overflow.push(task);
    }
  }

  // Ensure all normal equipment rows exist
  equipment.forEach((eq) => {
    for (let i = 0; i < eq.quantidade; i++) {
      const label = `${eq.nome} ${i + 1}`;
      if (!machineRowsMap.has(label)) {
        machineRowsMap.set(label, { label, tasks: [] });
      }
    }
  });

  const machineRows = Array.from(machineRowsMap.values())
    .filter((row) => row.label.includes("⚠️") ? row.tasks.length > 0 : true)
    .sort((a, b) => {
      const aEmerg = a.label.includes("⚠️") ? 1 : 0;
      const bEmerg = b.label.includes("⚠️") ? 1 : 0;
      if (aEmerg !== bEmerg) return aEmerg - bEmerg;
      const am = a.label.match(/^(.*?) (\d+)/);
      const bm = b.label.match(/^(.*?) (\d+)/);
      return (am?.[1] ?? a.label).localeCompare(bm?.[1] ?? b.label) || Number(am?.[2] ?? 0) - Number(bm?.[2] ?? 0);
    });

  // ── PHASE 3: Operator scheduling with rebalancing ──
  const allOperatorNames = operatorNames.length > 0 ? operatorNames : [];
  const operatorRowsMap = new Map<string, GanttRow<OperatorTask>>(
    allOperatorNames.map((name) => [name, { label: name, tasks: [] }])
  );
  const unscheduledTasks: UnscheduledTask[] = [];
  const operatorLunchBreaks: Record<string, OperatorLunchBreak> = {};

  allOperatorNames.forEach((name) => {
    operatorLunchBreaks[name] = { start: targetLunchStart, end: targetLunchEnd };
  });

  const incrementUnscheduled = (artigo: string) => {
    const existing = unscheduledTasks.find((u) => u.artigo === artigo);
    if (existing) { existing.dosesRemaining += 1; return; }
    unscheduledTasks.push({ artigo, dosesRemaining: 1 });
  };

  if (allOperatorNames.length > 0) {
    // Build operator task sources from machine schedule
    const allScheduledTasks = [...phase1Scheduled, ...phase1Overflow.filter((t) => taskMachinesMap.has(t.id))];

    const operatorSources = allScheduledTasks
      .map((task) => {
        const relatedMTs = taskMachinesMap.get(task.id) ?? [];
        if (relatedMTs.length === 0) return null;

        const hasOverflow = relatedMTs.some((mt) => mt.segments.some((s) => s.overflow));
        const firstStart = Math.min(...relatedMTs.map((mt) => mt.start));
        const firstPhaseTasks = relatedMTs
          .filter((mt) => mt.start === firstStart)
          .sort((a, b) => a.machineLabel.localeCompare(b.machineLabel));

        return {
          task,
          start: firstStart,
          machineLabel: firstPhaseTasks.map((mt) => mt.machineLabel).join(" + "),
          machineTaskId: firstPhaseTasks[0]?.id ?? task.id,
          showSimultaneousBadge: firstPhaseTasks.some((mt) => mt.showSimultaneousBadge),
          hasOverflow,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => a.start - b.start || a.machineLabel.localeCompare(b.machineLabel));

    // PASS 1: Assign tasks to operators with balanced distribution
    const operatorAvailability = new Map(allOperatorNames.map((n) => [n, DAY_START]));
    const operatorTotalMinutes = new Map(allOperatorNames.map((n) => [n, 0]));
    const assignmentsByOperator = new Map<string, OperatorAssignment[]>(
      allOperatorNames.map((n) => [n, []])
    );

    for (const { task, start, machineLabel, machineTaskId, showSimultaneousBadge, hasOverflow } of operatorSources) {
      if (task.operatorDuration <= 0 || hasOverflow) continue;

      // Find operator with lowest total load who can take this task
      let chosen: string | null = null;
      let chosenStart = Infinity;
      let chosenTotal = Infinity;

      for (const name of allOperatorNames) {
        const avail = operatorAvailability.get(name) ?? DAY_START;
        const total = operatorTotalMinutes.get(name) ?? 0;
        const candidateStart = normalizeCursor(Math.max(avail, start), targetLunchStart, targetLunchEnd);

        if (total + task.operatorDuration > AVAILABLE_MACHINE_MINUTES) continue;

        const testSeg = createSegments(candidateStart, task.operatorDuration, targetLunchStart, targetLunchEnd);
        if (testSeg.segments.some((s) => s.overflow)) continue;

        // Prioritize: lowest total load, then earliest start
        if (chosen === null || total < chosenTotal || (total === chosenTotal && candidateStart < chosenStart)) {
          chosen = name;
          chosenStart = candidateStart;
          chosenTotal = total;
        }
      }

      if (chosen === null) {
        incrementUnscheduled(task.artigo);
        continue;
      }

      assignmentsByOperator.get(chosen)!.push({ task, machineStart: start, machineLabel, machineTaskId, showSimultaneousBadge });

      const actualStart = normalizeCursor(Math.max(operatorAvailability.get(chosen) ?? DAY_START, start), targetLunchStart, targetLunchEnd);
      const scheduled = createSegments(actualStart, task.operatorDuration, targetLunchStart, targetLunchEnd);
      operatorAvailability.set(chosen, scheduled.end);
      operatorTotalMinutes.set(chosen, (operatorTotalMinutes.get(chosen) ?? 0) + task.operatorDuration);
    }

    // PASS 2: Calculate per-operator lunch and re-schedule with individual lunch breaks
    const LUNCH_LATEST_START = 13 * 60;

    for (const [name, assignments] of assignmentsByOperator) {
      if (assignments.length === 0) continue;

      assignments.sort((a, b) => a.machineStart - b.machineStart);

      // Pass 2A: Find the latest pre-lunch task end, capped at 13:00
      let tempCursor = DAY_START;
      let opLunchStart = targetLunchStart;
      const preLunchAssignments: OperatorAssignment[] = [];
      const postLunchAssignments: OperatorAssignment[] = [];

      for (const a of assignments) {
        const taskStart = Math.max(tempCursor, a.machineStart);
        const taskEnd = taskStart + a.task.operatorDuration;

        if (taskEnd > LUNCH_LATEST_START && taskStart < LUNCH_LATEST_START) {
          // Would push lunch past 13:00 — defer to after lunch
          postLunchAssignments.push(a);
        } else if (taskStart >= LUNCH_LATEST_START) {
          postLunchAssignments.push(a);
        } else {
          preLunchAssignments.push(a);
          if (taskEnd > opLunchStart) opLunchStart = taskEnd;
          tempCursor = taskEnd;
        }
      }

      opLunchStart = Math.min(opLunchStart, LUNCH_LATEST_START);
      opLunchStart = Math.max(opLunchStart, targetLunchStart);
      const opLunchEnd = opLunchStart + 60;
      operatorLunchBreaks[name] = { start: opLunchStart, end: opLunchEnd };

      // Pass 2B: Re-schedule all tasks with individual lunch break
      let cursor = DAY_START;
      for (const a of preLunchAssignments) {
        cursor = Math.max(cursor, a.machineStart);
        cursor = normalizeCursor(cursor, opLunchStart, opLunchEnd);
        const scheduled = createSegments(cursor, a.task.operatorDuration, opLunchStart, opLunchEnd);

        operatorRowsMap.get(name)?.tasks.push({
          ...a.task,
          operatorName: name,
          start: scheduled.start,
          end: scheduled.end,
          segments: scheduled.segments,
          machineTaskId: a.machineTaskId,
          machineLabel: a.machineLabel,
          showSimultaneousBadge: a.showSimultaneousBadge,
        });
        cursor = scheduled.end;
      }

      cursor = Math.max(cursor, opLunchEnd);
      for (const a of postLunchAssignments) {
        cursor = Math.max(cursor, opLunchEnd, a.machineStart);
        const scheduled = createSegments(cursor, a.task.operatorDuration, opLunchStart, opLunchEnd);

        operatorRowsMap.get(name)?.tasks.push({
          ...a.task,
          operatorName: name,
          start: scheduled.start,
          end: scheduled.end,
          segments: scheduled.segments,
          machineTaskId: a.machineTaskId,
          machineLabel: a.machineLabel,
          showSimultaneousBadge: a.showSimultaneousBadge,
        });
        cursor = scheduled.end;
      }
    }
  }

  const operatorRows = Array.from(operatorRowsMap.values());

  // ── Compute per-machine lunch breaks ──
  const machineLunchBreaks: Record<string, OperatorLunchBreak> = {};
  if (allOperatorNames.length > 0 && Object.keys(operatorLunchBreaks).length > 0) {
    const allBreaks = Object.values(operatorLunchBreaks);
    const overlapStart = Math.max(...allBreaks.map((b) => b.start));
    const overlapEnd = Math.min(...allBreaks.map((b) => b.end));
    if (overlapStart < overlapEnd) {
      for (const row of machineRows) {
        machineLunchBreaks[row.label] = { start: overlapStart, end: overlapEnd };
      }
    }
  }

  const latestEnd = Math.max(
    DAY_END,
    ...machineTasks.map((t) => t.end),
    ...operatorRows.flatMap((r) => r.tasks.map((t) => t.end))
  );

  const hasOvertime = overflowTasks.length > 0 || unscheduledTasks.length > 0;

  return {
    machineRows,
    operatorRows,
    axisEnd: roundUpToHalfHour(latestEnd),
    usesEmergencyEquipment: emergencyEquipmentNames.size > 0,
    emergencyEquipmentNames: Array.from(emergencyEquipmentNames).sort((a, b) => a.localeCompare(b)),
    overflowTasks,
    unscheduledTasks,
    hasOvertime,
    operatorLunchBreaks,
    machineLunchBreaks,
  };
}

// ── Public API ──────────────────────────────────────────

export function buildDailyGanttSchedule({
  dateStr,
  production,
  categories,
  equipment,
  operatorsForDate,
  tempOperators,
}: BuildScheduleInput): DailyGanttSchedule {
  const selectedDate = normalizeDateKey(dateStr);
  const equipmentIndex = new Map(equipment.map((item, idx) => [item.id, idx]));
  const categoryMap = new Map(categories.map((item) => [item.id, item]));
  const equipmentMap = new Map(equipment.map((item) => [item.id, item]));

  const tasks: PlanningTask[] = [];
  production
    .filter((entry) => normalizeDateKey(entry.date) === selectedDate)
    .forEach((entry) => {
      const cat = categoryMap.get(entry.categoriaId);
      const machine = cat ? equipmentMap.get(cat.equipamentoId) : undefined;
      if (!cat || !machine) return;

      for (let i = 0; i < entry.quantidade; i++) {
        const isFirst = i === 0;
        const tHomem = isFirst ? (cat.tempoCicloHomem1 ?? cat.tempoCicloHomem) : cat.tempoCicloHomem;
        const tMaqPrimary = isFirst ? (cat.tempoCicloMaquina1 ?? cat.tempoCicloMaquina) : cat.tempoCicloMaquina;
        const primaryColorIndex = (equipmentIndex.get(machine.id) ?? 0) % 6;

        const bookings: MachineBooking[] = [];
        if (tMaqPrimary > 0) {
          bookings.push({
            equipmentId: machine.id,
            equipmentName: machine.nome,
            duration: tMaqPrimary,
            simultaneous: true,
            colorIndex: primaryColorIndex,
          });
        }

        if (cat.equipamentos && cat.equipamentos.length > 0) {
          for (const extra of cat.equipamentos) {
            const extraEq = equipmentMap.get(extra.equipamentoId);
            if (!extraEq) continue;
            const extraDuration = isFirst
              ? (extra.tempoCicloMaquina1 ?? extra.tempoCicloMaquina)
              : extra.tempoCicloMaquina;
            if (extraDuration <= 0) continue;
            bookings.push({
              equipmentId: extraEq.id,
              equipmentName: extraEq.nome,
              duration: extraDuration,
              simultaneous: extra.simultaneo,
              colorIndex: extra.simultaneo ? primaryColorIndex : (equipmentIndex.get(extraEq.id) ?? 0) % 6,
              isSequentialPhase: !extra.simultaneo,
            });
          }
        }

        const simultaneousCount = bookings.filter((b) => b.simultaneous).length;
        bookings.forEach((b) => {
          if (b.simultaneous) b.showSimultaneousBadge = simultaneousCount > 1;
        });

        const seqBookings = bookings.filter((b) => !b.simultaneous);
        const simBookings = bookings.filter((b) => b.simultaneous);
        const seqTotal = seqBookings.reduce((s, b) => s + b.duration, 0);
        const simMax = simBookings.length > 0 ? Math.max(...simBookings.map((b) => b.duration)) : 0;
        const totalMachineDuration = seqTotal + simMax;

        tasks.push({
          id: `${entry.id}-d${i}`,
          artigo: entry.artigo,
          doseLabel: entry.quantidade > 1 ? `${entry.artigo} (${i + 1}/${entry.quantidade})` : entry.artigo,
          equipmentId: machine.id,
          equipmentName: machine.nome,
          categoryName: cat.nome,
          machineDuration: totalMachineDuration > 0 ? totalMachineDuration : tMaqPrimary,
          operatorDuration: tHomem,
          colorIndex: primaryColorIndex,
          isEmergency: false,
          machineBookings: bookings.length > 0 ? bookings : [{
            equipmentId: machine.id,
            equipmentName: machine.nome,
            duration: tMaqPrimary,
            simultaneous: true,
            colorIndex: primaryColorIndex,
          }],
        });
      }
    });

  if (tasks.length === 0) {
    return {
      tasks: [], machineRows: [], operatorRows: [], axisEnd: DAY_END,
      usesEmergencyEquipment: false, emergencyEquipmentNames: [], overflowTasks: [],
      unscheduledTasks: [], lunchStart: 13 * 60, lunchEnd: 14 * 60, hasOvertime: false,
      operatorLunchBreaks: {}, machineLunchBreaks: {},
    };
  }

  const operatorNames = operatorsForDate
    .filter((e) => WORKING_CODES.includes(e.code) && !e.absent)
    .map((e) => e.operator.nome);

  const tempOpsForDate = tempOperators.filter((t) => t.date === selectedDate);
  const allOpNames = [...operatorNames, ...tempOpsForDate.map((t) => t.nome)];

  // Try 3 lunch target positions
  const lunchOptions: [number, number][] = [
    [12 * 60, 13 * 60],
    [12 * 60 + 30, 13 * 60 + 30],
    [13 * 60, 14 * 60],
  ];

  let bestResult: Omit<DailyGanttSchedule, 'tasks' | 'lunchStart' | 'lunchEnd'> | null = null;
  let bestScore = Infinity;
  let bestLunch: [number, number] = [13 * 60, 14 * 60];

  for (const [ls, le] of lunchOptions) {
    const result = buildWithLunch(tasks, equipment, equipmentMap, allOpNames, ls, le);
    const score = result.overflowTasks.length * 10 + result.unscheduledTasks.reduce((s, u) => s + u.dosesRemaining, 0) * 10;
    if (score < bestScore) {
      bestScore = score;
      bestResult = result;
      bestLunch = [ls, le];
    }
  }

  const best = bestResult!;

  return {
    tasks,
    ...best,
    lunchStart: bestLunch[0],
    lunchEnd: bestLunch[1],
  };
}
