'use strict';
/**
 * 后端用户可见消息的国际化（纯 Node 模块，主进程与提权助手进程都可用，不依赖 electron）。
 *
 * 语言由启动方注入：主进程 main.js 在启动时 setLang(loadLanguage())；
 * 提权助手进程在 helper-server.js 收到任务请求时从 payload.lang 注入。
 * 未注入时默认英文，与前端 DEFAULT_LANG 保持一致。
 */
let lang = 'en';

function setLang(l) {
  if (l && typeof l === 'string') lang = l;
}
function getLang() {
  return lang;
}

const D = {
  // ---------- 阶段（phase） ----------
  phaseSecurity: { zh: '安全检查', 'zh-TW': '安全檢查', en: 'Security check', ko: '보안 검사', ru: 'Проверка безопасности', ar: 'فحص الأمان' },
  phasePrepare: { zh: '准备', 'zh-TW': '準備', en: 'Prepare', ko: '준비', ru: 'Подготовка', ar: 'التحضير' },
  phasePartition: { zh: '分区', 'zh-TW': '分割', en: 'Partition', ko: '파티션', ru: 'Раздел', ar: 'القسم' },
  phaseCopy: { zh: '拷贝', 'zh-TW': '拷貝', en: 'Copying', ko: '복사', ru: 'Копирование', ar: 'النسخ' },
  phaseBoot: { zh: '引导', 'zh-TW': '開機', en: 'Boot', ko: '부팅', ru: 'Загрузка', ar: 'الإقلاع' },
  phaseFinalize: { zh: '收尾', 'zh-TW': '收尾', en: 'Finalize', ko: '마무리', ru: 'Завершение', ar: 'الإنهاء' },
  phaseDone: { zh: '完成', 'zh-TW': '完成', en: 'Done', ko: '완료', ru: 'Готово', ar: 'اكتمل' },
  phaseWrite: { zh: '写入', 'zh-TW': '寫入', en: 'Write', ko: '쓰기', ru: 'Запись', ar: 'الكتابة' },
  phaseVerify: { zh: '校验', 'zh-TW': '驗證', en: 'Verify', ko: '검증', ru: 'Проверка', ar: 'التحقق' },
  phaseErase: { zh: '擦除', 'zh-TW': '清除', en: 'Erase', ko: '지우기', ru: 'Стирание', ar: 'المسح' },
  phaseBackup: { zh: '备份', 'zh-TW': '備份', en: 'Backup', ko: '백업', ru: 'Резервное копирование', ar: 'النسخ الاحتياطي' },
  phaseUnmount: { zh: '卸载', 'zh-TW': '卸載', en: 'Unmount', ko: '마운트 해제', ru: 'Отмонтирование', ar: 'إلغاء التثبيت' },

  // ---------- 消息（message） ----------
  msgReadMounted: { zh: '读取已挂载的镜像内容', 'zh-TW': '讀取已掛載的映像內容', en: 'Reading mounted image contents', ko: '마운트된 이미지 내용 읽는 중', ru: 'Чтение содержимого смонтированного образа', ar: 'قراءة محتويات الصورة المُثبّتة' },
  msgBuildFat32: { zh: '建立 FAT32 活动分区', 'zh-TW': '建立 FAT32 使用中分割區', en: 'Creating FAT32 active partition', ko: 'FAT32 활성 파티션 생성 중', ru: 'Создание активного раздела FAT32', ar: 'إنشاء قسم FAT32 نشط' },
  msgCopyingFiles: { zh: '正在复制安装文件', 'zh-TW': '正在複製安裝檔案', en: 'Copying setup files', ko: '설치 파일 복사 중', ru: 'Копирование установочных файлов', ar: 'نسخ ملفات التثبيت' },
  msgSplittingWim: { zh: '拆分 install.wim {pct}%', 'zh-TW': '拆分 install.wim {pct}%', en: 'Splitting install.wim {pct}%', ko: 'install.wim 분할 중 {pct}%', ru: 'Разделение install.wim {pct}%', ar: 'تقسيم install.wim {pct}%' },
  msgCopying: { zh: '复制 {done} / {total} GB', 'zh-TW': '複製 {done} / {total} GB', en: 'Copying {done} / {total} GB', ko: '복사 {done} / {total} GB', ru: 'Копирование {done} / {total} ГБ', ar: 'نسخ {done} / {total} غيغابايت' },
  msgWritingBoot: { zh: '正在写入启动代码', 'zh-TW': '正在寫入開機程式碼', en: 'Writing boot code', ko: '부팅 코드 쓰는 중', ru: 'Запись загрузочного кода', ar: 'كتابة كود الإقلاع' },
  msgFlush: { zh: '刷新缓存', 'zh-TW': '重新整理快取', en: 'Flushing cache', ko: '캐시 플러시', ru: 'Сброс кэша', ar: 'مسح ذاكرة التخزين المؤقت' },
  msgSkippedLinks: { zh: '跳过 {n} 个无法解析的链接/项目（不影响启动盘制作）', 'zh-TW': '跳過 {n} 個無法解析的連結/項目（不影響開機碟製作）', en: 'Skipped {n} unresolvable links/items (does not affect the result)', ko: '해석할 수 없는 링크/항목 {n}개 건너뜀 (결과에 영향 없음)', ru: 'Пропущено {n} неразрешимых ссылок/элементов (не влияет на результат)', ar: 'تم تخطي {n} من الروابط/العناصر غير القابلة للحل (لا يؤثر على النتيجة)' },
  msgUnmounting: { zh: '卸载目标磁盘', 'zh-TW': '卸載目標磁碟', en: 'Unmounting target disk', ko: '대상 디스크 마운트 해제 중', ru: 'Отмонтирование целевого диска', ar: 'إلغاء تثبيت القرص المستهدف' },
  msgStartWrite: { zh: '开始写入 {size} GB', 'zh-TW': '開始寫入 {size} GB', en: 'Writing {size} GB', ko: '{size} GB 쓰기 시작', ru: 'Запись {size} ГБ', ar: 'بدء كتابة {size} غيغابايت' },
  msgWriting: { zh: '写入 {done} / {total} GB', 'zh-TW': '寫入 {done} / {total} GB', en: 'Writing {done} / {total} GB', ko: '쓰기 {done} / {total} GB', ru: 'Запись {done} / {total} ГБ', ar: 'كتابة {done} / {total} غيغابايت' },
  msgPersistenceNoSpace: { zh: '剩余空间不足 512 MB，跳过持久化分区', 'zh-TW': '剩餘空間不足 512 MB，跳過持久化分割區', en: 'Less than 512 MB free, skipping persistence partition', ko: '남은 공간이 512 MB 미만이라 영구 저장 파티션 건너뜀', ru: 'Менее 512 МБ свободно, раздел сохранения пропущен', ar: 'المساحة المتبقية أقل من 512 ميجابايت، تم تخطي قسم التخزين الدائم' },
  msgCreatingPersistence: { zh: '在剩余空间创建持久化分区 casper-rw', 'zh-TW': '在剩餘空間建立持久化分割區 casper-rw', en: 'Creating casper-rw persistence partition in free space', ko: '남은 공간에 casper-rw 영구 저장 파티션 생성 중', ru: 'Создание раздела casper-rw в свободном пространстве', ar: 'إنشاء قسم casper-rw للتخزين الدائم في المساحة المتبقية' },
  msgPersistenceFailed: { zh: '持久化分区创建失败（不影响启动）：{msg}', 'zh-TW': '持久化分割區建立失敗（不影響開機）：{msg}', en: 'Persistence partition creation failed (boot unaffected): {msg}', ko: '영구 저장 파티션 생성 실패 (부팅에는 영향 없음): {msg}', ru: 'Не удалось создать раздел сохранения (на загрузку не влияет): {msg}', ar: 'فشل إنشاء قسم التخزين الدائم (لا يؤثر على الإقلاع): {msg}' },
  msgWriteComplete: { zh: '写入完成', 'zh-TW': '寫入完成', en: 'Write complete', ko: '쓰기 완료', ru: 'Запись завершена', ar: 'اكتملت الكتابة' },
  msgZeroFill: { zh: '零覆盖写入', 'zh-TW': '零覆寫寫入', en: 'Zero-fill write', ko: '0으로 덮어쓰기', ru: 'Запись нулями', ar: 'الكتابة بالأصفار' },
  msgRandomFill: { zh: '随机数据覆盖写入', 'zh-TW': '隨機資料覆寫寫入', en: 'Random data overwrite', ko: '임의 데이터 덮어쓰기', ru: 'Запись случайных данных', ar: 'الكتابة ببيانات عشوائية' },
  msgErasing: { zh: '擦除 {done} / {total} GB', 'zh-TW': '清除 {done} / {total} GB', en: 'Erasing {done} / {total} GB', ko: '지우기 {done} / {total} GB', ru: 'Стирание {done} / {total} ГБ', ar: 'مسح {done} / {total} غيغابايت' },
  msgBackingUp: { zh: '备份 {done} / {total} GB', 'zh-TW': '備份 {done} / {total} GB', en: 'Backing up {done} / {total} GB', ko: '백업 {done} / {total} GB', ru: 'Резервное копирование {done} / {total} ГБ', ar: 'نسخ احتياطي {done} / {total} غيغابايت' },
  msgReadingDevice: { zh: '正在读取设备并写入镜像文件', 'zh-TW': '正在讀取裝置並寫入映像檔', en: 'Reading device and writing image file', ko: '장치를 읽고 이미지 파일에 쓰는 중', ru: 'Чтение устройства и запись файла образа', ar: 'قراءة الجهاز وكتابة ملف الصورة' },
  msgUnmountHint: { zh: '卸载提示：{msg}', 'zh-TW': '卸載提示：{msg}', en: 'Unmount notice: {msg}', ko: '마운트 해제 안내: {msg}', ru: 'Примечание об отмонтировании: {msg}', ar: 'ملاحظة إلغاء التثبيت: {msg}' },
  msgVerifying: { zh: '回读设备并比对 SHA-256', 'zh-TW': '回讀裝置並比對 SHA-256', en: 'Reading device back and comparing SHA-256', ko: '장치를 다시 읽고 SHA-256 비교 중', ru: 'Обратное чтение устройства и сравнение SHA-256', ar: 'إعادة قراءة الجهاز ومقارنة SHA-256' },
  msgVerifyProgress: { zh: '校验数据 {pct}%', 'zh-TW': '驗證資料 {pct}%', en: 'Verifying {pct}%', ko: '검증 {pct}%', ru: 'Проверка {pct}%', ar: 'التحقق {pct}%' },
  msgCancelled: { zh: '用户已取消', 'zh-TW': '使用者已取消', en: 'Cancelled by user', ko: '사용자가 취소함', ru: 'Отменено пользователем', ar: 'ألغاه المستخدم' },
  msgDeviceDisconnected: { zh: '写入返回 0 字节，设备可能已断开', 'zh-TW': '寫入傳回 0 位元組，裝置可能已中斷連線', en: 'Write returned 0 bytes; the device may be disconnected', ko: '쓰기가 0바이트를 반환했습니다. 장치가 분리되었을 수 있습니다', ru: 'Запись вернула 0 байт; устройство могло быть отключено', ar: 'أعادت الكتابة 0 بايت؛ ربما تم فصل الجهاز' },
  msgOpenDeviceFailed: { zh: '无法打开目标设备 {node}：{hint}', 'zh-TW': '無法開啟目標裝置 {node}：{hint}', en: 'Cannot open target device {node}: {hint}', ko: '대상 장치 {node}을(를) 열 수 없습니다: {hint}', ru: 'Не удалось открыть целевое устройство {node}: {hint}', ar: 'تعذّر فتح الجهاز المستهدف {node}: {hint}' },
  errPermission: { zh: '权限不足，需要管理员权限', 'zh-TW': '權限不足，需要系統管理員權限', en: 'Permission denied, administrator rights required', ko: '권한 부족, 관리자 권한 필요', ru: 'Недостаточно прав, нужны права администратора', ar: 'صلاحيات غير كافية، مطلوب صلاحيات المسؤول' },
  errBusy: { zh: '设备仍被占用（未卸载成功），请拔插 U 盘后重试', 'zh-TW': '裝置仍被佔用（未卸載成功），請拔插隨身碟後重試', en: 'Device still busy (unmount failed); unplug and reconnect the drive, then retry', ko: '장치가 아직 사용 중입니다(마운트 해제 실패). 드라이브를 뺐다 다시 연결한 후 다시 시도하세요', ru: 'Устройство всё ещё занято (не отмонтировано); отключите и снова подключите накопитель и повторите', ar: 'الجهاز ما زال قيد الاستخدام (فشل إلغاء التثبيت)؛ افصل القرص وأعد توصيله ثم أعد المحاولة' },
  msgWriteFailedAt: { zh: '写入 {mb} MB 后失败（{code}）：{msg}', 'zh-TW': '寫入 {mb} MB 後失敗（{code}）：{msg}', en: 'Failed after writing {mb} MB ({code}): {msg}', ko: '{mb} MB 기록 후 실패({code}): {msg}', ru: 'Сбой после записи {mb} МБ ({code}): {msg}', ar: 'فشل بعد كتابة {mb} ميجابايت ({code}): {msg}' },

  // ---------- 错误映射（raw.js writeErr） ----------
  errEbusy: { zh: '目标设备仍被系统占用（未卸载成功），请拔插 U 盘后重试', 'zh-TW': '目標裝置仍被系統佔用（未卸載成功），請拔插隨身碟後重試', en: 'The target device is still in use (unmount failed); unplug and reconnect the drive, then retry', ko: '대상 장치가 아직 시스템에서 사용 중입니다(마운트 해제 실패). 드라이브를 뺐다 다시 연결한 후 다시 시도하세요', ru: 'Целевое устройство всё ещё занято системой (не отмонтировано); отключите и снова подключите накопитель и повторите', ar: 'الجهاز المستهدف ما زال قيد الاستخدام (فشل إلغاء التثبيت)؛ افصل القرص وأعد توصيله ثم أعد المحاولة' },
  errEacces: { zh: '权限不足：需要管理员授权才能写入磁盘，请先点击右上角「需要授权」', 'zh-TW': '權限不足：需要管理員授權才能寫入磁碟，請先點擊右上角「需要授權」', en: 'Permission denied: administrator authorization is required to write to the disk. Click "Authorize" in the top-right corner first', ko: '권한 부족: 디스크에 쓰려면 관리자 권한이 필요합니다. 먼저 오른쪽 상단의 "권한 부여"를 클릭하세요', ru: 'Недостаточно прав: для записи на диск нужна авторизация администратора. Сначала нажмите «Авторизовать» в правом верхнем углу', ar: 'صلاحيات غير كافية: مطلوب تفويض المسؤول للكتابة على القرص. انقر «تفويض» في الزاوية العلوية أولًا' },
  errEperm: { zh: '权限不足：需要管理员授权才能写入磁盘', 'zh-TW': '權限不足：需要管理員授權才能寫入磁碟', en: 'Permission denied: administrator authorization is required to write to the disk', ko: '권한 부족: 디스크에 쓰려면 관리자 권한이 필요합니다', ru: 'Недостаточно прав: для записи на диск нужна авторизация администратора', ar: 'صلاحيات غير كافية: مطلوب تفويض المسؤول للكتابة على القرص' },
  errErofs: { zh: '设备为只读（可能开启了物理写保护开关）', 'zh-TW': '裝置為唯讀（可能開啟了實體防寫開關）', en: 'The device is read-only (its physical write-protect switch may be on)', ko: '장치가 읽기 전용입니다(물리적 쓰기 방지 스위치가 켜져 있을 수 있음)', ru: 'Устройство доступно только для чтения (возможно, включён переключатель защиты записи)', ar: 'الجهاز للقراءة فقط (ربما كان مفتاح الحماية من الكتابة مفعّلًا)' },
  errEinval: { zh: '目标设备不接受该写入方式，请确认设备未被占用', 'zh-TW': '目標裝置不接受該寫入方式，請確認裝置未被佔用', en: 'The target device rejected this write method; make sure it is not in use', ko: '대상 장치가 이 쓰기 방식을 거부했습니다. 장치가 사용 중이 아닌지 확인하세요', ru: 'Целевое устройство отклонило этот способ записи; убедитесь, что оно не занято', ar: 'رفض الجهاز المستهدف طريقة الكتابة هذه؛ تأكد من أنه ليس قيد الاستخدام' },
  errEnospc: { zh: '目标设备容量不足，请更换更大的 U 盘', 'zh-TW': '目標裝置容量不足，請更換更大的隨身碟', en: 'The target device is out of space; use a larger drive', ko: '대상 장치의 용량이 부족합니다. 더 큰 드라이브를 사용하세요', ru: 'На целевом устройстве не хватает места; используйте накопитель большего объёма', ar: 'مساحة الجهاز المستهدف غير كافية؛ استخدم قرصًا أكبر' },
  errEio: { zh: '写入时发生 I/O 错误，U 盘可能存在坏块或已损坏', 'zh-TW': '寫入時發生 I/O 錯誤，隨身碟可能有壞塊或已損壞', en: 'An I/O error occurred while writing; the drive may have bad blocks or be damaged', ko: '쓰는 동안 I/O 오류가 발생했습니다. 드라이브에 불량 블록이 있거나 손상되었을 수 있습니다', ru: 'Ошибка ввода-вывода при записи; возможно, на накопителе есть повреждённые секторы', ar: 'حدث خطأ إدخال/إخراج أثناء الكتابة؛ قد يحتوي القرص على قطاعات تالفة' },

  // ---------- 引擎标签（writer.js engineFor） ----------
  engWin: { zh: '文件级安装盘（分区 + FAT32 + 引导）', 'zh-TW': '檔案級安裝碟（分割 + FAT32 + 開機）', en: 'File-based install media (partition + FAT32 + boot)', ko: '파일 기반 설치 미디어(파티션 + FAT32 + 부팅)', ru: 'Файловая установка (раздел + FAT32 + загрузка)', ar: 'وسيط تثبيت قائم على الملفات (قسم + FAT32 + إقلاع)' },
  engMac: { zh: 'macOS 原生（createinstallmedia / asr / raw）', 'zh-TW': 'macOS 原生（createinstallmedia / asr / raw）', en: 'macOS native (createinstallmedia / asr / raw)', ko: 'macOS 네이티브(createinstallmedia / asr / raw)', ru: 'macOS нативно (createinstallmedia / asr / raw)', ar: 'macOS أصلي (createinstallmedia / asr / raw)' },
  engMacOther: { zh: '整盘映像写入（非 macOS 宿主，无法设置 bless）', 'zh-TW': '整碟映像寫入（非 macOS 宿主，無法設定 bless）', en: 'Whole-disk image write (non-macOS host, cannot set bless)', ko: '전체 디스크 이미지 쓰기(비-macOS 호스트, bless 설정 불가)', ru: 'Запись образа всего диска (не-macOS хост, bless недоступен)', ar: 'كتابة صورة القرص بالكامل (مضيف غير macOS، لا يمكن ضبط bless)' },
  engLinux: { zh: '整盘字节级写入', 'zh-TW': '整碟位元組級寫入', en: 'Whole-disk byte-level write', ko: '전체 디스크 바이트 단위 쓰기', ru: 'Побайтовая запись всего диска', ar: 'كتابة القرص بالكامل على مستوى البايت' },
  engMacWarn: { zh: '在非 macOS 系统上写入的 macOS 启动盘通常无法被 Apple 硬件引导，仅供实验。', 'zh-TW': '在非 macOS 系統上寫入的 macOS 開機碟通常無法被 Apple 硬體引導，僅供實驗。', en: 'A macOS drive written on a non-macOS system usually cannot boot Apple hardware; for experiments only.', ko: '비-macOS 시스템에서 쓴 macOS 드라이브는 일반적으로 Apple 하드웨어를 부팅할 수 없습니다. 실험용으로만 사용하세요.', ru: 'macOS-накопитель, записанный не на macOS, обычно не загружает оборудование Apple; только для экспериментов.', ar: 'قرص macOS المكتوب على نظام غير macOS لا يمكنه عادةً إقلاع أجهزة Apple؛ للتجارب فقط.' },
  engMacUnsupported: { zh: 'macOS 安装镜像只能在 macOS 上制作（Apple 安装器依赖 createinstallmedia 与 HFS/APFS 原生写入）。', 'zh-TW': 'macOS 安裝映像只能在 macOS 上製作（Apple 安裝程式依賴 createinstallmedia 與 HFS/APFS 原生寫入）。', en: 'macOS install images can only be created on macOS (the Apple installer relies on createinstallmedia and native HFS/APFS writes).', ko: 'macOS 설치 이미지는 macOS에서만 만들 수 있습니다(Apple 설치 프로그램은 createinstallmedia와 네이티브 HFS/APFS 쓰기에 의존).', ru: 'Образы установки macOS можно создавать только на macOS (установщик Apple использует createinstallmedia и нативную запись HFS/APFS).', ar: 'لا يمكن إنشاء صور تثبيت macOS إلا على macOS (يعتمد مثبّت Apple على createinstallmedia والكتابة الأصلية HFS/APFS).' },

  // ---------- 完成提示（result.note） ----------
  notePersistence: { zh: '整盘写入完成，已创建 casper-rw 持久化分区（需在内核参数中启用 persistent）。', 'zh-TW': '整碟寫入完成，已建立 casper-rw 持久化分割區（需在核心參數中啟用 persistent）。', en: 'Whole-disk write complete; casper-rw persistence partition created (enable "persistent" in kernel parameters).', ko: '전체 디스크 쓰기 완료; casper-rw 영구 저장 파티션이 생성되었습니다(커널 매개변수에 "persistent" 활성화 필요).', ru: 'Запись всего диска завершена; создан раздел casper-rw (включите «persistent» в параметрах ядра).', ar: 'اكتملت كتابة القرص بالكامل؛ تم إنشاء قسم casper-rw (فعّل "persistent" في معلمات النواة).' },
  noteRaw: { zh: '整盘写入完成，保留 ISO 原有分区与引导。', 'zh-TW': '整碟寫入完成，保留 ISO 原有分割區與開機。', en: "Whole-disk write complete; the ISO's original partitions and boot support are preserved.", ko: '전체 디스크 쓰기 완료; ISO의 원래 파티션과 부팅 지원이 보존됩니다.', ru: 'Запись всего диска завершена; исходные разделы и загрузка ISO сохранены.', ar: 'اكتملت كتابة القرص بالكامل؛ تم الحفاظ على الأقسام الأصلية ودعم الإقلاع في ISO.' },
  noteUefiLegacy: { zh: 'UEFI 与 Legacy BIOS 双模式可启动。', 'zh-TW': 'UEFI 與 Legacy BIOS 雙模式可開機。', en: 'Bootable in both UEFI and Legacy BIOS modes.', ko: 'UEFI와 Legacy BIOS 모두에서 부팅 가능.', ru: 'Загружается и в UEFI, и в Legacy BIOS.', ar: 'قابل للإقلاع في وضعي UEFI وLegacy BIOS.' },
  noteUefiOnly: { zh: 'UEFI 模式可启动。Legacy BIOS 引导扇区未写入（缺少 ms-sys / bootsect）', 'zh-TW': 'UEFI 模式可開機。Legacy BIOS 開機磁區未寫入（缺少 ms-sys / bootsect）', en: 'UEFI-bootable. Legacy BIOS boot sector not written (ms-sys / bootsect missing)', ko: 'UEFI로 부팅 가능. Legacy BIOS 부트 섹터가 기록되지 않음(ms-sys / bootsect 누락)', ru: 'Загружается в UEFI. Загрузочный сектор Legacy BIOS не записан (нет ms-sys / bootsect)', ar: 'قابل للإقلاع عبر UEFI. لم يُكتب قطاع إقلاع Legacy BIOS (ms-sys / bootsect مفقود)' },

  // ---------- Windows 安装盘引擎（windows-media.js） ----------
  msgSplittingStart: { zh: 'install.wim 超过 4 GB，正在拆分为 install.swm', 'zh-TW': 'install.wim 超過 4 GB，正在拆分為 install.swm', en: 'install.wim exceeds 4 GB, splitting into install.swm', ko: 'install.wim이 4 GB를 초과하여 install.swm으로 분할 중', ru: 'install.wim больше 4 ГБ, разделяется на install.swm', ar: 'يتجاوز install.wim 4 غيغابايت، جارٍ التقسيم إلى install.swm' },
  msgSplitNote: { zh: '（install.wim 已拆分为 install.swm，误报请忽略）', 'zh-TW': '（install.wim 已拆分為 install.swm，誤報請忽略）', en: ' (install.wim was split into install.swm; ignore if reported)', ko: ' (install.wim이 install.swm으로 분할됨; 보고되면 무시)', ru: ' (install.wim разделён на install.swm; игнорируйте предупреждение)', ar: ' (تم تقسيم install.wim إلى install.swm؛ تجاهل إن ورد)' },
  errWimTooLarge: { zh: 'install.wim 为 {size} GB，超过 FAT32 单文件 4 GB 上限，需要 wimlib 拆分。请先安装：macOS → brew install wimlib；Debian/Ubuntu → sudo apt install wimlib-tools；Windows → 使用内置 DISM 自动完成。', 'zh-TW': 'install.wim 為 {size} GB，超過 FAT32 單檔 4 GB 上限，需要 wimlib 拆分。請先安裝：macOS → brew install wimlib；Debian/Ubuntu → sudo apt install wimlib-tools；Windows → 使用內建 DISM 自動完成。', en: 'install.wim is {size} GB, over the 4 GB FAT32 single-file limit; wimlib is required to split it. Install it first: macOS → brew install wimlib; Debian/Ubuntu → sudo apt install wimlib-tools; Windows → the built-in DISM handles it automatically.', ko: 'install.wim이 {size} GB로 FAT32 단일 파일 4 GB 한도를 초과합니다. 분할하려면 wimlib이 필요합니다. 먼저 설치하세요: macOS → brew install wimlib; Debian/Ubuntu → sudo apt install wimlib-tools; Windows → 내장 DISM이 자동 처리.', ru: 'install.wim занимает {size} ГБ, что выше лимита 4 ГБ на файл в FAT32; для разделения нужен wimlib. Установите: macOS → brew install wimlib; Debian/Ubuntu → sudo apt install wimlib-tools; Windows → встроенный DISM сделает это сам.', ar: 'install.wim بحجم {size} غيغابايت، فوق حد 4 غيغابايت للملف الواحد في FAT32؛ يلزم wimlib لتقسيمه. ثبّته أولًا: macOS → brew install wimlib؛ Debian/Ubuntu → sudo apt install wimlib-tools؛ Windows → يقوم DISM المدمج بذلك تلقائيًا.' },
  errMountImage: { zh: '无法读取 Windows 镜像：{msg}（若为 UDF 镜像，请确认系统支持 UDF 挂载）', 'zh-TW': '無法讀取 Windows 映像：{msg}（若為 UDF 映像，請確認系統支援 UDF 掛載）', en: 'Cannot read the Windows image: {msg} (if it is a UDF image, make sure your system supports UDF mounting)', ko: 'Windows 이미지를 읽을 수 없습니다: {msg} (UDF 이미지인 경우 시스템이 UDF 마운트를 지원하는지 확인하세요)', ru: 'Не удалось прочитать образ Windows: {msg} (если это образ UDF, убедитесь, что система поддерживает монтирование UDF)', ar: 'تعذّرت قراءة صورة Windows: {msg} (إذا كانت صورة UDF، فتأكد من أن نظامك يدعم تثبيت UDF)' },
  errDiskpartBusy: { zh: '目标 U 盘可能被其它程序占用，请关闭占用它的窗口（如资源管理器、杀毒软件、其他分区工具）后重试。', 'zh-TW': '目標隨身碟可能被其它程式佔用，請關閉佔用它的視窗（如檔案總管、防毒軟體、其他分割工具）後重試。', en: 'The target drive may be in use by another program; close the window using it (e.g. Explorer, antivirus, or another partition tool) and retry.', ko: '대상 드라이브가 다른 프로그램에서 사용 중일 수 있습니다. 사용 중인 창(탐색기, 백신, 다른 파티션 도구 등)을 닫고 다시 시도하세요.', ru: 'Целевой накопитель может использоваться другой программой; закройте использующее его окно (Проводник, антивирус или другой инструмент разделов) и повторите.', ar: 'قد يكون القرص المستهدف قيد الاستخدام بواسطة برنامج آخر؛ أغلق النافذة التي تستخدمه (المستكشف أو برنامج الحماية أو أداة تقسيم أخرى) وأعد المحاولة.' },
  errDiskpartOther: { zh: '目标 U 盘可能为只读（写保护开关）或已损坏，请检查后重试。', 'zh-TW': '目標隨身碟可能為唯讀（防寫開關）或已損壞，請檢查後重試。', en: 'The target drive may be read-only (write-protect switch) or damaged; check it and retry.', ko: '대상 드라이브가 읽기 전용(쓰기 방지 스위치)이거나 손상되었을 수 있습니다. 확인 후 다시 시도하세요.', ru: 'Целевой накопитель может быть доступен только для чтения (переключатель защиты) или повреждён; проверьте и повторите.', ar: 'قد يكون القرص المستهدف للقراءة فقط (مفتاح الحماية من الكتابة) أو تالفًا؛ تحقق منه وأعد المحاولة.' },
  errDiskpart: { zh: 'diskpart 失败：{msg}。{hint}', 'zh-TW': 'diskpart 失敗：{msg}。{hint}', en: 'diskpart failed: {msg}. {hint}', ko: 'diskpart 실패: {msg}. {hint}', ru: 'diskpart не удался: {msg}. {hint}', ar: 'فشل diskpart: {msg}. {hint}' },
  errFormatFailed: { zh: '格式化失败：{msg}', 'zh-TW': '格式化失敗：{msg}', en: 'Format failed: {msg}', ko: '포맷 실패: {msg}', ru: 'Ошибка форматирования: {msg}', ar: 'فشل التنسيق: {msg}' },
  errNoDriveLetter: { zh: '分区完成但未获得盘符', 'zh-TW': '分割完成但未取得磁碟機代號', en: 'Partitioned but no drive letter was assigned', ko: '파티션은 완료했지만 드라이브 문자가 할당되지 않음', ru: 'Раздел создан, но буква диска не назначена', ar: 'تم التقسيم ولكن لم يتم تعيين حرف محرك أقراص' },
  msgCheckDevice: { zh: '正在复核目标设备身份', 'zh-TW': '正在複核目標裝置身份', en: 'Re-validating the target device', ko: '대상 장치 확인 중', ru: 'Повторная проверка целевого устройства', ar: 'إعادة التحقق من الجهاز المستهدف' },

  // ---------- 补充：Windows 安装盘引擎（windows-media.js） ----------
  errSfdisk: { zh: 'sfdisk 失败：{msg}', 'zh-TW': 'sfdisk 失敗：{msg}', en: 'sfdisk failed: {msg}', ko: 'sfdisk 실패: {msg}', ru: 'sfdisk не удался: {msg}', ar: 'فشل sfdisk: {msg}' },
  errMkfs: { zh: 'mkfs.vfat 失败：{msg}', 'zh-TW': 'mkfs.vfat 失敗：{msg}', en: 'mkfs.vfat failed: {msg}', ko: 'mkfs.vfat 실패: {msg}', ru: 'mkfs.vfat не удался: {msg}', ar: 'فشل mkfs.vfat: {msg}' },
  errMountNoPoint: { zh: '镜像已挂载但找不到挂载点', 'zh-TW': '映像已掛載但找不到掛載點', en: 'Image mounted but no mount point found', ko: '이미지는 마운트됐지만 마운트 지점을 찾을 수 없음', ru: 'Образ смонтирован, но точка монтирования не найдена', ar: 'تم تثبيت الصورة ولكن لم يتم العثور على نقطة التثبيت' },
  errFormatTarget: { zh: '格式化 U 盘失败：{msg}', 'zh-TW': '格式化隨身碟失敗：{msg}', en: 'Failed to format the drive: {msg}', ko: '드라이브 포맷 실패: {msg}', ru: 'Не удалось отформатировать накопитель: {msg}', ar: 'فشل تهيئة القرص: {msg}' },
  errWriteTarget: { zh: '写入目标失败，设备可能已断开', 'zh-TW': '寫入目標失敗，裝置可能已中斷連線', en: 'Write to target failed; the device may be disconnected', ko: '대상 쓰기 실패; 장치가 분리되었을 수 있습니다', ru: 'Не удалось записать в цель; устройство могло быть отключено', ar: 'فشلت الكتابة إلى الهدف؛ ربما تم فصل الجهاز' },
  errMacTcc: { zh: 'macOS 隐私保护阻止了写入：请打开 系统设置 → 隐私与安全性 → 文件和文件夹（或完全磁盘访问权限），允许 Diter 访问「可移动宗卷」，然后重试。', 'zh-TW': 'macOS 隱私保護阻止了寫入：請開啟 系統設定 → 隱私與安全性 → 檔案與資料夾（或完整磁碟存取），允許 Diter 存取「可移除卷宗」，然後重試。', en: 'macOS privacy protection blocked the write: open System Settings → Privacy & Security → Files and Folders (or Full Disk Access), allow Diter to access "Removable Volumes", then retry.', ko: 'macOS 개인 정보 보호가 쓰기를 차단했습니다. 시스템 설정 → 개인정보 보호 및 보안 → 파일 및 폴더(또는 전체 디스크 접근)에서 Diter가 "이동식 볼륨"에 접근하도록 허용한 후 다시 시도하세요.', ru: 'Защита конфиденциальности macOS заблокировала запись: откройте «Системные настройки» → «Конфиденциальность и безопасность» → «Файлы и папки» (или «Полный доступ к диску»), разрешите Diter доступ к «Съёмным томам» и повторите.', ar: 'منعت حماية خصوصية macOS الكتابة: افتح إعدادات النظام → الخصوصية والأمان → الملفات والمجلدات (أو الوصول الكامل إلى القرص)، واسمح لـ Diter بالوصول إلى «وحدات التخزين القابلة للإزالة» ثم أعد المحاولة.' },

  // ---------- 补充：macOS 安装盘引擎（darwin.js） ----------
  phaseFormat: { zh: '格式化', 'zh-TW': '格式化', en: 'Format', ko: '포맷', ru: 'Форматирование', ar: 'التهيئة' },
  phaseRestore: { zh: '恢复镜像', 'zh-TW': '還原映像', en: 'Restore', ko: '복원', ru: 'Восстановление', ar: 'الاستعادة' },
  phaseCopyPackages: { zh: '复制安装包', 'zh-TW': '複製安裝套件', en: 'Copy packages', ko: '패키지 복사', ru: 'Копирование пакетов', ar: 'نسخ الحزم' },
  msgClearPartition: { zh: '清除目标磁盘分区表', 'zh-TW': '清除目標磁碟分割表', en: 'Clearing target disk partition table', ko: '대상 디스크 파티션 테이블 지우는 중', ru: 'Очистка таблицы разделов целевого диска', ar: 'مسح جدول أقسام القرص المستهدف' },
  msgCallInstaller: { zh: '调用 {app} 自带安装工具', 'zh-TW': '呼叫 {app} 內建安裝工具', en: 'Invoking the bundled installer {app}', ko: '내장 설치 프로그램 {app} 호출 중', ru: 'Вызов встроенного установщика {app}', ar: 'استدعاء المثبّت المدمج {app}' },
  msgErasingDisk: { zh: '格式化目标盘', 'zh-TW': '格式化目標碟', en: 'Erasing target disk', ko: '대상 디스크 지우는 중', ru: 'Очистка целевого диска', ar: 'مسح القرص المستهدف' },
  msgCopyingSystem: { zh: '复制系统文件', 'zh-TW': '複製系統檔案', en: 'Copying system files', ko: '시스템 파일 복사 중', ru: 'Копирование системных файлов', ar: 'نسخ ملفات النظام' },
  msgMakingBootable: { zh: '写入引导信息', 'zh-TW': '寫入開機資訊', en: 'Writing boot information', ko: '부팅 정보 기록 중', ru: 'Запись загрузочной информации', ar: 'كتابة معلومات الإقلاع' },
  msgBuildGptHfs: { zh: '建立 GPT + HFS+ 分区', 'zh-TW': '建立 GPT + HFS+ 分割區', en: 'Creating GPT + HFS+ partition', ko: 'GPT + HFS+ 파티션 생성 중', ru: 'Создание раздела GPT + HFS+', ar: 'إنشاء قسم GPT + HFS+' },
  msgRestoringBaseSystem: { zh: '正在还原 BaseSystem', 'zh-TW': '正在還原 BaseSystem', en: 'Restoring BaseSystem', ko: 'BaseSystem 복원 중', ru: 'Восстановление BaseSystem', ar: 'استعادة BaseSystem' },
  msgRestoreProgress: { zh: '恢复镜像 {pct}%', 'zh-TW': '還原映像 {pct}%', en: 'Restoring {pct}%', ko: '복원 {pct}%', ru: 'Восстановление {pct}%', ar: 'الاستعادة {pct}%' },
  msgCopyPackages: { zh: '复制 Packages（老版本布局必需）', 'zh-TW': '複製 Packages（舊版佈局必需）', en: 'Copying Packages (required for legacy layout)', ko: 'Packages 복사 중(레거시 레이아웃에 필요)', ru: 'Копирование Packages (необходимо для старого макета)', ar: 'نسخ الحزم Packages (مطلوب للتخطيط القديم)' },
  msgSetBoot: { zh: '设置启动磁盘', 'zh-TW': '設定開機磁碟', en: 'Setting boot disk', ko: '부팅 디스크 설정 중', ru: 'Настройка загрузочного диска', ar: 'ضبط قرص الإقلاع' },
  noteCic: { zh: '已由 Apple 官方 createinstallmedia 生成，原生支持安装与恢复启动。', 'zh-TW': '已由 Apple 官方 createinstallmedia 產生，原生支援安裝與復原開機。', en: "Generated by Apple's official createinstallmedia; natively supports install and recovery boot.", ko: 'Apple 공식 createinstallmedia로 생성됨; 설치 및 복구 부팅을 기본 지원합니다.', ru: 'Создано официальным createinstallmedia от Apple; нативная поддержка установки и восстановления.', ar: 'تم الإنشاء بواسطة createinstallmedia الرسمي من Apple؛ يدعم التثبيت وإقلاع الاستعادة أصليًا.' },
  errCreateBackup: { zh: '无法创建备份文件：{msg}', 'zh-TW': '無法建立備份檔：{msg}', en: 'Cannot create backup file: {msg}', ko: '백업 파일을 만들 수 없음: {msg}', ru: 'Не удалось создать файл резервной копии: {msg}', ar: 'تعذّر إنشاء ملف النسخ الاحتياطي: {msg}' },
  noteAsr: { zh: '老版本 InstallESD 布局，已用 asr 整卷恢复并 bless 引导。', 'zh-TW': '舊版 InstallESD 佈局，已用 asr 整卷還原並 bless 開機。', en: 'Legacy InstallESD layout, restored via asr and blessed for boot.', ko: '레거시 InstallESD 레이아웃, asr로 복원하고 boot에 bless 처리함.', ru: 'Старый макет InstallESD, восстановлен через asr и помечен для загрузки (bless).', ar: 'تخطيط InstallESD القديم، تمت الاستعادة عبر asr وتهيئة الإقلاع bless.' },
};

/**
 * 取本地化文本。key 未命中时原样返回 key（避免后端抛错中断任务）。
 */
function t(key, vars) {
  const entry = D[key];
  let s = entry ? entry[lang] || entry.en || key : key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  }
  return s;
}

module.exports = { setLang, getLang, t };
