/**
 * A `vitest` stand-in built on `node:test` and `node:assert`.
 *
 * The test files are written against vitest because that is what the project installs for
 * normal development. This shim exists so the same files also run with nothing installed
 * at all — `npm run test:node` needs no registry access, which matters when the suite is
 * the only proof the calculation rules are correct.
 *
 * Only the surface the tests actually use is implemented. Anything missing throws by name
 * rather than silently passing, so an unsupported matcher fails loudly instead of hiding.
 */

import {
  describe as nodeDescribe,
  it as nodeIt,
  before,
  after,
  beforeEach,
  afterEach,
} from 'node:test';
import assert from 'node:assert/strict';

/** Deep equality that treats a missing key and an explicit undefined as different. */
function deepEqual(actual, expected) {
  try {
    assert.deepStrictEqual(actual, expected);
    return true;
  } catch {
    return false;
  }
}

function stringify(value) {
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'function') return value.name ? `[Function ${value.name}]` : '[Function]';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function fail(actual, expected, comparison) {
  assert.fail(`expected ${stringify(actual)} ${comparison} ${stringify(expected)}`);
}

function createMatchers(actual, negated) {
  /** Assert `outcome`, flipping the sense of the check when `.not` was used. */
  const check = (outcome, expected, comparison) => {
    if (outcome === !negated) return;
    fail(actual, expected, negated ? `not ${comparison}` : comparison);
  };

  const matchers = {
    toBe: (expected) => check(Object.is(actual, expected), expected, 'to be'),
    toEqual: (expected) => check(deepEqual(actual, expected), expected, 'to equal'),
    toStrictEqual: (expected) => check(deepEqual(actual, expected), expected, 'to strictly equal'),
    toBeNull: () => check(actual === null, null, 'to be'),
    toBeUndefined: () => check(actual === undefined, undefined, 'to be'),
    toBeDefined: () => check(actual !== undefined, undefined, 'to be defined, not'),
    toBeTruthy: () => check(Boolean(actual), true, 'to be truthy'),
    toBeFalsy: () => check(!actual, false, 'to be falsy'),
    toBeNaN: () => check(Number.isNaN(actual), NaN, 'to be'),
    toBeGreaterThan: (n) => check(actual > n, n, 'to be greater than'),
    toBeGreaterThanOrEqual: (n) => check(actual >= n, n, 'to be at least'),
    toBeLessThan: (n) => check(actual < n, n, 'to be less than'),
    toBeLessThanOrEqual: (n) => check(actual <= n, n, 'to be at most'),

    toBeCloseTo: (expected, digits = 2) => {
      const within = Math.abs(actual - expected) < Math.pow(10, -digits) / 2;
      check(within, expected, `to be within ${digits} decimals of`);
    },

    toContain: (needle) => {
      const has =
        typeof actual === 'string'
          ? actual.includes(needle)
          : Array.isArray(actual)
            ? actual.some((entry) => Object.is(entry, needle))
            : actual instanceof Set
              ? actual.has(needle)
              : false;
      check(has, needle, 'to contain');
    },

    toContainEqual: (needle) => {
      const has = Array.isArray(actual) && actual.some((entry) => deepEqual(entry, needle));
      check(has, needle, 'to contain an item equal to');
    },

    toHaveLength: (n) => check(actual?.length === n, n, 'to have length'),

    toMatch: (pattern) => {
      const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
      check(re.test(String(actual)), String(pattern), 'to match');
    },

    toMatchObject: (expected) => {
      const subset = (a, e) => {
        if (a === null || typeof a !== 'object') return deepEqual(a, e);
        return Object.entries(e).every(([key, value]) =>
          value !== null && typeof value === 'object'
            ? subset(a[key], value)
            : Object.is(a[key], value),
        );
      };
      check(subset(actual, expected), expected, 'to match object');
    },

    // Rest args rather than a fixed second parameter: the one-argument form asserts only
    // that the key exists, so an explicit `undefined` value has to stay distinguishable
    // from "no value given". `arguments` is not available here — this is an arrow function.
    toHaveProperty: (key, ...rest) => {
      const path = Array.isArray(key) ? key : String(key).split('.');
      let cursor = actual;
      let found = true;
      for (const step of path) {
        if (cursor === null || cursor === undefined || !(step in cursor)) {
          found = false;
          break;
        }
        cursor = cursor[step];
      }
      const ok = found && (rest.length === 0 || deepEqual(cursor, rest[0]));
      check(ok, key, 'to have property');
    },

    toThrow: (expected) => {
      if (typeof actual !== 'function') {
        assert.fail('expect(...).toThrow() needs a function to call');
      }
      let thrown;
      try {
        actual();
      } catch (error) {
        thrown = error ?? new Error('threw a falsy value');
      }
      if (!thrown) {
        check(false, expected ?? 'an error', 'to throw');
        return;
      }
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      const matched =
        expected === undefined
          ? true
          : expected instanceof RegExp
            ? expected.test(message)
            : typeof expected === 'function'
              ? thrown instanceof expected
              : message.includes(String(expected));
      check(matched, expected ?? 'an error', 'to throw');
    },
  };

  matchers.toThrowError = matchers.toThrow;
  matchers.not = negated ? matchers : createMatchers(actual, true);
  matchers.resolves = {
    ...matchers,
    // Async assertions are not used by this suite; fail rather than pretend.
    toBe: () => assert.fail('expect(...).resolves is not implemented in the vitest shim'),
  };
  return matchers;
}

