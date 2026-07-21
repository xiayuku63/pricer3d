const DEFAULT_SELECT_IDS = [
    'front-default-printer-model',
    'front-default-nozzle-diameter',
    'front-default-slicer-preset',
    'front-default-brand',
    'front-default-material',
    'batch-printer-model',
    'batch-nozzle-diameter',
    'batch-slicer-preset',
    'batch-brand',
    'batch-material',
];

const _instances = new Map();
let _globalBound = false;

function _getWrapperFromElement(element) {
    const direct = element?.closest?.('.styled-select-wrapper');
    if (direct) return direct;
    const list = element?.closest?.('.styled-select-list');
    return list?.__portalOrigin || null;
}

function _shouldPortalList(wrapper) {
    return Boolean(wrapper?.closest?.('#quote-default-settings-bar, #batch-edit-bar, #user-center-modal, #options-modal'));
}

function _resetListPosition(instance) {
    const { wrapper, list } = instance;
    list.style.position = '';
    list.style.left = '';
    list.style.right = '';
    list.style.top = '';
    list.style.bottom = '';
    list.style.marginTop = '';
    list.style.minWidth = '';
    list.style.maxWidth = '';
    list.style.width = '';
    list.style.maxHeight = '';
    if (list.__portalHost === document.body && list.__portalOrigin) {
        list.__portalOrigin.appendChild(list);
    }
    list.__portalHost = null;
    list.__portalOrigin = null;
    if (wrapper) {
        const width = Math.ceil(wrapper.getBoundingClientRect().width || wrapper.offsetWidth || 0);
        if (width > 0) {
            list.style.minWidth = `${width}px`;
        }
    }
}

function _positionList(instance) {
    const { wrapper, trigger, list } = instance;
    if (!_shouldPortalList(wrapper)) return;
    const rect = trigger.getBoundingClientRect();
    if (!rect.width) return;
    const viewportMaxWidth = Math.max(180, window.innerWidth - 16);
    const minWidth = Math.max(120, rect.width);

    if (list.parentElement !== document.body) {
        list.__portalOrigin = list.parentElement;
        document.body.appendChild(list);
        list.__portalHost = document.body;
    }

    list.style.position = 'fixed';
    list.style.marginTop = '0';
    list.style.minWidth = `${minWidth}px`;
    list.style.maxWidth = `${viewportMaxWidth}px`;
    list.style.right = '';
    list.style.width = 'max-content';
    list.style.left = '0px';
    list.style.top = '0px';
    list.style.bottom = '';
    list.style.maxHeight = '320px';

    const listRect = list.getBoundingClientRect();
    const listWidth = Math.min(Math.max(listRect.width, minWidth), viewportMaxWidth);
    const listHeight = Math.min(list.scrollHeight || listRect.height || 320, 320);
    const gap = 4;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - listWidth - 8));
    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const spaceAbove = rect.top - gap;
    const placeBelow = spaceBelow >= listHeight || spaceBelow >= spaceAbove;
    const availableHeight = Math.max(120, Math.min(listHeight, placeBelow ? spaceBelow : spaceAbove));

    list.style.zIndex = '100';
    list.style.width = `${listWidth}px`;
    list.style.maxHeight = `${availableHeight}px`;
    list.style.left = `${left}px`;
    if (placeBelow) {
        list.style.top = `${rect.bottom + gap}px`;
        list.style.bottom = '';
    } else {
        list.style.top = '';
        list.style.bottom = `${window.innerHeight - rect.top + gap}px`;
    }
}

function _labelForOption(option) {
    return String(option?.textContent || option?.label || option?.value || '').trim();
}

function _selectedOption(select) {
    return select?.selectedOptions?.[0] || select?.options?.[select.selectedIndex] || select?.options?.[0] || null;
}

function _syncInstance(instance) {
    const { select, trigger, label, list } = instance;
    const selected = _selectedOption(select);
    const selectedLabel = _labelForOption(selected);
    label.textContent = selectedLabel;
    trigger.title = selectedLabel;
    trigger.setAttribute('aria-disabled', select.disabled ? 'true' : 'false');
    trigger.classList.toggle('is-empty', !selectedLabel);
    list.querySelectorAll('.styled-select-item').forEach((item) => {
        const active = item.getAttribute('data-value') === String(select.value || '');
        item.classList.toggle('tw-dropdown-option-active', active);
        item.setAttribute('aria-selected', active ? 'true' : 'false');
    });
}

function _buildItems(instance) {
    const { select, list } = instance;
    list.innerHTML = '';
    Array.from(select.options || []).forEach((option) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'styled-select-item tw-dropdown-option';
        item.textContent = _labelForOption(option);
        item.dataset.value = option.value;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', option.value === select.value ? 'true' : 'false');
        if (option.disabled) item.disabled = true;
        list.appendChild(item);
    });
    _syncInstance(instance);
}

