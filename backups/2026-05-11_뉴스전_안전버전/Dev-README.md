# zzapcho-online 개발/운영 README

이 문서는 런처 개발자와 서버 관리자가 보는 문서입니다. 유저용 안내는 루트 `README.md`에 분리되어 있습니다.

## 프로젝트 개요

`zzapcho-online`은 기존 `zzapcho-launcher`를 기반으로 만든 잡초 약탈서버 전용 Electron 런처입니다.

- 저장소: `https://github.com/zzapcho/zzapcho-online`
- 앱 표시 이름: `잡초 약탈서버 런처`
- 내부 이름: `Zzapcho Online`
- 서버: `online.zzapcho.kr:25565`
- 앱 데이터 폴더: `%AppData%/zzapchoOnline`

이 저장소 하나에서 런처 코드와 공식 클라이언트 파일을 같이 관리합니다.

## 핵심 정책

- 서버 주소는 고정입니다.
- 유저는 공식 모드와 공식 리소스팩을 런처에서 추가/삭제할 수 없습니다.
- 유저는 셰이더만 자유롭게 추가할 수 있습니다.
- `config`는 GitHub manifest 관리 대상이 아닙니다.
- 런처는 `mods`, `resourcepacks`만 공식 manifest 기준으로 검증합니다.
- manifest에 없는 보호 폴더 파일은 quarantine으로 이동합니다.
- 전체 PC 검사는 하지 않습니다.

## 주요 폴더

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

## 개발 실행

```powershell
npm install
npm start
```

개발 모드에서는 자동 업데이트를 완전히 검증하기 어렵습니다. 업데이트 테스트는 설치된 exe 기준으로 확인해야 합니다.

## 로컬 exe 빌드 한방 명령어

```powershell
npm install; $env:CSC_IDENTITY_AUTO_DISCOVERY='false'; npm run build
```

빌드 결과:

```text
dist/ZzapchoOnline-Setup-1.0.0.exe
dist/latest.yml
dist/ZzapchoOnline-Setup-1.0.0.exe.blockmap
```

`npm install` 결과에 취약점 경고가 나올 수 있습니다. 바로 `npm audit fix --force`를 적용하면 Electron/런처 의존성이 깨질 수 있으니, 배포 전 별도 브랜치에서 검토 후 처리합니다.

## 모드 추가 방법

공식 모드는 GitHub 저장소에 추가합니다.

1. `.jar` 파일을 `content/client/mods/`에 넣습니다.
2. 로컬에서 확인하려면 아래 명령을 실행합니다.

```powershell
npm run manifest
npm run content:verify
npm run content:summary
```

3. 변경 사항을 commit/push합니다.

```powershell
git add content
git commit -m "Update official mods"
git push
```

`main`에 push되면 GitHub Actions가 manifest를 다시 생성하고 변경이 있으면 자동 커밋합니다.

## 리소스팩 추가 방법

공식 리소스팩은 `content/client/resourcepacks/`에 넣습니다.

```powershell
npm run manifest
npm run content:verify
git add content
git commit -m "Update official resource packs"
git push
```

런처는 다음 실행 시 GitHub manifest를 보고 새 파일을 다운로드합니다.

## 셰이더 정책

셰이더는 공식 manifest 관리 대상이 아닙니다.

유저는 런처의 셰이더 화면에서 자유롭게 추가할 수 있습니다.

- 파일 추가
- 드래그 앤 드롭
- Modrinth 검색/다운로드

`shaderpacks`는 quarantine 대상 보호 폴더가 아닙니다.

## config 정책

`config`는 GitHub manifest에서 관리하지 않습니다.

서버 필수 설정을 강제해야 한다면 추후 별도 정책을 정해야 합니다. 지금 구조에서는 유저 로컬 설정 보존을 우선합니다.

## manifest 관련 명령어

```powershell
npm run manifest
npm run content:verify
npm run content:summary
```

- `npm run manifest`: `content/profile.json`과 `content/client/`를 기준으로 `content/manifest.json` 생성
- `npm run content:verify`: manifest 구조, 파일 존재 여부, SHA-256 검증
- `npm run content:summary`: 서버/버전/파일 수/총 용량 요약 출력

## 릴리즈 방법

패치 버전 릴리즈 예시:

```powershell
npm version patch
npm run manifest
npm run content:verify
git add .
git commit -m "Release vX.Y.Z"
git tag vX.Y.Z
git push origin main --tags
```

태그가 push되면 `.github/workflows/release-launcher.yml`이 실행되어 Windows 설치 파일을 GitHub Release에 업로드합니다.

수동 릴리즈도 가능합니다.

1. GitHub 저장소의 Actions 탭으로 이동
2. `Release Launcher` 선택
3. `Run workflow`
4. tag 입력 또는 비워두기

tag 입력을 비우면 `package.json`의 `version`을 기준으로 `vX.Y.Z`를 사용합니다.

## 자동 업데이트 구조

`electron-updater`는 GitHub Releases를 봅니다.

```json
{
  "provider": "github",
  "owner": "zzapcho",
  "repo": "zzapcho-online"
}
```

Release에 다음 파일이 있어야 업데이트가 정상 동작합니다.

- `ZzapchoOnline-Setup-X.Y.Z.exe`
- `latest.yml`
- `*.blockmap`

런처 실행 중 새 버전이 감지되면 사이드바의 `업데이트` 항목에 골드 테두리가 표시됩니다.

## 강제 업데이트

`content/profile.json`의 값을 조정합니다.

```json
{
  "launcher": {
    "minimumVersion": "1.0.1",
    "latestVersion": "1.0.1"
  }
}
```

`minimumVersion`이 현재 앱 버전보다 높으면 입장 버튼이 비활성화됩니다.

## 서버를 런처로만 접속하게 하는 방법

런처만으로는 완전한 접속 통제가 불가능합니다.

모드 방식은 파일을 빼가거나 다른 클라이언트에 넣을 수 있으므로 강한 통제가 아닙니다. 권장 구조는 서버 측 Paper 플러그인/API 기반입니다.

권장 흐름:

1. 런처가 로그인 후 서버 API에 일회성 접속 토큰 요청
2. 서버 API가 짧은 만료 시간의 토큰 발급
3. 런처가 Minecraft 실행 시 토큰을 서버에 전달할 수 있는 방식으로 연결
4. Paper 플러그인이 접속 시 토큰을 API에 검증
5. 검증 실패 시 kick

관련 설계는 `docs/launcher-only-access.md`를 참고합니다.

## 보안상 한계

- 클라이언트에 비밀키를 넣으면 추출될 수 있습니다.
- 런처만으로 완전한 안티치트/DRM은 불가능합니다.
- 강한 접속 통제는 서버 측 검증이 필요합니다.
- GitHub raw URL 기반 content 배포는 대용량 파일에 적합하지 않을 수 있습니다.
- 큰 모드/리소스팩은 Git LFS 또는 Release asset 배포로 전환을 고려합니다.

## 코드서명

현재 로컬 빌드는 코드서명 없이 생성됩니다.

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'
npm run build
```

운영 배포에서는 Windows 코드서명 인증서 적용을 권장합니다. 코드서명이 없으면 SmartScreen 경고가 나올 수 있습니다.

## 자주 쓰는 명령어

```powershell
npm start
npm run manifest
npm run content:verify
npm run content:summary
npm run build
```
