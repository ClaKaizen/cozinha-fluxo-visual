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

const roundUpToHalfHour = (minutes: number) => Math.ceil(minutes / 30) * 30;

export function normalizeDateKey(value: string): string {
  return value.slice(0, 10);
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

// No-lunch versions for machine scheduling
const NO_LUNCH = DAY_END + 999; // value that never triggers lunch logic

function createMachineSegments(start: number, duration: number): { start: number; end: number; segments: TimelineSegment[] } {
  return createSegments(start, duration, NO_LUNCH, NO_LUNCH);
}

function normalizeMachineCursor(cursor: number): number {
  return normalizeCursor(cursor, NO_LUNCH, NO_LUNCH);
}

export function formatClock(minutes: number): string {
  const safeMinutes = Math.max(0, Math.floor(minutes));
  const h = Math.floor(safeMinutes / 60);
  const m = safeMinutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

interface OperatorAssignment {
  task: PlanningTask;
  machineStart: number;
  machineLabel: string;
  machineTaskId: string;
  showSimultaneousBadge: boolean;
}

function buildWithLunch(
  tasks: PlanningTask[],
  equipment: Equipment[],
  equipmentMap: Map<string, Equipment>,
  operatorNames: string[],
  targetLunchStart: number,
  targetLunchEnd: number,
): Omit<DailyGanttSchedule, 'tasks' | 'lunchStart' | 'lunchEnd'> {
  const machineSlots = new Map<string, number[]>();
  equipment.forEach((eq) => {
    machineSlots.set(eq.id, Array.from({ length: eq.quantidade + eq.quantidadeEmergencia }, () => DAY_START));
  });

  const machineRowsMap = new Map<string, GanttRow<MachineTask>>();
  const machineTasks: MachineTask[] = [];
  const overflowTasks: string[] = [];

  const taskMachinesMap = new Map<string, MachineTask[]>();
  const emergencyEquipmentNames = new Set<string>();

  interface PhaseAssignment {
    booking: MachineBooking;
    machineIdx: number;
    scheduled: { start: number; end: number; segments: TimelineSegment[] };
  }

  const buildCombinations = (indices: number[], count: number): number[][] => {
    if (count === 0) return [[]];
    const results: number[][] = [];
    const current: number[] = [];

    const walk = (startIndex: number) => {
      if (current.length === count) {
        results.push([...current]);
        return;
      }
      for (let i = startIndex; i < indices.length; i++) {
        current.push(indices[i]);
        walk(i + 1);
        current.pop();
      }
    };

    walk(0);
    return results;
  };

  const buildBookingPhases = (task: PlanningTask) => {
    const sequentialPhases = task.machineBookings.filter((booking) => !booking.simultaneous).map((booking) => [booking]);
    const simultaneousPhase = task.machineBookings.filter((booking) => booking.simultaneous);
    return simultaneousPhase.length > 0 ? [...sequentialPhases, simultaneousPhase] : sequentialPhases;
  };

  // Machine scheduling: NO lunch break — machines run continuously
  const evaluatePhase = (
    phaseBookings: MachineBooking[],
    minStart: number,
    allowEmergency: boolean,
    requireWithinDay: boolean,
  ): PhaseAssignment[] | null => {
    const groupedBookings = new Map<string, MachineBooking[]>();
    phaseBookings.forEach((booking) => {
      const existing = groupedBookings.get(booking.equipmentId) ?? [];
      existing.push(booking);
      groupedBookings.set(booking.equipmentId, existing);
    });

    const comboEntries = Array.from(groupedBookings.entries()).map(([equipmentId, bookings]) => {
      const eq = equipmentMap.get(equipmentId);
      if (!eq) return null;
      const slotLimit = allowEmergency ? eq.quantidade + eq.quantidadeEmergencia : eq.quantidade;
      if (slotLimit < bookings.length) return null;
      const combos = buildCombinations(Array.from({ length: slotLimit }, (_, index) => index), bookings.length);
      return { equipmentId, bookings, combos };
    });

    if (comboEntries.some((entry) => entry === null)) return null;

    const entries = comboEntries as { equipmentId: string; bookings: MachineBooking[]; combos: number[][] }[];
    const selections: Array<{ equipmentId: string; bookings: MachineBooking[]; slotIndices: number[] }> = [];

    const search = (entryIndex: number): PhaseAssignment[] | null => {
      if (entryIndex >= entries.length) {
        const rawStart = Math.max(
          minStart,
          ...selections.flatMap((selection) =>
            selection.slotIndices.map((slotIndex) =>
              normalizeMachineCursor(
                Math.max(machineSlots.get(selection.equipmentId)?.[slotIndex] ?? DAY_START, minStart),
              ),
            ),
          ),
        );
        const phaseStart = normalizeMachineCursor(rawStart);
        const assignments: PhaseAssignment[] = [];

        for (const selection of selections) {
          selection.bookings.forEach((booking, bookingIndex) => {
            const machineIdx = selection.slotIndices[bookingIndex];
            const scheduled = createMachineSegments(phaseStart, booking.duration);
            if (requireWithinDay && scheduled.segments.some((segment) => segment.overflow)) {
              assignments.length = 0;
              return;
            }
            assignments.push({ booking, machineIdx, scheduled });
          });
          if (assignments.length === 0) return null;
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
  };

  const schedulePhase = (phaseBookings: MachineBooking[], minStart: number) => {
    const normalCandidate = evaluatePhase(phaseBookings, minStart, false, true);
    if (normalCandidate) return normalCandidate;

    const emergencyCandidate = evaluatePhase(phaseBookings, minStart, true, true);
    if (emergencyCandidate) return emergencyCandidate;

    return evaluatePhase(phaseBookings, minStart, true, false)
      ?? evaluatePhase(phaseBookings, minStart, false, false);
  };

  tasks.forEach((task) => {
    let phaseCursor = DAY_START;
    const taskMachineTasks: MachineTask[] = [];

    buildBookingPhases(task).forEach((phaseBookings) => {
      const assignments = schedulePhase(phaseBookings, phaseCursor);
      if (!assignments || assignments.length === 0) return;

      const phaseEnd = Math.max(...assignments.map((assignment) => assignment.scheduled.end));
      phaseCursor = phaseEnd;

      assignments.forEach(({ booking, machineIdx, scheduled }) => {
        const eq = equipmentMap.get(booking.equipmentId);
        if (!eq) return;

        machineSlots.get(booking.equipmentId)![machineIdx] = scheduled.end;
        const isEmergencyMachine = machineIdx >= eq.quantidade;
        const label = isEmergencyMachine
          ? `${booking.equipmentName} ${machineIdx + 1} ⚠️`
          : `${booking.equipmentName} ${machineIdx + 1}`;

        if (isEmergencyMachine) {
          emergencyEquipmentNames.add(eq.nome);
        }

        if (scheduled.segments.some((segment) => segment.overflow) && !overflowTasks.includes(task.doseLabel)) {
          overflowTasks.push(task.doseLabel);
        }

        const machineTask: MachineTask = {
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

        taskMachineTasks.push(machineTask);
        machineTasks.push(machineTask);
        const row = machineRowsMap.get(label) ?? { label, tasks: [] };
        row.tasks.push(machineTask);
        machineRowsMap.set(label, row);
      });
    });

    taskMachinesMap.set(task.id, taskMachineTasks);
  });

  equipment.forEach((eq) => {
    for (let i = 0; i < eq.quantidade; i++) {
      const label = `${eq.nome} ${i + 1}`;
      if (!machineRowsMap.has(label)) {
        machineRowsMap.set(label, { label, tasks: [] });
      }
    }
  });

  const machineRows = Array.from(machineRowsMap.values())
    .filter((row) => {
      if (row.label.includes("⚠️")) return row.tasks.length > 0;
      return true;
    })
    .sort((a, b) => {
      const aEmerg = a.label.includes("⚠️") ? 1 : 0;
      const bEmerg = b.label.includes("⚠️") ? 1 : 0;
      if (aEmerg !== bEmerg) return aEmerg - bEmerg;
      const am = a.label.match(/^(.*?) (\d+)/);
      const bm = b.label.match(/^(.*?) (\d+)/);
      return (am?.[1] ?? a.label).localeCompare(bm?.[1] ?? b.label) || Number(am?.[2] ?? 0) - Number(bm?.[2] ?? 0);
    });

  // ── STEP 3: Operator scheduling with PER-OPERATOR lunch breaks ──
  const allOperatorNames = operatorNames.length > 0 ? operatorNames : [];

  const operatorRowsMap = new Map<string, GanttRow<OperatorTask>>(
    allOperatorNames.map((name) => [name, { label: name, tasks: [] }])
  );

  const unscheduledTasks: UnscheduledTask[] = [];
  const operatorLunchBreaks: Record<string, OperatorLunchBreak> = {};

  // Initialize all operators with default lunch = target
  allOperatorNames.forEach((name) => {
    operatorLunchBreaks[name] = { start: targetLunchStart, end: targetLunchEnd };
  });

  const incrementUnscheduled = (artigo: string) => {
    const existing = unscheduledTasks.find((item) => item.artigo === artigo);
    if (existing) {
      existing.dosesRemaining += 1;
      return;
    }
    unscheduledTasks.push({ artigo, dosesRemaining: 1 });
  };

  if (allOperatorNames.length > 0) {
    // Build operator task sources from machine schedule
    const operatorSources = tasks
      .map((task) => {
        const relatedMachineTasks = taskMachinesMap.get(task.id) ?? [];
        if (relatedMachineTasks.length === 0) return null;

        const hasOverflow = relatedMachineTasks.some((machineTask) => machineTask.segments.some((segment) => segment.overflow));
        const firstStart = Math.min(...relatedMachineTasks.map((machineTask) => machineTask.start));
        const firstPhaseTasks = relatedMachineTasks
          .filter((machineTask) => machineTask.start === firstStart)
          .sort((a, b) => a.machineLabel.localeCompare(b.machineLabel));

        return {
          task,
          start: firstStart,
          machineLabel: firstPhaseTasks.map((machineTask) => machineTask.machineLabel).join(" + "),
          machineTaskId: firstPhaseTasks[0]?.id ?? task.id,
          showSimultaneousBadge: firstPhaseTasks.some((machineTask) => machineTask.showSimultaneousBadge),
          hasOverflow,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => a.start - b.start || a.machineLabel.localeCompare(b.machineLabel));

    // PASS 1: Assign tasks to operators using target lunch (determines WHO does WHAT)
    const operatorAvailability = new Map(allOperatorNames.map((name) => [name, DAY_START]));
    const operatorTotalMinutes = new Map(allOperatorNames.map((name) => [name, 0]));
    const assignmentsByOperator = new Map<string, OperatorAssignment[]>(
      allOperatorNames.map((name) => [name, []])
    );

    operatorSources.forEach(({ task, start, machineLabel, machineTaskId, showSimultaneousBadge, hasOverflow }) => {
      if (task.operatorDuration <= 0 || hasOverflow) return;

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

        if (chosen === null || total < chosenTotal || (total === chosenTotal && candidateStart < chosenStart)) {
          chosen = name;
          chosenStart = candidateStart;
          chosenTotal = total;
        }
      }

      if (chosen === null) {
        incrementUnscheduled(task.artigo);
        return;
      }

      // Record assignment
      assignmentsByOperator.get(chosen)!.push({ task, machineStart: start, machineLabel, machineTaskId, showSimultaneousBadge });

      // Update availability for next assignment (using target lunch for consistency in pass 1)
      const actualStart = normalizeCursor(Math.max(operatorAvailability.get(chosen) ?? DAY_START, start), targetLunchStart, targetLunchEnd);
      const scheduled = createSegments(actualStart, task.operatorDuration, targetLunchStart, targetLunchEnd);
      operatorAvailability.set(chosen, scheduled.end);
      operatorTotalMinutes.set(chosen, (operatorTotalMinutes.get(chosen) ?? 0) + task.operatorDuration);
    });

    // PASS 2: Calculate per-operator lunch and re-schedule with individual lunch breaks
    for (const [name, assignments] of assignmentsByOperator) {
      if (assignments.length === 0) continue;

      assignments.sort((a, b) => a.machineStart - b.machineStart);

      // Pass 2A: Simulate schedule WITHOUT lunch to find natural task positions
      let tempCursor = DAY_START;
      let opLunchStart = targetLunchStart;

      for (const a of assignments) {
        tempCursor = Math.max(tempCursor, a.machineStart);
        const tempEnd = tempCursor + a.task.operatorDuration;

        // Does this task naturally overlap with the target lunch window?
        if (a.machineStart < targetLunchStart + 30 && tempEnd > targetLunchStart) {
          if (tempEnd <= targetLunchStart + 45) {
            opLunchStart = Math.max(opLunchStart, tempEnd);
          } else {
            // Flag case: heavy workload, but still shift lunch
            opLunchStart = Math.max(opLunchStart, tempEnd);
          }
        }
        tempCursor = tempEnd;
      }

      const opLunchEnd = opLunchStart + 60;
      operatorLunchBreaks[name] = { start: opLunchStart, end: opLunchEnd };

      // Pass 2B: Re-schedule all tasks with the individual lunch break
      let cursor = DAY_START;
      for (const a of assignments) {
        cursor = Math.max(cursor, a.machineStart);
        cursor = normalizeCursor(cursor, opLunchStart, opLunchEnd);
        const scheduled = createSegments(cursor, a.task.operatorDuration, opLunchStart, opLunchEnd);

        const ot: OperatorTask = {
          ...a.task,
          operatorName: name,
          start: scheduled.start,
          end: scheduled.end,
          segments: scheduled.segments,
          machineTaskId: a.machineTaskId,
          machineLabel: a.machineLabel,
          showSimultaneousBadge: a.showSimultaneousBadge,
        };
        operatorRowsMap.get(name)?.tasks.push(ot);
        cursor = scheduled.end;
      }
    }
  }

  const operatorRows = Array.from(operatorRowsMap.values());
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
  };
}

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

        const simultaneousCount = bookings.filter((booking) => booking.simultaneous).length;
        bookings.forEach((booking) => {
          if (booking.simultaneous) {
            booking.showSimultaneousBadge = simultaneousCount > 1;
          }
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
      operatorLunchBreaks: {},
    };
  }

  const operatorNames = operatorsForDate
    .filter((e) => WORKING_CODES.includes(e.code) && !e.absent)
    .map((e) => e.operator.nome);

  const tempOpsForDate = tempOperators.filter((t) => t.date === selectedDate);
  const allOpNames = [...operatorNames, ...tempOpsForDate.map((t) => t.nome)];

  // Try 4 lunch target positions: 12:00, 12:30, 13:00, 13:30 start
  const lunchOptions: [number, number][] = [
    [12 * 60, 13 * 60],
    [12 * 60 + 30, 13 * 60 + 30],
    [13 * 60, 14 * 60],
    [13 * 60 + 30, 14 * 60 + 30],
  ];

  let bestResult: Omit<DailyGanttSchedule, 'tasks' | 'lunchStart' | 'lunchEnd'> | null = null;
  let bestScore = Infinity;
  let bestLunch: [number, number] = [13 * 60, 14 * 60];

  for (const [ls, le] of lunchOptions) {
    const result = buildWithLunch(tasks, equipment, equipmentMap, allOpNames, ls, le);
    const score = result.overflowTasks.length + result.unscheduledTasks.reduce((s, u) => s + u.dosesRemaining, 0);
    if (score < bestScore) {
      bestScore = score;
      bestResult = result;
      bestLunch = [ls, le];
    }
  }

  const best = bestResult!;
  const chosenLunchStart = bestLunch[0];
  const chosenLunchEnd = bestLunch[1];

  return {
    tasks,
    ...best,
    lunchStart: chosenLunchStart,
    lunchEnd: chosenLunchEnd,
  };
}
