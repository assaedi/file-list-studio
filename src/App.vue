<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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

const columnLabelsEn: Partial<Record<ColumnKey, string>> = { name: 'File name', modified: 'Modified', created: 'Created', kind: 'Type', size: 'Size', path: 'Path', comments: 'Comments', tags: 'Tags', title: 'Title', md5: 'MD5', sha256: 'SHA-256', thumbnail: 'Preview', width: 'Width', height: 'Height', duration: 'Duration', bitRate: 'Bit rate', sampleRate: 'Sample rate', channels: 'Channels', cameraMake: 'Camera make', cameraModel: 'Camera model', cameraModelName: 'Camera model', dateTaken: 'Date taken', iso: 'ISO', fNumber: 'F-Number', focalLength: 'Focal length', latitude: 'Latitude', longitude: 'Longitude', mapsUrl: 'Maps URL', album: 'Album', artist: 'Artist', version: 'Version', pages: 'Pages', authors: 'Authors / artist', trackNo: 'Track number', genre: 'Genre', year: 'Year', audioBitRate: 'Audio bit rate', audioSampleRate: 'Audio sample rate', audioChannels: 'Audio channels', dimensions: 'Dimensions', pixelWidth: 'Pixel width', pixelHeight: 'Pixel height' }
const columnLabels: Record<ColumnKey, string> = {
  name: 'اسم الملف', modified: 'تاريخ التعديل', created: 'تاريخ الإنشاء', kind: 'النوع', size: 'الحجم', path: 'المسار',
  comments: 'التعليقات', tags: 'الوسوم', title: 'العنوان', md5: 'MD5', sha256: 'SHA-256', version: 'الإصدار', pages: 'الصفحات',
  authors: 'المؤلفون / الفنان', album: 'الألبوم', trackNo: 'رقم المسار', genre: 'النوع الموسيقي', year: 'السنة', duration: 'المدة',
  audioBitRate: 'معدل بت الصوت', audioSampleRate: 'معدل عينات الصوت', audioChannels: 'قنوات الصوت', dimensions: 'الأبعاد',
  pixelWidth: 'عرض البكسل', pixelHeight: 'ارتفاع البكسل', cameraMake: 'صانع الكاميرا', cameraModelName: 'طراز الكاميرا',
  dateTaken: 'تاريخ الالتقاط', iso: 'ISO', fNumber: 'F-Number', focalLength: 'البعد البؤري', latitude: 'خط العرض', longitude: 'خط الطول', mapsUrl: 'رابط الخرائط', thumbnail: 'معاينة', width: 'العرض', height: 'الارتفاع', bitRate: 'معدل البت', sampleRate: 'معدل العينات', channels: 'القنوات', cameraModel: 'طراز الكاميرا', artist: 'الفنان'
}

