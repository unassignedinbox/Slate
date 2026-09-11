//==========================================================================================
// Shell services — toasts, context menus, modal dialogs, HUD writers. Small, dependency free
// helpers used by every panel.
//==========================================================================================

export function toast(message, kind = 'info', ttl = 5200)
{
    const host = document.getElementById('toasts');
    if (!host)
    {
        return;
    }
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = message;
    host.appendChild(el);
    setTimeout(() => {
        el.style.transition = 'opacity .3s, transform .3s';
        el.style.opacity = '0';
        el.style.transform = 'translateY(6px)';
        setTimeout(() => el.remove(), 320);
    }, ttl);
}

export function showDialog({ title, text, actions })
{
    const overlay = document.getElementById('overlay');
    document.getElementById('overlayTitle').textContent = title;
    document.getElementById('overlayText').innerHTML = text;
    const host = document.getElementById('overlayActions');
    host.innerHTML = '';
    for (const action of actions || [])
    {
        const button = document.createElement('button');
        button.className = `btn ${action.primary ? 'primary' : ''}`;
        button.textContent = action.label;
        button.onclick = () => {
            if (action.keepOpen !== true)
            {
                hideDialog();
            }
            action.onClick?.();
        };
        host.appendChild(button);
    }
    overlay.classList.remove('hidden');
}

export function hideDialog()
{
    document.getElementById('overlay').classList.add('hidden');
}

export function setOverlayBusy(title, text)
{
    showDialog({ title, text, actions: [] });
}

// Context menu with optional search filtering. Returns a disposer.
export function contextMenu(x, y, items, options = {})
{
    const menu = document.getElementById('contextMenu');
    menu.innerHTML = '';
    menu.style.display = 'block';
    menu.style.left = '0px';
    menu.style.top = '0px';

    if (options.search)
    {
        const input = document.createElement('input');
        input.placeholder = options.searchPlaceholder || 'Search…';
        menu.appendChild(input);
        input.focus();
        input.oninput = () => render(input.value.toLowerCase());
        input.onkeydown = (event) => {
            if (event.key === 'Escape')
            {
                close();
            }
        };
        var render = (filter) => {
            for (const row of menu.querySelectorAll('[data-item]'))
            {
                row.style.display = row.dataset.item.toLowerCase().includes(filter) ? '' : 'none';
            }
        };
    }

    for (const item of items)
    {
        if (item.title)
        {
            const title = document.createElement('div');
            title.className = 'menu-title';
            title.textContent = item.title;
            menu.appendChild(title);
            continue;
        }
        const button = document.createElement('button');
        button.dataset.item = `${item.label} ${item.group || ''}`;
        button.innerHTML = `<span>${item.label}</span>${item.hint ? `<span class="hint">${item.hint}</span>` : ''}`;
        button.onclick = () => {
            close();
            item.onClick?.();
        };
        menu.appendChild(button);
    }

    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;

    const close = () => {
        menu.style.display = 'none';
        menu.innerHTML = '';
        window.removeEventListener('pointerdown', onOutside, true);
    };
    const onOutside = (event) => {
        if (!menu.contains(event.target))
        {
            close();
        }
    };
    setTimeout(() => window.addEventListener('pointerdown', onOutside, true), 0);
    return close;
}
export function formatNumber(value, digits = 1)
{
    if (!Number.isFinite(value))
    {
        return '—';
    }
    const abs = Math.abs(value);
    if (abs >= 1e9) return `${(value / 1e9).toFixed(digits)}B`;
    if (abs >= 1e6) return `${(value / 1e6).toFixed(digits)}M`;
    if (abs >= 1e4) return `${(value / 1e3).toFixed(digits)}k`;
    if (abs >= 100) return value.toFixed(0);
    if (abs >= 1) return value.toFixed(digits);
    return value.toFixed(3);
}

export function formatModelTime(seconds)
{
    const years = seconds / 31557600;
    if (years >= 1)
    {
        return `${years.toFixed(years >= 100 ? 0 : 2)} y`;
    }
    const days = seconds / 86400;
    if (days >= 1)
    {
        return `${days.toFixed(1)} d`;
    }
    const hours = seconds / 3600;
    return `${hours.toFixed(2)} h`;
}
