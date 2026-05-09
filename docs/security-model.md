# 보안 모델

## 기본 원칙

런처는 `zzapchoOnline/minecraft` 게임 폴더 안의 보호 폴더만 검사합니다. 전체 PC, 다른 게임 폴더, 사용자 개인 파일은 검사하지 않습니다.

## manifest와 SHA-256

관리자가 `content/client`에 파일을 추가하고 `npm run manifest`를 실행하면 `content/manifest.json`에 파일 경로, raw URL, SHA-256, size가 기록됩니다. 런처는 이 manifest를 받아 누락 파일을 다운로드하고 SHA-256을 검증합니다.

## quarantine

보호 폴더는 `mods`, `resourcepacks`입니다. manifest에 없는 파일이나 해시가 다른 파일은 `%AppData%/zzapchoOnline/quarantine`으로 이동합니다.

`shaderpacks`는 사용자 자유 영역입니다. 사용자가 런처에서 파일 추가, 드래그앤드롭, Modrinth 설치를 할 수 있으며 manifest 검증이나 quarantine 대상이 아닙니다. `config`도 GitHub manifest 관리 대상이 아닙니다.

## 한계

런처는 클라이언트 편의와 기본 검증을 제공하지만 완전한 안티치트나 DRM이 아닙니다. 사용자가 런처 밖에서 파일을 바꾸거나 다른 런처로 접속하는 것을 런처만으로 완전히 막을 수 없습니다.

## 서버 측 연동 필요성

강한 입장 통제를 위해서는 Paper 플러그인이 필요합니다. 예를 들어 런처에서 받은 일회성 토큰을 서버 접속 시 검증하거나, 클라이언트 manifest 버전을 서버와 핸드셰이크하는 방식이 필요합니다.

## 비밀값 금지

GitHub 토큰, 서버 관리자 토큰, API secret 같은 비밀값을 클라이언트 앱에 포함하지 않습니다. GitHub Actions는 기본 `GITHUB_TOKEN`만 사용하고, 런처에는 배포용 토큰을 넣지 않습니다.
