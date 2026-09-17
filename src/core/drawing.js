/**
 * Core drawing logic.
 */
import { evaluate as _evaluate, evaluateAsync as _evaluateAsync, getChartApi as _getChartApi, safeString, requireFinite } from '../connection.js';

/**
 * Shape names accepted by TradingView's createShape/createMultipointShape.
 * Verified on TradingView Desktop 3.4.1 (2026-09-17). The name is passed
 * through untouched, so any other LineTool name TradingView knows also works.
 */
export const SHAPE_TYPES = {
  one_point: ['horizontal_line', 'vertical_line', 'horizontal_ray', 'text', 'price_label', 'arrow_up', 'arrow_down', 'flag', 'note', 'anchored_vwap'],
  two_point: ['trend_line', 'ray', 'extended', 'rectangle', 'ellipse', 'fib_retracement', 'fib_extension', 'parallel_channel',
    'long_position', 'short_position', 'fixed_range_volume_profile', 'anchored_volume_profile', 'date_range', 'price_range'],
  multi_point: ['path', 'polyline', 'triangle'],
};

const VOLUME_PROFILE_SHAPES = new Set(['fixed_range_volume_profile', 'anchored_volume_profile']);

function _resolve(deps) {
  return {
    evaluate: deps?.evaluate || _evaluate,
    evaluateAsync: deps?.evaluateAsync || _evaluateAsync,
    getChartApi: deps?.getChartApi || _getChartApi,
  };
}

/** Normalize {point, point2, points} into a validated points array. Exported for tests. */
export function normalizePoints({ point, point2, points }) {
  let list = [];
  let names = null;
  if (points) list = typeof points === 'string' ? JSON.parse(points) : points;
  else { list = [point]; names = ['point']; if (point2) { list.push(point2); names.push('point2'); } }
  if (!Array.isArray(list) || list.length === 0) throw new Error('at least one point is required');
  return list.map((pt, i) => {
    const n = names ? names[i] : `points[${i}]`;
    return { time: requireFinite(pt?.time, `${n}.time`), price: requireFinite(pt?.price, `${n}.price`) };
  });
}

/**
 * Convert a price distance into ticks for long_position/short_position
 * (their stopLevel/profitLevel are tick counts, not prices). Exported for tests.
 */
export function priceToTicks(from, to, minTick) {
  const mt = requireFinite(minTick, 'minTick');
  if (mt <= 0) throw new Error('minTick must be > 0');
  return Math.max(1, Math.round(Math.abs(to - from) / mt));
}

export async function drawShape({ shape, point, point2, points, overrides: overridesRaw, text, _deps }) {
  const { evaluate, evaluateAsync, getChartApi } = _resolve(_deps);
  const overrides = overridesRaw ? (typeof overridesRaw === 'string' ? JSON.parse(overridesRaw) : overridesRaw) : {};
  const apiPath = await getChartApi();
  const overridesStr = JSON.stringify(overrides || {});
  const textStr = text ? JSON.stringify(text) : '""';
  const pts = normalizePoints({ point, point2, points });

  const before = await evaluate(`${apiPath}.getAllShapes().map(function(s) { return s.id; })`);

  // Both create calls return a Promise<entityId> on recent builds; await it.
  let created;
  if (pts.length > 1) {
    created = await evaluateAsync(`
      ${apiPath}.createMultipointShape(
        ${JSON.stringify(pts)},
        { shape: ${safeString(shape)}, overrides: ${overridesStr}, text: ${textStr} }
      )
    `);
  } else {
    created = await evaluateAsync(`
      ${apiPath}.createShape(
        ${JSON.stringify(pts[0])},
        { shape: ${safeString(shape)}, overrides: ${overridesStr}, text: ${textStr} }
      )
    `);
  }

  await new Promise(r => setTimeout(r, 200));
  const after = await evaluate(`${apiPath}.getAllShapes().map(function(s) { return s.id; })`);
  const newId = (typeof created === 'string' && created) || (after || []).find(id => !(before || []).includes(id)) || null;

  // Volume profiles: show value-area lines by default (POC is already on).
  if (newId && VOLUME_PROFILE_SHAPES.has(shape) && !overrides.graphics) {
    await evaluate(`
      (function() {
        var s = ${apiPath}.getShapeById(${safeString(newId)});
        if (s) s.setProperties({ graphics: { horizlines: { vahLines: { visible: true }, valLines: { visible: true } } } });
      })()
    `);
  }

  return { success: true, shape, entity_id: newId, points: pts };
}

