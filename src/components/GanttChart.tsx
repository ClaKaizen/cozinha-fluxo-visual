import { useMemo } from "react";
import { useStore } from "@/store/useStore";
import { WORKING_CODES } from "@/store/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ScheduledTask {
  id: string;
  artigo: string;
  equipmentName: string;
  equipmentId: string;
  machineIndex: number;
  machineStart: number;
  machineEnd: number;
  humanStart: number;
  humanEnd: number;
  operatorName: string;
  colorIndex: number;
}

// All times in absolute clock minutes (e.g. 07:00 = 420, 13:00 = 780)
const DAY_START = 7 * 60;       // 420
const LUNCH_START = 13 * 60;    // 780
const LUNCH_END = 14 * 60;      // 840
const DAY_END = 15 * 60 + 30;   // 930

const EQUIPMENT_COLORS = [
  "hsl(45, 90%, 60%)",
  "hsl(210, 60%, 55%)",
  "hsl(340, 60%, 55%)",
  "hsl(160, 50%, 45%)",
  "hsl(30, 70%, 55%)",
  "hsl(270, 50%, 55%)",
];

function fmt(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
}

function nextStart(cursor: number, duration: number): number {
  let t = cursor;
  if (t < DAY_START) t = DAY_START;
  if (t >= LUNCH_START && t < LUNCH_END) t = LUNCH_END;
  if (t < LUNCH_START && t + duration > LUNCH_START) t = LUNCH_END;
  return t;
}

function place(cursor: number, duration: number): { start: number; end: number } | null {
  const start = nextStart(cursor, duration);
  const end = start + duration;
  if (end > DAY_END) return null;
  return { start, end };
}

interface GanttChartProps {
  dateStr: string;
}

