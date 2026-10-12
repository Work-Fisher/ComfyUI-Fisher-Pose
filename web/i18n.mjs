import english from './translations/en.mjs';

export const languageFor = locale => /^zh(?:[-_]|$)/i.test(String(locale || '')) ? 'zh' : 'en';

const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const templates = Object.entries(english).filter(([source]) => /\{\d+\}/.test(source)).map(([source, translated]) => {
    const indexes = [];
    const pattern = source.split(/(\{\d+\})/).map(part => {
        if (!/^\{\d+\}$/.test(part)) return escapeRegex(part);
        indexes.push(Number(part.slice(1, -1)));
        return '([\\s\\S]*?)';
    }).join('');
    return { pattern: new RegExp('^' + pattern + '$'), indexes, translated };
});

// Match complete UI messages, never replace words inside user text or prompts.
export function translate(source, locale = 'en') {
    if (typeof source !== 'string' || languageFor(locale) === 'zh') return source;
    const trimmed = source.trim();
    let result = Object.hasOwn(english, trimmed) ? english[trimmed] : undefined;
    if (result === undefined) {
        for (const { pattern, indexes, translated } of templates) {
            const match = trimmed.match(pattern);
            if (!match) continue;
            const values = new Map(indexes.map((index, i) => [index, match[i + 1]]));
            result = translated.replace(/\{(\d+)\}/g, (_, index) => values.get(Number(index)) ?? '');
            break;
        }
    }
    return result === undefined ? source : source.slice(0, source.length - source.trimStart().length)
        + result + source.slice(source.trimEnd().length);
}

export function comfyLocale(app, fallback = 'en') {
    return app?.ui?.settings?.getSettingValue?.('Comfy.Locale') || fallback;
}

// Keep language state out of widgets, pose JSON, graph serialization, and model inputs.
// Listen to the legacy settings event and also read the compatibility API:
// some newer frontends update their settings store without emitting that event.
export function followComfyLocale(app, onChange) {
    const settings = app?.ui?.settings;
    let previous;
    const update = value => {
        if (value === previous) return;
        previous = value;
        onChange(value);
    };
    const changed = event => update(event.detail?.value || comfyLocale(app));
    update(comfyLocale(app));
    settings?.addEventListener?.('Comfy.Locale.change', changed);
    const timer = setInterval(() => update(comfyLocale(app)), 1000);
    return () => { clearInterval(timer); settings?.removeEventListener?.('Comfy.Locale.change', changed); };
}
