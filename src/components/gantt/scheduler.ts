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
export const AVAILABLE_MACHINE_MINUTES = 480; // 9h total - 1h lunch = 8h

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
}

export interface OperatorTask extends PlanningTask {
  operatorName: string;
  start: number;
  end: number;
  segments: TimelineSegment[];
  machineTaskId: string;
}

export interface GanttRow<TTask> {
  label: string;
  tasks: TTask[];
}

export interface UnscheduledTask {
  artigo: string;
  dosesRemaining: number;
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

export function formatClock(minutes: number): string {
  const safeMinutes = Math.max(0, Math.floor(minutes));
  const h = Math.floor(safeMinutes / 60);
  const m = safeMinutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function buildWithLunch(
  tasks: PlanningTask[],
  equipment: Equipment[],
  equipmentMap: Map<string, Equipment>,
  operatorNames: string[],
  lunchStart: number,
  lunchEnd: number,
): Omit<DailyGanttSchedule, 'tasks' | 'lunchStart' | 'lunchEnd'> {
  // ── STEP 1: Determine emergency needs & create machine slots ──
  const equipmentTimeNeeded = new Map<string, number>();
  tasks.forEach((t) => {
    for (const booking of t.machineBookings) {
      equipmentTimeNeeded.set(booking.equipmentId, (equipmentTimeNeeded.get(booking.equipmentId) ?? 0) + booking.duration);
    }
  });

  const emergencyEquipmentNames: string[] = [];
  const machineSlots = new Map<string, number[]>();

  equipment.forEach((eq) => {
    const needed = equipmentTimeNeeded.get(eq.id) ?? 0;
    const normalCapacity = eq.quantidade * AVAILABLE_MACHINE_MINUTES;

    if (needed > normalCapacity && eq.quantidadeEmergencia > 0) {
      const totalMachines = eq.quantidade + eq.quantidadeEmergencia;
      machineSlots.set(eq.id, Array.from({ length: totalMachines }, () => DAY_START));
      emergencyEquipmentNames.push(eq.nome);
    } else {
      machineSlots.set(eq.id, Array.from({ length: eq.quantidade }, () => DAY_START));
    }
  });

  // ── STEP 2: Schedule machines densely ──
  const machineRowsMap = new Map<string, GanttRow<MachineTask>>();
  const machineTasks: MachineTask[] = [];
  const overflowTasks: string[] = [];

  function findDensiestSlot(equipmentId: string, minStart: number): { machineIdx: number; cursor: number } {
    const slots = machineSlots.get(equipmentId);
    if (!slots || slots.length === 0) return { machineIdx: 0, cursor: DAY_START };

    // Prefer lowest-indexed machine that hasn't reached DAY_END (fill Machine 1 before Machine 2)
    for (let j = 0; j < slots.length; j++) {
      const available = normalizeCursor(Math.max(slots[j], minStart), lunchStart, lunchEnd);
      if (available < DAY_END) {
        return { machineIdx: j, cursor: available };
      }
    }

    // All machines past DAY_END — pick the one with earliest cursor for overflow
    let bestIdx = 0;
    let bestCursor = normalizeCursor(Math.max(slots[0], minStart), lunchStart, lunchEnd);
    for (let j = 1; j < slots.length; j++) {
      const available = normalizeCursor(Math.max(slots[j], minStart), lunchStart, lunchEnd);
      if (available < bestCursor) {
        bestIdx = j;
        bestCursor = available;
      }
    }
    return { machineIdx: bestIdx, cursor: bestCursor };
  }

  function scheduleBookingDense(
    booking: MachineBooking,
    task: PlanningTask,
    minStart: number,
  ): MachineTask | null {
    const eq = equipmentMap.get(booking.equipmentId);
    const slots = machineSlots.get(booking.equipmentId);
    if (!slots || slots.length === 0 || !eq) return null;

    const { machineIdx, cursor } = findDensiestSlot(booking.equipmentId, minStart);
    const scheduled = createSegments(cursor, booking.duration, lunchStart, lunchEnd);
    slots[machineIdx] = scheduled.end;

    const isEmergencyMachine = machineIdx >= eq.quantidade;
    const label = isEmergencyMachine
      ? `${booking.equipmentName} ${machineIdx + 1} ⚠️`
      : `${booking.equipmentName} ${machineIdx + 1}`;

    const hasOverflow = scheduled.segments.some((s) => s.overflow);
    if (hasOverflow && !overflowTasks.includes(task.doseLabel)) {
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
    };
    machineTasks.push(mt);
    const row = machineRowsMap.get(label) ?? { label, tasks: [] };
    row.tasks.push(mt);
    machineRowsMap.set(label, row);
    return mt;
  }

  tasks.forEach((task) => {
    const seqBookings = task.machineBookings.filter((b) => !b.simultaneous);
    const simBookings = task.machineBookings.filter((b) => b.simultaneous);

    let seqEnd = DAY_START;
    for (const booking of seqBookings) {
      const mt = scheduleBookingDense(booking, task, seqEnd);
      if (mt) seqEnd = mt.end;
    }
    for (const booking of simBookings) {
      scheduleBookingDense(booking, task, seqEnd);
    }
  });

  // Pre-create rows for ALL normal machines (and emergency if activated)
  equipment.forEach((eq) => {
    const slots = machineSlots.get(eq.id);
    if (!slots) return;
    for (let i = 0; i < slots.length; i++) {
      const isEmergency = i >= eq.quantidade;
      const label = isEmergency
        ? `${eq.nome} ${i + 1} ⚠️`
        : `${eq.nome} ${i + 1}`;
      if (!machineRowsMap.has(label)) {
        machineRowsMap.set(label, { label, tasks: [] });
      }
    }
  });

  const machineRows = Array.from(machineRowsMap.values())
    .filter((row) => {
      // Always show normal machines; only show emergency if they have tasks
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

  // ── STEP 3: Operator scheduling — balance load, hard cap 480 min ──
  const allOperatorNames = operatorNames.length > 0 ? operatorNames : [];

  const operatorRowsMap = new Map<string, GanttRow<OperatorTask>>(
    allOperatorNames.map((name) => [name, { label: name, tasks: [] }])
  );

  const unscheduledTasks: UnscheduledTask[] = [];

  if (allOperatorNames.length > 0) {
    const operatorAvailability = new Map(allOperatorNames.map((name) => [name, DAY_START]));
    const operatorTotalMinutes = new Map(allOperatorNames.map((name) => [name, 0]));

    const machineOrder = [...machineTasks].sort((a, b) => a.start - b.start || a.machineLabel.localeCompare(b.machineLabel));

    machineOrder.forEach((task) => {
      if (task.operatorDuration <= 0) return;
      // Skip overflow machine tasks for operator assignment
      if (task.segments.some((s) => s.overflow)) return;

      // Find least-loaded operator who won't exceed 480 min
      let chosen: string | null = null;
      let chosenStart = Infinity;
      let chosenTotal = Infinity;

      for (const name of allOperatorNames) {
        const avail = operatorAvailability.get(name) ?? DAY_START;
        const total = operatorTotalMinutes.get(name) ?? 0;
        const candidateStart = normalizeCursor(Math.max(avail, task.start), lunchStart, lunchEnd);

        if (total + task.operatorDuration > AVAILABLE_MACHINE_MINUTES) continue;

        // Check if task would finish before 16:00
        const testSeg = createSegments(candidateStart, task.operatorDuration, lunchStart, lunchEnd);
        if (testSeg.segments.some((s) => s.overflow)) continue;

        if (chosen === null || total < chosenTotal || (total === chosenTotal && candidateStart < chosenStart)) {
          chosen = name;
          chosenStart = candidateStart;
          chosenTotal = total;
        }
      }

      // If no operator can take it without exceeding cap or overflowing, mark unscheduled
      if (chosen === null) {
        // Track as unscheduled
        const existing = unscheduledTasks.find((u) => u.artigo === task.artigo);
        if (existing) {
          existing.dosesRemaining++;
        } else {
          unscheduledTasks.push({ artigo: task.artigo, dosesRemaining: 1 });
        }
        return;
      }

      const actualStart = normalizeCursor(Math.max(operatorAvailability.get(chosen) ?? DAY_START, task.start), lunchStart, lunchEnd);
      const scheduled = createSegments(actualStart, task.operatorDuration, lunchStart, lunchEnd);
      operatorAvailability.set(chosen, scheduled.end);
      operatorTotalMinutes.set(chosen, (operatorTotalMinutes.get(chosen) ?? 0) + task.operatorDuration);

      const ot: OperatorTask = {
        ...task,
        operatorName: chosen,
        start: scheduled.start,
        end: scheduled.end,
        segments: scheduled.segments,
        machineTaskId: task.id,
      };
      operatorRowsMap.get(chosen)?.tasks.push(ot);
    });
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
    usesEmergencyEquipment: emergencyEquipmentNames.length > 0,
    emergencyEquipmentNames,
    overflowTasks,
    unscheduledTasks,
    hasOvertime,
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

  // Expand production into per-dose tasks
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

        const bookings: MachineBooking[] = [];
        if (tMaqPrimary > 0) {
          bookings.push({
            equipmentId: machine.id,
            equipmentName: machine.nome,
            duration: tMaqPrimary,
            simultaneous: true,
            colorIndex: (equipmentIndex.get(machine.id) ?? 0) % 6,
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
              colorIndex: (equipmentIndex.get(extraEq.id) ?? 0) % 6,
            });
          }
        }

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
          colorIndex: (equipmentIndex.get(machine.id) ?? 0) % 6,
          isEmergency: false,
          machineBookings: bookings.length > 0 ? bookings : [{
            equipmentId: machine.id,
            equipmentName: machine.nome,
            duration: tMaqPrimary,
            simultaneous: true,
            colorIndex: (equipmentIndex.get(machine.id) ?? 0) % 6,
          }],
        });
      }
    });

  if (tasks.length === 0) {
    return {
      tasks: [], machineRows: [], operatorRows: [], axisEnd: DAY_END,
      usesEmergencyEquipment: false, emergencyEquipmentNames: [], overflowTasks: [],
      unscheduledTasks: [], lunchStart: 13 * 60, lunchEnd: 14 * 60, hasOvertime: false,
    };
  }

  const operatorNames = operatorsForDate
    .filter((e) => WORKING_CODES.includes(e.code) && !e.absent)
    .map((e) => e.operator.nome);

  // Add temp operators
  const tempOpsForDate = tempOperators.filter((t) => t.date === selectedDate);
  const allOpNames = [...operatorNames, ...tempOpsForDate.map((t) => t.nome)];

  // Try both lunch positions: 12:00-13:00 and 13:00-14:00
  const LUNCH_A_START = 12 * 60; // 720
  const LUNCH_A_END = 13 * 60;   // 780
  const LUNCH_B_START = 13 * 60; // 780
  const LUNCH_B_END = 14 * 60;   // 840

  const resultA = buildWithLunch(tasks, equipment, equipmentMap, allOpNames, LUNCH_A_START, LUNCH_A_END);
  const resultB = buildWithLunch(tasks, equipment, equipmentMap, allOpNames, LUNCH_B_START, LUNCH_B_END);

  // Pick the one with fewer overflows/unscheduled
  const scoreA = resultA.overflowTasks.length + resultA.unscheduledTasks.reduce((s, u) => s + u.dosesRemaining, 0);
  const scoreB = resultB.overflowTasks.length + resultB.unscheduledTasks.reduce((s, u) => s + u.dosesRemaining, 0);

  const bestIsA = scoreA < scoreB;
  const best = bestIsA ? resultA : (scoreB < scoreA ? resultB : resultB); // default to 13:00 if tied
  const chosenLunchStart = bestIsA ? LUNCH_A_START : LUNCH_B_START;
  const chosenLunchEnd = bestIsA ? LUNCH_A_END : LUNCH_B_END;

  void tempOperators;

  return {
    tasks,
    ...best,
    lunchStart: chosenLunchStart,
    lunchEnd: chosenLunchEnd,
  };
}
