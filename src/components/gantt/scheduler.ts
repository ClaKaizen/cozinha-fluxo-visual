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

export const DAY_START = 7 * 60;           // 420 — 07:00 (machines can start here)
export const OPERATOR_START = 7 * 60 + 10; // 430 — 07:10 (operators start here)
export const DAY_END = 16 * 60;            // 960 — 16:00 (axis extent for overflow visibility)
export const OPERATOR_HARD_STOP = 15 * 60 + 30;  // 930 — 15:30
export const MACHINE_TARGET_STOP = 15 * 60 + 40; // 940 — 15:40
export const AVAILABLE_MACHINE_MINUTES = 480;
const LUNCH_WINDOW_START = 12 * 60;  // 720
const LUNCH_LATEST_START = 13 * 60;  // 780
const LUNCH_DURATION_MIN = 60;
const OPERATOR_PRODUCTIVE_MINUTES = 440; // 07:10–15:30 minus 60min lunch

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
  isPaired?: boolean;
  roleLabel?: string;
}

interface ScheduledMachineAssignment {
  booking: MachineBooking;
  machineIdx: number;
  start: number;
  end: number;
  pairRole?: "cooking" | "cooling";
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
  isPaired: boolean;
  roleLabel: string;
  pairPartnerLabel?: string;
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
  const sharedLunchEnd = LUNCH_WINDOW_START + LUNCH_DURATION_MIN;

