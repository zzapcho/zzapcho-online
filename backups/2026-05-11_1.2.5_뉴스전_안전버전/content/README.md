# content 관리 안내

`content/`는 잡초 약탈서버 공식 클라이언트 구성을 관리하는 폴더입니다. 사용자가 런처에서 모드나 리소스팩을 추가하는 구조가 아니라, 관리자가 GitHub 저장소에 파일을 추가하고 manifest를 갱신하는 구조입니다.

## 구조

```text
content/
  profile.json
  manifest.json
  client/
    mods/
    resourcepacks/
```

## 파일 추가 흐름

1. `content/client/mods`에 모드 `.jar` 파일을 추가합니다.
2. 리소스팩은 `content/client/resourcepacks`에 추가합니다.
3. `npm run manifest`를 실행해 `content/manifest.json`을 갱신합니다.
4. `npm run content:verify`로 SHA-256과 경로 안전성을 검증합니다.
5. 변경 사항을 commit/push합니다.

## 파일 제공 방식

기본 manifest는 `raw.githubusercontent.com` URL을 사용합니다. 파일 크기가 큰 모드, 리소스팩, 셰이더는 GitHub 저장소 제한을 고려해 Git LFS 또는 GitHub Releases asset 사용을 검토해야 합니다. 현재 스크립트는 URL 생성 로직을 분리해 두었으므로 추후 release asset 기반 manifest로 바꿀 수 있습니다.

## 보안 정책

런처는 `mods`, `resourcepacks` 보호 폴더에서 manifest에 있는 파일만 공식 파일로 취급합니다. 누락 파일은 다운로드하고, SHA-256이 다른 파일은 다시 다운로드하며, manifest에 없는 파일은 quarantine 폴더로 이동합니다.

`shaderpacks`는 사용자가 런처에서 자유롭게 추가/삭제할 수 있습니다. `config`는 GitHub manifest 관리 대상이 아닙니다.
