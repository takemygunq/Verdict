import { describe, expect, it } from "vitest";
import { aggregate, capConfidence, decideStop, defendantMood, weightedMedian } from "@/lib/trial/stats";

const w = (score: number, weight = 1) => ({ score, weight });

describe("агрегация оценок", () => {
  it("взвешенная медиана при равных весах совпадает с обычной", () => {
    expect(weightedMedian([w(10), w(50), w(90)])).toBe(50);
    expect(weightedMedian([w(10), w(20), w(30), w(40)])).toBe(25);
  });

  it("вес смещает медиану", () => {
    // Прокурор (0.75) и адвокат (0.75) по краям, присяжные (1) посередине: ровно половина весов — среднее соседей
    expect(weightedMedian([w(20, 0.75), w(60), w(65), w(90, 0.75)])).toBe(62.5);
    expect(weightedMedian([w(20, 0.75), w(60), w(65), w(70), w(90, 0.75)])).toBe(65);
    expect(weightedMedian([w(10, 3), w(80), w(90)])).toBe(10);
  });

  it("игнорирует нулевые веса и падает без оценок", () => {
    expect(weightedMedian([w(10, 0), w(70)])).toBe(70);
    expect(() => weightedMedian([])).toThrow();
  });

  it("считает разброс", () => {
    const a = aggregate([w(40), w(60)]);
    expect(a).toMatchObject({ median: 50, mean: 50, std: 10, min: 40, max: 60 });
  });
});

describe("правила остановки", () => {
  const base = { minRounds: 2, maxRounds: 5, spreadThreshold: 10, newArguments: true, std: 30 };

  it("не останавливается раньше минимума, даже при консенсусе", () => {
    expect(decideStop({ ...base, round: 1, std: 2 })).toEqual({ stop: false, rule: "min_rounds" });
  });

  it("останавливается на максимуме", () => {
    expect(decideStop({ ...base, round: 5 })).toEqual({ stop: true, rule: "max_rounds" });
  });

  it("малый разброс и нет новых доводов — консенсус", () => {
    expect(decideStop({ ...base, round: 2, std: 9.9, newArguments: null })).toEqual({ stop: true, rule: "consensus" });
  });

  it("малый разброс, но прозвучали новые доводы — прения продолжаются", () => {
    expect(decideStop({ ...base, round: 2, std: 4 })).toEqual({ stop: false, rule: "new_arguments" });
  });

  it("оценки сошлись второй раз подряд — закрываемся даже с новыми доводами", () => {
    expect(decideStop({ ...base, round: 3, std: 4, consensusBefore: true })).toEqual({ stop: true, rule: "consensus" });
  });

  it("останавливается без новых аргументов", () => {
    expect(decideStop({ ...base, round: 3, newArguments: false })).toEqual({ stop: true, rule: "no_new_arguments" });
  });

  it("продолжает, если секретарь не ответил и мнения расходятся", () => {
    expect(decideStop({ ...base, round: 3, newArguments: null })).toEqual({ stop: false, rule: "continue" });
  });
});

describe("уверенность и реакция подсудимого", () => {
  it("снижает уверенность при большом разбросе", () => {
    expect(capConfidence("high", 5)).toBe("high");
    expect(capConfidence("high", 12)).toBe("medium");
    expect(capConfidence("high", 25)).toBe("low");
    expect(capConfidence("low", 0)).toBe("low");
  });

  it("радуется росту оценок и нервничает при падении", () => {
    expect(defendantMood(70, 55)).toBe("ecstatic");
    expect(defendantMood(60, 55)).toBe("happy");
    expect(defendantMood(50, 55)).toBe("nervous");
    expect(defendantMood(40, 55)).toBe("sweating");
    expect(defendantMood(80, null)).toBe("happy");
    expect(defendantMood(55, 55)).toBe("calm");
  });
});
