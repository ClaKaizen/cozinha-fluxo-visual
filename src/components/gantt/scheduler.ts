import {
  Category,
  Equipment,
  Operator,
  ProductionEntry,
  SequencingRule,
  ShiftCode,
  TempOperator,
  WORKING_CODES,
} from "@/store/types";

export const DAY_START = 7 * 60;           // 420 — 07:00
export const DAY_END = 16 * 60;            // 960 — 16:00 (axis extent for overflow visibility)
export const OPERATOR_HARD_STOP = 15 * 60 + 30;  // 930 — 15:30
export const MACHINE_TARGET_STOP = 15 * 60 + 40; // 940 — 15:40
export const AVAILABLE_MACHINE_MINUTES = 480;
const LUNCH_WINDOW_START = 12 * 60;  // 720
const LUNCH_LATEST_START = 13 * 60;  // 780
const LUNCH_DURATION = 60;
const OPERATOR_PRODUCTIVE_MINUTES = 450; // 07:00–15:30 minus 60min lunch

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
  isFirstPhase?: boolean;
  colorIndex: number;
  showSimultaneousBadge?: boolean;
  isSequentialPhase?: boolean;
  isDedicated?: boolean;
  roleLabel?: string;
}

export interface PlanningTask {
  id: string;
  artigo: string;
  doseLabel: string;
  equipmentId: string;
  equipmentName: string;
  categoryName: string;
  categoryId: string;
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
  isFirstPhase: boolean;
  isLunchSafe: boolean;
  isDedicated: boolean;
  roleLabel: string;
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
  staffingWarning?: string;
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
  sequencingRules?: SequencingRule[];
  lunchSafeCategories?: string[];
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

// ── Operator state tracker ──────────────────────────────

interface OperatorState {
  name: string;
  cursor: number;        // next available time
  totalWorked: number;   // total productive minutes
  hadLunch: boolean;
  lunchStart: number;
  lunchEnd: number;
}

function operatorIsFreeAt(op: OperatorState, start: number, duration: number): boolean {
  if (op.totalWorked + duration > OPERATOR_PRODUCTIVE_MINUTES) return false;

  let effectiveStart = Math.max(op.cursor, start);

  // If we haven't had lunch and the task would overlap or push past lunch constraints
  if (!op.hadLunch) {
    // If we're in the lunch window and haven't eaten, we must eat first
    if (effectiveStart >= LUNCH_WINDOW_START && effectiveStart < op.lunchEnd) {
      // Can we eat now (before LUNCH_LATEST_START)?
      const lunchStart = Math.max(effectiveStart, LUNCH_WINDOW_START);
      if (lunchStart > LUNCH_LATEST_START) return false; // too late for lunch
      effectiveStart = lunchStart + LUNCH_DURATION;
    }
    // If the task would end past LUNCH_LATEST_START and we haven't eaten
    if (effectiveStart + duration > LUNCH_LATEST_START && effectiveStart < LUNCH_WINDOW_START) {
      // Task runs past 13:00 but starts before 12:00 - that's fine, lunch after
      // But the task end must not prevent lunch by 13:00
      // Actually: if task ends after LUNCH_LATEST_START, operator must eat first
      // Only if task would push lunch start past 13:00
    }
  } else {
    // Already had lunch - skip lunch window
    if (effectiveStart >= op.lunchStart && effectiveStart < op.lunchEnd) {
      effectiveStart = op.lunchEnd;
    }
  }

  if (effectiveStart + duration > OPERATOR_HARD_STOP) return false;

  return true;
}

/**
 * Get the earliest time an operator can start a task of given duration.
 * Returns the start time or -1 if impossible.
 */
function getOperatorEarliestStart(op: OperatorState, minStart: number, duration: number): number {
  if (op.totalWorked + duration > OPERATOR_PRODUCTIVE_MINUTES) return -1;

  let effectiveStart = Math.max(op.cursor, minStart);

  if (!op.hadLunch) {
    // Before lunch window: check if task would push lunch past 13:00
    if (effectiveStart < LUNCH_WINDOW_START) {
      const taskEnd = effectiveStart + duration;
      if (taskEnd > LUNCH_LATEST_START) {
        // Task would end after 13:00 - must eat lunch first at latest 13:00
        // But lunch window hasn't started, so push task to after lunch
        // Schedule lunch at LUNCH_WINDOW_START (earliest)
        effectiveStart = LUNCH_WINDOW_START + LUNCH_DURATION;
      } else if (taskEnd > LUNCH_WINDOW_START) {
        // Task ends between 12:00 and 13:00 - OK, lunch after task
        // Fine as-is
      }
      // else task ends before 12:00 - fine
    } else if (effectiveStart >= LUNCH_WINDOW_START && effectiveStart < LUNCH_LATEST_START + LUNCH_DURATION) {
      // We're in the lunch window - must eat first
      const lunchStart = Math.min(Math.max(effectiveStart, LUNCH_WINDOW_START), LUNCH_LATEST_START);
      effectiveStart = lunchStart + LUNCH_DURATION;
    }
  } else {
    // Already had lunch - skip lunch window
    if (effectiveStart >= op.lunchStart && effectiveStart < op.lunchEnd) {
      effectiveStart = op.lunchEnd;
    }
  }

  if (effectiveStart + duration > OPERATOR_HARD_STOP) return -1;
  return effectiveStart;
}

/**
 * Commit an operator to a task: update cursor, worked time, and handle lunch.
 */
function commitOperator(op: OperatorState, taskStart: number, duration: number): { opStart: number; opEnd: number } {
  let effectiveStart = Math.max(op.cursor, taskStart);

  if (!op.hadLunch) {
    if (effectiveStart < LUNCH_WINDOW_START) {
      const taskEnd = effectiveStart + duration;
      if (taskEnd > LUNCH_LATEST_START) {
        // Must eat lunch first
        op.lunchStart = LUNCH_WINDOW_START;
        op.lunchEnd = LUNCH_WINDOW_START + LUNCH_DURATION;
        op.hadLunch = true;
        effectiveStart = op.lunchEnd;
      }
      // If taskEnd is between 12:00 and 13:00, task runs first, lunch after
    } else if (effectiveStart >= LUNCH_WINDOW_START) {
      // In lunch window - eat first
      const lunchStart = Math.min(Math.max(effectiveStart, LUNCH_WINDOW_START), LUNCH_LATEST_START);
      op.lunchStart = lunchStart;
      op.lunchEnd = lunchStart + LUNCH_DURATION;
      op.hadLunch = true;
      effectiveStart = op.lunchEnd;
    }
  } else {
    if (effectiveStart >= op.lunchStart && effectiveStart < op.lunchEnd) {
      effectiveStart = op.lunchEnd;
    }
  }

  const opEnd = effectiveStart + duration;
  op.cursor = opEnd;
  op.totalWorked += duration;

  return { opStart: effectiveStart, opEnd };
}

/**
 * Force lunch for operator if they haven't had it yet and are past LUNCH_WINDOW_START.
 */
function ensureLunch(op: OperatorState) {
  if (!op.hadLunch && op.cursor >= LUNCH_WINDOW_START) {
    const lunchStart = Math.min(Math.max(op.cursor, LUNCH_WINDOW_START), LUNCH_LATEST_START);
    op.lunchStart = lunchStart;
    op.lunchEnd = lunchStart + LUNCH_DURATION;
    op.hadLunch = true;
    if (op.cursor < op.lunchEnd) op.cursor = op.lunchEnd;
  }
}

// ── Machine slot tracker ──────────────────────────────

interface MachineSlotTracker {
  /** Per equipment ID: array of next-available times, one per machine instance */
  slots: Map<string, number[]>;
  /** Dedicated machine reservations: key = `${categoryId}:${equipmentId}`, value = machineIdx */
  dedicatedSlots: Map<string, number>;
}

function createMachineTracker(equipment: Equipment[], allowEmergency: boolean): MachineSlotTracker {
  const slots = new Map<string, number[]>();
  equipment.forEach((eq) => {
    const count = allowEmergency ? eq.quantidade + eq.quantidadeEmergencia : eq.quantidade;
    slots.set(eq.id, Array.from({ length: count }, () => DAY_START));
  });
  return { slots, dedicatedSlots: new Map() };
}

/**
 * Find the earliest available machine slot for a set of bookings (one phase).
 * Returns assignments or null.
 */
function findEarliestMachineSlot(
  phaseBookings: MachineBooking[],
  minStart: number,
  tracker: MachineSlotTracker,
  equipmentMap: Map<string, Equipment>,
  allowEmergency: boolean,
  hardStop: number,
  categoryId?: string,
): { assignments: { booking: MachineBooking; machineIdx: number; start: number; end: number }[]; phaseStart: number } | null {
  // Group bookings by equipment
  const grouped = new Map<string, MachineBooking[]>();
  phaseBookings.forEach((b) => {
    const arr = grouped.get(b.equipmentId) ?? [];
    arr.push(b);
    grouped.set(b.equipmentId, arr);
  });

  // Collect all dedicated machine indices that are reserved by OTHER categories
  const reservedByOthers = new Set<string>(); // "eqId:machIdx"
  tracker.dedicatedSlots.forEach((machIdx, key) => {
    const [resCatId] = key.split(":");
    if (resCatId !== categoryId) {
      const eqId = key.split(":")[1];
      reservedByOthers.add(`${eqId}:${machIdx}`);
    }
  });

  // For each equipment group, find the N earliest-available slots
  let phaseStart = minStart;
  const slotPicks: { equipmentId: string; booking: MachineBooking; machineIdx: number }[] = [];

  for (const [eqId, bookings] of grouped) {
    const eq = equipmentMap.get(eqId);
    if (!eq) return null;
    const slots = tracker.slots.get(eqId);
    if (!slots) return null;
    const maxIdx = allowEmergency ? eq.quantidade + eq.quantidadeEmergencia : eq.quantidade;
    if (maxIdx < bookings.length) return null;

    for (let bi = 0; bi < bookings.length; bi++) {
      const booking = bookings[bi];

      // Check if this booking's category already has a dedicated slot reserved
      const dedicatedKey = `${categoryId}:${eqId}`;
      const existingDedicated = booking.isDedicated && categoryId ? tracker.dedicatedSlots.get(dedicatedKey) : undefined;

      if (existingDedicated !== undefined) {
        // Reuse the same dedicated machine
        const slotAvail = Math.max(slots[existingDedicated] ?? DAY_START, minStart);
        if (slotAvail > phaseStart) phaseStart = slotAvail;
        slotPicks.push({ equipmentId: eqId, booking, machineIdx: existingDedicated });
      } else {
        // Get indices sorted by availability (earliest-free first), excluding reserved-by-others
        const availableIndices = Array.from({ length: maxIdx }, (_, i) => i)
          .filter(i => !reservedByOthers.has(`${eqId}:${i}`))
          .sort((a, b) => (slots[a] ?? DAY_START) - (slots[b] ?? DAY_START));

        // Skip indices already picked
        const alreadyPicked = slotPicks.filter(p => p.equipmentId === eqId).map(p => p.machineIdx);
        const idx = availableIndices.find(i => !alreadyPicked.includes(i));
        if (idx === undefined) return null;

        const slotAvail = Math.max(slots[idx] ?? DAY_START, minStart);
        if (slotAvail > phaseStart) phaseStart = slotAvail;
        slotPicks.push({ equipmentId: eqId, booking, machineIdx: idx });
      }
    }
  }

  if (phaseStart >= hardStop) return null;

  const assignments = slotPicks.map((pick) => ({
    booking: pick.booking,
    machineIdx: pick.machineIdx,
    start: phaseStart,
    end: phaseStart + pick.booking.duration,
  }));

  return { assignments, phaseStart };
}

/**
 * Build sequential booking phases from a task's bookings.
 */
function buildBookingPhases(task: PlanningTask): MachineBooking[][] {
  // Phase 1: "1º" (isFirstPhase) equipment — run first, in parallel if multiple
  const firstPhase = task.machineBookings.filter((b) => b.isFirstPhase);
  // Phase 2: primary + simultaneous equipment — run together after "1º" completes
  const simultaneousPhase = task.machineBookings.filter((b) => b.simultaneous && !b.isFirstPhase);
  // Phase 3: remaining sequential (neither 1º nor simultaneous)
  const flexiblePhases = task.machineBookings.filter((b) => !b.simultaneous && !b.isFirstPhase).map((b) => [b]);

  const phases: MachineBooking[][] = [];
  if (firstPhase.length > 0) phases.push(firstPhase);
  if (simultaneousPhase.length > 0) phases.push(simultaneousPhase);
  phases.push(...flexiblePhases);
  return phases;
}

// ── Joint scheduling result ──────────────────────────────

interface JointAssignment {
  task: PlanningTask;
  machineAssignments: {
    booking: MachineBooking;
    machineIdx: number;
    start: number;
    end: number;
  }[];
  operatorName: string;
  operatorStart: number;
  operatorEnd: number;
}

// ── Main joint optimizer ──────────────────────────────────

function jointSchedule(
  tasks: PlanningTask[],
  equipment: Equipment[],
  equipmentMap: Map<string, Equipment>,
  operatorNames: string[],
  sequencingRules: SequencingRule[] = [],
  lunchSafeCategories: string[] = [],
): {
  assignments: JointAssignment[];
  overflowTasks: string[];
  unscheduledTasks: UnscheduledTask[];
  emergencyEquipmentNames: Set<string>;
  staffingWarning: string | null;
} {
  // ── Step 1: Feasibility check ──
  const totalTHomem = tasks.reduce((s, t) => s + t.operatorDuration, 0);
  const totalOpCapacity = operatorNames.length * OPERATOR_PRODUCTIVE_MINUTES;
  const staffingWarning = totalTHomem > totalOpCapacity
    ? `⚠️ Tempo homem necessário (${(totalTHomem / 60).toFixed(1)}h) excede capacidade dos operadores presentes (${(totalOpCapacity / 60).toFixed(1)}h)`
    : null;

  // ── Step 2: Sort by priority ──
  const equipContention = new Map<string, number>();
  tasks.forEach((t) => {
    for (const b of t.machineBookings) {
      equipContention.set(b.equipmentId, (equipContention.get(b.equipmentId) ?? 0) + b.duration);
    }
  });

  const sortedTasks = [...tasks].sort((a, b) => {
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

    const aCompound = a.machineBookings.some((bk) => !bk.simultaneous) ? 1 : 0;
    const bCompound = b.machineBookings.some((bk) => !bk.simultaneous) ? 1 : 0;
    if (bCompound !== aCompound) return bCompound - aCompound;

    return b.machineDuration - a.machineDuration;
  });

  // ── Build sequencing dependency graph ──
  const mustBeAfter = new Map<string, Set<string>>();
  for (const rule of sequencingRules) {
    if (rule.relation === 'Depois') {
      if (!mustBeAfter.has(rule.categoryA)) mustBeAfter.set(rule.categoryA, new Set());
      mustBeAfter.get(rule.categoryA)!.add(rule.categoryB);
    } else {
      if (!mustBeAfter.has(rule.categoryB)) mustBeAfter.set(rule.categoryB, new Set());
      mustBeAfter.get(rule.categoryB)!.add(rule.categoryA);
    }
  }

  // Detect circular deps
  const circularCategories = new Set<string>();
  {
    const visited = new Set<string>();
    const stack = new Set<string>();
    function detectCycle(node: string): boolean {
      if (stack.has(node)) { circularCategories.add(node); return true; }
      if (visited.has(node)) return false;
      visited.add(node); stack.add(node);
      for (const dep of mustBeAfter.get(node) ?? []) {
        if (detectCycle(dep)) { circularCategories.add(node); return true; }
      }
      stack.delete(node);
      return false;
    }
    for (const catId of mustBeAfter.keys()) detectCycle(catId);
  }

  // ── Two-pass topological scheduling ──
  const scheduledCategoryEndTimes = new Map<string, number>();

  function getMinStartForTask(task: PlanningTask): number {
    const deps = mustBeAfter.get(task.categoryId);
    if (!deps) return DAY_START;
    let minStart = DAY_START;
    for (const depCatId of deps) {
      if (circularCategories.has(depCatId)) continue;
      const endTime = scheduledCategoryEndTimes.get(depCatId);
      if (endTime !== undefined) {
        minStart = Math.max(minStart, endTime);
      }
    }
    return minStart;
  }

  function depsScheduled(task: PlanningTask): boolean {
    const deps = mustBeAfter.get(task.categoryId);
    if (!deps) return true;
    for (const depCatId of deps) {
      if (circularCategories.has(depCatId)) continue;
      if (!scheduledCategoryEndTimes.has(depCatId)) return false;
    }
    return true;
  }

  const pass1Tasks = sortedTasks.filter(t => !circularCategories.has(t.categoryId) && depsScheduled(t));
  const deferredTasks = sortedTasks.filter(t => !circularCategories.has(t.categoryId) && !depsScheduled(t));
  const circularTasks = sortedTasks.filter(t => circularCategories.has(t.categoryId));

  // ── Step 3: Joint scheduling ──
  const operators: OperatorState[] = operatorNames.map((name) => ({
    name,
    cursor: DAY_START,
    totalWorked: 0,
    hadLunch: false,
    lunchStart: LUNCH_LATEST_START,
    lunchEnd: LUNCH_LATEST_START + LUNCH_DURATION,
  }));

  const assignments: JointAssignment[] = [];
  const overflowTasks: string[] = [];
  const unscheduledTasks: UnscheduledTask[] = [];
  const emergencyEquipmentNames = new Set<string>();

  // Track which operators are assigned to each equipment type for Op./Grupo enforcement
  // equipmentId → list of operator names assigned to this group
  const equipmentGroupOperators = new Map<string, string[]>();

  function getPreferredOperator(equipmentId: string): string | undefined {
    const eq = equipmentMap.get(equipmentId);
    const opsPerGroup = eq?.operatorsPerGroup ?? 1;
    const assigned = equipmentGroupOperators.get(equipmentId) ?? [];
    // If we already have enough operators for this group, reuse them (round-robin)
    if (assigned.length >= opsPerGroup) {
      return assigned[0]; // prefer first assigned
    }
    return undefined;
  }

  function registerGroupOperator(equipmentId: string, operatorName: string) {
    if (!equipmentGroupOperators.has(equipmentId)) {
      equipmentGroupOperators.set(equipmentId, []);
    }
    const ops = equipmentGroupOperators.get(equipmentId)!;
    if (!ops.includes(operatorName)) {
      const eq = equipmentMap.get(equipmentId);
      const opsPerGroup = eq?.operatorsPerGroup ?? 1;
      if (ops.length < opsPerGroup) {
        ops.push(operatorName);
      }
    }
  }

  function tryScheduleAll(allowEmergency: boolean, tasksToSchedule: PlanningTask[]): PlanningTask[] {
    const tracker = createMachineTracker(equipment, allowEmergency);

    // Restore machine slots from already-committed assignments
    for (const a of assignments) {
      for (const ma of a.machineAssignments) {
        const slots = tracker.slots.get(ma.booking.equipmentId);
        if (slots && slots[ma.machineIdx] < ma.end) {
          slots[ma.machineIdx] = ma.end;
        }
      }
    }

    const remaining: PlanningTask[] = [];

    for (const task of tasksToSchedule) {
      const depMinStart = getMinStartForTask(task);

      const primaryEqId = task.equipmentId;
      // Get preferred operator for Op./Grupo enforcement
      const preferredOp = getPreferredOperator(primaryEqId);

      const result = tryJointSlot(task, tracker, operators, equipmentMap, allowEmergency, equipment, depMinStart, preferredOp, lunchSafeCategories);
      if (result) {
        // Commit machine slots
        for (const ma of result.machineAssignments) {
          const slots = tracker.slots.get(ma.booking.equipmentId);
          if (slots) slots[ma.machineIdx] = ma.end;
        }

        // Commit operator: each dose gets its own small T.Homem block
        if (result.operatorName && task.operatorDuration > 0) {
          const op = operators.find((o) => o.name === result.operatorName)!;
          if (op) commitOperator(op, result.operatorStart, task.operatorDuration);
          // Register for Op./Grupo enforcement
          registerGroupOperator(primaryEqId, result.operatorName);
        }

        // Track emergency
        for (const ma of result.machineAssignments) {
          const eqItem = equipmentMap.get(ma.booking.equipmentId);
          if (eqItem && ma.machineIdx >= eqItem.quantidade) {
            emergencyEquipmentNames.add(eqItem.nome);
          }
        }

        // Update category end times
        const maxMachineEnd = Math.max(...result.machineAssignments.map(ma => ma.end));
        const prevEnd = scheduledCategoryEndTimes.get(task.categoryId) ?? 0;
        scheduledCategoryEndTimes.set(task.categoryId, Math.max(prevEnd, maxMachineEnd));

        assignments.push(result);
      } else {
        remaining.push(task);
      }
    }

    return remaining;
  }

  // Pass 1: Schedule tasks with no unmet dependencies (normal machines)
  let remaining = tryScheduleAll(false, pass1Tasks);

  // Pass 2: Schedule deferred tasks (dependencies now met)
  if (deferredTasks.length > 0) {
    remaining = [...remaining, ...tryScheduleAll(false, deferredTasks)];
  }

  // Schedule circular tasks normally
  if (circularTasks.length > 0) {
    remaining = [...remaining, ...tryScheduleAll(false, circularTasks)];
  }

  // Phase with emergency machines for remaining tasks
  if (remaining.length > 0) {
    const hasEmergency = equipment.some((eq) => eq.quantidadeEmergencia > 0);
    if (hasEmergency) {
      const opsFree = operators.some((op) => op.totalWorked < OPERATOR_PRODUCTIVE_MINUTES - 10);
      if (opsFree) {
        remaining = tryScheduleAll(true, remaining);
      }
    }
  }

  // Mark remaining as unscheduled
  for (const task of remaining) {
    const existing = unscheduledTasks.find((u) => u.artigo === task.artigo);
    if (existing) existing.dosesRemaining += 1;
    else unscheduledTasks.push({ artigo: task.artigo, dosesRemaining: 1 });
    overflowTasks.push(task.doseLabel);
  }

  // ── Step 4: Force lunch for all operators who haven't had it ──
  for (const op of operators) {
    ensureLunch(op);
  }

  return { assignments, overflowTasks, unscheduledTasks, emergencyEquipmentNames, staffingWarning };
}

/**
 * Try to find a joint machine+operator slot for a single task.
 */
function tryJointSlot(
  task: PlanningTask,
  tracker: MachineSlotTracker,
  operators: OperatorState[],
  equipmentMap: Map<string, Equipment>,
  allowEmergency: boolean,
  equipment: Equipment[],
  minStartOverride: number = DAY_START,
  preferredOperator?: string,
  lunchSafeCategoryIds: string[] = [],
): JointAssignment | null {
  const isLunchSafe = lunchSafeCategoryIds.includes(task.categoryId);
  const phases = buildBookingPhases(task);
  if (phases.length === 0) return null;

  // We need to find a time where both machine(s) and an operator are free
  // Try incrementally advancing candidateTime
  let candidateTime = Math.max(DAY_START, minStartOverride);
  const MAX_ITERATIONS = 200;

  for (let iter = 0; iter < MAX_ITERATIONS && candidateTime < OPERATOR_HARD_STOP; iter++) {
    // Try to schedule all machine phases atomically starting at candidateTime
    const machineResult = tryAllPhases(phases, candidateTime, tracker, equipmentMap, allowEmergency, task.categoryId);
    if (!machineResult) {
      // No machine slot available at all
      candidateTime += 5;
      continue;
    }

    const machineStart = machineResult.overallStart;
    const machineEnd = Math.max(...machineResult.allAssignments.map(a => a.end));

    // Check if machine start is past hard stop
    if (machineStart >= MACHINE_TARGET_STOP) break;

    // Lunch constraint: non-lunch-safe tasks cannot have machines running during lunch without operator
    if (!isLunchSafe && task.operatorDuration > 0) {
      // Check if any machine block spans into the lunch window
      const anyOverlapsLunch = machineResult.allAssignments.some(a => 
        a.start < LUNCH_LATEST_START + LUNCH_DURATION && a.end > LUNCH_WINDOW_START
      );
      if (anyOverlapsLunch) {
        // For non-lunch-safe: operator must load before lunch, machine must finish before lunch
        // OR the whole task must start after lunch
        const operatorEndIfStartedNow = machineStart + task.operatorDuration;
        // If operator loading would run into lunch window, push to after lunch
        if (operatorEndIfStartedNow > LUNCH_WINDOW_START && machineStart < LUNCH_WINDOW_START) {
          // Task loading crosses into lunch — push to after lunch
          candidateTime = LUNCH_LATEST_START + LUNCH_DURATION;
          continue;
        }
        // If the machine would still be running during lunch and needs operator presence, push after lunch
        if (machineStart < LUNCH_WINDOW_START && machineEnd > LUNCH_WINDOW_START) {
          // Machine spans lunch — not allowed for non-lunch-safe unless machine finishes before lunch
          candidateTime = LUNCH_LATEST_START + LUNCH_DURATION;
          continue;
        }
      }
    }

    // Find operator: least-loaded who can start at machineStart for operatorDuration
    if (task.operatorDuration <= 0) {
      // No operator needed - commit machine only
      return {
        task,
        machineAssignments: machineResult.allAssignments,
        operatorName: "",
        operatorStart: machineStart,
        operatorEnd: machineStart,
      };
    }

    let bestOp: OperatorState | null = null;
    let bestOpStart = Infinity;
    let bestOpLoad = Infinity;

    // Try preferred operator first (for Op./Grupo enforcement)
    if (preferredOperator) {
      const prefOp = operators.find(o => o.name === preferredOperator);
      if (prefOp) {
        const opStart = getOperatorEarliestStart(prefOp, machineStart, task.operatorDuration);
        if (opStart >= 0 && opStart <= machineStart + 5) {
          bestOp = prefOp;
          bestOpStart = opStart;
          bestOpLoad = prefOp.totalWorked;
        }
      }
    }

    // If preferred didn't work, try all operators
    if (!bestOp) {
      for (const op of operators) {
        const opStart = getOperatorEarliestStart(op, machineStart, task.operatorDuration);
        if (opStart < 0) continue;

        if (opStart === machineStart || opStart <= machineStart + 5) {
          if (op.totalWorked < bestOpLoad || (op.totalWorked === bestOpLoad && opStart < bestOpStart)) {
            bestOp = op;
            bestOpStart = opStart;
            bestOpLoad = op.totalWorked;
          }
        }
      }
    }

    if (bestOp) {
      // Exact or near-exact alignment found
      const opStart = getOperatorEarliestStart(bestOp, machineStart, task.operatorDuration);
      return {
        task,
        machineAssignments: machineResult.allAssignments,
        operatorName: bestOp.name,
        operatorStart: opStart,
        operatorEnd: opStart + task.operatorDuration,
      };
    }

    // No operator available at machineStart - find earliest operator availability
    let nextOpAvail = Infinity;
    for (const op of operators) {
      const opStart = getOperatorEarliestStart(op, machineStart, task.operatorDuration);
      if (opStart >= 0 && opStart < nextOpAvail) {
        nextOpAvail = opStart;
      }
    }

    if (nextOpAvail === Infinity) {
      // No operator can ever do this task - unschedulable
      return null;
    }

    // Advance candidate to when an operator is actually available
    if (nextOpAvail > candidateTime) {
      candidateTime = nextOpAvail;
    } else {
      candidateTime += 5;
    }
  }

  return null;
}

/**
 * Try to schedule all phases of a task atomically on machines.
 */
function tryAllPhases(
  phases: MachineBooking[][],
  minStart: number,
  tracker: MachineSlotTracker,
  equipmentMap: Map<string, Equipment>,
  allowEmergency: boolean,
  categoryId?: string,
): { allAssignments: { booking: MachineBooking; machineIdx: number; start: number; end: number }[]; overallStart: number } | null {
  // Clone tracker for speculative scheduling
  const specSlots = new Map<string, number[]>();
  tracker.slots.forEach((slots, key) => specSlots.set(key, [...slots]));
  const specDedicated = new Map(tracker.dedicatedSlots);
  const specTracker: MachineSlotTracker = { slots: specSlots, dedicatedSlots: specDedicated };

  const allAssignments: { booking: MachineBooking; machineIdx: number; start: number; end: number }[] = [];
  let phaseCursor = minStart;
  let overallStart = Infinity;

  for (const phaseBookings of phases) {
    const result = findEarliestMachineSlot(phaseBookings, phaseCursor, specTracker, equipmentMap, allowEmergency, MACHINE_TARGET_STOP, categoryId);
    if (!result) {
      // Try with overflow allowed (past hard stop)
      const overflowResult = findEarliestMachineSlot(phaseBookings, phaseCursor, specTracker, equipmentMap, allowEmergency, Infinity, categoryId);
      if (!overflowResult) return null;
      // Mark as overflow but still return
      for (const a of overflowResult.assignments) {
        const slots = specTracker.slots.get(a.booking.equipmentId);
        if (slots) slots[a.machineIdx] = a.end;
      }
      allAssignments.push(...overflowResult.assignments);
      if (overflowResult.phaseStart < overallStart) overallStart = overflowResult.phaseStart;
      phaseCursor = Math.max(...overflowResult.assignments.map((a) => a.end));
      continue;
    }

    for (const a of result.assignments) {
      const slots = specTracker.slots.get(a.booking.equipmentId);
      if (slots) slots[a.machineIdx] = a.end;
    }
    allAssignments.push(...result.assignments);
    if (result.phaseStart < overallStart) overallStart = result.phaseStart;
    phaseCursor = Math.max(...result.assignments.map((a) => a.end));
  }

  if (overallStart === Infinity && allAssignments.length > 0) {
    overallStart = Math.min(...allAssignments.map((a) => a.start));
  }

  return { allAssignments, overallStart };
}

// ── Build Gantt structures from joint assignments ──────────

function buildGanttFromAssignments(
  assignments: JointAssignment[],
  equipment: Equipment[],
  equipmentMap: Map<string, Equipment>,
  operators: string[],
  operatorStates: OperatorState[],
  overflowTasks: string[],
  unscheduledTasks: UnscheduledTask[],
  emergencyEquipmentNames: Set<string>,
  staffingWarning: string | null,
  lunchSafeCategories: string[] = [],
): Omit<DailyGanttSchedule, 'tasks' | 'lunchStart' | 'lunchEnd'> {
  const machineRowsMap = new Map<string, GanttRow<MachineTask>>();
  const operatorRowsMap = new Map<string, GanttRow<OperatorTask>>(
    operators.map((name) => [name, { label: name, tasks: [] }])
  );

  // Ensure all normal equipment rows exist
  equipment.forEach((eq) => {
    for (let i = 0; i < eq.quantidade; i++) {
      const label = `${eq.nome} ${i + 1}`;
      machineRowsMap.set(label, { label, tasks: [] });
    }
  });

  for (const assignment of assignments) {
    const { task, machineAssignments, operatorName, operatorStart, operatorEnd } = assignment;

    // Create machine tasks
    const machineTasksForThisAssignment: MachineTask[] = [];
    for (const ma of machineAssignments) {
      const eq = equipmentMap.get(ma.booking.equipmentId);
      if (!eq) continue;

      const isEmergencyMachine = ma.machineIdx >= eq.quantidade;
      const label = isEmergencyMachine
        ? `${ma.booking.equipmentName} ${ma.machineIdx + 1} ⚠️`
        : `${ma.booking.equipmentName} ${ma.machineIdx + 1}`;

      const isOverflow = ma.start >= MACHINE_TARGET_STOP;
      const segments: TimelineSegment[] = [{
        start: ma.start,
        end: ma.end,
        overflow: isOverflow,
      }];

      const mt: MachineTask = {
        ...task,
        equipmentId: ma.booking.equipmentId,
        equipmentName: ma.booking.equipmentName,
        colorIndex: ma.booking.colorIndex,
        machineIndex: ma.machineIdx,
        machineLabel: label,
        start: ma.start,
        end: ma.end,
        segments,
        isEmergencyMachine,
        showSimultaneousBadge: Boolean(ma.booking.showSimultaneousBadge),
        isSequentialPhase: Boolean(ma.booking.isSequentialPhase),
        isFirstPhase: Boolean(ma.booking.isFirstPhase),
        isLunchSafe: lunchSafeCategories.includes(task.categoryId),
        isDedicated: Boolean(ma.booking.isDedicated),
        roleLabel: ma.booking.roleLabel ?? "",
      };

      machineTasksForThisAssignment.push(mt);

      if (!machineRowsMap.has(label)) {
        machineRowsMap.set(label, { label, tasks: [] });
      }
      machineRowsMap.get(label)!.tasks.push(mt);
    }

    // Create per-dose operator task — each dose gets its own small T.Homem block
    if (operatorName && task.operatorDuration > 0 && operatorStart < operatorEnd) {
      const opState = operatorStates.find((o) => o.name === operatorName);
      const opLunchStart = opState?.lunchStart ?? LUNCH_LATEST_START;
      const opLunchEnd = opState?.lunchEnd ?? LUNCH_LATEST_START + LUNCH_DURATION;

      // Build segments for this dose's T.Homem only
      const opSegments = buildOperatorSegments(operatorStart, task.operatorDuration, opLunchStart, opLunchEnd);

      const machineLabel = machineTasksForThisAssignment.map((mt) => mt.machineLabel).join(" + ");

      const ot: OperatorTask = {
        ...task,
        operatorName,
        start: opSegments.start,
        end: opSegments.end,
        segments: opSegments.segments,
        machineTaskId: machineTasksForThisAssignment[0]?.id ?? task.id,
        machineLabel,
        showSimultaneousBadge: machineTasksForThisAssignment.some((mt) => mt.showSimultaneousBadge),
      };

      operatorRowsMap.get(operatorName)?.tasks.push(ot);
    }
  }

  // Sort and filter machine rows
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

  const operatorRows = Array.from(operatorRowsMap.values());

  // Per-operator lunch breaks
  const operatorLunchBreaks: Record<string, OperatorLunchBreak> = {};
  for (const op of operatorStates) {
    operatorLunchBreaks[op.name] = { start: op.lunchStart, end: op.lunchEnd };
  }

  // Machine lunch breaks: overlap of all operators' lunches
  const machineLunchBreaks: Record<string, OperatorLunchBreak> = {};
  if (operatorStates.length > 0) {
    const allBreaks = operatorStates.map((op) => ({ start: op.lunchStart, end: op.lunchEnd }));
    const overlapStart = Math.max(...allBreaks.map((b) => b.start));
    const overlapEnd = Math.min(...allBreaks.map((b) => b.end));
    if (overlapStart < overlapEnd) {
      for (const row of machineRows) {
        machineLunchBreaks[row.label] = { start: overlapStart, end: overlapEnd };
      }
    }
  }

  const allMachineTasks = machineRows.flatMap((r) => r.tasks);
  const latestEnd = Math.max(
    DAY_END,
    ...allMachineTasks.map((t) => t.end),
    ...operatorRows.flatMap((r) => r.tasks.map((t) => t.end))
  );

  const hasOvertime = operatorRows.some((row) =>
    row.tasks.some((t) => t.end > OPERATOR_HARD_STOP)
  ) || overflowTasks.length > 0 || unscheduledTasks.length > 0;

  return {
    machineRows,
    operatorRows,
    axisEnd: roundUpToHalfHour(latestEnd),
    usesEmergencyEquipment: emergencyEquipmentNames.size > 0,
    emergencyEquipmentNames: Array.from(emergencyEquipmentNames).sort(),
    overflowTasks,
    unscheduledTasks,
    hasOvertime,
    operatorLunchBreaks,
    machineLunchBreaks,
    staffingWarning,
  };
}

function buildOperatorSegments(start: number, duration: number, lunchStart: number, lunchEnd: number): { start: number; end: number; segments: TimelineSegment[] } {
  const segments: TimelineSegment[] = [];
  let cursor = start;
  let remaining = duration;

  while (remaining > 0) {
    // Skip lunch
    if (cursor >= lunchStart && cursor < lunchEnd) {
      cursor = lunchEnd;
    }

    let nextBoundary = cursor + remaining;
    // Don't cross into lunch
    if (cursor < lunchStart && nextBoundary > lunchStart) {
      nextBoundary = lunchStart;
    }

    const isOverflow = cursor >= OPERATOR_HARD_STOP;
    const segEnd = isOverflow ? cursor + remaining : nextBoundary;
    segments.push({ start: cursor, end: segEnd, overflow: isOverflow });

    if (isOverflow) break;

    remaining -= (nextBoundary - cursor);
    cursor = nextBoundary;
  }

  const end = segments.length > 0 ? segments[segments.length - 1].end : start;
  return { start, end, segments };
}

// ── Validation ──────────────────────────────────────────

function validateSchedule(assignments: JointAssignment[]) {
  for (const a of assignments) {
    if (a.task.operatorDuration > 0 && !a.operatorName) {
      console.warn(`[Scheduler] Machine task ${a.task.doseLabel} has no operator assigned`);
    }
    if (a.operatorEnd > OPERATOR_HARD_STOP) {
      console.warn(`[Scheduler] Operator ${a.operatorName} ends at ${formatClock(a.operatorEnd)} (past 15:30) for ${a.task.doseLabel}`);
    }
    for (const ma of a.machineAssignments) {
      if (ma.start >= MACHINE_TARGET_STOP) {
        console.warn(`[Scheduler] Machine block for ${a.task.doseLabel} starts at ${formatClock(ma.start)} (past 15:40)`);
      }
    }
  }
}

// ── Public API ──────────────────────────────────────────

export function buildDailyGanttSchedule({
  dateStr,
  production,
  categories,
  equipment,
  operatorsForDate,
  tempOperators,
  sequencingRules,
  lunchSafeCategories,
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
            const isFirstPhase = extra.isFirst ?? false;
            bookings.push({
              equipmentId: extraEq.id,
              equipmentName: extraEq.nome,
              duration: extraDuration,
              simultaneous: extra.simultaneo && !isFirstPhase,
              isFirstPhase,
              colorIndex: (extra.simultaneo && !isFirstPhase) ? primaryColorIndex : (equipmentIndex.get(extraEq.id) ?? 0) % 6,
              isSequentialPhase: !extra.simultaneo && !isFirstPhase,
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
          categoryId: cat.id,
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
      unscheduledTasks: [], lunchStart: LUNCH_LATEST_START, lunchEnd: LUNCH_LATEST_START + LUNCH_DURATION,
      hasOvertime: false, operatorLunchBreaks: {}, machineLunchBreaks: {},
    };
  }

  const operatorNames = operatorsForDate
    .filter((e) => WORKING_CODES.includes(e.code) && !e.absent)
    .map((e) => e.operator.nome);

  const tempOpsForDate = tempOperators.filter((t) => t.date === selectedDate);
  const allOpNames = [...operatorNames, ...tempOpsForDate.map((t) => t.nome)];

  // Run joint optimizer
  const result = jointSchedule(tasks, equipment, equipmentMap, allOpNames, sequencingRules ?? [], lunchSafeCategories ?? []);

  // Validate
  validateSchedule(result.assignments);

  // Build operator states for Gantt
  const operatorStates: OperatorState[] = allOpNames.map((name) => ({
    name,
    cursor: DAY_START,
    totalWorked: 0,
    hadLunch: false,
    lunchStart: LUNCH_LATEST_START,
    lunchEnd: LUNCH_LATEST_START + LUNCH_DURATION,
  }));

  // Replay assignments to compute operator states — each dose gets its own small T.Homem commit
  const sortedAssignments = [...result.assignments].sort((a, b) => a.operatorStart - b.operatorStart);
  for (const a of sortedAssignments) {
    if (!a.operatorName || a.operatorStart >= a.operatorEnd) continue;
    const op = operatorStates.find((o) => o.name === a.operatorName);
    if (op) {
      commitOperator(op, a.operatorStart, a.task.operatorDuration);
    }
  }
  for (const op of operatorStates) {
    ensureLunch(op);
  }

  const gantt = buildGanttFromAssignments(
    result.assignments,
    equipment,
    equipmentMap,
    allOpNames,
    operatorStates,
    result.overflowTasks,
    result.unscheduledTasks,
    result.emergencyEquipmentNames,
    result.staffingWarning,
    lunchSafeCategories ?? [],
  );

  // Determine lunch times from operator states
  const lunchStarts = operatorStates.map((o) => o.lunchStart);
  const lunchStart = lunchStarts.length > 0 ? Math.min(...lunchStarts) : LUNCH_LATEST_START;
  const lunchEnd = lunchStart + LUNCH_DURATION;

  return {
    tasks,
    ...gantt,
    lunchStart,
    lunchEnd,
  };
}