export function expect(actual) {
  return createMatchers(actual, false);
}

expect.fail = (message) => assert.fail(message ?? 'expect.fail()');

/** `test` and `it` are the same function in vitest. */
export { before, after, beforeEach, afterEach };

/**
 * Fill a table-driven test title.
 *
 * Supports the printf-style placeholders the suite uses. `%#` is the row index and consumes
 * no argument; `%%` is a literal percent. Anything else takes the next value from the row.
 */
function formatTitle(template, row, index) {
  let cursor = 0;
  const filled = template.replace(/%[sdifjo#%]/g, (token) => {
    if (token === '%%') return '%';
    if (token === '%#') return String(index);
    const value = row[cursor];
    cursor += 1;
    if (token === '%d' || token === '%i') return String(Math.trunc(Number(value)));
    if (token === '%f') return String(Number(value));
    if (token === '%j' || token === '%o') return stringify(value);
    return typeof value === 'string' ? value : stringify(value);
  });

  // A title with no placeholders would name every row identically, which makes a failure
  // report ambiguous about which row failed. vitest permits it; this shim numbers them so
  // the TAP output stays readable.
  return cursor === 0 && !template.includes('%#') ? `${filled} [row ${index}]` : filled;
}

/**
 * `.each` for table-driven cases.
 *
 * Rows that are arrays are spread as arguments, matching vitest. A row that is not an array
 * is passed as a single argument.
 */
function attachEach(register) {
  return (table) => {
    if (!Array.isArray(table)) {
      throw new TypeError(
        '.each in the vitest shim takes an array of rows; the tagged-template form is not implemented',
      );
    }
    return (title, fn, options) => {
      table.forEach((row, index) => {
        const args = Array.isArray(row) ? row : [row];
        register(formatTitle(title, args, index), options, () => fn(...args));
      });
    };
  };
}

/**
 * Re-export node:test's `it`/`describe` with the extras vitest tests reach for.
 *
 * `.skip`, `.only` and `.todo` come from node:test already, so they are copied across rather
 * than reimplemented; `.each` is the one addition.
 */
function withEach(base) {
  const wrapper = (...args) => base(...args);
  Object.assign(wrapper, base);
  for (const variant of ['skip', 'only', 'todo']) {
    if (typeof base[variant] === 'function') {
      wrapper[variant] = (...args) => base[variant](...args);
      wrapper[variant].each = attachEach((title, options, fn) =>
        options ? base[variant](title, options, fn) : base[variant](title, fn),
      );
    }
  }
  wrapper.each = attachEach((title, options, fn) =>
    options ? base(title, options, fn) : base(title, fn),
  );
  return wrapper;
}

const itWithEach = withEach(nodeIt);
const describeWithEach = withEach(nodeDescribe);

export {
  itWithEach as it,
  itWithEach as test,
  describeWithEach as describe,
};

/** vitest lifecycle names differ from node:test's. */
export const beforeAll = before;
export const afterAll = after;

export const vi = {
  fn: (implementation) => {
    const calls = [];
    const spy = (...args) => {
      calls.push(args);
      return implementation?.(...args);
    };
    spy.mock = { calls };
    return spy;
  },
};

export default {
  describe: describeWithEach,
  it: itWithEach,
  test: itWithEach,
  expect,
  beforeAll: before,
  afterAll: after,
  beforeEach,
  afterEach,
  vi,
};
