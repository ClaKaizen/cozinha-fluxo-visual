import { useState } from "react";
import { Plus, Trash2, Edit2, Save, X, Wrench, Tag, User, Cog, AlertTriangle } from "lucide-react";
import { useStore } from "@/store/useStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { CategoryEquipmentEntry } from "@/store/types";

const EQUIPMENT_COLORS = [
  "hsl(45, 90%, 60%)", "hsl(210, 60%, 55%)", "hsl(340, 60%, 55%)",
  "hsl(160, 50%, 45%)", "hsl(30, 70%, 55%)", "hsl(270, 50%, 55%)",
];

export default function Configuracoes() {
  const store = useStore();

  const [eqForm, setEqForm] = useState({ nome: "", quantidade: "", emergencia: false });
  const [editEq, setEditEq] = useState<string | null>(null);

  const [catForm, setCatForm] = useState({
    nome: "", equipamentoId: "",
    tempoCicloHomem: "", tempoCicloMaquina: "",
    tempoCicloHomem1: "", tempoCicloMaquina1: "",
    unidade: "",
    equipamentos: [] as CategoryEquipmentEntry[],
  });
  const [editCat, setEditCat] = useState<string | null>(null);

  const eqColorMap = new Map<string, string>();
  store.equipment.forEach((eq, idx) => eqColorMap.set(eq.id, EQUIPMENT_COLORS[idx % EQUIPMENT_COLORS.length]));

  const normalEquipment = store.equipment.filter(e => !e.emergencia);
  const emergencyEquipment = store.equipment.filter(e => e.emergencia);

  const handleAddEq = () => {
    if (eqForm.nome.trim()) {
      store.addEquipment({ nome: eqForm.nome.trim(), quantidade: Number(eqForm.quantidade) || 1, emergencia: eqForm.emergencia });
      setEqForm({ nome: "", quantidade: "", emergencia: false });
    }
  };

  const handleSaveEq = (id: string) => {
    store.updateEquipment(id, { nome: eqForm.nome, quantidade: Number(eqForm.quantidade) || 1, emergencia: eqForm.emergencia });
    setEditEq(null);
    setEqForm({ nome: "", quantidade: "", emergencia: false });
  };

  const handleAddCat = () => {
    if (catForm.nome.trim() && catForm.equipamentoId) {
      store.addCategory({
        nome: catForm.nome.trim(),
        equipamentoId: catForm.equipamentoId,
        tempoCicloHomem: Number(catForm.tempoCicloHomem) || 0,
        tempoCicloMaquina: Number(catForm.tempoCicloMaquina) || 0,
        tempoCicloHomem1: Number(catForm.tempoCicloHomem1) || Number(catForm.tempoCicloHomem) || 0,
        tempoCicloMaquina1: Number(catForm.tempoCicloMaquina1) || Number(catForm.tempoCicloMaquina) || 0,
        unidade: catForm.unidade.trim() || "unid",
        equipamentos: catForm.equipamentos.length > 0 ? catForm.equipamentos : undefined,
      });
      resetCatForm();
    }
  };

  const handleSaveCat = (id: string) => {
    store.updateCategory(id, {
      nome: catForm.nome,
      equipamentoId: catForm.equipamentoId,
      tempoCicloHomem: Number(catForm.tempoCicloHomem) || 0,
      tempoCicloMaquina: Number(catForm.tempoCicloMaquina) || 0,
      tempoCicloHomem1: Number(catForm.tempoCicloHomem1) || Number(catForm.tempoCicloHomem) || 0,
      tempoCicloMaquina1: Number(catForm.tempoCicloMaquina1) || Number(catForm.tempoCicloMaquina) || 0,
      unidade: catForm.unidade.trim() || "unid",
      equipamentos: catForm.equipamentos.length > 0 ? catForm.equipamentos : undefined,
    });
    setEditCat(null);
    resetCatForm();
  };

  const resetCatForm = () => setCatForm({
    nome: "", equipamentoId: "", tempoCicloHomem: "", tempoCicloMaquina: "",
    tempoCicloHomem1: "", tempoCicloMaquina1: "", unidade: "",
    equipamentos: [],
  });

  const addExtraEquipment = () => {
    setCatForm(f => ({
      ...f,
      equipamentos: [...f.equipamentos, { equipamentoId: "", tempoCicloMaquina: 0, simultaneo: false }],
    }));
  };

  const updateExtraEquipment = (idx: number, patch: Partial<CategoryEquipmentEntry>) => {
    setCatForm(f => ({
      ...f,
      equipamentos: f.equipamentos.map((e, i) => i === idx ? { ...e, ...patch } : e),
    }));
  };

  const removeExtraEquipment = (idx: number) => {
    setCatForm(f => ({ ...f, equipamentos: f.equipamentos.filter((_, i) => i !== idx) }));
  };

  const inputCls = "h-7 text-xs";
  const cellCls = "px-2 py-1";

  const renderEquipmentTable = (items: typeof store.equipment, title?: string) => (
    <>
      {title && (
        <div className="flex items-center gap-2 mt-4 mb-2">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <span className="text-sm font-semibold text-warning">{title}</span>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th className={`text-left font-medium ${cellCls}`}>Nome</th>
            <th className={`text-right font-medium ${cellCls}`}>Quantidade</th>
            <th className={`text-center font-medium ${cellCls}`}>Emergência</th>
            <th className={`${cellCls} w-[80px]`}></th>
          </tr>
        </thead>
        <tbody>
          {items.map((eq) => (
            <tr key={eq.id} className="border-b last:border-b-0 hover:bg-muted/30">
              {editEq === eq.id ? (
                <>
                  <td className={cellCls}><Input value={eqForm.nome} onChange={(e) => setEqForm({ ...eqForm, nome: e.target.value })} className={inputCls} /></td>
                  <td className={cellCls}><Input type="number" value={eqForm.quantidade} onChange={(e) => setEqForm({ ...eqForm, quantidade: e.target.value })} className={`${inputCls} w-16 ml-auto`} /></td>
                  <td className={`${cellCls} text-center`}>
                    <Switch checked={eqForm.emergencia} onCheckedChange={(v) => setEqForm({ ...eqForm, emergencia: v })} />
                  </td>
                  <td className={`${cellCls} text-right`}>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleSaveEq(eq.id)}><Save className="h-3 w-3" /></Button>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setEditEq(null)}><X className="h-3 w-3" /></Button>
                  </td>
                </>
              ) : (
                <>
                  <td className={`${cellCls} font-medium`}>{eq.nome}</td>
                  <td className={`${cellCls} text-right`}>{eq.quantidade}</td>
                  <td className={`${cellCls} text-center`}>
                    {eq.emergencia && <Badge variant="outline" className="text-[10px] text-warning border-warning/40 bg-warning/10">Emergência</Badge>}
                  </td>
                  <td className={`${cellCls} text-right`}>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { setEditEq(eq.id); setEqForm({ nome: eq.nome, quantidade: String(eq.quantidade), emergencia: eq.emergencia ?? false }); }}>
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
    </>
  );

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
          {renderEquipmentTable(normalEquipment)}
          {emergencyEquipment.length > 0 && renderEquipmentTable(emergencyEquipment, "Equipamentos de Emergência")}
          <div className="flex gap-2 mt-3 items-center">
            <Input placeholder="Nome do equipamento" value={editEq ? "" : eqForm.nome} onChange={(e) => !editEq && setEqForm({ ...eqForm, nome: e.target.value })} className="h-8 text-xs" disabled={!!editEq} />
            <Input placeholder="QD" type="number" value={editEq ? "" : eqForm.quantidade} onChange={(e) => !editEq && setEqForm({ ...eqForm, quantidade: e.target.value })} className="h-8 text-xs w-16" disabled={!!editEq} />
            <div className="flex items-center gap-1.5">
              <Switch checked={editEq ? false : eqForm.emergencia} onCheckedChange={(v) => !editEq && setEqForm({ ...eqForm, emergencia: v })} disabled={!!editEq} />
              <Label className="text-xs text-muted-foreground">Emerg.</Label>
            </div>
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
                  <th className={`text-right font-medium ${cellCls}`}><User className="h-3 w-3 inline mr-1" />T. Homem</th>
                  <th className={`text-right font-medium ${cellCls}`}><Cog className="h-3 w-3 inline mr-1" />T. Máquina</th>
                  <th className={`text-left font-medium ${cellCls}`}>Unidade</th>
                  <th className={`${cellCls} w-[70px]`}></th>
                </tr>
              </thead>
              <tbody>
                {store.categories.map((cat) => {
                  const eqColor = eqColorMap.get(cat.equipamentoId) || "hsl(var(--muted-foreground))";
                  const eqName = store.equipment.find((e) => e.id === cat.equipamentoId)?.nome || "-";
                  const hasFirstUnit = cat.tempoCicloHomem1 != null || cat.tempoCicloMaquina1 != null;
                  const hasExtraEquip = cat.equipamentos && cat.equipamentos.length > 0;

                  return (
                    <tr key={cat.id} className="border-b last:border-b-0 hover:bg-muted/30" style={{ borderLeft: `3px solid ${eqColor}` }}>
                      {editCat === cat.id ? (
                        <td colSpan={6} className="p-3 space-y-3">
                          <div className="flex gap-2 flex-wrap items-end">
                            <div className="flex-1 min-w-[120px]">
                              <Label className="text-[10px]">Nome</Label>
                              <Input value={catForm.nome} onChange={(e) => setCatForm({ ...catForm, nome: e.target.value })} className={inputCls} />
                            </div>
                            <div className="w-[130px]">
                              <Label className="text-[10px]">Equipamento</Label>
                              <Select value={catForm.equipamentoId} onValueChange={(v) => setCatForm({ ...catForm, equipamentoId: v })}>
                                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {store.equipment.map((eq) => <SelectItem key={eq.id} value={eq.id}>{eq.nome}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="w-16">
                              <Label className="text-[10px]">Unidade</Label>
                              <Input value={catForm.unidade} onChange={(e) => setCatForm({ ...catForm, unidade: e.target.value })} className={inputCls} placeholder="kg" />
                            </div>
                          </div>
                          <div className="flex gap-2 flex-wrap items-end">
                            <div className="w-24">
                              <Label className="text-[10px]">T. Homem 1ª</Label>
                              <Input type="number" value={catForm.tempoCicloHomem1} onChange={(e) => setCatForm({ ...catForm, tempoCicloHomem1: e.target.value })} className={inputCls} />
                            </div>
                            <div className="w-24">
                              <Label className="text-[10px]">T. Homem Seg.</Label>
                              <Input type="number" value={catForm.tempoCicloHomem} onChange={(e) => setCatForm({ ...catForm, tempoCicloHomem: e.target.value })} className={inputCls} />
                            </div>
                            <div className="w-24">
                              <Label className="text-[10px]">T. Máq. 1ª</Label>
                              <Input type="number" value={catForm.tempoCicloMaquina1} onChange={(e) => setCatForm({ ...catForm, tempoCicloMaquina1: e.target.value })} className={inputCls} />
                            </div>
                            <div className="w-24">
                              <Label className="text-[10px]">T. Máq. Seg.</Label>
                              <Input type="number" value={catForm.tempoCicloMaquina} onChange={(e) => setCatForm({ ...catForm, tempoCicloMaquina: e.target.value })} className={inputCls} />
                            </div>
                          </div>

                          {/* Multi-equipment */}
                          <div className="space-y-2">
                            <Label className="text-xs font-medium">Equipamentos adicionais</Label>
                            {catForm.equipamentos.map((entry, idx) => (
                              <div key={idx} className="flex gap-2 items-center pl-4 border-l-2 border-secondary/30">
                                <Select value={entry.equipamentoId} onValueChange={(v) => updateExtraEquipment(idx, { equipamentoId: v })}>
                                  <SelectTrigger className="h-7 text-xs w-[120px]"><SelectValue placeholder="Equip." /></SelectTrigger>
                                  <SelectContent>
                                    {store.equipment.map((eq) => <SelectItem key={eq.id} value={eq.id}>{eq.nome}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                                <div className="w-20">
                                  <Input type="number" value={entry.tempoCicloMaquina} onChange={(e) => updateExtraEquipment(idx, { tempoCicloMaquina: Number(e.target.value) || 0 })} className={inputCls} placeholder="T.Máq" />
                                </div>
                                <div className="flex items-center gap-1">
                                  <Switch checked={entry.simultaneo} onCheckedChange={(v) => updateExtraEquipment(idx, { simultaneo: v })} />
                                  <Label className="text-[10px]">Simult.</Label>
                                </div>
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => removeExtraEquipment(idx)}>
                                  <Trash2 className="h-3 w-3 text-destructive" />
                                </Button>
                              </div>
                            ))}
                            <Button variant="outline" size="sm" className="h-6 text-xs" onClick={addExtraEquipment}>
                              <Plus className="h-3 w-3 mr-1" /> Adicionar Equipamento
                            </Button>
                          </div>

                          <div className="flex gap-2">
                            <Button size="sm" className="h-7 text-xs" onClick={() => handleSaveCat(cat.id)}><Save className="h-3 w-3 mr-1" /> Guardar</Button>
                            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setEditCat(null); resetCatForm(); }}><X className="h-3 w-3 mr-1" /> Cancelar</Button>
                          </div>
                        </td>
                      ) : (
                        <>
                          <td className={`${cellCls} font-medium`}>{cat.nome}</td>
                          <td className={cellCls}>
                            <div className="flex flex-wrap gap-1">
                              <Badge variant="outline" className="text-[10px] px-2 py-0 font-medium border"
                                style={{ borderColor: eqColor, color: eqColor, backgroundColor: eqColor + "15" }}>
                                {eqName}
                              </Badge>
                              {hasExtraEquip && cat.equipamentos!.map((extra, i) => {
                                const exEq = store.equipment.find(e => e.id === extra.equipamentoId);
                                const exColor = eqColorMap.get(extra.equipamentoId) || "hsl(var(--muted-foreground))";
                                return (
                                  <Badge key={i} variant="outline" className="text-[10px] px-2 py-0 font-medium border"
                                    style={{ borderColor: exColor, color: exColor, backgroundColor: exColor + "15" }}>
                                    {exEq?.nome || "?"} {extra.simultaneo ? "⚡" : "→"}
                                  </Badge>
                                );
                              })}
                            </div>
                          </td>
                          <td className={`${cellCls} text-right`}>
                            <div className="flex flex-col items-end gap-0.5">
                              <span className="text-[10px] text-muted-foreground">1ª: {cat.tempoCicloHomem1 ?? cat.tempoCicloHomem} min</span>
                              <span className="text-[10px]">seg: {cat.tempoCicloHomem} min</span>
                            </div>
                          </td>
                          <td className={`${cellCls} text-right`}>
                            <div className="flex flex-col items-end gap-0.5">
                              <span className="text-[10px] text-muted-foreground">1ª: {cat.tempoCicloMaquina1 ?? cat.tempoCicloMaquina} min</span>
                              <span className="text-[10px]">seg: {cat.tempoCicloMaquina} min</span>
                            </div>
                          </td>
                          <td className={cellCls}>
                            <Badge variant="secondary" className="text-[10px] px-2 py-0 font-normal">{cat.unidade || "-"}</Badge>
                          </td>
                          <td className={`${cellCls} text-right`}>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => {
                              setEditCat(cat.id);
                              setCatForm({
                                nome: cat.nome, equipamentoId: cat.equipamentoId,
                                tempoCicloHomem: String(cat.tempoCicloHomem), tempoCicloMaquina: String(cat.tempoCicloMaquina),
                                tempoCicloHomem1: String(cat.tempoCicloHomem1 ?? ""), tempoCicloMaquina1: String(cat.tempoCicloMaquina1 ?? ""),
                                unidade: cat.unidade || "",
                                equipamentos: cat.equipamentos ? [...cat.equipamentos] : [],
                                showFirstUnit: cat.tempoCicloHomem1 != null || cat.tempoCicloMaquina1 != null,
                              });
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

          {/* Add new category form */}
          {!editCat && (
            <div className="space-y-3 mt-4 pt-3 border-t">
              <div className="flex gap-2 flex-wrap">
                <Input placeholder="Nome da categoria" value={catForm.nome} onChange={(e) => setCatForm({ ...catForm, nome: e.target.value })} className="h-8 text-xs flex-1 min-w-[120px]" />
                <Select value={catForm.equipamentoId} onValueChange={(v) => setCatForm({ ...catForm, equipamentoId: v })}>
                  <SelectTrigger className="h-8 text-xs w-[130px]"><SelectValue placeholder="Equipamento" /></SelectTrigger>
                  <SelectContent>
                    {store.equipment.map((eq) => <SelectItem key={eq.id} value={eq.id}>{eq.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input placeholder="T. Homem" type="number" value={catForm.tempoCicloHomem} onChange={(e) => setCatForm({ ...catForm, tempoCicloHomem: e.target.value })} className="h-8 text-xs w-20" />
                <Input placeholder="T. Máquina" type="number" value={catForm.tempoCicloMaquina} onChange={(e) => setCatForm({ ...catForm, tempoCicloMaquina: e.target.value })} className="h-8 text-xs w-20" />
                <Input placeholder="Unid." value={catForm.unidade} onChange={(e) => setCatForm({ ...catForm, unidade: e.target.value })} className="h-8 text-xs w-16" />
                <Button onClick={handleAddCat} size="sm" className="h-8 text-xs"><Plus className="h-3 w-3 mr-1" /> Adicionar</Button>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={catForm.showFirstUnit} onCheckedChange={(v) => setCatForm({ ...catForm, showFirstUnit: v })} />
                <Label className="text-xs">Tempos 1ª unidade</Label>
              </div>
              {catForm.showFirstUnit && (
                <div className="flex gap-2 pl-4 border-l-2 border-primary/30">
                  <Input placeholder="T. Homem 1ª" type="number" value={catForm.tempoCicloHomem1} onChange={(e) => setCatForm({ ...catForm, tempoCicloHomem1: e.target.value })} className="h-8 text-xs w-24" />
                  <Input placeholder="T. Máq. 1ª" type="number" value={catForm.tempoCicloMaquina1} onChange={(e) => setCatForm({ ...catForm, tempoCicloMaquina1: e.target.value })} className="h-8 text-xs w-24" />
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
