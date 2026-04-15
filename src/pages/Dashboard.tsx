import { useState, useMemo } from "react";
import { format, addDays, subDays } from "date-fns";
import { pt } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Users, Activity, UserMinus, UserPlus, Info, UserCheck, AlertTriangle, Gauge, CheckCircle, XCircle } from "lucide-react";
import { useStore } from "@/store/useStore";
import { WORKING_CODES, EFFECTIVE_HOURS, AVAILABLE_MINUTES } from "@/store/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ShiftCode } from "@/store/types";
import GanttChart from "@/components/GanttChart";
import MachineSequence from "@/components/dashboard/MachineSequence";
import OperatorSequence from "@/components/dashboard/OperatorSequence";
import { buildDailyGanttSchedule, normalizeDateKey } from "@/components/gantt/scheduler";

const SHIFT_OPTIONS: ShiftCode[] = ['D', 'E', 'I', 'C'];

function occupancyColor(rate: number) {
  if (rate > 100) return "text-danger";
  if (rate >= 80) return "text-warning";
  return "text-success";
}

function occupancyBg(rate: number) {
  if (rate > 100) return "bg-danger/10";
  if (rate >= 80) return "bg-warning/10";
  return "bg-success/10";
}

function occupancyPill(rate: number) {
  const color = rate > 100 ? "bg-danger/15 text-danger border-danger/30" : rate >= 80 ? "bg-warning/15 text-warning border-warning/30" : "bg-success/15 text-success border-success/30";
  return color;
}

