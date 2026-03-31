import { useMemo } from "react";
import { useStore } from "@/store/useStore";
import { ProductionEntry, Category, Equipment, WORKING_CODES } from "@/store/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ScheduledTask {
  id: string;
  artigo: string;
  equipmentName: string;
  equipmentId: string;
  machineIndex: number; // which machine unit (0-based)
  startMin: number; // minutes from 07:00
  endMin: number; // machine end
  humanStartMin: number;
  humanEndMin: number;
  operatorName: string;
  colorIndex: number;
}

const DAY_START = 0; // 07:00 = 0 min
const DAY_END = 510; // 15:30 = 510 min
const LUNCH_START = 360; // 13:00 = 360 min
const LUNCH_END = 420; // 14:00 = 420 min
const TOTAL_MINUTES = DAY_END; // 510 min span

const EQUIPMENT_COLORS = [
  "hsl(var(--primary))",         // yellow-gold
  "hsl(210, 60%, 55%)",          // blue
  "hsl(340, 60%, 55%)",          // pink
  "hsl(160, 50%, 45%)",          // teal
  "hsl(30, 70%, 55%)",           // orange
  "hsl(270, 50%, 55%)",          // purple
];

function timeLabel(min: number): string {
  const h = Math.floor(min / 60) + 7;
  const m = min % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

// Adjust start time to skip lunch break
function adjustForLunch(start: number, duration: number): { start: number; end: number } {
  // If task would start during lunch, push to after lunch
  if (start >= LUNCH_START && start < LUNCH_END) {
    start = LUNCH_END;
  }
  let end = start + duration;
  // If task spans into lunch, push end past lunch
  if (start < LUNCH_START && end > LUNCH_START) {
    // Can it fit before lunch?
    if (LUNCH_START - start >= duration) {
      end = start + duration;
    } else {
      // Start after lunch instead
      start = LUNCH_END;
      end = start + duration;
    }
  }
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
    const allOperators = [
      ...presentOps.map((o) => o.operator.nome),
      ...temps.map((t) => t.nome),
    ];

    // Build equipment color map
    const eqColorMap = new Map<string, number>();
    store.equipment.forEach((eq, idx) => eqColorMap.set(eq.id, idx % EQUIPMENT_COLORS.length));

    // Track machine availability: equipmentId -> array of next-available-minute per unit
    const machineAvail = new Map<string, number[]>();
    store.equipment.forEach((eq) => {
      machineAvail.set(eq.id, Array(eq.quantidade).fill(0));
    });

    // Track operator availability: next-available-minute per operator
    const opAvail = new Map<string, number>();
    allOperators.forEach((name) => opAvail.set(name, 0));

    // Enrich and sort tasks by equipment
    const enriched = production.map((p) => {
      const cat = store.categories.find((c) => c.id === p.categoriaId);
      const eq = cat ? store.equipment.find((e) => e.id === cat.equipamentoId) : null;
      return { ...p, cat, eq };
    }).sort((a, b) => (a.eq?.nome || "").localeCompare(b.eq?.nome || ""));

    const tasks: ScheduledTask[] = [];

    for (const item of enriched) {
      if (!item.cat || !item.eq) continue;

      const machineMinutes = item.quantidade * item.cat.tempoCicloMaquina;
      const humanMinutes = item.quantidade * item.cat.tempoCicloHomem;
      
      if (machineMinutes === 0) continue;

      // Find earliest available machine
      const machines = machineAvail.get(item.cat.equipamentoId);
      if (!machines || machines.length === 0) continue;

      let bestMachine = 0;
      let bestTime = machines[0];
      for (let i = 1; i < machines.length; i++) {
        if (machines[i] < bestTime) {
          bestTime = machines[i];
          bestMachine = i;
        }
      }

      // Adjust for lunch
      const machineSlot = adjustForLunch(bestTime, machineMinutes);
      
      // Find earliest available operator after machine start
      let bestOp = allOperators[0] || "?";
      let bestOpTime = Infinity;
      for (const [name, avail] of opAvail) {
        const opStart = Math.max(avail, machineSlot.start);
        if (opStart < bestOpTime) {
          bestOpTime = opStart;
          bestOp = name;
        }
      }

      const humanSlot = adjustForLunch(Math.max(bestOpTime, machineSlot.start), humanMinutes);

      // Update availability
      machines[bestMachine] = machineSlot.end;
      opAvail.set(bestOp, humanSlot.end);

      tasks.push({
        id: item.id,
        artigo: item.artigo,
        equipmentName: item.eq.nome,
        equipmentId: item.cat.equipamentoId,
        machineIndex: bestMachine,
        startMin: machineSlot.start,
        endMin: machineSlot.end,
        humanStartMin: humanSlot.start,
        humanEndMin: humanSlot.end,
        operatorName: bestOp,
        colorIndex: eqColorMap.get(item.cat.equipamentoId) || 0,
      });
    }

    // Build machine row labels
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

  const timeMarkers = [0, 60, 120, 180, 240, 300, 360, 420, 480, 510];
  const rowH = 28;
  const labelW = 120;
  const chartW = 700;

  // Build operator rows with their tasks
  const operatorTasks = new Map<string, ScheduledTask[]>();
  scheduled.operators.forEach((name) => operatorTasks.set(name, []));
  scheduled.tasks.forEach((t) => {
    const list = operatorTasks.get(t.operatorName);
    if (list) list.push(t);
  });

  // Build machine rows
  const machineTaskMap = new Map<string, ScheduledTask[]>();
  scheduled.machines.forEach((name) => machineTaskMap.set(name, []));
  
  // Map tasks to machine rows
  const eqMachineOffset = new Map<string, number>();
  let offset = 0;
  store.equipment.forEach((eq) => {
    eqMachineOffset.set(eq.id, offset);
    offset += eq.quantidade;
  });

  scheduled.tasks.forEach((t) => {
    const baseOffset = eqMachineOffset.get(t.equipmentId) || 0;
    const machineLabel = scheduled.machines[baseOffset + t.machineIndex];
    if (machineLabel) {
      const list = machineTaskMap.get(machineLabel);
      if (list) list.push(t);
    }
  });

  const totalOperatorRows = scheduled.operators.length;
  const totalMachineRows = scheduled.machines.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-display">Sugestão de Planeamento</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div style={{ minWidth: labelW + chartW + 20 }}>
            {/* Time axis */}
            <div className="flex" style={{ marginLeft: labelW }}>
              {timeMarkers.map((m) => (
                <div
                  key={m}
                  className="text-[10px] text-muted-foreground"
                  style={{ position: "absolute", left: labelW + (m / TOTAL_MINUTES) * chartW }}
                >
                  {timeLabel(m)}
                </div>
              ))}
            </div>

            <div className="relative mt-5">
              {/* Lunch break overlay */}
              <div
                className="absolute bg-muted/50 z-0"
                style={{
                  left: labelW + (LUNCH_START / TOTAL_MINUTES) * chartW,
                  width: ((LUNCH_END - LUNCH_START) / TOTAL_MINUTES) * chartW,
                  top: 0,
                  height: (totalOperatorRows + totalMachineRows + 1) * rowH + 24,
                }}
              />

              {/* Time grid lines */}
              {timeMarkers.map((m) => (
                <div
                  key={m}
                  className="absolute border-l border-border/40 z-0"
                  style={{
                    left: labelW + (m / TOTAL_MINUTES) * chartW,
                    top: 0,
                    height: (totalOperatorRows + totalMachineRows + 1) * rowH + 24,
                  }}
                />
              ))}

              {/* Section: Operators */}
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1" style={{ paddingLeft: 4 }}>
                Operadores
              </div>
              {scheduled.operators.map((name, rowIdx) => (
                <div key={name} className="flex items-center relative" style={{ height: rowH }}>
                  <div className="text-xs truncate font-medium pr-2" style={{ width: labelW }}>{name}</div>
                  <div className="relative flex-1 h-full bg-muted/10 border-b border-border/20" style={{ width: chartW }}>
                    {(operatorTasks.get(name) || []).map((t) => (
                      <div
                        key={t.id + "-op"}
                        className="absolute rounded-sm text-[9px] font-medium text-foreground flex items-center px-1 overflow-hidden whitespace-nowrap border"
                        style={{
                          left: (t.humanStartMin / TOTAL_MINUTES) * chartW,
                          width: Math.max(((t.humanEndMin - t.humanStartMin) / TOTAL_MINUTES) * chartW, 2),
                          top: 3,
                          height: rowH - 6,
                          backgroundColor: EQUIPMENT_COLORS[t.colorIndex] + "33",
                          borderColor: EQUIPMENT_COLORS[t.colorIndex],
                        }}
                        title={`${t.artigo} (${t.equipmentName}) ${timeLabel(t.humanStartMin)}–${timeLabel(t.humanEndMin)}`}
                      >
                        {t.artigo}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Separator */}
              <div style={{ height: 12 }} />

              {/* Section: Machines */}
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1" style={{ paddingLeft: 4 }}>
                Máquinas
              </div>
              {scheduled.machines.map((label) => (
                <div key={label} className="flex items-center relative" style={{ height: rowH }}>
                  <div className="text-xs truncate font-medium pr-2 text-muted-foreground" style={{ width: labelW }}>{label}</div>
                  <div className="relative flex-1 h-full bg-muted/10 border-b border-border/20" style={{ width: chartW }}>
                    {(machineTaskMap.get(label) || []).map((t) => (
                      <div
                        key={t.id + "-m"}
                        className="absolute rounded-sm text-[9px] font-medium flex items-center px-1 overflow-hidden whitespace-nowrap border"
                        style={{
                          left: (t.startMin / TOTAL_MINUTES) * chartW,
                          width: Math.max(((t.endMin - t.startMin) / TOTAL_MINUTES) * chartW, 2),
                          top: 3,
                          height: rowH - 6,
                          backgroundColor: EQUIPMENT_COLORS[t.colorIndex] + "55",
                          borderColor: EQUIPMENT_COLORS[t.colorIndex],
                        }}
                        title={`${t.artigo} (${t.equipmentName}) ${timeLabel(t.startMin)}–${timeLabel(t.endMin)}`}
                      >
                        {t.artigo}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Legend */}
            <div className="flex gap-3 mt-4 flex-wrap text-xs">
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
}
