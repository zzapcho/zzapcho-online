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

## 자동 업데이트 확인

릴리즈 업로드 후 설치된 앱에서 업데이트 화면을 확인합니다. `electron-updater`는 `zzapcho/zzapcho-online` Releases를 조회합니다.

## 코드서명

운영 배포 전 Windows 코드서명을 적용하는 것이 좋습니다. 코드서명이 없으면 SmartScreen 경고가 발생할 수 있습니다.
