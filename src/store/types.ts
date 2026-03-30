export interface Equipment {
  id: string;
  nome: string;
  quantidade: number;
}

export interface Category {
  id: string;
  nome: string;
  equipamentoId: string;
  tempoCicloHomem: number; // minutes
  tempoCicloMaquina: number; // minutes
}

export interface ProductionEntry {
  id: string;
  date: string; // YYYY-MM-DD
  artigo: string;
  quantidade: number;
  categoriaId: string;
}

export type ShiftCode = 'D' | 'E' | 'I' | 'FG' | 'F' | 'B' | 'RH' | 'K' | 'FD' | 'NT' | 'AN' | 'C';

export const SHIFT_HOURS: Record<ShiftCode, number> = {
  D: 9, // 07-16
  E: 4, // 07-11
  I: 9, // 08-17
  FG: 0,
  F: 0,
  B: 0,
  RH: 0,
  K: 0,
  FD: 0,
  NT: 0,
  AN: 0,
  C: 0, // support, not counted as kitchen
};

export const WORKING_CODES: ShiftCode[] = ['D', 'E', 'I'];

export interface Operator {
  id: string;
  nome: string;
}

export interface ScheduleEntry {
  operatorId: string;
  date: string; // YYYY-MM-DD
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

export const BREAK_COEFFICIENT = 0.0625; // 6.25%
