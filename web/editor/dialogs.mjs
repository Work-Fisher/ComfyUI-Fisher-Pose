// 页面内自绘弹窗，替代浏览器原生的 prompt / confirm。
//
// 为什么要自己画：ComfyUI Desktop 跑在 Electron 上，而 Electron 不实现原生 prompt——
// 调用它不会弹窗，而是直接抛「Error: prompt() is not supported.」，保存姿势、保存身材
// 这类先要用户输入名字的流程会当场中断（表现为点保存没有任何反应）。原生 confirm/alert
// 虽然会弹，但同样取决于宿主实现（实测 Electron 40.4.1 会弹并挂起 JS，沙箱 iframe 里
// 会被静默吞掉）。统一换成页面内弹窗后，浏览器、Desktop、iframe 里行为完全一致。
//
// 用原生 <dialog> + showModal()：进入 top layer 不会被编辑器面板遮挡，自带 Esc 关闭与
// 焦点管理，而且不像原生弹窗那样阻塞 JS。
function open({ text, input = null, ok = '确定', cancel = '取消', danger = false }) {
    return new Promise(resolve => {
        const dialog = document.createElement('dialog');
        dialog.className = 'fp-dialog' + (danger ? ' fp-dialog-danger' : '');
        const box = document.createElement('div');
        box.className = 'fp-dialog-box';
        const message = document.createElement('p');
        message.className = 'fp-dialog-text';
        message.textContent = text;
        box.append(message);
        let field = null;
        if (input != null) {
            field = document.createElement('input');
            field.type = 'text';
            field.className = 'fp-dialog-input';
            field.value = input;
            box.append(field);
        }
        const actions = document.createElement('div');
        actions.className = 'fp-dialog-actions';
        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'fp-dialog-cancel';
        cancelButton.textContent = cancel;
        const okButton = document.createElement('button');
        okButton.type = 'button';
        okButton.className = 'fp-dialog-ok';
        okButton.textContent = ok;
        actions.append(cancelButton, okButton);
        box.append(actions);
        dialog.append(box);
        document.body.append(dialog);
        let settled = false;
        const finish = value => {
            if (settled) return;
            settled = true;
            if (dialog.open) dialog.close();
            dialog.remove();
            resolve(value);
        };
        // 取消的返回值与原生保持一致：prompt 取消给 null，confirm 取消给 false。
        const dismissed = () => finish(input != null ? null : false);
        cancelButton.onclick = dismissed;
        okButton.onclick = () => finish(input != null ? field.value.trim() : true);
        // Esc 走 cancel 事件，点遮罩命中的是 dialog 自身；两者都按取消算。
        dialog.addEventListener('cancel', event => { event.preventDefault(); dismissed(); });
        dialog.addEventListener('click', event => { if (event.target === dialog) dismissed(); });
        if (field) field.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); okButton.click(); } });
        dialog.showModal();
        if (field) { field.focus(); field.select(); } else okButton.focus();
    });
}

// 参数与原生 prompt 对齐（第二个参数是预填文本），取消返回 null。
export const askText = (text, value = '') => open({ text, input: value });

// danger=true 的确认（删除 / 清空）用红色确认键。
export const askConfirm = (text, { ok = '确定', danger = false } = {}) => open({ text, ok, danger });
