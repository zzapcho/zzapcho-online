# 잡초 약탈서버 런처 / zzapcho-online

`zzapcho-online`은 기존 `zzapcho-launcher`를 기반으로 만든 잡초 약탈서버 전용 Minecraft 런처입니다. 이 저장소 하나에서 Electron 런처 코드와 공식 클라이언트 파일을 함께 관리합니다.

기본 서버는 `online.zzapcho.kr:25565`이며, 사용자는 런처에서 서버 주소, 모드, 리소스팩을 변경할 수 없습니다. 관리자는 GitHub 저장소의 `content/profile.json`과 `content/client/` 파일을 수정하고 manifest를 갱신해 공식 모드/리소스팩 구성을 배포합니다. 셰이더는 사용자가 런처에서 자유롭게 추가할 수 있고, `config`는 GitHub manifest 관리 대상이 아닙니다.

## 주요 기능

- Microsoft 계정 로그인 후 Minecraft 실행
- `content/manifest.json` 기반 공식 파일 다운로드
- SHA-256 검증 및 불일치 파일 재다운로드
- manifest에 없는 공식 보호 폴더 파일 quarantine
- 셰이더 파일 직접 추가/드래그앤드롭/Modrinth 설치
- `online.zzapcho.kr:25565` 서버 상태 표시
- GitHub Releases 기반 `electron-updater` 자동 업데이트
- 런처/게임/업데이트/크래시 로그와 지원 ZIP 생성

## 제거된 기능과 이유

- 서버 프리셋 선택, 임의 서버 주소 입력 제거
- 사용자 모드/리소스팩 추가 제거
- 사용자 파일 stash/restore 제거
- Modrinth 검색, 버전 조회, 다운로드 제거

약탈서버 전용 런처에서는 클라이언트 구성을 사용자가 바꾸는 구조가 아니라 개발자가 저장소에서 통제하는 구조가 필요하기 때문입니다.

## 기술 스택

- Electron
- Node.js
- minecraft-launcher-core
- msmc
- electron-updater
- GitHub Actions

## 프로젝트 구조

```text
content/
  profile.json
  manifest.json
  client/
    mods/
    resourcepacks/
scripts/
  generate-manifest.js
  verify-content.js
  print-content-summary.js
docs/
.github/workflows/
main.js
preload.js
src/
launcher.config.json
```

## 실행 방법

```bash
npm ci
npm run manifest
npm run content:verify
npm start
```

## 빌드 방법

```bash
npm run content:verify
npm run build
```

개발용 디렉터리 빌드는 다음 명령을 사용합니다.

```bash
npm run build:dir
```

## content/profile.json

`content/profile.json`은 관리자가 수정하는 단일 설정 파일입니다.

- 서버 이름, 주소, 포트
- Minecraft 버전
- loader 종류와 버전
- 런처 최소/최신 버전
- 보호 폴더와 quarantine 정책
- manifest 버전

런처 UI에서는 이 값을 수정할 수 없습니다.

## content/client 사용법

- 모드: `content/client/mods`
- 리소스팩: `content/client/resourcepacks`
- 셰이더: 런처의 셰이더 화면에서 파일 추가, 드래그앤드롭, Modrinth 설치
- config: GitHub manifest 관리 대상 아님

유저가 런처에서 추가하는 방식이 아닙니다. 관리자가 이 저장소에 파일을 넣고 manifest를 갱신하면, 런처가 실행 시 GitHub의 manifest를 보고 등록된 파일만 다운로드/검증해서 사용합니다.

모드 추가 예시:

```bash
# jar 파일을 content/client/mods에 추가
npm run manifest
npm run content:verify
npm run content:summary
git add content
git commit -m "Update official client content"
git push
```

리소스팩도 같은 방식입니다.

```bash
# 리소스팩
copy my-pack.zip content/client/resourcepacks/

npm run manifest
npm run content:verify
git add content
git commit -m "Update official resource packs"
git push
```

파일 크기가 큰 모드/리소스팩은 GitHub Releases 또는 Git LFS 사용을 고려해야 합니다. 현재 기본 구현은 `raw.githubusercontent.com` 기반 URL을 사용합니다.

