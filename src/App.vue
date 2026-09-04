<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open, save } from '@tauri-apps/plugin-dialog'
import { listen } from '@tauri-apps/api/event'

type ScanState = 'idle' | 'scanning' | 'completed' | 'error'
type TypeFilter = 'all' | 'images' | 'videos' | 'audio' | 'pdf' | 'custom'
type ColumnKey =
  | 'name' | 'modified' | 'created' | 'kind' | 'size' | 'path' | 'comments' | 'tags' | 'title'
  | 'md5' | 'sha256' | 'version' | 'pages' | 'authors' | 'album' | 'trackNo' | 'genre' | 'year'
  | 'duration' | 'audioBitRate' | 'audioSampleRate' | 'audioChannels' | 'dimensions' | 'pixelWidth'
  | 'pixelHeight' | 'cameraMake' | 'cameraModelName' | 'dateTaken' | 'iso' | 'fNumber' | 'focalLength'
  | 'latitude' | 'longitude' | 'mapsUrl' | 'thumbnail' | 'width' | 'height' | 'bitRate' | 'sampleRate'
  | 'channels' | 'cameraModel' | 'fNumber' | 'album' | 'artist'

interface FileEntry {
  id: string
  name: string
  modified: string
  created: string
  kind: string
  size: number
  path: string
  comments: string
  tags: string
  title: string
  md5: string
  sha256: string
  thumbnail: string
  width: string
  height: string
  duration: string
  bitRate: string
  sampleRate: string
  channels: string
  cameraMake: string
  cameraModel: string
  dateTaken: string
  iso: string
  fNumber: string
  focalLength: string
  latitude: string
  longitude: string
  album: string
  artist: string
}

interface ScanResponse {
  entries: FileEntry[]
  errors: string[]
  cancelled: boolean
}

interface HashResult {
  path: string
  md5: string
  sha256: string
  error: string | null
}

interface ProgressEvent {
  jobId: string
  current: number
  total: number
  stage: string
  path: string
  cancelled: boolean
}

const requiredColumns: ColumnKey[] = ['name', 'modified', 'created', 'kind', 'size', 'path', 'comments', 'tags', 'title', 'md5', 'sha256']
const optionalColumns: ColumnKey[] = ['thumbnail', 'width', 'height', 'duration', 'bitRate', 'sampleRate', 'channels', 'cameraMake', 'cameraModel', 'dateTaken', 'iso', 'fNumber', 'focalLength', 'album', 'artist', 'version', 'pages', 'authors', 'trackNo', 'genre', 'year', 'audioBitRate', 'audioSampleRate', 'audioChannels', 'dimensions', 'pixelWidth', 'pixelHeight', 'cameraModelName', 'latitude', 'longitude', 'mapsUrl']
const defaultVisibleColumns: ColumnKey[] = ['name', 'modified', 'kind', 'size', 'path', 'comments', 'tags', 'title', 'md5', 'sha256']

const columnLabelsEn: Partial<Record<ColumnKey, string>> = { name: 'File name', modified: 'Modified', created: 'Created', kind: 'Type', size: 'Size', path: 'Path', comments: 'Comments', tags: 'Tags', title: 'Title', md5: 'MD5', sha256: 'SHA-256', thumbnail: 'Preview', width: 'Width', height: 'Height', duration: 'Duration', bitRate: 'Bit rate', sampleRate: 'Sample rate', channels: 'Channels', cameraMake: 'Camera make', cameraModel: 'Camera model', dateTaken: 'Date taken', iso: 'ISO', fNumber: 'F-Number', focalLength: 'Focal length', latitude: 'Latitude', longitude: 'Longitude', album: 'Album', artist: 'Artist' }
const columnLabels: Record<ColumnKey, string> = {
  name: 'اسم الملف', modified: 'تاريخ التعديل', created: 'تاريخ الإنشاء', kind: 'النوع', size: 'الحجم', path: 'المسار',
  comments: 'التعليقات', tags: 'الوسوم', title: 'العنوان', md5: 'MD5', sha256: 'SHA-256', version: 'الإصدار', pages: 'الصفحات',
  authors: 'المؤلفون / الفنان', album: 'الألبوم', trackNo: 'رقم المسار', genre: 'النوع الموسيقي', year: 'السنة', duration: 'المدة',
  audioBitRate: 'معدل بت الصوت', audioSampleRate: 'معدل عينات الصوت', audioChannels: 'قنوات الصوت', dimensions: 'الأبعاد',
  pixelWidth: 'عرض البكسل', pixelHeight: 'ارتفاع البكسل', cameraMake: 'صانع الكاميرا', cameraModelName: 'طراز الكاميرا',
  dateTaken: 'تاريخ الالتقاط', iso: 'ISO', fNumber: 'F-Number', focalLength: 'البعد البؤري', latitude: 'خط العرض', longitude: 'خط الطول', mapsUrl: 'رابط الخرائط', thumbnail: 'معاينة', width: 'العرض', height: 'الارتفاع', bitRate: 'معدل البت', sampleRate: 'معدل العينات', channels: 'القنوات', cameraModel: 'طراز الكاميرا', artist: 'الفنان'
}

