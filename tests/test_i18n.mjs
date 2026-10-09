import test from 'node:test';
import assert from 'node:assert/strict';
import english from '../web/translations/en.mjs';
import { languageFor, translate, comfyLocale, followComfyLocale } from '../web/i18n.mjs';

test('Chinese locales retain originals; other languages fall back to English', () => {
    for (const locale of ['zh', 'zh-CN', 'zh-TW', 'ZH_cn']) {
        assert.equal(languageFor(locale), 'zh');
        assert.equal(translate('应用并生成', locale), '应用并生成');
    }
    for (const locale of ['en', 'en-GB', 'ja', 'id', undefined]) {
        assert.equal(languageFor(locale), 'en');
        assert.equal(translate('应用并生成', locale), 'Apply & Generate');
    }
});

test('complete messages preserve whitespace and interpolated names verbatim', () => {
    assert.equal(translate('  取消\n'), '  Cancel\n');
    assert.equal(translate('已保存「我的姿势 $& <人物>」。'), '已保存「我的姿势 $& <人物>」。');
    assert.equal(translate('已保存「我的姿势 $& <人物>」'), 'Saved “我的姿势 $& <人物>”');
    assert.equal(translate('正在编辑人物 2（使用人物 2 的照片）。'), "Editing Person 2 (using Person 2's photo).");
    assert.equal(translate('私有文件：取消.png'), '私有文件：取消.png');
    assert.equal(translate('Draw character from image2'), 'Draw character from image2');
    for (const text of ['toString', 'constructor', '__proto__']) assert.equal(translate(text), text);
});

test('all translation templates retain their parameter slots', () => {
    const slots = text => [...text.matchAll(/\{(\d+)\}/g)].map(match => match[1]).sort();
    for (const [source, translated] of Object.entries(english)) {
        assert.deepEqual(slots(translated), slots(source), source);
    }
});

test('follow Comfy.Locale on initial load, settings events, and store-only updates', context => {
    context.mock.timers.enable({ apis: ['setInterval'] });
    let locale = 'en';
    const settings = new EventTarget();
    settings.getSettingValue = key => key === 'Comfy.Locale' ? locale : undefined;
    const app = { ui: { settings } };
    const seen = [];
    const stop = followComfyLocale(app, value => seen.push(value));
    assert.equal(comfyLocale(app), 'en');
    assert.deepEqual(seen, ['en']);
    locale = 'zh';
    settings.dispatchEvent(new CustomEvent('Comfy.Locale.change', { detail: { value: locale } }));
    context.mock.timers.tick(1000);
    assert.deepEqual(seen, ['en', 'zh']);
    locale = 'en-GB';
    context.mock.timers.tick(1000);
    assert.deepEqual(seen, ['en', 'zh', 'en-GB']);
    stop();
    locale = 'zh-TW';
    settings.dispatchEvent(new CustomEvent('Comfy.Locale.change', { detail: { value: locale } }));
    context.mock.timers.tick(1000);
    assert.deepEqual(seen, ['en', 'zh', 'en-GB']);
});
