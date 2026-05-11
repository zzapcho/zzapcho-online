# 릴리즈 절차

## 버전 올리기

```bash
npm version patch
```

필요하면 `content/profile.json`의 `launcher.latestVersion`과 `launcher.minimumVersion`도 함께 조정합니다.

## manifest 생성

```bash
npm run manifest
```

## content 검증

```bash
npm run content:verify
npm run content:summary
```

## 빌드

```bash
npm run build
```

## GitHub Release

태그를 push하면 `release-launcher.yml`이 실행됩니다.

```bash
git tag vX.Y.Z
git push origin main --tags
```

Actions 탭의 `Release Launcher`를 수동 실행할 수도 있습니다. 태그 입력을 비우면 `package.json`의 `version`을 읽어 `vX.Y.Z` 형식으로 릴리즈 태그를 정합니다.

릴리즈에는 Windows 설치 파일과 자동 업데이트 메타데이터가 올라갑니다.

- `ZzapchoOnline-Setup-X.Y.Z.exe`
- `latest.yml`
- `*.blockmap`

## 자동 업데이트 확인

릴리즈 업로드 후 설치된 앱에서 업데이트 화면을 확인합니다. `electron-updater`는 `zzapcho/zzapcho-online` Releases를 조회합니다.

런처가 새 버전 또는 필수 업데이트를 감지하면 사이드바의 `업데이트` 항목에 골드 테두리를 표시합니다. 다운로드가 끝나면 업데이트 화면의 재시작 버튼으로 설치를 마무리합니다.

## 코드서명

운영 배포 전 Windows 코드서명을 적용하는 것이 좋습니다. 코드서명이 없으면 SmartScreen 경고가 발생할 수 있습니다.
