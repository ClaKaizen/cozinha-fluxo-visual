import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  Equipment, Category, ProductionEntry, Operator, ScheduleEntry,
  DayAbsence, TempOperator, ShiftCode, SHIFT_HOURS, WORKING_CODES, BREAK_COEFFICIENT, INEFFICIENCY_FACTOR
} from './types';

interface AppState {
  equipment: Equipment[];
  categories: Category[];
  production: ProductionEntry[];
  operators: Operator[];
  schedule: ScheduleEntry[];
  absences: DayAbsence[];
  tempOperators: TempOperator[];

  addEquipment: (e: Omit<Equipment, 'id'>) => void;
  updateEquipment: (id: string, e: Partial<Equipment>) => void;
  deleteEquipment: (id: string) => void;

  addCategory: (c: Omit<Category, 'id'>) => void;
  updateCategory: (id: string, c: Partial<Category>) => void;
  deleteCategory: (id: string) => void;

  addProduction: (p: Omit<ProductionEntry, 'id'>) => void;
  updateProduction: (id: string, p: Partial<ProductionEntry>) => void;
  deleteProduction: (id: string) => void;

  addOperator: (name: string) => void;
  deleteOperator: (id: string) => void;

  setSchedule: (operatorId: string, date: string, code: ShiftCode) => void;

  addAbsence: (operatorId: string, date: string) => void;
  removeAbsence: (operatorId: string, date: string) => void;
  addTempOperator: (t: Omit<TempOperator, 'id'>) => void;
  removeTempOperator: (id: string) => void;

  getProductionForDate: (date: string) => ProductionEntry[];
  getOperatorsForDate: (date: string) => { operator: Operator; code: ShiftCode; absent: boolean; hours: number }[];
  getDayStats: (date: string) => {
    cargaDoDia: number;
    pessoasPresentes: number;
    capacidadeDoDia: number;
    taxaOcupacao: { equipmentName: string; rate: number; usesEmergency: boolean }[];
    taxaOcupacaoGlobal: number;
  };
  getArtigoCategory: (artigo: string) => string | undefined;
}

