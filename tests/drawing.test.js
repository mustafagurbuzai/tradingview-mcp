/**
 * Unit tests for src/core/drawing.js helpers and the position-box tick math.
 * No TradingView needed: evaluate/getChartApi are injected via _deps.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePoints, priceToTicks, drawPosition, drawShape, SHAPE_TYPES } from '../src/core/drawing.js';

describe('normalizePoints', () => {
  it('builds from point/point2', () => {
    assert.deepEqual(normalizePoints({ point: { time: 1, price: 2 }, point2: { time: 3, price: 4 } }),
      [{ time: 1, price: 2 }, { time: 3, price: 4 }]);
  });
  it('accepts a JSON string points array', () => {
    assert.deepEqual(normalizePoints({ points: '[{"time":1,"price":2},{"time":3,"price":4},{"time":5,"price":6}]' }).length, 3);
  });
  it('rejects NaN', () => {
    assert.throws(() => normalizePoints({ point: { time: 'x', price: 1 } }), /finite/);
  });
});

describe('priceToTicks', () => {
  it('rounds to whole ticks, min 1', () => {
    assert.equal(priceToTicks(0.003856, 0.003800, 0.000001), 56);
    assert.equal(priceToTicks(100, 100.0000001, 0.01), 1);
  });
  it('rejects bad tick', () => { assert.throws(() => priceToTicks(1, 2, 0)); });
});

function mockChart() {
  const state = { shapes: [], props: {} };
  const evaluate = async (expr) => {
    if (/getAllShapes\(\)\.map/.test(expr)) return state.shapes.slice();
    if (/priceFormatter/.test(expr)) return 0.000001;
    if (/setProperties/.test(expr)) { state.props.va = true; return {}; }
    return undefined;
  };
  const evaluateAsync = async (expr) => {
    const m = expr.match(/shape: "([a-z_]+)"/);
    const id = 'id_' + (state.shapes.length + 1);
    state.shapes.push(id); state.lastShape = m?.[1]; state.lastExpr = expr;
    return id;
  };
  return { state, _deps: { evaluate, evaluateAsync, getChartApi: async () => 'CHART' } };
}

describe('drawShape', () => {
  it('uses the awaited entity id and passes N points', async () => {
    const { state, _deps } = mockChart();
    const r = await drawShape({ shape: 'path', points: [{ time: 1, price: 1 }, { time: 2, price: 2 }, { time: 3, price: 3 }], _deps });
    assert.equal(r.entity_id, 'id_1');
    assert.equal(state.lastShape, 'path');
    assert.match(state.lastExpr, /createMultipointShape/);
  });
  it('turns on value-area lines for volume profiles', async () => {
    const { state, _deps } = mockChart();
    await drawShape({ shape: 'fixed_range_volume_profile', point: { time: 1, price: 1 }, point2: { time: 2, price: 2 }, _deps });
    assert.equal(state.props.va, true);
  });
});

describe('drawPosition', () => {
  it('converts prices to ticks and reports R', async () => {
    const { state, _deps } = mockChart();
    const r = await drawPosition({ side: 'long', entry: 0.003856, stop: 0.003800, target: 0.004320, time: 1000, _deps });
    assert.equal(r.stop_ticks, 56);
    assert.equal(r.profit_ticks, 464);
    assert.equal(r.r_multiple, 8.29);
    assert.equal(state.lastShape, 'long_position');
    assert.match(state.lastExpr, /"stopLevel":56/);
  });
  it('rejects inconsistent long levels', async () => {
    const { _deps } = mockChart();
    await assert.rejects(drawPosition({ side: 'long', entry: 10, stop: 11, target: 12, time: 1, _deps }), /stop must be below/);
  });
  it('lists volume profile among two-point shapes', () => {
    assert.ok(SHAPE_TYPES.two_point.includes('fixed_range_volume_profile'));
  });
});
