# QA 체크리스트

## 첫 실행

- 앱 이름이 `잡초 약탈서버 런처`로 표시되는지 확인
- 데이터 폴더가 `%AppData%/zzapchoOnline`에 생성되는지 확인

## 로그인

- Microsoft 로그인 성공
- 로그아웃 후 로그인 화면 복귀

## 서버 상태

- `online.zzapcho.kr:25565` 상태 표시
- 온라인/오프라인, 인원, MOTD, 버전, ping 표시

## manifest 검증

- `npm run manifest` 성공
- `npm run content:verify` 성공
- SHA-256 불일치 시 실패

## 파일 다운로드

- 누락 파일 다운로드
- 다운로드 후 SHA-256 재검증

## quarantine

- 보호 폴더에 manifest에 없는 파일을 넣고 런처 실행
- 파일이 `%AppData%/zzapchoOnline/quarantine`으로 이동하는지 확인
- `shaderpacks`와 `config` 파일은 quarantine 되지 않는지 확인

## 셰이더

- 파일 추가 버튼으로 `.zip` 셰이더 추가
- 드래그앤드롭으로 셰이더 추가
- Modrinth 검색 후 설치
- 셰이더 삭제

## 실행

- Java 감지 또는 자동 설치
- Fabric loader 설치
- Minecraft 실행

## 크래시

- 실행 실패 시 `crash.log` 기록

## 자동 업데이트

- GitHub Release 조회
- 다운로드 진행률 표시
- 업데이트 준비 완료 후 재시작 버튼 동작

## 지원 ZIP

- 지원 ZIP 생성
- 로그와 summary 포함
- 민감정보 마스킹 확인
