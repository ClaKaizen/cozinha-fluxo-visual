import { useState } from "react";
import { format, addDays, subDays } from "date-fns";
import { pt } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Clock, Users, Gauge, Activity, UserMinus, UserPlus } from "lucide-react";
import { useStore } from "@/store/useStore";
import { WORKING_CODES } from "@/store/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export default function Dashboard() {
  const [date, setDate] = useState(new Date());
  const dateStr = format(date, "yyyy-MM-dd");
  const store = useStore();

  const stats = store.getDayStats(dateStr);
  const operators = store.getOperatorsForDate(dateStr);
  const tempOps = store.tempOperators.filter((t) => t.date === dateStr);
  const production = store.getProductionForDate(dateStr);

  const [tempName, setTempName] = useState("");
  const [tempHours, setTempHours] = useState("9");

  const handleAddTemp = () => {
    if (tempName.trim()) {
      store.addTempOperator({ date: dateStr, nome: tempName.trim(), hours: Number(tempHours) || 9 });
      setTempName("");
      setTempHours("9");
    }
  };

  const occupancyColor = (rate: number) => {
    if (rate > 100) return "text-danger";
    if (rate >= 80) return "text-warning";
    return "text-success";
  };

  const occupancyBg = (rate: number) => {
    if (rate > 100) return "bg-danger/10";
    if (rate >= 80) return "bg-warning/10";
    return "bg-success/10";
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Date navigation */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold text-foreground">Dashboard</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setDate(subDays(date, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="min-w-[200px] font-medium"
            onClick={() => setDate(new Date())}
          >
            {format(date, "EEEE, d 'de' MMMM yyyy", { locale: pt })}
          </Button>
          <Button variant="outline" size="icon" onClick={() => setDate(addDays(date, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-primary">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Carga do Dia</CardTitle>
            <Clock className="h-5 w-5 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-display font-bold">{stats.cargaDoDia.toFixed(1)}h</div>
            <p className="text-xs text-muted-foreground mt-1">Horas manuais necessárias</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-secondary">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pessoas Presentes</CardTitle>
            <Users className="h-5 w-5 text-secondary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-display font-bold">{stats.pessoasPresentes}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {operators.filter((o) => o.hours > 0).length} efetivos + {tempOps.length} temporários
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-success">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Capacidade do Dia</CardTitle>
            <Gauge className="h-5 w-5 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-display font-bold">{stats.capacidadeDoDia.toFixed(1)}h</div>
            <p className="text-xs text-muted-foreground mt-1">Com coef. pausa 6.25%</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-warning">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Ocupação Equipamento</CardTitle>
            <Activity className="h-5 w-5 text-warning" />
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {stats.taxaOcupacao.map((eq) => (
                <div key={eq.equipmentName} className={`flex items-center justify-between text-sm px-2 py-1 rounded ${occupancyBg(eq.rate)}`}>
                  <span className="font-medium">{eq.equipmentName}</span>
                  <span className={`font-bold ${occupancyColor(eq.rate)}`}>{eq.rate.toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* People management */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base font-display">Equipa do Dia</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {operators.map((o) => {
              const isWorking = WORKING_CODES.includes(o.code) && !o.absent;
              return (
                <div key={o.operator.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${isWorking ? "bg-success" : "bg-muted-foreground/30"}`} />
                    <span className={isWorking ? "" : "text-muted-foreground line-through"}>{o.operator.nome}</span>
                    <span className="text-xs text-muted-foreground">({o.code})</span>
                  </div>
                  {WORKING_CODES.includes(o.code) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => o.absent ? store.removeAbsence(o.operator.id, dateStr) : store.addAbsence(o.operator.id, dateStr)}
                    >
                      {o.absent ? <UserPlus className="h-3.5 w-3.5" /> : <UserMinus className="h-3.5 w-3.5" />}
                    </Button>
                  )}
                </div>
              );
            })}
            {tempOps.map((t) => (
              <div key={t.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-secondary" />
                  <span>{t.nome}</span>
                  <span className="text-xs text-muted-foreground">(temp {t.hours}h)</span>
                </div>
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => store.removeTempOperator(t.id)}>
                  <UserMinus className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <div className="flex gap-2 mt-3 pt-3 border-t">
              <Input placeholder="Nome" value={tempName} onChange={(e) => setTempName(e.target.value)} className="h-8 text-sm" />
              <Input placeholder="Horas" value={tempHours} onChange={(e) => setTempHours(e.target.value)} className="h-8 w-16 text-sm" />
              <Button size="sm" className="h-8" onClick={handleAddTemp}>
                <UserPlus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Task list */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-display">Tarefas do Dia</CardTitle>
          </CardHeader>
          <CardContent>
            {production.length === 0 ? (
              <p className="text-muted-foreground text-sm py-8 text-center">Sem tarefas para este dia. Adicione produção no Planeamento.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Artigo</TableHead>
                    <TableHead className="text-right">QD</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Equipamento</TableHead>
                    <TableHead className="text-right">T. Homem</TableHead>
                    <TableHead className="text-right">T. Máquina</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {production
                    .map((p) => {
                      const cat = store.categories.find((c) => c.id === p.categoriaId);
                      const eq = cat ? store.equipment.find((e) => e.id === cat.equipamentoId) : null;
                      return { ...p, cat, eq };
                    })
                    .sort((a, b) => (a.eq?.nome || "").localeCompare(b.eq?.nome || ""))
                    .map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.artigo}</TableCell>
                        <TableCell className="text-right">{p.quantidade}</TableCell>
                        <TableCell>{p.cat?.nome || "-"}</TableCell>
                        <TableCell>{p.eq?.nome || "-"}</TableCell>
                        <TableCell className="text-right">{p.cat ? (p.quantidade * p.cat.tempoCicloHomem) + " min" : "-"}</TableCell>
                        <TableCell className="text-right">{p.cat ? (p.quantidade * p.cat.tempoCicloMaquina) + " min" : "-"}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
