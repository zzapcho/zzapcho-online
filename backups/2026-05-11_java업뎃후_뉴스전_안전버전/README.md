# 잡초 약탈서버 런처

`잡초 약탈서버 런처`는 `online.zzapcho.kr` 전용 Minecraft 런처입니다.

Microsoft 계정으로 로그인한 뒤 서버에 필요한 공식 모드와 리소스팩을 자동으로 확인하고, 부족하거나 다른 파일이 있으면 정리한 다음 게임을 실행합니다.

## 다운로드

최신 설치 파일은 GitHub Releases에서 받을 수 있습니다.

```text
https://github.com/zzapcho/zzapcho-online/releases
```

Windows 설치 파일 이름은 보통 다음 형식입니다.

```text
ZzapchoOnline-Setup-X.Y.Z.exe
```

## 실행 방법

1. `ZzapchoOnline-Setup-X.Y.Z.exe`를 실행해 설치합니다.
2. `잡초 약탈서버 런처`를 실행합니다.
3. Microsoft 계정으로 로그인합니다.
4. `입장하기`를 누릅니다.

런처가 필요한 파일을 자동으로 확인하고 Minecraft를 실행합니다.

## 서버 정보

- 서버 이름: 잡초 약탈서버
- 서버 주소: `online.zzapcho.kr`
- 기본 포트: `25565`

서버 주소는 런처에서 바꿀 수 없습니다.

## 자동 업데이트

런처는 GitHub Releases를 통해 자동 업데이트를 확인합니다.

새 버전이 있거나 업데이트가 필요한 경우, 런처의 `업데이트` 항목에 표시가 생깁니다. 업데이트 다운로드가 끝나면 업데이트 화면에서 재시작 버튼으로 적용할 수 있습니다.

## 모드와 리소스팩

공식 모드와 공식 리소스팩은 런처에서 직접 추가할 수 없습니다.

런처는 서버에서 정한 공식 파일만 사용합니다. 실행할 때 파일을 확인하고, 필요한 파일은 자동으로 다운로드합니다.

## 셰이더

셰이더는 사용자가 자유롭게 추가할 수 있습니다.

런처의 셰이더 화면에서 다음 방식을 사용할 수 있습니다.

- 파일 직접 추가
- 드래그 앤 드롭
- Modrinth 검색 및 설치

## 저장 위치

런처 데이터는 Windows의 다음 위치에 저장됩니다.

```text
%AppData%/zzapchoOnline
```

주요 폴더:

- 게임 폴더: `%AppData%/zzapchoOnline/minecraft`
- 로그: `%AppData%/zzapchoOnline/logs`
- 크래시: `%AppData%/zzapchoOnline/crashes`
- 격리 폴더: `%AppData%/zzapchoOnline/quarantine`

런처는 전체 PC를 검사하지 않습니다. `zzapchoOnline` 게임 폴더 안의 보호 대상 폴더만 확인합니다.

## 로그와 오류 제보

문제가 생기면 런처의 `로그` 화면에서 로그를 확인할 수 있습니다.

지원 ZIP 만들기 기능을 사용하면 최신 로그, 크래시 요약, 앱 정보, OS 정보 등이 묶입니다. 토큰이나 민감한 값은 가능한 범위에서 마스킹됩니다.

## 주의 사항

- 이 런처는 Minecraft, Mojang, Microsoft의 공식 런처가 아닙니다.
- 정품 Minecraft 계정이 필요합니다.
- 런처만으로 완전한 안티치트나 DRM을 보장할 수 없습니다.
- 서버 접속을 런처로만 강제하려면 서버 측 Paper 플러그인/API 연동이 별도로 필요합니다.
- 코드서명이 없는 설치 파일은 Windows SmartScreen 경고가 표시될 수 있습니다.

## 법적 고지

Minecraft, Mojang, Microsoft 관련 상표와 자산은 각 권리자에게 있습니다. 이 프로젝트는 비공식 커스텀 런처이며 Mojang 또는 Microsoft와 제휴되어 있지 않습니다.