const copy = {
  ar: {
    title: 'منشئ قوائم الملفات', subtitle: 'افحص الملفات المحلية، أضف بياناتها الوصفية، وأنشئ كتالوجًا منظمًا.', filtersEyebrow: 'المرشحات', statusEyebrow: 'الحالة',
    choose: 'اختيار مجلد', hashes: 'حساب البصمات', csv: 'تصدير CSV', xlsx: 'تصدير XLSX', save: 'حفظ مشروع', load: 'فتح مشروع', clear: 'مسح النتائج', cancel: 'إلغاء العملية', status: 'حالة العملية', filters: 'تصفية النتائج',
    ready: 'جاهز', working: 'قيد التنفيذ', completed: 'مكتمل', review: 'يحتاج مراجعة', language: 'English', includeSubfolders: 'تضمين المجلدات الفرعية',
    dropTitle: 'اسحب الملفات أو المجلدات هنا', dropText: 'سيتم فحص المسارات وإضافة المجلدات الفرعية وفقًا للخيار المحدد.', localFiles: 'نظام الملفات المحلي', filterType: 'نوع الملف', allTypes: 'كل الملفات والمجلدات', images: 'صور', videos: 'فيديو', audio: 'صوت', pdf: 'PDF', custom: 'امتداد مخصص', extension: 'الامتداد', search: 'بحث في الاسم أو المسار', searchPlaceholder: 'اكتب للبحث…', excludeDirs: 'استبعاد المجلدات (مفصولة بفواصل)', excludeDirsPlaceholder: 'node_modules, .git', excludeExtensions: 'استبعاد الامتدادات', excludeExtensionsPlaceholder: 'tmp, cache, log',
    records: (shown: string, total: string) => `${shown} من ${total} سجل`, visibleItems: 'عنصر ظاهر', selected: (count: string) => `${count} محدد`, columns: (count: string) => `الأعمدة (${count})`, visibleColumns: 'الأعمدة الظاهرة', close: 'إغلاق', prepared: 'مجهّز', preparedNote: 'الحقول الموسومة «مجهّز» محضّرة في الواجهة ولا تُستخرج تلقائيًا من كل نوع ملف.', noResults: 'لا توجد نتائج بعد', noResultsText: 'اختر مجلدًا أو اسحب ملفات ومجلدات إلى منطقة الإسقاط لعرضها هنا.', noMatches: 'لا توجد نتائج مطابقة', noMatchesText: 'جرّب تغيير نوع الملف أو عبارة البحث.',
    statusIdle: 'اختر مجلدًا أو اسحب ملفات ومجلدات إلى منطقة الإسقاط للبدء.', scanStarting: 'جارٍ فحص الملفات والمجلدات…', scanCancelled: 'تم إلغاء الفحص.', scanning: (current: string, total: string) => `جارٍ الفحص: ${current} من ${total}`, scanComplete: (count: string, suffix: string) => `اكتمل الفحص: ${count} سجل${suffix}.`, multiplePaths: (count: string) => ` من ${count} مسارات`, accessErrors: (count: string) => ` تعذر الوصول إلى ${count} عنصر.`, scanFailed: (error: string) => `فشل الفحص: ${error}`,
    hashNone: 'لا توجد ملفات مؤهلة لحساب البصمات في النطاق الحالي.', hashing: (current: string, total: string) => `جارٍ حساب البصمات: ${current} من ${total}`, hashComplete: (count: string, errors: string) => `اكتمل حساب البصمات لـ ${count} ملف${errors ? ` مع ${errors} أخطاء` : ''}.`, cancelRequested: 'تم طلب إلغاء العملية…', exportNone: 'لا توجد بيانات أو أعمدة مرئية للتصدير.', savedCsv: (count: string) => `تم تصدير ${count} سجل إلى CSV.`, csvFailed: (error: string) => `فشل حفظ CSV: ${error}`, savedXlsx: (count: string) => `تم تصدير ${count} سجل إلى Excel.`, xlsxFailed: (error: string) => `فشل تصدير Excel: ${error}`, noProject: 'لا توجد نتائج لحفظها كمشروع.', projectSaved: 'تم حفظ المشروع بنجاح.', projectOpened: (count: string) => `تم فتح ${count} سجلًا من المشروع.`, projectSaveFailed: (error: string) => `فشل حفظ المشروع: ${error}`, projectOpenFailed: (error: string) => `فشل فتح المشروع: ${error}`, cleared: 'تم مسح النتائج.', errors: (count: string) => `${count} أخطاء أو تحذيرات`, errorDetails: 'عرض التفاصيل', footer: 'البيانات المستخرجة: معلومات النظام، EXIF، خصائص الوسائط، والصور المصغرة عند توفرها. تُحسب MD5 وSHA-256 عند الطلب.', chooseDialog: 'اختر مجلدًا للفحص', saveCsvDialog: 'احفظ قائمة الملفات', saveXlsxDialog: 'احفظ ملف Excel', saveProjectDialog: 'حفظ مشروع File List Studio', openProjectDialog: 'فتح مشروع File List Studio'
  },
  en: {
    title: 'File List Studio', subtitle: 'Scan local files, enrich metadata, and build an organized catalog.', filtersEyebrow: 'FILTERS', statusEyebrow: 'STATUS',
    choose: 'Choose folder', hashes: 'Calculate hashes', csv: 'Export CSV', xlsx: 'Export XLSX', save: 'Save project', load: 'Open project', clear: 'Clear results', cancel: 'Cancel operation', status: 'Operation status', filters: 'Filter results',
    ready: 'Ready', working: 'Working', completed: 'Completed', review: 'Needs review', language: 'العربية', includeSubfolders: 'Include subfolders',
    dropTitle: 'Drop files or folders here', dropText: 'The selected paths will be scanned, including subfolders when enabled.', localFiles: 'Local file system', filterType: 'File type', allTypes: 'All files and folders', images: 'Images', videos: 'Video', audio: 'Audio', pdf: 'PDF', custom: 'Custom extension', extension: 'Extension', search: 'Search by name or path', searchPlaceholder: 'Type to search…', excludeDirs: 'Exclude folders (comma-separated)', excludeDirsPlaceholder: 'node_modules, .git', excludeExtensions: 'Exclude extensions', excludeExtensionsPlaceholder: 'tmp, cache, log',
    records: (shown: string, total: string) => `${shown} of ${total} records`, visibleItems: 'visible items', selected: (count: string) => `${count} selected`, columns: (count: string) => `Columns (${count})`, visibleColumns: 'Visible columns', close: 'Close', prepared: 'prepared', preparedNote: 'Fields marked “prepared” are available in the interface but are not automatically extracted for every file type.', noResults: 'No results yet', noResultsText: 'Choose a folder or drop files and folders into the drop zone to see them here.', noMatches: 'No matching results', noMatchesText: 'Try changing the file type or search phrase.',
    statusIdle: 'Choose a folder or drop files and folders into the drop zone to begin.', scanStarting: 'Scanning files and folders…', scanCancelled: 'Scan cancelled.', scanning: (current: string, total: string) => `Scanning: ${current} of ${total}`, scanComplete: (count: string, suffix: string) => `Scan complete: ${count} record${count === '1' ? '' : 's'}${suffix}.`, multiplePaths: (count: string) => ` from ${count} paths`, accessErrors: (count: string) => ` Could not access ${count} item${count === '1' ? '' : 's'}.`, scanFailed: (error: string) => `Scan failed: ${error}`,
    hashNone: 'There are no eligible files to hash in the current scope.', hashing: (current: string, total: string) => `Calculating hashes: ${current} of ${total}`, hashComplete: (count: string, errors: string) => `Hashing complete for ${count} file${count === '1' ? '' : 's'}${errors ? ` with ${errors} error${errors === '1' ? '' : 's'}` : ''}.`, cancelRequested: 'Cancellation requested…', exportNone: 'There is no data or visible column to export.', savedCsv: (count: string) => `Exported ${count} record${count === '1' ? '' : 's'} to CSV.`, csvFailed: (error: string) => `CSV export failed: ${error}`, savedXlsx: (count: string) => `Exported ${count} record${count === '1' ? '' : 's'} to Excel.`, xlsxFailed: (error: string) => `Excel export failed: ${error}`, noProject: 'There are no results to save as a project.', projectSaved: 'Project saved successfully.', projectOpened: (count: string) => `Opened ${count} record${count === '1' ? '' : 's'} from the project.`, projectSaveFailed: (error: string) => `Could not save the project: ${error}`, projectOpenFailed: (error: string) => `Could not open the project: ${error}`, cleared: 'Results cleared.', errors: (count: string) => `${count} error${count === '1' ? '' : 's'} or warning${count === '1' ? '' : 's'}`, errorDetails: 'View details', footer: 'Extracted data includes filesystem details, EXIF, media properties, and thumbnails when available. MD5 and SHA-256 are calculated on demand.', chooseDialog: 'Choose a folder to scan', saveCsvDialog: 'Save file list', saveXlsxDialog: 'Save Excel workbook', saveProjectDialog: 'Save File List Studio project', openProjectDialog: 'Open File List Studio project'
  }
} as const