export default function GanttChart({ dateStr }: GanttChartProps) {
  const store = useStore();

  const scheduled = useMemo(() => {
    const production = store.production.filter((p) => p.date === dateStr);
    if (production.length === 0) return { tasks: [] as ScheduledTask[], operators: [] as string[], machines: [] as string[] };

    const ops = store.getOperatorsForDate(dateStr);
    const presentOps = ops.filter((o) => WORKING_CODES.includes(o.code) && !o.absent);
    const temps = store.tempOperators.filter((t) => t.date === dateStr);
    // If no one has schedule codes set, treat all operators as available
    const effectiveOps = presentOps.length > 0 || temps.length > 0
      ? [...presentOps.map((o) => o.operator.nome), ...temps.map((t) => t.nome)]
      : store.operators.map((o) => o.nome);
    const allOperators = effectiveOps;

    const eqColorMap = new Map<string, number>();
    store.equipment.forEach((eq, idx) => eqColorMap.set(eq.id, idx % EQUIPMENT_COLORS.length));

    // Machine availability: cursor per machine unit (absolute clock minutes)
    const machineAvail = new Map<string, number[]>();
    store.equipment.forEach((eq) => {
      machineAvail.set(eq.id, Array(eq.quantidade).fill(DAY_START));
    });

    // Operator availability
    const opAvail = new Map<string, number>();
    allOperators.forEach((name) => opAvail.set(name, DAY_START));

    const enriched = production.map((p) => {
      const cat = store.categories.find((c) => c.id === p.categoriaId);
      const eq = cat ? store.equipment.find((e) => e.id === cat.equipamentoId) : null;
      return { ...p, cat, eq };
    }).sort((a, b) => (a.eq?.nome || "").localeCompare(b.eq?.nome || ""));

    const tasks: ScheduledTask[] = [];

    for (const item of enriched) {
      if (!item.cat || !item.eq) continue;

      const machineDuration = item.quantidade * item.cat.tempoCicloMaquina;
      const humanDuration = item.quantidade * item.cat.tempoCicloHomem;
      if (machineDuration === 0) continue;

      const machines = machineAvail.get(item.cat.equipamentoId);
      if (!machines || machines.length === 0) continue;

      // Find earliest available machine
      let bestMachine = 0;
      let bestTime = machines[0];
      for (let i = 1; i < machines.length; i++) {
        if (machines[i] < bestTime) {
          bestTime = machines[i];
          bestMachine = i;
        }
      }

      const machineSlot = place(bestTime, machineDuration);
      if (!machineSlot) continue;

      // Find earliest available operator
      let bestOp = allOperators[0] || "?";
      let bestOpTime = Infinity;
      for (const [name, avail] of opAvail) {
        const opStart = nextStart(Math.max(avail, machineSlot.start), humanDuration);
        if (opStart < bestOpTime) {
          bestOpTime = opStart;
          bestOp = name;
        }
      }

      const humanSlot = place(bestOpTime, humanDuration);
      if (!humanSlot) continue;

      machines[bestMachine] = machineSlot.end;
      opAvail.set(bestOp, humanSlot.end);

      tasks.push({
        id: item.id,
        artigo: item.artigo,
        equipmentName: item.eq.nome,
        equipmentId: item.cat.equipamentoId,
        machineIndex: bestMachine,
        machineStart: machineSlot.start,
        machineEnd: machineSlot.end,
        humanStart: humanSlot.start,
        humanEnd: humanSlot.end,
        operatorName: bestOp,
        colorIndex: eqColorMap.get(item.cat.equipamentoId) || 0,
      });
    }

    const machineRows: string[] = [];
    store.equipment.forEach((eq) => {
      for (let i = 0; i < eq.quantidade; i++) {
        machineRows.push(`${eq.nome} ${i + 1}`);
      }
    });

    return { tasks, operators: allOperators, machines: machineRows };
  }, [dateStr, store]);

  if (scheduled.tasks.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-display">Sugestão de Planeamento</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm text-center py-4">Sem tarefas para gerar planeamento.</p>
        </CardContent>
      </Card>
    );
  }

  const TOTAL_SPAN = DAY_END - DAY_START; // 510 min
  const toPercent = (absMin: number) => ((absMin - DAY_START) / TOTAL_SPAN) * 100;

  const timeMarkers: number[] = [];
  for (let m = DAY_START; m <= DAY_END; m += 30) {
    timeMarkers.push(m);
  }

  const rowH = 32;
  const chartW = 700;
  const labelW = 120;

  // Build operator task map
  const operatorTasks = new Map<string, ScheduledTask[]>();
  scheduled.operators.forEach((name) => operatorTasks.set(name, []));
  scheduled.tasks.forEach((t) => {
    const list = operatorTasks.get(t.operatorName);
    if (list) list.push(t);
  });

  // Build machine task map - only used machines
  const eqMachineOffset = new Map<string, number>();
  let offset = 0;
  store.equipment.forEach((eq) => {
    eqMachineOffset.set(eq.id, offset);
    offset += eq.quantidade;
  });

  const machineTaskMap = new Map<string, ScheduledTask[]>();
  scheduled.tasks.forEach((t) => {
    const baseOffset = eqMachineOffset.get(t.equipmentId) || 0;
    const machineLabel = scheduled.machines[baseOffset + t.machineIndex];
    if (machineLabel) {
      if (!machineTaskMap.has(machineLabel)) machineTaskMap.set(machineLabel, []);
      machineTaskMap.get(machineLabel)!.push(t);
    }
  });

  // Only show machines that have tasks
  const usedMachines = scheduled.machines.filter((m) => machineTaskMap.has(m));

  const renderBlock = (t: ScheduledTask, startMin: number, endMin: number, suffix: string, opacity: string) => {
    const leftPct = toPercent(startMin);
    const widthPct = ((endMin - startMin) / TOTAL_SPAN) * 100;
    const blockW = (widthPct / 100) * chartW;
    const showTime = blockW > 55;
    return (
      <div
        key={t.id + suffix}
        className="absolute rounded text-[8px] font-semibold text-foreground flex flex-col justify-center px-1.5 overflow-hidden whitespace-nowrap border"
        style={{
          left: `${leftPct}%`,
          width: `${widthPct}%`,
          top: 2,
          height: rowH - 4,
          backgroundColor: EQUIPMENT_COLORS[t.colorIndex] + opacity,
          borderColor: EQUIPMENT_COLORS[t.colorIndex],
        }}
        title={`${t.artigo} (${t.equipmentName}) ${fmt(startMin)}–${fmt(endMin)}`}
      >
        <span className="truncate leading-tight">{t.artigo}</span>
        {showTime && (
          <span className="text-[7px] opacity-70 leading-tight">{fmt(startMin)}–{fmt(endMin)}</span>
        )}
      </div>
    );
  };

  const renderTimeAxis = () => (
    <div className="relative" style={{ marginLeft: labelW, height: 18 }}>
      {timeMarkers.filter((m) => m % 60 === 0).map((m) => (
        <div
          key={m}
          className="absolute text-[10px] font-medium text-muted-foreground"
          style={{ left: `${toPercent(m)}%`, transform: "translateX(-50%)" }}
        >
          {fmt(m)}
        </div>
      ))}
    </div>
  );

  const renderGrid = (totalRows: number) => {
    const totalH = totalRows * rowH;
    return (
      <>
        {/* Lunch overlay */}
        <div
          className="absolute bg-muted/40 z-0 rounded"
          style={{
            left: `calc(${labelW}px + ${toPercent(LUNCH_START)}% * (100% - ${labelW}px) / 100)`,
            width: `${((LUNCH_END - LUNCH_START) / TOTAL_SPAN) * 100}%`,
            top: 0,
            height: totalH,
            marginLeft: 0,
          }}
        />
        {timeMarkers.map((m) => (
          <div
            key={m}
            className={`absolute z-0 ${m % 60 === 0 ? "border-l border-border/50" : "border-l border-border/20"}`}
            style={{
              left: `calc(${labelW}px + ${toPercent(m)}% * (100% - ${labelW}px) / 100)`,
              top: 0,
              height: totalH,
            }}
          />
        ))}
      </>
    );
  };

  const renderChartSection = (
    title: string,
    rows: { label: string; tasks: ScheduledTask[]; getStart: (t: ScheduledTask) => number; getEnd: (t: ScheduledTask) => number; suffix: string; opacity: string }[]
  ) => {
    const totalH = rows.length * rowH;
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-display">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <div style={{ minWidth: labelW + chartW + 20 }}>
              {renderTimeAxis()}
              <div className="relative">
                {/* Lunch overlay */}
                <div
                  className="absolute bg-muted/40 z-0 rounded"
                  style={{
                    left: labelW + (toPercent(LUNCH_START) / 100) * chartW,
                    width: (((LUNCH_END - LUNCH_START) / TOTAL_SPAN) * chartW),
                    top: 0,
                    height: totalH,
                  }}
                />
                {timeMarkers.map((m) => (
                  <div
                    key={m}
                    className={`absolute z-0 ${m % 60 === 0 ? "border-l border-border/50" : "border-l border-border/20"}`}
                    style={{
                      left: labelW + (toPercent(m) / 100) * chartW,
                      top: 0,
                      height: totalH,
                    }}
                  />
                ))}

                {rows.map((row) => (
                  <div key={row.label} className="flex items-center relative" style={{ height: rowH }}>
                    <div className="text-[11px] truncate font-semibold pr-2" style={{ width: labelW }}>{row.label}</div>
                    <div className="relative flex-1 h-full bg-muted/5 border-b border-border/20" style={{ width: chartW }}>
                      {row.tasks.map((t) =>
                        renderBlock(t, row.getStart(t), row.getEnd(t), row.suffix, row.opacity)
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Legend */}
              <div className="flex gap-3 mt-3 flex-wrap text-xs">
                {store.equipment.map((eq, idx) => (
                  <div key={eq.id} className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-sm border" style={{ backgroundColor: EQUIPMENT_COLORS[idx % EQUIPMENT_COLORS.length] + "55", borderColor: EQUIPMENT_COLORS[idx % EQUIPMENT_COLORS.length] }} />
                    <span>{eq.nome}</span>
                  </div>
                ))}
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm bg-muted" />
                  <span className="text-muted-foreground">Almoço 13:00–14:00</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const operatorRows = scheduled.operators.map((name) => ({
    label: name,
    tasks: operatorTasks.get(name) || [],
    getStart: (t: ScheduledTask) => t.humanStart,
    getEnd: (t: ScheduledTask) => t.humanEnd,
    suffix: "-op",
    opacity: "40",
  }));

  const machineRows = usedMachines.map((label) => ({
    label,
    tasks: machineTaskMap.get(label) || [],
    getStart: (t: ScheduledTask) => t.machineStart,
    getEnd: (t: ScheduledTask) => t.machineEnd,
    suffix: "-m",
    opacity: "55",
  }));

  return (
    <div className="space-y-4">
      {renderChartSection("Sugestão de Planeamento — Por Operador", operatorRows)}
      {renderChartSection("Sugestão de Planeamento — Por Máquina", machineRows)}
    </div>
  );
}
