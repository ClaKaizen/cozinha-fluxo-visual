import { useState, useMemo } from "react";
import { format, addDays, subDays } from "date-fns";
import { pt } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Users, Activity, UserMinus, UserPlus, Info, UserCheck, AlertTriangle, Gauge } from "lucide-react";
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
    }),
    [dateStr, store.production, store.categories, store.equipment, operators, store.tempOperators]
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
      const hours = tempShift === 'E' ? 4 : 7.5;
      store.addTempOperator({ date: dateStr, nome: tempName.trim(), hours });
      setTempName("");
    }
  };

  const pessoasNecessarias = Math.ceil(stats.cargaDoDia / EFFECTIVE_HOURS);
  const delta = stats.pessoasPresentes - pessoasNecessarias;
  const dimensionamentoOk = delta >= 0;

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

  return (
    <div className="space-y-6 animate-fade-in">
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

      {/* Emergency warning */}
      {schedule.usesEmergencyEquipment && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/50 bg-warning/10 px-4 py-3 text-sm font-medium text-warning">
          <AlertTriangle className="h-5 w-5" />
          <span>Equipamento de emergência está a ser utilizado neste dia.</span>
        </div>
      )}

      {/* KPI Cards - 6 cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card className="border-l-4 border-l-primary">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Carga do Dia</CardTitle>
            <Tooltip>
              <TooltipTrigger><Info className="h-4 w-4 text-muted-foreground" /></TooltipTrigger>
              <TooltipContent className="max-w-[260px] text-xs">Inclui 20% ineficiência — baseado em tempo homem</TooltipContent>
            </Tooltip>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-display font-bold">{stats.cargaDoDia.toFixed(1)}h</div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-secondary">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pessoas Presentes</CardTitle>
            <Users className="h-5 w-5 text-secondary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-display font-bold">{stats.pessoasPresentes}</div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-primary">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Capacidade</CardTitle>
            <Tooltip>
              <TooltipTrigger><Info className="h-4 w-4 text-muted-foreground" /></TooltipTrigger>
              <TooltipContent className="max-w-[260px] text-xs">{stats.pessoasPresentes} × 7.5h × 0.9375 = {stats.capacidadeDoDia.toFixed(1)}h</TooltipContent>
            </Tooltip>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-display font-bold">{stats.capacidadeDoDia.toFixed(1)}h</div>
          </CardContent>
        </Card>

        <Card className={`border-l-4 ${dimensionamentoOk ? "border-l-success" : "border-l-danger"}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pessoas Necessárias</CardTitle>
            <UserCheck className="h-5 w-5 text-secondary" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-display font-bold ${dimensionamentoOk ? "text-success" : "text-danger"}`}>{pessoasNecessarias}</div>
            <p className={`text-[10px] mt-1 font-medium ${dimensionamentoOk ? "text-success" : "text-danger"}`}>
              {delta === 0 ? "Dimensionamento correto" : delta > 0 ? `−${delta} excedente${delta > 1 ? "s" : ""}` : `+${Math.abs(delta)} em falta`}
            </p>
          </CardContent>
        </Card>

        {/* Taxa de Ocupação Global */}
        <Card className={`border-l-4 ${stats.taxaOcupacaoGlobal > 100 ? "border-l-danger" : stats.taxaOcupacaoGlobal >= 80 ? "border-l-warning" : "border-l-success"}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Taxa Ocupação</CardTitle>
            <Gauge className="h-5 w-5 text-secondary" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-display font-bold ${occupancyColor(stats.taxaOcupacaoGlobal)}`}>
              {stats.taxaOcupacaoGlobal.toFixed(0)}%
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Carga ÷ Capacidade</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-secondary">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Ocupação Equip.</CardTitle>
            <Activity className="h-5 w-5 text-secondary" />
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {stats.taxaOcupacao.map((eq) => (
                <div key={eq.equipmentName} className={`flex items-center justify-between text-xs px-1.5 py-0.5 rounded ${occupancyBg(eq.rate)}`}>
                  <span className="font-medium truncate">{eq.equipmentName}</span>
                  <span className={`font-bold ${occupancyColor(eq.rate)}`}>{eq.rate.toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Team + Tasks */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-display">Equipa do Dia</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {operators.map((o) => {
              const isWorking = WORKING_CODES.includes(o.code) && !o.absent;
              const opHours = operatorHoursMap.get(o.operator.nome) ?? 0;
              const opRate = isWorking ? (opHours / EFFECTIVE_HOURS) * 100 : 0;
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
              const opRate = (opHours / EFFECTIVE_HOURS) * 100;
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

        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-display">Tarefas do Dia</CardTitle>
          </CardHeader>
          <CardContent>
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
                          <tr key={p.id} className={`border-b last:border-b-0 ${idx % 2 === 1 ? "bg-muted/30" : ""}`}>
                            <td className="px-2 py-1 font-medium">{p.artigo}</td>
                            <td className="px-2 py-1 text-right">{p.quantidade}</td>
                            <td className="px-2 py-1">{p.unidade || "-"}</td>
                            <td className="px-2 py-1">{p.cat?.nome || "-"}</td>
                            <td className="px-2 py-1 text-right">{p.cat ? `${p.quantidade * p.cat.tempoCicloHomem} min` : "-"}</td>
                            <td className="px-2 py-1 text-right">{p.cat ? `${p.quantidade * p.cat.tempoCicloMaquina} min` : "-"}</td>
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

      {/* Gantt Chart */}
      <GanttChart schedule={schedule} />
    </div>
  );
}
