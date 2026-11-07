<div align="center">

# Diter

**하나의 도구로 세 가지 시스템을. 크로스 플랫폼 USB 부팅 디스크 제작 도구 —— 시스템 디스크는 절대 건드리지 않습니다.**

[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [한국어](README.ko.md) · [العربية](README.ar.md) · [Русский](README.ru.md)

</div>

Diter는 크로스 플랫폼 USB 부팅 미디어 제작 도구입니다. "자기 몫만 쓸 수 있는"
도구들과 달리, Diter는 이미지의 의미에 맞춰 올바른 쓰기 전략을 배분합니다.
Windows ISO, macOS 설치 프로그램, 어떤 Linux 배포판이든 **실제로 부팅 가능한**
드라이브를 만들어 주면서도, 시스템 디스크는 선택 목록에서 원천 차단합니다.

## Diter를 만든 이유

| 도구 | 한계 |
|---|---|
| **Rufus** | Windows에서는 강력하지만 macOS를 쓸 수 없음 (HFS/APFS 쓰기 미지원) |
| **createinstallmedia** | Apple 전용, 설치 프로그램만 지원 |
| **Etcher** | 전 플랫폼 `dd`지만, Windows ISO는 하이브리드 이미지가 아니어서 `dd`로 만들면 **부팅 불가** |

Diter는 무작정 `dd`하지 않고 이미지에 맞는 엔진으로 라우팅합니다:

| 대상 | 전략 |
|---|---|
| **Windows ISO** | 파티션 → FAT32 → 파일 복사 → 부팅 코드 (`install.wim > 4GB` 시 wimlib로 자동 분할) |
| **macOS** | 3단계 전략: `createinstallmedia` → `asr` → `raw` (10.10부터 최신까지 지원) |
| **Linux** | 디스크 전체 바이트 단위 쓰기, 선택적 `casper-rw` 영구 저장 파티션 |

## 주요 기능

- **크로스 플랫폼** — macOS / Windows / Linux 호스트 모두 지원
- **이미지 감지** — 파일 헤더를 직접 읽고(ISO9660, GPT, MBR, HFS+, APFS, UDF, DMG) 근거 체인을 표시
- **시스템 디스크 보호** — 3중 독립 게이트로 시스템 디스크는 선택조차 불가
- **권한 헬퍼** — 인증 시 헤드리스 헬퍼가 실행되어 메인 창이 재시작되지 않고 선택 상태가 유지됨
- **쓰기 후 검증** — 드라이브 전체를 다시 읽어 SHA-256 비교
- **멀티스레드 쓰기 및 검증** — 원시 이미지는 정렬된 병렬 청크 쓰기와 병렬 재읽기, 스레드 수 선택 가능 (자동 / 1 / 2 / 4 / 8)
- **디스크 도구** — 드라이브를 0으로 지우기, 드라이브를 .img 이미지로 백업
- **작업 기록** — 쓰기 / 지우기 / 백업마다 로그 기록, 로그 파일 바로 열기
- **다중 이미지 대기열** — 여러 이미지를 한 번에 끌어다 놓고 전환
- **모양** — 밝게 / 어둡게 / 시스템 테마
- **다국어 지원** — 6개 언어: 简体中文, 繁體中文, English, 한국어, العربية, Русский

## 안전 모델

1. **열거 단계** — 모든 장치에 `verdict`를 계산, 잠긴 장치는 선택지에서 제외
2. **확인 단계** — 체크박스 + 1.5초 길게 누르기
3. **쓰기 직전** — 재열거, 용량 비교, `assertWritable()` 재실행

macOS에서 시스템 디스크 판별은 까다롭습니다. 루트 볼륨 `/`은 *합성* APFS
컨테이너에 마운트되므로, `APFSPhysicalStores`를 따라 실제 디스크까지 추적해야
오탐을 피할 수 있습니다. 실제 하드웨어에서 검증되었습니다.

## 스크린샷

![Diter 메인 창](preview/01-idle.png)

## 시작하기 (개발)

```bash
npm install          # 최초 실행 시 Electron 런타임 다운로드
npm run preview      # UI 미리보기만 빌드 (Electron 불필요)
npm start            # 빌드 후 데스크톱 앱 실행
```

UI 미리보기(`preview/diter-preview.html`)는 목업 데이터를 사용하는 단일 파일로,
실제 디스크에는 절대 접근하지 않습니다.

## 빌드 산출물 (`release/`)

| 산출물 | 플랫폼 | 비고 |
|---|---|---|
| `Diter-2.0.0-mac-x64.dmg` | macOS (x64) | 미서명 — 최초 실행 시 우클릭 → 열기 필요 |
| `Diter-2.0.0-win-x64.zip` | Windows (x64) | 포터블, 인스톨러 없음 (폴더 전체를 함께 유지) |

재빌드: `npm run package` (`build/package.sh` 참고).

> **Windows 참고**: `Diter.exe` 실행 시 "VCRUNTIME140_1.dll / MSVCP140.dll이
> 없어 다시 설치하라"는 메시지가 뜨면, 시스템에 Microsoft Visual C++
> 2015-2022 재배포 가능 패키지가 없는 것입니다(Electron 기반 앱에 필요).
> 동봉된 `vc_redist.x64.exe`를 실행한 후 Diter를 다시 실행하세요.

## 프로젝트 구조

```
electron/core/     감지 / 안전 / 오케스트레이션 / 엔진
src/renderer/      React UI (구형 Electron 호환을 위해 Chrome 76으로 컴파일)
docs/              ARCHITECTURE.md — 전체 설계, 호환성 매트릭스, 설계 근거
preview/           UI 미리보기 및 흐름 스크린샷
tools/             빌드 및 패키징 헬퍼
```

자세한 설계: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## 기술 스택

Electron 33 · React 18 · esbuild — 순수 Node 시스템 호출 (컴파일이 필요한
네이티브 Rust/Go 의존성 없음).

## 상태 및 로드맵

완료: 이미지 감지, 디스크 안전 판정, 쓰기 엔진, 전체 UI와 흐름, 권한 헬퍼, 검증, 멀티스레드 쓰기.

예정: `wimlib`/`ms-sys` 번들화; macOS 헬퍼를 `SMJobBless`로 마이그레이션;
Windows 볼륨 잠금(`FSCTL_LOCK_VOLUME`).

## 라이선스

[MIT](LICENSE)
