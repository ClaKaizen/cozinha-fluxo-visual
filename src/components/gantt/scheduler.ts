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
export const LUNCH_START = 13 * 60; // 780
export const LUNCH_END = 14 * 60;   // 840
export const DAY_END = 16 * 60;     // 960
export const AVAILABLE_MACHINE_MINUTES = 480; // 540 total - 60 lunch

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

export interface DailyGanttSchedule {
  tasks: PlanningTask[];
  machineRows: GanttRow<MachineTask>[];
  operatorRows: GanttRow<OperatorTask>[];
  axisEnd: number;
  usesEmergencyEquipment: boolean;
  emergencyEquipmentNames: string[];
  overflowTasks: string[];
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

function normalizeCursor(cursor: number): number {
  if (cursor < DAY_START) return DAY_START;
  if (cursor >= LUNCH_START && cursor < LUNCH_END) return LUNCH_END;
  return cursor;
}

function createSegments(start: number, duration: number): { start: number; end: number; segments: TimelineSegment[] } {
  let cursor = normalizeCursor(start);
  const segments: TimelineSegment[] = [];
  const normalizedStart = cursor;
  let remaining = Math.max(0, duration);

  while (remaining > 0) {
    cursor = normalizeCursor(cursor);
    let nextBoundary = cursor + remaining;
    if (cursor < LUNCH_START) nextBoundary = Math.min(nextBoundary, LUNCH_START);
    if (cursor < DAY_END) nextBoundary = Math.min(nextBoundary, DAY_END);

    segments.push({
      start: cursor,
      end: nextBoundary,
      overflow: cursor >= DAY_END,
    });

    remaining -= nextBoundary - cursor;
    cursor = nextBoundary;
    if (remaining > 0 && cursor === LUNCH_START) cursor = LUNCH_END;
  }

  return { start: normalizedStart, end: cursor, segments };
}

export function formatClock(minutes: number): string {
  const safeMinutes = Math.max(0, Math.floor(minutes));
  const h = Math.floor(safeMinutes / 60);
  const m = safeMinutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

/**
 * Get working minutes available on a single machine (excluding lunch).
 */
function getWorkingMinutes(from: number, to: number): number {
  let total = 0;
  let cursor = Math.max(from, DAY_START);
  while (cursor < to) {
    cursor = normalizeCursor(cursor);
    if (cursor >= to) break;
    let next = to;
    if (cursor < LUNCH_START) next = Math.min(next, LUNCH_START);
    total += next - cursor;
    cursor = next;
    if (cursor === LUNCH_START) cursor = LUNCH_END;
  }
  return total;
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
    return { tasks: [], machineRows: [], operatorRows: [], axisEnd: DAY_END, usesEmergencyEquipment: false, emergencyEquipmentNames: [], overflowTasks: [] };
  }

  // ──────────────────────────────────────────────
  // STEP 1: Determine per-equipment time needed and whether emergency machines are required
  // ──────────────────────────────────────────────
  const equipmentTimeNeeded = new Map<string, number>();
  tasks.forEach((t) => {
    for (const booking of t.machineBookings) {
      equipmentTimeNeeded.set(booking.equipmentId, (equipmentTimeNeeded.get(booking.equipmentId) ?? 0) + booking.duration);
    }
  });

  const emergencyEquipmentNames: string[] = [];
  // Machine cursors: track end-time for each physical machine unit
  // machineSlots[equipmentId] = array of cursors (one per physical machine)
  const machineSlots = new Map<string, number[]>();

  equipment.forEach((eq) => {
    const needed = equipmentTimeNeeded.get(eq.id) ?? 0;
    const normalCapacity = eq.quantidade * AVAILABLE_MACHINE_MINUTES;

    if (needed > normalCapacity && eq.quantidadeEmergencia > 0) {
      // Activate emergency machines
      const totalMachines = eq.quantidade + eq.quantidadeEmergencia;
      machineSlots.set(eq.id, Array.from({ length: totalMachines }, () => DAY_START));
      emergencyEquipmentNames.push(eq.nome);
    } else {
      machineSlots.set(eq.id, Array.from({ length: eq.quantidade }, () => DAY_START));
    }
  });

  const usesEmergency = emergencyEquipmentNames.length > 0;

  // ──────────────────────────────────────────────
  // STEP 2: Schedule machines — PACK DENSELY (fill machine 1 before machine 2)
  // ──────────────────────────────────────────────
  const machineRowsMap = new Map<string, GanttRow<MachineTask>>();
  const machineTasks: MachineTask[] = [];
  const overflowTasks: string[] = [];

  function findDensiestSlot(equipmentId: string, minStart: number): { machineIdx: number; cursor: number } {
    const slots = machineSlots.get(equipmentId);
    if (!slots || slots.length === 0) return { machineIdx: 0, cursor: DAY_START };

    // Priority: pack densely — pick the machine with the HIGHEST cursor that is still <= minStart,
    // or if all are past minStart, pick the one with the LOWEST cursor (earliest available)
    let bestIdx = 0;
    let bestCursor = normalizeCursor(Math.max(slots[0], minStart));

    // Strategy: fill machines sequentially — prefer lowest-index machine that's available
    for (let j = 0; j < slots.length; j++) {
      const available = normalizeCursor(Math.max(slots[j], minStart));
      // Prefer machine with lowest index that can start earliest (pack first machines)
      if (j === 0 || available < bestCursor) {
        // But for packing: prefer the machine that already has tasks (highest cursor among those ready)
        bestIdx = j;
        bestCursor = available;
      }
    }

    // Actually for "fill Machine 1 completely before Machine 2":
    // Pick the lowest-index machine whose cursor allows starting
    for (let j = 0; j < slots.length; j++) {
      const available = normalizeCursor(Math.max(slots[j], minStart));
      if (available <= bestCursor) {
        bestIdx = j;
        bestCursor = available;
        break; // take first (lowest index) that ties for earliest
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
    const scheduled = createSegments(cursor, booking.duration);
    slots[machineIdx] = scheduled.end;

    const isEmergencyMachine = machineIdx >= eq.quantidade;
    const label = isEmergencyMachine
      ? `${booking.equipmentName} ${machineIdx + 1} ⚠️`
      : `${booking.equipmentName} ${machineIdx + 1}`;

    // Check overflow
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

  // Schedule tasks — fill machines densely
  tasks.forEach((task) => {
    const seqBookings = task.machineBookings.filter((b) => !b.simultaneous);
    const simBookings = task.machineBookings.filter((b) => b.simultaneous);

    // Start: find earliest available on any involved equipment
    let seqEnd = DAY_START;

    // Sequential bookings first
    for (const booking of seqBookings) {
      const mt = scheduleBookingDense(booking, task, seqEnd);
      if (mt) seqEnd = mt.end;
    }

    // Simultaneous bookings all start after sequential are done
    for (const booking of simBookings) {
      scheduleBookingDense(booking, task, seqEnd);
    }
  });

  // Sort machine rows: normal first, emergency last; only include rows with tasks
  const machineRows = Array.from(machineRowsMap.values())
    .filter((row) => row.tasks.length > 0)
    .sort((a, b) => {
      const aEmerg = a.label.includes("⚠️") ? 1 : 0;
      const bEmerg = b.label.includes("⚠️") ? 1 : 0;
      if (aEmerg !== bEmerg) return aEmerg - bEmerg;
      const am = a.label.match(/^(.*?) (\d+)/);
      const bm = b.label.match(/^(.*?) (\d+)/);
      return (am?.[1] ?? a.label).localeCompare(bm?.[1] ?? b.label) || Number(am?.[2] ?? 0) - Number(bm?.[2] ?? 0);
    });

  // ──────────────────────────────────────────────
  // STEP 3: Operator scheduling — balance load across operators, cap at 480 min
  // ──────────────────────────────────────────────
  const operatorNames = operatorsForDate
    .filter((e) => WORKING_CODES.includes(e.code) && !e.absent)
    .map((e) => e.operator.nome);

  const allOperatorNames = operatorNames.length > 0 ? operatorNames :
    operatorsForDate.map((e) => e.operator.nome);

  const operatorRowsMap = new Map<string, GanttRow<OperatorTask>>(
    allOperatorNames.map((name) => [name, { label: name, tasks: [] }])
  );

  if (allOperatorNames.length > 0) {
    const operatorAvailability = new Map(allOperatorNames.map((name) => [name, DAY_START]));
    const operatorTotalMinutes = new Map(allOperatorNames.map((name) => [name, 0]));

    const machineOrder = [...machineTasks].sort((a, b) => a.start - b.start || a.machineLabel.localeCompare(b.machineLabel));

    machineOrder.forEach((task) => {
      if (task.operatorDuration <= 0) return;

      // Find least-loaded operator who is available and won't exceed 480 min
      let chosen: string | null = null;
      let chosenStart = Infinity;
      let chosenTotal = Infinity;

      for (const name of allOperatorNames) {
        const avail = operatorAvailability.get(name) ?? DAY_START;
        const total = operatorTotalMinutes.get(name) ?? 0;
        const candidateStart = normalizeCursor(Math.max(avail, task.start));

        // Skip if this would exceed 480 min
        if (total + task.operatorDuration > AVAILABLE_MACHINE_MINUTES) continue;

        // Prefer least-loaded, then earliest available
        if (chosen === null || total < chosenTotal || (total === chosenTotal && candidateStart < chosenStart)) {
          chosen = name;
          chosenStart = candidateStart;
          chosenTotal = total;
        }
      }

      // If all operators would exceed 480 min, pick the least-loaded anyway
      if (chosen === null) {
        for (const name of allOperatorNames) {
          const avail = operatorAvailability.get(name) ?? DAY_START;
          const total = operatorTotalMinutes.get(name) ?? 0;
          const candidateStart = normalizeCursor(Math.max(avail, task.start));
          if (chosen === null || total < chosenTotal || (total === chosenTotal && candidateStart < chosenStart)) {
            chosen = name;
            chosenStart = candidateStart;
            chosenTotal = total;
          }
        }
      }

      if (!chosen) return;

      const actualStart = normalizeCursor(Math.max(operatorAvailability.get(chosen) ?? DAY_START, task.start));
      const scheduled = createSegments(actualStart, task.operatorDuration);
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

  void tempOperators;

  return {
    tasks,
    machineRows,
    operatorRows,
    axisEnd: roundUpToHalfHour(latestEnd),
    usesEmergencyEquipment: usesEmergency,
    emergencyEquipmentNames,
    overflowTasks,
  };
}
