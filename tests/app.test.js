'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'index.html');
const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';

function loadCore() {
  const match = html.match(/<script id="core-logic">([\s\S]*?)<\/script>/);
  assert.ok(match, 'index.html 应包含 id=core-logic 的内联核心脚本');
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(match[1], sandbox);
  return sandbox.window.WaimaiCore;
}

function sequence(values) {
  let index = 0;
  return () => values[index++ % values.length];
}

test('页面是 v0.1.0 独立应用，不依赖外部 JavaScript', () => {
  assert.match(html, /v0\.1\.0/);
  assert.match(html, /id="spinButton"/);
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.doesNotMatch(html, /app_17gdumj3z1p|csrfToken|tenantId/i);
});

test('默认菜库至少有 12 项且结构完整', () => {
  const core = loadCore();
  assert.ok(core.DEFAULT_FOODS.length >= 12);
  const ids = new Set();
  for (const food of core.DEFAULT_FOODS) {
    assert.ok(food.id && !ids.has(food.id));
    ids.add(food.id);
    assert.ok(food.name.length >= 2);
    assert.ok(food.price > 0);
    assert.ok(food.eta >= 5);
    assert.ok(food.category && food.taste && food.note);
    assert.equal(food.disabled, false);
  }
});

test('预算、口味、品类和启停状态可组合筛选', () => {
  const core = loadCore();
  const foods = [
    { id: 'a', name: 'A', price: 18, taste: '清淡', category: '粉面', disabled: false },
    { id: 'b', name: 'B', price: 28, taste: '香辣', category: '米饭', disabled: false },
    { id: 'c', name: 'C', price: 22, taste: '清淡', category: '粉面', disabled: true },
  ];
  assert.deepEqual(Array.from(core.filterFoods(foods, { budget: 25, taste: '清淡', category: '粉面' }), item => item.id), ['a']);
  assert.equal(core.filterFoods(foods, { budget: 0, taste: '全部', category: '全部' }).length, 2);
});

test('随机袋包含全部选项且无重复', () => {
  const core = loadCore();
  const bag = core.createBag(core.DEFAULT_FOODS, sequence([0.2, 0.8, 0.4, 0.6]));
  assert.equal(bag.length, core.DEFAULT_FOODS.length);
  assert.equal(new Set(bag).size, core.DEFAULT_FOODS.length);
  assert.deepEqual(Array.from(bag).sort(), Array.from(core.DEFAULT_FOODS, food => food.id).sort());
});

test('完整一轮抽完前不会重复', () => {
  const core = loadCore();
  const foods = core.DEFAULT_FOODS.slice(0, 8);
  let bag = [];
  let lastId = null;
  const seen = [];
  for (let index = 0; index < foods.length; index += 1) {
    const draw = core.drawNext(foods, bag, lastId, sequence([0.1, 0.7, 0.4]));
    seen.push(draw.item.id);
    assert.equal(draw.reshuffled, index === 0);
    bag = draw.bag;
    lastId = draw.item.id;
  }
  assert.equal(new Set(seen).size, foods.length);
  assert.equal(bag.length, 0);
});

test('重洗会明示且避免跨轮连续重复', () => {
  const core = loadCore();
  const foods = core.DEFAULT_FOODS.slice(0, 4);
  const first = core.drawNext(foods, [], null, () => 0);
  const second = core.drawNext(foods, [], first.item.id, () => 0);
  assert.equal(first.reshuffled, true);
  assert.equal(second.reshuffled, true);
  assert.notEqual(second.item.id, first.item.id);
});

test('只有一个可选项时仍可抽取', () => {
  const core = loadCore();
  const foods = core.DEFAULT_FOODS.slice(0, 1);
  const draw = core.drawNext(foods, [], foods[0].id, () => 0);
  assert.equal(draw.item.id, foods[0].id);
  assert.equal(draw.bag.length, 0);
});

test('袋中失效选项会被清理', () => {
  const core = loadCore();
  const foods = core.DEFAULT_FOODS.slice(0, 2);
  const draw = core.drawNext(foods, ['missing', foods[1].id], null, () => 0);
  assert.equal(draw.item.id, foods[1].id);
  assert.equal(draw.reshuffled, false);
});