type TranslationKey = keyof typeof copy.ar
function localizedColumnLabel(column: ColumnKey): string { return language.value === 'en' ? (columnLabelsEn[column] ?? columnLabels[column]) : columnLabels[column] }
function t(key: TranslationKey, ...args: string[]): string { const value = copy[language.value][key] as unknown; return typeof value === 'function' ? (value as (...values: string[]) => string)(...args) : String(value) }

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
const statusMessage = ref('')
const errors = ref<string[]>([])
const isColumnPanelOpen = ref(false)
const isBusy = computed(() => state.value === 'scanning')
const hashProgress = ref({ current: 0, total: 0 })
const scanProgress = ref({ current: 0, total: 0, path: '', stage: '' })
const excludedDirs = ref('')
const excludedExtensions = ref('')
const language = ref<'ar' | 'en'>(localStorage.getItem('file-list-studio-language') === 'en' ? 'en' : 'ar')
const isArabic = computed(() => language.value === 'ar')
const direction = computed(() => isArabic.value ? 'rtl' : 'ltr')
function toggleLanguage(): void { language.value = isArabic.value ? 'en' : 'ar' }
function applyLanguage(value: 'ar' | 'en'): void { document.documentElement.lang = value; document.documentElement.dir = value === 'ar' ? 'rtl' : 'ltr' }
watch(language, (value) => { localStorage.setItem('file-list-studio-language', value); applyLanguage(value) }, { immediate: true })
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
  const suffix = sourceCount > 1 ? t('multiplePaths', sourceCount.toLocaleString()) : ''
  statusMessage.value = t('scanComplete', response.entries.length.toLocaleString(), suffix)
  if (response.errors.length > 0) statusMessage.value += t('accessErrors', response.errors.length.toLocaleString())
}