export default function Dashboard() {
  const [date, setDate] = useState(new Date());
  const dateStr = format(date, "yyyy-MM-dd");
  const store = useStore();

  const stats = store.getDayStats(dateStr);
  const operators = store.getOperatorsForDate(dateStr);
  const tempOps = store.tempOperators.filter((t) => t.date === dateStr);
  const production = store.getProductionForDate(dateStr);

  const [tempName, setTempName] = useState("");
  const [tempShift, setTempShift] = useState<ShiftCode>("D");

  // Compute Gantt schedule for KPIs and chart
  const schedule = useMemo(
    () => buildDailyGanttSchedule({
      dateStr: normalizeDateKey(dateStr),
      production: store.production,
      categories: store.categories,
      equipment: store.equipment,
      operatorsForDate: operators,
      tempOperators: store.tempOperators,
      sequencingRules: store.sequencingRules,
      lunchSafeCategories: store.lunchSafeCategories,
    }),
    [dateStr, store.production, store.categories, store.equipment, operators, store.tempOperators, store.sequencingRules, store.lunchSafeCategories]
  );

  // Per-operator hours from Gantt
  const operatorHoursMap = useMemo(() => {
    const map = new Map<string, number>();
    schedule.operatorRows.forEach((row) => {
      const totalMin = row.tasks.reduce((sum, t) =>
        sum + t.segments.reduce((s, seg) => s + (seg.end - seg.start), 0), 0);
      map.set(row.label, totalMin / 60);
    });
    return map;
  }, [schedule.operatorRows]);

  const handleAddTemp = () => {
    if (tempName.trim()) {
      const hours = tempShift === 'E' ? 4 : 8;
      store.addTempOperator({ date: dateStr, nome: tempName.trim(), hours });
      setTempName("");
    }
  };

  const pessoasNecessarias = Math.ceil(stats.cargaDoDia / 8);
  const pessoasNecessariasTeo = Math.ceil(stats.cargaTeorica / 8);
  const delta = stats.pessoasPresentes - pessoasNecessarias;
  const deltaTeo = stats.pessoasPresentes - pessoasNecessariasTeo;
  const dimensionamentoOk = delta >= 0;
  const dimensionamentoTeoOk = deltaTeo >= 0;

  // Group production by equipment
  const enrichedProd = production.map((p) => {
    const cat = store.categories.find((c) => c.id === p.categoriaId);
    const eq = cat ? store.equipment.find((e) => e.id === cat.equipamentoId) : null;
    return { ...p, cat, eq };
  }).sort((a, b) => (a.eq?.nome || "").localeCompare(b.eq?.nome || ""));

  const equipGroups = new Map<string, typeof enrichedProd>();
  enrichedProd.forEach((p) => {
    const key = p.eq?.nome || "Sem Equipamento";
    if (!equipGroups.has(key)) equipGroups.set(key, []);
    equipGroups.get(key)!.push(p);
  });

  const [showOverflowDetails, setShowOverflowDetails] = useState(false);

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Date navigation */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold text-foreground">Dashboard</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setDate(subDays(date, 1))}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" className="min-w-[200px] font-medium" onClick={() => setDate(new Date())}>
            {format(date, "EEEE, d 'de' MMMM yyyy", { locale: pt })}
          </Button>
          <Button variant="outline" size="icon" onClick={() => setDate(addDays(date, 1))}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      {/* Alert banners — compact */}
      {schedule.usesEmergencyEquipment && (
        <div className="flex items-center gap-2 rounded-md border-l-4 border-l-warning bg-card px-3 py-2 text-sm text-warning shadow-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>Equipamentos de emergência em uso: {schedule.emergencyEquipmentNames.join(", ")}</span>
        </div>
      )}

      {schedule.overflowTasks && schedule.overflowTasks.length > 0 && (
        <div className="rounded-md border-l-4 border-l-destructive bg-card px-3 py-2 shadow-sm">
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="flex-1">
              {schedule.overflowTasks.length} tarefa(s) em overflow
              {schedule.overflowTasks.length <= 3 && `: ${schedule.overflowTasks.join(", ")}`}
            </span>
            {schedule.overflowTasks.length > 3 && (
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-destructive"
                onClick={() => setShowOverflowDetails(!showOverflowDetails)}>
                {showOverflowDetails ? "ocultar" : "ver detalhes"}
              </Button>
            )}
          </div>
          {showOverflowDetails && schedule.overflowTasks.length > 3 && (
            <p className="text-xs text-destructive/80 mt-1 pl-6">{schedule.overflowTasks.join(", ")}</p>
          )}
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-7 gap-2">
        {/* Carga do Dia — dual */}
        <Card className="border-l-4 border-l-primary shadow-sm min-w-0 overflow-hidden">
          <div className="px-2.5 py-2 flex flex-col items-center justify-center h-full">
            <div className="flex items-center gap-1 mb-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Carga do Dia</span>
              <Tooltip>
                <TooltipTrigger><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                <TooltipContent className="max-w-[280px] text-xs">Real: Σ T.Homem sem fator. Com ineficiência: ×1.20</TooltipContent>
              </Tooltip>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded bg-blue-50 px-1.5 py-1.5 text-center">
                <div className="text-xl font-display font-bold text-blue-700 whitespace-nowrap">{stats.cargaTeorica.toFixed(1)}h</div>
                <p className="text-[9px] text-blue-400 mt-0.5">Real</p>
              </div>
              <div className="rounded bg-yellow-50 px-1.5 py-1.5 text-center">
                <div className="text-xl font-display font-bold text-foreground whitespace-nowrap">{stats.cargaDoDia.toFixed(1)}h</div>
                <p className="text-[9px] text-yellow-600 mt-0.5">c/ Inefic.</p>
              </div>
            </div>
          </div>
        </Card>

        {/* Pessoas Presentes — single */}
        <Card className="border-l-4 border-l-secondary shadow-sm min-w-0">
          <div className="px-2.5 py-2 flex flex-col items-center justify-center h-full">
            <span className="text-[11px] font-medium text-muted-foreground mb-1">Pessoas Presentes</span>
            <div className="text-3xl font-display font-bold">{stats.pessoasPresentes}</div>
          </div>
        </Card>

        {/* Capacidade — single */}
        <Card className="border-l-4 border-l-primary shadow-sm min-w-0">
          <div className="px-2.5 py-2 flex flex-col items-center justify-center h-full">
            <div className="flex items-center gap-1 mb-1">
              <span className="text-[11px] font-medium text-muted-foreground">Capacidade</span>
              <Tooltip>
                <TooltipTrigger><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                <TooltipContent className="max-w-[260px] text-xs">{stats.pessoasPresentes} × 8h = {stats.capacidadeDoDia.toFixed(1)}h</TooltipContent>
              </Tooltip>
            </div>
            <div className="text-3xl font-display font-bold">{stats.capacidadeDoDia.toFixed(1)}h</div>
          </div>
        </Card>

        {/* Pessoas Necessárias — dual */}
        <Card className={`border-l-4 shadow-sm min-w-0 overflow-hidden ${dimensionamentoOk ? "border-l-success" : "border-l-danger"}`}>
          <div className="px-2.5 py-2 flex flex-col items-center justify-center h-full">
            <div className="flex items-center gap-1 mb-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Pessoas Nec.</span>
              <Tooltip>
                <TooltipTrigger><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                <TooltipContent className="max-w-[280px] text-xs">Real: ⌈Carga teórica ÷ 8h⌉ = {pessoasNecessariasTeo}. Com ineficiência: ⌈Carga real ÷ 8h⌉ = {pessoasNecessarias}</TooltipContent>
              </Tooltip>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded bg-blue-50 px-1.5 py-1.5 text-center">
                <div className={`text-xl font-display font-bold whitespace-nowrap ${dimensionamentoTeoOk ? "text-success" : "text-danger"}`}>{pessoasNecessariasTeo}</div>
                <p className="text-[9px] text-blue-400 mt-0.5">Real</p>
                <p className={`text-[8px] font-medium leading-tight ${dimensionamentoTeoOk ? "text-success" : "text-danger"}`}>
                  {deltaTeo === 0 ? "Correto" : deltaTeo > 0 ? `−${deltaTeo} exc.` : `+${Math.abs(deltaTeo)} em falta`}
                </p>
              </div>
              <div className="rounded bg-yellow-50 px-1.5 py-1.5 text-center">
                <div className={`text-xl font-display font-bold whitespace-nowrap ${dimensionamentoOk ? "text-success" : "text-danger"}`}>{pessoasNecessarias}</div>
                <p className="text-[9px] text-yellow-600 mt-0.5">c/ Inefic.</p>
                <p className={`text-[8px] font-medium leading-tight ${dimensionamentoOk ? "text-success" : "text-danger"}`}>
                  {!dimensionamentoTeoOk && !dimensionamentoOk
                    ? `+${Math.abs(delta)} em falta`
                    : dimensionamentoTeoOk && !dimensionamentoOk
                    ? `+${Math.abs(delta)} falta (inefic.)`
                    : delta === 0
                    ? "Correto"
                    : `−${delta} exc.`}
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* Taxa Ocupação — dual */}
        <Card className={`border-l-4 shadow-sm min-w-0 overflow-hidden ${stats.taxaOcupacaoGlobal > 100 ? "border-l-danger" : stats.taxaOcupacaoGlobal >= 80 ? "border-l-warning" : "border-l-success"}`}>
          <div className="px-2.5 py-2 flex flex-col items-center justify-center h-full">
            <div className="flex items-center gap-1 mb-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Taxa Ocupação</span>
              <Tooltip>
                <TooltipTrigger><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                <TooltipContent className="max-w-[280px] text-xs">Carga ÷ Capacidade × 100%. Real sem fator, Com ineficiência +20%</TooltipContent>
              </Tooltip>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded bg-blue-50 px-1.5 py-1.5 text-center">
                <div className={`text-xl font-display font-bold whitespace-nowrap ${occupancyColor(stats.taxaOcupacaoTeorica)}`}>{stats.taxaOcupacaoTeorica.toFixed(0)}%</div>
                <p className="text-[9px] text-blue-400 mt-0.5">Real</p>
              </div>
              <div className="rounded bg-yellow-50 px-1.5 py-1.5 text-center">
                <div className={`text-xl font-display font-bold whitespace-nowrap ${occupancyColor(stats.taxaOcupacaoGlobal)}`}>{stats.taxaOcupacaoGlobal.toFixed(0)}%</div>
                <p className="text-[9px] text-yellow-600 mt-0.5">c/ Inefic.</p>
              </div>
            </div>
          </div>
        </Card>

        {/* Ocupação Equip. — single */}
        <Card className="border-l-4 border-l-secondary shadow-sm min-w-0">
          <div className="px-2.5 py-2 flex flex-col items-center justify-center h-full">
            <div className="flex items-center gap-1 mb-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Ocup. Equip.</span>
              <Tooltip>
                <TooltipTrigger><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                <TooltipContent className="max-w-[260px] text-xs">Σ(T.Máquina alocada) ÷ (Qtd. Normal × 480 min) × 100%</TooltipContent>
              </Tooltip>
            </div>
            <div className="space-y-0.5">
              {stats.taxaOcupacao.map((eq) => (
                <div key={eq.equipmentName} className={`flex items-center justify-between text-[10px] px-1 py-0.5 rounded ${occupancyBg(eq.rate)}`}>
                  <span className="font-medium truncate mr-1">{eq.equipmentName}</span>
                  <span className={`font-bold shrink-0 ${occupancyColor(eq.rate)}`}>
                    {eq.usesEmergency && <AlertTriangle className="inline h-2.5 w-2.5 text-warning mr-0.5 -mt-0.5" />}
                    {eq.rate.toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Overtime — single */}
        <Card className={`border-l-4 shadow-sm min-w-0 ${schedule.hasOvertime ? "border-l-danger" : "border-l-success"}`}>
          <div className="px-2.5 py-2 flex flex-col items-center justify-center h-full">
            <span className="text-[11px] font-medium text-muted-foreground mb-1">Overtime</span>
            {schedule.hasOvertime ? (
              <div className="flex items-center gap-1">
                <XCircle className="h-4 w-4 text-danger shrink-0" />
                <span className="text-sm font-display font-bold text-danger">Com overtime</span>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <CheckCircle className="h-4 w-4 text-success shrink-0" />
                <span className="text-sm font-display font-bold text-success">Sem overtime</span>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Team + Tasks */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1 shadow-sm">
          <div className="rounded-t-lg bg-[#44546A] px-4 py-2">
            <h2 className="text-sm font-display font-semibold text-white">Equipa do Dia</h2>
          </div>
          <CardContent className="p-4 space-y-1.5">
            {operators.map((o) => {
              const isWorking = WORKING_CODES.includes(o.code) && !o.absent;
              const opHours = operatorHoursMap.get(o.operator.nome) ?? 0;
              const opRate = isWorking ? (opHours / 8) * 100 : 0;
              return (
                <div key={o.operator.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${isWorking ? "bg-primary" : "bg-muted-foreground/30"}`} />
                    <span className={isWorking ? "" : "text-muted-foreground line-through"}>{o.operator.nome}</span>
                    <span className="text-xs text-muted-foreground">({o.code})</span>
                    {isWorking && opHours > 0 && (
                      <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 border ${occupancyPill(opRate)}`}>
                        {opRate.toFixed(0)}%
                      </Badge>
                    )}
                  </div>
                  {WORKING_CODES.includes(o.code) && (
                    <Button variant="ghost" size="sm" className="h-6 px-1.5"
                      onClick={() => o.absent ? store.removeAbsence(o.operator.id, dateStr) : store.addAbsence(o.operator.id, dateStr)}>
                      {o.absent ? <UserPlus className="h-3 w-3" /> : <UserMinus className="h-3 w-3" />}
                    </Button>
                  )}
                </div>
              );
            })}
            {tempOps.map((t) => {
              const opHours = operatorHoursMap.get(t.nome) ?? 0;
              const opRate = (opHours / 8) * 100;
              return (
                <div key={t.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-primary" />
                    <span>{t.nome}</span>
                    <span className="text-xs text-muted-foreground">(temp {t.hours}h)</span>
                    {opHours > 0 && (
                      <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 border ${occupancyPill(opRate)}`}>
                        {opRate.toFixed(0)}%
                      </Badge>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => store.removeTempOperator(t.id)}>
                    <UserMinus className="h-3 w-3" />
                  </Button>
                </div>
              );
            })}
            <div className="flex gap-2 mt-2 pt-2 border-t">
              <Input placeholder="Nome" value={tempName} onChange={(e) => setTempName(e.target.value)} className="h-7 text-xs" />
              <Select value={tempShift} onValueChange={(v) => setTempShift(v as ShiftCode)}>
                <SelectTrigger className="h-7 w-16 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SHIFT_OPTIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" className="h-7 px-2" onClick={handleAddTemp}><UserPlus className="h-3 w-3" /></Button>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 shadow-sm">
          <div className="rounded-t-lg bg-[#44546A] px-4 py-2">
            <h2 className="text-sm font-display font-semibold text-white">Tarefas do Dia</h2>
          </div>
          <CardContent className="p-4">
            {production.length === 0 ? (
              <p className="text-muted-foreground text-sm py-8 text-center">Sem tarefas para este dia.</p>
            ) : (
              <div className="space-y-3">
                {Array.from(equipGroups.entries()).map(([eqName, items]) => (
                  <div key={eqName}>
                    <h3 className="text-xs font-display font-semibold text-secondary mb-1">{eqName}</h3>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-[10px] text-muted-foreground">
                          <th className="text-left font-medium px-2 py-1">Artigo</th>
                          <th className="text-right font-medium px-2 py-1">QD</th>
                          <th className="text-left font-medium px-2 py-1">Unid.</th>
                          <th className="text-left font-medium px-2 py-1">Categoria</th>
                          <th className="text-right font-medium px-2 py-1">T. Homem</th>
                          <th className="text-right font-medium px-2 py-1">T. Máquina</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((p, idx) => (
                          <tr key={p.id} className={`border-b last:border-b-0 ${idx % 2 === 0 ? "bg-gray-50" : ""}`}>
                            <td className="px-2 py-1 font-medium">{p.artigo}</td>
                            <td className="px-2 py-1 text-right">{p.quantidade}</td>
                            <td className="px-2 py-1">{p.unidade || "-"}</td>
                            <td className="px-2 py-1">{p.cat?.nome || "-"}</td>
                            <td className="px-2 py-1 text-right">{p.cat ? `${Math.round(p.quantidade * p.cat.tempoCicloHomem)} min` : "-"}</td>
                            <td className="px-2 py-1 text-right">{p.cat ? `${Math.round(p.quantidade * p.cat.tempoCicloMaquina)} min` : "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Sequence subsections */}
      <MachineSequence schedule={schedule} />
      <OperatorSequence schedule={schedule} operatorHoursMap={operatorHoursMap} />

      {/* Gantt Chart */}
      <GanttChart schedule={schedule} />
    </div>
  );
}