function localizedColumnLabel(column: ColumnKey): string { return language.value === 'en' ? (columnLabelsEn[column] ?? columnLabels[column]) : columnLabels[column] }
const copy = { ar: { title: 'منشئ قوائم الملفات', subtitle: 'افحص الملفات المحلية، حرّر بياناتها، واحفظ قائمة منظمة.', choose: 'اختيار مجلد', hashes: 'حساب البصمات', csv: 'تصدير CSV', xlsx: 'تصدير XLSX', save: 'حفظ مشروع', load: 'فتح مشروع', clear: 'مسح النتائج', cancel: 'إلغاء العملية', status: 'حالة العملية', filters: 'تصفية النتائج' }, en: { title: 'File List Studio', subtitle: 'Scan local files, enrich metadata, and export an organized catalog.', choose: 'Choose folder', hashes: 'Calculate hashes', csv: 'Export CSV', xlsx: 'Export XLSX', save: 'Save project', load: 'Open project', clear: 'Clear results', cancel: 'Cancel operation', status: 'Operation status', filters: 'Filter results' } } as const
function t(key: keyof typeof copy.ar): string { return copy[language.value][key] }

const rows = ref<FileEntry[]>([])
const selectedIds = ref<Set<string>>(new Set())
const visibleColumns = ref<ColumnKey[]>([...defaultVisibleColumns])
const includeSubfolders = ref(true)
const typeFilter = ref<TypeFilter>('all')
const customExtension = ref('')
const search = ref('')
const sortBy = ref<ColumnKey>('name')
const sortAscending = ref(true)
const state = ref<ScanState>('idle')
const statusMessage = ref('اختر مجلدًا أو اسحب ملفات ومجلدات إلى منطقة الإسقاط للبدء.')
const errors = ref<string[]>([])
const isColumnPanelOpen = ref(false)
const isBusy = computed(() => state.value === 'scanning')
const hashProgress = ref({ current: 0, total: 0 })
const scanProgress = ref({ current: 0, total: 0, path: '', stage: '' })
const excludedDirs = ref('')
const excludedExtensions = ref('')
const language = ref<'ar' | 'en'>('ar')
const currentJobId = ref('')
let stopDragListener: (() => void) | undefined
let stopScanProgress: (() => void) | undefined
let stopHashProgress: (() => void) | undefined