async function startScan(paths: string[]): Promise<void> {
  if (paths.length === 0 || isBusy.value) return
  state.value = 'scanning'
  errors.value = []
  hashProgress.value = { current: 0, total: 0 }
  currentJobId.value = `scan-${Date.now()}`
  statusMessage.value = t('scanStarting')
  scanProgress.value = { current: 0, total: 0, path: '', stage: 'scanning' }
  try {
    const response = await invoke<ScanResponse>('scan_entries', { paths, recursive: includeSubfolders.value, excludedDirs: excludedDirs.value.split(',').map((item) => item.trim()).filter(Boolean), excludedExtensions: excludedExtensions.value.split(',').map((item) => item.trim()).filter(Boolean), jobId: currentJobId.value })
    statusForScan(response, paths.length)
  } catch (error) {
    state.value = 'error'
    statusMessage.value = t('scanFailed', String(error))
    errors.value = [String(error)]
  }
}

async function chooseFolder(): Promise<void> {
  const selected = await open({ directory: true, multiple: false, title: t('chooseDialog') })
  if (typeof selected === 'string') await startScan([selected])
}

async function calculateHashes(): Promise<void> {
  if (isBusy.value) return
  const targets = rows.value.filter((row) => row.kind !== 'Folder' && (selectedIds.value.size === 0 ? filteredRows.value.some((item) => item.id === row.id) : selectedIds.value.has(row.id)))
  if (targets.length === 0) {
    statusMessage.value = t('hashNone')
    return
  }
  state.value = 'scanning'
  errors.value = []
  hashProgress.value = { current: 0, total: targets.length }
  currentJobId.value = `hash-${Date.now()}`
  statusMessage.value = t('hashing', '0', targets.length.toLocaleString())
  try {
    const result = await invoke<HashResult[]>('calculate_hashes', { paths: targets.map((row) => row.path), jobId: currentJobId.value })
    result.forEach((item) => { const row = targets.find((candidate) => candidate.path === item.path); if (item.error) errors.value.push(`${item.path}: ${item.error}`); else if (row) { row.md5 = item.md5; row.sha256 = item.sha256 } })
  } catch (error) { errors.value.push(String(error)) }
  state.value = errors.value.length > 0 ? 'error' : 'completed'
  statusMessage.value = t('hashComplete', targets.length.toLocaleString(), errors.value.length.toLocaleString())
}

