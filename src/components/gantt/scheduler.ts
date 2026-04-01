import {
  Category,
  Equipment,
  Operator,
  ProductionEntry,
  ShiftCode,
  TempOperator,
  WORKING_CODES,
} from "@/store/types";

export const DAY_START = 7 * 60;
export const LUNCH_START = 13 * 60;
export const LUNCH_END = 14 * 60;
export const DAY_END = 15 * 60 + 30;

export interface TimelineSegment {
  start: number;
  end: number;
  overflow: boolean;
}

export interface PlanningTask {
  id: string;
  artigo: string;
  equipmentId: string;
  equipmentName: string;
  categoryName: string;
  machineDuration: number;
  operatorDuration: number;
  colorIndex: number;
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
    if (cursor < LUNCH_START) {
      nextBoundary = Math.min(nextBoundary, LUNCH_START);
    }
    if (cursor < DAY_END) {
      nextBoundary = Math.min(nextBoundary, DAY_END);
    }

    segments.push({
      start: cursor,
      end: nextBoundary,
      overflow: cursor >= DAY_END,
    });

    remaining -= nextBoundary - cursor;
    cursor = nextBoundary;

    if (remaining > 0 && cursor === LUNCH_START) {
      cursor = LUNCH_END;
    }
  }

  return { start: normalizedStart, end: cursor, segments };
}

export function formatClock(minutes: number): string {
  const safeMinutes = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
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
  const equipmentIndex = new Map(equipment.map((item, index) => [item.id, index]));
  const categoryMap = new Map(categories.map((item) => [item.id, item]));
  const equipmentMap = new Map(equipment.map((item) => [item.id, item]));

  const tasks = production
    .filter((entry) => normalizeDateKey(entry.date) === selectedDate)
    .map((entry) => {
      const category = categoryMap.get(entry.categoriaId);
      const machine = category ? equipmentMap.get(category.equipamentoId) : undefined;

      if (!category || !machine) return null;

      return {
        id: entry.id,
        artigo: entry.artigo,
        equipmentId: machine.id,
        equipmentName: machine.nome,
        categoryName: category.nome,
        machineDuration: entry.quantidade * (category.tempoCicloHomem + category.tempoCicloMaquina),
        operatorDuration: entry.quantidade * category.tempoCicloHomem,
        colorIndex: (equipmentIndex.get(machine.id) ?? 0) % 6,
      } satisfies PlanningTask;
    })
    .filter((task): task is PlanningTask => !!task && task.machineDuration > 0);

  if (tasks.length === 0) {
    return { tasks: [], machineRows: [], operatorRows: [], axisEnd: DAY_END };
  }

  const machineAvailability = new Map<string, number[]>();
  equipment.forEach((item) => {
    machineAvailability.set(item.id, Array.from({ length: item.quantidade }, () => DAY_START));
  });

  const machineRowsMap = new Map<string, GanttRow<MachineTask>>();
  const machineTasks: MachineTask[] = [];

  tasks.forEach((task) => {
    const availability = machineAvailability.get(task.equipmentId);
    if (!availability || availability.length === 0) return;

    let machineIndex = 0;
    let earliestAvailable = availability[0];

    for (let index = 1; index < availability.length; index += 1) {
      if (availability[index] < earliestAvailable) {
        earliestAvailable = availability[index];
        machineIndex = index;
      }
    }

    const scheduled = createSegments(earliestAvailable, task.machineDuration);
    availability[machineIndex] = scheduled.end;

    const machineLabel = `${task.equipmentName} ${machineIndex + 1}`;
    const machineTask: MachineTask = {
      ...task,
      machineIndex,
      machineLabel,
      start: scheduled.start,
      end: scheduled.end,
      segments: scheduled.segments,
    };

    machineTasks.push(machineTask);
    const row = machineRowsMap.get(machineLabel) ?? { label: machineLabel, tasks: [] };
    row.tasks.push(machineTask);
    machineRowsMap.set(machineLabel, row);
  });

  const machineRows = Array.from(machineRowsMap.values()).sort((left, right) => {
    const leftMatch = left.label.match(/^(.*) (\d+)$/);
    const rightMatch = right.label.match(/^(.*) (\d+)$/);
    const leftName = leftMatch?.[1] ?? left.label;
    const rightName = rightMatch?.[1] ?? right.label;
    const leftNumber = Number(leftMatch?.[2] ?? 0);
    const rightNumber = Number(rightMatch?.[2] ?? 0);
    return leftName.localeCompare(rightName) || leftNumber - rightNumber;
  });

  const operatorNames = operatorsForDate
    .filter((entry) => WORKING_CODES.includes(entry.code) && !entry.absent)
    .map((entry) => entry.operator.nome);

  const operatorRowsMap = new Map<string, GanttRow<OperatorTask>>(
    operatorNames.map((name) => [name, { label: name, tasks: [] }])
  );

  if (operatorNames.length > 0) {
    const operatorAvailability = new Map(operatorNames.map((name) => [name, DAY_START]));
    const machineOrder = [...machineTasks].sort((left, right) => {
      return left.start - right.start || left.machineLabel.localeCompare(right.machineLabel) || left.id.localeCompare(right.id);
    });

    machineOrder.forEach((task) => {
      if (task.operatorDuration <= 0) return;

      let chosenOperator = operatorNames[0];
      let chosenStart = normalizeCursor(Math.max(operatorAvailability.get(chosenOperator) ?? DAY_START, task.start));

      for (const name of operatorNames) {
        const availability = operatorAvailability.get(name) ?? DAY_START;
        const candidateStart = normalizeCursor(Math.max(availability, task.start));
        if (candidateStart < chosenStart) {
          chosenOperator = name;
          chosenStart = candidateStart;
        }
      }

      const scheduled = createSegments(chosenStart, task.operatorDuration);
      operatorAvailability.set(chosenOperator, scheduled.end);

      const operatorTask: OperatorTask = {
        ...task,
        operatorName: chosenOperator,
        start: scheduled.start,
        end: scheduled.end,
        segments: scheduled.segments,
        machineTaskId: task.id,
      };

      operatorRowsMap.get(chosenOperator)?.tasks.push(operatorTask);
    });
  }

  const operatorRows = Array.from(operatorRowsMap.values());
  const latestEnd = Math.max(
    DAY_END,
    ...machineTasks.map((task) => task.end),
    ...operatorRows.flatMap((row) => row.tasks.map((task) => task.end))
  );

  void tempOperators;

  return {
    tasks,
    machineRows,
    operatorRows,
    axisEnd: roundUpToHalfHour(latestEnd),
  };
}