  if (!op.hadLunch) {
    if (effectiveStart < LUNCH_WINDOW_START) {
      const taskEnd = effectiveStart + duration;
      if (taskEnd > LUNCH_WINDOW_START) {
        // Task would cross 12:00 — send to lunch at 12:00 first
        effectiveStart = sharedLunchEnd;
      }
    } else if (effectiveStart >= LUNCH_WINDOW_START && effectiveStart < sharedLunchEnd) {
      // In lunch hour — skip to end of shared lunch
      effectiveStart = sharedLunchEnd;
    }
  } else {
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
  const sharedLunchEnd = LUNCH_WINDOW_START + LUNCH_DURATION_MIN;

  if (!op.hadLunch) {
    if (effectiveStart < LUNCH_WINDOW_START) {
      const taskEnd = effectiveStart + duration;
      if (taskEnd > LUNCH_WINDOW_START) {
        // Task would cross 12:00 — eat lunch at 12:00 first
        effectiveStart = sharedLunchEnd;
      }
    } else if (effectiveStart >= LUNCH_WINDOW_START && effectiveStart < sharedLunchEnd) {
      // In the shared lunch hour — skip to end
      effectiveStart = sharedLunchEnd;
    }
  } else {
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
  const sharedLunchStart = op.lunchStart;
  const sharedLunchEnd = sharedLunchStart + LUNCH_DURATION_MIN;

  if (!op.hadLunch) {
    if (effectiveStart < sharedLunchStart) {
      const taskEnd = effectiveStart + duration;
      if (taskEnd > sharedLunchStart) {
        op.lunchStart = sharedLunchStart;
        op.lunchEnd = sharedLunchEnd;
        op.hadLunch = true;
        effectiveStart = op.lunchEnd;
      }
    } else if (effectiveStart >= sharedLunchStart && effectiveStart < sharedLunchEnd) {
      op.lunchStart = sharedLunchStart;
      op.lunchEnd = sharedLunchEnd;
      op.hadLunch = true;
      effectiveStart = Math.max(effectiveStart, op.lunchEnd);
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
    op.lunchEnd = op.lunchStart + LUNCH_DURATION_MIN;
    op.hadLunch = true;
    if (op.cursor < op.lunchEnd) op.cursor = op.lunchEnd;
  }
}

function chooseSharedLunchStart(operators: OperatorState[]): number {
  const candidates = Array.from({ length: 5 }, (_, index) => LUNCH_WINDOW_START + index * 15);
  let bestStart = LUNCH_WINDOW_START;
  let bestFreeCount = -1;

  for (const candidate of candidates) {
    const freeCount = operators.reduce((count, op) => {
      const cursorAtCandidate = Math.max(op.cursor, candidate);
      return count + (cursorAtCandidate === candidate ? 1 : 0);
    }, 0);

    if (freeCount > bestFreeCount) {
      bestFreeCount = freeCount;
      bestStart = candidate;
    }
  }

  return bestStart;
}

// ── Machine slot tracker ──────────────────────────────

interface MachineSlotTracker {
  /** Per equipment ID: array of next-available times, one per machine instance */
  slots: Map<string, number[]>;
  /** Dedicated machine reservations: key = `${categoryId}:${equipmentId}`, value = machineIdx */
  dedicatedSlots: Map<string, number>;
  /** Preferred pair reuse for paired categories: key = `${categoryId}:${primaryEqId}:${pairedEqId}` */
  pairPreferences: Map<string, { primaryMachineIdx: number; pairedMachineIdx: number }>;
}

function createMachineTracker(equipment: Equipment[], allowEmergency: boolean, emergencyEquipIds?: Set<string>): MachineSlotTracker {
  const slots = new Map<string, number[]>();
  equipment.forEach((eq) => {
    const useEmerg = emergencyEquipIds
      ? emergencyEquipIds.has(eq.id)
      : allowEmergency;
    const count = useEmerg ? eq.quantidade + eq.quantidadeEmergencia : eq.quantidade;
    slots.set(eq.id, Array.from({ length: count }, () => DAY_START));
  });
  return { slots, dedicatedSlots: new Map(), pairPreferences: new Map() };
}

function cloneMachineTracker(tracker: MachineSlotTracker): MachineSlotTracker {
  const slots = new Map<string, number[]>();
  tracker.slots.forEach((value, key) => slots.set(key, [...value]));
  return {
    slots,
    dedicatedSlots: new Map(tracker.dedicatedSlots),
    pairPreferences: new Map(tracker.pairPreferences),
  };
}

function getReservedMachineSet(tracker: MachineSlotTracker, categoryId?: string): Set<string> {
  const reservedByOthers = new Set<string>();
  tracker.dedicatedSlots.forEach((machIdx, key) => {
    const [reservedCategoryId, equipmentId] = key.split(":");
    if (reservedCategoryId !== categoryId) {
      reservedByOthers.add(`${equipmentId}:${machIdx}`);
    }
  });
  return reservedByOthers;
}

function getPairPreferenceKey(categoryId: string, primaryEquipmentId: string, pairedEquipmentId: string): string {
  return `${categoryId}:${primaryEquipmentId}:${pairedEquipmentId}`;
}

function formatMachineInstanceLabel(
  equipmentName: string,
  machineIdx: number,
  normalCount: number,
  _options?: { paired?: boolean; dedicated?: boolean },
): string {
  return machineIdx >= normalCount
    ? `${equipmentName} ${machineIdx + 1} ⚠️`
    : `${equipmentName} ${machineIdx + 1}`;
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
): { assignments: ScheduledMachineAssignment[]; phaseStart: number } | null {
  if (phaseBookings.some((booking) => booking.isPaired)) {
    return findPairedMachineSlot(phaseBookings, minStart, tracker, equipmentMap, allowEmergency, hardStop, categoryId);
  }

  return findStandardMachineSlot(phaseBookings, minStart, tracker, equipmentMap, allowEmergency, hardStop, categoryId);
}

function findStandardMachineSlot(
  phaseBookings: MachineBooking[],
  minStart: number,
  tracker: MachineSlotTracker,
  equipmentMap: Map<string, Equipment>,
  allowEmergency: boolean,
  hardStop: number,
  categoryId?: string,
): { assignments: ScheduledMachineAssignment[]; phaseStart: number } | null {
  // Group bookings by equipment
  const grouped = new Map<string, MachineBooking[]>();
  phaseBookings.forEach((b) => {
    const arr = grouped.get(b.equipmentId) ?? [];
    arr.push(b);
    grouped.set(b.equipmentId, arr);
  });

  const reservedByOthers = getReservedMachineSet(tracker, categoryId);

  // For each equipment group, find the N earliest-available slots
  let phaseStart = minStart;
  const slotPicks: { equipmentId: string; booking: MachineBooking; machineIdx: number }[] = [];

  for (const [eqId, bookings] of grouped) {
    const eq = equipmentMap.get(eqId);
    if (!eq) return null;
    const slots = tracker.slots.get(eqId);
    if (!slots) return null;
    const maxIdx = slots.length;
    if (maxIdx < bookings.length) return null;

    for (let bi = 0; bi < bookings.length; bi++) {
      const booking = bookings[bi];

      // Check if this booking's category already has a dedicated slot reserved
      const dedicatedKey = booking.isDedicated
        ? `${categoryId}:${eqId}:ded`
        : undefined;
      const existingDedicated = dedicatedKey && categoryId ? tracker.dedicatedSlots.get(dedicatedKey) : undefined;

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

function findPairedMachineSlot(
  phaseBookings: MachineBooking[],
  minStart: number,
  tracker: MachineSlotTracker,
  equipmentMap: Map<string, Equipment>,
  allowEmergency: boolean,
  hardStop: number,
  categoryId?: string,
): { assignments: ScheduledMachineAssignment[]; phaseStart: number } | null {
  const pairedBooking = phaseBookings.find((booking) => booking.isPaired);
  const primaryBooking = phaseBookings.find((booking) => !booking.isPaired);

  if (!pairedBooking || !primaryBooking) {
    return findStandardMachineSlot(phaseBookings, minStart, tracker, equipmentMap, allowEmergency, hardStop, categoryId);
  }

  const remainingBookings = phaseBookings.filter((booking) => booking !== pairedBooking && booking !== primaryBooking);
  let searchStart = minStart;

  for (let attempt = 0; attempt < 120 && searchStart < Infinity; attempt++) {
    const pairResult = findPreferredMachinePair(
      primaryBooking,
      pairedBooking,
      searchStart,
      tracker,
      equipmentMap,
      allowEmergency,
      categoryId,
    );

    if (!pairResult || pairResult.phaseStart >= hardStop) return null;

    if (remainingBookings.length === 0) {
      return pairResult;
    }

    const speculativeTracker = cloneMachineTracker(tracker);
    for (const assignment of pairResult.assignments) {
      const slots = speculativeTracker.slots.get(assignment.booking.equipmentId);
      if (slots) slots[assignment.machineIdx] = assignment.end;
    }

    const remainingResult = findStandardMachineSlot(
      remainingBookings,
      pairResult.phaseStart,
      speculativeTracker,
      equipmentMap,
      allowEmergency,
      hardStop,
      categoryId,
    );

    if (!remainingResult) {
      searchStart = pairResult.phaseStart + 5;
      continue;
    }

    if (remainingResult.phaseStart > pairResult.phaseStart) {
      searchStart = remainingResult.phaseStart;
      continue;
    }

    return {
      phaseStart: pairResult.phaseStart,
      assignments: [...pairResult.assignments, ...remainingResult.assignments],
    };
  }

  return null;
}

function findPreferredMachinePair(
  primaryBooking: MachineBooking,
  pairedBooking: MachineBooking,
  minStart: number,
  tracker: MachineSlotTracker,
  equipmentMap: Map<string, Equipment>,
  allowEmergency: boolean,
  categoryId?: string,
): { assignments: ScheduledMachineAssignment[]; phaseStart: number } | null {
  const primaryEquipment = equipmentMap.get(primaryBooking.equipmentId);
  const pairedEquipment = equipmentMap.get(pairedBooking.equipmentId);
  const primarySlots = tracker.slots.get(primaryBooking.equipmentId);
  const pairedSlots = tracker.slots.get(pairedBooking.equipmentId);

  if (!primaryEquipment || !pairedEquipment || !primarySlots || !pairedSlots) return null;

  const reservedByOthers = getReservedMachineSet(tracker, categoryId);
  const sameEquipment = primaryBooking.equipmentId === pairedBooking.equipmentId;
  const primaryMaxIdx = primarySlots.length;
  const pairedMaxIdx = pairedSlots.length;
  const primaryIndices = Array.from(
    { length: sameEquipment ? primaryEquipment.quantidade : primaryMaxIdx },
    (_, index) => index,
  ).filter((index) => !reservedByOthers.has(`${primaryBooking.equipmentId}:${index}`));
  const pairedIndices = Array.from({ length: pairedMaxIdx }, (_, index) => index)
    .filter((index) => !reservedByOthers.has(`${pairedBooking.equipmentId}:${index}`));

  if (primaryIndices.length === 0 || pairedIndices.length === 0) return null;

  const pairDuration = Math.max(primaryBooking.duration, pairedBooking.duration);
  const preferredPair = categoryId
    ? tracker.pairPreferences.get(getPairPreferenceKey(categoryId, primaryBooking.equipmentId, pairedBooking.equipmentId))
    : undefined;

  let bestCandidate: {
    primaryMachineIdx: number;
    pairedMachineIdx: number;
    phaseStart: number;
    useEmergencyCooling: boolean;
    preferred: boolean;
  } | null = null;

  for (const primaryMachineIdx of primaryIndices) {
    for (const pairedMachineIdx of pairedIndices) {
      if (sameEquipment && primaryMachineIdx === pairedMachineIdx) continue;

      const phaseStart = Math.max(
        minStart,
        primarySlots[primaryMachineIdx] ?? DAY_START,
        pairedSlots[pairedMachineIdx] ?? DAY_START,
      );

      const useEmergencyCooling = pairedMachineIdx >= pairedEquipment.quantidade;
      const preferred = Boolean(
        preferredPair &&
        preferredPair.primaryMachineIdx === primaryMachineIdx &&
        preferredPair.pairedMachineIdx === pairedMachineIdx,
      );

      const candidate = {
        primaryMachineIdx,
        pairedMachineIdx,
        phaseStart,
        useEmergencyCooling,
        preferred,
      };

      if (!bestCandidate) {
        bestCandidate = candidate;
        continue;
      }

      if (candidate.phaseStart < bestCandidate.phaseStart) {
        bestCandidate = candidate;
        continue;
      }

      if (candidate.phaseStart > bestCandidate.phaseStart) continue;

      if (candidate.useEmergencyCooling !== bestCandidate.useEmergencyCooling) {
        if (candidate.useEmergencyCooling) bestCandidate = candidate;
        continue;
      }

      if (candidate.preferred !== bestCandidate.preferred) {
        if (candidate.preferred) bestCandidate = candidate;
        continue;
      }

      const currentScore = candidate.primaryMachineIdx + candidate.pairedMachineIdx;
      const bestScore = bestCandidate.primaryMachineIdx + bestCandidate.pairedMachineIdx;
      if (currentScore < bestScore) {
        bestCandidate = candidate;
      }
    }
  }

  if (!bestCandidate) return null;

  const phaseEnd = bestCandidate.phaseStart + pairDuration;
  return {
    phaseStart: bestCandidate.phaseStart,
    assignments: [
      {
        booking: primaryBooking,
        machineIdx: bestCandidate.primaryMachineIdx,
        start: bestCandidate.phaseStart,
        end: phaseEnd,
        pairRole: "cooking",
      },
      {
        booking: pairedBooking,
        machineIdx: bestCandidate.pairedMachineIdx,
        start: bestCandidate.phaseStart,
        end: phaseEnd,
        pairRole: "cooling",
      },
    ],
  };
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
  machineAssignments: ScheduledMachineAssignment[];
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
    cursor: OPERATOR_START,
    totalWorked: 0,
    hadLunch: false,
    lunchStart: LUNCH_WINDOW_START,
    lunchEnd: LUNCH_WINDOW_START + LUNCH_DURATION_MIN,
  }));

  const sharedLunchStart = chooseSharedLunchStart(operators);
  operators.forEach((op) => {
    op.lunchStart = sharedLunchStart;
    op.lunchEnd = sharedLunchStart + LUNCH_DURATION_MIN;
  });

  const assignments: JointAssignment[] = [];
  const overflowTasks: string[] = [];
  const unscheduledTasks: UnscheduledTask[] = [];
  const emergencyEquipmentNames = new Set<string>();

  // Track which operators are assigned to each equipment type for Op./Grupo enforcement
  // equipmentId → list of operator names assigned to this group
  const equipmentGroupOperators = new Map<string, string[]>();

  // ── Operator continuity: once an operator starts an artigo, they finish all its cycles ──
  // ONLY for non-multiOperador equipment (e.g. Fritadeira). For multiOperador equipment
  // (Basculante, Marmita, Forno) load balancing distributes across operators instead.
  // operatorName → { artigo, equipmentId, remaining }
  const operatorCommitments = new Map<string, { artigo: string; equipmentId: string; remaining: number }>();

  // Track the operator dedicated to non-multiOperador equipment (e.g. Fritadeira).
  // This operator is excluded from other tasks' load balancing.
  const dedicatedSingleOpEquipOperators = new Set<string>();

  function getPreferredOperator(equipmentId: string): { name: string; strict: boolean } | undefined {
    const eq = equipmentMap.get(equipmentId);
    const isMulti = eq?.multiOperador ?? true;
    const assigned = equipmentGroupOperators.get(equipmentId) ?? [];
    // If multiOperador is false, enforce single operator for entire equipment group
    if (!isMulti && assigned.length > 0) {
      return { name: assigned[0], strict: true };
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
      const isMulti = eq?.multiOperador ?? true;
      // If multiOperador, allow multiple operators; otherwise cap at 1
      if (isMulti || ops.length < 1) {
        ops.push(operatorName);
      }
      // Mark as dedicated single-op if non-multiOperador
      if (!isMulti) {
        dedicatedSingleOpEquipOperators.add(operatorName);
      }
    }
  }

  /** Check if an operator is committed to a different artigo than the given task */
  function isOperatorCommittedElsewhere(opName: string, task: PlanningTask): boolean {
    const commitment = operatorCommitments.get(opName);
    if (!commitment || commitment.remaining <= 0) return false;
    return commitment.artigo !== task.artigo;
  }

  /** Get the committed operator for a given artigo, if any */
  function getCommittedOperator(task: PlanningTask): string | undefined {
    for (const [opName, c] of operatorCommitments) {
      if (c.artigo === task.artigo && c.remaining > 0) return opName;
    }
    return undefined;
  }

  /** Check if an operator is dedicated to a non-multiOperador equipment (e.g. Fritadeira)
   *  and should be excluded from other tasks */
  function isOperatorDedicatedToSingleOp(opName: string, taskEquipmentId: string): boolean {
    if (!dedicatedSingleOpEquipOperators.has(opName)) return false;
    // Allow if the task is on the same non-multiOperador equipment
    const assigned = equipmentGroupOperators.get(taskEquipmentId);
    if (assigned && assigned.includes(opName)) return true; // same equipment — OK
    // Check if this equipment is also non-multiOperador and this op is assigned to it
    // Otherwise, this op is dedicated elsewhere — exclude
    return true; // dedicated to different equipment — exclude
  }

  /** Register or update commitment when an operator is assigned a task.
   *  Only creates commitments for non-multiOperador equipment. */
  function registerCommitment(opName: string, task: PlanningTask, pendingTasks: PlanningTask[]) {
    const eq = equipmentMap.get(task.equipmentId);
    const isMulti = eq?.multiOperador ?? true;
    // Only commit for non-multiOperador equipment (task continuity on Fritadeira etc.)
    if (!isMulti) {
      const remaining = pendingTasks.filter(t => t.artigo === task.artigo).length;
      if (remaining > 0) {
        operatorCommitments.set(opName, { artigo: task.artigo, equipmentId: task.equipmentId, remaining });
      } else {
        operatorCommitments.delete(opName);
      }
    }
    // For multiOperador equipment, no commitment — load balancing distributes freely
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

      const cookingAssignment = a.machineAssignments.find((ma) => ma.pairRole === "cooking");
      const coolingAssignment = a.machineAssignments.find((ma) => ma.pairRole === "cooling");
      if (cookingAssignment && coolingAssignment) {
        tracker.pairPreferences.set(
          getPairPreferenceKey(a.task.categoryId, cookingAssignment.booking.equipmentId, coolingAssignment.booking.equipmentId),
          {
            primaryMachineIdx: cookingAssignment.machineIdx,
            pairedMachineIdx: coolingAssignment.machineIdx,
          },
        );
      }
    }

    const remaining: PlanningTask[] = [];
    const pending = [...tasksToSchedule];

    // Greedy earliest-start with gap-filling: prefer tasks on idle equipment
    // over tasks on equipment with active long machine runs
    let maxIterations = pending.length * pending.length + pending.length;
    while (pending.length > 0 && maxIterations-- > 0) {
      // Determine the earliest operator cursor (= when operators become free)
      const earliestOpCursor = Math.min(...operators.map(o => o.cursor));

      // Find equipment types that are "busy" — all machine slots extend well past operator availability
      // These are equipment types where scheduling another batch would just wait for the machine
      const busyEquipmentIds = new Set<string>();
      tracker.slots.forEach((slots, eqId) => {
        const minSlot = Math.min(...slots);
        // If the earliest machine of this type is free > 30min after operators are available,
        // it's "busy" — deprioritize additional batches on it
        if (minSlot > earliestOpCursor + 30) {
          busyEquipmentIds.add(eqId);
        }
      });

      let bestIdx = -1;
      let bestResult: JointAssignment | null = null;
      let bestStart = Infinity;
      let bestOnIdleEquip = false; // prefer tasks on idle equipment

      for (let ti = 0; ti < pending.length; ti++) {
        const task = pending[ti];
        if (!depsScheduled(task)) continue;

        const depMinStart = getMinStartForTask(task);
        const primaryEqId = task.equipmentId;

        // Determine preferred operator: committed operator > equipment group preference
        let preferredOpName: string | undefined;
        let strictPref = false;

        const committedOp = getCommittedOperator(task);
        if (committedOp) {
          preferredOpName = committedOp;
          strictPref = true; // committed operator MUST do this task
        } else {
          const groupPref = getPreferredOperator(primaryEqId);
          if (groupPref) {
            preferredOpName = groupPref.name;
            strictPref = groupPref.strict;
          }
        }

        // Skip this task if its only viable operators are all committed elsewhere
        // (but allow if no commitment exists for this artigo — a free operator can take it)
        if (!committedOp) {
          // Check if ALL free operators are committed to other artigos
          const freeOps = operators.filter(o => !isOperatorCommittedElsewhere(o.name, task));
          if (freeOps.length === 0 && operators.length > 0) continue; // all committed elsewhere, defer
        }

        const result = tryJointSlot(task, tracker, operators, equipmentMap, allowEmergency, equipment, depMinStart, preferredOpName, lunchSafeCategories, strictPref);
        if (result) {
          // Reject if the assigned operator is committed to a different artigo
          if (result.operatorName && isOperatorCommittedElsewhere(result.operatorName, task)) continue;

          const taskStart = Math.min(result.operatorStart, ...result.machineAssignments.map(ma => ma.start));
          const onIdleEquip = !busyEquipmentIds.has(primaryEqId);

          // Priority: idle equipment tasks first (if they start reasonably early),
          // then earliest start among the same priority class
          let isBetter = false;
          if (bestIdx < 0) {
            isBetter = true;
          } else if (onIdleEquip && !bestOnIdleEquip) {
            isBetter = taskStart <= bestStart + 60;
          } else if (!onIdleEquip && bestOnIdleEquip) {
            isBetter = false;
          } else {
            isBetter = taskStart < bestStart;
          }

          if (isBetter) {
            bestStart = taskStart;
            bestResult = result;
            bestIdx = ti;
            bestOnIdleEquip = onIdleEquip;
          }
        }
      }

      if (bestIdx < 0) {
        // No task could be scheduled — check if any have unmet deps that might resolve
        const hasUnmetDeps = pending.some(t => !depsScheduled(t));
        if (hasUnmetDeps) {
          // Move tasks with unmet deps to remaining
          for (let i = pending.length - 1; i >= 0; i--) {
            if (!depsScheduled(pending[i])) {
              remaining.push(...pending.splice(i, 1));
            }
          }
          continue;
        }
        // All truly unschedulable
        remaining.push(...pending);
        break;
      }

      const task = pending[bestIdx];
      const result = bestResult!;
      pending.splice(bestIdx, 1);

      // Commit machine slots and register dedicated machines / preferred pairs
      for (const ma of result.machineAssignments) {
        const slots = tracker.slots.get(ma.booking.equipmentId);
        if (slots) slots[ma.machineIdx] = ma.end;
        if (ma.booking.isDedicated) {
          const dedKey = `${task.categoryId}:${ma.booking.equipmentId}:ded`;
          if (!tracker.dedicatedSlots.has(dedKey)) {
            tracker.dedicatedSlots.set(dedKey, ma.machineIdx);
          }
        }
      }

      const cookingAssignment = result.machineAssignments.find((ma) => ma.pairRole === "cooking");
      const coolingAssignment = result.machineAssignments.find((ma) => ma.pairRole === "cooling");
      if (cookingAssignment && coolingAssignment) {
        tracker.pairPreferences.set(
          getPairPreferenceKey(task.categoryId, cookingAssignment.booking.equipmentId, coolingAssignment.booking.equipmentId),
          {
            primaryMachineIdx: cookingAssignment.machineIdx,
            pairedMachineIdx: coolingAssignment.machineIdx,
          },
        );
      }

      // Commit operator and register continuity
      if (result.operatorName && task.operatorDuration > 0) {
        const op = operators.find((o) => o.name === result.operatorName)!;
        if (op) commitOperator(op, result.operatorStart, task.operatorDuration);
        registerGroupOperator(task.equipmentId, result.operatorName);
        registerCommitment(result.operatorName, task, pending);
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
    }

    // Any leftover pending tasks
    remaining.push(...pending);
    return remaining;
  }

  // Schedule all tasks together — greedy picks earliest-startable across all categories
  const allTasks = [...pass1Tasks, ...deferredTasks, ...circularTasks];
  let remaining = tryScheduleAll(false, allTasks);

  // ── Emergency auto-activation (per equipment type) ──
  // Identify which equipment types actually have overflow
  const overflowEquipIds = new Set<string>();
  for (const a of assignments) {
    for (const ma of a.machineAssignments) {
      if (ma.end > MACHINE_TARGET_STOP) {
        overflowEquipIds.add(ma.booking.equipmentId);
      }
    }
  }
  // Also check remaining (unscheduled) tasks for their equipment types
  for (const task of remaining) {
    for (const b of task.machineBookings) {
      overflowEquipIds.add(b.equipmentId);
    }
  }

  // Filter to only equipment types that actually have emergency capacity
  const emergencyEligible = new Set<string>();
  for (const eqId of overflowEquipIds) {
    const eq = equipmentMap.get(eqId);
    if (eq && eq.quantidadeEmergencia > 0) {
      emergencyEligible.add(eqId);
    }
  }

  if (emergencyEligible.size > 0 && (remaining.length > 0 || overflowEquipIds.size > 0)) {
    // Save current state
    const savedAssignments = [...assignments];
    const savedOverflow = [...overflowTasks];
    const savedUnscheduled = [...unscheduledTasks];
    const savedEmergencyNames = new Set(emergencyEquipmentNames);

    // Reset state for re-run with per-type emergency
    assignments.length = 0;
    overflowTasks.length = 0;
    unscheduledTasks.length = 0;
    emergencyEquipmentNames.clear();
    scheduledCategoryEndTimes.clear();
    equipmentGroupOperators.clear();
    operatorCommitments.clear();

    for (const op of operators) {
      op.cursor = OPERATOR_START;
      op.totalWorked = 0;
      op.hadLunch = false;
      op.lunchStart = sharedLunchStart;
      op.lunchEnd = sharedLunchStart + LUNCH_DURATION_MIN;
    }

    // Override tryScheduleAll to use per-type emergency
    function tryScheduleAllPerType(tasksToSchedule: PlanningTask[]): PlanningTask[] {
      const tracker = createMachineTracker(equipment, false, emergencyEligible);

      // Restore machine slots from already-committed assignments
      for (const a of assignments) {
        for (const ma of a.machineAssignments) {
          const slots = tracker.slots.get(ma.booking.equipmentId);
          if (slots && slots[ma.machineIdx] < ma.end) {
            slots[ma.machineIdx] = ma.end;
          }
        }
        const cookingA = a.machineAssignments.find((ma) => ma.pairRole === "cooking");
        const coolingA = a.machineAssignments.find((ma) => ma.pairRole === "cooling");
        if (cookingA && coolingA) {
          tracker.pairPreferences.set(
            getPairPreferenceKey(a.task.categoryId, cookingA.booking.equipmentId, coolingA.booking.equipmentId),
            { primaryMachineIdx: cookingA.machineIdx, pairedMachineIdx: coolingA.machineIdx },
          );
        }
      }

      // Use greedy gap-filling (same as tryScheduleAll)
      const rem: PlanningTask[] = [];
      const pending = [...tasksToSchedule];
      let maxIter = pending.length * pending.length + pending.length;

      while (pending.length > 0 && maxIter-- > 0) {
        const earliestOpCursor = Math.min(...operators.map(o => o.cursor));
        const busyEqIds = new Set<string>();
        tracker.slots.forEach((slots, eqId) => {
          if (Math.min(...slots) > earliestOpCursor + 30) busyEqIds.add(eqId);
        });

        let bestIdx = -1;
        let bestResult: JointAssignment | null = null;
        let bestStart = Infinity;
        let bestOnIdle = false;

        for (let ti = 0; ti < pending.length; ti++) {
          const task = pending[ti];
          if (!depsScheduled(task)) continue;
          const depMinStart = getMinStartForTask(task);
          const primaryEqId = task.equipmentId;

          // Operator continuity + group preference
          let preferredOpName: string | undefined;
          let strictPref = false;
          const committedOp = getCommittedOperator(task);
          if (committedOp) {
            preferredOpName = committedOp;
            strictPref = true;
          } else {
            const groupPref = getPreferredOperator(primaryEqId);
            if (groupPref) { preferredOpName = groupPref.name; strictPref = groupPref.strict; }
          }
          if (!committedOp) {
            const freeOps = operators.filter(o => !isOperatorCommittedElsewhere(o.name, task));
            if (freeOps.length === 0 && operators.length > 0) continue;
          }

          const result = tryJointSlot(task, tracker, operators, equipmentMap, true, equipment, depMinStart, preferredOpName, lunchSafeCategories, strictPref);
          if (result) {
            if (result.operatorName && isOperatorCommittedElsewhere(result.operatorName, task)) continue;
            const taskStart = Math.min(result.operatorStart, ...result.machineAssignments.map(ma => ma.start));
            const onIdle = !busyEqIds.has(primaryEqId);
            let isBetter = false;
            if (bestIdx < 0) isBetter = true;
            else if (onIdle && !bestOnIdle) isBetter = taskStart <= bestStart + 60;
            else if (!onIdle && bestOnIdle) isBetter = false;
            else isBetter = taskStart < bestStart;
            if (isBetter) {
              bestStart = taskStart;
              bestResult = result;
              bestIdx = ti;
              bestOnIdle = onIdle;
            }
          }
        }

        if (bestIdx < 0) {
          const hasUnmetDeps = pending.some(t => !depsScheduled(t));
          if (hasUnmetDeps) {
            for (let i = pending.length - 1; i >= 0; i--) {
              if (!depsScheduled(pending[i])) rem.push(...pending.splice(i, 1));
            }
            continue;
          }
          rem.push(...pending);
          break;
        }

        const task = pending[bestIdx];
        const result = bestResult!;
        pending.splice(bestIdx, 1);

        for (const ma of result.machineAssignments) {
          const slots = tracker.slots.get(ma.booking.equipmentId);
          if (slots) slots[ma.machineIdx] = ma.end;
          if (ma.booking.isDedicated) {
            const dedKey = `${task.categoryId}:${ma.booking.equipmentId}:ded`;
            if (!tracker.dedicatedSlots.has(dedKey)) tracker.dedicatedSlots.set(dedKey, ma.machineIdx);
          }
        }
        const cookingA = result.machineAssignments.find((ma) => ma.pairRole === "cooking");
        const coolingA = result.machineAssignments.find((ma) => ma.pairRole === "cooling");
        if (cookingA && coolingA) {
          tracker.pairPreferences.set(
            getPairPreferenceKey(task.categoryId, cookingA.booking.equipmentId, coolingA.booking.equipmentId),
            { primaryMachineIdx: cookingA.machineIdx, pairedMachineIdx: coolingA.machineIdx },
          );
        }
        if (result.operatorName && task.operatorDuration > 0) {
          const op = operators.find((o) => o.name === result.operatorName)!;
          if (op) commitOperator(op, result.operatorStart, task.operatorDuration);
          registerGroupOperator(task.equipmentId, result.operatorName);
          registerCommitment(result.operatorName, task, pending);
        }
        for (const ma of result.machineAssignments) {
          const eqItem = equipmentMap.get(ma.booking.equipmentId);
          if (eqItem && ma.machineIdx >= eqItem.quantidade) {
            emergencyEquipmentNames.add(eqItem.nome);
          }
        }
        const maxEnd = Math.max(...result.machineAssignments.map(ma => ma.end));
        const prevEnd = scheduledCategoryEndTimes.get(task.categoryId) ?? 0;
        scheduledCategoryEndTimes.set(task.categoryId, Math.max(prevEnd, maxEnd));
        assignments.push(result);
      }

      rem.push(...pending);
      return rem;
    }

    const emergRemaining = tryScheduleAllPerType(allTasks);

    // Compare: is per-type emergency better than normal?
    const normalProblems = savedAssignments.filter((a) =>
      a.machineAssignments.some((ma) => ma.end > MACHINE_TARGET_STOP) || a.operatorEnd > OPERATOR_HARD_STOP
    ).length + remaining.length;

    const emergProblems = assignments.filter((a) =>
      a.machineAssignments.some((ma) => ma.end > MACHINE_TARGET_STOP) || a.operatorEnd > OPERATOR_HARD_STOP
    ).length + emergRemaining.length;

    if (emergProblems < normalProblems) {
      remaining = emergRemaining;
    } else {
      // Revert to normal
      assignments.length = 0;
      assignments.push(...savedAssignments);
      overflowTasks.length = 0;
      overflowTasks.push(...savedOverflow);
      unscheduledTasks.length = 0;
      unscheduledTasks.push(...savedUnscheduled);
      emergencyEquipmentNames.clear();
      savedEmergencyNames.forEach((n) => emergencyEquipmentNames.add(n));

      for (const op of operators) {
        op.cursor = OPERATOR_START;
        op.totalWorked = 0;
        op.hadLunch = false;
        op.lunchStart = sharedLunchStart;
        op.lunchEnd = sharedLunchStart + LUNCH_DURATION_MIN;
      }
      const sorted = [...savedAssignments].sort((a, b) => a.operatorStart - b.operatorStart);
      for (const a of sorted) {
        if (a.operatorName && a.task.operatorDuration > 0) {
          const op = operators.find((o) => o.name === a.operatorName);
          if (op) commitOperator(op, a.operatorStart, a.task.operatorDuration);
        }
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
  strictPreferred: boolean = false,
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

    // Lunch constraint: only block if the OPERATOR's T.Homem would cross lunch.
    // The machine can run autonomously during lunch once T.Homem is done.
    if (!isLunchSafe && task.operatorDuration > 0) {
      const lunchBlockStart = LUNCH_WINDOW_START;
      const lunchBlockEnd = LUNCH_WINDOW_START + LUNCH_DURATION_MIN;

      // Check if the operator's work portion (not the full machine duration) crosses lunch
      const operatorEndIfStartedNow = machineStart + task.operatorDuration;
      if (machineStart < lunchBlockStart && operatorEndIfStartedNow > lunchBlockStart) {
        // Operator T.Homem would cross into lunch — push to after lunch
        candidateTime = lunchBlockEnd;
        continue;
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
        if (opStart >= 0) {
          // HARD CONSTRAINT: machine must not start before operator
          // If operator can't start at machineStart, advance candidateTime
          if (opStart > machineStart) {
            candidateTime = opStart;
            continue; // retry — machine will be re-found at the new candidateTime
          }
          bestOp = prefOp;
          bestOpStart = opStart;
          bestOpLoad = prefOp.totalWorked;
        }
      }
    }

    // If preferred didn't work (or no preferred), try all operators — but NOT if strict
    if (!bestOp && !strictPreferred) {
      for (const op of operators) {
        // Skip operators committed to a different artigo
        if (isOperatorCommittedElsewhere(op.name, task)) continue;
        // Skip operators dedicated to non-multiOperador equipment (e.g. Fritadeira)
        // unless this task is on that same equipment
        if (dedicatedSingleOpEquipOperators.has(op.name)) {
          const assignedToThisEquip = (equipmentGroupOperators.get(task.equipmentId) ?? []).includes(op.name);
          if (!assignedToThisEquip) continue;
        }

        const opStart = getOperatorEarliestStart(op, machineStart, task.operatorDuration);
        if (opStart < 0) continue;

        // HARD CONSTRAINT: only accept operators who can start at machineStart (±5min tolerance)
        if (opStart <= machineStart + 5) {
          if (op.totalWorked < bestOpLoad || (op.totalWorked === bestOpLoad && opStart < bestOpStart)) {
            bestOp = op;
            bestOpStart = opStart;
            bestOpLoad = op.totalWorked;
          }
        }
      }
    }

    if (bestOp && bestOpStart <= machineStart + 5) {
      // Synchronize: machine starts when operator starts (never before)
      const syncStart = Math.max(machineStart, bestOpStart);
      // Re-compute machine slots at syncStart if needed
      if (syncStart > machineStart) {
        // Retry with advanced candidateTime to align machine+operator
        candidateTime = syncStart;
        continue;
      }
      return {
        task,
        machineAssignments: machineResult.allAssignments,
        operatorName: bestOp.name,
        operatorStart: bestOpStart,
        operatorEnd: bestOpStart + task.operatorDuration,
      };
    }

    // No operator available at machineStart - find earliest operator availability
    let nextOpAvail = Infinity;
    const searchOps = strictPreferred && preferredOperator
      ? operators.filter(o => o.name === preferredOperator)
      : operators;
    for (const op of searchOps) {
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
): { allAssignments: ScheduledMachineAssignment[]; overallStart: number } | null {
  // Clone tracker for speculative scheduling
  const specTracker = cloneMachineTracker(tracker);

  const allAssignments: ScheduledMachineAssignment[] = [];
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
      const isDedicatedMachine = Boolean(ma.booking.isDedicated);
      const isPairedMachine = ma.pairRole === "cooling" || Boolean(ma.booking.isPaired);
      const label = formatMachineInstanceLabel(ma.booking.equipmentName, ma.machineIdx, eq.quantidade, {
        paired: isPairedMachine,
        dedicated: !isPairedMachine && isDedicatedMachine,
      });
      const cookingAssignment = machineAssignments.find((assignmentItem) => assignmentItem.pairRole === "cooking");
      const pairPartnerLabel = ma.pairRole === "cooling" && cookingAssignment
        ? formatMachineInstanceLabel(cookingAssignment.booking.equipmentName, cookingAssignment.machineIdx, equipmentMap.get(cookingAssignment.booking.equipmentId)?.quantidade ?? 0)
        : undefined;
      const derivedRoleLabel = ma.pairRole === "cooking"
        ? "Cozedura"
        : ma.pairRole === "cooling"
          ? (ma.booking.roleLabel?.trim() || "Arrefecimento")
          : (ma.booking.roleLabel?.trim() || "");

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
        isPaired: isPairedMachine,
        roleLabel: derivedRoleLabel,
        pairPartnerLabel,
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
      const opLunchStart = opState?.lunchStart ?? LUNCH_WINDOW_START;
      const opLunchEnd = opState?.lunchEnd ?? (opLunchStart + LUNCH_DURATION_MIN);

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
    // HARD CONSTRAINT: machine must never start before operator
    if (a.task.operatorDuration > 0 && a.operatorName) {
      const earliestMachine = Math.min(...a.machineAssignments.map(ma => ma.start));
      if (earliestMachine < a.operatorStart) {
        console.error(`[Scheduler] VIOLATION: Machine starts at ${formatClock(earliestMachine)} before operator ${a.operatorName} at ${formatClock(a.operatorStart)} for ${a.task.doseLabel}`);
      }
    }
    for (const ma of a.machineAssignments) {
      if (ma.start >= MACHINE_TARGET_STOP) {
        console.warn(`[Scheduler] Machine block for ${a.task.doseLabel} starts at ${formatClock(ma.start)} (past 15:40)`);
      }
    }
  }
}

// ── Minimum staffing calculator ─────────────────────────

export interface MinimumStaffingResult {
  pessoasNecessarias: number;
  feasible: boolean;
  warning?: string;
}

const MAX_STAFFING_SEARCH = 12;

export function calculateMinimumStaffing(input: Omit<BuildScheduleInput, 'operatorsForDate' | 'tempOperators'> & {
  operatorsForDate: BuildScheduleInput['operatorsForDate'];
  tempOperators: BuildScheduleInput['tempOperators'];
}): MinimumStaffingResult {
  const { dateStr, production, categories, equipment, sequencingRules, lunchSafeCategories } = input;
  const selectedDate = normalizeDateKey(dateStr);

  // Check if there's any production at all
  const dayProd = production.filter((p) => normalizeDateKey(p.date) === selectedDate);
  if (dayProd.length === 0) return { pessoasNecessarias: 0, feasible: true };

  // Estimate base from workload
  const categoryMap = new Map(categories.map((c) => [c.id, c]));
  let totalTHomemMin = 0;
  dayProd.forEach((p) => {
    const cat = categoryMap.get(p.categoriaId);
    if (cat) {
      const tH1 = cat.tempoCicloHomem1 ?? cat.tempoCicloHomem;
      totalTHomemMin += tH1 + (p.quantidade > 1 ? (p.quantidade - 1) * cat.tempoCicloHomem : 0);
    }
  });

  const baseEstimate = Math.max(1, Math.ceil(totalTHomemMin / OPERATOR_PRODUCTIVE_MINUTES));

  // Iteratively try N operators using the real scheduler
  for (let n = baseEstimate; n <= MAX_STAFFING_SEARCH; n++) {
    // Create synthetic operator list
    const syntheticOps: OperatorPresence[] = Array.from({ length: n }, (_, i) => ({
      operator: { id: `synth-${i}`, nome: `Op${i + 1}` },
      code: 'D' as ShiftCode,
      absent: false,
      hours: 8,
    }));

    const result = buildDailyGanttSchedule({
      dateStr,
      production,
      categories,
      equipment,
      operatorsForDate: syntheticOps,
      tempOperators: [],
      sequencingRules,
      lunchSafeCategories,
    });

    // Feasible = no overtime, no overflow, no unscheduled
    if (!result.hasOvertime && result.overflowTasks.length === 0 && result.unscheduledTasks.length === 0) {
      return { pessoasNecessarias: n, feasible: true };
    }
  }

  // Never feasible within bounds
  return {
    pessoasNecessarias: MAX_STAFFING_SEARCH,
    feasible: false,
    warning: `Mesmo com ${MAX_STAFFING_SEARCH} operadores, nem todas as tarefas terminam a tempo`,
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

      const nCiclos = Math.ceil(entry.quantidade);
      for (let i = 0; i < nCiclos; i++) {
        const isFirst = i === 0;
        const isLast = i === nCiclos - 1;
        // Fraction for the last partial cycle (e.g. 0.2 for 2.2 doses)
        const fraction = isLast && entry.quantidade % 1 !== 0
          ? entry.quantidade - Math.floor(entry.quantidade)
          : 1;

        const tHomemFull = isFirst ? (cat.tempoCicloHomem1 ?? cat.tempoCicloHomem) : cat.tempoCicloHomem;
        const tMaqPrimaryFull = isFirst ? (cat.tempoCicloMaquina1 ?? cat.tempoCicloMaquina) : cat.tempoCicloMaquina;
        // Scale durations for partial last cycle
        const tHomem = fraction < 1 ? Math.max(1, Math.round(tHomemFull * fraction)) : tHomemFull;
        // Machine always runs a full cycle even for partial doses
        const tMaqPrimary = tMaqPrimaryFull;
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
            const extraDurationFull = isFirst
              ? (extra.tempoCicloMaquina1 ?? extra.tempoCicloMaquina)
              : extra.tempoCicloMaquina;
            // Machine always runs full cycle even for partial doses
            const extraDuration = extraDurationFull;
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
              isDedicated: extra.isDedicated ?? false,
              isPaired: extra.isPaired ?? false,
              roleLabel: extra.roleLabel ?? "",
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

        // Dose label: show fraction for partial cycles
        const doseNumber = i + 1;
        const totalDisplay = entry.quantidade % 1 !== 0
          ? entry.quantidade.toFixed(1)
          : String(entry.quantidade);
        const doseDisplay = isLast && fraction < 1
          ? `${fraction.toFixed(1)}`
          : String(doseNumber);
        const doseLabel = nCiclos > 1
          ? `${entry.artigo} (${doseDisplay}/${totalDisplay})`
          : entry.artigo;

        tasks.push({
          id: `${entry.id}-d${i}`,
          artigo: entry.artigo,
          doseLabel,
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
      unscheduledTasks: [], lunchStart: LUNCH_WINDOW_START, lunchEnd: LUNCH_WINDOW_START + LUNCH_DURATION_MIN,
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
    cursor: OPERATOR_START,
    totalWorked: 0,
    hadLunch: false,
    lunchStart: result.assignments.length > 0 ? Math.min(...result.assignments.map(() => LUNCH_WINDOW_START)) : LUNCH_WINDOW_START,
    lunchEnd: LUNCH_WINDOW_START + LUNCH_DURATION_MIN,
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
  const lunchStart = lunchStarts.length > 0 ? Math.min(...lunchStarts) : LUNCH_WINDOW_START;
  const lunchEnd = lunchStart + LUNCH_DURATION_MIN;

  // ── Dose validation: ensure scheduled doses match planned quantities ──
  const dosesByArticle = new Map<string, number>();
  for (const t of tasks) {
    dosesByArticle.set(t.artigo, (dosesByArticle.get(t.artigo) ?? 0) + 1);
  }
  const scheduledByArticle = new Map<string, number>();
  for (const a of result.assignments) {
    scheduledByArticle.set(a.task.artigo, (scheduledByArticle.get(a.task.artigo) ?? 0) + 1);
  }
  // Add unscheduled
  for (const u of result.unscheduledTasks) {
    scheduledByArticle.set(u.artigo, (scheduledByArticle.get(u.artigo) ?? 0) + u.dosesRemaining);
  }
  for (const [artigo, planned] of dosesByArticle) {
    const total = scheduledByArticle.get(artigo) ?? 0;
    console.assert(total === planned, `[Scheduler] Overflow de doses: ${artigo} — planeado ${planned}, agendado ${total}`);
  }

  return {
    tasks,
    ...gantt,
    lunchStart,
    lunchEnd,
  };
}