test('转盘最终落点与预选结果逐项一致', () => {
  const core = loadCore();
  const count = 12;
  for (let index = 0; index < count; index += 1) {
    const rotation = core.computeSpinRotation(137, index, count, () => 0.5);
    const normalized = ((index + 0.5) * (360 / count) + rotation) % 360;
    const error = Math.min(normalized, 360 - normalized);
    assert.ok(error < 1e-8, `第 ${index} 项落点不一致：${error}`);
    assert.ok(rotation >= 137 + 4 * 360);
  }
});

test('转盘抖动不越过扇区中心 ±25%', () => {
  const core = loadCore();
  for (const random of [0, 0.999999]) {
    const rotation = core.computeSpinRotation(0, 3, 10, () => random);
    const step = 36;
    const centered = 3.5 * step;
    const raw = ((centered + rotation + 180) % 360) - 180;
    assert.ok(Math.abs(raw) <= step * 0.25 + 1e-8);
  }
});

test('自定义菜会修剪文本并补齐默认值', () => {
  const core = loadCore();
  const food = core.createCustomFood({ name: '  测试牛腩饭  ', price: '', eta: '', category: '米饭', taste: '咸香', note: '  少汁  ' }, 'custom-test');
  assert.equal(food.id, 'custom-test');
  assert.equal(food.name, '测试牛腩饭');
  assert.equal(food.price, 25);
  assert.equal(food.eta, 30);
  assert.equal(food.note, '少汁');
  assert.equal(food.custom, true);
  assert.equal(food.disabled, false);
});

test('自定义菜拒绝空名称和非法数值', () => {
  const core = loadCore();
  assert.throws(() => core.createCustomFood({ name: ' ' }, 'x'), /菜名/);
  assert.throws(() => core.createCustomFood({ name: '测试', price: -2 }, 'x'), /预算/);
  assert.throws(() => core.createCustomFood({ name: '测试', eta: 999 }, 'x'), /时间/);
});

test('历史记录最新在前且限制数量', () => {
  const core = loadCore();
  let history = [];
  for (let index = 0; index < 12; index += 1) history = core.addHistory(history, { id: String(index), foodId: 'a', accepted: false }, 8);
  assert.equal(history.length, 8);
  assert.equal(history[0].id, '11');
  assert.equal(history[7].id, '4');
});

test('损坏存档会回退到可用默认状态', () => {
  const core = loadCore();
  const state = core.normalizeState(null);
  assert.equal(state.foods.length, core.DEFAULT_FOODS.length);
  assert.deepEqual(Array.from(state.history), []);
  assert.equal(state.filters.budget, 0);
  const recovered = core.normalizeState({ foods: 'bad', history: 'bad', filters: { budget: -9 }, rotation: 'bad' });
  assert.equal(recovered.foods.length, core.DEFAULT_FOODS.length);
  assert.equal(recovered.filters.budget, 0);
  assert.equal(recovered.rotation, 0);
});

test('有效自定义菜、筛选和历史可穿过存档规范化', () => {
  const core = loadCore();
  const custom = core.createCustomFood({ name: '自定义测试', price: 26, eta: 25, category: '米饭', taste: '清淡' }, 'custom-keep');
  const state = core.normalizeState({ foods: [custom], history: [{ id: 'h1', foodId: custom.id, accepted: true }], filters: { budget: 30, taste: '清淡', category: '米饭' }, bag: [custom.id], lastResultId: custom.id, rotation: 720 });
  assert.equal(state.foods[0].name, '自定义测试');
  assert.equal(state.history[0].id, 'h1');
  assert.equal(state.filters.budget, 30);
  assert.equal(state.bag[0], custom.id);
  assert.equal(state.rotation, 720);
});

test('复制文本包含结果、关键信息与版本', () => {
  const core = loadCore();
  const text = core.formatResult(core.DEFAULT_FOODS[0], new Date('2026-11-21T12:00:00+08:00'));
  assert.match(text, /外卖吃啥 v0\.1\.0/);
  assert.match(text, new RegExp(core.DEFAULT_FOODS[0].name));
  assert.match(text, /2026/);
});
