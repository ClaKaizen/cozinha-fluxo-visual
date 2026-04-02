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
export const DAY_END = 15 * 60 + 30; // 930

export interface TimelineSegment {
  start: number;
  end: number;
  overflow: boolean;
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
}

export interface MachineTask extends PlanningTask {
  machineIndex: number;
  machineLabel: string;
  start: number;
  end: number;
  segments: TimelineSegment[];
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
          isEmergency: machine.emergencia ?? false,
        });
      }
    });

  if (tasks.length === 0) {
    return { tasks: [], machineRows: [], operatorRows: [], axisEnd: DAY_END, usesEmergencyEquipment: false };
  }

  // Separate normal and emergency equipment
  const normalEquipment = equipment.filter((e) => !e.emergencia);
  const emergencyEquipment = equipment.filter((e) => e.emergencia);

  // Phase 1: schedule on normal equipment
  const machineAvailability = new Map<string, number[]>();
  normalEquipment.forEach((item) => {
    machineAvailability.set(item.id, Array.from({ length: item.quantidade }, () => DAY_START));
  });

  const machineRowsMap = new Map<string, GanttRow<MachineTask>>();
  const machineTasks: MachineTask[] = [];
  const overflowTasks: PlanningTask[] = [];
  let usesEmergency = false;

  const scheduleTasks = (taskList: PlanningTask[], availability: Map<string, number[]>) => {
    taskList.forEach((task) => {
      const avail = availability.get(task.equipmentId);
      if (!avail || avail.length === 0) {
        overflowTasks.push(task);
        return;
      }

      let machineIdx = 0;
      let earliest = avail[0];
      for (let i = 1; i < avail.length; i++) {
        if (avail[i] < earliest) { earliest = avail[i]; machineIdx = i; }
      }

      const scheduled = createSegments(earliest, task.machineDuration);
      avail[machineIdx] = scheduled.end;

      const label = `${task.equipmentName} ${machineIdx + 1}`;
      const mt: MachineTask = {
        ...task,
        machineIndex: machineIdx,
        machineLabel: label,
        start: scheduled.start,
        end: scheduled.end,
        segments: scheduled.segments,
      };
      machineTasks.push(mt);
      const row = machineRowsMap.get(label) ?? { label, tasks: [] };
      row.tasks.push(mt);
      machineRowsMap.set(label, row);
    });
  };

  // Schedule normal tasks first
  const normalTasks = tasks.filter((t) => !t.isEmergency);
  const emergencyTasks = tasks.filter((t) => t.isEmergency);
  scheduleTasks(normalTasks, machineAvailability);

  // Check for overflow — if tasks go past DAY_END, try emergency equipment
  const hasOverflow = machineTasks.some((t) => t.end > DAY_END);
  if ((hasOverflow || overflowTasks.length > 0) && emergencyEquipment.length > 0) {
    emergencyEquipment.forEach((item) => {
      if (!machineAvailability.has(item.id)) {
        machineAvailability.set(item.id, Array.from({ length: item.quantidade }, () => DAY_START));
      }
    });
    usesEmergency = true;
  }

  // Schedule emergency-tagged tasks
  if (emergencyTasks.length > 0) {
    emergencyEquipment.forEach((item) => {
      if (!machineAvailability.has(item.id)) {
        machineAvailability.set(item.id, Array.from({ length: item.quantidade }, () => DAY_START));
      }
    });
    scheduleTasks(emergencyTasks, machineAvailability);
    if (emergencyTasks.length > 0) usesEmergency = true;
  }

  // Sort machine rows
  const machineRows = Array.from(machineRowsMap.values()).sort((a, b) => {
    const am = a.label.match(/^(.*) (\d+)$/);
    const bm = b.label.match(/^(.*) (\d+)$/);
    return (am?.[1] ?? a.label).localeCompare(bm?.[1] ?? b.label) || Number(am?.[2] ?? 0) - Number(bm?.[2] ?? 0);
  });

  // Operator scheduling
  const operatorNames = operatorsForDate
    .filter((e) => WORKING_CODES.includes(e.code) && !e.absent)
    .map((e) => e.operator.nome);

  // Fallback: if no operators from schedule, use all operators
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
  };
}
