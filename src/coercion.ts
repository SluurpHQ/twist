// Values React turns into strings (attributes, keys, form values, CSS, HTML): in development, one that cannot be
// (a Temporal date, an object whose valueOf throws) is named first, then the coercion is left to throw, as in React.
import { dev } from "./warnings.ts";

function typeName(value: any): string {
  return (typeof Symbol === "function" && value?.[Symbol.toStringTag]) || value?.constructor?.name || "Object";
}

function willThrow(value: unknown): boolean {
  try {
    "" + (value as any);
    return false;
  } catch {
    return true;
  }
}

/** `"" + value`, after React's warning when that throws. */
function check(value: unknown, message: () => string): string {
  if (dev() && willThrow(value)) console.error(message());
  return "" + (value as any);
}

const tail = " This value must be coerced to a string before using it here.";
export const attributeString = (value: unknown, name: string) => check(value, () => `The provided \`${name}\` attribute is an unsupported type ${typeName(value)}.${tail}`);
export const keyString = (value: unknown) => check(value, () => `The provided key is an unsupported type ${typeName(value)}.${tail}`);
export const cssString = (value: unknown, name: string) => check(value, () => `The provided \`${name}\` CSS property is an unsupported type ${typeName(value)}.${tail}`);
export const htmlString = (value: unknown) => check(value, () => `The provided HTML markup uses a value of unsupported type ${typeName(value)}.${tail}`);
export const fieldString = (value: unknown) =>
  check(value, () => `Form field values (value, checked, defaultValue, or defaultChecked props) must be strings, not ${typeName(value)}.${tail}`);
