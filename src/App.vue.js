import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open, save } from '@tauri-apps/plugin-dialog';
const requiredColumns = ['name', 'modified', 'created', 'kind', 'size', 'path', 'comments', 'tags', 'title', 'md5', 'sha256'];
const optionalColumns = ['version', 'pages', 'authors', 'album', 'trackNo', 'genre', 'year', 'duration', 'audioBitRate', 'audioSampleRate', 'audioChannels', 'dimensions', 'pixelWidth', 'pixelHeight', 'cameraMake', 'cameraModelName', 'dateTaken', 'iso', 'fNumber', 'focalLength', 'latitude', 'longitude', 'mapsUrl'];
const defaultVisibleColumns = ['name', 'modified', 'kind', 'size', 'path', 'comments', 'tags', 'title', 'md5', 'sha256'];
const columnLabels = {
    name: 'اسم الملف', modified: 'تاريخ التعديل', created: 'تاريخ الإنشاء', kind: 'النوع', size: 'الحجم', path: 'المسار',
    comments: 'التعليقات', tags: 'الوسوم', title: 'العنوان', md5: 'MD5', sha256: 'SHA-256', version: 'الإصدار', pages: 'الصفحات',
    authors: 'المؤلفون / الفنان', album: 'الألبوم', trackNo: 'رقم المسار', genre: 'النوع الموسيقي', year: 'السنة', duration: 'المدة',
    audioBitRate: 'معدل بت الصوت', audioSampleRate: 'معدل عينات الصوت', audioChannels: 'قنوات الصوت', dimensions: 'الأبعاد',
    pixelWidth: 'عرض البكسل', pixelHeight: 'ارتفاع البكسل', cameraMake: 'صانع الكاميرا', cameraModelName: 'طراز الكاميرا',
    dateTaken: 'تاريخ الالتقاط', iso: 'ISO', fNumber: 'F-Number', focalLength: 'البعد البؤري', latitude: 'خط العرض', longitude: 'خط الطول', mapsUrl: 'رابط الخرائط'
};
const rows = ref([]);
const selectedIds = ref(new Set());
const visibleColumns = ref([...defaultVisibleColumns]);
const includeSubfolders = ref(true);
const typeFilter = ref('all');
const customExtension = ref('');
const search = ref('');
const sortBy = ref('name');
const sortAscending = ref(true);
const state = ref('idle');
const statusMessage = ref('اختر مجلدًا أو اسحب ملفات ومجلدات إلى منطقة الإسقاط للبدء.');
const errors = ref([]);
const isColumnPanelOpen = ref(false);
const isBusy = computed(() => state.value === 'scanning');
const hashProgress = ref({ current: 0, total: 0 });
let stopDragListener;
const editableColumns = new Set(['name', 'comments', 'tags', 'title']);
const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'svg', 'raw', 'cr2', 'nef', 'arw']);
const videoExtensions = new Set(['mp4', 'mov', 'mkv', 'avi', 'webm', 'wmv', 'm4v', 'mpeg', 'mpg']);
const audioExtensions = new Set(['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'wma', 'aiff']);
const filteredRows = computed(() => {
    const needle = search.value.trim().toLocaleLowerCase();
    const custom = normalizeExtension(customExtension.value);
    const filtered = rows.value.filter((row) => {
        const extension = row.kind.toLocaleLowerCase();
        const matchesType = typeFilter.value === 'all'
            || (typeFilter.value === 'images' && imageExtensions.has(extension))
            || (typeFilter.value === 'videos' && videoExtensions.has(extension))
            || (typeFilter.value === 'audio' && audioExtensions.has(extension))
            || (typeFilter.value === 'pdf' && extension === 'pdf')
            || (typeFilter.value === 'custom' && custom.length > 0 && extension === custom);
        const matchesSearch = needle.length === 0 || row.name.toLocaleLowerCase().includes(needle) || row.path.toLocaleLowerCase().includes(needle);
        return matchesType && matchesSearch;
    });
    return [...filtered].sort((a, b) => compareRows(a, b, sortBy.value) * (sortAscending.value ? 1 : -1));
});
const selectedVisibleCount = computed(() => filteredRows.value.filter((row) => selectedIds.value.has(row.id)).length);
const allVisibleSelected = computed(() => filteredRows.value.length > 0 && filteredRows.value.every((row) => selectedIds.value.has(row.id)));
const statusTone = computed(() => state.value === 'error' ? 'danger' : state.value === 'completed' ? 'success' : state.value === 'scanning' ? 'working' : 'neutral');
function normalizeExtension(value) {
    const cleaned = value.trim().toLocaleLowerCase();
    return cleaned.startsWith('.') ? cleaned.slice(1) : cleaned;
}
function compareRows(a, b, key) {
    if (key === 'size')
        return a.size - b.size;
    if (key === 'modified' || key === 'created')
        return String(a[key]).localeCompare(String(b[key]));
    return String(cellValue(a, key)).localeCompare(String(cellValue(b, key)), undefined, { numeric: true, sensitivity: 'base' });
}
function cellValue(row, column) {
    if (column in row)
        return row[column];
    return '';
}
function formatSize(size) {
    if (size === 0)
        return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
    return `${(size / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}
function displayValue(row, column) {
    const value = cellValue(row, column);
    return column === 'size' ? formatSize(Number(value)) : String(value);
}
function toggleSort(column) {
    if (sortBy.value === column)
        sortAscending.value = !sortAscending.value;
    else {
        sortBy.value = column;
        sortAscending.value = true;
    }
}
function toggleColumn(column) {
    if (visibleColumns.value.includes(column))
        visibleColumns.value = visibleColumns.value.filter((item) => item !== column);
    else
        visibleColumns.value = [...visibleColumns.value, column];
    localStorage.setItem('file-list-studio-columns', JSON.stringify(visibleColumns.value));
}
function toggleRow(id) {
    const next = new Set(selectedIds.value);
    if (next.has(id))
        next.delete(id);
    else
        next.add(id);
    selectedIds.value = next;
}
function toggleAllVisible() {
    const next = new Set(selectedIds.value);
    if (allVisibleSelected.value)
        filteredRows.value.forEach((row) => next.delete(row.id));
    else
        filteredRows.value.forEach((row) => next.add(row.id));
    selectedIds.value = next;
}
function updateField(row, column, value) {
    if (editableColumns.has(column))
        row[column] = value;
}
function statusForScan(response, sourceCount) {
    rows.value = response.entries;
    selectedIds.value = new Set();
    errors.value = response.errors;
    state.value = response.errors.length > 0 && response.entries.length === 0 ? 'error' : 'completed';
    statusMessage.value = `اكتمل الفحص: ${response.entries.length.toLocaleString()} سجل${sourceCount > 1 ? ` من ${sourceCount} مسارات` : ''}.`;
    if (response.errors.length > 0)
        statusMessage.value += ` تعذر الوصول إلى ${response.errors.length} عنصر.`;
}
async function startScan(paths) {
    if (paths.length === 0 || isBusy.value)
        return;
    state.value = 'scanning';
    errors.value = [];
    hashProgress.value = { current: 0, total: 0 };
    statusMessage.value = 'جارٍ فحص الملفات والمجلدات من خلال النظام…';
    try {
        const response = await invoke('scan_entries', { paths, recursive: includeSubfolders.value });
        statusForScan(response, paths.length);
    }
    catch (error) {
        state.value = 'error';
        statusMessage.value = `فشل الفحص: ${String(error)}`;
        errors.value = [String(error)];
    }
}
async function chooseFolder() {
    const selected = await open({ directory: true, multiple: false, title: 'اختر مجلدًا للفحص' });
    if (typeof selected === 'string')
        await startScan([selected]);
}
async function calculateHashes() {
    if (isBusy.value)
        return;
    const targets = rows.value.filter((row) => row.kind !== 'Folder' && (selectedIds.value.size === 0 ? filteredRows.value.some((item) => item.id === row.id) : selectedIds.value.has(row.id)));
    if (targets.length === 0) {
        statusMessage.value = 'لا توجد ملفات مؤهلة لحساب البصمات في النطاق الحالي.';
        return;
    }
    state.value = 'scanning';
    errors.value = [];
    hashProgress.value = { current: 0, total: targets.length };
    statusMessage.value = `جارٍ حساب البصمات: 0 من ${targets.length}…`;
    for (const [index, row] of targets.entries()) {
        try {
            const result = await invoke('calculate_hashes', { paths: [row.path] });
            const item = result[0];
            if (item?.error)
                errors.value.push(`${row.path}: ${item.error}`);
            else if (item) {
                row.md5 = item.md5;
                row.sha256 = item.sha256;
            }
        }
        catch (error) {
            errors.value.push(`${row.path}: ${String(error)}`);
        }
        hashProgress.value = { current: index + 1, total: targets.length };
        statusMessage.value = `جارٍ حساب البصمات: ${index + 1} من ${targets.length}…`;
    }
    state.value = errors.value.length > 0 ? 'error' : 'completed';
    statusMessage.value = `اكتمل حساب البصمات لـ ${targets.length} ملف${errors.value.length ? ` مع ${errors.value.length} أخطاء` : ''}.`;
}
function csvEscape(value) {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
async function exportCsv() {
    if (filteredRows.value.length === 0 || visibleColumns.value.length === 0) {
        statusMessage.value = 'لا توجد بيانات أو أعمدة مرئية للتصدير.';
        return;
    }
    const selectedPath = await save({ title: 'احفظ قائمة الملفات', defaultPath: 'file-list.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (!selectedPath)
        return;
    const header = visibleColumns.value.map((column) => csvEscape(columnLabels[column])).join(',');
    const body = filteredRows.value.map((row) => visibleColumns.value.map((column) => csvEscape(displayValue(row, column))).join(',')).join('\r\n');
    const content = `\uFEFF${header}\r\n${body}\r\n`;
    try {
        await invoke('save_csv', { path: selectedPath, content });
        statusMessage.value = `تم تصدير ${filteredRows.value.length.toLocaleString()} سجل إلى ${selectedPath}.`;
    }
    catch (error) {
        state.value = 'error';
        statusMessage.value = `فشل حفظ CSV: ${String(error)}`;
        errors.value = [String(error)];
    }
}
function clearRows() {
    rows.value = [];
    selectedIds.value = new Set();
    state.value = 'idle';
    errors.value = [];
    statusMessage.value = 'تم مسح النتائج.';
}
function handleInputDrop(paths) {
    if (paths.length > 0)
        void startScan(paths);
}
onMounted(async () => {
    const stored = localStorage.getItem('file-list-studio-columns');
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            visibleColumns.value = parsed.filter((column) => requiredColumns.includes(column) || optionalColumns.includes(column));
        }
        catch { /* Use defaults when storage is invalid. */ }
    }
    const window = getCurrentWindow();
    const unlisten = await window.onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === 'drop' && payload.paths)
            handleInputDrop(payload.paths);
    });
    stopDragListener = unlisten;
});
onBeforeUnmount(() => stopDragListener?.());
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
__VLS_asFunctionalElement(__VLS_intrinsicElements.main, __VLS_intrinsicElements.main)({
    ...{ class: "shell" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.header, __VLS_intrinsicElements.header)({
    ...{ class: "app-header" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
    ...{ class: "eyebrow" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.h1, __VLS_intrinsicElements.h1)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
    ...{ class: "subtitle" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "header-actions" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "state-pill" },
    ...{ class: (`state-${__VLS_ctx.statusTone}`) },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span)({
    ...{ class: "state-dot" },
});
(__VLS_ctx.state === 'idle' ? 'جاهز' : __VLS_ctx.state === 'scanning' ? 'قيد التنفيذ' : __VLS_ctx.state === 'completed' ? 'مكتمل' : 'يحتاج مراجعة');
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (__VLS_ctx.clearRows) },
    ...{ class: "button secondary" },
    disabled: (__VLS_ctx.isBusy),
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
    ...{ class: "toolbar card" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "toolbar-actions" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (__VLS_ctx.chooseFolder) },
    ...{ class: "button primary" },
    disabled: (__VLS_ctx.isBusy),
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "button-icon" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (__VLS_ctx.calculateHashes) },
    ...{ class: "button secondary" },
    disabled: (__VLS_ctx.isBusy || __VLS_ctx.rows.length === 0),
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "button-icon" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (__VLS_ctx.exportCsv) },
    ...{ class: "button secondary" },
    disabled: (__VLS_ctx.isBusy || __VLS_ctx.filteredRows.length === 0),
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "button-icon" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({
    ...{ class: "toggle-control" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
    type: "checkbox",
});
(__VLS_ctx.includeSubfolders);
__VLS_asFunctionalElement(__VLS_intrinsicElements.span)({
    ...{ class: "toggle" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
    ...{ class: "drop-zone card" },
    ...{ class: ({ 'is-busy': __VLS_ctx.isBusy }) },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "drop-icon" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.strong, __VLS_intrinsicElements.strong)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "drop-hint" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
    ...{ class: "filters card" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "section-heading" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
    ...{ class: "eyebrow" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.h2, __VLS_intrinsicElements.h2)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "record-count" },
});
(__VLS_ctx.filteredRows.length.toLocaleString());
(__VLS_ctx.rows.length.toLocaleString());
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "filter-grid" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({
    ...{ class: "field" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.select, __VLS_intrinsicElements.select)({
    value: (__VLS_ctx.typeFilter),
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
    value: "all",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
    value: "images",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
    value: "videos",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
    value: "audio",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
    value: "pdf",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
    value: "custom",
});
if (__VLS_ctx.typeFilter === 'custom') {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({
        ...{ class: "field" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
        placeholder: "مثال: .zip",
    });
    (__VLS_ctx.customExtension);
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({
    ...{ class: "field search-field" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
    placeholder: "اكتب للبحث…",
});
(__VLS_ctx.search);
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "search-mark" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
    ...{ class: "table-card card" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "table-toolbar" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "table-summary" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.strong, __VLS_intrinsicElements.strong)({});
(__VLS_ctx.filteredRows.length.toLocaleString());
if (__VLS_ctx.selectedVisibleCount > 0) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
    (__VLS_ctx.selectedVisibleCount);
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "table-actions" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (...[$event]) => {
            __VLS_ctx.isColumnPanelOpen = !__VLS_ctx.isColumnPanelOpen;
        } },
    ...{ class: "link-button" },
});
(__VLS_ctx.visibleColumns.length);
if (__VLS_ctx.isColumnPanelOpen) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "column-panel" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "column-panel-header" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.strong, __VLS_intrinsicElements.strong)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.isColumnPanelOpen))
                    return;
                __VLS_ctx.isColumnPanelOpen = false;
            } },
        ...{ class: "link-button" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "column-options" },
    });
    for (const [column] of __VLS_getVForSourceType(([...__VLS_ctx.requiredColumns, ...__VLS_ctx.optionalColumns]))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({
            key: (column),
            ...{ class: "column-option" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
            ...{ onChange: (...[$event]) => {
                    if (!(__VLS_ctx.isColumnPanelOpen))
                        return;
                    __VLS_ctx.toggleColumn(column);
                } },
            type: "checkbox",
            checked: (__VLS_ctx.visibleColumns.includes(column)),
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
        (__VLS_ctx.columnLabels[column]);
        if (__VLS_ctx.optionalColumns.includes(column)) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.small, __VLS_intrinsicElements.small)({});
        }
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
        ...{ class: "panel-note" },
    });
}
if (__VLS_ctx.rows.length === 0) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "empty-state" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "empty-icon" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({});
}
else if (__VLS_ctx.filteredRows.length === 0) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "empty-state" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "empty-icon" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({});
}
else {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "table-wrap" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.table, __VLS_intrinsicElements.table)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.thead, __VLS_intrinsicElements.thead)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.tr, __VLS_intrinsicElements.tr)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.th, __VLS_intrinsicElements.th)({
        ...{ class: "selection-cell" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
        ...{ onChange: (__VLS_ctx.toggleAllVisible) },
        type: "checkbox",
        checked: (__VLS_ctx.allVisibleSelected),
    });
    for (const [column] of __VLS_getVForSourceType((__VLS_ctx.visibleColumns))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.th, __VLS_intrinsicElements.th)({
            ...{ onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.rows.length === 0))
                        return;
                    if (!!(__VLS_ctx.filteredRows.length === 0))
                        return;
                    ['name', 'size', 'modified'].includes(column) && __VLS_ctx.toggleSort(column);
                } },
            key: (column),
            ...{ class: ({ sortable: ['name', 'size', 'modified'].includes(column) }) },
        });
        (__VLS_ctx.columnLabels[column]);
        if (__VLS_ctx.sortBy === column) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "sort-mark" },
            });
            (__VLS_ctx.sortAscending ? '↑' : '↓');
        }
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.tbody, __VLS_intrinsicElements.tbody)({});
    for (const [row] of __VLS_getVForSourceType((__VLS_ctx.filteredRows))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.tr, __VLS_intrinsicElements.tr)({
            key: (row.id),
            ...{ class: ({ selected: __VLS_ctx.selectedIds.has(row.id) }) },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.td, __VLS_intrinsicElements.td)({
            ...{ class: "selection-cell" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
            ...{ onChange: (...[$event]) => {
                    if (!!(__VLS_ctx.rows.length === 0))
                        return;
                    if (!!(__VLS_ctx.filteredRows.length === 0))
                        return;
                    __VLS_ctx.toggleRow(row.id);
                } },
            type: "checkbox",
            checked: (__VLS_ctx.selectedIds.has(row.id)),
        });
        for (const [column] of __VLS_getVForSourceType((__VLS_ctx.visibleColumns))) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.td, __VLS_intrinsicElements.td)({
                key: (column),
                ...{ class: (`cell-${column}`) },
            });
            if (__VLS_ctx.editableColumns.has(column)) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
                    ...{ onInput: (...[$event]) => {
                            if (!!(__VLS_ctx.rows.length === 0))
                                return;
                            if (!!(__VLS_ctx.filteredRows.length === 0))
                                return;
                            if (!(__VLS_ctx.editableColumns.has(column)))
                                return;
                            __VLS_ctx.updateField(row, column, $event.target.value);
                        } },
                    ...{ class: "cell-input" },
                    value: (__VLS_ctx.displayValue(row, column)),
                });
            }
            else {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                    title: (__VLS_ctx.displayValue(row, column)),
                });
                (__VLS_ctx.displayValue(row, column) || '—');
            }
        }
    }
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
    ...{ class: "status-card card" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "status-top" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
    ...{ class: "eyebrow" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.h2, __VLS_intrinsicElements.h2)({});
if (__VLS_ctx.hashProgress.total > 0) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "progress-label" },
    });
    (__VLS_ctx.hashProgress.current);
    (__VLS_ctx.hashProgress.total);
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
    ...{ class: "status-message" },
});
(__VLS_ctx.statusMessage);
if (__VLS_ctx.hashProgress.total > 0) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "progress-track" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span)({
        ...{ style: ({ width: `${(__VLS_ctx.hashProgress.current / __VLS_ctx.hashProgress.total) * 100}%` }) },
    });
}
if (__VLS_ctx.errors.length > 0) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "errors" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.strong, __VLS_intrinsicElements.strong)({});
    (__VLS_ctx.errors.length);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.details, __VLS_intrinsicElements.details)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.summary, __VLS_intrinsicElements.summary)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.ul, __VLS_intrinsicElements.ul)({});
    for (const [error] of __VLS_getVForSourceType((__VLS_ctx.errors.slice(0, 20)))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.li, __VLS_intrinsicElements.li)({
            key: (error),
        });
        (error);
    }
    if (__VLS_ctx.errors.length > 20) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({});
        (__VLS_ctx.errors.length - 20);
    }
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.footer, __VLS_intrinsicElements.footer)({});
/** @type {__VLS_StyleScopedClasses['shell']} */ ;
/** @type {__VLS_StyleScopedClasses['app-header']} */ ;
/** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
/** @type {__VLS_StyleScopedClasses['subtitle']} */ ;
/** @type {__VLS_StyleScopedClasses['header-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['state-pill']} */ ;
/** @type {__VLS_StyleScopedClasses['state-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['button']} */ ;
/** @type {__VLS_StyleScopedClasses['secondary']} */ ;
/** @type {__VLS_StyleScopedClasses['toolbar']} */ ;
/** @type {__VLS_StyleScopedClasses['card']} */ ;
/** @type {__VLS_StyleScopedClasses['toolbar-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['button']} */ ;
/** @type {__VLS_StyleScopedClasses['primary']} */ ;
/** @type {__VLS_StyleScopedClasses['button-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['button']} */ ;
/** @type {__VLS_StyleScopedClasses['secondary']} */ ;
/** @type {__VLS_StyleScopedClasses['button-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['button']} */ ;
/** @type {__VLS_StyleScopedClasses['secondary']} */ ;
/** @type {__VLS_StyleScopedClasses['button-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['toggle-control']} */ ;
/** @type {__VLS_StyleScopedClasses['toggle']} */ ;
/** @type {__VLS_StyleScopedClasses['drop-zone']} */ ;
/** @type {__VLS_StyleScopedClasses['card']} */ ;
/** @type {__VLS_StyleScopedClasses['is-busy']} */ ;
/** @type {__VLS_StyleScopedClasses['drop-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['drop-hint']} */ ;
/** @type {__VLS_StyleScopedClasses['filters']} */ ;
/** @type {__VLS_StyleScopedClasses['card']} */ ;
/** @type {__VLS_StyleScopedClasses['section-heading']} */ ;
/** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
/** @type {__VLS_StyleScopedClasses['record-count']} */ ;
/** @type {__VLS_StyleScopedClasses['filter-grid']} */ ;
/** @type {__VLS_StyleScopedClasses['field']} */ ;
/** @type {__VLS_StyleScopedClasses['field']} */ ;
/** @type {__VLS_StyleScopedClasses['field']} */ ;
/** @type {__VLS_StyleScopedClasses['search-field']} */ ;
/** @type {__VLS_StyleScopedClasses['search-mark']} */ ;
/** @type {__VLS_StyleScopedClasses['table-card']} */ ;
/** @type {__VLS_StyleScopedClasses['card']} */ ;
/** @type {__VLS_StyleScopedClasses['table-toolbar']} */ ;
/** @type {__VLS_StyleScopedClasses['table-summary']} */ ;
/** @type {__VLS_StyleScopedClasses['table-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['link-button']} */ ;
/** @type {__VLS_StyleScopedClasses['column-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['column-panel-header']} */ ;
/** @type {__VLS_StyleScopedClasses['link-button']} */ ;
/** @type {__VLS_StyleScopedClasses['column-options']} */ ;
/** @type {__VLS_StyleScopedClasses['column-option']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-note']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-state']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-state']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['table-wrap']} */ ;
/** @type {__VLS_StyleScopedClasses['selection-cell']} */ ;
/** @type {__VLS_StyleScopedClasses['sortable']} */ ;
/** @type {__VLS_StyleScopedClasses['sort-mark']} */ ;
/** @type {__VLS_StyleScopedClasses['selected']} */ ;
/** @type {__VLS_StyleScopedClasses['selection-cell']} */ ;
/** @type {__VLS_StyleScopedClasses['cell-input']} */ ;
/** @type {__VLS_StyleScopedClasses['status-card']} */ ;
/** @type {__VLS_StyleScopedClasses['card']} */ ;
/** @type {__VLS_StyleScopedClasses['status-top']} */ ;
/** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
/** @type {__VLS_StyleScopedClasses['progress-label']} */ ;
/** @type {__VLS_StyleScopedClasses['status-message']} */ ;
/** @type {__VLS_StyleScopedClasses['progress-track']} */ ;
/** @type {__VLS_StyleScopedClasses['errors']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            requiredColumns: requiredColumns,
            optionalColumns: optionalColumns,
            columnLabels: columnLabels,
            rows: rows,
            selectedIds: selectedIds,
            visibleColumns: visibleColumns,
            includeSubfolders: includeSubfolders,
            typeFilter: typeFilter,
            customExtension: customExtension,
            search: search,
            sortBy: sortBy,
            sortAscending: sortAscending,
            state: state,
            statusMessage: statusMessage,
            errors: errors,
            isColumnPanelOpen: isColumnPanelOpen,
            isBusy: isBusy,
            hashProgress: hashProgress,
            editableColumns: editableColumns,
            filteredRows: filteredRows,
            selectedVisibleCount: selectedVisibleCount,
            allVisibleSelected: allVisibleSelected,
            statusTone: statusTone,
            displayValue: displayValue,
            toggleSort: toggleSort,
            toggleColumn: toggleColumn,
            toggleRow: toggleRow,
            toggleAllVisible: toggleAllVisible,
            updateField: updateField,
            chooseFolder: chooseFolder,
            calculateHashes: calculateHashes,
            exportCsv: exportCsv,
            clearRows: clearRows,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
