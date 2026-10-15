// Arithmetic typed into a number field: "12/3" becomes 4.
//
// A small recursive-descent parser over + - * / and parentheses, never `eval`. Numbers follow the
// same rules as `parseDecimal`: "63.5" and "63,5" both work, and there are no thousands separators
// or exponents.

type Token = { kind: "num"; value: number } | { kind: "op"; op: string };

const NUMBER = /^(\d+[.,]?\d*|[.,]\d+)/;
// The signs a keyboard or a paste may bring: minus sign, times, division sign.
const ALIASES: Record<string, string> = { "−": "-", "×": "*", "÷": "/" };

function tokenize(text: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = ALIASES[text[i]] ?? text[i];
    if (c === " " || c === "\t") {
      i++;
    } else if ("+-*/()".includes(c)) {
      tokens.push({ kind: "op", op: c });
      i++;
    } else {
      const m = NUMBER.exec(text.slice(i));
      if (!m) return null;
      tokens.push({ kind: "num", value: Number(m[0].replace(",", ".")) });
      i += m[0].length;
    }
  }
  return tokens;
}

/**
 * The value of an arithmetic expression such as "12/3", "(63,5 + 2) * 3" or "-4 + 10", or null when
 * the text is not one (a typo, an unclosed parenthesis, a division by zero).
 */
export function evaluateArithmetic(text: string): number | null {
  const tokens = tokenize(text);
  if (!tokens || tokens.length === 0) return null;
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (op: string) => {
    const t = peek();
    return t?.kind === "op" && t.op === op;
  };

  // expr := term (("+" | "-") term)*
  const expr = (): number | null => {
    let left = term();
    while (left !== null && (isOp("+") || isOp("-"))) {
      const op = (tokens[pos++] as { op: string }).op;
      const right = term();
      if (right === null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  };
  // term := factor (("*" | "/") factor)*
  const term = (): number | null => {
    let left = factor();
    while (left !== null && (isOp("*") || isOp("/"))) {
      const op = (tokens[pos++] as { op: string }).op;
      const right = factor();
      if (right === null || (op === "/" && right === 0)) return null;
      left = op === "*" ? left * right : left / right;
    }
    return left;
  };
  // factor := ("+" | "-") factor | number | "(" expr ")"
  const factor = (): number | null => {
    const t = peek();
    if (!t) return null;
    pos++;
    if (t.kind === "num") return t.value;
    if (t.op === "-" || t.op === "+") {
      const v = factor();
      return v === null ? null : t.op === "-" ? -v : v;
    }
    if (t.op === "(") {
      const v = expr();
      if (v === null || !isOp(")")) return null;
      pos++;
      return v;
    }
    return null;
  };

  let value: number | null;
  try {
    value = expr();
  } catch {
    // Parentheses nested deeper than the stack: not something anyone types.
    return null;
  }
  if (value === null || pos !== tokens.length || !Number.isFinite(value)) return null;
  return value;
}