/** Move an existing drawing by replacing its anchor points. */
export async function movePoints({ entity_id, points, _deps }) {
  const { evaluate, getChartApi } = _resolve(_deps);
  if (!entity_id) throw new Error('entity_id is required');
  const pts = normalizePoints({ points });
  const apiPath = await getChartApi();
  const result = await evaluate(`
    (function() {
      var s = ${apiPath}.getShapeById(${safeString(entity_id)});
      if (!s) return { error: 'Shape not found: ' + ${safeString(entity_id)} };
      s.setPoints(${JSON.stringify(pts)});
      return { points: s.getPoints() };
    })()
  `);
  if (result?.error) throw new Error(result.error);
  return { success: true, entity_id, points: result?.points };
}

/** Change style/properties of an existing drawing (deep-merged by TradingView). */
export async function setProperties({ entity_id, properties: propsRaw, _deps }) {
  const { evaluate, getChartApi } = _resolve(_deps);
  if (!entity_id) throw new Error('entity_id is required');
  const props = typeof propsRaw === 'string' ? JSON.parse(propsRaw) : propsRaw;
  if (!props || typeof props !== 'object') throw new Error('properties must be a JSON object');
  const apiPath = await getChartApi();
  const result = await evaluate(`
    (function() {
      var s = ${apiPath}.getShapeById(${safeString(entity_id)});
      if (!s) return { error: 'Shape not found: ' + ${safeString(entity_id)} };
      s.setProperties(${JSON.stringify(props)});
      var p = s.getProperties(); var out = {};
      for (var k in ${JSON.stringify(props)}) out[k] = p[k];
      return { applied: out };
    })()
  `);
  if (result?.error) throw new Error(result.error);
  return { success: true, entity_id, applied: result?.applied };
}

/** Show or hide a drawing without deleting it. */
export async function setVisible({ entity_id, visible, _deps }) {
  const { evaluate, getChartApi } = _resolve(_deps);
  if (!entity_id) throw new Error('entity_id is required');
  const apiPath = await getChartApi();
  const result = await evaluate(`
    (function() {
      var s = ${apiPath}.getShapeById(${safeString(entity_id)});
      if (!s) return { error: 'Shape not found: ' + ${safeString(entity_id)} };
      s.setVisible(${visible ? 'true' : 'false'});
      return { hidden: s.isHidden() };
    })()
  `);
  if (result?.error) throw new Error(result.error);
  return { success: true, entity_id, visible: !result?.hidden };
}

/**
 * Draw a long/short position box from prices (entry, stop, target). TradingView
 * stores stop/profit as tick counts; this converts using the chart's min tick.
 */
