# 개인정보와 로그

## 저장되는 로그

- `launcher.log`
- `game.log`
- `update.log`
- `crash.log`

## 저장 위치

모든 데이터는 `%AppData%/zzapchoOnline` 아래에 저장됩니다.

## 민감정보 마스킹

지원 ZIP과 로그 출력에서는 access token, refresh token, bearer token, authorization header, session id, 이메일 주소를 가능한 범위에서 마스킹합니다.

## 크래시 리포트

크래시 로그는 로컬에 저장됩니다. 자동 외부 전송은 하지 않습니다.

## 전체 PC 검사 안 함

런처는 전체 PC를 검사하지 않습니다. `zzapchoOnline/minecraft` 게임 폴더의 보호 폴더만 확인합니다.
