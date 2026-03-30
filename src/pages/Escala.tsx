import { useState } from "react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths } from "date-fns";
import { pt } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useStore } from "@/store/useStore";
import { ShiftCode, WORKING_CODES } from "@/store/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ALL_CODES: ShiftCode[] = ['D', 'E', 'I', 'FG', 'F', 'B', 'RH', 'K', 'FD', 'NT', 'AN', 'C'];

export default function Escala() {
  const store = useStore();
  const [month, setMonth] = useState(new Date());
  const [newName, setNewName] = useState("");

  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });

  const getCode = (opId: string, dateStr: string): ShiftCode => {
    const entry = store.schedule.find((e) => e.operatorId === opId && e.date === dateStr);
    return entry?.code || 'FG';
  };

  const countPresent = (dateStr: string) => {
    return store.operators.filter((op) => {
      const code = getCode(op.id, dateStr);
      return WORKING_CODES.includes(code);
    }).length;
  };

  const codeColor = (code: ShiftCode) => {
    if (WORKING_CODES.includes(code)) return "bg-primary/15 text-primary font-semibold";
    if (code === 'F' || code === 'FG' || code === 'FD' || code === 'K') return "bg-muted text-muted-foreground";
    if (code === 'B') return "bg-destructive/10 text-destructive";
    return "bg-muted text-muted-foreground";
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold">Escala</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setMonth(subMonths(month, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="font-display font-semibold min-w-[180px] text-center capitalize">
            {format(month, "MMMM yyyy", { locale: pt })}
          </span>
          <Button variant="outline" size="icon" onClick={() => setMonth(addMonths(month, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Add operator */}
      <div className="flex gap-2 max-w-sm">
        <Input placeholder="Nome do operador" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <Button onClick={() => { if (newName.trim()) { store.addOperator(newName.trim()); setNewName(""); } }}>
          <Plus className="h-4 w-4 mr-1" /> Adicionar
        </Button>
      </div>

      {/* Schedule grid */}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="text-xs w-full">
          <thead>
            <tr className="border-b">
              <th className="sticky left-0 bg-card z-10 px-3 py-2 text-left font-semibold min-w-[140px]">Operador</th>
              {days.map((day) => (
                <th key={day.toISOString()} className="px-1 py-2 text-center min-w-[44px]">
                  <div>{format(day, "EEE", { locale: pt })}</div>
                  <div className="font-bold">{format(day, "d")}</div>
                </th>
              ))}
              <th className="px-2 py-2 text-center min-w-[40px]">
                <Trash2 className="h-3.5 w-3.5 mx-auto text-muted-foreground" />
              </th>
            </tr>
          </thead>
          <tbody>
            {store.operators.map((op) => (
              <tr key={op.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="sticky left-0 bg-card z-10 px-3 py-1.5 font-medium">{op.nome}</td>
                {days.map((day) => {
                  const dateStr = format(day, "yyyy-MM-dd");
                  const code = getCode(op.id, dateStr);
                  return (
                    <td key={dateStr} className="px-0.5 py-1">
                      <Select value={code} onValueChange={(v) => store.setSchedule(op.id, dateStr, v as ShiftCode)}>
                        <SelectTrigger className={`h-7 w-10 text-[10px] px-1 border-0 justify-center ${codeColor(code)}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ALL_CODES.map((c) => (
                            <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  );
                })}
                <td className="px-1 py-1 text-center">
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => store.deleteOperator(op.id)}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </td>
              </tr>
            ))}
            {/* Present count row */}
            <tr className="border-t-2 border-primary/20 bg-accent/50">
              <td className="sticky left-0 bg-accent/50 z-10 px-3 py-2 font-semibold text-primary">Presentes</td>
              {days.map((day) => {
                const dateStr = format(day, "yyyy-MM-dd");
                return (
                  <td key={dateStr} className="px-1 py-2 text-center font-bold text-primary">
                    {countPresent(dateStr)}
                  </td>
                );
              })}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