function _syncWrapperWidth(instance) {
    const width = Math.ceil(instance.select.getBoundingClientRect().width || instance.select.offsetWidth || 0);
    if (width > 0) {
        instance.wrapper.style.width = `${width}px`;
        instance.wrapper.style.minWidth = `${width}px`;
    }
}

function _closeInstance(instance) {
    if (instance.list.classList.contains('hidden')) return;
    _resetListPosition(instance);
    instance.list.classList.add('hidden');
    instance.trigger.setAttribute('aria-expanded', 'false');
    instance.wrapper.classList.remove('is-open');
}

function _closeAll(except) {
    _instances.forEach((instance) => {
        if (except && instance.wrapper === except) return;
        _closeInstance(instance);
    });
}

function _ensureGlobalHandlers() {
    if (_globalBound) return;
    _globalBound = true;

    document.addEventListener('click', (event) => {
        const item = event.target.closest('.styled-select-item');
        if (item) {
            event.stopPropagation();
            const wrapper = _getWrapperFromElement(item);
            const instance = wrapper ? _instances.get(wrapper.dataset.styledSelectId) : null;
            if (!instance) return;
            const nextValue = item.getAttribute('data-value');
            if (nextValue !== null && instance.select.value !== nextValue) {
                instance.select.value = nextValue;
                instance.select.dispatchEvent(new Event('change', { bubbles: true }));
            }
            _syncInstance(instance);
            _closeInstance(instance);
            instance.trigger.focus();
            return;
        }

        const trigger = event.target.closest('.styled-select-trigger');
        if (trigger) {
            event.stopPropagation();
            const wrapper = _getWrapperFromElement(trigger);
            const instance = wrapper ? _instances.get(wrapper.dataset.styledSelectId) : null;
            if (!instance || instance.select.disabled) return;
            const willOpen = instance.list.classList.contains('hidden');
            _closeAll(wrapper);
            if (willOpen) {
                instance.list.classList.remove('hidden');
                instance.trigger.setAttribute('aria-expanded', 'true');
                instance.wrapper.classList.add('is-open');
                _syncInstance(instance);
                _positionList(instance);
                const activeItem = instance.list.querySelector('.tw-dropdown-option-active:not([disabled])')
                    || instance.list.querySelector('.styled-select-item:not([disabled])');
                activeItem?.focus();
            } else {
                _closeInstance(instance);
            }
            return;
        }

        if (!event.target.closest('.styled-select-wrapper')) {
            _closeAll();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        _closeAll();
    });

    document.addEventListener('scroll', (event) => {
        if (event.target instanceof Element && event.target.closest('.styled-select-list')) {
            return;
        }
        _closeAll();
    }, true);
    window.addEventListener('resize', () => _closeAll());
}

function _enhanceSelect(select) {
    if (!select || select.dataset.styledSelectEnhanced === '1') return null;

    const measuredWidth = Math.ceil(select.getBoundingClientRect().width || select.offsetWidth || 0);
    const wrapper = document.createElement('div');
    wrapper.className = 'styled-select-wrapper';
    wrapper.dataset.styledSelectId = select.id || String(Math.random()).slice(2);
    select.dataset.styledSelectEnhanced = '1';
    select.setAttribute('aria-hidden', 'true');
    select.tabIndex = -1;

    const parent = select.parentNode;
    if (!parent) return null;
    parent.insertBefore(wrapper, select);
    wrapper.appendChild(select);
    if (measuredWidth > 0) {
        wrapper.style.width = `${measuredWidth}px`;
        wrapper.style.minWidth = `${measuredWidth}px`;
    }

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'styled-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', select.getAttribute('aria-label') || select.id || '选择项');
    trigger.innerHTML = '<span class="styled-select-label"></span><svg class="styled-select-chevron w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>';

    const list = document.createElement('div');
    list.className = 'styled-select-list tw-dropdown-panel hidden';
    list.setAttribute('role', 'listbox');

    wrapper.appendChild(trigger);
    wrapper.appendChild(list);

    const instance = { wrapper, select, trigger, list, label: trigger.querySelector('.styled-select-label') };
    _instances.set(wrapper.dataset.styledSelectId, instance);

    select.addEventListener('change', () => _syncInstance(instance));
    new MutationObserver(() => _buildItems(instance)).observe(select, { childList: true, subtree: true });

    _buildItems(instance);
    _syncWrapperWidth(instance);
    return instance;
}

export function initStyledSelectDropdowns(selectIds = DEFAULT_SELECT_IDS) {
    _ensureGlobalHandlers();
    selectIds.forEach((id) => {
        const select = document.getElementById(id);
        if (!select) return;
        _enhanceSelect(select);
    });
}

export function refreshStyledSelectDropdowns(selectIds = DEFAULT_SELECT_IDS) {
    selectIds.forEach((id) => {
        const select = document.getElementById(id);
        if (!select) return;
        const wrapper = select.closest('.styled-select-wrapper');
        const instance = wrapper ? _instances.get(wrapper.dataset.styledSelectId) : null;
        if (instance) {
            _buildItems(instance);
            _syncWrapperWidth(instance);
        }
    });
}