async function exportCsv(): Promise<void> {
  if (filteredRows.value.length === 0 || visibleColumns.value.length === 0) {
    statusMessage.value = t('exportNone')
    return
  }
  const selectedPath = await save({ title: t('saveCsvDialog'), defaultPath: 'file-list.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] })
  if (!selectedPath) return
  const columns = visibleColumns.value
  const headers = columns.map((column) => localizedColumnLabel(column))
  try {
    await invoke('export_csv', { path: selectedPath, request: { entries: filteredRows.value, columns, headers } })
    statusMessage.value = t('savedCsv', filteredRows.value.length.toLocaleString())
  } catch (error) {
    state.value = 'error'
    statusMessage.value = t('csvFailed', String(error))
    errors.value = [String(error)]
  }
}

async function saveProject(): Promise<void> {
  if (rows.value.length === 0) { statusMessage.value = t('noProject'); return }
  const path = await save({ title: t('saveProjectDialog'), defaultPath: 'file-list-project.flsp', filters: [{ name: 'File List Project', extensions: ['flsp', 'json'] }] })
  if (!path) return
  try { await invoke('save_project', { path, project: { version: 1, entries: rows.value, visibleColumns: visibleColumns.value, excludedDirs: excludedDirs.value.split(',').map((item) => item.trim()).filter(Boolean), excludedExtensions: excludedExtensions.value.split(',').map((item) => item.trim()).filter(Boolean) } }); statusMessage.value = t('projectSaved') } catch (error) { errors.value = [String(error)]; state.value = 'error'; statusMessage.value = t('projectSaveFailed', String(error)) }
}

async function loadProject(): Promise<void> {
  const path = await open({ title: t('openProjectDialog'), multiple: false, filters: [{ name: 'File List Project', extensions: ['flsp', 'json'] }] })
  if (typeof path !== 'string') return
  try { const project = await invoke<{ entries: FileEntry[]; visibleColumns: ColumnKey[]; excludedDirs: string[]; excludedExtensions: string[] }>('load_project', { path }); rows.value = project.entries; visibleColumns.value = project.visibleColumns; excludedDirs.value = project.excludedDirs.join(', '); excludedExtensions.value = project.excludedExtensions.join(', '); selectedIds.value = new Set(); state.value = 'completed'; statusMessage.value = t('projectOpened', rows.value.length.toLocaleString()) } catch (error) { errors.value = [String(error)]; state.value = 'error'; statusMessage.value = t('projectOpenFailed', String(error)) }
}

async function exportXlsx(): Promise<void> {
  if (filteredRows.value.length === 0 || visibleColumns.value.length === 0) { statusMessage.value = t('exportNone'); return }
  const path = await save({ title: t('saveXlsxDialog'), defaultPath: 'file-list.xlsx', filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }] })
  if (!path) return
  const columns = visibleColumns.value
  const headers = columns.map((column) => localizedColumnLabel(column))
  try { await invoke('export_xlsx', { path, request: { entries: filteredRows.value, columns, headers } }); statusMessage.value = t('savedXlsx', filteredRows.value.length.toLocaleString()) } catch (error) { errors.value = [String(error)]; state.value = 'error'; statusMessage.value = t('xlsxFailed', String(error)) }
}

async function clearRows(): Promise<void> {
  rows.value = []
  selectedIds.value = new Set()
  state.value = 'idle'
  errors.value = []
  statusMessage.value = t('cleared')
}

async function cancelCurrent(): Promise<void> {
  if (!currentJobId.value) return
  await invoke(state.value === 'scanning' && hashProgress.value.total > 0 ? 'cancel_hashes' : 'cancel_scan', { jobId: currentJobId.value })
  statusMessage.value = t('cancelRequested')
}

