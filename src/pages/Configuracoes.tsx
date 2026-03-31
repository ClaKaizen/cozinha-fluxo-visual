import { useState } from "react";
import { Plus, Trash2, Edit2, Save, X, Wrench, Tag, User, Cog } from "lucide-react";
import { useStore } from "@/store/useStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const EQUIPMENT_COLORS = [
  "hsl(45, 90%, 60%)",
  "hsl(210, 60%, 55%)",
  "hsl(340, 60%, 55%)",
  "hsl(160, 50%, 45%)",
  "hsl(30, 70%, 55%)",
  "hsl(270, 50%, 55%)",
];

export default function Configuracoes() {
  const store = useStore();

  const [eqForm, setEqForm] = useState({ nome: "", quantidade: "" });
  const [editEq, setEditEq] = useState<string | null>(null);

  const [catForm, setCatForm] = useState({ nome: "", equipamentoId: "", tempoCicloHomem: "", tempoCicloMaquina: "", unidade: "" });
  const [editCat, setEditCat] = useState<string | null>(null);

  const eqColorMap = new Map<string, string>();
  store.equipment.forEach((eq, idx) => eqColorMap.set(eq.id, EQUIPMENT_COLORS[idx % EQUIPMENT_COLORS.length]));

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
        unidade: catForm.unidade.trim() || "unid",
      });
      setCatForm({ nome: "", equipamentoId: "", tempoCicloHomem: "", tempoCicloMaquina: "", unidade: "" });
    }
  };

  const handleSaveCat = (id: string) => {
    store.updateCategory(id, {
      nome: catForm.nome,
      equipamentoId: catForm.equipamentoId,
      tempoCicloHomem: Number(catForm.tempoCicloHomem) || 0,
      tempoCicloMaquina: Number(catForm.tempoCicloMaquina) || 0,
      unidade: catForm.unidade.trim() || "unid",
    });
    setEditCat(null);
    setCatForm({ nome: "", equipamentoId: "", tempoCicloHomem: "", tempoCicloMaquina: "", unidade: "" });
  };

  const inputCls = "h-7 text-xs";
  const cellCls = "px-2 py-1";

  return (
    <div className="space-y-8 animate-fade-in">
      <h1 className="text-2xl font-display font-bold">Configurações</h1>

      {/* Equipment */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 rounded-t-lg" style={{ backgroundColor: "hsl(215, 25%, 34%)" }}>
          <Wrench className="h-4 w-4 text-white" />
          <span className="text-white font-display font-semibold text-base">Equipamentos</span>
        </div>
        <CardContent className="pt-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className={`text-left font-medium ${cellCls}`}>Nome</th>
                <th className={`text-right font-medium ${cellCls}`}>Quantidade</th>
                <th className={`${cellCls} w-[80px]`}></th>
              </tr>
            </thead>
            <tbody>
              {store.equipment.map((eq) => (
                <tr key={eq.id} className="border-b last:border-b-0 hover:bg-muted/30">
                  {editEq === eq.id ? (
                    <>
                      <td className={cellCls}><Input value={eqForm.nome} onChange={(e) => setEqForm({ ...eqForm, nome: e.target.value })} className={inputCls} /></td>
                      <td className={cellCls}><Input type="number" value={eqForm.quantidade} onChange={(e) => setEqForm({ ...eqForm, quantidade: e.target.value })} className={`${inputCls} w-16 ml-auto`} /></td>
                      <td className={`${cellCls} text-right`}>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleSaveEq(eq.id)}><Save className="h-3 w-3" /></Button>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setEditEq(null)}><X className="h-3 w-3" /></Button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className={`${cellCls} font-medium`}>{eq.nome}</td>
                      <td className={`${cellCls} text-right`}>{eq.quantidade}</td>
                      <td className={`${cellCls} text-right`}>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { setEditEq(eq.id); setEqForm({ nome: eq.nome, quantidade: String(eq.quantidade) }); }}>
                          <Edit2 className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 ml-1" onClick={() => store.deleteEquipment(eq.id)}>
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex gap-2 mt-3">
            <Input placeholder="Nome do equipamento" value={editEq ? "" : eqForm.nome} onChange={(e) => !editEq && setEqForm({ ...eqForm, nome: e.target.value })} className="h-8 text-xs" disabled={!!editEq} />
            <Input placeholder="QD" type="number" value={editEq ? "" : eqForm.quantidade} onChange={(e) => !editEq && setEqForm({ ...eqForm, quantidade: e.target.value })} className="h-8 text-xs w-16" disabled={!!editEq} />
            <Button onClick={handleAddEq} disabled={!!editEq} size="sm" className="h-8 text-xs"><Plus className="h-3 w-3 mr-1" /> Adicionar</Button>
          </div>
        </CardContent>
      </Card>

      {/* Categories */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 rounded-t-lg" style={{ backgroundColor: "hsl(215, 25%, 34%)" }}>
          <Tag className="h-4 w-4 text-white" />
          <span className="text-white font-display font-semibold text-base">Categorias & Tempos de Ciclo</span>
        </div>
        <CardContent className="pt-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className={`text-left font-medium ${cellCls}`}>Nome</th>
                  <th className={`text-left font-medium ${cellCls}`}>Equipamento</th>
                  <th className={`text-right font-medium ${cellCls}`}>T. Homem</th>
                  <th className={`text-right font-medium ${cellCls}`}>T. Máquina</th>
                  <th className={`text-left font-medium ${cellCls}`}>Unidade</th>
                  <th className={`${cellCls} w-[70px]`}></th>
                </tr>
              </thead>
              <tbody>
                {store.categories.map((cat) => {
                  const eqColor = eqColorMap.get(cat.equipamentoId) || "hsl(var(--muted-foreground))";
                  const eqName = store.equipment.find((e) => e.id === cat.equipamentoId)?.nome || "-";
                  return (
                    <tr key={cat.id} className="border-b last:border-b-0 hover:bg-muted/30" style={{ borderLeft: `3px solid ${eqColor}` }}>
                      {editCat === cat.id ? (
                        <>
                          <td className={cellCls}><Input value={catForm.nome} onChange={(e) => setCatForm({ ...catForm, nome: e.target.value })} className={inputCls} /></td>
                          <td className={cellCls}>
                            <Select value={catForm.equipamentoId} onValueChange={(v) => setCatForm({ ...catForm, equipamentoId: v })}>
                              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {store.equipment.map((eq) => <SelectItem key={eq.id} value={eq.id}>{eq.nome}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className={cellCls}><Input type="number" value={catForm.tempoCicloHomem} onChange={(e) => setCatForm({ ...catForm, tempoCicloHomem: e.target.value })} className={`${inputCls} w-16 ml-auto`} /></td>
                          <td className={cellCls}><Input type="number" value={catForm.tempoCicloMaquina} onChange={(e) => setCatForm({ ...catForm, tempoCicloMaquina: e.target.value })} className={`${inputCls} w-16 ml-auto`} /></td>
                          <td className={cellCls}><Input value={catForm.unidade} onChange={(e) => setCatForm({ ...catForm, unidade: e.target.value })} className={`${inputCls} w-16`} placeholder="kg" /></td>
                          <td className={`${cellCls} text-right`}>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleSaveCat(cat.id)}><Save className="h-3 w-3" /></Button>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setEditCat(null)}><X className="h-3 w-3" /></Button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className={`${cellCls} font-medium`}>{cat.nome}</td>
                          <td className={cellCls}>
                            <Badge
                              variant="outline"
                              className="text-[10px] px-2 py-0 font-medium border"
                              style={{ borderColor: eqColor, color: eqColor, backgroundColor: eqColor + "15" }}
                            >
                              {eqName}
                            </Badge>
                          </td>
                          <td className={`${cellCls} text-right`}>
                            <span className="inline-flex items-center gap-1">
                              <User className="h-3 w-3 text-muted-foreground" />
                              {cat.tempoCicloHomem} min
                            </span>
                          </td>
                          <td className={`${cellCls} text-right`}>
                            <span className="inline-flex items-center gap-1">
                              <Cog className="h-3 w-3 text-muted-foreground" />
                              {cat.tempoCicloMaquina} min
                            </span>
                          </td>
                          <td className={cellCls}>
                            <Badge variant="secondary" className="text-[10px] px-2 py-0 font-normal">
                              {cat.unidade || "-"}
                            </Badge>
                          </td>
                          <td className={`${cellCls} text-right`}>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => {
                              setEditCat(cat.id);
                              setCatForm({ nome: cat.nome, equipamentoId: cat.equipamentoId, tempoCicloHomem: String(cat.tempoCicloHomem), tempoCicloMaquina: String(cat.tempoCicloMaquina), unidade: cat.unidade || "" });
                            }}>
                              <Edit2 className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 ml-1" onClick={() => store.deleteCategory(cat.id)}>
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2 mt-3 flex-wrap">
            <Input placeholder="Nome da categoria" value={editCat ? "" : catForm.nome} onChange={(e) => !editCat && setCatForm({ ...catForm, nome: e.target.value })} className="h-8 text-xs flex-1 min-w-[120px]" disabled={!!editCat} />
            <Select value={editCat ? "" : catForm.equipamentoId} onValueChange={(v) => !editCat && setCatForm({ ...catForm, equipamentoId: v })} disabled={!!editCat}>
              <SelectTrigger className="h-8 text-xs w-[130px]"><SelectValue placeholder="Equipamento" /></SelectTrigger>
              <SelectContent>
                {store.equipment.map((eq) => <SelectItem key={eq.id} value={eq.id}>{eq.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="T. Homem" type="number" value={editCat ? "" : catForm.tempoCicloHomem} onChange={(e) => !editCat && setCatForm({ ...catForm, tempoCicloHomem: e.target.value })} className="h-8 text-xs w-20" disabled={!!editCat} />
            <Input placeholder="T. Máquina" type="number" value={editCat ? "" : catForm.tempoCicloMaquina} onChange={(e) => !editCat && setCatForm({ ...catForm, tempoCicloMaquina: e.target.value })} className="h-8 text-xs w-20" disabled={!!editCat} />
            <Input placeholder="Unid." value={editCat ? "" : catForm.unidade} onChange={(e) => !editCat && setCatForm({ ...catForm, unidade: e.target.value })} className="h-8 text-xs w-16" disabled={!!editCat} />
            <Button onClick={handleAddCat} disabled={!!editCat} size="sm" className="h-8 text-xs"><Plus className="h-3 w-3 mr-1" /> Adicionar</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
