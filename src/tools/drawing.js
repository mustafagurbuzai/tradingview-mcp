import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/drawing.js';

export function registerDrawingTools(server) {
  server.tool('draw_shape', 'Draw a shape/line on the chart', {
    shape: z.string().describe(`Shape type. 1-point: ${core.SHAPE_TYPES.one_point.join(', ')}. 2-point: ${core.SHAPE_TYPES.two_point.join(', ')}. N-point: ${core.SHAPE_TYPES.multi_point.join(', ')}. Other TradingView line-tool names pass through.`),
    point: z.object({ time: z.coerce.number(), price: z.coerce.number() }).optional().describe('{ time: unix_timestamp, price: number } (first point; omit when using points)'),
    point2: z.object({ time: z.coerce.number(), price: z.coerce.number() }).optional().describe('Second point for two-point shapes (trend_line, rectangle, fib, volume profile, position)'),
    points: z.array(z.object({ time: z.coerce.number(), price: z.coerce.number() })).optional().describe('Full points array (overrides point/point2; required for 3+ point shapes)'),
    overrides: z.string().optional().describe('JSON string of style overrides (e.g., \'{"linecolor": "#ff0000", "linewidth": 2}\'); keys from draw_get_properties'),
    text: z.string().optional().describe('Text content / label'),
  }, async ({ shape, point, point2, points, overrides, text }) => {
    try { return jsonResult(await core.drawShape({ shape, point, point2, points, overrides, text })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('draw_position', 'Draw a long/short position box from entry, stop and target prices; reports the R multiple', {
    side: z.enum(['long', 'short']).default('long'),
    entry: z.coerce.number().describe('Entry price'),
    stop: z.coerce.number().describe('Stop price'),
    target: z.coerce.number().describe('Target price'),
    time: z.coerce.number().describe('Unix timestamp where the box starts'),
    time2: z.coerce.number().optional().describe('Box end timestamp (default time + 1 day)'),
    text: z.string().optional(),
  }, async (args) => {
    try { return jsonResult(await core.drawPosition(args)); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('draw_move', 'Move an existing drawing by replacing its anchor points', {
    entity_id: z.string().describe('Entity ID (from draw_list)'),
    points: z.array(z.object({ time: z.coerce.number(), price: z.coerce.number() })).describe('New points, same count as the shape has'),
  }, async ({ entity_id, points }) => {
    try { return jsonResult(await core.movePoints({ entity_id, points })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('draw_set_properties', 'Change style/properties of an existing drawing (deep-merged)', {
    entity_id: z.string().describe('Entity ID (from draw_list)'),
    properties: z.string().describe('JSON object, keys from draw_get_properties → properties'),
  }, async ({ entity_id, properties }) => {
    try { return jsonResult(await core.setProperties({ entity_id, properties })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('draw_set_visible', 'Show or hide a drawing without deleting it', {
    entity_id: z.string().describe('Entity ID (from draw_list)'),
    visible: z.boolean(),
  }, async ({ entity_id, visible }) => {
    try { return jsonResult(await core.setVisible({ entity_id, visible })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('draw_list', 'List all shapes/drawings on the chart', {}, async () => {
    try { return jsonResult(await core.listDrawings()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('draw_clear', 'Remove all drawings from the chart', {}, async () => {
    try { return jsonResult(await core.clearAll()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('draw_remove_one', 'Remove a specific drawing by entity ID', {
    entity_id: z.string().describe('Entity ID of the drawing to remove (from draw_list)'),
  }, async ({ entity_id }) => {
    try { return jsonResult(await core.removeOne({ entity_id })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('draw_get_properties', 'Get properties and points of a specific drawing', {
    entity_id: z.string().describe('Entity ID of the drawing (from draw_list)'),
  }, async ({ entity_id }) => {
    try { return jsonResult(await core.getProperties({ entity_id })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