const uid = () => crypto.randomUUID();

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      equipment: [
        { id: 'eq1', nome: 'Basculante', quantidade: 4, quantidadeEmergencia: 0 },
        { id: 'eq2', nome: 'Forno', quantidade: 3, quantidadeEmergencia: 0 },
        { id: 'eq3', nome: 'Panela', quantidade: 2, quantidadeEmergencia: 0 },
      ],
      categories: [
        { id: 'cat1', nome: 'Molho Base Bechamel', equipamentoId: 'eq3', tempoCicloHomem: 15, tempoCicloMaquina: 45, unidade: 'kg' },
        { id: 'cat2', nome: 'Arroz Branco', equipamentoId: 'eq1', tempoCicloHomem: 10, tempoCicloMaquina: 30, unidade: 'kg' },
        { id: 'cat3', nome: 'Frango Assado', equipamentoId: 'eq2', tempoCicloHomem: 20, tempoCicloMaquina: 60, unidade: 'unid' },
      ],
      production: [],
      operators: [],
      schedule: [],
      absences: [],
      tempOperators: [],

      addEquipment: (e) => set((s) => ({ equipment: [...s.equipment, { ...e, id: uid() }] })),
      updateEquipment: (id, e) => set((s) => ({ equipment: s.equipment.map((eq) => eq.id === id ? { ...eq, ...e } : eq) })),
      deleteEquipment: (id) => set((s) => ({ equipment: s.equipment.filter((eq) => eq.id !== id) })),

      addCategory: (c) => set((s) => ({ categories: [...s.categories, { ...c, id: uid() }] })),
      updateCategory: (id, c) => set((s) => ({ categories: s.categories.map((cat) => cat.id === id ? { ...cat, ...c } : cat) })),
      deleteCategory: (id) => set((s) => ({ categories: s.categories.filter((cat) => cat.id !== id) })),

      addProduction: (p) => set((s) => ({ production: [...s.production, { ...p, id: uid() }] })),
      updateProduction: (id, p) => set((s) => ({ production: s.production.map((pr) => pr.id === id ? { ...pr, ...p } : pr) })),
      deleteProduction: (id) => set((s) => ({ production: s.production.filter((pr) => pr.id !== id) })),

      addOperator: (name) => set((s) => ({ operators: [...s.operators, { id: uid(), nome: name }] })),
      deleteOperator: (id) => set((s) => ({
        operators: s.operators.filter((o) => o.id !== id),
        schedule: s.schedule.filter((e) => e.operatorId !== id),
      })),

      setSchedule: (operatorId, date, code) => set((s) => {
        const existing = s.schedule.findIndex((e) => e.operatorId === operatorId && e.date === date);
        if (existing >= 0) {
          const newSchedule = [...s.schedule];
          newSchedule[existing] = { operatorId, date, code };
          return { schedule: newSchedule };
        }
        return { schedule: [...s.schedule, { operatorId, date, code }] };
      }),

      addAbsence: (operatorId, date) => set((s) => ({
        absences: [...s.absences.filter((a) => !(a.operatorId === operatorId && a.date === date)), { operatorId, date }]
      })),
      removeAbsence: (operatorId, date) => set((s) => ({
        absences: s.absences.filter((a) => !(a.operatorId === operatorId && a.date === date))
      })),
      addTempOperator: (t) => set((s) => ({ tempOperators: [...s.tempOperators, { ...t, id: uid() }] })),
      removeTempOperator: (id) => set((s) => ({ tempOperators: s.tempOperators.filter((t) => t.id !== id) })),

      getProductionForDate: (date) => get().production.filter((p) => p.date === date),

      getOperatorsForDate: (date) => {
        const { operators, schedule, absences } = get();
        return operators.map((op) => {
          const entry = schedule.find((e) => e.operatorId === op.id && e.date === date);
          const code = entry?.code || 'FG';
          const absent = absences.some((a) => a.operatorId === op.id && a.date === date);
          const hours = (absent || !WORKING_CODES.includes(code)) ? 0 : SHIFT_HOURS[code];
          return { operator: op, code, absent, hours };
        });
      },

      getDayStats: (date) => {
        const state = get();
        const prod = state.production.filter((p) => p.date === date);
        const ops = state.getOperatorsForDate(date);
        const temps = state.tempOperators.filter((t) => t.date === date);

        // Carga: T. Homem only with 20% inefficiency
        let cargaMinutes = 0;
        prod.forEach((p) => {
          const cat = state.categories.find((c) => c.id === p.categoriaId);
          if (cat) {
            const tHomem1 = cat.tempoCicloHomem1 ?? cat.tempoCicloHomem;
            cargaMinutes += tHomem1 + (p.quantidade > 1 ? (p.quantidade - 1) * cat.tempoCicloHomem : 0);
          }
        });
        const cargaDoDia = (cargaMinutes / 60) * INEFFICIENCY_FACTOR;

        const presentOps = ops.filter((o) => o.hours > 0);
        const pessoasPresentes = presentOps.length + temps.length;
        const capacidadeDoDia = pessoasPresentes * 8;

        // Taxa ocupação por equipamento — use only normal quantity
        const equipMap = new Map<string, { totalMinutes: number }>();
        prod.forEach((p) => {
          const cat = state.categories.find((c) => c.id === p.categoriaId);
          if (cat) {
            const tHomem1 = cat.tempoCicloHomem1 ?? cat.tempoCicloHomem;
            const tMaq1 = cat.tempoCicloMaquina1 ?? cat.tempoCicloMaquina;
            const totalHomem = tHomem1 + (p.quantidade > 1 ? (p.quantidade - 1) * cat.tempoCicloHomem : 0);
            const totalMaq = tMaq1 + (p.quantidade > 1 ? (p.quantidade - 1) * cat.tempoCicloMaquina : 0);
            
            const existing = equipMap.get(cat.equipamentoId) || { totalMinutes: 0 };
            existing.totalMinutes += totalHomem + totalMaq;
            equipMap.set(cat.equipamentoId, existing);

            if (cat.equipamentos) {
              cat.equipamentos.forEach((extra) => {
                if (extra.simultaneo) {
                  const extraMaq1 = extra.tempoCicloMaquina1 ?? extra.tempoCicloMaquina;
                  const extraTotalMaq = extraMaq1 + (p.quantidade > 1 ? (p.quantidade - 1) * extra.tempoCicloMaquina : 0);
                  const ex = equipMap.get(extra.equipamentoId) || { totalMinutes: 0 };
                  ex.totalMinutes += extraTotalMaq;
                  equipMap.set(extra.equipamentoId, ex);
                }
              });
            }
          }
        });

        const taxaOcupacao = state.equipment
          .map((eq) => {
            const data = equipMap.get(eq.id);
            const totalMinutes = data?.totalMinutes || 0;
            const totalMachines = eq.quantidade + (eq.quantidadeEmergencia || 0);
            const availableMinutes = totalMachines * 480;
            const normalAvailable = eq.quantidade * 480;
            const usesEmergency = totalMinutes > normalAvailable && (eq.quantidadeEmergencia || 0) > 0;
            const rate = availableMinutes > 0 ? (totalMinutes / availableMinutes) * 100 : 0;
            return { equipmentName: eq.nome, rate, usesEmergency };
          });

        const taxaOcupacaoGlobal = capacidadeDoDia > 0 ? (cargaDoDia / capacidadeDoDia) * 100 : 0;

        return { cargaDoDia, pessoasPresentes, capacidadeDoDia, taxaOcupacao, taxaOcupacaoGlobal };
      },

      getArtigoCategory: (artigo) => {
        const { production } = get();
        const match = [...production].reverse().find((p) => p.artigo.toLowerCase() === artigo.toLowerCase());
        return match?.categoriaId;
      },
    }),
    { name: 'cla-catering-store' }
  )
);
