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

  // Expand production into per-dose tasks
  const tasks: PlanningTask[] = [];
  production
    .filter((entry) => normalizeDateKey(entry.date) === selectedDate)
    .forEach((entry) => {
      const cat = categoryMap.get(entry.categoriaId);
      const machine = cat ? equipmentMap.get(cat.equipamentoId) : undefined;
      if (!cat || !machine) return;

      for (let i = 0; i < entry.quantidade; i++) {
        const tHomem = i === 0 ? (cat.tempoCicloHomem1 ?? cat.tempoCicloHomem) : cat.tempoCicloHomem;
        const tMaq = i === 0 ? (cat.tempoCicloMaquina1 ?? cat.tempoCicloMaquina) : cat.tempoCicloMaquina;
        const duration = tHomem + tMaq;
        if (duration <= 0) continue;

        tasks.push({
          id: `${entry.id}-d${i}`,
          artigo: entry.artigo,
          doseLabel: entry.quantidade > 1 ? `${entry.artigo} (${i + 1}/${entry.quantidade})` : entry.artigo,
          equipmentId: machine.id,
          equipmentName: machine.nome,
          categoryName: cat.nome,
          machineDuration: duration,
          operatorDuration: tHomem,
          colorIndex: (equipmentIndex.get(machine.id) ?? 0) % 6,
          isEmergency: false,
        });
      }
    });

  if (tasks.length === 0) {
    return { tasks: [], machineRows: [], operatorRows: [], axisEnd: DAY_END, usesEmergencyEquipment: false, emergencyEquipmentNames: [] };
  }

  // Step 1: Check per-equipment if normal capacity suffices
  const equipmentTimeNeeded = new Map<string, number>();
  tasks.forEach((t) => {
    equipmentTimeNeeded.set(t.equipmentId, (equipmentTimeNeeded.get(t.equipmentId) ?? 0) + t.machineDuration);
  });

  const emergencyEquipmentNames: string[] = [];
  const machineAvailability = new Map<string, number[]>();

  equipment.forEach((eq) => {
    const needed = equipmentTimeNeeded.get(eq.id) ?? 0;
    const normalCapacity = eq.quantidade * 480;
    
    if (needed > normalCapacity && eq.quantidadeEmergencia > 0) {
      // Need emergency machines for this equipment
      const totalMachines = eq.quantidade + eq.quantidadeEmergencia;
      machineAvailability.set(eq.id, Array.from({ length: totalMachines }, () => DAY_START));
      emergencyEquipmentNames.push(eq.nome);
    } else {
      machineAvailability.set(eq.id, Array.from({ length: eq.quantidade }, () => DAY_START));
    }
  });

  const usesEmergency = emergencyEquipmentNames.length > 0;

  // Schedule all tasks
  const machineRowsMap = new Map<string, GanttRow<MachineTask>>();
  const machineTasks: MachineTask[] = [];

  tasks.forEach((task) => {
    const eq = equipmentMap.get(task.equipmentId);
    const avail = machineAvailability.get(task.equipmentId);
    if (!avail || avail.length === 0 || !eq) return;

    let machineIdx = 0;
    let earliest = avail[0];
    for (let i = 1; i < avail.length; i++) {
      if (avail[i] < earliest) { earliest = avail[i]; machineIdx = i; }
    }

    const scheduled = createSegments(earliest, task.machineDuration);
    avail[machineIdx] = scheduled.end;

    const isEmergencyMachine = machineIdx >= eq.quantidade;
    const label = isEmergencyMachine
      ? `${task.equipmentName} ${machineIdx + 1} ⚠️`
      : `${task.equipmentName} ${machineIdx + 1}`;

    const mt: MachineTask = {
      ...task,
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