function handleInputDrop(paths: string[]): void {
  if (paths.length > 0) void startScan(paths)
}

onMounted(async () => {
  if (!statusMessage.value) statusMessage.value = t('statusIdle')
  const stored = localStorage.getItem('file-list-studio-columns')
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as ColumnKey[]
      visibleColumns.value = parsed.filter((column) => requiredColumns.includes(column) || optionalColumns.includes(column))
    } catch { /* Use defaults when storage is invalid. */ }
  }
  stopScanProgress = await listen<ProgressEvent>('scan-progress', (event) => { scanProgress.value = event.payload; statusMessage.value = event.payload.cancelled ? t('scanCancelled') : t('scanning', event.payload.current.toLocaleString(), event.payload.total.toLocaleString()) })
  stopHashProgress = await listen<ProgressEvent>('hash-progress', (event) => { hashProgress.value = { current: event.payload.current, total: event.payload.total }; statusMessage.value = t('hashing', event.payload.current.toLocaleString(), event.payload.total.toLocaleString()) })
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
  <main class="shell" :dir="direction">
    <header class="app-header">
      <div>
        <p class="eyebrow">FILE LIST STUDIO · TAURI DESKTOP</p>
        <h1>{{ t('title') }}</h1>
        <p class="subtitle">{{ t('subtitle') }}</p>
      </div>
      <div class="header-actions">
        <span class="state-pill" :class="`state-${statusTone}`"><span class="state-dot" />{{ state === 'idle' ? t('ready') : state === 'scanning' ? t('working') : state === 'completed' ? t('completed') : t('review') }}</span>
        <button class="button secondary" :disabled="isBusy" @click="clearRows">{{ t('clear') }}</button>
        <button class="button secondary" @click="toggleLanguage">{{ t('language') }}</button>
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
      <label class="toggle-control"><input v-model="includeSubfolders" type="checkbox" /><span class="toggle" /><span>{{ t('includeSubfolders') }}</span></label>
    </section>

    <section class="drop-zone card" :class="{ 'is-busy': isBusy }">
      <div class="drop-icon">↧</div>
      <div>
        <strong>{{ t('dropTitle') }}</strong>
        <p>{{ t('dropText') }}</p>
      </div>
      <div class="drop-hint">{{ t('localFiles') }}</div>
    </section>

    <section class="filters card">
      <div class="section-heading"><div><p class="eyebrow">{{ t('filtersEyebrow') }}</p><h2>{{ t('filters') }}</h2></div><span class="record-count">{{ t('records', filteredRows.length.toLocaleString(), rows.length.toLocaleString()) }}</span></div>
      <div class="filter-grid">
        <label class="field"><span>{{ t('filterType') }}</span><select v-model="typeFilter"><option value="all">{{ t('allTypes') }}</option><option value="images">{{ t('images') }}</option><option value="videos">{{ t('videos') }}</option><option value="audio">{{ t('audio') }}</option><option value="pdf">{{ t('pdf') }}</option><option value="custom">{{ t('custom') }}</option></select></label>
        <label v-if="typeFilter === 'custom'" class="field"><span>{{ t('extension') }}</span><input v-model="customExtension" :placeholder="language === 'ar' ? 'مثال: .zip' : 'Example: .zip'" /></label>
        <label class="field search-field"><span>{{ t('search') }}</span><input v-model="search" :placeholder="t('searchPlaceholder')" /><span class="search-mark">⌕</span></label>
        <label class="field"><span>{{ t('excludeDirs') }}</span><input v-model="excludedDirs" :placeholder="t('excludeDirsPlaceholder')" /></label>
        <label class="field"><span>{{ t('excludeExtensions') }}</span><input v-model="excludedExtensions" :placeholder="t('excludeExtensionsPlaceholder')" /></label>
      </div>
    </section>

    <section class="table-card card">
      <div class="table-toolbar">
        <div class="table-summary"><strong>{{ filteredRows.length.toLocaleString() }}</strong> {{ t('visibleItems') }}<span v-if="selectedVisibleCount > 0"> · {{ t('selected', selectedVisibleCount.toLocaleString()) }}</span></div>
        <div class="table-actions"><button class="link-button" @click="isColumnPanelOpen = !isColumnPanelOpen">⚙ {{ t('columns', visibleColumns.length.toLocaleString()) }}</button></div>
      </div>
      <div v-if="isColumnPanelOpen" class="column-panel">
        <div class="column-panel-header"><strong>{{ t('visibleColumns') }}</strong><button class="link-button" @click="isColumnPanelOpen = false">{{ t('close') }}</button></div>
        <div class="column-options"><label v-for="column in [...requiredColumns, ...optionalColumns]" :key="column" class="column-option"><input type="checkbox" :checked="visibleColumns.includes(column)" @change="toggleColumn(column)" /><span>{{ localizedColumnLabel(column) }}</span><small v-if="optionalColumns.includes(column)">{{ t('prepared') }}</small></label></div>
        <p class="panel-note">{{ t('preparedNote') }}</p>
      </div>
      <div v-if="rows.length === 0" class="empty-state"><div class="empty-icon">▤</div><h3>{{ t('noResults') }}</h3><p>{{ t('noResultsText') }}</p></div>
      <div v-else-if="filteredRows.length === 0" class="empty-state"><div class="empty-icon">⌕</div><h3>{{ t('noMatches') }}</h3><p>{{ t('noMatchesText') }}</p></div>
      <div v-else class="table-wrap">
        <table>
          <thead><tr><th class="selection-cell"><input type="checkbox" :checked="allVisibleSelected" @change="toggleAllVisible" /></th><th v-for="column in visibleColumns" :key="column" :class="{ sortable: ['name', 'size', 'modified'].includes(column) }" @click="['name', 'size', 'modified'].includes(column) && toggleSort(column)">{{ localizedColumnLabel(column) }}<span v-if="sortBy === column" class="sort-mark">{{ sortAscending ? '↑' : '↓' }}</span></th></tr></thead>
          <tbody><tr v-for="row in filteredRows" :key="row.id" :class="{ selected: selectedIds.has(row.id) }"><td class="selection-cell"><input type="checkbox" :checked="selectedIds.has(row.id)" @change="toggleRow(row.id)" /></td><td v-for="column in visibleColumns" :key="column" :class="`cell-${column}`"><img v-if="column === 'thumbnail' && row.thumbnail" class="thumbnail" :src="row.thumbnail" :alt="row.name" /><input v-else-if="editableColumns.has(column)" class="cell-input" :value="displayValue(row, column)" @input="updateField(row, column, ($event.target as HTMLInputElement).value)" /><span v-else :title="displayValue(row, column)">{{ displayValue(row, column) || '—' }}</span></td></tr></tbody>
        </table>
      </div>
    </section>

    <section class="status-card card">
      <div class="status-top"><div><p class="eyebrow">{{ t('statusEyebrow') }}</p><h2>{{ t('status') }}</h2></div><span v-if="activeProgress.total > 0" class="progress-label">{{ activeProgress.current }} / {{ activeProgress.total }} · {{ progressPercent }}%</span></div>
      <p class="status-message">{{ statusMessage }}</p>
      <div v-if="activeProgress.total > 0" class="progress-track"><span :style="{ width: `${progressPercent}%` }" /></div>
      <div v-if="errors.length > 0" class="errors"><strong>{{ t('errors', errors.length.toLocaleString()) }}</strong><details><summary>{{ t('errorDetails') }}</summary><ul><li v-for="error in errors.slice(0, 20)" :key="error">{{ error }}</li></ul><p v-if="errors.length > 20">… و {{ errors.length - 20 }} أخرى.</p></details></div>
    </section>

    <footer>{{ t('footer') }}</footer>
  </main>
</template>
