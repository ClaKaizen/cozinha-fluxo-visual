import { useState, useEffect } from "react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths } from "date-fns";
import { pt } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus, Trash2, CalendarDays, List, Clock, Package } from "lucide-react";
import { useStore } from "@/store/useStore";
import { INEFFICIENCY_FACTOR } from "@/store/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default function Planeamento() {
  const store = useStore();
  const [month, setMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"calendar" | "list">("calendar");

  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });

  const getDayCarga = (dateStr: string) => {
    const prod = store.production.filter((p) => p.date === dateStr);
    let mins = 0;
    prod.forEach((p) => {
      const cat = store.categories.find((c) => c.id === p.categoriaId);
      if (cat) mins += p.quantidade * cat.tempoCicloHomem;
    });
    return (mins / 60) * INEFFICIENCY_FACTOR;
  };

  const selectedProd = selectedDate ? store.production.filter((p) => p.date === selectedDate) : [];

  const [rows, setRows] = useState<{ id?: string; artigo: string; quantidade: string; unidade: string; categoriaId: string }[]>([]);

  useEffect(() => {
    if (selectedDate) {
      const prods = store.production.filter((p) => p.date === selectedDate);
      setRows(prods.map((p) => ({
        id: p.id,
        artigo: p.artigo,
        quantidade: String(p.quantidade),
        unidade: p.unidade,
        categoriaId: p.categoriaId,
      })));
    }
  }, [selectedDate, store.production]);

  const addRow = () => {
    setRows([...rows, { artigo: "", quantidade: "", unidade: "", categoriaId: "" }]);
  };

  const updateRow = (idx: number, field: string, value: string) => {
    const newRows = [...rows];
    const row = { ...newRows[idx], [field]: value };
    if (field === "artigo" && value.trim()) {
      const suggestedCat = store.getArtigoCategory(value);
      if (suggestedCat && !row.categoriaId) {
        row.categoriaId = suggestedCat;
        const cat = store.categories.find((c) => c.id === suggestedCat);
        if (cat) row.unidade = cat.unidade;
      }
    }
    if (field === "categoriaId" && value) {
      const cat = store.categories.find((c) => c.id === value);
      if (cat) row.unidade = cat.unidade;
    }
    newRows[idx] = row;
    setRows(newRows);
  };

  const saveAll = () => {
    if (!selectedDate) return;
    const existingIds = rows.filter((r) => r.id).map((r) => r.id!);
    selectedProd.forEach((p) => {
      if (!existingIds.includes(p.id)) store.deleteProduction(p.id);
    });
    rows.forEach((r) => {
      if (!r.artigo.trim() || !r.categoriaId) return;
      const data = {
        date: selectedDate,
        artigo: r.artigo.trim(),
        quantidade: Number(r.quantidade) || 0,
        unidade: r.unidade,
        categoriaId: r.categoriaId,
      };
      if (r.id) {
        store.updateProduction(r.id, data);
      } else {
        store.addProduction(data);
      }
    });
    setSelectedDate(null);
  };

  const deleteRow = (idx: number) => {
    const row = rows[idx];
    if (row.id) store.deleteProduction(row.id);
    setRows(rows.filter((_, i) => i !== idx));
  };

  // List view: group production by date
  const allProduction = [...store.production].sort((a, b) => a.date.localeCompare(b.date));
  const groupedByDate = new Map<string, typeof allProduction>();
  allProduction.forEach((p) => {
    if (!groupedByDate.has(p.date)) groupedByDate.set(p.date, []);
    groupedByDate.get(p.date)!.push(p);
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold">Planeamento</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            <Button variant={viewMode === "calendar" ? "default" : "ghost"} size="sm" onClick={() => setViewMode("calendar")}>
              <CalendarDays className="h-4 w-4 mr-1" /> Calendário
            </Button>
            <Button variant={viewMode === "list" ? "default" : "ghost"} size="sm" onClick={() => setViewMode("list")}>
              <List className="h-4 w-4 mr-1" /> Lista
            </Button>
          </div>
          {viewMode === "calendar" && (
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
          )}
        </div>
      </div>

      {viewMode === "calendar" ? (
        <div className="grid grid-cols-7 gap-1">
          {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((d) => (
            <div key={d} className="text-center text-xs font-semibold text-muted-foreground py-2">{d}</div>
          ))}
          {Array.from({ length: (days[0].getDay() + 6) % 7 }).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}
          {days.map((day) => {
            const dateStr = format(day, "yyyy-MM-dd");
            const count = store.production.filter((p) => p.date === dateStr).length;
            const carga = getDayCarga(dateStr);
            const isSelected = selectedDate === dateStr;
            return (
              <button
                key={dateStr}
                onClick={() => setSelectedDate(dateStr)}
                className={`p-2 rounded-lg text-left min-h-[80px] transition-colors border ${
                  isSelected ? "border-primary bg-accent" : "border-transparent hover:bg-muted"
                }`}
              >
                <div className="text-sm font-medium">{format(day, "d")}</div>
                {count > 0 && (
                  <div className="mt-1 space-y-0.5">
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{count} itens</Badge>
                    <div className="text-[10px] text-muted-foreground">{carga.toFixed(1)}h</div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        /* Redesigned list view - grouped by day */
        <div className="space-y-4">
          {groupedByDate.size === 0 ? (
            <Card>
              <CardContent className="py-8">
                <p className="text-muted-foreground text-sm text-center">Sem entradas planeadas.</p>
              </CardContent>
            </Card>
          ) : (
            Array.from(groupedByDate.entries()).map(([dateStr, items]) => {
              const carga = getDayCarga(dateStr);
              return (
                <div key={dateStr} className="rounded-lg border overflow-hidden bg-card">
                  {/* Day header */}
                  <div className="bg-secondary px-4 py-2.5 flex items-center justify-between">
                    <span className="text-secondary-foreground font-display font-semibold text-sm capitalize">
                      {format(new Date(dateStr + "T12:00"), "EEEE, d 'de' MMMM yyyy", { locale: pt })}
                    </span>
                    <div className="flex items-center gap-3 text-secondary-foreground/80 text-xs">
                      <span className="flex items-center gap-1"><Package className="h-3 w-3" />{items.length} itens</span>
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{carga.toFixed(1)}h carga</span>
                    </div>
                  </div>
                  {/* Day table */}
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="text-left font-medium px-4 py-1.5">Artigo</th>
                        <th className="text-right font-medium px-3 py-1.5">QD</th>
                        <th className="text-left font-medium px-3 py-1.5">Unid.</th>
                        <th className="text-left font-medium px-3 py-1.5">Categoria</th>
                        <th className="text-left font-medium px-3 py-1.5">Equipamento</th>
                        <th className="text-right font-medium px-3 py-1.5">T. Homem</th>
                        <th className="text-right font-medium px-4 py-1.5">T. Máquina</th>
                        <th className="px-2 py-1.5 w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((p, idx) => {
                        const cat = store.categories.find((c) => c.id === p.categoriaId);
                        const eq = cat ? store.equipment.find((e) => e.id === cat.equipamentoId) : null;
                        return (
                          <tr key={p.id} className={`border-b last:border-b-0 ${idx % 2 === 1 ? "bg-muted/30" : ""}`}>
                            <td className="px-4 py-1.5 font-medium">{p.artigo}</td>
                            <td className="px-3 py-1.5 text-right">{p.quantidade}</td>
                            <td className="px-3 py-1.5">{p.unidade || "-"}</td>
                            <td className="px-3 py-1.5">{cat?.nome || "-"}</td>
                            <td className="px-3 py-1.5">{eq?.nome || "-"}</td>
                            <td className="px-3 py-1.5 text-right">{cat ? `${p.quantidade * cat.tempoCicloHomem} min` : "-"}</td>
                            <td className="px-4 py-1.5 text-right">{cat ? `${p.quantidade * cat.tempoCicloMaquina} min` : "-"}</td>
                            <td className="px-2 py-1.5">
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => store.deleteProduction(p.id)}>
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Day detail dialog */}
      <Dialog open={!!selectedDate} onOpenChange={(open) => !open && setSelectedDate(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">
              {selectedDate && format(new Date(selectedDate + "T12:00"), "EEEE, d 'de' MMMM yyyy", { locale: pt })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Artigo</TableHead>
                  <TableHead className="w-[90px]">QD</TableHead>
                  <TableHead className="w-[80px]">Unidade</TableHead>
                  <TableHead className="w-[180px]">Categoria</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, idx) => (
                  <TableRow key={idx}>
                    <TableCell>
                      <Input
                        value={row.artigo}
                        onChange={(e) => updateRow(idx, "artigo", e.target.value)}
                        onBlur={() => {
                          if (row.artigo.trim() && !row.categoriaId) {
                            const cat = store.getArtigoCategory(row.artigo);
                            if (cat) updateRow(idx, "categoriaId", cat);
                          }
                        }}
                        placeholder="Nome do artigo"
                        className="h-8"
                      />
                    </TableCell>
                    <TableCell>
                      <Input type="number" value={row.quantidade} onChange={(e) => updateRow(idx, "quantidade", e.target.value)} className="h-8" />
                    </TableCell>
                    <TableCell>
                      <Input value={row.unidade} onChange={(e) => updateRow(idx, "unidade", e.target.value)} placeholder="kg" className="h-8" />
                    </TableCell>
                    <TableCell>
                      <Select value={row.categoriaId} onValueChange={(v) => updateRow(idx, "categoriaId", v)}>
                        <SelectTrigger className="h-8"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                        <SelectContent>
                          {store.categories.map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => deleteRow(idx)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Button variant="outline" size="sm" onClick={addRow}>
              <Plus className="h-4 w-4 mr-1" /> Adicionar linha
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedDate(null)}>Cancelar</Button>
            <Button onClick={saveAll}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