## 파일 검증과 quarantine

런처 데이터 위치는 `%AppData%/zzapchoOnline`입니다.

- 게임 폴더: `%AppData%/zzapchoOnline/minecraft`
- 로그: `%AppData%/zzapchoOnline/logs`
- 크래시: `%AppData%/zzapchoOnline/crashes`
- 격리: `%AppData%/zzapchoOnline/quarantine`

런처는 전체 PC를 검사하지 않습니다. `zzapchoOnline/minecraft` 안의 `mods`, `resourcepacks` 보호 폴더만 공식 manifest 기준으로 검사합니다. `shaderpacks`는 사용자 자유 영역이고, `config`는 manifest 관리 대상이 아닙니다.

## GitHub Actions

- `verify-content.yml`: manifest 생성, content 검증, summary 출력
- `build.yml`: content 검증 후 Windows 빌드
- `release-launcher.yml`: 태그 또는 수동 실행으로 빌드 산출물을 GitHub Release에 업로드

manifest 자동 커밋은 기본 동작이 아닙니다. 관리자가 로컬에서 `npm run manifest`를 실행하고 변경분을 commit합니다.

## 자동 업데이트

`electron-updater`는 다음 GitHub Release 저장소를 사용합니다.

```json
{
  "provider": "github",
  "owner": "zzapcho",
  "repo": "zzapcho-online"
}
```

`manifest.launcher.minimumVersion`이 현재 앱 버전보다 높으면 입장 버튼이 비활성화되고 업데이트 필요 상태가 표시됩니다.

## 배포 방법

```bash
npm version patch
npm run manifest
npm run content:verify
git add .
git commit -m "Release vX.Y.Z"
git tag vX.Y.Z
git push origin main --tags
```

GitHub Actions가 Release를 만들고 설치 파일을 업로드합니다.

## 코드서명과 SmartScreen

Windows 배포 품질을 위해 코드서명 인증서 적용을 권장합니다. 코드서명이 없으면 Windows SmartScreen 경고가 표시될 수 있습니다.

## 로그와 크래시

런처는 `launcher.log`, `game.log`, `update.log`, `crash.log`를 저장합니다. 지원 ZIP에는 최신 로그, 민감정보가 마스킹된 설정 요약, manifest 요약, 앱/OS/Minecraft 정보가 포함됩니다.

## 서버 입장 통제의 한계

이 런처는 Minecraft/Mojang/Microsoft 공식 런처가 아닙니다. 정품 Minecraft 계정이 필요합니다.

런처만으로 완전한 안티치트나 DRM을 보장할 수 없습니다. 사용자는 런처 밖에서 게임 파일을 수정하거나 다른 클라이언트로 접속을 시도할 수 있습니다. 강한 통제를 위해서는 서버 측 Paper 플러그인, 접속 토큰, 클라이언트 검증 핸드셰이크 같은 서버 연동이 추후 필요합니다.

런처로만 서버에 들어오게 하려면 모드 방식보다 서버 측 검증이 필요합니다. 권장 구조는 `docs/launcher-only-access.md`에 정리했습니다.

## 새 GitHub 저장소 생성

이 환경에는 `gh` CLI가 설치되어 있지 않아 자동 생성하지 못했습니다. 수동 생성 시:

```bash
git remote remove origin
git remote add origin https://github.com/zzapcho/zzapcho-online.git
git branch -M main
git push -u origin main
```

처음부터 복제해 작업한다면:

```bash
git clone https://github.com/zzapcho/zzapcho-launcher.git zzapcho-online
cd zzapcho-online
git remote remove origin
git remote add origin https://github.com/zzapcho/zzapcho-online.git
git branch -M main
git push -u origin main
```

## 향후 계획

- 서버 측 Paper 플러그인과 런처 핸드셰이크 연동
- Release asset 기반 대용량 content 배포
- 코드서명 자동화
- 서버 API 기반 접속자 목록 개선

## 법적 고지

Minecraft, Mojang, Microsoft 관련 상표와 자산은 각 권리자에게 있습니다. 이 프로젝트는 비공식 커스텀 런처이며 Mojang 또는 Microsoft와 제휴되어 있지 않습니다.
