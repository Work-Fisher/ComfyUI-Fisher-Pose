import { languageFor, translate } from './i18n.mjs';

const ATTRIBUTES = ['title', 'alt', 'placeholder', 'aria-label'];
const SKIP = 'script, style, textarea, input, [contenteditable], [data-i18n-skip], #description';

// Localize only the editor's display DOM. The editor continues to build its
// original state and prompts. Weak maps retain originals without retaining
// removed gallery items or exposing them in saved HTML/workflow data.
export function localizeEditor(win = window) {
    const doc = win.document;
    const originals = new WeakMap();
    let locale = new URLSearchParams(win.location.search).get('lang') || win.navigator.language || 'en';
    const skipped = element => element?.closest(SKIP);

    function display(target, field, current, write) {
        let fields = originals.get(target);
        if (!fields) originals.set(target, fields = new Map());
        let record = fields.get(field);
        if (!record || current !== record.displayed) record = { source: current };
        record.displayed = translate(record.source, locale);
        fields.set(field, record);
        if (current !== record.displayed) write(record.displayed);
    }

    function text(node) {
        if (skipped(node.parentElement)) return;
        // Options without an explicit value derive their value from the label.
        // Freeze the original value before translating either editor's labels.
        const option = node.parentElement;
        if (option?.tagName === 'OPTION' && !option.hasAttribute('value')) option.value = option.textContent;
        display(node, 'text', node.data, value => { node.data = value; });
    }

    function attributes(element) {
        if (skipped(element)) return;
        for (const name of ATTRIBUTES) {
            const current = element.getAttribute(name);
            if (current !== null) display(element, name, current, value => element.setAttribute(name, value));
        }
    }

    function visit(root) {
        if (root.nodeType === 3) { text(root); return; }
        if (root.nodeType === 1) attributes(root);
        const walker = doc.createTreeWalker(root, 1 | 4);
        while (walker.nextNode()) {
            if (walker.currentNode.nodeType === 3) text(walker.currentNode);
            else attributes(walker.currentNode);
        }
    }

    function setLocale(value) {
        locale = value || 'en';
        doc.documentElement.lang = languageFor(locale) === 'zh' ? 'zh-CN' : 'en';
        visit(doc.documentElement);
    }

    const observer = new win.MutationObserver(records => {
        for (const record of records) {
            if (record.type === 'characterData') text(record.target);
            else if (record.type === 'attributes') attributes(record.target);
            else for (const node of record.addedNodes) visit(node);
        }
    });
    setLocale(locale);
    observer.observe(doc.documentElement, { subtree: true, childList: true, characterData: true,
        attributes: true, attributeFilter: ATTRIBUTES });

    const receive = event => {
        if (event.origin === win.location.origin && event.source === win.parent && event.data?.type === 'fisher-language') {
            setLocale(event.data.locale);
        }
    };
    win.addEventListener('message', receive);
    return { setLocale, disconnect() { observer.disconnect(); win.removeEventListener('message', receive); } };
}
