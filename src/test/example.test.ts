import { describe, it, expect } from "vitest";
import { buildDailyGanttSchedule } from "@/components/gantt/scheduler";
import type { Category, Equipment, Operator, ProductionEntry } from "@/store/types";

describe("example", () => {
  it("should pass", () => {
    expect(true).toBe(true);
  });

  it("never schedules paired Massa on an odd number of machines", () => {
    const equipment: Equipment[] = [
      {
        id: "basc",
        nome: "Basculante",
        quantidade: 3,
        quantidadeEmergencia: 1,
        operatorsPerGroup: 1,
      },
    ];

    const categories: Category[] = [
      {
        id: "massa",
        nome: "Massa",
        equipamentoId: "basc",
        equipamentos: [
          {
            equipamentoId: "basc",
            tempoCicloMaquina: 20,
            simultaneo: true,
            isPaired: true,
            roleLabel: "Arrefecimento",
          },
        ],
        tempoCicloHomem: 5,
        tempoCicloMaquina: 20,
        unidade: "kg",
      },
    ];

    const production: ProductionEntry[] = [
      {
        id: "p1",
        date: "2026-04-16",
        artigo: "Massa Penne",
        quantidade: 3,
        unidade: "kg",
        categoriaId: "massa",
      },
    ];

    const operators: { operator: Operator; code: "D"; absent: boolean; hours: number }[] = [
      { operator: { id: "op1", nome: "Operador 1" }, code: "D", absent: false, hours: 8 },
      { operator: { id: "op2", nome: "Operador 2" }, code: "D", absent: false, hours: 8 },
    ];

    const schedule = buildDailyGanttSchedule({
      dateStr: "2026-04-16",
      production,
      categories,
      equipment,
      operatorsForDate: operators,
      tempOperators: [],
      sequencingRules: [],
      lunchSafeCategories: [],
    });

    const massaRowsPerStart = new Map<number, Set<string>>();
    schedule.machineRows.forEach((row) => {
      row.tasks
        .filter((task) => task.artigo === "Massa Penne")
        .forEach((task) => {
          const existing = massaRowsPerStart.get(task.start) ?? new Set<string>();
          existing.add(row.label);
          massaRowsPerStart.set(task.start, existing);
        });
    });

    const machineCounts = Array.from(massaRowsPerStart.values()).map((rows) => rows.size);
    expect(machineCounts.length).toBeGreaterThan(0);
    expect(machineCounts.every((count) => count % 2 === 0)).toBe(true);
    expect(machineCounts.every((count) => count === 2 || count === 4)).toBe(true);
  });
});
