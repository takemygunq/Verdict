import { describe, expect, it } from "vitest";
import { CalcError, checkCalculations, evaluate, formatCalculation } from "@/lib/trial/calc";

describe("калькулятор участников", () => {
  it("считает арифметику с приоритетами, скобками и степенью", () => {
    expect(evaluate("2+3*4")).toBe(14);
    expect(evaluate("(2+3)*4")).toBe(20);
    expect(evaluate("-2^2")).toBe(-4);
    expect(evaluate("2^3^2")).toBe(512);
    expect(evaluate("2^-1")).toBe(0.5);
    expect(evaluate("420000/0.81")).toBeCloseTo(518518.52, 2);
    expect(evaluate("50000 × 1.40 + 0.21*50000*1.45")).toBeCloseTo(85225, 6);
    expect(evaluate("84000 − 15225")).toBe(68775);
  });

  it("поддерживает min, max и round", () => {
    expect(evaluate("max(1, 2, 3) + min(4, 5)")).toBe(7);
    expect(evaluate("round(68775/50000, 4)")).toBe(1.3755);
    expect(evaluate("round(2.5)")).toBe(3);
  });

  it("отклоняет всё, кроме арифметики", () => {
    expect(() => evaluate("process.exit()")).toThrow(CalcError);
    expect(() => evaluate("1/0")).toThrow(/Деление на ноль/);
    expect(() => evaluate("2,90*3")).toThrow(/через точку/);
    expect(() => evaluate("50 000")).toThrow(CalcError);
    expect(() => evaluate("(1+2")).toThrow(/Ожидалось «\)»/);
    expect(() => evaluate("")).toThrow(/Пустое/);
    expect(() => evaluate("1+".repeat(300) + "1")).toThrow(/длиннее/);
  });

  it("помечает несчитаемые выражения, не роняя остальные", () => {
    const [ok, bad] = checkCalculations([
      { label: "Безубыточность", expression: "420000/0.81", assumptions: "маржа $0,81" },
      { label: "Ошибка", expression: "abc", assumptions: "" },
    ]);
    expect(formatCalculation(ok)).toBe("Безубыточность: 420000/0.81 = 518 518,52 (допущения: маржа $0,81)");
    expect(bad.result).toBeNull();
    expect(formatCalculation(bad)).toMatch(/^Ошибка: abc не посчитано: /);
  });
});
