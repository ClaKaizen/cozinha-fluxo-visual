export interface Equipment {
  id: string;
  nome: string;
  quantidade: number;
  quantidadeEmergencia: number;
  multiOperador: boolean;
}

export interface CategoryEquipmentEntry {
  equipamentoId: string;
  tempoCicloMaquina: number;
  tempoCicloMaquina1?: number;
  simultaneo: boolean;
  isFirst?: boolean;
  isDedicated?: boolean;
  isPaired?: boolean;
  roleLabel?: string;
}

export interface Category {
  id: string;
  nome: string;
  equipamentoId: string;
  equipamentos?: CategoryEquipmentEntry[];
  tempoCicloHomem: number;
  tempoCicloHomem1?: number; // first unit
  tempoCicloMaquina: number;
  tempoCicloMaquina1?: number; // first unit
  unidade: string;
}

export interface ProductionEntry {
  id: string;
  date: string; // YYYY-MM-DD
  artigo: string;
  quantidade: number;
  unidade: string;
  categoriaId: string;
}

export type ShiftCode = 'D' | 'E' | 'I' | 'FG' | 'F' | 'B' | 'RH' | 'K' | 'FD' | 'NT' | 'AN' | 'C';

export const SHIFT_HOURS: Record<ShiftCode, number> = {
  D: 8, E: 4, I: 8, FG: 0, F: 0, B: 0, RH: 0, K: 0, FD: 0, NT: 0, AN: 0, C: 8,
};

export const WORKING_CODES: ShiftCode[] = ['D', 'E', 'I', 'C'];

export interface Operator {
  id: string;
  nome: string;
}

export interface ScheduleEntry {
  operatorId: string;
  date: string;
  code: ShiftCode;
}

export interface DayAbsence {
  operatorId: string;
  date: string;
}

export interface TempOperator {
  id: string;
  date: string;
  nome: string;
  hours: number;
}

export interface SequencingRule {
  id: string;
  categoryA: string;   // category ID
  relation: 'Antes' | 'Depois';
  categoryB: string;   // category ID
}

export const BREAK_COEFFICIENT = 0.0625;
export const INEFFICIENCY_FACTOR = 1.20;
export const EFFECTIVE_HOURS = 8; // Direct 8h per operator
export const AVAILABLE_MINUTES = 480; // 07:10-16:00 (530 min) minus 60 min lunch = 470 (machine window unchanged)
