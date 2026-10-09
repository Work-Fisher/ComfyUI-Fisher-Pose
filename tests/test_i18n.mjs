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

test('upstream camera, partial-pose, asset and link messages translate without changing details', () => {
    const messages = new Map([
        ['换镜头生成', 'Generate Camera View'],
        ['自动全身入框', 'Auto Fit Full Body'],
        ['识别完成：可应用 6 段肢体。未识别的部位保持人偶现有姿势。', 'Detection complete: 6 limb segments can be applied. Undetected parts retain their current mannequin pose.'],
        ['已应用到人物 2。', 'Applied to Person 2.'],
        ['已应用到人物 2。图中有 3 人，已取最大的一个。', 'Applied to Person 2; selected the largest of 3 people.'],
        ['已应用 6 段可见肢体；未识别部位保持原姿势。', 'Applied 6 visible limb segments; undetected parts retain their previous pose.'],
        ['已应用 6 段可见肢体；未识别部位保持原姿势。图中有 3 人，已取最大的一个。', 'Applied 6 visible limb segments; selected the largest of 3 people. Undetected parts retain their previous pose.'],
        ['已应用可见肢体。图中有 3 人，已取最大的一个。未识别的部位保持原姿势，手势需单独调整。', 'Visible limbs applied; selected the largest of 3 people. Undetected parts retain their previous pose; adjust hands separately.'],
        ['人体数据请求失败：HTTP 500。请检查 ComfyUI 服务或代理是否拦截。', 'Body data request failed: HTTP 500. Check the ComfyUI service and whether a proxy intercepted the request.'],
        ['节点 7 的 pose_json 连到了 FisherPoseImage 不存在的输出 5。请保存工作流并重启 ComfyUI；仍有问题时重新连接「姿势数据」输出，或导入最新版工作流。', 'Node 7 input pose_json is connected to nonexistent output 5 of FisherPoseImage. Save the workflow and restart ComfyUI. If the problem persists, reconnect the Pose Data output or import the latest workflow.'],
    ]);
    for (const [source, english] of messages) {
        assert.equal(translate(source, 'en'), english);
        assert.equal(translate(source, 'zh'), source);
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