const editableColumns = new Set<ColumnKey>(['name', 'comments', 'tags', 'title'])
const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'svg', 'raw', 'cr2', 'nef', 'arw'])
const videoExtensions = new Set(['mp4', 'mov', 'mkv', 'avi', 'webm', 'wmv', 'm4v', 'mpeg', 'mpg'])
const audioExtensions = new Set(['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'wma', 'aiff'])

const filteredRows = computed(() => {
  const needle = search.value.trim().toLocaleLowerCase()
  const custom = normalizeExtension(customExtension.value)
  const filtered = rows.value.filter((row) => {
    const extension = row.kind.toLocaleLowerCase()
    const matchesType = typeFilter.value === 'all'
      || (typeFilter.value === 'images' && imageExtensions.has(extension))
      || (typeFilter.value === 'videos' && videoExtensions.has(extension))
      || (typeFilter.value === 'audio' && audioExtensions.has(extension))
      || (typeFilter.value === 'pdf' && extension === 'pdf')
      || (typeFilter.value === 'custom' && custom.length > 0 && extension === custom)
    const matchesSearch = needle.length === 0 || row.name.toLocaleLowerCase().includes(needle) || row.path.toLocaleLowerCase().includes(needle)
    return matchesType && matchesSearch
  })
  return [...filtered].sort((a, b) => compareRows(a, b, sortBy.value) * (sortAscending.value ? 1 : -1))
})

const selectedVisibleCount = computed(() => filteredRows.value.filter((row) => selectedIds.value.has(row.id)).length)
const allVisibleSelected = computed(() => filteredRows.value.length > 0 && filteredRows.value.every((row) => selectedIds.value.has(row.id)))
const statusTone = computed(() => state.value === 'error' ? 'danger' : state.value === 'completed' ? 'success' : state.value === 'scanning' ? 'working' : 'neutral')
const activeProgress = computed(() => scanProgress.value.total > 0 && hashProgress.value.total === 0 ? scanProgress.value : hashProgress.value)
const progressPercent = computed(() => activeProgress.value.total > 0 ? Math.min(100, Math.round(activeProgress.value.current / activeProgress.value.total * 100)) : 0)

function normalizeExtension(value: string): string {
  const cleaned = value.trim().toLocaleLowerCase()
  return cleaned.startsWith('.') ? cleaned.slice(1) : cleaned
}

function compareRows(a: FileEntry, b: FileEntry, key: ColumnKey): number {
  if (key === 'size') return a.size - b.size
  if (key === 'modified' || key === 'created') return String(a[key]).localeCompare(String(b[key]))
  return String(cellValue(a, key)).localeCompare(String(cellValue(b, key)), undefined, { numeric: true, sensitivity: 'base' })
}

function cellValue(row: FileEntry, column: ColumnKey): string | number {
  if (column in row) return row[column as keyof FileEntry] as string | number
  return ''
}

function formatSize(size: number): string {
  if (size === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1)
  return `${(size / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

function displayValue(row: FileEntry, column: ColumnKey): string {
  const value = cellValue(row, column)
  return column === 'size' ? formatSize(Number(value)) : String(value)
}

function toggleSort(column: ColumnKey): void {
  if (sortBy.value === column) sortAscending.value = !sortAscending.value
  else { sortBy.value = column; sortAscending.value = true }
}

function toggleColumn(column: ColumnKey): void {
  if (visibleColumns.value.includes(column)) visibleColumns.value = visibleColumns.value.filter((item) => item !== column)
  else visibleColumns.value = [...visibleColumns.value, column]
  localStorage.setItem('file-list-studio-columns', JSON.stringify(visibleColumns.value))
}

function toggleRow(id: string): void {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

function toggleAllVisible(): void {
  const next = new Set(selectedIds.value)
  if (allVisibleSelected.value) filteredRows.value.forEach((row) => next.delete(row.id))
  else filteredRows.value.forEach((row) => next.add(row.id))
  selectedIds.value = next
}

function updateField(row: FileEntry, column: ColumnKey, value: string): void {
  if (editableColumns.has(column)) row[column as 'name' | 'comments' | 'tags' | 'title'] = value
}

function statusForScan(response: ScanResponse, sourceCount: number): void {
  rows.value = response.entries
  selectedIds.value = new Set()
  errors.value = response.errors
  state.value = response.errors.length > 0 && response.entries.length === 0 ? 'error' : 'completed'
  statusMessage.value = `اكتمل الفحص: ${response.entries.length.toLocaleString()} سجل${sourceCount > 1 ? ` من ${sourceCount} مسارات` : ''}.`
  if (response.errors.length > 0) statusMessage.value += ` تعذر الوصول إلى ${response.errors.length} عنصر.`
}

async function startScan(paths: string[]): Promise<void> {
  if (paths.length === 0 || isBusy.value) return
  state.value = 'scanning'
  errors.value = []
  hashProgress.value = { current: 0, total: 0 }
  currentJobId.value = `scan-${Date.now()}`
  statusMessage.value = 'جارٍ فحص الملفات والمجلدات من خلال النظام…'
  scanProgress.value = { current: 0, total: 0, path: '', stage: 'scanning' }
  try {
    const response = await invoke<ScanResponse>('scan_entries', { paths, recursive: includeSubfolders.value, excludedDirs: excludedDirs.value.split(',').map((item) => item.trim()).filter(Boolean), excludedExtensions: excludedExtensions.value.split(',').map((item) => item.trim()).filter(Boolean), jobId: currentJobId.value })
    statusForScan(response, paths.length)
  } catch (error) {
    state.value = 'error'
    statusMessage.value = `فشل الفحص: ${String(error)}`
    errors.value = [String(error)]
  }
}

async function chooseFolder(): Promise<void> {
  const selected = await open({ directory: true, multiple: false, title: 'اختر مجلدًا للفحص' })
  if (typeof selected === 'string') await startScan([selected])
}

async function calculateHashes(): Promise<void> {
  if (isBusy.value) return
  const targets = rows.value.filter((row) => row.kind !== 'Folder' && (selectedIds.value.size === 0 ? filteredRows.value.some((item) => item.id === row.id) : selectedIds.value.has(row.id)))
  if (targets.length === 0) {
    statusMessage.value = 'لا توجد ملفات مؤهلة لحساب البصمات في النطاق الحالي.'
    return
  }
  state.value = 'scanning'
  errors.value = []
  hashProgress.value = { current: 0, total: targets.length }
  currentJobId.value = `hash-${Date.now()}`
  statusMessage.value = `جارٍ حساب البصمات: 0 من ${targets.length}…`
  try {
    const result = await invoke<HashResult[]>('calculate_hashes', { paths: targets.map((row) => row.path), jobId: currentJobId.value })
    result.forEach((item) => { const row = targets.find((candidate) => candidate.path === item.path); if (item.error) errors.value.push(`${item.path}: ${item.error}`); else if (row) { row.md5 = item.md5; row.sha256 = item.sha256 } })
  } catch (error) { errors.value.push(String(error)) }
  state.value = errors.value.length > 0 ? 'error' : 'completed'
  statusMessage.value = `اكتمل حساب البصمات لـ ${targets.length} ملف${errors.value.length ? ` مع ${errors.value.length} أخطاء` : ''}.`
}

async function exportCsv(): Promise<void> {
  if (filteredRows.value.length === 0 || visibleColumns.value.length === 0) {
    statusMessage.value = 'لا توجد بيانات أو أعمدة مرئية للتصدير.'
    return
  }
  const selectedPath = await save({ title: 'احفظ قائمة الملفات', defaultPath: 'file-list.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] })
  if (!selectedPath) return
  const columns = visibleColumns.value
  const headers = columns.map((column) => localizedColumnLabel(column))
  try {
    await invoke('export_csv', { path: selectedPath, request: { entries: filteredRows.value, columns, headers } })
    statusMessage.value = `تم تصدير ${filteredRows.value.length.toLocaleString()} سجل إلى ${selectedPath}.`
  } catch (error) {
    state.value = 'error'
    statusMessage.value = `فشل حفظ CSV: ${String(error)}`
    errors.value = [String(error)]
  }
}

async function saveProject(): Promise<void> {
  if (rows.value.length === 0) { statusMessage.value = 'لا توجد نتائج لحفظها كمشروع.'; return }
  const path = await save({ title: 'حفظ مشروع File List Studio', defaultPath: 'file-list-project.flsp', filters: [{ name: 'File List Project', extensions: ['flsp', 'json'] }] })
  if (!path) return
  try { await invoke('save_project', { path, project: { version: 1, entries: rows.value, visibleColumns: visibleColumns.value, excludedDirs: excludedDirs.value.split(',').map((item) => item.trim()).filter(Boolean), excludedExtensions: excludedExtensions.value.split(',').map((item) => item.trim()).filter(Boolean) } }); statusMessage.value = `تم حفظ المشروع في ${path}.` } catch (error) { errors.value = [String(error)]; state.value = 'error'; statusMessage.value = `فشل حفظ المشروع: ${String(error)}` }
}

async function loadProject(): Promise<void> {
  const path = await open({ title: 'فتح مشروع File List Studio', multiple: false, filters: [{ name: 'File List Project', extensions: ['flsp', 'json'] }] })
  if (typeof path !== 'string') return
  try { const project = await invoke<{ entries: FileEntry[]; visibleColumns: ColumnKey[]; excludedDirs: string[]; excludedExtensions: string[] }>('load_project', { path }); rows.value = project.entries; visibleColumns.value = project.visibleColumns; excludedDirs.value = project.excludedDirs.join(', '); excludedExtensions.value = project.excludedExtensions.join(', '); selectedIds.value = new Set(); state.value = 'completed'; statusMessage.value = `تم فتح ${rows.value.length.toLocaleString()} سجلًا من المشروع.` } catch (error) { errors.value = [String(error)]; state.value = 'error'; statusMessage.value = `فشل فتح المشروع: ${String(error)}` }
}

async function exportXlsx(): Promise<void> {
  if (filteredRows.value.length === 0 || visibleColumns.value.length === 0) { statusMessage.value = 'لا توجد بيانات للتصدير.'; return }
  const path = await save({ title: 'احفظ ملف Excel', defaultPath: 'file-list.xlsx', filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }] })
  if (!path) return
  const columns = visibleColumns.value
  const headers = columns.map((column) => localizedColumnLabel(column))
  try { await invoke('export_xlsx', { path, request: { entries: filteredRows.value, columns, headers } }); statusMessage.value = `تم تصدير ${filteredRows.value.length.toLocaleString()} سجل إلى Excel.` } catch (error) { errors.value = [String(error)]; state.value = 'error'; statusMessage.value = `فشل تصدير Excel: ${String(error)}` }
}

async function clearRows(): Promise<void> {
  rows.value = []
  selectedIds.value = new Set()
  state.value = 'idle'
  errors.value = []
  statusMessage.value = 'تم مسح النتائج.'
}

async function cancelCurrent(): Promise<void> {
  if (!currentJobId.value) return
  await invoke(state.value === 'scanning' && hashProgress.value.total > 0 ? 'cancel_hashes' : 'cancel_scan', { jobId: currentJobId.value })
  statusMessage.value = 'تم طلب إلغاء العملية…'
}

function handleInputDrop(paths: string[]): void {
  if (paths.length > 0) void startScan(paths)
}

onMounted(async () => {
  const stored = localStorage.getItem('file-list-studio-columns')
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as ColumnKey[]
      visibleColumns.value = parsed.filter((column) => requiredColumns.includes(column) || optionalColumns.includes(column))
    } catch { /* Use defaults when storage is invalid. */ }
  }
  stopScanProgress = await listen<ProgressEvent>('scan-progress', (event) => { scanProgress.value = event.payload; statusMessage.value = event.payload.cancelled ? 'تم إلغاء الفحص.' : `جارٍ الفحص: ${event.payload.current.toLocaleString()} من ${event.payload.total.toLocaleString()}` })
  stopHashProgress = await listen<ProgressEvent>('hash-progress', (event) => { hashProgress.value = { current: event.payload.current, total: event.payload.total }; statusMessage.value = `جارٍ حساب البصمات: ${event.payload.current.toLocaleString()} من ${event.payload.total.toLocaleString()}` })
  const window = getCurrentWindow()
  const unlisten = await window.onDragDropEvent((event) => {
    const payload = event.payload as { type?: string; paths?: string[] }
    if (payload.type === 'drop' && payload.paths) handleInputDrop(payload.paths)
  })
  stopDragListener = unlisten
})

onBeforeUnmount(() => { stopDragListener?.(); stopScanProgress?.(); stopHashProgress?.() })
</script>

<template>
  <main class="shell" :dir="language === 'ar' ? 'rtl' : 'ltr'">
    <header class="app-header">
      <div>
        <p class="eyebrow">FILE LIST STUDIO · TAURI DESKTOP</p>
        <h1>{{ t('title') }}</h1>
        <p class="subtitle">{{ t('subtitle') }}</p>
      </div>
      <div class="header-actions">
        <span class="state-pill" :class="`state-${statusTone}`"><span class="state-dot" />{{ state === 'idle' ? 'جاهز' : state === 'scanning' ? 'قيد التنفيذ' : state === 'completed' ? 'مكتمل' : 'يحتاج مراجعة' }}</span>
        <button class="button secondary" :disabled="isBusy" @click="clearRows">{{ t('clear') }}</button>
        <button class="button secondary" @click="language = language === 'ar' ? 'en' : 'ar'">{{ language === 'ar' ? 'English' : 'العربية' }}</button>
        <button v-if="isBusy" class="button danger" @click="cancelCurrent">{{ t('cancel') }}</button>
      </div>
    </header>

    <section class="toolbar card">
      <div class="toolbar-actions">
        <button class="button primary" :disabled="isBusy" @click="chooseFolder"><span class="button-icon">＋</span> {{ t('choose') }}</button>
        <button class="button secondary" :disabled="isBusy || rows.length === 0" @click="calculateHashes"><span class="button-icon">⌁</span> {{ t('hashes') }}</button>
        <button class="button secondary" :disabled="isBusy || filteredRows.length === 0" @click="exportCsv"><span class="button-icon">↓</span> {{ t('csv') }}</button>
        <button class="button secondary" :disabled="isBusy || filteredRows.length === 0" @click="exportXlsx">{{ t('xlsx') }}</button>
        <button class="button secondary" :disabled="isBusy || rows.length === 0" @click="saveProject">{{ t('save') }}</button>
        <button class="button secondary" :disabled="isBusy" @click="loadProject">{{ t('load') }}</button>
      </div>
      <label class="toggle-control"><input v-model="includeSubfolders" type="checkbox" /><span class="toggle" /><span>تضمين المجلدات الفرعية</span></label>
    </section>

    <section class="drop-zone card" :class="{ 'is-busy': isBusy }">
      <div class="drop-icon">↧</div>
      <div>
        <strong>اسحب الملفات أو المجلدات هنا</strong>
        <p>سيتم فحص المسارات وإضافة المجلدات الفرعية وفقًا للخيار المحدد أعلاه.</p>
      </div>
      <div class="drop-hint">نظام الملفات المحلي</div>
    </section>

    <section class="filters card">
      <div class="section-heading"><div><p class="eyebrow">FILTERS</p><h2>{{ t('filters') }}</h2></div><span class="record-count">{{ filteredRows.length.toLocaleString() }} من {{ rows.length.toLocaleString() }} سجل</span></div>
      <div class="filter-grid">
        <label class="field"><span>نوع الملف</span><select v-model="typeFilter"><option value="all">كل الملفات والمجلدات</option><option value="images">صور</option><option value="videos">فيديو</option><option value="audio">صوت</option><option value="pdf">PDF</option><option value="custom">امتداد مخصص</option></select></label>
        <label v-if="typeFilter === 'custom'" class="field"><span>الامتداد</span><input v-model="customExtension" placeholder="مثال: .zip" /></label>
        <label class="field search-field"><span>بحث في الاسم أو المسار</span><input v-model="search" placeholder="اكتب للبحث…" /><span class="search-mark">⌕</span></label>
        <label class="field"><span>استبعاد المجلدات (مفصولة بفواصل)</span><input v-model="excludedDirs" placeholder="node_modules, .git" /></label>
        <label class="field"><span>استبعاد الامتدادات</span><input v-model="excludedExtensions" placeholder="tmp, cache, log" /></label>
      </div>
    </section>

    <section class="table-card card">
      <div class="table-toolbar">
        <div class="table-summary"><strong>{{ filteredRows.length.toLocaleString() }}</strong> عنصر ظاهر<span v-if="selectedVisibleCount > 0"> · {{ selectedVisibleCount }} محدد</span></div>
        <div class="table-actions"><button class="link-button" @click="isColumnPanelOpen = !isColumnPanelOpen">⚙ الأعمدة ({{ visibleColumns.length }})</button></div>
      </div>
      <div v-if="isColumnPanelOpen" class="column-panel">
        <div class="column-panel-header"><strong>الأعمدة الظاهرة</strong><button class="link-button" @click="isColumnPanelOpen = false">إغلاق</button></div>
        <div class="column-options"><label v-for="column in [...requiredColumns, ...optionalColumns]" :key="column" class="column-option"><input type="checkbox" :checked="visibleColumns.includes(column)" @change="toggleColumn(column)" /><span>{{ localizedColumnLabel(column) }}</span><small v-if="optionalColumns.includes(column)">مجهّز</small></label></div>
        <p class="panel-note">الحقول الموسومة «مجهّز» محضّرة في الواجهة، ولا تُستخرج تلقائيًا في الإصدار الحالي.</p>
      </div>
      <div v-if="rows.length === 0" class="empty-state"><div class="empty-icon">▤</div><h3>لا توجد نتائج بعد</h3><p>اختر مجلدًا أو اسحب ملفات ومجلدات إلى منطقة الإسقاط لعرضها هنا.</p></div>
      <div v-else-if="filteredRows.length === 0" class="empty-state"><div class="empty-icon">⌕</div><h3>لا توجد نتائج مطابقة</h3><p>جرّب تغيير نوع الملف أو عبارة البحث.</p></div>
      <div v-else class="table-wrap">
        <table>
          <thead><tr><th class="selection-cell"><input type="checkbox" :checked="allVisibleSelected" @change="toggleAllVisible" /></th><th v-for="column in visibleColumns" :key="column" :class="{ sortable: ['name', 'size', 'modified'].includes(column) }" @click="['name', 'size', 'modified'].includes(column) && toggleSort(column)">{{ localizedColumnLabel(column) }}<span v-if="sortBy === column" class="sort-mark">{{ sortAscending ? '↑' : '↓' }}</span></th></tr></thead>
          <tbody><tr v-for="row in filteredRows" :key="row.id" :class="{ selected: selectedIds.has(row.id) }"><td class="selection-cell"><input type="checkbox" :checked="selectedIds.has(row.id)" @change="toggleRow(row.id)" /></td><td v-for="column in visibleColumns" :key="column" :class="`cell-${column}`"><img v-if="column === 'thumbnail' && row.thumbnail" class="thumbnail" :src="row.thumbnail" :alt="row.name" /><input v-else-if="editableColumns.has(column)" class="cell-input" :value="displayValue(row, column)" @input="updateField(row, column, ($event.target as HTMLInputElement).value)" /><span v-else :title="displayValue(row, column)">{{ displayValue(row, column) || '—' }}</span></td></tr></tbody>
        </table>
      </div>
    </section>

    <section class="status-card card">
      <div class="status-top"><div><p class="eyebrow">STATUS</p><h2>{{ t('status') }}</h2></div><span v-if="activeProgress.total > 0" class="progress-label">{{ activeProgress.current }} / {{ activeProgress.total }} · {{ progressPercent }}%</span></div>
      <p class="status-message">{{ statusMessage }}</p>
      <div v-if="activeProgress.total > 0" class="progress-track"><span :style="{ width: `${progressPercent}%` }" /></div>
      <div v-if="errors.length > 0" class="errors"><strong>{{ errors.length }} أخطاء أو تحذيرات</strong><details><summary>عرض التفاصيل</summary><ul><li v-for="error in errors.slice(0, 20)" :key="error">{{ error }}</li></ul><p v-if="errors.length > 20">… و {{ errors.length - 20 }} أخرى.</p></details></div>
    </section>

    <footer>الحقول المستخرجة فعليًا: الاسم، التواريخ المتاحة من نظام الملفات، النوع، الحجم، المسار، MD5 وSHA-256 عند الطلب. الحقول الاختيارية الأخرى محضّرة للواجهة فقط.</footer>
  </main>
</template>
