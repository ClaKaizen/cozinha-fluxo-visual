import { useState, useMemo } from "react";
import { Plus, Trash2, Edit2, Save, X, Wrench, Tag, User, Cog, AlertTriangle, ListOrdered, UtensilsCrossed, Lock, Link } from "lucide-react";
import { useStore } from "@/store/useStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { CategoryEquipmentEntry, SequencingRule } from "@/store/types";

const EQUIPMENT_COLORS = [
  "hsl(45, 90%, 60%)", "hsl(210, 60%, 55%)", "hsl(340, 60%, 55%)",
  "hsl(160, 50%, 45%)", "hsl(30, 70%, 55%)", "hsl(270, 50%, 55%)",
];

export default function Configuracoes() {
  const store = useStore();

  const [eqForm, setEqForm] = useState({ nome: "", quantidade: "", quantidadeEmergencia: "", multiOperador: true });
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

  const handleAddEq = () => {
    if (eqForm.nome.trim()) {
      store.addEquipment({
        nome: eqForm.nome.trim(),
        quantidade: Number(eqForm.quantidade) || 1,
        quantidadeEmergencia: Number(eqForm.quantidadeEmergencia) || 0,
        multiOperador: eqForm.multiOperador,
      });
      setEqForm({ nome: "", quantidade: "", quantidadeEmergencia: "", multiOperador: true });
    }
  };

  const handleSaveEq = (id: string) => {
    store.updateEquipment(id, {
      nome: eqForm.nome,
      quantidade: Number(eqForm.quantidade) || 1,
      quantidadeEmergencia: Number(eqForm.quantidadeEmergencia) || 0,
      multiOperador: eqForm.multiOperador,
    });
    setEditEq(null);
    setEqForm({ nome: "", quantidade: "", quantidadeEmergencia: "", multiOperador: true });
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
      equipamentos: [...f.equipamentos, { equipamentoId: "", tempoCicloMaquina: 0, tempoCicloMaquina1: undefined, simultaneo: false, isFirst: false, isDedicated: false, isPaired: false, roleLabel: "" }],
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
                <th className={`text-right font-medium ${cellCls}`}>Qtd. Normal</th>
                <th className={`text-right font-medium ${cellCls}`}>Qtd. Emergência</th>
                <th className={`text-center font-medium ${cellCls}`} title="Se este tipo de equipamento permite operadores independentes em simultâneo em máquinas diferentes">Vários Op. Simult.?</th>
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
                      <td className={cellCls}><Input type="number" value={eqForm.quantidadeEmergencia} onChange={(e) => setEqForm({ ...eqForm, quantidadeEmergencia: e.target.value })} className={`${inputCls} w-16 ml-auto`} /></td>
                      <td className={`${cellCls} text-center`}><Switch checked={eqForm.multiOperador} onCheckedChange={(v) => setEqForm({ ...eqForm, multiOperador: v })} /></td>
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
                        {(eq.quantidadeEmergencia ?? 0) > 0 ? (
                          <Badge variant="outline" className="text-[10px] text-warning border-warning/40 bg-warning/10">
                            {eq.quantidadeEmergencia} emerg.
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                      <td className={`${cellCls} text-center`}>
                        <Badge variant={eq.multiOperador !== false ? "default" : "outline"} className="text-[10px] cursor-default">
                          {eq.multiOperador !== false ? "Sim" : "Não"}
                        </Badge>
                      </td>
                      <td className={`${cellCls} text-right`}>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => {
                          setEditEq(eq.id);
                          setEqForm({ nome: eq.nome, quantidade: String(eq.quantidade), quantidadeEmergencia: String(eq.quantidadeEmergencia ?? 0), multiOperador: eq.multiOperador !== false });
                        }}>
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
          <div className="flex gap-2 mt-3 items-center">
            <Input placeholder="Nome do equipamento" value={editEq ? "" : eqForm.nome} onChange={(e) => !editEq && setEqForm({ ...eqForm, nome: e.target.value })} className="h-8 text-xs" disabled={!!editEq} />
            <Input placeholder="Qtd. Normal" type="number" value={editEq ? "" : eqForm.quantidade} onChange={(e) => !editEq && setEqForm({ ...eqForm, quantidade: e.target.value })} className="h-8 text-xs w-24" disabled={!!editEq} />
            <Input placeholder="Qtd. Emerg." type="number" value={editEq ? "" : eqForm.quantidadeEmergencia} onChange={(e) => !editEq && setEqForm({ ...eqForm, quantidadeEmergencia: e.target.value })} className="h-8 text-xs w-24" disabled={!!editEq} />
            <div className="flex items-center gap-2">
              <Switch checked={editEq ? false : eqForm.multiOperador} onCheckedChange={(v) => !editEq && setEqForm({ ...eqForm, multiOperador: v })} disabled={!!editEq} />
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Vários Op.</Label>
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
                              <div key={idx} className="flex gap-2 items-center pl-4 border-l-2 border-secondary/30 flex-wrap">
                                <Select value={entry.equipamentoId} onValueChange={(v) => updateExtraEquipment(idx, { equipamentoId: v })}>
                                  <SelectTrigger className="h-7 text-xs w-[120px]"><SelectValue placeholder="Equip." /></SelectTrigger>
                                  <SelectContent>
                                    {store.equipment.map((eq) => <SelectItem key={eq.id} value={eq.id}>{eq.nome}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                                <div className="w-20">
                                  <Label className="text-[10px]">T.Máq 1ª</Label>
                                  <Input type="number" value={entry.tempoCicloMaquina1 ?? ""} onChange={(e) => updateExtraEquipment(idx, { tempoCicloMaquina1: e.target.value ? Number(e.target.value) : undefined })} className={inputCls} placeholder="min" />
                                </div>
                                <div className="w-20">
                                  <Label className="text-[10px]">T.Máq Seg.</Label>
                                  <Input type="number" value={entry.tempoCicloMaquina} onChange={(e) => updateExtraEquipment(idx, { tempoCicloMaquina: Number(e.target.value) || 0 })} className={inputCls} placeholder="min" />
                                </div>
                                <div className="w-28">
                                  <Label className="text-[10px]">Função</Label>
                                  <Input value={entry.roleLabel ?? ""} onChange={(e) => updateExtraEquipment(idx, { roleLabel: e.target.value })} className={inputCls} placeholder="ex: Arrefecimento" />
                                </div>
                                <div className="flex items-center gap-1">
                                  <Switch checked={entry.isFirst ?? false} onCheckedChange={(v) => updateExtraEquipment(idx, { isFirst: v, simultaneo: v ? false : entry.simultaneo })} />
                                  <Label className="text-[10px]">1º</Label>
                                </div>
                                <div className="flex items-center gap-1">
                                  <Switch checked={entry.simultaneo} onCheckedChange={(v) => updateExtraEquipment(idx, { simultaneo: v, isFirst: v ? false : (entry.isFirst ?? false) })} />
                                  <Label className="text-[10px]">Simult.</Label>
                                </div>
                                <div className="flex items-center gap-1">
                                  <Switch checked={entry.isDedicated ?? false} onCheckedChange={(v) => updateExtraEquipment(idx, { isDedicated: v })} />
                                  <Label className="text-[10px] flex items-center gap-0.5"><Lock className="h-2.5 w-2.5" />Dedicado</Label>
                                </div>
                                <div className="flex items-center gap-1">
                                  <Switch checked={entry.isPaired ?? false} onCheckedChange={(v) => updateExtraEquipment(idx, { isPaired: v, simultaneo: v ? true : entry.simultaneo })} />
                                  <Label className="text-[10px] flex items-center gap-0.5"><Link className="h-2.5 w-2.5" />Par</Label>
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
                                    {exEq?.nome || "?"} {extra.isPaired ? "🔗" : extra.isFirst ? "1→" : extra.simultaneo ? "⚡" : "→"}{extra.roleLabel ? ` (${extra.roleLabel})` : ''}
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
                                tempoCicloHomem1: String(cat.tempoCicloHomem1 ?? cat.tempoCicloHomem), tempoCicloMaquina1: String(cat.tempoCicloMaquina1 ?? cat.tempoCicloMaquina),
                                unidade: cat.unidade || "",
                                equipamentos: cat.equipamentos ? [...cat.equipamentos] : [],
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
              <div className="flex gap-2 flex-wrap items-end">
                <Input placeholder="Nome da categoria" value={catForm.nome} onChange={(e) => setCatForm({ ...catForm, nome: e.target.value })} className="h-8 text-xs flex-1 min-w-[120px]" />
                <Select value={catForm.equipamentoId} onValueChange={(v) => setCatForm({ ...catForm, equipamentoId: v })}>
                  <SelectTrigger className="h-8 text-xs w-[130px]"><SelectValue placeholder="Equipamento" /></SelectTrigger>
                  <SelectContent>
                    {store.equipment.map((eq) => <SelectItem key={eq.id} value={eq.id}>{eq.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input placeholder="Unid." value={catForm.unidade} onChange={(e) => setCatForm({ ...catForm, unidade: e.target.value })} className="h-8 text-xs w-16" />
              </div>
              <div className="flex gap-2 flex-wrap items-end">
                <div className="w-24">
                  <Label className="text-[10px]">T. Homem 1ª</Label>
                  <Input placeholder="min" type="number" value={catForm.tempoCicloHomem1} onChange={(e) => setCatForm({ ...catForm, tempoCicloHomem1: e.target.value })} className="h-8 text-xs" />
                </div>
                <div className="w-24">
                  <Label className="text-[10px]">T. Homem Seg.</Label>
                  <Input placeholder="min" type="number" value={catForm.tempoCicloHomem} onChange={(e) => setCatForm({ ...catForm, tempoCicloHomem: e.target.value })} className="h-8 text-xs" />
                </div>
                <div className="w-24">
                  <Label className="text-[10px]">T. Máq. 1ª</Label>
                  <Input placeholder="min" type="number" value={catForm.tempoCicloMaquina1} onChange={(e) => setCatForm({ ...catForm, tempoCicloMaquina1: e.target.value })} className="h-8 text-xs" />
                </div>
                <div className="w-24">
                  <Label className="text-[10px]">T. Máq. Seg.</Label>
                  <Input placeholder="min" type="number" value={catForm.tempoCicloMaquina} onChange={(e) => setCatForm({ ...catForm, tempoCicloMaquina: e.target.value })} className="h-8 text-xs" />
                </div>
                <Button onClick={handleAddCat} size="sm" className="h-8 text-xs"><Plus className="h-3 w-3 mr-1" /> Adicionar</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sequenciamento */}
      <SequenciamentoSection />

      {/* Hora de Almoço */}
      <HoraAlmocoSection />
    </div>
  );
}

/* ── Sequenciamento Section ─────────────────────────────── */

function SequenciamentoSection() {
  const store = useStore();
  const categories = store.categories;
  const rules = store.sequencingRules;

  const [form, setForm] = useState<{ categoryA: string; relation: 'Antes' | 'Depois'; categoryB: string }>({
    categoryA: '', relation: 'Depois', categoryB: '',
  });
  const [editId, setEditId] = useState<string | null>(null);

  const catName = (id: string) => categories.find(c => c.id === id)?.nome ?? '?';

  // Circular dependency detection
  const circularWarnings = useMemo(() => {
    const warnings: string[] = [];
    // Build adjacency: A must be after B → edge B→A
    const adj = new Map<string, Set<string>>();
    for (const r of rules) {
      if (r.relation === 'Depois') {
        // A after B → B must come first
        if (!adj.has(r.categoryB)) adj.set(r.categoryB, new Set());
        adj.get(r.categoryB)!.add(r.categoryA);
      } else {
        // A before B → A must come first
        if (!adj.has(r.categoryA)) adj.set(r.categoryA, new Set());
        adj.get(r.categoryA)!.add(r.categoryB);
      }
    }
    // Detect cycles via DFS
    const visited = new Set<string>();
    const stack = new Set<string>();
    function dfs(node: string, path: string[]): boolean {
      if (stack.has(node)) {
        const cycleStart = path.indexOf(node);
        const cycle = path.slice(cycleStart).map(id => catName(id));
        warnings.push(`Regra circular detectada: ${cycle.join(' → ')} → ${catName(node)}`);
        return true;
      }
      if (visited.has(node)) return false;
      visited.add(node);
      stack.add(node);
      for (const next of adj.get(node) ?? []) {
        if (dfs(next, [...path, node])) return true;
      }
      stack.delete(node);
      return false;
    }
    for (const node of adj.keys()) {
      if (!visited.has(node)) dfs(node, []);
    }
    return warnings;
  }, [rules, categories]);

  const handleAdd = () => {
    if (!form.categoryA || !form.categoryB || form.categoryA === form.categoryB) return;
    // Check duplicate
    const dup = rules.some(r =>
      r.categoryA === form.categoryA && r.relation === form.relation && r.categoryB === form.categoryB
    );
    if (dup) return;

    if (editId) {
      store.updateSequencingRule(editId, form);
      setEditId(null);
    } else {
      store.addSequencingRule(form);
    }
    setForm({ categoryA: '', relation: 'Depois', categoryB: '' });
  };

  const cellCls = "px-2 py-1";

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 rounded-t-lg" style={{ backgroundColor: "hsl(215, 25%, 34%)" }}>
        <ListOrdered className="h-4 w-4 text-white" />
        <span className="text-white font-display font-semibold text-base">Sequenciamento</span>
      </div>
      <CardContent className="pt-4">
        <p className="text-xs text-muted-foreground mb-3">
          Ex: Molho carne → Depois → Novilho significa que o Molho carne é sempre planeado após o Novilho.
        </p>

        {circularWarnings.length > 0 && (
          <div className="mb-3 p-2 rounded border border-destructive/40 bg-destructive/10">
            {circularWarnings.map((w, i) => (
              <div key={i} className="flex items-center gap-1 text-xs text-destructive">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className={`text-left font-medium ${cellCls}`}>Esta categoria...</th>
              <th className={`text-center font-medium ${cellCls}`}>deve ser feita</th>
              <th className={`text-left font-medium ${cellCls}`}>em relação a...</th>
              <th className={`${cellCls} w-[80px]`}></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id} className="border-b last:border-b-0 hover:bg-muted/30">
                <td className={`${cellCls} font-medium`}>{catName(rule.categoryA)}</td>
                <td className={`${cellCls} text-center`}>
                  <Badge variant="outline" className="text-[10px]">{rule.relation}</Badge>
                </td>
                <td className={`${cellCls} font-medium`}>{catName(rule.categoryB)}</td>
                <td className={`${cellCls} text-right`}>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => {
                    setEditId(rule.id);
                    setForm({ categoryA: rule.categoryA, relation: rule.relation, categoryB: rule.categoryB });
                  }}>
                    <Edit2 className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0 ml-1" onClick={() => store.deleteSequencingRule(rule.id)}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex gap-2 mt-3 items-center flex-wrap">
          <Select value={form.categoryA} onValueChange={(v) => setForm({ ...form, categoryA: v })}>
            <SelectTrigger className="h-8 text-xs w-[160px]"><SelectValue placeholder="Categoria..." /></SelectTrigger>
            <SelectContent>
              {categories.filter(c => c.id !== form.categoryB).map(c => (
                <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={form.relation} onValueChange={(v) => setForm({ ...form, relation: v as 'Antes' | 'Depois' })}>
            <SelectTrigger className="h-8 text-xs w-[100px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Antes">Antes</SelectItem>
              <SelectItem value="Depois">Depois</SelectItem>
            </SelectContent>
          </Select>
          <Select value={form.categoryB} onValueChange={(v) => setForm({ ...form, categoryB: v })}>
            <SelectTrigger className="h-8 text-xs w-[160px]"><SelectValue placeholder="Categoria..." /></SelectTrigger>
            <SelectContent>
              {categories.filter(c => c.id !== form.categoryA).map(c => (
                <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleAdd} size="sm" className="h-8 text-xs" style={{ backgroundColor: '#FFD966', color: '#44546A' }}>
            <Plus className="h-3 w-3 mr-1" /> {editId ? 'Guardar' : 'Adicionar Regra'}
          </Button>
          {editId && (
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { setEditId(null); setForm({ categoryA: '', relation: 'Depois', categoryB: '' }); }}>
              <X className="h-3 w-3 mr-1" /> Cancelar
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Hora de Almoço Section ──────────────────────────────── */

function HoraAlmocoSection() {
  const store = useStore();
  const categories = store.categories;
  const lunchSafe = store.lunchSafeCategories;

  const [selectedCat, setSelectedCat] = useState('');

  const availableCategories = categories.filter(c => !lunchSafe.includes(c.id));

  const handleAdd = () => {
    if (!selectedCat) return;
    store.addLunchSafeCategory(selectedCat);
    setSelectedCat('');
  };

  const catName = (id: string) => categories.find(c => c.id === id)?.nome ?? '?';

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 rounded-t-lg" style={{ backgroundColor: "hsl(215, 25%, 34%)" }}>
        <UtensilsCrossed className="h-4 w-4 text-white" />
        <span className="text-white font-display font-semibold text-base">Hora de Almoço</span>
      </div>
      <CardContent className="pt-4">
        <p className="text-xs text-muted-foreground mb-3">
          Categorias aqui listadas podem ter os seus equipamentos a funcionar autonomamente durante a hora de almoço. As restantes obrigam à presença de um operador.
        </p>

        {lunchSafe.length > 0 ? (
          <div className="space-y-1 mb-3">
            {lunchSafe.map((catId) => (
              <div key={catId} className="flex items-center justify-between px-3 py-1.5 rounded border bg-muted/20 hover:bg-muted/40">
                <span className="text-sm font-medium">• {catName(catId)}</span>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => store.removeLunchSafeCategory(catId)}>
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic mb-3">Nenhuma categoria configurada — todos os equipamentos param durante o almoço.</p>
        )}

        <div className="flex gap-2 items-center">
          <Select value={selectedCat} onValueChange={setSelectedCat}>
            <SelectTrigger className="h-8 text-xs w-[200px]"><SelectValue placeholder="Categoria..." /></SelectTrigger>
            <SelectContent>
              {availableCategories.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleAdd} size="sm" className="h-8 text-xs" style={{ backgroundColor: '#FFD966', color: '#44546A' }} disabled={!selectedCat}>
            <Plus className="h-3 w-3 mr-1" /> Adicionar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
