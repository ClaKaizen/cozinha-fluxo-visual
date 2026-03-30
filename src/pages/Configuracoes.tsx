import { useState } from "react";
import { Plus, Trash2, Edit2, Save, X } from "lucide-react";
import { useStore } from "@/store/useStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Configuracoes() {
  const store = useStore();

  // Equipment form
  const [eqForm, setEqForm] = useState({ nome: "", quantidade: "" });
  const [editEq, setEditEq] = useState<string | null>(null);

  // Category form
  const [catForm, setCatForm] = useState({ nome: "", equipamentoId: "", tempoCicloHomem: "", tempoCicloMaquina: "" });
  const [editCat, setEditCat] = useState<string | null>(null);

  const handleAddEq = () => {
    if (eqForm.nome.trim()) {
      store.addEquipment({ nome: eqForm.nome.trim(), quantidade: Number(eqForm.quantidade) || 1 });
      setEqForm({ nome: "", quantidade: "" });
    }
  };

  const handleSaveEq = (id: string) => {
    store.updateEquipment(id, { nome: eqForm.nome, quantidade: Number(eqForm.quantidade) || 1 });
    setEditEq(null);
    setEqForm({ nome: "", quantidade: "" });
  };

  const handleAddCat = () => {
    if (catForm.nome.trim() && catForm.equipamentoId) {
      store.addCategory({
        nome: catForm.nome.trim(),
        equipamentoId: catForm.equipamentoId,
        tempoCicloHomem: Number(catForm.tempoCicloHomem) || 0,
        tempoCicloMaquina: Number(catForm.tempoCicloMaquina) || 0,
      });
      setCatForm({ nome: "", equipamentoId: "", tempoCicloHomem: "", tempoCicloMaquina: "" });
    }
  };

  const handleSaveCat = (id: string) => {
    store.updateCategory(id, {
      nome: catForm.nome,
      equipamentoId: catForm.equipamentoId,
      tempoCicloHomem: Number(catForm.tempoCicloHomem) || 0,
      tempoCicloMaquina: Number(catForm.tempoCicloMaquina) || 0,
    });
    setEditCat(null);
    setCatForm({ nome: "", equipamentoId: "", tempoCicloHomem: "", tempoCicloMaquina: "" });
  };

  return (
    <div className="space-y-8 animate-fade-in">
      <h1 className="text-2xl font-display font-bold">Configurações</h1>

      {/* Equipment */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-display">Equipamentos</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead className="text-right">Quantidade</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {store.equipment.map((eq) => (
                <TableRow key={eq.id}>
                  {editEq === eq.id ? (
                    <>
                      <TableCell><Input value={eqForm.nome} onChange={(e) => setEqForm({ ...eqForm, nome: e.target.value })} className="h-8" /></TableCell>
                      <TableCell><Input type="number" value={eqForm.quantidade} onChange={(e) => setEqForm({ ...eqForm, quantidade: e.target.value })} className="h-8 w-20 ml-auto" /></TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => handleSaveEq(eq.id)}><Save className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditEq(null)}><X className="h-3.5 w-3.5" /></Button>
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="font-medium">{eq.nome}</TableCell>
                      <TableCell className="text-right">{eq.quantidade}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => { setEditEq(eq.id); setEqForm({ nome: eq.nome, quantidade: String(eq.quantidade) }); }}>
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => store.deleteEquipment(eq.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex gap-2 mt-4">
            <Input placeholder="Nome do equipamento" value={editEq ? "" : eqForm.nome} onChange={(e) => !editEq && setEqForm({ ...eqForm, nome: e.target.value })} className="h-9" disabled={!!editEq} />
            <Input placeholder="QD" type="number" value={editEq ? "" : eqForm.quantidade} onChange={(e) => !editEq && setEqForm({ ...eqForm, quantidade: e.target.value })} className="h-9 w-20" disabled={!!editEq} />
            <Button onClick={handleAddEq} disabled={!!editEq} className="h-9"><Plus className="h-4 w-4 mr-1" /> Adicionar</Button>
          </div>
        </CardContent>
      </Card>

      {/* Categories */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-display">Categorias & Tempos de Ciclo</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Equipamento</TableHead>
                <TableHead className="text-right">T. Homem (min)</TableHead>
                <TableHead className="text-right">T. Máquina (min)</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {store.categories.map((cat) => (
                <TableRow key={cat.id}>
                  {editCat === cat.id ? (
                    <>
                      <TableCell><Input value={catForm.nome} onChange={(e) => setCatForm({ ...catForm, nome: e.target.value })} className="h-8" /></TableCell>
                      <TableCell>
                        <Select value={catForm.equipamentoId} onValueChange={(v) => setCatForm({ ...catForm, equipamentoId: v })}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {store.equipment.map((eq) => <SelectItem key={eq.id} value={eq.id}>{eq.nome}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell><Input type="number" value={catForm.tempoCicloHomem} onChange={(e) => setCatForm({ ...catForm, tempoCicloHomem: e.target.value })} className="h-8 w-20 ml-auto" /></TableCell>
                      <TableCell><Input type="number" value={catForm.tempoCicloMaquina} onChange={(e) => setCatForm({ ...catForm, tempoCicloMaquina: e.target.value })} className="h-8 w-20 ml-auto" /></TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => handleSaveCat(cat.id)}><Save className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditCat(null)}><X className="h-3.5 w-3.5" /></Button>
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="font-medium">{cat.nome}</TableCell>
                      <TableCell>{store.equipment.find((e) => e.id === cat.equipamentoId)?.nome || "-"}</TableCell>
                      <TableCell className="text-right">{cat.tempoCicloHomem}</TableCell>
                      <TableCell className="text-right">{cat.tempoCicloMaquina}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => {
                          setEditCat(cat.id);
                          setCatForm({ nome: cat.nome, equipamentoId: cat.equipamentoId, tempoCicloHomem: String(cat.tempoCicloHomem), tempoCicloMaquina: String(cat.tempoCicloMaquina) });
                        }}>
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => store.deleteCategory(cat.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex gap-2 mt-4 flex-wrap">
            <Input placeholder="Nome da categoria" value={editCat ? "" : catForm.nome} onChange={(e) => !editCat && setCatForm({ ...catForm, nome: e.target.value })} className="h-9 flex-1 min-w-[150px]" disabled={!!editCat} />
            <Select value={editCat ? "" : catForm.equipamentoId} onValueChange={(v) => !editCat && setCatForm({ ...catForm, equipamentoId: v })} disabled={!!editCat}>
              <SelectTrigger className="h-9 w-[150px]"><SelectValue placeholder="Equipamento" /></SelectTrigger>
              <SelectContent>
                {store.equipment.map((eq) => <SelectItem key={eq.id} value={eq.id}>{eq.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="T. Homem" type="number" value={editCat ? "" : catForm.tempoCicloHomem} onChange={(e) => !editCat && setCatForm({ ...catForm, tempoCicloHomem: e.target.value })} className="h-9 w-24" disabled={!!editCat} />
            <Input placeholder="T. Máquina" type="number" value={editCat ? "" : catForm.tempoCicloMaquina} onChange={(e) => !editCat && setCatForm({ ...catForm, tempoCicloMaquina: e.target.value })} className="h-9 w-24" disabled={!!editCat} />
            <Button onClick={handleAddCat} disabled={!!editCat} className="h-9"><Plus className="h-4 w-4 mr-1" /> Adicionar</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
