import { useState } from "react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths } from "date-fns";
import { pt } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus, Trash2, Edit2 } from "lucide-react";
import { useStore } from "@/store/useStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default function Planeamento() {
  const store = useStore();
  const [month, setMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ artigo: "", quantidade: "", categoriaId: "" });

  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });

  const getDayCarga = (dateStr: string) => {
    const prod = store.production.filter((p) => p.date === dateStr);
    let mins = 0;
    prod.forEach((p) => {
      const cat = store.categories.find((c) => c.id === p.categoriaId);
      if (cat) mins += p.quantidade * cat.tempoCicloHomem;
    });
    return mins / 60;
  };

  const openAdd = (dateStr: string) => {
    setSelectedDate(dateStr);
    setEditId(null);
    setForm({ artigo: "", quantidade: "", categoriaId: store.categories[0]?.id || "" });
    setDialogOpen(true);
  };

  const openEdit = (entry: any) => {
    setSelectedDate(entry.date);
    setEditId(entry.id);
    setForm({ artigo: entry.artigo, quantidade: String(entry.quantidade), categoriaId: entry.categoriaId });
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!selectedDate || !form.artigo.trim() || !form.categoriaId) return;
    const data = { date: selectedDate, artigo: form.artigo.trim(), quantidade: Number(form.quantidade) || 0, categoriaId: form.categoriaId };
    if (editId) {
      store.updateProduction(editId, data);
    } else {
      store.addProduction(data);
    }
    setDialogOpen(false);
  };

  const selectedProd = selectedDate ? store.production.filter((p) => p.date === selectedDate) : [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold">Planeamento</h1>
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

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((d) => (
          <div key={d} className="text-center text-xs font-semibold text-muted-foreground py-2">{d}</div>
        ))}
        {/* Offset for first day */}
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

      {/* Day detail */}
      {selectedDate && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base font-display">
              {format(new Date(selectedDate + "T12:00"), "EEEE, d 'de' MMMM", { locale: pt })}
            </CardTitle>
            <Button size="sm" onClick={() => openAdd(selectedDate)}>
              <Plus className="h-4 w-4 mr-1" /> Adicionar
            </Button>
          </CardHeader>
          <CardContent>
            {selectedProd.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-4">Sem entradas para este dia.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Artigo</TableHead>
                    <TableHead className="text-right">QD</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead className="w-[100px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedProd.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.artigo}</TableCell>
                      <TableCell className="text-right">{p.quantidade}</TableCell>
                      <TableCell>{store.categories.find((c) => c.id === p.categoriaId)?.nome || "-"}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(p)}><Edit2 className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => store.deleteProduction(p.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editId ? "Editar Entrada" : "Nova Entrada"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Artigo</Label>
              <Input value={form.artigo} onChange={(e) => setForm({ ...form, artigo: e.target.value })} />
            </div>
            <div>
              <Label>Quantidade</Label>
              <Input type="number" value={form.quantidade} onChange={(e) => setForm({ ...form, quantidade: e.target.value })} />
            </div>
            <div>
              <Label>Categoria</Label>
              <Select value={form.categoriaId} onValueChange={(v) => setForm({ ...form, categoriaId: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {store.categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
