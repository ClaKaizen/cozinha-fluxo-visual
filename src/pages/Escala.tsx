import { useState, useRef } from "react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths } from "date-fns";
import { pt } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus, Trash2, Upload } from "lucide-react";
import { useStore } from "@/store/useStore";
import { ShiftCode, WORKING_CODES } from "@/store/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import * as XLSX from "xlsx";

const ALL_CODES: ShiftCode[] = ['D', 'E', 'I', 'FG', 'F', 'B', 'RH', 'K', 'FD', 'NT', 'AN', 'C'];
const VALID_CODES = new Set<string>(ALL_CODES);

const MONTH_MAP: Record<string, number> = {
  janeiro: 0, fevereiro: 1, março: 2, abril: 3, maio: 4, junho: 5,
  julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
};

function normalizeCode(raw: string): ShiftCode | null {
  if (!raw) return null;
  const s = raw.toString().trim().toUpperCase();
  if (s === 'NT/AN') return 'NT';
  if (s === 'AN') return 'AN';
  if (VALID_CODES.has(s)) return s as ShiftCode;
  // Try common variants
  if (s === 'FT') return 'F'; // FALTA → treat as F
  if (s === 'L') return 'FG'; // LICENÇA → treat as FG
  return null;
}

export default function Escala() {
  const store = useStore();
  const [month, setMonth] = useState(new Date());
  const [newName, setNewName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });

  const getCode = (opId: string, dateStr: string): ShiftCode => {
    const entry = store.schedule.find((e) => e.operatorId === opId && e.date === dateStr);
    return entry?.code || 'FG';
  };

  const countPresent = (dateStr: string) => {
    return store.operators.filter((op) => {
      const code = getCode(op.id, dateStr);
      return WORKING_CODES.includes(code);
    }).length;
  };

  const codeColor = (code: ShiftCode) => {
    if (WORKING_CODES.includes(code)) return "bg-primary/15 text-primary font-semibold";
    if (code === 'F' || code === 'FG' || code === 'FD' || code === 'K') return "bg-muted text-muted-foreground";
    if (code === 'B') return "bg-destructive/10 text-destructive";
    return "bg-muted text-muted-foreground";
  };

  const handleImportExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows: (string | number | null)[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

        // Find month from row 6 (index 5), column B (index 1)
        let monthName = "";
        for (let r = 4; r < 8; r++) {
          const cell = rows[r]?.[1];
          if (cell && typeof cell === "string") {
            const lower = cell.trim().toLowerCase();
            if (MONTH_MAP[lower] !== undefined) {
              monthName = lower;
              break;
            }
          }
        }

        if (!monthName) {
          toast.error("Não foi possível encontrar o mês no ficheiro Excel");
          return;
        }

        const monthIndex = MONTH_MAP[monthName];
        const year = month.getFullYear(); // Use current context year

        // Find the day numbers row (row 8, index 7) - look for row with sequential numbers
        let dayRow = -1;
        let dayStartCol = -1;
        const dayColMap = new Map<number, number>(); // col index → day number

        for (let r = 6; r < 12; r++) {
          const row = rows[r];
          if (!row) continue;
          let foundDays = 0;
          for (let c = 5; c < row.length; c++) {
            const val = row[c];
            if (typeof val === "number" && val >= 1 && val <= 31) {
              foundDays++;
              if (foundDays === 1) dayStartCol = c;
            }
          }
          if (foundDays >= 20) {
            dayRow = r;
            for (let c = dayStartCol; c < row.length; c++) {
              const val = row[c];
              if (typeof val === "number" && val >= 1 && val <= 31) {
                dayColMap.set(c, val);
              }
            }
            break;
          }
        }

        if (dayRow === -1 || dayColMap.size === 0) {
          toast.error("Não foi possível encontrar os dias do mês no ficheiro");
          return;
        }

        // Parse operators starting after day-of-week row (dayRow + 2)
        const operatorStartRow = dayRow + 2;
        let importedCount = 0;
        const unknownCodes = new Set<string>();

        for (let r = operatorStartRow; r < rows.length; r++) {
          const row = rows[r];
          if (!row) continue;

          const numInterno = row[0];
          const name = row[3];

          // Check for "Período de Almoço"
          const rowText = row.join(" ").toLowerCase();
          if (rowText.includes("período de almoço") || rowText.includes("periodo de almoco")) {
            // Extract lunch time - not stored in current model, skip
            continue;
          }

          // Stop if both col A and col D are empty
          if ((numInterno === null || numInterno === undefined || numInterno === "") &&
              (name === null || name === undefined || name === "")) {
            continue;
          }

          const operatorName = name?.toString().trim();
          if (!operatorName) continue;

          // Find or create operator
          let operator = store.operators.find(
            (op) => op.nome.toLowerCase() === operatorName.toLowerCase()
          );
          if (!operator) {
            store.addOperator(operatorName);
            // Re-read to get the new operator with ID
            operator = useStore.getState().operators.find(
              (op) => op.nome.toLowerCase() === operatorName.toLowerCase()
            );
          }
          if (!operator) continue;

          // Parse schedule codes for each day
          dayColMap.forEach((dayNum, colIdx) => {
            const cellVal = row[colIdx];
            if (cellVal === null || cellVal === undefined || cellVal === "") return;

            const rawCode = cellVal.toString().trim();
            if (!rawCode) return;

            const code = normalizeCode(rawCode);
            if (code) {
              const dateStr = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
              store.setSchedule(operator!.id, dateStr, code);
            } else {
              unknownCodes.add(rawCode);
            }
          });

          importedCount++;
        }

        // Navigate to the imported month
        setMonth(new Date(year, monthIndex, 1));

        const monthCapitalized = monthName.charAt(0).toUpperCase() + monthName.slice(1);
        toast.success(`Escala importada com sucesso — ${importedCount} operadores, mês de ${monthCapitalized}`);

        if (unknownCodes.size > 0) {
          toast.warning(`Códigos não reconhecidos: ${[...unknownCodes].join(", ")}`);
        }
      } catch (err) {
        console.error("Import error:", err);
        toast.error("Erro ao importar ficheiro Excel");
      }
    };
    reader.readAsArrayBuffer(file);

    // Reset input so same file can be re-imported
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold">Escala</h1>
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

      {/* Add operator + Import */}
      <div className="flex gap-2 max-w-lg">
        <Input placeholder="Nome do operador" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <Button onClick={() => { if (newName.trim()) { store.addOperator(newName.trim()); setNewName(""); } }}>
          <Plus className="h-4 w-4 mr-1" /> Adicionar
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={handleImportExcel}
        />
        <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
          <Upload className="h-4 w-4 mr-1" /> Importar Excel
        </Button>
      </div>

      {/* Schedule grid */}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="text-xs w-full">
          <thead>
            <tr className="border-b">
              <th className="sticky left-0 bg-card z-10 px-3 py-2 text-left font-semibold min-w-[140px]">Operador</th>
              {days.map((day) => (
                <th key={day.toISOString()} className="px-1 py-2 text-center min-w-[44px]">
                  <div>{format(day, "EEE", { locale: pt })}</div>
                  <div className="font-bold">{format(day, "d")}</div>
                </th>
              ))}
              <th className="px-2 py-2 text-center min-w-[40px]">
                <Trash2 className="h-3.5 w-3.5 mx-auto text-muted-foreground" />
              </th>
            </tr>
          </thead>
          <tbody>
            {store.operators.map((op) => (
              <tr key={op.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="sticky left-0 bg-card z-10 px-3 py-1.5 font-medium">{op.nome}</td>
                {days.map((day) => {
                  const dateStr = format(day, "yyyy-MM-dd");
                  const code = getCode(op.id, dateStr);
                  return (
                    <td key={dateStr} className="px-0.5 py-1">
                      <Select value={code} onValueChange={(v) => store.setSchedule(op.id, dateStr, v as ShiftCode)}>
                        <SelectTrigger className={`h-7 w-10 text-[10px] px-1 border-0 justify-center ${codeColor(code)}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ALL_CODES.map((c) => (
                            <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  );
                })}
                <td className="px-1 py-1 text-center">
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => store.deleteOperator(op.id)}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </td>
              </tr>
            ))}
            {/* Present count row */}
            <tr className="border-t-2 border-primary/20 bg-accent/50">
              <td className="sticky left-0 bg-accent/50 z-10 px-3 py-2 font-semibold text-primary">Presentes</td>
              {days.map((day) => {
                const dateStr = format(day, "yyyy-MM-dd");
                return (
                  <td key={dateStr} className="px-1 py-2 text-center font-bold text-primary">
                    {countPresent(dateStr)}
                  </td>
                );
              })}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