export async function drawPosition({ side, entry, stop, target, time, time2, text, _deps }) {
  // `text` is accepted for API symmetry but ignored (see below).
  const { evaluate, getChartApi } = _resolve(_deps);
  const s = String(side || 'long').toLowerCase();
  if (s !== 'long' && s !== 'short') throw new Error('side must be long or short');
  const e = requireFinite(entry, 'entry'); const st = requireFinite(stop, 'stop'); const tg = requireFinite(target, 'target');
  if (s === 'long' && !(st < e && tg > e)) throw new Error('long: stop must be below entry and target above');
  if (s === 'short' && !(st > e && tg < e)) throw new Error('short: stop must be above entry and target below');
  const t1 = requireFinite(time, 'time');
  const t2 = time2 != null ? requireFinite(time2, 'time2') : t1 + 86400;
  const apiPath = await getChartApi();
  const minTick = await evaluate(`
    (function() { var f = ${apiPath}.priceFormatter(); return f._minMove / f._priceScale; })()
  `);
  const stopLevel = priceToTicks(e, st, minTick);
  const profitLevel = priceToTicks(e, tg, minTick);
  // Position tools reject a text payload ("Value is undefined" from
  // _createMultipointShape, TV Desktop 3.4.1) — never pass one.
  const res = await drawShape({
    shape: `${s}_position`, points: [{ time: t1, price: e }, { time: t2, price: e }],
    overrides: { stopLevel, profitLevel }, _deps,
  });
  const r = Math.abs(tg - e) / Math.abs(e - st);
  return { ...res, side: s, text_ignored: text ? true : undefined, entry: e, stop: st, target: tg, min_tick: minTick, stop_ticks: stopLevel, profit_ticks: profitLevel, r_multiple: Number(r.toFixed(2)) };
}

export async function listDrawings() {
  const apiPath = await _getChartApi();
  const shapes = await _evaluate(`
    (function() {
      var api = ${apiPath};
      var all = api.getAllShapes();
      return all.map(function(s) { return { id: s.id, name: s.name }; });
    })()
  `);
  return { success: true, count: shapes?.length || 0, shapes: shapes || [] };
}

export async function getProperties({ entity_id }) {
  const apiPath = await _getChartApi();
  const result = await _evaluate(`
    (function() {
      var api = ${apiPath};
      var eid = ${safeString(entity_id)};
      var props = { entity_id: eid };
      var shape = api.getShapeById(eid);
      if (!shape) return { error: 'Shape not found: ' + eid };
      var methods = [];
      try { for (var key in shape) { if (typeof shape[key] === 'function') methods.push(key); } props.available_methods = methods; } catch(e) {}
      try { var pts = shape.getPoints(); if (pts) props.points = pts; } catch(e) { props.points_error = e.message; }
      try { var ovr = shape.getProperties(); if (ovr) props.properties = ovr; } catch(e) {
        try { var ovr2 = shape.properties(); if (ovr2) props.properties = ovr2; } catch(e2) { props.properties_error = e2.message; }
      }
      try { props.visible = shape.isVisible(); } catch(e) {}
      try { props.locked = shape.isLocked(); } catch(e) {}
      try { props.selectable = shape.isSelectionEnabled(); } catch(e) {}
      try {
        var all = api.getAllShapes();
        for (var i = 0; i < all.length; i++) { if (all[i].id === eid) { props.name = all[i].name; break; } }
      } catch(e) {}
      return props;
    })()
  `);
  if (result?.error) throw new Error(result.error);
  return { success: true, ...result };
}

export async function removeOne({ entity_id }) {
  const apiPath = await _getChartApi();
  const result = await _evaluate(`
    (function() {
      var api = ${apiPath};
      var eid = ${safeString(entity_id)};
      var before = api.getAllShapes();
      var found = false;
      for (var i = 0; i < before.length; i++) { if (before[i].id === eid) { found = true; break; } }
      if (!found) return { removed: false, error: 'Shape not found: ' + eid, available: before.map(function(s) { return s.id; }) };
      api.removeEntity(eid);
      var after = api.getAllShapes();
      var stillExists = false;
      for (var j = 0; j < after.length; j++) { if (after[j].id === eid) { stillExists = true; break; } }
      return { removed: !stillExists, entity_id: eid, remaining_shapes: after.length };
    })()
  `);
  if (result?.error) throw new Error(result.error);
  return { success: true, entity_id: result?.entity_id, removed: result?.removed, remaining_shapes: result?.remaining_shapes };
}

export async function clearAll() {
  const apiPath = await _getChartApi();
  await _evaluate(`${apiPath}.removeAllShapes()`);
  return { success: true, action: 'all_shapes_removed' };
}
