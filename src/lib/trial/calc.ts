/**
 * Калькулятор участников: модели записывают расчёт выражением, код считает его сам.
 * Так спор идёт о допущениях («старт 300 точек, опоздание листинга 3 недели»), а не о том, кто верно умножил.
 *
 * Поддерживается только арифметика: числа, + − * / ^, скобки, унарный минус и min/max/round.
 * Никакого eval — разбор вручную, чтобы выражение из ответа модели не могло выполнить код.
 */

const FUNCTIONS: Record<string, (...xs: number[]) => number> = {
  min: (...xs) => Math.min(...xs),
  max: (...xs) => Math.max(...xs),
  round: (x, digits = 0) => Math.round(x * 10 ** digits) / 10 ** digits,
};

const MAX_LENGTH = 500;

export class CalcError extends Error {}

/** Считает арифметическое выражение. Бросает CalcError, если оно некорректно. */
export function evaluate(expression: string): number {
  if (expression.length > MAX_LENGTH) throw new CalcError(`Выражение длиннее ${MAX_LENGTH} символов`);
  // Модели пишут «×», «÷», «−» — приводим к обычной записи. Запятая занята под аргументы min/max/round,
  // поэтому десятичная запятая не поддерживается: об этом говорит отдельная ошибка ниже.
  const src = expression.replace(/[×·]/g, "*").replace(/÷/g, "/").replace(/[−–]/g, "-");
  let pos = 0;

  const peek = () => {
    while (src[pos] === " ") pos++;
    return src[pos];
  };
  const expect = (ch: string) => {
    if (peek() !== ch) throw new CalcError(`Ожидалось «${ch}» в позиции ${pos + 1}`);
    pos++;
  };

  // expr := term (('+' | '-') term)*
  const expr = (): number => {
    let v = term();
    for (let c = peek(); c === "+" || c === "-"; c = peek()) {
      pos++;
      v = c === "+" ? v + term() : v - term();
    }
    return v;
  };
  // term := unary (('*' | '/') unary)*
  const term = (): number => {
    let v = unary();
    for (let c = peek(); c === "*" || c === "/"; c = peek()) {
      pos++;
      const r = unary();
      if (c === "/" && r === 0) throw new CalcError("Деление на ноль");
      v = c === "*" ? v * r : v / r;
    }
    return v;
  };
  // unary := ('-' | '+') unary | power  — степень сильнее минуса: -2^2 = -4
  const unary = (): number => {
    if (peek() === "-") {
      pos++;
      return -unary();
    }
    if (peek() === "+") {
      pos++;
      return unary();
    }
    return power();
  };
  // power := atom ('^' unary)?  — правоассоциативно, показатель может быть отрицательным
  const power = (): number => {
    const base = atom();
    if (peek() !== "^") return base;
    pos++;
    return base ** unary();
  };
  const atom = (): number => {
    const c = peek();
    if (c === "(") {
      pos++;
      const v = expr();
      expect(")");
      return v;
    }
    const num = /^\d+(?:\.\d+)?|^\.\d+/.exec(src.slice(pos));
    if (num) {
      pos += num[0].length;
      return Number(num[0]);
    }
    const name = /^[a-z]+/.exec(src.slice(pos));
    if (name && FUNCTIONS[name[0]]) {
      pos += name[0].length;
      expect("(");
      const args = [expr()];
      while (peek() === ",") {
        pos++;
        args.push(expr());
      }
      expect(")");
      return FUNCTIONS[name[0]](...args);
    }
    throw new CalcError(c === undefined ? "Выражение оборвалось" : `Непонятный символ «${c}» в позиции ${pos + 1}`);
  };

  if (!src.trim()) throw new CalcError("Пустое выражение");
  const value = expr();
  if (peek() === ",") throw new CalcError("Десятичная дробь пишется через точку: 2.90, а не 2,90");
  if (peek() !== undefined) throw new CalcError(`Лишний символ «${peek()}» в позиции ${pos + 1}`);
  if (!Number.isFinite(value)) throw new CalcError("Результат не является конечным числом");
  return value;
}

export interface Calculation {
  label: string;
  expression: string;
  assumptions: string;
}

export interface CheckedCalculation extends Calculation {
  /** Результат, посчитанный кодом; null — выражение не удалось посчитать */
  result: number | null;
  error?: string;
}

export function checkCalculations(items: Calculation[] | undefined): CheckedCalculation[] {
  return (items ?? []).map((c) => {
    try {
      return { ...c, result: evaluate(c.expression) };
    } catch (e) {
      return { ...c, result: null, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

/** Число в протоколе: до двух знаков после запятой, разряды через пробел. */
export function formatNumber(x: number): string {
  const rounded = Math.round(x * 100) / 100;
  return rounded.toLocaleString("ru-RU", { maximumFractionDigits: 2 }).replace(/ /g, " ");
}

/** Строка для протокола: что считали, как, при каких допущениях и что получил код. */
export function formatCalculation(c: CheckedCalculation): string {
  const value = c.result === null ? `не посчитано: ${c.error}` : `= ${formatNumber(c.result)}`;
  return `${c.label}: ${c.expression} ${value}${c.assumptions ? ` (допущения: ${c.assumptions})` : ""}`;
}
