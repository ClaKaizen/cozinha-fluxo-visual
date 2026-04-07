import {
  Category,
  Equipment,
  Operator,
  ProductionEntry,
  ShiftCode,
  TempOperator,
  WORKING_CODES,
} from "@/store/types";

export const DAY_START = 7 * 60;   // 420
export const LUNCH_START = 13 * 60; // 780
export const LUNCH_END = 14 * 60;   // 840
export const DAY_END = 16 * 60;       // 960

export interface TimelineSegment {
  start: number;
  end: number;
  overflow: boolean;
}

export interface MachineBooking {
  equipmentId: string;
  equipmentName: string;
  duration: number;
  simultaneous: boolean; // true = runs at same time as primary
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

  // Expand production into per-dose tasks with multi-equipment bookings
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

        // Build machine bookings: primary + additional equipment
        const bookings: MachineBooking[] = [];

        // Primary equipment booking (always simultaneous=true as it's the reference)
        if (tMaqPrimary > 0) {
          bookings.push({
            equipmentId: machine.id,
            equipmentName: machine.nome,
            duration: tMaqPrimary,
            simultaneous: true,
            colorIndex: (equipmentIndex.get(machine.id) ?? 0) % 6,
          });
        }

        // Additional equipment from category config
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

        // Calculate wall-clock machine duration:
        // Sequential bookings run one after another, simultaneous ones overlap
        const seqBookings = bookings.filter((b) => !b.simultaneous);
        const simBookings = bookings.filter((b) => b.simultaneous);
        const seqTotal = seqBookings.reduce((s, b) => s + b.duration, 0);
        const simMax = simBookings.length > 0 ? Math.max(...simBookings.map((b) => b.duration)) : 0;
        const totalMachineDuration = seqTotal + simMax;
        const duration = tHomem + totalMachineDuration;
        if (duration <= 0 && bookings.length === 0) continue;

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
    return { tasks: [], machineRows: [], operatorRows: [], axisEnd: DAY_END, usesEmergencyEquipment: false, emergencyEquipmentNames: [] };
  }

  // Step 1: Check per-equipment if normal capacity suffices
  // Accumulate time needed per equipment from all bookings
  const equipmentTimeNeeded = new Map<string, number>();
  tasks.forEach((t) => {
    for (const booking of t.machineBookings) {
      equipmentTimeNeeded.set(booking.equipmentId, (equipmentTimeNeeded.get(booking.equipmentId) ?? 0) + booking.duration);
    }
  });

  const emergencyEquipmentNames: string[] = [];
  const machineAvailability = new Map<string, number[]>();

  equipment.forEach((eq) => {
    const needed = equipmentTimeNeeded.get(eq.id) ?? 0;
    const normalCapacity = eq.quantidade * 480;
    
    if (needed > normalCapacity && eq.quantidadeEmergencia > 0) {
      const totalMachines = eq.quantidade + eq.quantidadeEmergencia;
      machineAvailability.set(eq.id, Array.from({ length: totalMachines }, () => DAY_START));
      emergencyEquipmentNames.push(eq.nome);
    } else {
      machineAvailability.set(eq.id, Array.from({ length: eq.quantidade }, () => DAY_START));
    }
  });

  const usesEmergency = emergencyEquipmentNames.length > 0;

  // Schedule all tasks — handle multi-equipment bookings
  const machineRowsMap = new Map<string, GanttRow<MachineTask>>();
  const machineTasks: MachineTask[] = [];

  function scheduleBookingOnEquipment(
    booking: MachineBooking,
    task: PlanningTask,
    minStart: number,
  ): MachineTask | null {
    const eq = equipmentMap.get(booking.equipmentId);
    const avail = machineAvailability.get(booking.equipmentId);
    if (!avail || avail.length === 0 || !eq) return null;

    // Find earliest machine that is available at or after minStart
    let machineIdx = 0;
    let earliest = Math.max(avail[0], minStart);
    for (let j = 1; j < avail.length; j++) {
      const candidate = Math.max(avail[j], minStart);
      if (candidate < earliest) { earliest = candidate; machineIdx = j; }
    }

    const scheduled = createSegments(earliest, booking.duration);
    avail[machineIdx] = scheduled.end;

    const isEmergencyMachine = machineIdx >= eq.quantidade;
    const label = isEmergencyMachine
      ? `${booking.equipmentName} ${machineIdx + 1} ⚠️`
      : `${booking.equipmentName} ${machineIdx + 1}`;

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

    // Schedule sequential bookings first, one after the other
    let cursor = DAY_START;
    // Find the earliest any involved equipment is available
    for (const booking of task.machineBookings) {
      const avail = machineAvailability.get(booking.equipmentId);
      if (avail) {
        const minAvail = Math.min(...avail);
        cursor = Math.max(cursor, minAvail);
      }
    }
    // Actually, for proper scheduling we need to find the earliest slot per equipment
    // Start with the earliest possible
    let seqEnd = normalizeCursor(cursor);

    for (const booking of seqBookings) {
      const mt = scheduleBookingOnEquipment(booking, task, seqEnd);
      if (mt) seqEnd = mt.end;
    }

    // Schedule simultaneous bookings all starting from seqEnd
    for (const booking of simBookings) {
      scheduleBookingOnEquipment(booking, task, seqEnd);
    }
  });

  // Sort machine rows: normal first, then emergency
  const machineRows = Array.from(machineRowsMap.values()).sort((a, b) => {
    const aEmerg = a.label.includes("⚠️") ? 1 : 0;
    const bEmerg = b.label.includes("⚠️") ? 1 : 0;
    if (aEmerg !== bEmerg) return aEmerg - bEmerg;
    const am = a.label.match(/^(.*?) (\d+)/);
    const bm = b.label.match(/^(.*?) (\d+)/);
    return (am?.[1] ?? a.label).localeCompare(bm?.[1] ?? b.label) || Number(am?.[2] ?? 0) - Number(bm?.[2] ?? 0);
  });

  // Operator scheduling
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
    const machineOrder = [...machineTasks].sort((a, b) => a.start - b.start || a.machineLabel.localeCompare(b.machineLabel));

    machineOrder.forEach((task) => {
      if (task.operatorDuration <= 0) return;

      let chosen = allOperatorNames[0];
      let chosenStart = normalizeCursor(Math.max(operatorAvailability.get(chosen) ?? DAY_START, task.start));

      for (const name of allOperatorNames) {
        const avail = operatorAvailability.get(name) ?? DAY_START;
        const candidateStart = normalizeCursor(Math.max(avail, task.start));
        if (candidateStart < chosenStart) { chosen = name; chosenStart = candidateStart; }
      }

      const scheduled = createSegments(chosenStart, task.operatorDuration);
      operatorAvailability.set(chosen, scheduled.end);

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
  };
}
